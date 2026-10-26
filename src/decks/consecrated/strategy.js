/* GPL-3.0. Short own-resource plans only; never a queued future input sequence. */
(function(T) {
  "use strict";
  const copy=x=>JSON.parse(JSON.stringify(x));
  const target=s=>s.enemies?.find(e=>T.alive(e)&&e.active);
  const count=(s,id)=>s.hand.filter(h=>h.id===id).length;
  const serpentAlive=s=>T.alive(s.characters[1]);
  const isLate=s=>s.roundLimit?.source==="native" && T.known(s.roundLimit.remaining) && s.roundLimit.remaining<=1;

  function damageEstimate(s,m,a) {
    const enemy=target(s),effect=T.skillEffects(a.who,a.skill,s.hand,m);
    if (!effect || !enemy) return null;
    // Missing positive buffs may be omitted for a lower own-buff estimate,
    // but unknown enemy protection never becomes a guaranteed kill.
    const buffs=T.burstBuffs(m,a.who),knownOwn=effect.rawDamage!==null;
    const own=effect.rawDamage??(a.who===1&&a.skill==="Q"?
      T.serpentBurstDamage(count(s,"block"),{emblem:buffs.emblem===true,adeptus:buffs.adeptus===true,cleanup:m.cleanup??0}):
      effect.baseDamage+(m.cleanup??0)+
        (a.skill==="Q"?(buffs.emblem===true?2:0)+(buffs.adeptus===true?3:0):0));
    const reaction=T.elementReaction(effect.damageType,enemy.auraKnown?enemy.aura:[]);
    const hit=T.damageAgainst(enemy,own+reaction.bonus,effect.damageType);
    const splash=(s.enemies||[]).filter(e=>T.alive(e)&&e!==enemy).reduce((sum,e)=>{
      if (reaction.spread) {
        const r=T.elementReaction(reaction.spread,e.auraKnown?e.aura:[]);
        return sum+Math.min(e.hp,T.damageAgainst(e,1+r.bonus,reaction.spread).direct);
      }
      return sum+(reaction.piercing?Math.min(e.hp,1):0);
    },0);
    return {raw:own,direct:hit.direct,splash,knownOwn,conditionalTrap:effect.trap?.uses>0?effect.trap:null,guaranteed:hit.guaranteed,
      reachesTarget:hit.direct>=enemy.hp,provenTargetDefeat:hit.guaranteed!==null&&hit.guaranteed>=enemy.hp};
  }
  function pressure(s,who) {
    const c=s.characters[who];
    return c.frozen===true || c.hp<=4 && s.characters.some((x,i)=>i!==who&&T.alive(x)&&x.hp>c.hp);
  }
  function protectedCard(s,m,index) {
    if (!serpentAlive(s)) return false;
    const id=s.hand[index].id,blocks=count(s,"block");
    if (id==="block") return blocks>0 && blocks%2===0;
    if (id==="stars") return s.characters[1].energy<2 && count(s,id)===1;
    if (id==="emblem") return m.emblem[1]!==true && count(s,id)===1;
    if (id==="adeptus") {
      const bare=T.serpentBurstDamage(blocks,{...T.burstBuffs(m,1),adeptus:false});
      return m.adeptus[1]!==true && blocks>=4 && count(s,id)===1 && (bare===null||bare<target(s)?.hp);
    }
    if (id==="cleanup") return m.cleanup!==2 && blocks>=4 && count(s,id)===1;
    if (T.talents[id]) return T.alive(s.characters[T.talents[id].target]) && m.talents[T.talents[id].target]!==true && count(s,id)===1;
    return false;
  }
  function cardAction(h,index,target=null) { return {type:"card",id:h.id,index,target}; }
  function preparationActions(s,m,continuation=false) {
    const actions=[];
    for (let index=0;index<s.hand.length;index++) {
      const h=s.hand[index];let a=null;
      if (h.id==="stars" && s.characters[s.active].energy<2 &&
          (s.active===1||m.bursts[1]>0||!serpentAlive(s))) a=cardAction(h,index);
      if (h.id==="emblem" && serpentAlive(s) && m.emblem[1]!==true) a=cardAction(h,index,1);
      if (h.id==="adeptus" && serpentAlive(s) && m.adeptus[1]!==true) a=cardAction(h,index,1);
      if (h.id==="cleanup" && m.cleanup!==null && m.cleanup<2) a=cardAction(h,index);
      if (h.id==="shift" && m.freeSwitch!==true) a=cardAction(h,index);
      if (T.talents[h.id] && serpentAlive(s)) a=cardAction(h,index,T.talents[h.id].target);
      if (h.id==="block"&&m.blockPlayed===false&&T.total(s.dice)<16) {
        const risk=T.blockDiscards(s.hand,index),first=s.hand[risk.indices[0]];
        if(risk.known&&risk.indices.length&&risk.indices.every(i=>s.hand[i].id===first.id&&
            JSON.stringify([s.hand[i].currentCost,s.hand[i].attachments])===JSON.stringify([first.currentCost,first.attachments]))) {
          const raw=T.serpentBurstDamage(count(s,"block")-1-Number(first.id==="block"),T.burstBuffs(m,1));
          if(continuation||serpentAlive(s)&&s.characters[1].energy===2&&raw!==null&&
              T.damageAgainst(target(s),raw,"Anemo").direct>=target(s).hp) a=cardAction(h,index);
        }
      }
      if (a && T.actionLegal(s,a,m)) actions.push(a);
    }
    // Before Q, surplus blocks can replace off-colour dice instead of spending
    // Omni. Recompute the smaller multiplier; never tune away this defeat.
    if (s.active===1 && s.characters[1].energy===2 &&
        (s.dice.Anemo||0)<T.skillCost(1,"Q",m,s).n) {
      const index=s.hand.findIndex(h=>h.id==="block"),damage=T.serpentBurstDamage(count(s,"block")-1,T.burstBuffs(m,1)),
        a={type:"tune",id:"block",index,element:"Anemo"};
      if(index>=0&&damage!==null&&damage>=target(s).hp&&T.actionLegal(s,a,m))actions.push(a);
    }
    return actions;
  }
  function preparationPayment(dice,cost) {
    const paid=T.payment(dice,cost,"Anemo");
    if (!paid || !cost.aligned) return paid;
    // Native aligned auto-payment need not choose our preferred colour. Use
    // the least remaining Wind/Omni among legal payments for this short plan.
    const wind=d=>(d.Anemo||0)+(d.Omni||0);
    let remaining=paid.remaining;
    for (const e of T.diceOrder.filter(e=>e!=="Omni")) for (let colored=0;colored<=cost.aligned;colored++) {
      const omni=cost.aligned-colored;
      if ((dice[e]||0)<colored || (dice.Omni||0)<omni) continue;
      const d={...dice};if (colored) d[e]-=colored;if (omni) d.Omni-=omni;
      if (wind(d)<wind(remaining)) remaining=d;
    }
    return {...paid,remaining};
  }
  function projectPreparation(s,m,a) {
    if (!T.actionLegal(s,a,m) || !T.projectionBudget.take()) return null;
    const next=copy(s),memory=copy(m),h=s.hand[a.index];
    if (a.type==="tune") {
      const bad=T.diceOrder.find(e=>e!=="Omni"&&e!==a.element&&next.dice[e]>0);
      if (!bad) return null;
      next.dice[bad]--;next.dice[a.element]=(next.dice[a.element]||0)+1;
    } else {
      const cost=T.cardCost(s,a,m),paid=preparationPayment(s.dice,cost);
      if (!paid) return null;
      next.dice=paid.remaining;
      if (a.id==="stars") next.characters[s.active].energy=Math.min(2,next.characters[s.active].energy+1);
      else if (a.id==="emblem") memory.emblem[1]=true;
      else if (a.id==="adeptus") {
        // Any NRE draw adds no predicted identity or resources. The consumed
        // food still gives its known buff and leaves all these old cards.
        memory.adeptus[1]=true;memory.food[1]=true;
      } else if (a.id==="cleanup") memory.cleanup++;
      else if (a.id==="shift") memory.freeSwitch=true;
      else if (a.id==="block") {
        const discarded=T.blockDiscards(s.hand,a.index).indices[0];
        if(discarded===undefined)return null;
        const element=T.team[s.active].element;
        next.dice[element]=(next.dice[element]||0)+1;
        memory.blockPlayed=true;memory.windRefund=m.talents[1];
        next.hand=next.hand.filter((_,i)=>i!==a.index&&i!==discarded).map((h,index)=>({...h,index}));
        // Retained cards and the generated die are deterministic. The unknown
        // Thunder draw adds nothing to this resource lower bound.
        return {s:next,m:memory,cost:T.size(cost)-1};
      }
      else if (T.talents[a.id]) {
        memory.talents[T.talents[a.id].target]=true;
        for (const x of memory.supports) if (x.id==="lair"&&x.discountUsed===false&&x.remaining>0) {
          x.discountUsed=true;x.remaining--;
        }
      }
      else return null;
    }
    next.hand=next.hand.filter((_,i)=>i!==a.index).map((card,index)=>({...card,index}));
    if (a.type==="card" && T.talents[a.id]) {
      // Entry generation is deterministic and consumes its source slot first.
      // The actual hand is still read again after this first action executes.
      next.hand.push({id:"block",name:T.byId.block.name,supported:true,currentCost:0,costSource:"private-rules",
        attachments:{source:"private-rules",reduction:0,increase:0}});
      if (m.supports.some(x=>x.id==="lair")) for (const card of next.hand) if (T.talents[card.id]) {
        card.currentCost=null;card.costSource="unknown";
      }
      next.hand=next.hand.map((card,index)=>({...card,index}));
    }
    // Tuning a countdown inserts its next stage in the DECK, not this hand.
    return {s:next,m:memory,cost:a.type==="tune"?0:T.size(T.cardCost(s,{...a,id:h.id},m))};
  }
  function fundSkill(s,m,skill) {
    const who=s.active,c=s.characters[who],action={type:"skill",who,skill};
    if (!T.alive(c)||c.frozen||skill==="Q"&&c.energy<2 ||
        T.total(s.dice)<T.size(T.skillCost(who,skill,m,s))) return null;
    let funded=s,policy=m,first=null,tunes=0;
    while (!T.payment(funded.dice,T.skillCost(who,skill,policy,funded)) && tunes<3) {
      const priority=h=>h.id==="block"?5:T.countdownFamily.includes(h.id)?0:count(funded,h.id)>1?1:
        h.id==="sand"?2:["harbor","lair"].includes(h.id)?4:3;
      const options=funded.hand.map((h,index)=>({type:"tune",id:h.id,index,element:T.team[who].element}))
        .filter(a=>(!protectedCard(funded,policy,a.index)||skill==="Q"&&a.id==="block")&&T.actionLegal(funded,a,policy))
        .sort((a,b)=>priority(funded.hand[a.index])-priority(funded.hand[b.index])||a.index-b.index);
      const tune=options[0];if (!tune) return null;
      const next=projectPreparation(funded,policy,tune);if (!next) return null;
      first??=tune;funded=next.s;policy=next.m;tunes++;
    }
    return T.actionLegal(funded,action,policy)?{state:funded,memory:policy,first,tunes,action}:null;
  }
  function attackRoutes(s,m) {
    const routes=[],seen=new Set(),finishes=[];
    function attack(state,memory,skill,first,steps,spent,conditional) {
      // Burst equipment/food must be used by this route's actual Q, not
      // bought just to free hand space for a charged E.
      if ((memory.adeptus[1]===true&&m.adeptus[1]!==true ||
          memory.emblem[1]===true&&m.emblem[1]!==true) && !(state.active===1&&skill==="Q")) return;
      const paid=fundSkill(state,memory,skill);if(!paid)return;
      const {state:funded,memory:policy,tunes,action}=paid,head=first||paid.first,who=action.who;
      const hit=damageEstimate(funded,policy,action);
      if (hit) {
        const remaining=T.payment(funded.dice,T.skillCost(who,skill,policy,funded)).remaining;
        const route={first:head||action,terminal:action,steps:steps+tunes+1,drawRoom:10-funded.hand.length,
          spent:spent+T.size(T.skillCost(who,skill,policy,funded)),hit,conditional,
          remainingDice:T.total(remaining),followupDamage:0};
        routes.push(route);
        if(hit.reachesTarget)finishes.push({route,state:funded,memory:policy,remaining,action});
      }
    }
    function visit(state,memory,first=null,steps=0,spent=0) {
      const key=JSON.stringify([state.active,state.dice,state.hand.map(h=>[h.id,h.currentCost,h.attachments]),
        state.characters.map(c=>c.energy),memory.talents,memory.supports,memory.emblem,memory.adeptus,memory.food,memory.cleanup,memory.freeSwitch]);
      if (seen.has(key)) return;seen.add(key);
      for (const skill of ["NA","E","Q"]) attack(state,memory,skill,first,steps,spent,false);
      // Check the target's own tuning after payment of the switch, rather
      // than converting cards to the OLD active character's element first.
      // The route remains conditional: execute one step, then re-observe.
      for (let who=0;who<3;who++) {
        const action={type:"switch",target:who};
        if (!T.actionLegal(state,action,memory)) continue;
        const budget=T.switchBudget(state,who,memory),relay={...state,active:who,dice:{...budget.remaining}},
          relayMemory={...memory,freeSwitch:false,windRefund:false};
        if (budget.refund) relay.dice[budget.refund.element]=(relay.dice[budget.refund.element]||0)+1;
        for (const skill of ["NA","E","Q"]) attack(relay,relayMemory,skill,first||action,steps+1,spent+budget.cost,true);
      }
      if (steps>=6 || !T.projectionBudget.available()) return;
      const actions=preparationActions(state,memory);
      for (const a of actions) {
        if (!T.projectionBudget.available()) break;
        const next=projectPreparation(state,memory,a);
        if (next) visit(next.s,next.m,first||a,steps+1,spent+next.cost);
      }
    }
    visit(s,m);
    // Complete the first-action candidates before spending the same budget
    // on longer continuation. No secondary planner can starve the root set.
    finishes.sort((a,b)=>Number(a.route.conditional)-Number(b.route.conditional)||
      b.route.remainingDice-a.route.remainingDice||routeOrder(a.route,b.route));
    for(const f of finishes) {
      if(!T.projectionBudget.available())break;
      f.route.followupDamage=followupDamage(f.state,f.memory,f.remaining,f.action);
    }
    return routes;
  }
  function afterAttackResources(s,m,dice,a) {
    const effect=T.skillEffects(a.who,a.skill,s.hand,m);
    let discard=effect.discardedBlocks;
    let hand=s.hand.filter(h=>h.id!=="block"||discard--<=0);
    if (effect.bottomHighest) {
      const risk=effect.bottomHighest,first=hand[risk.indices[0]];
      if (!risk.known || risk.indices.some(i=>hand[i].id!==first.id)) return null;
      hand=hand.filter((_,i)=>i!==risk.indices[0]);
      if (hand.length<10) hand.push({id:"block",name:T.byId.block.name,supported:true});
    }
    const burst=a.skill==="Q",
      memory={...m,cleanup:0,
        adeptus:m.adeptus.map((x,i)=>burst&&i===a.who?false:x),
        emblemUsed:m.emblemUsed.map((x,i)=>burst&&i===a.who?true:x)},
      characters=s.characters.map((c,i)=>({...c,energy:i!==a.who?c.energy:burst?0:Math.min(2,c.energy+1)}));
    return {state:{...s,hand:hand.map((h,index)=>({...h,index})),characters,dice},memory};
  }
  function followupDamage(s,m,dice,a) {
    // Current own resources only: up to four attacks and three rapid resource
    // preparations, within the decision's existing240 projection budget.
    // Unknown draws contribute nothing. The result is a value, not an input queue.
    const after=afterAttackResources(s,m,dice,a);if(!after)return 0;
    let best=0;const seen=new Map();
    function search(state,memory,damage=0,attacks=0,preparations=0) {
      best=Math.max(best,damage);
      if(attacks>=4||!T.projectionBudget.available())return;
      const key=JSON.stringify([state.active,state.dice,state.hand.map(h=>[h.id,h.currentCost,h.attachments]),
        state.characters.map(c=>c.energy),memory.cleanup,memory.blockPlayed,memory.windRefund,
        memory.emblemUsed,memory.adeptus,attacks,preparations]);
      if((seen.get(key)??-1)>=damage)return;seen.set(key,damage);
      for(const skill of ["E","Q","NA"]) {
        const funded=fundSkill(state,memory,skill);if(!funded)continue;
        if(!T.projectionBudget.take())return;
        const effect=T.skillEffects(state.active,skill,funded.state.hand,funded.memory),
          paid=T.payment(funded.state.dice,T.skillCost(state.active,skill,funded.memory,funded.state)),
          total=damage+(effect.rawDamage??effect.baseDamage),
          next=afterAttackResources(funded.state,funded.memory,paid.remaining,funded.action);
        best=Math.max(best,total);
        if(next)search(next.state,next.memory,total,attacks+1,preparations);
      }
      if(preparations>=3)return;
      // Reuse actual rapid resource effects. In particular Starsign can make
      // the next Q payable, and a legal block can fund the next attack.
      const actions=preparationActions(state,memory,true).filter(a=>a.type==="card"&&
        ["stars","cleanup","block"].includes(a.id));
      const tried=new Set();
      for(const action of actions) {
        const signature=JSON.stringify([action.id,state.hand[action.index].currentCost,state.hand[action.index].attachments]);
        if(tried.has(signature))continue;tried.add(signature);
        const next=projectPreparation(state,memory,action);if(!next)continue;
        search(next.s,next.m,damage,attacks,preparations+1);
      }
    }
    for(let who=0;who<3;who++) {
      const {state,memory}=after;
      if(!T.alive(state.characters[who])||state.characters[who].frozen)continue;
      const budget=who===s.active?{remaining:dice}:T.switchBudget(state,who,memory);
      if(!budget)continue;
      if(who!==s.active&&!T.actionLegal(state,{type:"switch",target:who},memory))continue;
      const available={...budget.remaining};
      if(budget.refund)available[budget.refund.element]=(available[budget.refund.element]||0)+1;
      const policy=who===s.active?memory:{...memory,freeSwitch:false,windRefund:false};
      search({...state,active:who,dice:available},policy);
    }
    return best;
  }
  function routeOrder(a,b) {
    return Number(a.conditional)-Number(b.conditional) || a.spent-b.spent || a.steps-b.steps ||
      Number(b.hit.provenTargetDefeat)-Number(a.hit.provenTargetDefeat);
  }
  function routeAction(route,reason) {
    return {...route.first,reason,plan:{steps:route.steps,spent:route.spent,terminal:route.terminal,
      estimate:route.hit,remainingDice:route.remainingDice,followupDamage:route.followupDamage,
      conditionalAfterSwitch:route.conditional}};
  }
  function tank(s,m) {
    // The guide's normal relay is the scorpion. Do not add a switch between
    // healthy helpers merely because the crocodile starts with one more HP.
    if ([0,2].includes(s.active) && T.alive(s.characters[s.active]) && !pressure(s,s.active)) return s.active;
    if (T.alive(s.characters[0]) && !pressure(s,0)) return 0;
    return [0,2].filter(i=>T.alive(s.characters[i])).sort((a,b)=>s.characters[b].hp-s.characters[a].hp)[0];
  }
  function development(s,m,needCharge,reserve) {
    const list=[],blocks=count(s,"block"),room=10-s.hand.length;
    const goals=["burst","retreat","charge","block-cycle","thunder-engine","draw","talent","support","growth"];
    const freeSlots=s.supportCounts?.known?s.supportCounts.slots.filter(x=>!x.present).length:0;
    const reserveSlot=freeSlots===1 && s.hand.some(h=>h.id==="harbor"||h.id==="lair"&&m.talents[0]!==true);
    const add=(a,goal,reason)=>{
      if (!T.actionLegal(s,a,m)) return;
      const cost=T.cardCost(s,a,m);
      const guaranteedDie=a.id==="block"?1:0;
      const neededReserve=a.id==="shift"?0:a.id==="stars"?
        (pressure(s,1)&&tank(s,m)!==undefined?Math.min(T.switchCost(m).any,T.total(s.dice)):0):reserve;
      if (T.total(s.dice)-T.size(cost)+guaranteedDie<neededReserve) return;
      list.push({...a,development:{goal,paid:T.size(cost)},reason});
    };
    for (let i=0;i<s.hand.length;i++) {
      const h=s.hand[i],a=cardAction(h,i),c=T.byId[h.id];if (!c) continue;
      if (h.id==="stars" && s.active===1 && needCharge) add(a,"charge","给当前出战飞蛇快速补能");
      if (h.id==="scorpionTalent" && T.alive(s.characters[0]) && (m.talents[0]!==true||room>=1&&blocks%2===1))
        add({...a,target:0},"thunder-engine","后台亡雷建立抽牌或补齐现有块对");
      if (h.id==="serpentTalent" && T.alive(s.characters[1]) && (m.talents[1]!==true||room>=1&&blocks%2===1))
        add({...a,target:1},"talent","亡风补块并保留后续切换收益");
      if (h.id==="crocodileTalent" && T.alive(s.characters[2]) && (m.talents[2]!==true||blocks%2===1))
        add({...a,target:2},"talent","后台亡水补块并建立打出能量块后的额外治疗");
      if (h.id==="emblem" && serpentAlive(s) && m.emblem[1]!==true && blocks>=2)
        add({...a,target:1},"growth","在当前输出预算之外装备飞蛇，保留后续爆发收益");
      if (h.id==="adeptus" && s.active===1 && s.characters[1].energy===2 && m.adeptus[1]!==true) {
        const food={...a,target:1},paid=T.payment(s.dice,T.cardCost(s,food,m),"Anemo");
        if (paid && T.skillLegal({...s,dice:paid.remaining},{who:1,skill:"Q"},m)) {
          const withFood={...m,adeptus:m.adeptus.map((x,i)=>i===1?true:x)};
          if (damageEstimate(s,withFood,{who:1,skill:"Q"})?.reachesTarget)
            add(food,"burst","现有块配料理可达到名义血量；料理检索后先重读，不预测新牌");
        }
      }
      if (h.id==="draw" && room>=1) add(a,"draw","有空间时即时过牌，抽到后重算");
      if (T.countdownFamily.includes(h.id) && room>=3) add(a,"draw","有空间且先付得起倒计时，再按真实新手牌行动");
      if (h.id==="revel" && room>=1) add(a,"draw","狂欢按全额付款；不预支抽牌后的返骰");
      // These supports consume their source card now. Harbor/White Glove
      // draw later; Lair replaces its own hand slot. Current free hand slots
      // cannot veto them as if their effects were immediate net card gains.
      if (h.id==="harbor" && !isLate(s)) add(a,"support","空支援位用于后续抽牌；不保证回合末所有抽牌都有空间");
      if (h.id==="lair" && !isLate(s) && [0,1,2].some(w=>T.alive(s.characters[w])&&m.talents[w]!==true))
        add(a,"support","缺天赋时检索，不猜会抽到哪张");
      if (h.id==="whiteGlove" && !isLate(s) && m.cleanup!==2 && !reserveSlot)
        add(a,"growth","有空位时准备后续清洁牌库收益");
      if (h.id==="liben" && !isLate(s) && !reserveSlot && m.supportStateKnown) {
        const prior=m.supports.filter(x=>x.id==="liben").sort((a,b)=>a.slot-b.slot),pool={...s.dice};
        if (prior.every(x=>T.known(x.collected))) {
          for (const x of prior) {
            let left=3-x.collected;
            for (const e of T.diceOrder) if (left>0 && pool[e]>0) {pool[e]--;left--;}
          }
          if (T.libenCollection(pool,0)>=2) add(a,"growth","扣除现有立本竞争后，余下不同色骰仍可推进新实例");
        }
      }
      if (h.id==="nre" && !isLate(s) && m.foodInDeck>0 && !count(s,"adeptus") && blocks>=4 &&
          freeSlots>1) add(a,"support","已知料理库存且不占最后关键支援位时检索");
      if (h.id==="block") {
        const retainsDefeat=n=>{
          const raw=T.serpentBurstDamage(n,T.burstBuffs(m,1));
          return serpentAlive(s)&&s.characters[1].energy===2&&raw!==null&&
            T.damageAgainst(target(s),raw,"Anemo").direct>=target(s).hp;
        };
        // Losing a multiplier is not losing a defeat when it was overkill.
        // Keep rejecting a genuinely needed pair before any price inspection.
        if (serpentAlive(s)&&blocks%2===0&&!retainsDefeat(Math.max(0,blocks-2))) continue;
        const essential=s.hand.filter((_,index)=>protectedCard(s,m,index)).map(x=>x.id),risk=T.blockRisk(s.hand,i,essential);
        const effect=T.blockEffects("play",s,m);
        if (!effect || T.total(s.dice)>=16) continue;
        const usefulHealing=effect.healing?.triggers>0 && s.characters.some((c,who)=>
          T.alive(c) && c.hp<T.team[who].maxHp);
        const funded={...s,dice:{...s.dice,[effect.element]:(s.dice[effect.element]||0)+1}},
          fundsBurst=s.active===1&&T.skillLegal(funded,{who:1,skill:"Q"},m)&&!T.skillLegal(s,{who:1,skill:"Q"},m);
        if (!risk.known) {
          // Probe only for an existing development benefit, not every card on
          // every board. This optimistic bound only requests information;
          // real discard risk is compared after reading facts, before play.
          const possibleBurst=fundsBurst&&damageEstimate({...funded,hand:s.hand.filter((_,index)=>index!==i)},m,{who:1,skill:"Q"})?.reachesTarget,
            probe=(effect.draw===1||usefulHealing||!serpentAlive(s)||possibleBurst) && T.nextDiscardProbe(s,m,i);
          if (probe) list.push({...probe,development:{goal:"block-cycle",paid:0}});
          continue;
        }
        if (risk.essentialAtRisk) continue;
        if (serpentAlive(s) && Math.floor(risk.minimumBlocks/2)<Math.floor(blocks/2) && !retainsDefeat(risk.minimumBlocks)) continue;
        const payableBurst=fundsBurst&&risk.outcomes.every(outcome=>{
            const hand=s.hand.filter((_,index)=>index!==i&&index!==outcome.discardIndex);
            return damageEstimate({...funded,hand},m,{who:1,skill:"Q"})?.reachesTarget;
          });
        if (effect.draw===1 || usefulHealing || !serpentAlive(s) || payableBurst)
          add(a,payableBurst||retainsDefeat(risk.minimumBlocks)?"burst":"block-cycle","最高费并列最差结果可接受，过量倍率可换产骰、治疗或抽牌；只正常打出一次块");
      }
      if (h.id==="sand" && s.hand.length>=4 && blocks<2 &&
          !(needCharge&&count(s,"stars")>0) &&
          s.hand.filter(x=>["emblem","adeptus","crocodileTalent","serpentTalent","revel"].includes(x.id)).length>=3)
        add({...a,choice:"sanctify"},"draw","块还没成对，先把拥挤的天赋、增伤和多余过牌换底，寻找启动资源");
    }
    return list.sort((a,b)=>goals.indexOf(a.development.goal)-goals.indexOf(b.development.goal)||
      Number(a.id==="sand")-Number(b.id==="sand")||
      a.development.paid-b.development.paid);
  }
  function choose(s,m) {
    return T.projectionBudget.run(240,()=>{
      if (!T.legalState(s) || T.enemyCount(s)===null || !target(s)) return {type:"stop",reason:"当前局面不完整，不能选择动作"};
      // A switch hands the opponent an action before the target can attack.
      // Do not buy a conditional route by exposing an even weaker pressured
      // attacker while the current character can still act.
      const routes=attackRoutes(s,m).filter(r=>!r.conditional||!pressure(s,r.terminal.who)||
        s.characters[r.terminal.who].hp>=s.characters[s.active].hp),afterBurst=m.bursts[1]>0;
      // A payable direct finish avoids an extra enemy handoff. Compare the
      // health of attackers only among routes with the same handoff count.
      const survivalRisk=r=>Number(s.characters.filter(T.alive).length<=2&&pressure(s,r.terminal.who));
      const finish=routes.filter(r=>r.hit.reachesTarget).sort((a,b)=>Number(a.conditional)-Number(b.conditional)||
        survivalRisk(a)-survivalRisk(b)||b.followupDamage-a.followupDamage||a.spent-b.spent||routeOrder(a,b));
      // Inspect missing discard facts only when a surplus block can fund two
      // further attacks while retaining the current defeat. No enemy rule is
      // needed to compare these currently available resources.
      if (m.bursts[1]===0 && s.active===1 && m.blockPlayed===false &&
          finish.some(r=>r.terminal.who===1&&r.terminal.skill==="Q")) {
        const raw=T.serpentBurstDamage(Math.max(0,count(s,"block")-2),T.burstBuffs(m,1)),
          required=T.size(T.skillCost(1,"Q",m,s))+2*T.size(T.skillCost(1,"NA",m,s));
        if(raw!==null&&raw>=target(s).hp&&T.total(s.dice)<required&&T.total(s.dice)+1>=required)
          for(let i=0;i<s.hand.length;i++)if(s.hand[i].id==="block") {
            const probe=T.nextDiscardProbe(s,m,i);
            if(probe)return {...probe,reason:"过量块产骰可补足两次续攻资金，先读缺失的最高费弃牌事实"};
          }
      }
      if (finish.length) return routeAction(finish[0],finish[0].hit.provenTargetDefeat?
        "已知防御下达到当前血量；同样击倒优先保留续攻资源":"名义伤害达到当前血量；同样击倒优先保留续攻资源");
      const alive=serpentAlive(s),needCharge=alive&&s.characters[1].energy<2,pressed=alive&&pressure(s,1);
      const attacks=routes.filter(r=>r.terminal.who===s.active || !alive || afterBurst).filter(r=>
        (r.terminal.skill!=="Q" || !alive || afterBurst || isLate(s) || r.terminal.who===1&&(pressed||T.enemyCount(s)>1)&&r.hit.raw>=8));
      if (!alive || isLate(s)) {
        // Compare at most one conditional trap trigger, never all future uses
        // as immediate damage or as proof of killing the current opponent.
        const value=r=>(r.hit.direct+r.hit.splash+(!alive&&r.hit.conditionalTrap?1:0))/
          (1+Number(r.conditional)+.25*Math.max(0,r.steps-1-Number(r.conditional)));
        attacks.sort((a,b)=>value(b)-value(a)||Number(a.conditional)-Number(b.conditional)||
          survivalRisk(a)-survivalRisk(b)||routeOrder(a,b));
        if (attacks.length) return routeAction(attacks[0],!alive?"飞蛇阵亡，转现有辅助技能与陷阱收尾":"已知最后回合，比较当前可兑现伤害");
      }
      const helper=alive?tank(s,m):undefined;
      // Helpers already hold the field for development. Do not rotate them
      // for a small HP difference; return the charged/pressured serpent to a
      // healthier teammate and keep the burst components for the next window.
      const endTarget=!m.endRelayUsed && (pressure(s,s.active) || s.active===1&&
        (s.characters[1].hp<T.team[1].maxHp || !needCharge)) ?
        s.characters.map((c,who)=>({c,who})).filter(({c,who})=>who!==s.active&&T.alive(c)&&
          (s.characters[s.active].frozen || c.hp>s.characters[s.active].hp)).sort((a,b)=>b.c.hp-a.c.hp)[0]?.who:undefined;
      const canRelay=endTarget!==undefined&&T.actionLegal(s,{type:"switch",target:endTarget},m);
      if (afterBurst && attacks.length) {
        // Fast funding is not another enemy handoff. Two tunes that buy E's
        // extra damage/draw should not lose to a switch plus a weaker NA.
        const value=r=>(Math.min(r.hit.direct,target(s).hp)+r.hit.splash+
          (r.terminal.who===1&&r.terminal.skill==="E"&&r.drawRoom>0?.5:0))/
          (1+Number(r.conditional)+.25*Math.max(0,r.steps-1-Number(r.conditional)));
        const follow=attacks.filter(r=>r.hit.direct>0&&!pressure(s,r.terminal.who)).sort((a,b)=>
          value(b)-value(a)||Number(a.conditional)-Number(b.conditional)||
          survivalRisk(a)-survivalRisk(b)||routeOrder(a,b));
        if (follow.length) return routeAction(follow[0],"继续用能承接行动的角色输出；飞蛇受压时交给健康队友接力，准备下一轮爆发");
      }
      if (alive && s.active===1) {
        // Compare the charged burst with current output before more full-
        // energy draw attacks. Low HP must not strand a large usable burst.
        const burst=routes.filter(r=>r.terminal.who===1&&r.terminal.skill==="Q").sort((a,b)=>b.hit.direct-a.hit.direct||routeOrder(a,b));
        const ordinary=Math.max(0,...routes.filter(r=>r.terminal.who===1&&r.terminal.skill!=="Q").map(r=>r.hit.direct));
        if (burst.length && (helper===undefined||!canRelay&&(s.characters[1].hp<=2||pressed&&burst[0].hit.direct>ordinary)))
          return routeAction(burst[0],"飞蛇已受压且无可支付撤回，先兑现现有爆发伤害");
      }
      // Once useful output is unavailable, hand the remaining enemy actions
      // to a healthier teammate before declaring end. Reserve only the switch
      // fee from optional development; attack/finisher routes above stay first.
      const reserve=Math.max(needCharge&&s.active===1?Math.min(3,T.total(s.dice)):0,
        endTarget!==undefined?Math.min(T.switchCost(m).any,T.total(s.dice)):0);
      // A confirmed Shift has already paid for a retreat. Finish that relay
      // before optional paid supports, then use the actual remaining dice.
      // Do not spend them all assuming the native switch must be free.
      const cards=development(s,m,needCharge,reserve).filter(a=>!(endTarget!==undefined&&m.freeSwitch===true&&
        a.type==="card"&&T.byId[a.id]?.type==="support"&&T.size(T.cardCost(s,a,m))>0));
      // An E starts the ordinary route. A known one-energy shortage prefers
      // Starsign; two Starsigns avoid combat chiefly under current pressure.
      if (needCharge && s.active===1 && !s.characters[1].frozen) {
        const star=cards.find(a=>a.id==="stars");
        if (star && (s.characters[1].energy===1||pressed||count(s,"stars")>=2&&T.total(s.dice)===4)) return star;
        const charge=attacks.filter(r=>r.terminal.skill!=="Q").sort((a,b)=>{
          // One fast tuning can buy E's extra damage and real draw at the
          // same three-die payment. Two discarded cards are not free value.
          const value=r=>r.hit.direct+(r.terminal.skill==="E"&&r.drawRoom>0?1:0)-
            Math.max(0,r.steps-1);
          return Number(a.conditional)-Number(b.conditional)||value(b)-value(a)||routeOrder(a,b);
        });
        const startup=cards.find(a=>["support","draw","thunder-engine"].includes(a.development.goal));
        if (startup && (s.characters[1].energy>0 || charge[0]?.first.type==="tune")) return startup;
        if (charge.length && !pressed) return routeAction(charge[0],"飞蛇优先少准备地补能；同等操作优先战技伤害与抽牌");
        if (star) return star;
      }
      if (cards.length) return cards[0];
      if (alive && !needCharge &&
          !s.characters[1].frozen && m.bursts[1]===0) {
        // A full-energy E wastes its charge gain. Once the supply engine is
        // gone, or there is no useful draw attack, spend the stronger Q first
        // so subsequent attacks rebuild energy instead of ending with a full hand.
        // An extra draw is useful on the current healthy serpent, but not a
        // reason to switch it back into combat before the burst is ready.
        const draw=routes.filter(r=>!r.conditional&&r.terminal.who===1&&r.terminal.skill==="E"&&r.drawRoom>0&&!pressed).sort(routeOrder);
        const burst=routes.filter(r=>r.terminal.who===1&&r.terminal.skill==="Q")
          .sort((a,b)=>b.hit.direct/(b.steps+.5)-a.hit.direct/(a.steps+.5)||routeOrder(a,b));
        const ordinary=Math.max(0,...routes.filter(r=>r.terminal.who===1&&r.terminal.skill!=="Q").map(r=>r.hit.direct));
        if (burst.length && burst[0].hit.direct>ordinary && (s.characters[0].dead===true || s.hand.length===10&&!draw.length))
          return routeAction(burst[0],"现有爆发强于普通攻击，供块中断或满手无法补牌，先开大再补能续攻");
        if (draw.length) return routeAction(draw[0],"飞蛇已满能但组件不足且无有效发育动作，用可支付战技补伤抽牌后重算");
      }
      if (alive && s.active!==1 && needCharge && !s.characters[1].frozen && !pressed && !afterBurst) {
        const relay=routes.filter(r=>r.terminal.who===1&&r.terminal.skill!=="Q").sort(routeOrder);
        if (relay.length) return routeAction(relay[0],"现有资源可切回飞蛇补能，交棒后重新观察");
      }
      // During ordinary charging/development the two helpers do not cast
      // surplus skills. Actual finishes, deadlines and post-burst/core-death
      // recovery have already competed above with the same legal routes.
      if (endTarget!==undefined) {
        const relay={type:"switch",target:endTarget,endTurnRelay:true};
        const index=s.hand.findIndex(h=>h.id==="shift"),free=index<0?null:cardAction(s.hand[index],index);
        if (free && m.freeSwitch!==true && T.actionLegal(s,free,m) && T.size(T.cardCost(s,free,m))===0)
          return {...free,reason:"结束前调位先用现有零费换班，不白交切换骰子"};
        if (T.actionLegal(s,relay,m)) return {...relay,reason:"本轮已无有效输出，结束前换健康队友承伤；本回合只做一次结束调位"};
      }
      return {type:"end",reason:"当前无可兑现的充能、爆发或发育动作；不等待固定核爆回合"};
    });
  }
  function replacement(s,m) {
    const choices=s.characters?.flatMap((c,who)=>T.alive(c)&&typeof c.frozen==="boolean"?[who]:[])||[];
    const score=who=>{
      const next={...s,active:who},best=Math.max(0,...["NA","E","Q"].flatMap(skill=>{
        const a={type:"skill",who,skill};if (!s.diceKnown || !T.skillLegal(next,a,m)) return [];
        const hit=damageEstimate(next,m,a);return hit?[Math.min(target(s)?.hp||0,hit.direct)]:[];
      }));
      return best+s.characters[who].hp*.2+(who===1&&!s.characters[who].frozen?1:0);
    };
    choices.sort((a,b)=>score(b)-score(a));return choices.length?{who:choices[0]}:null;
  }
  T.damageEstimate=damageEstimate;T.protectedCard=protectedCard;T.attackRoutes=attackRoutes;
  T.projectPreparation=projectPreparation;T.choose=choose;T.replacement=replacement;
})(globalThis.TCG);
