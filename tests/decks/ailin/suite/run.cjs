"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
async function run(test,loadContext=overrides=>load(root,overrides)){
  const C=loadContext(),T=C.TCG;
  const memory=()=>Object.assign(T.freshMemory(),{round:1});
  const board=(ids=[],active=0)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},
    hand:T.indexedHand(ids.map((id,i)=>T.observedCard(T.byId[id].name,i))),
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:20,dead:false,active:true,aura:[],auraKnown:true,defenseKnown:true,shield:0,immuneElements:[]}]});
  await test("ailin: guide deck and generated dishes have independent native identities",()=>{
    assert.deepEqual(clone(T.team.map(c=>c.name)),["爱可菲","林尼","水形幻人"]);
    assert.equal(T.cards.reduce((n,c)=>n+c.copies,0),30);
    assert.equal(T.cards.filter(c=>c.copies===0).length,4);
    for(const card of T.cards)assert.equal(T.identify(card.name)?.id,card.id);
    assert.equal(T.identify("纯水精灵"),null);
    assert.equal(T.observedCard("卵师傅",0).id,"chef","reviewed native OCR variant maps only this full title");
    assert.equal(T.observedCard("雾松秋分",0).id,"autumnFrost","slot01 native full-title variant, not fuzzy matching");
    assert.equal(T.identify("雾松"),null);
    assert.equal(T.identify("师傅"),null,"do not introduce broad fuzzy card matching");
    assert.equal(T.team[1].skills.CA,"隐具魔术箭");
  });

  await test("ailin: actual packaged input uses all four Lyney slots, without title OCR",async()=>{
    for(const [who,skill,x]of [[1,"NA",1500],[1,"CA",1608],[1,"E",1716],[1,"Q",1824],[0,"NA",1608],[2,"NA",1608]]){
      const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),
        h=new c.TCGBetterGI.BetterGIHost({}),s=board([],who),m=memory();
      s.characters[who].energy=T.team[who].maxEnergy;
      h.frame=fn=>fn({});h.board=()=>clone(s);h.boardReady=true;
      h.phaseIn=()=>({phase:"unknown",turn:"none"});h.warnings=()=>({lack:false,text:""});
      h.ocr=h.numericAt=()=>{throw Error("Fixed skill slots must not identify names");};
      await h.execute({type:"skill",who,skill},s,m);
      assert.deepEqual(inputs,[[x,957],[x,957]]);
    }
    const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy)),
      genshin:{scaleTo1080PRatio:4/3},captureGameRegion:()=>({Width:1920,Height:1200,
        Prev:{Width:2560,Height:1600,Prev:{Width:3840,Height:2160,Prev:null}},dispose(){}})}),
      h=new c.TCGBetterGI.BetterGIHost({}),s=board([],1);
    h.frame=fn=>fn({});h.board=()=>clone(s);h.boardReady=true;
    h.phaseIn=()=>({phase:"unknown",turn:"none"});h.warnings=()=>({lack:false,text:""});
    await h.waitForCapture(); // Player.enter binds geometry before its first input.
    await h.execute({type:"skill",who:1,skill:"CA"},s,memory());
    assert.deepEqual(inputs,[[1608,1077],[1608,1077]],"four-slot row follows the bound 1600 bottom panel");
  });
  await test("ailin: native four-cost E/Q badges fund skills and tuning, including projected own reductions",()=>{
    // slot10 2026-10-25T05:19:58.214Z: E rejected with three Pyro at
    // seq534; E/Q badges are both4 in the timestamp-matched native image.
    const h=new C.TCGBetterGI.BetterGIHost({}),m=memory(),s=board(["draw","verdantGift","soup"],1);
    m.round=2;m.used=[1,1,0];m.props=3;s.characters[1].hp=3;s.characters[1].energy=2;
    s.enemies=[{hp:4,dead:false,active:true,aura:["Hydro"],auraKnown:true}];
    h.summonSlotsIn=()=>[];h.supportSlotsIn=()=>({known:false});
    const areas=[];h.numericAt=(_f,area)=>{areas.push(clone(area.rect));return "4";};
    h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
    h.characterIn=(_f,i)=>({...s.characters[i],raised:i===s.active});
    h.diceIn=()=>({dice:s.dice});h.diceCountIn=()=>T.total(s.dice);h.enemiesIn=()=>s.enemies;
    Object.assign(s,h.board(true),{hand:s.hand});
    assert.deepEqual(areas,[[1698,1010,36,35],[1780,1010,36,35]]);
    assert.equal(s.skillFees.who,1);assert.equal(s.skillFees.entries.E.n,4);
    s.dice={Pyro:3};
    for(const skill of ["E","Q"]){assert.equal(T.size(T.skillCost(1,skill,m,s)),4);assert.equal(T.skillLegal(s,{who:1,skill},m),false);}
    const a=T.choose(s,m);assert.ok(!(a.type==="skill"&&["E","Q"].includes(a.skill)));
    s.dice={Anemo:1,Electro:1,Dendro:1};
    const poor=T.choose(s,m);assert.ok(!["E","Q"].includes(poor.followup?.skill),"three total dice cannot fund the four-cost skill through tuning");
    s.dice={Pyro:2,Omni:2};assert.equal(T.skillLegal(s,{who:1,skill:"E"},m),true);
    assert.equal(T.skillCost(0,"E",m,{...s,active:0}).n,3,"switch projections cannot borrow another actor's badges");
    const reduced=clone(s);reduced.skillFees.entries.E.reduction=T.skillReduction(1,"E",m,s);
    const next=clone(m);next.foodDiscount[1]=1;
    assert.equal(T.skillCost(1,"E",next,reduced).n,3,"a new own food can reduce the observed four-cost fee");
    assert.equal(T.skillCost(1,"E",next,s).n,4,"an observed fee already includes current discounts; never subtract twice");
    T.recordSkillCost(s,m,{who:1,skill:"E"},5);assert.equal(T.skillCost(1,"E",m,s).n,5);
    T.clearSkillCosts(m);
    const changed=clone(s);changed.skillFees.entries.E.n=3;
    assert.notEqual(T.boardKey(s),T.boardKey(changed));
    assert.equal(h.boardsMatch(s,changed,"execution",{type:"skill",who:1,skill:"E"}),false);
    h.numericAt=()=>"";
    assert.equal(h.boardExtrasIn({},s,1).skillFees.entries.E.n,null,"a missing number remains missing");
  });

  await test("ailin: confirmed charged shot builds props; E consumes props, not native HP",()=>{
    const m=memory(),s=board([],1),a={type:"skill",who:1,skill:"CA"},after={...clone(s),confirmed:true};
    assert.equal(T.damageEstimate(s,m,1,"CA").selfDamage,1);
    T.commit(m,a,s,after);assert.equal(m.props,1);assert.equal(m.catSummon,1);
    assert.equal(after.characters[1].hp,10,"bookkeeping cannot predict native self damage");
    T.commit(m,a,s,after);assert.equal(m.props,2);assert.equal(m.catSummon,2);
    assert.equal(T.damageEstimate(s,m,1,"E").base,5);
    T.commit(m,{type:"skill",who:1,skill:"E"},s,after);assert.equal(m.props,0);
    assert.throws(()=>T.commit(m,a,s,{...after,confirmed:false}),/未确认/);
  });
  await test("ailin: last-card gladiator reduction and persistent dishes reset on the right boundary",()=>{
    const m=memory(),s=board(["gladiator"],1),a={type:"card",id:"gladiator",index:0,target:1},after={...clone(s),hand:[],confirmed:true};
    assert.equal(T.cardLegal(s,a,m),true);T.commit(m,a,s,after);
    after.dice={Pyro:2};assert.equal(T.skillLegal(after,{who:1,skill:"CA"},m),true);
    T.commit(m,{type:"skill",who:1,skill:"CA"},after,{...after,confirmed:true});
    assert.equal(T.skillLegal(after,{who:1,skill:"CA"},m),false);
    m.foodDiscount[1]=1;m.nextDamage[1]=1;m.gildedDamage[1]=2;m.soupDiscount[1]=2;
    T.nextRound(m);assert.equal(m.foodDiscount[1],1);assert.equal(m.nextDamage[1],1);
    assert.equal(m.gildedDamage[1],0);assert.equal(m.soupDiscount[1],0);
    const full=board(["autumnFrost"],1);
    assert.equal(T.cardLegal(full,{type:"card",id:"autumnFrost",index:0,target:1},m),true);
  });

  await test("ailin: M target preview cannot enter the observed board even with a visible turn icon",()=>{
    const h=new C.TCGBetterGI.BetterGIHost({});h.frame=fn=>fn({Width:1920,Height:1080});
    h.findOcr=(_f,rect,multiple)=>multiple?[]:rect[0]===560&&rect[1]===508?"对所选我方召唤物生效":"";
    h.matches=(_f,asset)=>asset==="user_turn"?[{x:64,y:518,w:33,h:42}]:[];
    h.localOcr=()=>{throw Error("Preview HP/dice/summons must never be read as a board");};
    const s=h.initialObservationBoard();
    assert.equal(s.phase,"unknown");assert.equal(s.cardTarget,true);assert.equal(s.hand,null);
    assert.equal(s.characters,undefined);assert.equal(s.summons,undefined);
    const b=board();b.summons=[{index:0,name:"厨艺机关·低温冷藏模式",point:[1460,680],uses:2}];
    const searched=[];h.matches=(_f,asset,area)=>{searched.push({asset,rect:clone(area.rect)});return [{x:1413,y:658,w:45,h:38}];};
    assert.deepEqual(clone(h.selectedSummonsIn({},b).map(s=>s.index)),[0]);
    assert.equal(searched.length,1,"preview-only half-tulpa has no pre-action slot to inspect");
  });

  await test("ailin: last artifact traverses real title, drag, empty-hand proof, confirmation, discount and next shot",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"last-artifact");
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);
    assert.equal(f.p.memory.artifactKinds[1],"gladiator");
    assert.equal(f.drags.length,1);assert.deepEqual(f.drags[0],{from:[1120,945],to:[960,720]});
    assert.equal(f.events.filter(e=>e.event==="card-target-clicked").length,1);
    assert.equal(f.events.filter(e=>e.event==="card-confirm-clicked").length,1);
    assert.equal(f.events.find(e=>e.event==="confirmed").data.after.hand.length,0);
    assert.ok(f.events.some(e=>e.event==="empty-hand-proof"));
    await f.p.act();
    const next=f.events.filter(e=>e.event==="decision")[1].data;
    assert.equal(next.type,"skill");assert.equal(next.skill,"CA");
    assert.equal(f.stage(),2);assert.equal(f.p.memory.gladiatorUsed[1],true);
    assert.equal(f.drags.length,1,"last card cannot be dragged twice");
  });
  await test("ailin: new combat/summon/team-food payment scopes use the shared unique central control",async()=>{
    for(const id of ["surf","dragon","wavekissedSands","verdantGift"]){
      const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({});
      h.frame=fn=>fn({});h.warnings=()=>({lack:false,text:""});h.phaseIn=()=>({phase:"unknown",turn:"none"});
      h.ocr=()=>"打出手牌"+T.byId[id].name;
      h.ocrRows=()=>[{text:"打出手牌",x:860,y:920,w:200,h:50}];
      await h.cardConfirm({type:"card",id,index:0,target:null},board([id]));
      assert.deepEqual(inputs,[[960,945]],id);
      h.ocr=()=>"打出手牌"+T.byId.draw.name;
      await assert.rejects(()=>h.cardConfirm({type:"card",id,index:0,target:null},board([id])));
      assert.equal(inputs.length,1,"wrong card scope cannot pay again");
    }
  });
  await test("ailin: last Autumn Frost admits native HP11 before commit, then books the maximum once",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"last-autumn");
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);assert.equal(f.p.memory.extraMaxHp[1],1);
    assert.equal(f.events.find(e=>e.event==="confirmed").data.after.characters[1].hp,11);
    assert.equal(f.h.pendingMaxHpAllowance(1),0,"finished session cannot widen another action's range");
    assert.equal(f.drags.length,1);assert.equal(f.h.confirmationSession,null);
    const h=new C.TCGBetterGI.BetterGIHost({}),s=board(["autumnFrost"],1),a={type:"card",id:"autumnFrost",index:0,target:1};
    h.memory=memory();h.matches=()=>[];h.localOcr=(_f,area)=>area.rect[0]===864&&area.rect[1]===600?"11":"";
    assert.equal(h.characterIn({},1).hp,null);
    h.confirmationSession={key:T.actionKey(a)+"/"+T.boardKey(s),plan:{action:a,before:s}};
    h.consumptionReceipt={id:a.id,index:0,target:1,inputSent:true,beforeKey:T.boardKey(s)};
    assert.equal(h.characterIn({},1).hp,11);
    h.consumptionReceipt.beforeKey="stale";assert.equal(h.characterIn({},1).hp,null);
  });
  await test("ailin: last Soup traverses actual choice labels, bound exit, discount booking and one-die shot",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"last-soup");
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);assert.equal(f.p.memory.soupDiscount[1],2);
    const receipt=f.events.find(e=>e.event==="confirmed").data.after.soupReceipt;
    assert.equal(receipt.effect,"discount");assert.equal(receipt.target,1);assert.equal(receipt.exited,true);
    assert.equal(f.h.choiceSession,null);assert.equal(f.h.pendingChoiceCard,null,"Soup does not generate a hand card");
    await f.p.act();
    assert.equal(f.events.filter(e=>e.event==="decision")[1].data.skill,"CA");
    assert.equal(f.stage(),2);assert.equal(f.p.memory.soupDiscount[1],0);assert.equal(f.p.memory.props,1);
    assert.equal(f.events.filter(e=>e.event==="choice-confirm-clicked").length,1);
    assert.equal(f.drags.length,1);
  });
  await test("ailin: last M uses real target session, one select and confirm, native refund/heal and next attack",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"last-M");
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);assert.equal(f.drags.length,1);
    const action=f.events.find(e=>e.event==="decision").data;
    assert.equal(action.id,"blessingM");assert.equal(action.summonIndex,1);
    const after=f.events.find(e=>e.event==="confirmed").data.after;
    assert.equal(after.summonReceipt.exited,true);assert.equal(after.summonReceipt.index,1);
    assert.equal(after.characters[2].hp,10);assert.equal(after.hand.length,0);
    assert.equal(after.dice.Pyro,1);assert.equal(after.dice.Geo,1);
    assert.equal(after.summons.length,1);assert.equal(after.summons[0].name,"厨艺机关·低温冷藏模式");
    assert.equal(f.h.choiceSession,null);
    assert.deepEqual(f.clicks.filter(([x,y])=>y===680||x===960&&y===945),[[1630,680],[960,945]]);
    await f.p.act();
    const next=f.events.filter(e=>e.event==="decision")[1].data;
    assert.equal(next.type,"skill");assert.equal(next.skill,"NA","different native refund colors cannot become two predicted Pyro dice");
    assert.equal(f.stage(),2);assert.equal(f.drags.length,1);
    assert.equal(f.events.filter(e=>e.event==="summon-target-confirmed").length,1);
  });
  await test("ailin: pending M resumes without a second target click; an already selected target is not double-clicked",async()=>{
    for(const options of [{delayMConfirmMs:8000},{initialMSelection:1}]){
      const f=require("./native-boundary.cjs")(loadContext,"last-M",options);
      await f.p.act();assert.equal(f.p.actions,1);assert.equal(f.stage(),1);
      assert.equal(f.clicks.filter(([,y])=>y===680).length,options.initialMSelection===1?0:1);
      assert.equal(f.events.filter(e=>e.event==="summon-target-confirmed").length,1);
      if(options.delayMConfirmMs)assert.ok(f.events.some(e=>e.event==="choice-deferred"));
      assert.equal(f.drags.length,1);assert.equal(f.h.choiceSession,null);
    }
  });
  await test("ailin: complete packaged auto-start reaches real run admission, E confirmation, booking and next decision",async()=>{
    const vm=require("node:vm"),{packageFiles}=require("../../../../tools/build.cjs"),pack=packageFiles("ailin"),events=[],
      stopAfterNextDecision=new Error("bounded raw-boundary fixture ends after next decision");
    let running,decisions=0;
    const loader=overrides=>{
      const p=require("../../../../players.json").players.ailin;
      const env=vm.createContext({log:{info(){},warn(){},error(){}},settings:{deck:p.title+"（"+p.label+"）",actionEntry:"确认新开局未行动"},...overrides,
        file:{createDirectory(){},isExists(){return false;},
          readTextSync(name){if(!pack.files.has(name))throw Error("Unexpected runtime file: "+name);return pack.files.get(name).toString();},
          writeTextSync(_path,text){for(const line of text.trim().split("\n")){
            const row=JSON.parse(line);if(!row.event)continue;events.push(row);
            if(row.event==="decision"&&++decisions===2)throw stopAfterNextDecision;
          }return true;}}});
      // Execute the actual final auto-start IIFE, not just definitions or an
      // alternate test entry. Its first awaited capture lets us attach only
      // the scripted native OCR/CV boundary before it reads a phase.
      running=vm.runInContext(pack.files.get("main.js").toString(),env,{filename:"ailin-auto-start/main.js"});
      return env;
    };
    const f=require("./native-boundary.cjs")(loader,"main-entry");
    for(const method of ["findOcr","localOcr","matches","artworkScore"])
      f.c.TCGBetterGI.BetterGIHost.prototype[method]=f.h[method];
    await assert.rejects(()=>running,e=>e===stopAfterNextDecision);
    assert.equal(events.find(e=>e.event==="fresh-action-hand-verified").data.count,7);
    assert.ok(events.some(e=>e.event==="capture-ready"));
    const first=events.find(e=>e.event==="decision").data;
    assert.equal(first.type,"skill");assert.equal(first.who,0);assert.equal(first.skill,"E");
    const committed=events.find(e=>e.event==="confirmed").data;
    assert.equal(committed.memory.used[0],1);assert.equal(committed.memory.coldSummon,2);
    assert.equal(committed.after.dice.Omni,5);assert.equal(committed.after.hand.length,7);
    assert.equal(decisions,2);assert.equal(f.stage(),1);
    assert.deepEqual(f.clicks.filter(([,y])=>y===957),[[1716,957],[1716,957]]);
    assert.equal(events.filter(e=>e.event==="input-submitted").length,1);
  });
  await test("ailin: native support slots bind new Chef, release cooking/Silver once, then admit the next partner",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"support-life");
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);
    assert.equal(f.p.memory.supportSlots,4);assert.equal(f.p.memory.supportStateKnown,true);
    assert.equal(f.p.memory.supports.find(s=>s.id==="chef").slot,3);
    assert.equal(f.p.memory.supports.find(s=>s.id==="cooking").remaining,1);
    assert.equal(f.p.memory.supports.find(s=>s.id==="silver").elementCount,3);
    f.advanceSupportSettlement();f.T.nextRound(f.p.memory);
    // This bounded fixture jumps over Player.run's non-board phase and
    // Host.roll. Apply their round invalidation instead of relying on the
    // former redundant post-Chef draw refresh to discard the old snapshot.
    f.p.readyState=null;f.h.invalidateHand("new-round-draw-order-unknown");
    f.h.boardReady=false;f.h.lastObservedAt=0;f.h.lastObservedRevision=-1;
    const state=await f.p.observe();
    assert.equal(f.p.memory.supportSlots,2);assert.equal(f.p.memory.disposedSupports,2);
    assert.equal(f.p.memory.supports.some(s=>["cooking","silver"].includes(s.id)),false);
    f.T.noteBoard(f.p.memory,state);assert.equal(f.p.memory.disposedSupports,2,"same observed departure cannot be booked twice");
    const next=f.T.choose(state,f.p.memory);
    assert.equal(next.type,"card");assert.equal(next.id,"silver");
    assert.equal(f.T.size(f.T.cardCost(next.id,null,f.p.memory)),0);
    assert.equal(f.drags.length,1);
  });
  await test("ailin: optional availability gaps do not block unrelated input or fabricate stable facts; positive changes still wait",async()=>{
    const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({}),b=board(["blessingM","silver"]);
    b.summonCountKnown=true;b.summonCount=1;b.enemySummonCount=0;
    b.summons=[{index:0,present:true,name:"半幻人",uses:2,point:[1460,680]}];
    b.summonLayout={own:clone(b.summons),enemy:[]};
    b.supportCounts={source:"native-support-rims",known:true,count:1,slots:[{index:0,present:true,counter:1}]};
    const gap=clone(b);gap.summonLayout.own[0]={index:0,present:null};gap.summonCountKnown=false;
    gap.summons=[];gap.supportCounts.slots[0].counter=null;
    let reads=0;h.boardReady=true;h.autoRisk=true;h.prepareBoardObservation=()=>{};
    h.board=()=>clone(reads++%2?b:gap);
    const observed=await h.settledBoard();
    assert.equal(reads,2,"core-stable availability gaps need no twelve-read retry");
    assert.equal(observed.summonCountKnown,false);assert.equal(observed.supportCounts.known,false);
    const m=memory();T.noteBoard(m,observed);
    assert.equal(m.coldSummon,null);assert.equal(m.supportStateKnown,false);
    assert.equal(m.disposedSupports,0,"an inconsistent optional read cannot dispose remembered support");
    assert.equal(T.cardLegal(observed,{type:"card",id:"silver",index:1,target:null},m),false);
    assert.equal(T.cardLegal(observed,{type:"card",id:"blessingM",index:0,target:null,summonIndex:0,summonName:"半幻人"},m),false);
    reads=0;await h.requireUnchangedBoard(b,{type:"skill",who:0,skill:"E"});assert.equal(reads,1);
    h.board=()=>clone(gap);
    for(const action of [{type:"card",id:"silver"},{type:"card",id:"blessingM"}])
      await assert.rejects(()=>h.requireUnchangedBoard(b,action),e=>e.code==="TCG_STATE_REFRESH");
    const changed=clone(b);changed.summonLayout.own[0].uses=1;changed.summons[0].uses=1;
    reads=0;h.autoRisk=true;h.board=()=>clone([b,changed,changed][Math.min(reads++,2)]);
    const settled=await h.settledBoard();assert.equal(reads,3);assert.equal(settled.summons[0].uses,1);
    for(const change of [s=>s.characters[0].hp--,s=>s.dice.Omni--,s=>s.summonLayout.own[0].uses--,s=>s.supportCounts.slots[0].present=false]){
      const fresh=clone(b);change(fresh);h.board=()=>fresh;
      await assert.rejects(()=>h.requireUnchangedBoard(b,{type:"skill",who:0,skill:"E"}),e=>e.code==="TCG_STATE_REFRESH");
    }
    h.board=()=>({...clone(b),phase:"choice",turn:"none"});
    await assert.rejects(()=>h.requireUnchangedBoard(b,{type:"tune"}),e=>e.code==="TCG_OBSERVATION_INTERRUPTED");
    assert.equal(inputs.length,0);
  });
  await test("ailin: slot01 paid development cannot consume the last funded attack; zero-cost and refunded preparation remain available",()=>{
    // Native 2026-10-23T06:28:14.898Z: Gambler then Dunyarzad spent 3 dice
    // down to 1 before any attack; unknown defense is not a guaranteed kill.
    const s=board(["gambler","dunyarzad","toss","toss","blessingM"],1),m=memory();
    s.dice={Hydro:2,Cryo:1};s.characters[1].hp=6;s.characters[1].energy=2;
    s.enemies=[9,10,1].map((hp,i)=>({hp,dead:false,active:i===2,aura:i===2?["Pyro"]:[],auraKnown:i===2}));
    m.round=2;m.used=[1,2,0];m.artifactKinds[1]="heart";
    m.coldSummon=m.catSummon=null;m.summonsKnown=false;
    const original=JSON.stringify([s,m]),a=T.choose(s,m);
    assert.equal(a.type,"tune");assert.equal(a.followup.type,"skill");
    assert.ok(a.value>0);assert.equal(T.damageEstimate(s,m,1,"Q").guaranteed,null);
    assert.equal(JSON.stringify([s,m]),original);
    // A known boar refund or a native discount keeps the attack payable.
    m.boar=1;assert.equal(T.choose(s,m).id,"gambler");m.boar=0;
    m.foodDiscount[1]=1;assert.equal(T.choose(s,m).id,"gambler");m.foodDiscount[1]=0;
    const poor={...s,dice:{Hydro:2}};assert.equal(T.choose(poor,m).id,"gambler","without any funded attack, no artificial reservation");
    const free=board(["heart"],1);free.characters[1].hp=8;free.dice={Pyro:3};
    assert.equal(T.choose(free,memory()).id,"heart","known zero-cost output preparation stays legal");
    const refused=clone(m);for(const skill of Object.keys(T.team[1].skills))T.rejectAction(refused,{type:"skill",who:1,skill},s);
    assert.equal(T.choose(s,refused).id,"gambler","reservation cannot re-enable refused output");
  });
  await test("ailin: optional gaps preserve combat corroboration and post-hand observation completeness",async()=>{
    let time=0;class Clock extends Date{static now(){return time;}}
    const c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;}}),h=new c.TCGBetterGI.BetterGIHost({}),b=board();
    b.summonCountKnown=true;b.summonLayout={own:[{index:0,present:true,uses:1,name:"怪笑猫猫帽"}],enemy:[]};b.summons=clone(b.summonLayout.own);
    const gap=clone(b);gap.summonCountKnown=false;gap.summonLayout.own[0]={index:0,present:null};gap.summons=[];
    let reads=0;h.prepareBoardObservation=()=>{};h.board=()=>clone(reads++%2?b:gap);h.autoRisk=true;
    const settled=await h.settledBoard();assert.equal(reads,2);assert.equal(time,400);
    assert.equal(settled.summonCountKnown,false);assert.equal(h.autoRisk,false);
    // Expensive no-input hand read uses a NEW board sample, not old extras.
    h.initialObservationBoard=()=>null;h.settledBoard=async()=>clone(b);
    h.observedHand=async()=>{time+=701;return [];};h.board=()=>clone(gap);
    h.diceBudgetMatches=()=>true;h.acceptHand=()=>{};h.memory=memory();
    const after=await h.observe();assert.equal(after.summonCountKnown,false);
    assert.deepEqual(clone(after.summons),[]);assert.equal(T.legalState(after),true);
  });
  await test("ailin: native untunable attachment rejects before dragging, without assuming all generated dishes are untunable",async()=>{
    const c=loadContext(),h=new c.TCGBetterGI.BetterGIHost({}),s=board(["autumnFrost","gambler"]),m=memory(),
      a={type:"tune",id:"autumnFrost",index:0,element:"Cryo"};
    let resets=0,drags=0,reads=0,rows=["附着效果状态","电击","不可调和"];
    h.frame=fn=>fn({});h.reset=async()=>{resets++;};
    h.ocrRows=()=>{reads++;return rows.map(text=>({text}));};
    h.executeInput=async()=>{h.readSelectedCardFacts({},T.byId.autumnFrost);drags++;};
    await assert.rejects(()=>h.execute(a,s,m),e=>e.code==="TCG_INPUT_REJECTED");
    assert.equal(resets,1);assert.equal(drags,0);assert.equal(h.consumptionReceipt,null);
    T.rejectAction(m,a,s);assert.equal(T.actionRefused(s,m,a),true);
    assert.equal(T.actionRefused(s,m,{type:"card",id:a.id,index:0,target:0}),false,"tuning prohibition is not a food-use prohibition");
    h.currentAction={type:"card",id:a.id,index:0,target:0};h.readSelectedCardFacts({},T.byId.autumnFrost);
    assert.equal(reads,1,"ordinary cards do not acquire extra attachment OCR");
    h.currentAction=a;rows=["附着效果状态","电击"];h.readSelectedCardFacts({},T.byId.autumnFrost);
    rows=["不可调和"];h.readSelectedCardFacts({},T.byId.autumnFrost);
    h.currentAction={...a,id:"gambler",index:1};rows=["附着效果状态","不可调和"];
    assert.throws(()=>h.readSelectedCardFacts({},T.byId.gambler),e=>e.code==="TCG_NATIVE_REJECTION");
    const f=require("./native-boundary.cjs")(loadContext,"left-tune"),ocr=f.h.findOcr;
    f.h.findOcr=(frame,rect,multiple)=>multiple&&rect[0]===680&&rect[1]===100?
      ["附着效果状态","不可调和"].map((text,i)=>({text,x:790,y:130+i*70,w:150,h:30})):ocr(frame,rect,multiple);
    await f.p.act();
    assert.equal(f.drags.length,0,"real title -> attachment -> rejection pipeline stops before tuning drag");
    assert.equal(f.events.filter(e=>e.event==="input-submitted").length,0);
    const state=await f.p.observe();assert.equal(f.T.actionRefused(state,f.p.memory,{type:"tune",id:"dragon",index:0,element:"Cryo"}),true);
  });
  await test("ailin: refusing one M target does not forbid another real half-tulpa",()=>{
    const m=memory(),s=board(["blessingM"],1);
    s.summonCountKnown=true;s.summonCount=2;s.enemySummonCount=0;
    s.summons=[0,1].map(index=>({index,name:"半幻人",uses:2,point:[1460+170*index,680]}));
    const a={type:"card",id:"blessingM",index:0,target:null,summonIndex:0,summonName:"半幻人"};
    T.rejectAction(m,a,s);assert.equal(T.actionRefused(s,m,a),true);
    const other={...a,summonIndex:1};assert.equal(T.actionRefused(s,m,other),false);
    assert.ok(T.candidates(s,m).some(x=>x.id==="blessingM"&&x.summonIndex===1));
    s.summons[0].uses=1;assert.equal(T.actionRefused(s,m,a),false,"a changed native target can be reconsidered");
  });
  await test("ailin: fixed-slot badges preserve occupied supports when their rim misses; conflicts cannot authorize discount",()=>{
    const h=new C.TCGBetterGI.BetterGIHost({}),m=memory();h.memory=m;
    h.matches=()=>[];h.localOcr=(_f,area)=>area.rect[0]===350&&area.rect[1]===575&&area.rect[2]===80&&area.rect[3]===90?"2":"";
    let native=h.supportSlotsIn({});assert.equal(native.known,true);assert.equal(native.slots[0].present,true);
    T.noteBoard(m,{...board(),supportCounts:native});
    assert.equal(m.supportStateKnown,true);assert.equal(m.supports.length,1);assert.equal(m.disposedSupports,0);
    h.memory=null;assert.equal(h.supportSlotsIn({}).slots[0].present,true,"current badge does not depend on remembered identity");
    h.matches=(_f,asset,area)=>asset==="hand_rim"&&area.rect[0]===475||area.rect[1]===783?[{x:530,y:620}]:[];
    native=h.supportSlotsIn({});assert.equal(native.count,4);T.noteBoard(m,{...board(),supportCounts:native});
    assert.equal(m.supportStateKnown,false,"unowned occupied slots remain unknown identities, not empty space");
    const full=board(["silver"]),a={type:"card",id:"silver",index:0,target:null};
    assert.equal(T.cardLegal(full,a,m),false,"neither unknown identities nor four occupied slots authorize a fifth support");
    m.supportStateKnown=true;assert.equal(T.cardLegal(full,a,m),false);
    h.matches=(_f,_asset,area)=>area.rect[0]===305?[{x:350,y:620},{x:370,y:620}]:[];
    h.localOcr=()=>"";native=h.supportSlotsIn({});assert.equal(native.known,false);
    T.noteBoard(m,{...board(),supportCounts:native});assert.equal(m.supports.length,1);
    m.supports.push({id:"dunyarzad",slot:1,discountRound:-1});
    assert.equal(T.size(T.cardCost("silver",null,m)),1,"unknown supports cannot authorize discount");
  });
  await test("ailin: current support-specific edge proves presence without counter or memory; contradictory edges remain unknown",()=>{
    const h=new C.TCGBetterGI.BetterGIHost({});h.numericAt=()=>"";
    h.matches=(_f,asset,area)=>asset==="ailin/support-rim"&&area.rect[0]===412&&area.rect[1]===585?[{x:419,y:620}]:[];
    let native=h.supportSlotsIn({});assert.equal(native.known,true);
    assert.deepEqual(Array.from(native.slots,s=>s.present),[false,true,false,false]);
    h.matches=(_f,asset,area)=>asset==="ailin/support-rim"&&area.rect[0]===412&&area.rect[1]===585?[{x:413,y:620},{x:430,y:620}]:[];
    native=h.supportSlotsIn({});assert.equal(native.known,false);assert.equal(native.slots[1].present,null);
  });
  await test("ailin: Tulpa E/Q consume observed summon outcomes, healing and next choice, never predicted HP",async()=>{
    for(const skill of ["E","Q"]){
      const f=require("./native-boundary.cjs")(loadContext,"tulpa-"+skill);
      await f.p.act();
      const decision=f.events.find(e=>e.event==="decision").data;
      assert.equal(decision.who,2);assert.equal(decision.skill,skill);assert.equal(f.p.actions,1);
      const after=f.events.find(e=>e.event==="confirmed").data.after;
      assert.equal(after.characters[2].hp,skill==="E"?7:8);
      assert.equal(after.summons.some(s=>s.name==="半幻人"),false);
      assert.equal(after.summons.find(s=>s.name==="厨艺机关·低温冷藏模式").uses,skill==="E"?2:1);
      assert.equal(f.p.memory.coldSummon,skill==="E"?2:1);
      assert.equal(f.p.memory.talentColdUsed,false,"E/Q are not normal attacks");
      await f.p.act();
      assert.equal(f.events.filter(e=>e.event==="decision")[1].data.who,2);
      assert.equal(f.stage(),2);
    }
  });
  await test("ailin: real replacement dispatch reads native death, selects Tulpa, confirms and plans again",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"replacement");
    await f.p.replacement();
    assert.equal(f.stage(),1);assert.equal(f.h.forcedPickSession,null);
    assert.deepEqual(f.clicks,[[1175,720],[1175,720]]);
    assert.deepEqual(clone(f.p.memory.defeated),[true,true,false]);
    const state=await f.p.observe(),next=f.T.choose(state,f.p.memory);
    assert.equal(state.active,2);assert.equal(next.type,"skill");assert.equal(next.who,2);
  });

  await test("ailin: leftmost five/four-card tunes traverse actual input, unique native buttons, consumption and next skill",async()=>{
    const f=require("./native-boundary.cjs")(loadContext,"left-tune");
    await f.p.act();await f.p.act();
    assert.equal(f.p.actions,2);assert.equal(f.stage(),2);
    const decisions=f.events.filter(e=>e.event==="decision").map(e=>e.data);
    assert.ok(decisions.every(a=>a.type==="tune"&&a.index===0&&a.element==="Cryo"));
    assert.deepEqual(f.drags.map(d=>d.to),[[1867,518],[1867,518]]);
    assert.equal(f.drags[0].from[0],719);assert.equal(f.drags[1].from[0],812);
    assert.equal(f.events.filter(e=>e.event==="button-clicked"&&e.data.asset==="元素调和").length,2);
    const confirmed=f.events.filter(e=>e.event==="confirmed");
    assert.equal(confirmed[0].data.after.hand.length,4);assert.equal(confirmed[1].data.after.hand.length,3);
    assert.equal(confirmed[1].data.after.dice.Cryo,3);
    const state=await f.p.observe(),next=f.T.choose(state,f.p.memory);
    assert.equal(next.type,"skill");assert.equal(next.who,0);assert.equal(next.skill,"E");
    assert.equal(f.drags.length,2,"each confirmed tune is sent once");
  });
}
module.exports=run;
if(require.main===module)(async()=>{
  const results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(name+": "+e.stack);}},
    root?undefined:overrides=>require("../../../business/runtime.cjs").load("ailin",overrides).env);
  const result={at:new Date().toISOString(),scope:"assembled production rules and scripted native boundary; not native gameplay",passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  const report=process.env.TCG_TEST_REPORT||path.resolve(__dirname,"../../../../reports/ailin-development-20261022/targeted.json");
  fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({passed:result.passed,failed:result.failed}));if(result.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
