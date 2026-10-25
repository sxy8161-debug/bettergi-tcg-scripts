"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {base,packageFiles,sha}=require("../../../../tools/build.cjs");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
const defaultLoad=overrides=>root?load(root,overrides):require("../../../business/runtime.cjs").load("consecrated",overrides).env;

// Use the same standalone main.js as the ordinary full-regression runner.
// Controlled observations are not pixel or native-game acceptance.
async function run(test,loadContext=defaultLoad) {
  const loadRules=(overrides={})=>{
    const context=loadContext({log:{info(){},warn(){},error(){}},
      file:{createDirectory(){},readTextSync:()=>JSON.stringify({name:"consecrated",version:"test"})},...overrides});
    return {T:context.TCG,Host:context.TCGBetterGI.BetterGIHost,Player:context.TCGPlayer.Player,
      options:context.TCGPlayer.playerOptions,recognitionClasses:()=>context.TCGHandRecognition.classes(context,
        {scoreFloor:.90,runnerUpGap:.20,entries:[],patches:[]})};
  };
  const T=loadRules().T;
  const hand=ids=>ids.map((id,i)=>({...T.observedCard(T.byId[id].name,i),
    attachments:{source:"native",reduction:0,increase:0}}));
  const board=(ids=[],active=1)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},hand:hand(ids),
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:60,active:true,dead:false}]});
  const memory=()=>T.freshMemory({newGame:true});
  await test("fixed catalog, share-code receipt and exact guide mulligan",()=>{
    const decoded=require("./share-code.cjs");
    assert.equal(T.shareCode,decoded.shareCode);assert.equal(decoded.filtered,false);
    assert.deepEqual(clone(T.team.map(c=>c.gameId)),decoded.characters);
    const actual=Object.fromEntries(T.cards.filter(c=>c.copies).map(c=>[c.gameId,c.copies]));
    assert.deepEqual(actual,decoded.cardCounts);
    assert.equal(T.cards.reduce((sum,c)=>sum+c.copies,0),30);
    for(const c of T.cards)assert.equal(T.identify(c.name)?.id,c.id);
    assert.equal(T.openingActive,1);
    assert.deepEqual(clone(T.openingPlan(hand(["harbor","harbor","sand","stars","scorpionTalent"]),Array(5).fill(false)).replace),
      [false,false,false,true,true]);
    assert.equal(T.keepOpening("adeptus"),false);assert.equal(T.keepOpening("countdown2"),false);
  });
  await test("current serpent draw, energy and generated-deck effects exclude obsolete rules",()=>{
    const s=board(["block","block","block","block"]),m=memory();
    const e=T.skillEffects(1,"E",s.hand,m);
    assert.equal(e.draw,1);assert.equal(e.energyGain,1);
    const q=T.skillEffects(1,"Q",s.hand,m);
    assert.equal(q.energyCost,2);assert.equal(q.discardedBlocks,4);assert.equal(q.rawDamage,8);
    assert.equal(T.skillEffects(0,"Q",s.hand,m).trap.uses,3);
    assert.equal(T.skillEffects(0,"E",s.hand,m).pileBlocks.placement,"top-2");
    assert.equal(T.skillEffects(2,"E",s.hand,m).rawDamage,3);
    assert.equal(T.skillEffects(2,"Q",s.hand,m).rawDamage,4);
    assert.equal(T.passiveEffects(s,"battle-start").handBlocks,0);
    assert.equal(T.passiveEffects(s,"round-end").pileBlocks.count,2);
    s.characters[0].dead=true;assert.equal(T.passiveEffects(s,"round-end").pileBlocks,null);
    const a={who:1,skill:"E"};s.dice={Anemo:2,Pyro:1};assert.equal(T.skillLegal(s,a),false);
    a.skill="NA";assert.equal(T.skillLegal(s,a),true);
    s.characters[1].frozen=true;assert.equal(T.skillLegal(s,a),false);
  });
  await test("all three rapid talents accept living backend targets without requiring a skill",()=>{
    const s=board(),m=memory();s.characters[0].frozen=true;
    assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:0}),true);
    assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:1}),false);
    assert.equal(T.talentTargetLegal(s,{id:"crocodileTalent",target:2}),true);
    for (const [id,rule] of Object.entries(T.talents)) {
      const action={type:"card",id,index:0,target:rule.target},banner="装备给我方的"+T.team[rule.target].name;
      assert.equal(T.nativeCardScope(action,banner,s),true);
      assert.equal(T.nativeCardScope({...action,target:(rule.target+1)%3},banner,s),false);
    }
    s.active=2;s.characters[2].frozen=true;
    assert.equal(T.talentTargetLegal(s,{id:"crocodileTalent",target:2}),true);
    s.hand=hand(["crocodileTalent"]);s.dice={Electro:1};
    assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),false,"requires Hydro, not a free Pearl talent");
    s.dice={Hydro:1};assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),true);
    m.talents[2]=true;assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),true,"repeated rapid talent still generates its entry block");
    s.characters[0].dead=true;assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:0}),false);
    for(const c of T.cards.filter(c=>c.type==="talent"))assert.equal(c.combatSkill,undefined);
    assert.equal(T.stormterrorEligible({type:"card",id:"serpentTalent"}),true);
    assert.equal(T.stormterrorEligible({type:"skill",who:1,skill:"Q"}),false);
    assert.equal(m.talents[0],false,"rule check does not equip it");
  });
  await test("crocodile bottoming, burst and block healing keep their distinct triggers and native HP",()=>{
    const m=memory(),s=board(["countdown3","adeptus","block","block","block"],2);
    s.characters[1].hp=4;
    const snapshot=JSON.stringify([s,m]),e=T.skillEffects(2,"E",s.hand,m),q=T.skillEffects(2,"Q",s.hand,m);
    assert.equal(e.damageType,"Hydro");assert.equal(e.generatedBlocks,1);
    assert.deepEqual(clone(e.bottomHighest.indices),[0]);assert.equal(e.discardedBlocks,0);
    s.hand[0].attachments.reduction=1;
    assert.deepEqual(clone(T.skillEffects(2,"E",s.hand,m).bottomHighest.indices),[0,1]);
    delete s.hand[0].attachments;
    assert.equal(T.skillEffects(2,"E",s.hand,m).bottomHighest.known,false);
    assert.equal(q.rawDamage,4);assert.equal(q.discardedBlocks,3);
    assert.deepEqual(clone(q.healAndMaxHp),{amount:3,target:"most-injured"});
    assert.equal(T.blockHealing("play",s,m).triggers,1);
    m.talents[2]=true;assert.equal(T.blockHealing("play",s,m).triggers,2);
    for(const mode of ["tune","discard","burst-discard"])
      assert.equal(T.blockHealing(mode,s,m,3).triggers,3,"discard is passive-only even with talent");
    assert.equal(T.blockHealing("bottom",s,m,3).triggers,0);
    m.talents[2]=null;assert.equal(T.blockHealing("play",s,m).triggers,null);
    assert.equal(T.blockHealing("tune",s,m).triggers,1);
    s.characters[2].dead=true;assert.equal(T.blockHealing("play",s,m).triggers,0);
    assert.equal(s.characters[1].hp,JSON.parse(snapshot)[0].characters[1].hp,"trigger estimates never apply predicted healing");
    assert.equal(s.characters[1].maxHp,undefined,"do not manufacture a post-Q maximum HP");
  });
  await test("highest current cost includes every tie and unknowns; final payment is not discard cost",()=>{
    const h=hand(["block","countdown3","adeptus","block"]);
    h[1].currentCost=0;assert.equal(T.discardCost(h[1]),3,"payment discount does not change ranking");
    assert.deepEqual(clone(T.blockDiscards(h,0).indices),[1]);
    h[1].attachments.reduction=1;
    let r=T.blockRisk(h,0,["adeptus"]);
    assert.deepEqual(clone(r.indices),[1,2]);assert.equal(r.essentialAtRisk,true);
    assert.deepEqual(clone(r.outcomes[0].deckTop),{id:"countdown2",destination:"deck-top"});
    delete h[2].attachments;r=T.blockRisk(h,0);
    assert.equal(r.known,false);assert.equal(r.minimumBlocks,null);
    assert.deepEqual(clone(r.unknown),[2]);
    r=T.blockRisk(hand(Array(7).fill("block")),0);
    assert.equal(r.minimumBlocks,5,"7 -> 6 source consumption -> 5 random second block");
    assert.equal(T.blockRisk(hand(["block"]),0).outcomes[0].discardIndex,null);
    assert.equal(T.blockRisk(hand(["block"]),0).minimumBlocks,0);
  });
  await test("normal block, tuning, burst discard and bottoming have distinct triggers",()=>{
    const s=board(["block"]),m=memory();m.talents[0]=m.talents[1]=true;
    let e=T.blockEffects("play",s,m);
    assert.equal(e.energyGain,0);assert.equal(e.draw,1);assert.equal(e.generatedDice,1);assert.equal(e.armWind,true);
    for(const mode of ["tune","burst-discard"]){e=T.blockEffects(mode,s,m);assert.equal(e.generatedDice,0);assert.equal(e.usesPlayLimit,false);}
    m.blockPlayed=true;assert.equal(T.blockEffects("play",s,m),null);
    m.blockPlayed=false;s.characters[0].dead=true;assert.equal(T.blockEffects("play",s,m).draw,0);
    assert.equal(T.countdownDiscard("countdown3","bottom"),null);
    assert.equal(T.countdownDiscard("countdown3","play"),null);
    assert.equal(T.countdownDiscard("show","discard"),null);
  });
  await test("burst arithmetic protects parity, effective buffs and the 60 HP boundary",()=>{
    assert.equal(T.serpentBurstDamage(6,{emblem:false,adeptus:true,cleanup:0}),40);
    assert.equal(T.serpentBurstDamage(6,{emblem:true,adeptus:true,cleanup:0}),56);
    assert.equal(T.serpentBurstDamage(6,{emblem:true,adeptus:true,cleanup:1}),64);
    assert.equal(T.serpentBurstDamage(8,{emblem:true,adeptus:false,cleanup:0}),64);
    const m=memory();m.emblem[1]=true;m.emblemUsed[1]=true;
    assert.equal(T.skillEffects(1,"Q",hand(Array(6).fill("block")),m).rawDamage,16);
    assert.equal(T.serpentBurstDamage(6,{emblem:null,adeptus:true,cleanup:0}),null);
    assert.equal(T.serpentBurstDamage(5,{emblem:true,adeptus:true,cleanup:0}),28);
    const s=board();assert.equal(s.enemies[0].hp,60,"no predicted HP writes");
  });
  await test("round reset preserves persistent cleanup and switch discount, not food or wind refund",()=>{
    const m=memory();m.cleanup=2;m.freeSwitch=true;m.windRefund=true;m.blockPlayed=true;
    m.adeptus[1]=true;m.emblem[1]=true;m.emblemUsed[1]=true;
    T.nextRound(m);
    assert.equal(m.cleanup,2);assert.equal(m.freeSwitch,true);assert.equal(m.windRefund,false);
    assert.equal(m.adeptus[1],false);assert.equal(m.emblem[1],true);assert.equal(m.emblemUsed[1],false);
    assert.equal(m.blockPlayed,false);
    assert.equal(T.freshMemory().blockPlayed,null,"midgame is not a fresh-round proof");
  });
  await test("post-switch refund uses the crocodile's Hydro element and cannot fund the switch itself",()=>{
    const s=board(),m=memory();s.dice={};m.windRefund=true;
    assert.equal(T.switchBudget(s,2,m),null);
    s.dice={Electro:1};const p=T.switchBudget(s,2,m);
    assert.equal(p.cost,1);assert.equal(p.fast,false);assert.equal(p.refund.element,"Hydro");
  });
  await test("support capacity, instances and draw timing do not fabricate cards",()=>{
    const s=board();assert.equal(T.supportRoom(s),false);
    s.supportCounts={known:true,slots:Array.from({length:4},()=>({present:true}))};
    assert.equal(T.supportRoom(s),false);s.supportCounts.slots[2].present=false;assert.equal(T.supportRoom(s),true);
    assert.equal(T.libenCollection({Electro:3},0),1);assert.equal(T.libenCollection({Electro:1,Anemo:1,Omni:1},0),3);
    assert.equal(T.supportEvent({id:"liben",collected:3},"end-phase"),null);
    assert.equal(T.supportEvent({id:"liben",collected:3},"action-start").draw,2);
    assert.equal(T.supportEvent({id:"whiteGlove",remaining:2},"end-phase").draw,0);
    assert.equal(T.supportEvent({id:"whiteGlove",remaining:1},"end-phase").draw,1);
    assert.equal(T.supportEvent({id:"harbor",remaining:1},"end-phase").remaining,0);
    assert.equal(T.revelRefund(hand(["emblem","emblem"])),1);
    assert.equal(T.revelRefund(hand(["emblem"])),0);
    assert.equal(T.revelRefund([{id:"unsupported:未知武器",supported:false}]),null);
  });
  await test("same-count random effects always refresh the whole hand; simple removal preserves the other instance",()=>{
    const m=memory(),s=board(["block","emblem","emblem"]);s.hand=T.indexedHand(s.hand);
    const action=(id,index=0)=>({type:"card",id,index,target:null});
    for(const id of ["block","scorpionTalent","serpentTalent","crocodileTalent","sand","countdown3","revel","lair","nre"]){
      const b=board([id]);assert.equal(T.handPlan(action(id),b,m).mode,"full");
      if (["sand","countdown3","revel"].includes(id))
        assert.equal(T.handPlan(action(id),b,m).retainedHand,undefined,"unknown draws cannot reuse family stages");
    }
    const removed=T.handPlan({...action("emblem",1),target:1},s,m);
    assert.equal(removed.mode,"remove");assert.deepEqual(clone(removed.hand.map(c=>c.index)),[0,1]);
    assert.deepEqual(clone(removed.hand[1].instanceIds),clone(s.hand[2].instanceIds),"reindex positions, preserve original instance");
    assert.deepEqual(clone(T.sandExchangeCount(7)),{bottom:6,requestedDraw:7,discarded:0});
    const b=board(["adeptus"]);m.supportStateKnown=false;
    assert.equal(T.handPlan({...action("adeptus"),target:1},b,m).mode,"full");
    assert.equal(T.handPlan({type:"skill",who:1,skill:"Q"},s,m).mode,"full");
  });
  await test("block result checks full identities, highest-cost possibilities and the whole dice vector",()=>{
    const b=board(["block","countdown3","emblem","block"]),m=memory();
    m.talents[0]=true;
    const a={type:"card",id:"block",index:0},after=ids=>({...clone(b),hand:hand(ids),handRead:"full",dice:{Omni:8,Anemo:1}});
    assert.equal(T.blockResult(a,b,after(["emblem","block","countdown2"]),m),true);
    assert.equal(T.blockResult(a,b,after(["emblem","block","stars"]),m),true,"do not promise the drawn identity");
    assert.equal(T.blockResult(a,b,after(["emblem","block"]),m),true,"exhausted deck need not draw");
    assert.equal(T.blockResult(a,b,after(["countdown3","block","stars"]),m),false,"cannot discard the cheaper emblem");
    assert.equal(T.blockResult(a,b,after(["emblem","block","stars","draw"]),m),false,"cannot invent two draws");
    let c=after(["emblem","block","countdown2"]);c.dice={Omni:9};assert.equal(T.blockResult(a,b,c,m),false);
    c=after(["emblem","block","countdown2"]);c.handRead="remove";assert.equal(T.blockResult(a,b,c,m),false);
    c=after(["emblem","block","countdown2"]);c.active=0;assert.equal(T.blockResult(a,b,c,m),false);
    m.talents[0]=false;assert.equal(T.blockResult(a,b,after(["emblem","block","countdown2"]),m),false);
    const one=board(["block"]),last={...clone(one),hand:[],handRead:"full",dice:{Omni:8,Anemo:1}};
    assert.equal(T.blockResult(a,one,last,m),true,"source alone needs no second discard");
    const tied=board(["block","adeptus","emblem"]);m.talents[0]=true;
    assert.equal(T.blockResult(a,tied,{...after(["adeptus","stars"]),active:1},m),true);
    assert.equal(T.blockResult(a,tied,{...after(["emblem","stars"]),active:1},m),true);
  });
  await test("confirmed rules book only owned effects and never project native resources",()=>{
    const b=board(["scorpionTalent","block","cleanup","adeptus"]),m=memory();
    const after={...clone(b),confirmed:true},snapshot=JSON.stringify([b,after]);
    assert.throws(()=>T.commit(m,{type:"card",id:"scorpionTalent",index:0,target:0},b,{confirmed:false}),/未确认/);
    T.commit(m,{type:"card",id:"scorpionTalent",index:0,target:0},b,after);
    assert.equal(m.talents[0],true);assert.equal(m.used[0],0,"rapid talent never books a skill");
    m.talents[1]=true;
    T.commit(m,{type:"card",id:"block",index:1},b,after);
    assert.equal(m.blockPlayed,true);assert.equal(m.windRefund,true);
    T.commit(m,{type:"card",id:"cleanup",index:2},b,after);
    T.commit(m,{type:"card",id:"adeptus",index:3,target:1},b,after);
    assert.equal(m.cleanup,1);assert.equal(m.adeptus[1],true);
    m.emblem[1]=true;
    T.commit(m,{type:"skill",who:1,skill:"Q"},b,after);
    assert.equal(m.cleanup,0);assert.equal(m.emblemUsed[1],true);assert.equal(m.adeptus[1],false);
    assert.equal(m.used[1],1);
    assert.equal(JSON.stringify([b,after]),snapshot,"no HP/energy/hand/dice writes");
  });
  await test("rejected or unresolved actions do not consume unrelated effects or allow blind resend",()=>{
    const b=board(["block","emblem"]),m=memory();b.hand=T.indexedHand(b.hand);
    const a={type:"card",id:"block",index:0};m.cleanup=2;m.emblem[1]=true;m.freeSwitch=true;
    T.rejectAction(m,a,b);
    assert.equal(m.blockPlayed,false);assert.equal(m.cleanup,2);assert.equal(T.actionRefused(b,m,a),true);
    T.deferUncertain(m,a,b);
    assert.equal(m.blockPlayed,null);assert.equal(m.cleanup,2);assert.equal(m.emblem[1],true);assert.equal(m.freeSwitch,true);
    const changed=clone(b);changed.dice={Anemo:8};
    assert.equal(T.actionRefused(changed,m,a),true,"uncertain source stays blocked after unrelated resource change");
    T.nextRound(m);assert.equal(m.blockPlayed,false);assert.equal(m.cleanup,2);
    T.deferUncertain(m,{type:"skill",who:0,skill:"E"},b);
    assert.equal(m.cleanup,null);assert.equal(m.emblem[1],true);assert.equal(m.freeSwitch,true);
  });
  await test("same-name supports retain separate slot ownership, missing facts do not reconstruct occupancy",()=>{
    const m=memory(),b=board(["harbor","harbor"]);
    const slots=present=>({known:true,slots:present.map((value,index)=>({index,present:value,counter:value?2:null}))});
    b.supportCounts=slots([false,false,false,false]);
    const c={...clone(b),confirmed:true,supportCounts:slots([true,false,false,false])};
    T.commit(m,{type:"card",id:"harbor",index:0},b,c);
    assert.equal(m.supports[0].slot,0);assert.equal(m.supportStateKnown,true);
    const d={...clone(c),supportCounts:slots([true,true,false,false])};
    T.commit(m,{type:"card",id:"harbor",index:1},c,d);
    assert.equal(m.supports.length,2);assert.equal(m.supports[1].slot,1);
    d.supportCounts.slots[0].counter=1;T.noteBoard(m,d);
    assert.equal(m.supports[0].remaining,1);assert.equal(m.supports[1].remaining,2);
    T.noteBoard(m,{...d,supportCounts:{known:false}});assert.equal(m.supportStateKnown,false);
    assert.equal(m.supports.length,2);
    d.supportCounts.slots[0].present=false;T.noteBoard(m,d);assert.equal(m.supports.length,1);
    assert.equal(m.supports[0].slot,1);
    m.supports.push({id:"nre",slot:2,foodDrawUsed:true},{id:"lair",slot:3,remaining:1,discountUsed:true});
    T.nextRound(m);assert.equal(m.supports[1].foodDrawUsed,false);assert.equal(m.supports[2].discountUsed,false);
    assert.equal(m.supports[2].remaining,1);
  });
  await test("a compacted support row cannot relabel Liben and White Glove as the departed Harbors",()=>{
    const m=memory(),s=board();
    m.supports=[{id:"harbor",slot:0,remaining:1},{id:"harbor",slot:1,remaining:1},
      {id:"liben",slot:2,collected:2},{id:"whiteGlove",slot:3,remaining:2}];
    // Slot04 round4: occupied prefix2 with native counters2/1 after the two
    // one-use Harbors' end-phase departures. Occupancy does not prove names.
    s.supportCounts={known:true,slots:[2,1,null,null].map((counter,index)=>({index,present:counter!==null,counter}))};
    T.noteBoard(m,s);
    assert.equal(m.supportStateKnown,false);
    assert.equal(m.supports.some(x=>x.id==="harbor"),false,"new slot0/1 cannot replenish old Harbor uses");
    assert.equal(T.supportRoom(s),true,"current occupancy still permits a new support");
    s.supportCounts.slots.forEach(x=>{x.present=false;x.counter=null;});
    T.noteBoard(m,s);assert.equal(m.supportStateKnown,true,"an actually empty row has no unidentified supports");
  });
  await test("Lair discount attribution follows each native slot counter, not net dice",()=>{
    const m=memory(),b=board(["crocodileTalent"]),a={type:"card",id:"crocodileTalent",index:0,target:2},
      slots=counts=>({known:true,slots:counts.map((counter,index)=>({index,present:counter!==null,counter}))});
    m.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false},{id:"lair",slot:1,remaining:3,discountUsed:false}];
    b.supportCounts=slots([3,3,null,null]);
    const after={...board(["block"]),confirmed:true,supportCounts:slots([2,3,null,null])};
    T.commit(m,a,b,after);
    assert.equal(m.supports[0].discountUsed,true);assert.equal(m.supports[0].remaining,2);
    assert.equal(m.supports[1].discountUsed,false);assert.equal(m.supports[1].remaining,3);
    const missing=memory();missing.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    T.commit(missing,a,b,{...after,supportCounts:{known:false},dice:{Omni:7}});
    assert.equal(missing.supports[0].discountUsed,null,"net dice cannot attribute a missing native counter");
    assert.equal(missing.supports[0].remaining,null);
    const unknownBefore=memory();unknownBefore.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    T.commit(unknownBefore,a,{...b,supportCounts:{known:false}},after);
    assert.equal(unknownBefore.supports[0].discountUsed,null,"a current counter alone cannot assign this round's use");
    assert.equal(unknownBefore.supports[0].remaining,2,"the current native count remains a separate fact");
    const alreadyUsed=memory();alreadyUsed.supports=[{id:"lair",slot:0,remaining:2,discountUsed:true}];
    T.commit(alreadyUsed,a,{...b,supportCounts:slots([2,null,null,null])},
      {...after,supportCounts:slots([2,null,null,null])});
    assert.equal(alreadyUsed.supports[0].discountUsed,true,"a second talent with no counter change must not restore the discount");
    const spent=memory();spent.supports=[{id:"lair",slot:0,remaining:1,discountUsed:false}];
    const last={...b,supportCounts:slots([1,null,null,null])};
    T.commit(spent,a,last,{...after,supportCounts:slots([null,null,null,null])});
    assert.equal(spent.supports.length,0,"the last charge's native departure removes that instance");
  });
  await test("legal actions separate payment facts, backend talents and optional support occupancy",()=>{
    const s=board(["scorpionTalent","harbor","block"]),m=memory();s.characters[0].frozen=true;
    assert.equal(T.legalState(s),true);assert.equal(T.actionLegal(s,{type:"skill",who:1,skill:"E"},m),true);
    assert.equal(T.actionLegal(s,{type:"card",id:"harbor",index:1},m),false);
    assert.equal(T.actionLegal(s,{type:"card",id:"scorpionTalent",index:0,target:0},m),true);
    m.supportStateKnown=true;m.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    assert.equal(T.size(T.cardCost(s,{id:"scorpionTalent",index:0},m)),0);
    s.hand[0].currentCost=1;
    assert.equal(T.size(T.cardCost(s,{id:"scorpionTalent",index:0},m)),1,"native payable value is not discounted twice");
    assert.equal(T.discardCost(s.hand[0]),1,"Lair payment does not change discard ranking");
    s.dice={Anemo:1,Electro:1};s.supportCounts={known:true,slots:Array.from({length:4},()=>({present:false}))};
    assert.equal(T.cardLegal(s,{id:"harbor",index:1},m),false,"two unlike dice are not two aligned dice");
    delete s.hand[1].attachments;
    assert.equal(T.cardLegal(s,{id:"block",index:2},m),false,"unknown discard cost does not become zero");
    s.dice={Anemo:2};T.recordSkillCost(s,m,{who:1,skill:"E"},2);
    assert.equal(T.skillLegal(s,{who:1,skill:"E"},m),true);
    const different={...s,dice:{Electro:2}};assert.equal(T.skillLegal(different,{who:1,skill:"E"},m),false);
  });
  await test("block development keeps the worst tie and countdown transition separate from a known draw",()=>{
    const m=memory();m.talents[0]=true;
    const s=board([...Array(7).fill("block"),"countdown3"]);s.characters[1].energy=2;s.dice={};
    let a=T.choose(s,m);assert.equal(a.id,"block");
    assert.equal(a.plan,undefined,"random discard/draw is not followed by a queued countdown play");
    s.hand=hand(Array(7).fill("block"));a=T.choose(s,m);
    assert.notEqual(a.id,"block","seven blocks alone may lose two and halve the multiplier");
    s.hand=hand(["block","adeptus","emblem"]);a=T.choose(s,m);
    assert.notEqual(a.id,"block","a tied unique needed component is not selected for random loss");
  });
  await test("core death, forced active and known deadline produce affordable current actions",()=>{
    const m=memory(),s=board(["block","block","block"],0);s.characters[1]={hp:0,dead:true,energy:0,frozen:false};
    s.characters[0].energy=2;s.dice={Electro:3};let a=T.choose(s,m);
    assert.equal(a.type,"skill");assert.equal(a.who,0);assert.equal(T.actionLegal(s,a,m),true);
    const frozen=board([],1);frozen.characters[1].frozen=true;frozen.characters[1].energy=2;
    a=T.choose(frozen,m);assert.equal(a.type,"switch");assert.notEqual(a.target,1);
    const deadline=board(Array(4).fill("block"));deadline.characters[1].energy=2;deadline.dice={Anemo:3};
    deadline.roundLimit={source:"native",remaining:1};a=T.choose(deadline,m);
    assert.equal(a.skill,"Q","actual final round can justify an incomplete burst");
    delete deadline.roundLimit;a=T.choose(deadline,m);assert.notEqual(a.skill,"Q","no invented round limit");
  });
  await test("random food draw adds no projected resources but preserves the guaranteed buff and retained cards",()=>{
    const m=memory(),s=board([...Array(6).fill("block"),"adeptus"]);
    m.supportStateKnown=false;s.characters[1].energy=2;s.enemies[0].hp=40;s.dice={Anemo:3,Pyro:2};
    const next=T.projectPreparation(s,m,{type:"card",id:"adeptus",index:6,target:1});
    assert.equal(next.s.hand.length,6);assert.ok(next.s.hand.every(h=>h.id==="block"));assert.equal(next.m.adeptus[1],true);
    const a=T.choose(s,m);assert.equal(a.id,"adeptus");assert.ok(a.plan.estimate.raw>=40);
    assert.equal(s.hand.length,7);assert.equal(m.adeptus[1],false);
  });
  await test("near-full hands admit useful delayed supports and net-zero searches without bypassing actual support capacity",()=>{
    // Native slot03 rounds3/4 ended with7/8 dice and an empty support field.
    const s=board([...Array(5).fill("block"),"harbor","lair","shift","shift"],2),m=memory();
    s.characters[0]={hp:0,dead:true,energy:0,frozen:false};s.characters[1].energy=2;
    s.enemies[0].hp=24;s.dice={Hydro:1,Anemo:2,Dendro:1,Omni:3};
    s.supportCounts={known:true,slots:Array.from({length:4},(_,index)=>({index,present:false}))};
    m.talents=[false,true,true];m.blockPlayed=true;
    let a=T.choose(s,m);assert.equal(a.id,"harbor");assert.equal(T.actionLegal(s,a,m),true);
    s.hand.push(...hand(["revel"]).map(x=>({...x,index:9})));
    a=T.choose(s,m);assert.equal(a.id,"harbor","support leaves the hand now; its later draws are not immediate overflow");
    s.hand=hand([...Array(5).fill("block"),"lair","shift","shift","adeptus","emblem"]);
    s.enemies[0].hp=60; // No immediate Adeptus+Q finish competing with development.
    m.talents[2]=false;m.emblem[1]=true;
    a=T.choose(s,m);assert.equal(a.id,"lair","source consumption makes room for the single search draw");
    s.hand=hand([...Array(5).fill("block"),"whiteGlove","shift","shift","adeptus","emblem"]);
    a=T.choose(s,m);assert.equal(a.id,"whiteGlove","putting Cleanup in the deck is not an immediate hand draw");
    s.supportCounts.slots.forEach(x=>x.present=true);
    assert.notEqual(T.choose(s,m).id,"whiteGlove","never open the unsupported replacement page");
    s.supportCounts.known=false;
    assert.notEqual(T.choose(s,m).id,"whiteGlove","unknown support capacity remains unknown");
    s.supportCounts.known=true;s.supportCounts.slots.forEach(x=>x.present=false);
    s.roundLimit={source:"native",remaining:1};
    assert.notEqual(T.choose(s,m).id,"whiteGlove","known deadline still prioritizes current damage");
  });
  await test("a sole charged serpent can spend its incomplete burst instead of losing the candidate to ordinary reserve filtering",()=>{
    // Native slot03 round5: sole serpent6HP, enemy24HP, five blocks, three Omni.
    const s=board([...Array(5).fill("block"),"harbor","lair","shift","shift","revel"]),m=memory();
    s.characters[0]={hp:0,dead:true,energy:0,frozen:false};
    s.characters[2]={hp:0,dead:true,energy:0,frozen:false};
    s.characters[1].hp=6;s.characters[1].energy=2;s.enemies[0].hp=24;
    s.dice={Pyro:1,Dendro:1,Cryo:1,Geo:2,Omni:3};
    let a=T.choose(s,m);assert.equal(a.type,"skill");assert.equal(a.skill,"Q");
    assert.equal(a.plan.estimate.raw,8);assert.equal(T.actionLegal(s,a,m),true);
    assert.equal(a.plan.estimate.provenTargetDefeat,false,"incomplete burst is damage, not a claimed kill");
    s.characters[1].hp=2;a=T.choose(s,m);assert.equal(a.skill,"Q");
    s.characters[1].frozen=true;a=T.choose(s,m);assert.notEqual(a.skill,"Q");
  });
  await test("bad-hand exchange, zero-die retreat and no-Starsign charge have finite real resource routes",()=>{
    const m=memory(),s=board(["sand","adeptus","adeptus","emblem","emblem","serpentTalent","serpentTalent"]);
    s.characters[1].energy=2;s.dice={};let a=T.choose(s,m);
    assert.equal(a.id,"sand");assert.equal(a.choice,"sanctify");
    s.hand=hand(["shift"]);a=T.choose(s,m);assert.equal(a.id,"shift");
    s.hand=hand(["stars"]);s.characters[1].energy=1;s.characters[1].hp=2;s.dice={Pyro:2};
    a=T.choose(s,m);assert.equal(a.type,"switch","do not spend the only retreat die on nonlethal charge");
    s.hand=[];s.characters[1].energy=0;s.characters[1].hp=10;s.dice={Anemo:1,Pyro:2};
    a=T.choose(s,m);assert.equal(a.type,"skill");assert.equal(a.skill,"NA");
    s.hand=hand(["sand","draw","countdown3","revel"]);s.characters[1].energy=1;
    s.dice={Anemo:1,Electro:2,Dendro:2};s.enemies[0].hp=27;
    a=T.choose(s,m);assert.equal(a.skill,"NA","do not tune two extra useful cards solely to prefer E for charge");
    s.dice={Anemo:3,Electro:2};a=T.choose(s,m);
    assert.equal(a.skill,"E","equally direct E retains its damage and draw advantage");
  });
  await test("a charged serpent spends current output after the engine dies and keeps E first when E plus Q are payable",()=>{
    // Native slot04 round4: five blocks, food, eight dice; ordinary Q20 was
    // below enemy25 and no growth card could supply another block this turn.
    const s=board([...Array(5).fill("block"),"nre","sand","shift","adeptus"],2),m=memory();
    s.characters[0]={hp:0,dead:true,energy:0,frozen:false};s.characters[1].hp=8;
    s.characters[1].energy=2;s.characters[2].hp=7;s.enemies[0].hp=25;
    s.dice={Pyro:2,Hydro:2,Anemo:2,Geo:1,Omni:1};m.talents=[false,true,true];
    s.supportCounts={known:true,slots:[true,true,true,false].map((present,index)=>({present,index}))};
    const a=T.choose(s,m);assert.notEqual(a.type,"end");
    assert.equal(a.plan.terminal.who,1);assert.equal(a.plan.terminal.skill,"Q");
    assert.equal(T.actionLegal(s,a,m),true);assert.equal(s.hand.length,9);
    s.active=1;const cast=T.choose(s,m);assert.equal(cast.plan.terminal.skill,"Q");
    s.dice={Omni:8};assert.equal(T.choose(s,m).skill,"E","current dice can pay E then Q, so draw first before re-observing");
    s.dice={Anemo:3};s.characters[1].hp=3;
    assert.equal(T.choose(s,m).plan.terminal.skill,"Q","do not leave an incomplete charged burst unused just to rotate again");
    assert.equal(s.characters[1].energy,2,"drawing intent does not spend or add observed energy");
    s.characters[1].frozen=true;assert.notEqual(T.choose(s,m).skill,"E");
    s.characters[1].frozen=false;s.hand=hand([...Array(9).fill("block"),"stars"]);
    for(const h of s.hand)h.attachments.noTuning=true;
    assert.notEqual(T.choose(s,m).skill,"E","a full hand with no legal removal cannot justify an extra draw");
  });
  await test("useful block cycling requests missing discard facts without retrying unrelated board changes",()=>{
    const s=board(["block","countdown3"],0),m=memory();s.dice={};m.talents[0]=true;
    delete s.hand[1].attachments;
    const a=T.choose(s,m);assert.equal(a.type,"probe");assert.equal(a.scope,"card");
    assert.equal(a.index,1);assert.equal(a.dependency,0);
    m.probeKeys.push(a.key);s.characters[0].hp--;s.dice={Geo:1};
    assert.notEqual(T.choose(s,m).type,"probe","HP/dice do not justify repeating a failed detail read");
    s.hand[1].attachments={source:"native",reduction:1,increase:0};
    assert.equal(T.choose(s,m).id,"block","known current-cost ranking enables the existing block policy");
    m.blockPlayed=true;delete s.hand[1].attachments;
    assert.notEqual(T.choose(s,m).type,"probe","a used block cannot justify scanning the hand");
    m.blockPlayed=false;m.talents[0]=false;s.characters[0].hp=10;
    assert.notEqual(T.choose(s,m).type,"probe","no draw/heal/funding benefit means no speculative detail scan");
    m.talents[0]=true;m.probeKeys=[];
    T.rejectAction(m,{type:"card",id:"block",index:0,target:null},s);
    assert.equal(T.nextDiscardProbe(s,m,0),null,"native refusal must not be bypassed by a detail probe");
    m.refusedActions=[];s.hand[1]=T.observedCard("未支持的来客手牌",1);
    assert.equal(T.legalState(s),true);assert.equal(T.nextDiscardProbe(s,m,0),null,"unsupported printed cost stays unknown, not a parser crash");
    const burst=board([...Array(7).fill("block"),"draw"]),bm=memory();burst.dice={Anemo:2};
    burst.characters[1].energy=2;burst.enemies[0].hp=40;bm.adeptus[1]=true;delete burst.hand[7].attachments;
    assert.equal(T.choose(burst,bm).type,"probe","a possible current burst-funding route also deserves the missing cost read");
    burst.hand[7].attachments={source:"native",reduction:1,increase:0};
    assert.notEqual(T.choose(burst,bm).id,"block","reading a zero-cost tie can disqualify that optimistic funding route");
  });
  await test("food inventory follows confirmed consumption and bottoming without predicting searches",()=>{
    const m=memory(),seen=ids=>({...board(ids),handRead:"full"}),s=seen(["nre","adeptus","sand"]);
    T.noteBoard(m,s);assert.equal(m.foodInDeck,1);
    const use={type:"card",id:"adeptus",index:1,target:1},after={...seen(["nre","sand"]),confirmed:true};
    T.commit(m,use,s,after);assert.equal(m.foodInDeck,1,"used food leaves deck+hand, not the already separate deck count");
    T.noteBoard(m,after);assert.equal(m.foodInDeck,1,"the same completed observation cannot charge consumption twice");
    const drawn=seen(["nre","sand","adeptus"]);T.noteBoard(m,drawn);assert.equal(m.foodInDeck,0);
    const reset={type:"card",id:"sand",index:1,target:null,choice:"sanctify"};
    T.commit(m,reset,drawn,{...seen(["stars","block","liben"]),confirmed:true});
    assert.equal(m.foodInDeck,1,"self-bottoming returns the held food to deck, not the discard pile");
    const held=seen(["adeptus"]);T.noteBoard(m,held);assert.equal(m.foodInDeck,0);
    T.commit(m,{type:"tune",id:"adeptus",index:0,element:"Anemo"},held,{...seen([]),confirmed:true});
    assert.equal(m.foodInDeck,0);
    const unknown=T.freshMemory();T.noteBoard(unknown,seen([]));assert.equal(unknown.foodInDeck,null,"mid-match construction cannot claim original copies");
    const ready={...board(["nre","block","block","block","block"],0),dice:{Hydro:1},
      supportCounts:{known:true,slots:[0,1,2,3].map(index=>({index,present:false,counter:null}))}},stock=memory();
    ready.characters[1].energy=2;stock.blockPlayed=true;T.noteBoard(stock,ready);
    assert.equal(T.choose(ready,stock).id,"nre","maintained inventory reaches the actual nutrition-bag candidate");
    stock.foodRemaining=null;T.noteBoard(stock,ready);
    assert.notEqual(T.choose(ready,stock).id,"nre","unknown inventory cannot promise a food search");
  });
  await test("even block stock rejects a losing source before inspecting discard dependencies",()=>{
    // Native0.1.9 slot09 round3 repeatedly inspected an action it would reject
    // anyway: four blocks cannot be played without losing a burst pair.
    const s=board(["block","block","block","block","scorpionTalent","cleanup","sand","shift","shift","adeptus"],0),m=memory();
    m.talents=[true,false,true];s.dice={Pyro:2,Electro:1,Dendro:2,Geo:1,Omni:2};
    s.characters[1].energy=2;s.enemies[0].hp=25;
    for(const h of s.hand){delete h.attachments;h.currentCost=null;}
    const old=T.nextDiscardProbe;
    T.nextDiscardProbe=()=>{throw Error("unusable block play must not inspect a title");};
    try{assert.notEqual(T.choose(s,m).type,"probe");}finally{T.nextDiscardProbe=old;}
  });
  await test("surplus blocks fund continuation without postponing a current payable defeat",()=>{
    const s=board([...Array(6).fill("block"),"adeptus"]),m=memory();
    m.cleanup=2;m.emblem[1]=true;m.talents[1]=true;s.characters[1].energy=2;s.enemies[0].hp=23;
    const a=T.choose(s,m);
    assert.equal(a.id,"block","six blocks can give up a pair, still burst24, and fund two further E attacks");
    assert.equal(a.plan.followupDamage,6);assert.equal(a.plan.remainingDice,6);
    const next=T.projectPreparation(s,m,a);
    assert.equal(next.s.hand.filter(h=>h.id==="block").length,5);assert.equal(next.m.blockPlayed,true);
    assert.equal(next.m.windRefund,true);assert.equal(T.total(next.s.dice),9);
    s.hand=hand([...Array(4).fill("block"),"nre","sand","adeptus"]);s.characters[1].hp=5;
    s.dice={Omni:6};
    const short=T.choose(s,m);assert.equal(short.skill,"Q","a current defeat does not require a fixed follow-up damage target");
    const missing=board([...Array(6).fill("block"),"adeptus"]);missing.characters[1].energy=2;missing.enemies[0].hp=23;
    for(const h of missing.hand){delete h.attachments;h.currentCost=null;}
    assert.equal(T.choose(missing,m).type,"probe","unknown discard prices justify inspection for this concrete continuation funding opportunity");
  });
  await test("continuation funds colours from retained cards and gains energy before a later burst",()=>{
    const s=board([...Array(4).fill("block"),"sand","draw"]),m=memory();
    s.dice={Anemo:1,Hydro:4,Omni:1};s.characters[1].energy=1;s.enemies[0].hp=2;
    m.blockPlayed=true;
    const before=JSON.stringify([s,m]),route=T.projectionBudget.run(240,()=>({routes:T.attackRoutes(s,m)})).routes
      .find(r=>!r.conditional&&r.terminal.who===1&&r.terminal.skill==="NA");
    assert.ok(route.followupDamage>=6);
    assert.equal(JSON.stringify([s,m]),before,"planning cannot consume observed hand or charge");
  });
  await test("native0113 late preceding-skill energy cannot confirm the next unpaid attack",()=>{
    const {before,action:a,after}=clone(require("../../../business/fixtures/player-native-regressions-20261025.json").consecratedLateEnergy);
    assert.equal(a.skill,"NA");assert.equal(T.total(after.dice),T.total(before.dice));
    assert.ok(after.characters[2].energy>before.characters[2].energy);
    assert.equal(T.verify(a,before,after),false,"no dice paid: the old E energy is not this NA's proof");
    const paid={...clone(after),dice:clone(T.payment(before.dice,T.skillCost(2,"NA")).remaining)};
    assert.equal(T.verify(a,before,paid),true,"real payment still confirms a hit with no visible HP difference");
    assert.equal(T.verify(a,before,{...paid,phase:"result",result:"win"}),true);
  });
  await test("food inventory keeps random-loss, overflow and unresolved outcomes unknown",()=>{
    const seen=ids=>({...board(ids),handRead:"full"}),a={type:"card",id:"block",index:0,target:null};
    const unique=memory(),b=seen(["block","adeptus","shift"]);T.noteBoard(unique,b);
    T.commit(unique,a,b,{...seen(["shift"]),confirmed:true});assert.equal(unique.foodInDeck,1);
    const tied=memory(),c=seen(["block","adeptus","stars"]);tied.talents[0]=true;T.noteBoard(tied,c);
    // A Scorpion draw could return the discarded identity, so this observation
    // alone cannot identify which tied highest-cost card left the total stock.
    T.commit(tied,a,c,{...seen(["adeptus","stars"]),confirmed:true});assert.equal(tied.foodInDeck,null);
    const full=memory();T.noteBoard(full,seen([]));T.noteBoard(full,seen(Array(10).fill("block")));
    assert.equal(full.foodInDeck,null,"unseen overflow may have burned food");
    const lost=memory();T.noteBoard(lost,seen(["adeptus"]));T.noteBoard(lost,seen([]));
    assert.equal(lost.foodInDeck,null,"unattributed disappearance is not an own discard or deck return");
    const pending=memory();T.noteBoard(pending,b);T.deferUncertain(pending,a,b);T.noteBoard(pending,seen([]));
    assert.equal(pending.foodInDeck,null);assert.equal(pending.foodRemaining,null);
    const refused=memory();T.noteBoard(refused,b);T.rejectAction(refused,a,b);T.noteBoard(refused,b);
    assert.equal(refused.foodInDeck,1,"a native rejection does not spend inventory");
  });
  function nativeFixture() {
    let time=Date.parse("2026-10-23T12:00:00Z"),scene={phase:"board",turn:"user"},options=[],buttons=[];
    const clicks=[],events=[];
    class Clock extends Date {static now(){return time;}}
    const loaded=loadRules({...nativeInput((...p)=>clicks.push(p)),Date:Clock,sleep:async ms=>{time+=ms;}}),N=loaded.T;
    const host=new loaded.Host({}),m=N.freshMemory({newGame:true});host.memory=m;
    host.trace=(event,data)=>events.push({event,data});
    host.phaseIn=f=>scene.phase==="choice"?host.choiceIn(f):clone(scene);
    host.ocr=(_f,{rect:r})=>r[1]===155?"挑选卡牌 请选择一张卡牌":"";
    host.ocrRows=(_f,{rect:r})=>r[1]===705?options:[];
    host.matches=(_f,asset)=>asset==="core/确定"?buttons:[];
    host.nativeHandCountIn=()=>2;
    return {T:N,host,m,clicks,events,setScene:s=>{scene=s;},setOptions:ids=>{
      options=ids.map((id,i)=>({text:N.byId[id].name,x:500+i*800,y:727,w:120,h:28}));
    },setButtons:b=>{buttons=b;}};
  }
  await test("crocodile burst widens only the sourced HP read bound, never assigns healing or maximum HP",()=>{
    const {T:N,host,m}=nativeFixture(),b=board(["block","block","block"],2),a={type:"skill",who:2,skill:"Q"};
    b.characters[2].energy=2;
    let raw="13",other="";
    host.has=()=>false;host.hpAt=(_f,_x,y)=>y===600?raw:other;
    host.matches=(_f,asset)=>asset==="uncharge"?[{},{}]:[];
    const read=()=>host.characterIn({},0).hp;
    assert.equal(read(),null,"no burst source: retain base HP bound");
    const key=N.actionKey(a)+"/"+N.boardKey(b);
    host.confirmationSession={key,submittedAt:null,plan:{action:a,before:b,mode:"full"}};
    assert.equal(read(),null,"planning is not submission");
    host.confirmationSession.submittedAt=1;
    assert.equal(read(),13,"post-input native 13 HP must not deadlock confirmation");
    host.confirmationSession.key="stale";assert.equal(read(),null);
    host.confirmationSession.key=key;
    raw="14";assert.equal(read(),null,"only three blocks can increase the bound");
    raw="";assert.equal(read(),null,"allowance cannot fill a missing HP reading");
    raw="13";other="10";assert.equal(read(),null,"two-position conflict remains unknown");other="";
    const after={...clone(b),confirmed:true};after.hand=[];after.characters[0].hp=12;
    const observed=JSON.stringify([b,after]);
    host.confirmationSession=null;N.commit(m,a,b,after);
    assert.equal(read(),13,"bound survives the completed confirmation session");
    N.nextRound(m);assert.equal(read(),13,"max-HP growth is not a round buff");
    assert.equal(JSON.stringify([b,after]),observed,"no predicted HP or max HP writes");
    assert.equal(m.extraMaxHp,undefined,"unknown recipient is not stored as actual max HP");
    N.initializeOpening(m);assert.equal(read(),null,"new match clears old growth allowance");
    N.rejectAction(m,a,b);assert.equal(read(),null,"native rejection adds no growth");
    N.deferUncertain(m,a,b);assert.equal(read(),13,"unresolved submitted Q retains only a possible bound");
    assert.equal(m.bursts[2],0,"possible growth is not a confirmed skill use");
    N.initializeOpening(m);b.hand=[];
    host.confirmationSession={key:N.actionKey(a)+"/"+N.boardKey(b),submittedAt:1,plan:{action:a,before:b}};
    assert.equal(read(),null,"no blocks: no growth allowance");
  });
  await test("actual card probe retains partial native facts and uses one inspection fan without committing",async()=>{
    const {T:N,host,m,events}=nativeFixture(),s=board(["block","countdown3","draw"],0);
    s.dice={};m.talents[0]=true;for(const h of s.hand)delete h.attachments;
    const selected=[];let index=-1,unread=false;
    host.requireUnchangedBoard=async()=>{};host.prepareHandInput=async()=>({count:3});
    host.handPoints=()=>[500,700,900];host.reset=async()=>{throw Error("one dependency batch must keep the selected fan");};
    host.selectedCardCostIn=()=>unread?null:index===1?2:1;
    host.ocrRows=(_f,{rect:r})=>(r[0]===270?["事件牌"]:index===1?["附着效果状态","费用降低1"]:
      unread?["附着效果状态"]:[]).map(text=>({text}));
    host.inspectHandCard=async(a,x)=>{index=a.index;selected.push(index);host.handFanReady=true;
      host.readSelectedCardFacts({},N.byId[a.id],x);};
    const a=N.choose(s,m),after=await host.execute(a,s,m);
    assert.equal(after.probed,true);assert.equal(after.confirmed,false);
    assert.deepEqual(selected,[1,2]);assert.equal(N.discardCost(after.hand[1]),2);
    assert.equal(N.discardCost(after.hand[2]),1);assert.equal(N.choose(after,m).id,"block");
    assert.equal(m.blockPlayed,false);assert.equal(host.consumptionReceipt,null);
    assert.equal(events.some(e=>e.event==="input-submitted"),false,"inspection is not a submitted game action");
    assert.equal(host.preparedHandInput.index,2);
    delete s.hand[2].attachments;s.hand[2].currentCost=null;unread=true;host.preparedHandInput=null;selected.length=0;
    const b=N.nextDiscardProbe(s,m,0),partial=await host.execute(b,s,m);
    assert.deepEqual(selected,[2]);assert.equal(N.discardCost(partial.hand[1]),2);
    assert.equal(N.discardCost(partial.hand[2]),null);
    assert.equal(N.nextDiscardProbe({...partial,dice:{Pyro:2}},m,0),null);
    // Only talents have Lair's payment-only reduction in this fixed deck.
    host.currentAction={type:"probe",scope:"card"};index=1;unread=false;
    host.ocrRows=()=>[{text:"事件牌"}];host.readSelectedCardFacts({},N.byId.countdown3,700);
    assert.equal(N.discardCost(host.cardWithFacts(s.hand[1],700)),2);
    host.selectedCardCostIn=()=>0;
    host.readSelectedCardFacts({},N.byId.serpentTalent,700);
    assert.equal(N.discardCost(host.cardWithFacts(hand(["serpentTalent"])[0],700)),null,
      "a free payable talent does not prove zero discard cost");
    host.ocrRows=(_f,{rect:r})=>r[0]===270?[{text:"装备牌"}]:[];
    host.readSelectedCardFacts({},N.byId.serpentTalent,700);
    assert.equal(N.discardCost(host.cardWithFacts(hand(["serpentTalent"])[0],700)),1,
      "the readable equipment type and empty attachment area prove printed discard cost, independently of Lair payment");
    host.currentAction=null;host.ocrRows=()=>{throw Error("ordinary title discovery must not scan attachments");};
    host.readSelectedCardFacts({},N.byId.countdown3,700);
  });
  await test("non-drawing handoffs reuse only the observed countdown family while failed cost probes survive the handoff",()=>{
    const env=loadRules(),{Host}=env.recognitionClasses(),host=new Host({}),m=memory(),s=board(["block","serpentTalent","countdown3"],0),
      family=clone(T.countdownFamily),slots=[{index:0,id:"block"},{index:1,id:"serpentTalent"},{index:2,titleCandidates:family}];
    const plan=T.handPlan({type:"switch",target:1},s,m),cards=[s.hand[0],s.hand[1],null];
    host.trace=()=>{};host.fillHandVariants(cards,slots,plan.retainedHand,plan.retainedVariantFamilies);
    assert.equal(cards[2].id,"countdown3");assert.equal(plan.mode,"full","costs and the native row still refresh");
    const draw=T.handPlan({type:"skill",who:1,skill:"E"},s,m);
    assert.equal(draw.retainedVariantFamilies,undefined,"a real random draw needs its own stage read");
    assert.deepEqual(clone(draw.retainedHand),clone(s.hand),"drawing preserves prior cards, not new identities or fees");
    const burst=T.handPlan({type:"skill",who:1,skill:"Q"},s,m);
    assert.ok(burst.retainedHand.every(h=>h.id!=="block"),"consumed blocks are not carried beyond confirmation");
    const block=T.handPlan({type:"card",id:"block",index:0,target:null},s,m);
    assert.deepEqual(clone(block.retainedHand.map(h=>h.id)),["serpentTalent"],
      "the highest-cost countdown can be discarded, not retained");
    assert.equal(block.retainedVariantFamilies.length,0);
    s.hand[1].attachments={source:"unknown",reduction:null,increase:null};
    s.hand[1].currentCost=0;m.talents[0]=true;
    const request=T.nextDiscardProbe(s,m,0);assert.equal(request.id,"serpentTalent");m.probeKeys.push(request.key);
    const after={...clone(s),active:1,confirmed:true};T.commit(m,{type:"switch",target:1},s,after);
    assert.equal(T.nextDiscardProbe(after,m,0),null,"switching does not authorize repeating a failed same-card inspection");
  });
  await test("native fee rows resolve block ranking per slot without detail clicks or inherited zeroes",async()=>{
    const {T:N,host,m,clicks}=nativeFixture(),ids=["harbor","lair","draw",...Array(5).fill("block"),"shift","shift"];
    let costs=[2,2,1,0,0,0,0,0,0,0];
    host.handPoints=()=>ids.map((_,i)=>500+i*100);
    host.collapsedLayoutIn=()=>({status:"readable",count:ids.length,slots:ids.map((_,i)=>({index:i}))});
    host.foldedHandCostsIn=()=>({costs:costs.slice(),source:"native-folded-cost-markers"});
    host.costHandIn=()=>({count:ids.length,costs:costs.slice()});
    host.ocrRows=()=>{throw Error("already readable row must not open/read card details");};
    const observe=async expanded=>{
      host.handFanReady=expanded;await host.prepareHandObservation(ids.length);
      return host.finishHandObservation(hand(ids));
    };
    for(const expanded of [false,true]){
      const observed=await observe(expanded),s={...board([],0),hand:observed};
      assert.deepEqual(clone(N.blockDiscards(observed,3).indices),[0,1]);
      assert.equal(N.nextDiscardProbe(s,m,3),null,"the native slot03 ten-card pattern needs no detail probes");
      assert.equal(observed[4].attachments.source,"unknown","price is not proof of absent attachments");
      costs[4]=4;
      const changed=await observe(expanded);
      assert.deepEqual(clone(N.blockDiscards(changed,3).indices),[4],"same-name blocks can have different current costs");
      costs[4]=null;
      const missing=await observe(expanded);
      assert.equal(missing[4].currentCost,null,"no observed digit is fabricated or inherited");
      assert.equal(N.discardCost(missing[4]),0,"generated block uses its fixed rule cost when no native modifier is present");
      assert.equal(N.nextDiscardProbe({...s,hand:missing},m,3),null,"missing block digits do not open identical details");
      costs[4]=0;
    }
    assert.equal(clicks.length,0);
    const unknown=host.cardWithFacts(hand(["block"])[0],500);
    assert.equal(unknown.currentCost,null,"completed observation must release its fee row");
    assert.equal(N.discardCost(unknown),0);
    const talent={...hand(["serpentTalent"])[0],currentCost:0,costSource:"native-folded-cost-markers",
      attachments:{source:"unknown",reduction:null,increase:null}};
    assert.equal(N.discardCost(talent),null);
    talent.attachments={source:"native",reduction:0,increase:0};assert.equal(N.discardCost(talent),1);
    const unbound={...unknown,id:"draw",currentCost:0,costSource:"estimate"};assert.equal(N.discardCost(unbound),null);
  });
  await test("declared retained native card facts survive a handoff; real price changes, new copies and new rounds do not inherit them",async()=>{
    const {T:N,host,m}=nativeFixture(),s=board(["block","scorpionTalent","sand"],0);
    s.hand[0]={...s.hand[0],currentCost:0,costSource:"native-selected-card-cost",attachments:{source:"unknown",reduction:null,increase:null}};
    s.hand[1]={...s.hand[1],currentCost:0,costSource:"native-selected-card-cost"};
    const plan=N.handPlan({type:"switch",target:1},s,m);
    host.feeSample={costs:[null,null,0],source:"native-folded-cost-markers"};
    const after=host.finishHandObservation(s.hand.map(h=>N.observedCard(h.name,h.index)),plan);
    assert.equal(N.discardCost(after[0]),0);assert.equal(N.discardCost(after[1]),1,"talent payment zero is not discard cost");
    assert.equal(N.nextDiscardProbe({...s,hand:after},m,0),null);
    host.feeSample={costs:[3,1,0],source:"native-folded-cost-markers"};
    const changed=host.finishHandObservation(s.hand.map(h=>N.observedCard(h.name,h.index)),plan);
    assert.equal(N.discardCost(changed[0]),3,"fresh price wins over earlier selected-card zero");
    assert.equal(changed[1].attachments.source,"unknown","a price contradiction invalidates the old attachment facts");
    const nextRound=host.finishHandObservation(s.hand.map(h=>N.observedCard(h.name,h.index)),N.handPlan({type:"end"},s,m));
    assert.equal(N.discardCost(nextRound[1]),null,"no retained declaration across a round");
    const duplicate=host.finishHandObservation(hand(["block","block","scorpionTalent","sand"]).map(h=>N.observedCard(h.name,h.index)),plan);
    assert.equal(duplicate[0].currentCost,null,"a new same-name copy cannot inherit a prior selected slot");
    assert.equal(N.discardCost(duplicate[0]),0,"fixed block rule is not a copied native price");
    const lair=N.handPlan({type:"card",id:"lair",index:0},{...s,hand:hand(["lair","scorpionTalent"]).map(h=>({...h,currentCost:1}))},m);
    assert.equal(lair.retainedHand[0].currentCost,null,"Lair changes talent payment facts before retention");
  });
  await test("assembled Host board extras remain optional",async()=>{
    const {T:N,host}=nativeFixture(),s=board();
    host.characterIn=(_f,i)=>({...s.characters[i],raised:i===1});
    host.enemiesIn=()=>s.enemies;host.diceIn=()=>({dice:s.dice});host.diceCountIn=()=>8;
    host.numericAt=()=>""; // No support-counter glyphs in this controlled empty board.
    const read=host.board(true);
    assert.equal(read.active,1);assert.equal(read.choiceReceipt,null);assert.equal(read.supportCounts.count,0);
    assert.equal(read.supportCounts.known,true);
    assert.equal(N.legalState({...read,hand:[]}),true,"unknown optional status must not block whole board");
  });
  await test("support observation reuses the native reader without making missing counters a whole-board wait",()=>{
    const {T:N,host}=nativeFixture(),b=board(["harbor"]);
    host.numericAt=(_f,{rect:r})=>r[0]===350&&r[1]===575?"3":"";
    const native=host.boardExtrasIn({},b).supportCounts;
    assert.equal(native.count,1);assert.equal(native.slots[0].counter,3);assert.equal(N.supportRoom({...b,supportCounts:native}),true);
    const before={...b,supportCounts:native},missing=clone(before);
    missing.supportCounts.slots[0].counter=null;
    assert.equal(host.boardsMatch(before,missing),true);
    assert.equal(host.stabilizeBoardExtras(before,missing).supportCounts.known,false);
    assert.equal(host.boardsMatch(before,missing,"execution",{type:"skill",who:1,skill:"E"}),true);
    assert.equal(host.boardsMatch(before,missing,"execution",{type:"card",id:"harbor",index:0,target:null}),false);
    assert.equal(host.boardsMatch(before,missing,"execution",{type:"card",id:"crocodileTalent",index:0,target:2}),false);
    missing.supportCounts.slots[0].present=false;assert.equal(host.boardsMatch(before,missing),false);
    host.numericAt=()=>"";host.matches=()=>[{x:250},{x:280}];
    const conflict=host.boardExtrasIn({},b).supportCounts;
    assert.equal(conflict.known,false);assert.equal(N.supportRoom({...b,supportCounts:conflict}),false);
    assert.deepEqual(Array.from(host.observationIssues({...b,supportCounts:conflict})),[]);
  });
  await test("rapid talent input handles backend frozen serpent through the common payment and block result",async()=>{
    const f=nativeFixture(),{T:N,host,m,clicks}=f,b=board(["serpentTalent","harbor","liben","sand","countdown3"],0),
      a={type:"card",id:"serpentTalent",index:0,target:1},banner="装备给我方的圣骸飞蛇",drags=[];
    b.dice={Electro:2,Anemo:1,Dendro:3,Cryo:1,Geo:1};b.characters[1].frozen=true;
    assert.equal(N.nativeCardScope(a,banner,b),true);
    assert.equal(N.nativeCardScope({...a,target:2},banner,b),false);
    assert.equal(N.nativeCardScope(a,"装备给我方的圣骸毒蝎",b),false);
    assert.equal(N.nativeCardScope(a,banner,{...b,characters:b.characters.map((c,i)=>i===1?{...c,dead:true,hp:0}:c)}),false);
    host.requireUnchangedBoard=async()=>{};host.prepareHandInput=async()=>({count:5});
    host.handPoints=()=>[500,700,900,1100,1300];host.inspectHandCard=async()=>{};host.requireNoWarning=async()=>{};
    host.drag=async(...points)=>{drags.push(points);f.setScene({phase:"unknown",turn:"none"});};
    host.ocr=(_f,{rect:r})=>r[1]===510?banner:"";
    host.ocrRows=(_f,{rect:r})=>r[1]===900?[{text:"打出手牌",x:800,y:920,w:300,h:60}]:[];
    await host.executeInput(a,b,m);
    assert.deepEqual(drags,[[500,945,960,720]]);
    assert.equal(host.choiceSession.kind,"payment");assert.equal(clicks.length,0);
    host.confirmationSession={key:N.actionKey(a)+"/"+N.boardKey(b),plan:{action:a,before:b,mode:"full"}};
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    assert.deepEqual(clicks,[[950,950]],"only the native payment control is submitted once");
    f.setScene({phase:"board",turn:"user"});await host.resolveChoice(b,m);
    const after={...b,hand:hand(["block","harbor","liben","sand","countdown3"]),dice:{Electro:2,Dendro:3,Cryo:1,Geo:1},
      handRead:"full",cardReceipt:clone(host.consumptionReceipt),choiceReceipt:clone(host.choiceReceipt)};
    assert.equal(N.verify(a,b,after),true);assert.equal(m.talents[1],false,"native page exit is not commit");
    assert.equal(N.verify(a,b,{...after,hand:hand(["harbor","liben","sand","countdown3"])}),false,"source removal alone is not entry generation");
    assert.equal(N.verify(a,b,{...after,handRead:"cache"}),false);
    assert.equal(N.verify(a,b,{...after,choiceReceipt:{...after.choiceReceipt,origin:"old-action"}}),false);
    assert.equal(N.verify(a,b,{...after,cardReceipt:{...after.cardReceipt,target:2}}),false);
    N.commit(m,a,b,{...after,confirmed:true});assert.equal(m.talents[1],true);
    assert.deepEqual(clone(m.used),[0,0,0]);assert.equal(after.active,0);
  });
  await test("zero-cost native talent confirms its page once; direct block needs no payment page",async()=>{
    const f=nativeFixture(),{T:N,host,m,clicks}=f,b=board(["scorpionTalent","stars","countdown2"]),
      a={type:"card",id:"scorpionTalent",index:0,target:0},drags=[],
      slots=n=>({known:true,slots:[{index:0,present:true,counter:n},
        ...[1,2,3].map(index=>({index,present:false,counter:null}))]});
    b.dice={Electro:2,Anemo:1,Cryo:1,Geo:1,Dendro:1};b.supportCounts=slots(3);b.hand[0].currentCost=0;
    m.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    host.requireUnchangedBoard=async()=>{};host.prepareHandInput=async()=>({count:3});
    host.handPoints=()=>[500,700,900];host.inspectHandCard=async()=>{};host.requireNoWarning=async()=>{};
    host.drag=async(...points)=>{drags.push(points);f.setScene({phase:"unknown",turn:"none"});};
    host.ocr=(_f,{rect:r})=>r[1]===510?"装备给我方的圣骸毒蝎":"";
    host.ocrRows=(_f,{rect:r})=>r[1]===900?[{text:"打出手牌",x:800,y:920,w:300,h:60}]:[];
    await host.executeInput(a,b,m);assert.deepEqual(drags,[[500,945,750,720]]);
    assert.equal(host.choiceSession.kind,"payment","zero dice is not proof that the native page can be skipped");
    host.confirmationSession={key:N.actionKey(a)+"/"+N.boardKey(b),plan:{action:a,before:b,mode:"full"}};
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    assert.deepEqual(clicks,[[950,950]]);
    f.setScene({phase:"board",turn:"user"});await host.resolveChoice(b,m);
    const after={...board(["block","stars","countdown2"]),dice:clone(b.dice),supportCounts:slots(2),
      handRead:"full",choiceReceipt:clone(host.choiceReceipt),cardReceipt:clone(host.consumptionReceipt)};
    assert.equal(N.verify(a,b,after),true);
    assert.equal(N.verify(a,b,{...after,cardReceipt:null}),false);
    assert.equal(N.verify(a,b,{...after,hand:hand(["block","block","stars"])}),false);
    N.commit(m,a,b,{...after,confirmed:true});assert.equal(m.talents[0],true);
    assert.equal(m.supports[0].discountUsed,true);assert.equal(m.supports[0].remaining,2);
    assert.deepEqual(clone(m.used),[0,0,0]);assert.equal(after.active,1);
    const pre=board(["block","harbor","liben","sand","countdown3"]),block={type:"card",id:"block",index:0,target:null};
    pre.dice={Electro:2,Dendro:3,Cryo:1,Geo:1};const plain=N.freshMemory({newGame:true});plain.talents[2]=true;
    block.blockBasis={actionKey:N.actionKey(block),beforeKey:N.boardKey(pre),effect:N.blockEffects("play",pre,plain)};
    await host.cardConfirm(block,pre);assert.equal(host.choiceSession,null);assert.equal(clicks.length,1);
    const result={...board(["harbor","liben","sand"]),dice:{...pre.dice,Anemo:1},handRead:"full",
      cardReceipt:{inputSent:true,beforeKey:N.boardKey(pre),id:block.id,index:0,target:null}};
    assert.equal(N.verify(block,pre,result),true);
    assert.equal(N.verify(block,pre,{...result,hand:hand(["harbor","liben","sand","countdown2"])}),false,
      "without Scorpion talent there is no draw of the new deck-top countdown");
  });
  await test("Sand uses observed option identity, one selection/confirmation and source-bound full-hand exit",async()=>{
    const f=nativeFixture(),{T:N,host,m,clicks}=f,b=board(["sand","stars"]),
      a={type:"card",id:"sand",index:0,target:null,choice:"sanctify"},key=N.actionKey(a)+"/"+N.boardKey(b);
    host.confirmationSession={key,plan:{action:a,before:b,mode:"full"}};
    host.consumptionReceipt={inputSent:true,beforeKey:N.boardKey(b),id:a.id,index:0,target:null};
    f.setOptions(["disperse","sanctify"]);f.setScene({phase:"choice",turn:"none"});
    assert.equal(host.phase().recognized,true);
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    assert.deepEqual(clicks,[[1360,541]],"choose actual right-hand sanctify, not fixed left side");
    f.setButtons([{x:800,y:920,w:300,h:60}]);f.setScene({phase:"unknown",turn:"none"});
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    assert.equal(clicks.length,2);
    f.setScene({phase:"board",turn:"user"});await host.resolveChoice(b,m);
    assert.equal(m.legendUsed,false,"page exit is not commit");assert.equal(host.choiceSession,null);
    const after={...board(["block","draw"]),handRead:"full",choiceReceipt:clone(host.choiceReceipt),cardReceipt:clone(host.consumptionReceipt)};
    assert.equal(N.verify(a,b,after),true,"equal hand count is valid with actual branch exit and complete reread");
    assert.equal(N.verify(a,b,{...after,handRead:"cache"}),false);
    assert.equal(N.verify(a,b,{...after,choiceReceipt:{...after.choiceReceipt,origin:"old-action"}}),false);
    assert.equal(N.verify(a,b,{...after,cardReceipt:null}),false);
    N.commit(m,a,b,{...after,confirmed:true});assert.equal(m.legendUsed,true);
    f.setOptions(["sanctify","sanctify"]);f.setScene({phase:"choice",turn:"none"});assert.equal(host.phase().recognized,false);
  });
  await test("actual shared pending owner confirms block only from bound submission, full hand and exact dice vector",async()=>{
    const f=nativeFixture(),{T:N,host,m}=f,b=board(["block","countdown3","stars"]),
      a={type:"card",id:"block",index:0,target:null};m.talents[0]=true;
    let submissions=0;
    host.requireUnchangedBoard=async()=>{};
    host.inputHand=async()=>{submissions++;host.consumptionReceipt={inputSent:true,beforeKey:N.boardKey(b),id:a.id,index:a.index,target:null};};
    await host.executeInput(a,b,m);
    const after={...board(["stars","countdown2"]),dice:{Omni:8,Anemo:1},handRead:"full",cardReceipt:clone(host.consumptionReceipt)};
    assert.equal(N.verify(a,b,after),true);
    assert.equal(N.verify(a,b,{...after,dice:{Omni:8,Electro:1}}),false);
    assert.equal(N.verify(a,b,{...after,hand:hand(["countdown3","stars"])}),true,"same-name redraw remains possible");
    assert.equal(N.verify(a,b,{...after,hand:hand(["countdown3","block"])}),false,"known retained Starsign cannot disappear");
    assert.equal(N.verify(a,b,{...after,handRead:"remove"}),false);
    assert.equal(N.verify({...a,blockBasis:{...a.blockBasis,beforeKey:"stale"}},b,after),false);
    host.removalEvidenceBeforeReset=async()=>null;host.observe=async()=>clone(after);
    const confirmed=await host.confirm(a,b,m);
    assert.equal(confirmed.confirmed,true);assert.equal(confirmed.handRefreshRequired,true);
    assert.equal(host.confirmationSession,null);assert.equal(submissions,1);assert.equal(m.blockPlayed,false);
    N.commit(m,a,b,confirmed);assert.equal(m.blockPlayed,true);
  });
  await test("a contradicted full block hand is reread in the same pending owner before uncertain exit",async()=>{
    // Native run 2026-10-23T14:56:22.011Z: at15:00:24 Harbor was read as
    // another Lair and countdown2 was missing. The later full hand passed.
    // Controlled observations reproduce that chain, not pixel recognition.
    for(const recovered of [true,false]){
      const {T:N,host,m}=nativeFixture(),b=board([
        "block","crocodileTalent","scorpionTalent","emblem","harbor","lair","liben","sand","countdown3"
      ],0),a={type:"card",id:"block",index:0,target:null};
      const wrong=["crocodileTalent","scorpionTalent","emblem","lair","lair","liben","sand"],
        correct=["crocodileTalent","scorpionTalent","emblem","harbor","lair","liben","sand","countdown2"];
      m.talents[0]=true;let submissions=0,reads=0;
      host.requireUnchangedBoard=async()=>{};
      host.inputHand=async()=>{submissions++;host.consumptionReceipt={inputSent:true,
        beforeKey:N.boardKey(b),id:a.id,index:0,target:null};};
      await host.executeInput(a,b,m);
      host.removalEvidenceBeforeReset=async()=>null;
      host.handCountIn=()=>null; // An absent badge must not resurrect the rejected cached full hand.
      host.readHand=async()=>hand(++reads===1||!recovered?wrong:correct);
      host.observe=async(_force,plan)=>({...clone(b),dice:{...b.dice,Electro:1},
        hand:await host.observedHand(plan),handRead:"full",cardReceipt:clone(host.consumptionReceipt)});
      const after=await host.confirm(a,b,m);
      assert.equal(after.confirmed,recovered);
      assert.equal(after.resynchronized,true);assert.equal(reads,2,"one genuinely fresh recovery read, not a loop");
      assert.equal(submissions,1);assert.equal(host.confirmationSession,null);assert.equal(m.blockPlayed,false);
      if(recovered){N.commit(m,a,b,after);assert.equal(m.blockPlayed,true);
        assert.deepEqual(clone(after.hand.map(h=>h.id)),correct);}
      else {N.deferUncertain(m,a,b);assert.equal(m.blockPlayed,null);}
    }
  });
  await test("tuning verifies a single actual conversion, while skill confirmation does not require predicted damage",()=>{
    const b=board(["shift"]),a={type:"tune",id:"shift",index:0,element:"Anemo"};
    b.dice={Electro:2,Pyro:1};const after={...board([]),dice:{Electro:1,Pyro:1,Anemo:1}};
    assert.equal(T.verify(a,b,after),true);
    assert.equal(T.verify(a,b,{...after,dice:{Anemo:2,Pyro:1}}),false,"net total alone cannot hide two conversions");
    const cast={type:"skill",who:1,skill:"E"};
    assert.equal(T.verify(cast,b,{...b,dice:{}}),true,"actual payment can confirm zero-damage hits");
    assert.equal(T.verify(cast,b,b),false);
    const enemyOnly=clone(b);enemyOnly.characters[1].hp--;
    assert.equal(T.verify(cast,b,enemyOnly,true),false,"enemy handoff/damage alone cannot confirm our skill");
  });
  await test("consumed block waits in its submitted owner until delayed native dice arrive, without resubmission",async()=>{
    const {T:N,host,m}=nativeFixture(),b=board(["block","countdown3","sand"],0),a={type:"card",id:"block",index:0,target:null};
    b.dice={};let submitted=0,reads=0;
    host.requireUnchangedBoard=async()=>{};
    host.inputHand=async()=>{submitted++;host.consumptionReceipt={inputSent:true,beforeKey:N.boardKey(b),id:a.id,index:0,target:null};};
    await host.executeInput(a,b,m);host.removalEvidenceBeforeReset=async()=>null;
    host.observe=async()=>({...clone(b),hand:hand(["sand"]),handRead:"full",cardReceipt:clone(host.consumptionReceipt),
      dice:++reads<3?{}:{Electro:1}});
    const after=await host.confirm(a,b,m);
    assert.equal(after.confirmed,true);assert.equal(reads,3);assert.equal(submitted,1);
    N.commit(m,a,b,after);assert.equal(m.blockPlayed,true);assert.equal(host.confirmationSession,null);
  });
  await test("all three bursts wait for their rule-owned block consumption, including partial helper discards",()=>{
    for(const who of [0,1,2]){
      const b=board(Array(5).fill("block"),who),a={type:"skill",who,skill:"Q"},s={...clone(b),handRead:"full"};
      assert.equal(T.confirmationReady(a,b,s),false);
      s.hand=hand(Array(who===1?0:2).fill("block"));
      assert.equal(T.confirmationReady(a,b,s),true);
    }
  });
  await test("native slot08 Crocodile Q cannot confirm the two blocks that are about to disappear or reuse that failed snapshot",async()=>{
    const {T:N,host,m}=nativeFixture(),b=board(Array(2).fill("block"),2),a={type:"skill",who:2,skill:"Q"};
    b.characters[2].energy=2;let reads=0;
    host.frame=fn=>fn({});host.phase=host.phaseIn=()=>({phase:"board",turn:"user"});
    host.handCountIn=()=>null;host.handFanReady=host.handNeedsReset=false;host.boardReady=true;
    host.readHand=async()=>++reads===1?clone(b.hand):[];
    host.removalEvidenceBeforeReset=async()=>null;
    host.observe=async(_pending,plan)=>({...clone(b),dice:{Omni:5},hand:await host.observedHand(plan),handRead:"full"});
    const after=await host.confirm(a,b,m);
    assert.equal(after.confirmed,true);assert.equal(after.hand.length,0);assert.equal(reads,2);
    assert.equal(host.handCache.length,0);assert.equal(host.confirmationSession,null);
  });
  await test("Serpent burst stays with its pending owner until its original blocks have left the hand",async()=>{
    const {T:N,host,m}=nativeFixture(),b=board(Array(4).fill("block")),a={type:"skill",who:1,skill:"Q"};
    b.characters[1].energy=2;let submitted=0,reads=0;
    host.requireUnchangedBoard=async()=>{};host.inputSkill=async()=>{submitted++;};
    await host.executeInput(a,b,m);host.removalEvidenceBeforeReset=async()=>null;
    host.observe=async()=>{const s=clone(b);s.dice={Omni:5};s.characters[1].energy=0;
      s.hand=++reads===1?clone(b.hand):[];s.handRead="full";return s;};
    const after=await host.confirm(a,b,m);
    assert.equal(after.confirmed,true);assert.equal(after.hand.length,0);assert.equal(reads,2);assert.equal(submitted,1);
    assert.equal(host.confirmationSession,null);
  });
  await test("native slot08 food preparation must end in a usable burst, not just free room for an already charged E",()=>{
    const x=clone(require("../../../business/fixtures/player-native-regressions-20261025.json").consecratedFood.observation),before=JSON.stringify(x);
    const m=clone(x.memory),a=T.choose(x.state,m);
    assert.notEqual(a.id,"adeptus");assert.equal(JSON.stringify(x),before);
    const routes=T.projectionBudget.run(240,()=>({routes:T.attackRoutes(x.state,m)})).routes;
    assert.ok(!routes.some(r=>r.first.id==="adeptus"&&r.terminal.skill!=="Q"));
  });
  await test("native charged Serpent under pressure spends its stronger burst instead of another draw attack",()=>{
    const x=clone(require("../../../business/fixtures/player-native-regressions-20261025.json").consecratedPressure.observation),before=JSON.stringify(x);
    const m=clone(x.memory),a=T.choose(x.state,m);
    assert.equal(T.actionLegal(x.state,a,m),true);
    assert.equal(a.plan.terminal.who,1);assert.equal(a.plan.terminal.skill,"Q");
    assert.ok(a.plan.estimate.direct>T.damageEstimate(x.state,m,{who:1,skill:"E"}).direct);
    const healthy=clone(x.state);healthy.characters[1].hp=6;
    assert.notEqual(T.choose(healthy,m).plan?.terminal?.skill,"Q","healthy charging retains the larger future burst");
    const weak=clone(x.state);weak.hand=hand(["nre"]);
    assert.equal(T.choose(weak,{...m,emblem:[false,false,false]}).type,"switch","an unproductive charged attack does not hold the pressured core on field");
    assert.equal(JSON.stringify(x),before,"policy never rewrites observed resources");
  });
  await test("fully proved rapid talent generation does not trigger a second whole-hand read",async()=>{
    for(const [id,rule] of Object.entries(T.talents)){
      const {T:N,host,m}=nativeFixture(),b=board([id,"countdown2","stars"]),
        a={type:"card",id,index:0,target:rule.target};
      const after={...clone(b),hand:hand(["block","countdown2","stars"]),handRead:"full",
        cardReceipt:{id,index:0,target:rule.target,beforeKey:N.boardKey(b),inputSent:true}};
      let scene={phase:"choice",turn:"none"};
      host.phase=()=>scene;
      host.resolveChoice=async()=>{
        host.choiceReceipt={origin:N.actionKey(a)+"/"+N.boardKey(b),kind:"payment",id,exited:true};
        scene={phase:"board",turn:"user"};
      };
      host.observe=async()=>({...clone(after),choiceReceipt:clone(host.choiceReceipt)});host.diceBudgetMatches=()=>true;
      const result=await host.confirm(a,b,m);
      assert.equal(result.confirmed,true);assert.equal(result.handRefreshRequired,false);
      assert.equal(N.verify(a,b,{...after,hand:hand(["countdown2","stars"])}),false,"source removal alone is not complete generation");
    }
    const b=board(["lair","countdown2"]);
    assert.notEqual(T.handPlan({type:"card",id:"lair",index:0,target:null},b,memory()).refreshAfterConsumption,false,
      "a search with a possibly delayed draw still refreshes");
  });
  await test("continuation can fund more than two attacks and use current Starsign or block resources",()=>{
    const s=board(Array(4).fill("block")),m=memory();
    s.characters[1].energy=2;s.enemies[0].hp=7;s.dice={Omni:15};
    const before=JSON.stringify([s,m]),routes=T.projectionBudget.run(240,()=>({routes:T.attackRoutes(s,m)})).routes,
      burst=routes.find(r=>r.terminal.who===1&&r.terminal.skill==="Q"&&!r.conditional);
    assert.ok(burst.followupDamage>=10,"four payable follow-ups are not truncated to two");
    assert.equal(JSON.stringify([s,m]),before);
    for(const ids of [["block","block","block","block","stars"],["block","draw"]]){
      const b=board(ids),n=memory();b.dice={Omni:8};b.enemies[0].hp=3;
      const rs=T.projectionBudget.run(240,()=>({routes:T.attackRoutes(b,n)})).routes,
        e=rs.find(r=>r.terminal.who===1&&r.terminal.skill==="E"&&!r.conditional&&r.first.type==="skill");
      assert.ok(e.followupDamage>=(ids.includes("stars")?8:6),"known rapid resources must count toward later attacks");
    }
  });
  await test("shared tuning recovery carries confirmation to the actual player commit without resending",async()=>{
    const {T:N,Player,options}=loadRules(),events=[],host={trace:(e,d)=>events.push({e,d}),adoptObservedState(){}};
    const p=new Player(host,options()),b=board(["shift"]),a={type:"tune",id:"shift",index:0,element:"Anemo"};
    b.dice={Electro:2,Pyro:1};const after={...board([]),dice:{Electro:1,Pyro:1,Anemo:1},handRead:"full"};
    host.observe=async()=>after;
    let commits=0;const commit=N.commit;N.commit=(...args)=>{commits++;return commit(...args);};
    await p.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.equal(events.find(x=>x.e==="confirmed").d.after.confirmed,true);
    assert.equal(after.confirmed,undefined,"do not mutate the raw observed state");
    assert.deepEqual(clone(p.readyState.dice),after.dice);
    const refused=new Player(host,options());host.observe=async()=>b;
    await refused.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.equal(N.actionRefused(b,refused.memory,a),true);
    const uncertain=new Player(host,options());host.observe=async()=>({...after,dice:b.dice});
    await uncertain.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.ok(events.some(x=>x.e==="action-uncertain"));
  });
  await test("player initializes new-game effects once at admitted board, not construction or rejected entry",async()=>{
    const {T:N,Player,options}=loadRules(),host={trace(){},waitForCapture:async()=>{},phase:()=>({phase:"opening"})};
    const p=new Player(host,options());assert.equal(p.memory.talents[0],null);
    await p.enter();assert.equal(p.memory.blockPlayed,null);
    p.memory.openingIds=["harbor","scorpionTalent"];p.planOpening();p.finishOpening();
    assert.equal(p.memory.round,1);assert.equal(p.memory.blockPlayed,false);assert.equal(p.memory.cleanup,0);
    assert.deepEqual(clone(p.memory.talents),[false,false,false]);assert.equal(p.memory.openingTarget,1);
    assert.deepEqual(clone(p.memory.openingIds),["harbor","scorpionTalent"]);
    p.memory.blockPlayed=true;p.memory.talents[0]=true;p.finishOpening();
    assert.equal(p.memory.blockPlayed,true);assert.equal(p.memory.talents[0],true,"completed opening cannot reset effects");
    const q=new Player({...host,phase:()=>({phase:"board",turn:"user"})},options());
    await assert.rejects(q.enter(),/行动页启动需要/);assert.equal(q.memory.talents[0],null);
    const terminal=new Player({...host,phase:()=>({phase:"result",result:"win"})},options());
    assert.equal(await terminal.enter(),false);assert.equal(terminal.memory.blockPlayed,null);
    const allowed=new Player({...host,phase:()=>({phase:"board",turn:"user"}),admitFreshActionBoard:async()=>board([])},
      options({actionEntry:"确认新开局未行动"}));
    await allowed.enter();assert.equal(allowed.memory.blockPlayed,false);
    assert.throws(()=>allowed.admitActionHand(board([])),/应有7张/);
    allowed.admitActionHand(board(Array(7).fill("block")));assert.equal(allowed.actionEntryHandPending,false);
    const rollHost={...host,phase:()=>({phase:"roll"}),roll:async m=>{assert.equal(m.openingTarget,1);N.nextRound(m);return board([]);}};
    const rolled=new Player(rollHost,options());await rolled.enter();await rolled.roll();
    assert.equal(rolled.memory.round,1);assert.equal(rolled.memory.talents[2],false);
  });
  await test("actual recognition player bridges post-mulligan identities to only the initial reroll",async()=>{
    const env=loadRules(),N=env.T,{Player}=env.recognitionClasses(),ids=["scorpionTalent","crocodileTalent","harbor","draw","shift"];
    const host={trace(){},waitForCapture:async()=>{},phase:()=>({phase:"pick"}),
      folded:async()=>({count:5,slots:ids.map(id=>({id}))}),pick:async target=>{assert.equal(target,1);return {phase:"roll"};}};
    const p=new Player(host,env.options());await p.enter();await p.pick();
    assert.deepEqual(clone(p.memory.openingIds),ids);assert.equal(p.memory.openingObservation.source,"folded-post-mulligan");
    const items=["Anemo","Anemo","Anemo","Electro","Electro","Hydro","Hydro","Omni"].map(element=>({element}));
    assert.deepEqual(clone(N.rerollPlan(items,p.memory).indices),[0,1,2,3,5,7]);
    p.memory.round=1;
    assert.deepEqual(clone(N.rerollPlan(items,p.memory).indices),[0,1,2,7],"the next roll must not reserve a spent opening talent");
    const q=new Player({...host,folded:async()=>({count:5,slots:[{id:null},...ids.slice(1).map(id=>({id}))]})},env.options());
    await q.enter();q.memory.openingIds=["harbor","draw"];await q.pick();
    assert.equal(q.memory.openingObservation.complete,false);
    assert.deepEqual(clone(N.rerollPlan(items,q.memory).indices),[0,1,2,7],"partial art read cannot fabricate the missing replacement cards");
  });
}
module.exports=run;
if(require.main===module)(async()=>{
  const pack=packageFiles("consecrated"),files=["src/decks/consecrated/core.js.tmpl","src/decks/consecrated/strategy.js","src/decks/consecrated/bgi.js.tmpl","src/decks/consecrated/player.js.tmpl",...pack.dependencies.map(x=>x.split("#")[0])],
    hashes=Object.fromEntries([...new Set(files)].map(f=>[f,sha(fs.readFileSync(path.join(base,f)))])),results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(e.stack);}});
  for(const [f,hash]of Object.entries(hashes))assert.equal(sha(fs.readFileSync(path.join(base,f))),hash,"Source drift: "+f);
  const report={at:new Date().toISOString(),scope:"standalone production package rules/strategy and actual Host choice/confirmation with controlled observations; no native pixels or game input",
    nativeVerified:false,registered:true,packages:{consecrated:Object.fromEntries([...pack.files].map(([p,b])=>[p,sha(b)]))},sourceHashes:hashes,
    passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  const out=process.env.TCG_TEST_REPORT||path.join(base,"reports/consecrated-development-20261023/rules-test.json");
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:out}));
  if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
