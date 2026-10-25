/* GPL-3.0. Guide opening with resource-aware, one-action replanning. */
(function(T){
  "use strict";
  const copy=x=>JSON.parse(JSON.stringify(x));
  const activeEnemy=s=>s.enemies?.find(e=>e.active&&T.alive(e));
  function damageEstimate(s,m,who,skill){
    const target=activeEnemy(s),element=skill==="NA"&&who!==2?"Physical":T.team[who].element,
      base=who===0?(skill==="NA"?2:1):who===1?(skill==="NA"||skill==="CA"?2:skill==="E"?3+(T.known(m.props)?m.props:0):3):skill==="NA"?1:skill==="E"?2:4,
      reaction=T.elementReaction(element,target?.auraKnown?target.aura:[]),
      bonus=(m.nextDamage[who]||0)+(m.gildedDamage[who]||0)+(m.soupDamage[who]>0?1:0),
      shatter=target?.frozen===true&&["Physical","Pyro"].includes(element)?2:0,
      hit=T.damageAgainst(target,base+bonus+reaction.bonus+shatter,element);
    const summons=s.summonCountKnown?s.summons:[],possible=who===2&&["E","Q"].includes(skill)?summons:[],
      values=possible.map(x=>x.name==="厨艺机关·低温冷藏模式"||x.name==="怪笑猫猫帽"||x.name==="半幻人"?1:0),
      followup=skill==="Q"?values.reduce((n,v)=>n+v,0):values.length?values.reduce((n,v)=>n+v,0)/values.length:0,
      talent=who!==0&&["NA","CA"].includes(skill)&&m.talents[0]&&!m.talentColdUsed&&m.coldSummon>0?1:0;
    return {element,base,reaction,bonus,shatter,direct:target?hit.direct:0,guaranteed:target?hit.guaranteed:null,
      conditionalFollowup:followup+talent,randomSummon:who===2&&skill==="E",selfDamage:who===1&&skill==="CA"&&s.characters[1].hp>=6?1:who===2&&skill==="E"&&s.characters[2].hp>=2?1:0};
  }
  function skillValue(s,m,a){
    const e=damageEstimate(s,m,a.who,a.skill),target=activeEnemy(s);if(!target)return -Infinity;
    let value=Math.min(target.hp,e.direct)+e.conditionalFollowup*.6-e.selfDamage*.25;
    if(e.guaranteed!==null&&e.guaranteed>=target.hp)value+=4;
    if(a.who===0&&a.skill==="E")value+=m.coldSummon===0?2.2:.2;
    if(a.who===1&&["CA","Q"].includes(a.skill))value+=(T.known(m.catSummon)&&m.catSummon<2?1:0)+(T.known(m.props)&&m.props<3?.4:0);
    if(a.who===1&&a.skill==="E"&&T.known(m.props))value+=Math.min(m.props,Math.max(0,10+m.extraMaxHp[1]-s.characters[1].hp))*.6;
    if(a.who===0&&a.skill==="Q")value+=s.characters.reduce((n,c,i)=>n+Math.min(2,Math.max(0,T.team[i].maxHp+m.extraMaxHp[i]-c.hp))*.55,0);
    if(a.skill==="Q")value-=.15;
    return value-.05;
  }
  function cardValue(s,m,a){
    const id=a.id,c=T.byId[id],ch=s.characters[a.target??s.active];
    if(c.type==="artifact"){
      if(m.artifactKinds[a.target]===id)return -Infinity;
      // Gladiator's discount earns priority with an actually funded followup,
      // not a fixed bonus for putting it on an off-field Lyney near the finish.
      return id==="heart"?(a.target===s.active?1.25:.1):id==="gladiator"?.1:
        a.target===s.active&&T.enemyCount(s)>1&&s.enemies.some(e=>T.alive(e)&&e.hp<=5)?1.3:.05;
    }
    if(id==="teaParty")return skillValue(s,m,{who:0,skill:"E"})+(m.talents[0]?-.8:1.5);
    if(id==="pilgrimage")return m.round<=2?.8:.05;
    if(c.type==="support")return m.round<=2?(id==="dunyarzad"&&s.hand.some(h=>T.byId[h.id]?.type==="support"&&h.index!==a.index)?1.2:.7):.1;
    if(id==="boar")return s.hand.filter(h=>T.byId[h.id]?.type==="artifact").length&&m.artifactKinds.some(Boolean)?.7:-Infinity;
    if(id==="draw")return s.hand.length<=3?.7:.1;
    if(id==="companion")return Object.entries(s.dice).some(([e,n])=>n>0&&e!=="Omni"&&e!==T.team[s.active].element)?.5:-Infinity;
    if(id==="toss")return T.total(s.dice)>=3&&(s.dice[T.team[s.active].element]||0)+(s.dice.Omni||0)<3?.4:-Infinity;
    if(id==="soup"){
      const healing=Math.max(0,10+m.extraMaxHp[a.target]-ch.hp),remaining=T.total(s.dice)-T.size(T.cardCost(id,a.target,m));
      return healing>0?healing*.2:a.target===s.active&&remaining>=1?1.2:-Infinity;
    }
    if(id==="autumnFrost")return .7+Math.min(1,Math.max(0,10+m.extraMaxHp[a.target]-ch.hp))*.8+(a.target===s.active?.1:0);
    // Attack preparations receive a value only together with a payable
    // followup below, never merely because the dice total looks sufficient.
    if(["gildedHall","wavekissedSands","verdantGift"].includes(id))return -Infinity;
    if(id==="dragon")return s.summonCountKnown&&s.summonCount<3?1.3:-Infinity;
    if(id==="blessingM")return a.summonName==="半幻人"?1.8:-Infinity;
    if(id==="surf")return s.summonCountKnown&&s.summonCount>s.enemySummonCount?1:-Infinity;
    return -Infinity;
  }
  function candidates(s,m){
    const out=[];
    for(const skill of Object.keys(T.team[s.active].skills)){
      const a={type:"skill",who:s.active,skill};if(T.skillLegal(s,a,m)&&!T.actionRefused(s,m,a))out.push({...a,value:skillValue(s,m,a)});
    }
    for(const h of s.hand){
      const c=T.byId[h.id];if(!c)continue;
      const targets=["artifact","food","talent"].includes(c.type)?s.characters.flatMap((ch,i)=>T.alive(ch)?[i]:[]):[null];
      for(const target of targets){
        const variants=c.type==="summon-discard"?(s.summons||[]).filter(x=>x.name==="半幻人").map(x=>({summonIndex:x.index,summonName:x.name})): [{}];
        for(const extra of variants){const a={type:"card",id:h.id,index:h.index,target,...extra};
          if(T.cardLegal(s,a,m)&&!T.actionRefused(s,m,a))out.push({...a,value:cardValue(s,m,a)});
        }
      }
    }
    return out;
  }
  function standingRisk(s,who){
    const hp=s.characters[who].hp;
    if(hp>3)return 0;
    const healthier=Math.max(hp,...s.characters.filter((ch,i)=>i!==who&&T.alive(ch)&&ch.frozen===false).map(ch=>ch.hp));
    // A preference between executable routes, not a prediction of the next
    // enemy hit. Without a payable relay this cannot suppress a legal attack.
    return healthier>=hp+3?Math.min(8,healthier-hp)*.35:0;
  }
  function carryPlan(s,m){
    let best={who:s.active,value:-Infinity};
    for(let who=0;who<3;who++){
      if(!T.alive(s.characters[who])||s.characters[who].frozen)continue;
      if(who!==s.active&&T.actionRefused(s,m,{type:"switch",target:who}))continue;
      const p=T.payment(s.dice,who===s.active?{}:T.switchCost(m),T.team[who].element);if(!p)continue;
      const next={...s,active:who,dice:p.remaining};
      const direct=candidates(next,m),plans=direct.filter(attack).concat(attackPreparations(next,m,direct),fundedAttacks(next,m)),
        score=Math.max(-Infinity,...plans.map(a=>a.value))-(who===s.active?0:1.2)-standingRisk(s,who);
      if(score>best.value)best={who,value:score};
    }
    return best;
  }
  function carry(s,m){return carryPlan(s,m).who;}
  const attack=a=>a.type==="skill"||a.type==="card"&&a.id==="teaParty";
  const cast=a=>a.type==="skill"?a:T.byId[a.id].combatSkill;
  const attackValue=(s,m,a)=>a.type==="skill"?skillValue(s,m,a):cardValue(s,m,a);
  function attackGoals(s){
    return Object.keys(T.team[s.active].skills).map(skill=>({type:"skill",who:s.active,skill})).concat(
      s.active===0?s.hand.filter(h=>h.id==="teaParty").map(h=>({type:"card",id:h.id,index:h.index,target:0})):[]);
  }
  function goalAt(a,s){
    if(a.type!=="card")return a;
    // Projections preserve source indices separately; no projected index can
    // escape as a native action. Only the first original action is returned.
    const index=s.hand.findIndex(h=>h.sourceIndex===a.index);
    return {...a,index};
  }
  function goalLegal(s,m,a){return a.type==="skill"?T.skillLegal(s,a,m):T.cardLegal(s,a,m);}
  function attackPreparations(s,m,list){
    const out=[],who=s.active;
    for(const prep of list.filter(a=>a.type==="card"&&(a.target===who||a.target==null)&&
      ["heart","gladiator","gildedHall","companion","wavekissedSands","verdantGift"].includes(a.id))){
      const fee=T.cardCost(prep.id,prep.target,m),paid=T.payment(s.dice,fee,T.team[who].element);
      if(!paid||T.byId[prep.id].type==="artifact"&&m.artifactKinds[who])continue;
      if(prep.id==="companion"&&Object.entries(s.dice).reduce((n,[e,v])=>n+(e!==T.team[who].element&&e!=="Omni"?v:0),0)<2)continue;
      const next=copy(s),memory=copy(m);
      if(next.skillFees?.who===who)for(const [skill,fee]of Object.entries(next.skillFees.entries))
        fee.reduction=T.skillReduction(who,skill,m,s);
      next.dice={...paid.remaining};
      if(prep.id==="companion")next.dice.Omni=(next.dice.Omni||0)+2;
      next.hand=T.indexedHand(s.hand.filter(h=>h.index!==prep.index).map(h=>({...h,sourceIndex:h.index})));
      if(prep.id==="gildedHall")memory.gildedDamage[who]=2;
      else if(prep.id==="wavekissedSands"){for(let i=0;i<3;i++)if(T.alive(s.characters[i]))memory.foodDiscount[i]=1;}
      else if(prep.id==="verdantGift"){for(let i=0;i<3;i++)if(T.alive(s.characters[i]))memory.nextDamage[i]=1;}
      else if(T.byId[prep.id].type==="artifact")memory.artifactKinds[who]=prep.id;
      for(const original of attackGoals(s)){
        const goal=goalAt(original,next),skill=cast(original),estimate=damageEstimate(s,m,skill.who,skill.skill);
        if(T.actionRefused(s,m,original)||!goalLegal(next,memory,goal))continue;
        // A known immediate finish takes precedence over optional setup.
        if(goalLegal(s,m,original)&&estimate.guaranteed!==null&&estimate.guaranteed>=activeEnemy(s).hp)continue;
        const saving=original.type==="skill"?T.size(T.skillCost(who,skill.skill,m,s))-T.size(T.skillCost(who,skill.skill,memory,next)):0,
          draw=prep.id==="heart"&&estimate.selfDamage>0&&next.hand.length<10?.9:0;
        if(prep.id==="heart"&&!draw||prep.id==="gladiator"&&saving<=0)continue;
        const value=attackValue(next,memory,goal)+draw+Math.max(0,saving)*.4-.1-T.size(fee)*.15;
        if(!goalLegal(s,m,original)||value>attackValue(s,m,original))out.push({...prep,value,followup:original});
      }
    }
    return out;
  }
  function discardValue(s,m,h){
    const c=T.byId[h.id];if(!c)return 0;
    const duplicate=s.hand.filter(x=>x.id===h.id).length>1;
    if(h.id==="teaParty")return m.talents[0]||m.used[0]>0?.4:2;
    if(h.id==="heart"||h.id==="gladiator")return m.artifactKinds.every(Boolean)||duplicate?.5:1.5;
    if(c.type==="support")return m.round<=2&&!duplicate?1.1:.4;
    if(h.id==="dragon"||h.id==="surf")return s.summonCountKnown&&s.summonCount>=2?.9:.2;
    if(c.type==="food"||c.type==="team-food")return .8;
    return .5;
  }
  function fundedAttacks(s,m){
    const out=[],element=T.team[s.active].element;
    for(const goal of attackGoals(s)){
      if(goalLegal(s,m,goal)||T.actionRefused(s,m,goal))continue;
      if(goal.type==="card"&&(m.used[0]>0||m.talents[0]))continue;
      const next=copy(s),removed=new Set(),discards=s.hand.filter(h=>h.canTune!==false&&
        !h.attachments?.noTuning&&T.byId[h.id]?.type!=="legend"&&!(goal.type==="card"&&h.index===goal.index))
        .sort((a,b)=>discardValue(s,m,a)-discardValue(s,m,b)||a.index-b.index);
      let first=null,loss=0,steps=0;
      for(const h of discards){
        const a={type:"tune",id:h.id,index:h.index,element};
        if(!first&&T.actionRefused(s,m,a))continue;
        const bad=T.diceOrder.find(e=>e!==element&&e!=="Omni"&&next.dice[e]>0);
        if(!bad||steps>=3)break;
        next.dice[bad]--;next.dice[element]=(next.dice[element]||0)+1;
        removed.add(h.index);next.hand=T.indexedHand(s.hand.filter(h=>!removed.has(h.index)).map(h=>({...h,sourceIndex:h.index})));
        first||=a;loss+=discardValue(s,m,h);steps++;
        const ready=goalAt(goal,next);
        if(goalLegal(next,m,ready)){
          out.push({...first,value:attackValue(next,m,ready)-.2*steps-.15*loss,followup:goal});break;
        }
      }
    }
    return out;
  }
  function choose(s,m){
    if(!T.legalState(s))return {type:"stop",reason:"牌桌资源、角色或手牌尚未完整识别"};
    const direct=candidates(s,m),finish=direct.find(a=>{
      if(!attack(a))return false;
      const c=cast(a),e=damageEstimate(s,m,c.who,c.skill);
      // Prefer a payable direct finish over preparing future summons. Unknown
      // defense is not a guaranteed kill, but it must not award extra setup
      // for the last target when our own damage estimate already covers it.
      return e.guaranteed!==null&&e.guaranteed>=activeEnemy(s)?.hp||
        T.enemyCount(s)===1&&e.direct>=activeEnemy(s)?.hp;
    });
    if(finish)return finish;
    const list=direct.concat(attackPreparations(s,m,direct),fundedAttacks(s,m)).sort((a,b)=>b.value-a.value),actor=s.active;
    let best=list[0];
    // Optional development must not spend the last payable attack. Compare
    // the existing funded route with a known one-card payment/refund only;
    // random draws and prospective Gambler kills are not spendable dice.
    if(best?.type==="card"&&!best.followup&&["artifact","support","draw"].includes(T.byId[best.id].type)){
      const fee=T.cardCost(best.id,best.target,m),paid=T.payment(s.dice,fee,T.team[actor].element),
        output=list.find(a=>a.value>0&&attack(a.followup||a));
      if(T.size(fee)>0&&paid&&output){
        const next={...s,hand:T.indexedHand(s.hand.filter(h=>h.index!==best.index))},memory=copy(m),
          remaining=T.total(paid.remaining)+T.total(T.cardRefund(best,m,s));
        if(T.byId[best.id].type==="artifact"){
          memory.artifactKinds[best.target]=best.id;
        }
        const canStillFund=attackGoals(next).some(goal=>{
          if(T.actionRefused(s,m,goal))return false;
          const c=cast(goal);
          if(s.characters[c.who].frozen||c.skill==="Q"&&s.characters[c.who].energy<T.team[c.who].maxEnergy)return false;
          const cost=goal.type==="skill"?T.skillCost(c.who,c.skill,memory,next):T.cardCost(goal.id,goal.target,memory);
          return remaining>=T.size(cost);
        });
        if(!canStillFund)best=output;
      }
    }
    // Use the opening the guide describes only while it can still be paid.
    if(actor===0&&m.used[0]===0){
      const setup=list.find(a=>{const goal=a.followup||a;return goal.type==="card"&&goal.id==="teaParty"||goal.type==="skill"&&goal.skill==="E";});
      if(setup)return setup;
    }
    // The guide's startup is E -> Lyney charged arrow, not repeated physical
    // attacks while the cold summon ticks away. A one-hit ranking charges the
    // switch now but misses the arrow's setup for the next round. Apply this
    // opening preference only to a currently funded CA route; no future dice,
    // reaction, damage or successful switch is booked in observed state.
    if(actor===0&&m.round>=1&&m.round<=2&&m.used[0]>0&&m.used[1]===0&&m.coldSummon>0&&
        T.alive(s.characters[1])&&s.characters[1].frozen===false&&standingRisk(s,1)===0&&
        !T.actionRefused(s,m,{type:"switch",target:1})){
      const paid=T.payment(s.dice,T.switchCost(m),"Pyro");
      if(paid){
        const relay={...s,active:1,dice:paid.remaining},available=candidates(relay,m),
          plans=available.concat(attackPreparations(relay,m,available),fundedAttacks(relay,m));
        if(plans.some(a=>{const goal=a.followup||a;return a.value>0&&goal.type==="skill"&&goal.skill==="CA";}))
          return {type:"switch",target:1};
      }
    }
    const next=carryPlan(s,m);
    if(next.who!==actor&&(!best||best.value-standingRisk(s,actor)<next.value))return {type:"switch",target:next.who};
    if(best&&best.value>0)return best;
    return {type:"end",reason:"当前资源没有可兑现的行动"};
  }
  function soupChoice(options,s,target,m=T.freshMemory()){
    const ch=s.characters[target],missing=Math.max(0,10+m.extraMaxHp[target]-ch.hp),
      rank={healing:Math.min(2,missing)*.8,discount:target===s.active&&T.total(s.dice)>=1?1.9:.2,
        fury:target===s.active&&T.total(s.dice)>=3?1.6:.1,shield:ch.hp<=5?1.2:.2,soothing:ch.hp<=5?1.4:.3,maxhp:.5};
    return options.slice().sort((a,b)=>(rank[b.effect]??-1)-(rank[a.effect]??-1))[0]||null;
  }
  function replacement(s,m){
    if(!Array.isArray(s.characters)||s.characters.length!==3||
      s.characters.some(ch=>ch?.dead!==true&&!T.alive(ch)))return null;
    const choices=s.characters.flatMap((ch,who)=>{
      if(!T.alive(ch)||typeof ch.frozen!=="boolean")return [];
      const next={...s,active:who},skills=Object.keys(T.team[who].skills)
        .filter(skill=>!ch.frozen&&s.diceKnown&&T.skillLegal(next,{who,skill},m));
      const output=Math.max(0,...skills.map(skill=>skillValue(next,m,{who,skill})));
      return [{who,value:output+ch.hp*.12-(ch.frozen?2:0)}];
    });
    return choices.sort((a,b)=>b.value-a.value)[0]||null;
  }
  function actionRerollGoal(s,m){
    const who=carry(s,m);
    return {element:T.team[T.alive(s.characters[who])?who:s.active].element};
  }
  T.damageEstimate=damageEstimate;T.candidates=candidates;T.carry=carry;T.soupChoice=soupChoice;T.choose=choose;
  T.replacement=replacement;T.actionRerollGoal=actionRerollGoal;
})(globalThis.TCG);
