"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
const clone=x=>JSON.parse(JSON.stringify(x));
const card=(h,target=null)=>({type:"card",id:h.id,index:h.index,target});
function observed(T,id,i,cost=T.size(T.byId[id].cost)){
  return {...T.observedCard(T.byId[id].name,i),currentCost:cost,attachments:{source:"native",reduction:0,
    increase:0,empowered:false,noTuning:false,effectless:false},canTune:true};
}
function drawFixture(id,oldIds=["draw"],newIds=["draw"]){
  let now=2000;class Clock extends Date{static now(){return now;}}
  const {T,Host,Player}=load(id,{Date:Clock,sleep:async ms=>{now+=ms;}}),h=new Host({}),m=T.freshMemory(),
    b=board(T,oldIds),a=card(b.hand[0]);
  b.hand=b.hand.map((h,i)=>Object.assign(h,observed(T,h.id,i)));b.dice={Omni:2};
  const c={...clone(b),dice:{Omni:1},hand:T.indexedHand(newIds.map((id,i)=>observed(T,id,i))),handRead:"full"};
  h.memory=m;h.trace=()=>{};h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
  h.frame=fn=>fn({});h.diceIn=()=>({dice:c.dice});h.diceCountIn=()=>T.total(c.dice);
  h.requireHandObservation=()=>{};h.removalEvidenceBeforeReset=async()=>null;
  h.observe=async()=>clone(c);h.boardReady=true;h.expectedDice=1;h.handProvenance=b.hand;
  h.consumptionReceipt={id:a.id,index:a.index,target:null,beforeKey:T.boardKey(b),inputSent:true,
    sourceInstanceIds:b.hand[0].instanceIds.slice(),cost:T.drawPayment(b,a,m),
    sourceCountProof:{count:b.hand.length,stableReads:2,source:"native-badge"}};
  return {T,Host,Player,h,m,b,a,c};
}
module.exports=async function(test){
  await test("C01 countdown conversion uses bound payment and native dice, not same-name hand growth",async()=>{
    // Suleika1.1.4, 2026-10-20T10:42:13.464Z central payment:
    // Pyro2/Anemo1/Electro1/Omni3 -> Omni4, fee3, another countdown drawn.
    for(const mode of ["valid","no-payment","fee-only","refund","badge","ordinary-draw","free"]){
      const f=drawFixture("mozailu",["countdown3"],["countdown3","wolf"]);
      const {T,h,m,b,a,c}=f;
      b.dice={Pyro:2,Anemo:1,Electro:1,Omni:3};c.dice={Omni:4};
      h.expectedDice=4;
      if(mode==="ordinary-draw"){
        a.id="draw";Object.assign(b.hand[0],observed(T,"draw",0));Object.assign(c.hand[0],observed(T,"draw",0));
      }
      h.consumptionReceipt={...h.consumptionReceipt,id:a.id,beforeKey:T.boardKey(b),
        sourceInstanceIds:b.hand[0].instanceIds.slice(),cost:T.drawPayment(b,a,m),paymentSubmitted:true};
      if(mode==="no-payment")delete h.consumptionReceipt.paymentSubmitted;
      if(mode==="fee-only"){b.dice={Pyro:1,Anemo:1,Electro:1,Omni:4};h.consumptionReceipt.beforeKey=T.boardKey(b);}
      if(mode==="refund")c.dice={Omni:5};
      if(mode==="badge")h.diceCountIn=()=>5;
      if(mode==="free")h.consumptionReceipt.cost={};
      h.confirmationSession={key:T.actionKey(a)+"/"+T.boardKey(b)};
      assert.equal(T.verify(a,b,c),false,"same-name hand growth is not consumption proof");
      assert.equal(await h.provePaidDraw(a,b,c,m),mode==="valid",mode);
      assert.equal(T.verify(a,b,c),mode==="valid",mode);
    }
  });
  await test("C01 native central payment binds only the submitted source receipt",async()=>{
    for(const mode of ["valid","wrong-owner","ambiguous","wrong-card","enemy","input-failed"]){
      const {T,h,b,a,c}=drawFixture("mozailu",["countdown3"],["countdown3","wolf"]);
      let clicks=0;
      const page={banner:"打出手牌：幻戏倒计时：3",phase:{phase:"unknown",turn:"none"},
        targets:[{x:900,y:900,w:100,h:50}]};
      if(mode==="wrong-owner")h.consumptionReceipt.beforeKey="other-board";
      if(mode==="ambiguous")page.targets.push({...page.targets[0],x:1100});
      if(mode==="wrong-card")page.banner="打出手牌：运筹帷幄";
      if(mode==="enemy")page.phase={phase:"board",turn:"enemy"};
      h.requireNoWarning=async()=>{};
      h.cardConfirmationEntryIn=()=>page;h.cardPaymentControlsIn=()=>page.targets;
      h.cardBannerIn=()=>page.banner;h.phaseIn=()=>page.phase;
      h.clickAt=()=>{if(mode==="input-failed")throw Error("native input failed");clicks++;h.inputRevision++;};
      if(["valid","wrong-owner"].includes(mode))await h.cardConfirm(a,b);
      else await assert.rejects(()=>h.cardConfirm(a,b));
      assert.equal(clicks,["valid","wrong-owner"].includes(mode)?1:0,mode);
      assert.equal(h.consumptionReceipt.paymentSubmitted===true,mode==="valid",mode);
      assert.equal(T.verify(a,b,c),false,
        "payment click alone is not consumption");
    }
  });
  await test("C01 paid same-name draw confirms once and retires only its consumed origin",async()=>{
    for(const id of ["raiden","iansan","moonbloom","mozailu"]){
      const {T,h,m,b,a}=drawFixture(id,["draw"],["draw",id==="moonbloom"?"sashimi":id==="mozailu"?"boar":"sweet"]);
      const result=await h.confirm(a,b,m);
      assert.equal(result.confirmed,true,id);assert.ok(result.hand[0].instanceIds.every(n=>!b.hand[0].instanceIds.includes(n)),id);
      assert.equal(h.confirmationSession,null);assert.equal(h.consumptionReceipt,null);
    }
  });
  await test("C01 source-bound payment rejects unknown, unrelated, unstable and wrong-owner evidence",async()=>{
    for(const mode of ["origin","target","source","fee-unknown","free","vector","badge","growth-only","automatic","transition"]){
      const f=drawFixture("iansan");f.h.confirmationSession={key:f.T.actionKey(f.a)+"/"+f.T.boardKey(f.b)};
      const r=f.h.consumptionReceipt;
      if(mode==="origin")r.beforeKey="wrong";if(mode==="target")r.target=1;if(mode==="source")r.sourceInstanceIds=[999];
      if(mode==="fee-unknown")r.cost=null;if(mode==="free")r.cost={};
      if(mode==="vector")f.c.dice={Electro:1};if(mode==="badge")f.h.diceCountIn=()=>2;
      if(mode==="growth-only"){f.c.dice={Omni:2};f.c.hand.push(observed(f.T,"sweet",1));}
      if(mode==="automatic")f.h.autoRisk=true;
      if(mode==="transition")f.h.confirmationSession.transition=true;
      assert.equal(await f.h.provePaidDraw(f.a,f.b,f.c,f.m),false,mode);
      assert.equal(f.T.verify(f.a,f.b,f.c),false,mode);
    }
  });
  await test("C01 confirmed redraw keeps survivors, commits once and permits the new draw",async()=>{
    const f=drawFixture("iansan",["draw","sweet"],["draw","sweet","sweet"]),{T,h,m,b,a}=f;
    const p=new f.Player(h,{maxMinutes:1});p.memory=m;p.observe=async()=>b;p.progress=()=>{};
    const countProof=h.consumptionReceipt.sourceCountProof;let sent=0,commits=0;
    h.requireUnchangedBoard=async()=>{};h.prepareHandInput=async()=>countProof;h.handPoints=()=>[700,900];
    h.inspectHandCard=async()=>{};h.drag=async()=>{sent++;};h.cardConfirm=async()=>{};
    const choose=T.choose,commit=T.commit;T.choose=()=>a;T.commit=(...args)=>{commits++;return commit(...args);};
    try{await p.act();}finally{T.choose=choose;T.commit=commit;}
    assert.equal(sent,1);assert.equal(commits,1);assert.equal(m.uncertainActions.length,0);
    assert.ok(p.readyState.hand[1].instanceIds.includes(b.hand[1].instanceIds[0]));
    assert.ok(!p.readyState.hand[0].instanceIds.includes(b.hand[0].instanceIds[0]));
    assert.equal(T.actionRefused(p.readyState,m,card(p.readyState.hand[0])),false);
    assert.equal(T.choose(p.readyState,m).id,"draw");
  });
  await test("C01 paid Timaeus retrieval confirms the consumed copy and books its support once",async()=>{
    const f=drawFixture("mozailu",["timaeus","liben"],["gilded","timaeus","liben"]),{T,h,m,b,a}=f;
    m.round=1;m.supports=[{id:"dunyarzad",round:-1,drawUsed:false}];m.supportSlots=1;
    const p=new f.Player(h,{maxMinutes:1});p.memory=m;p.observe=async()=>b;p.progress=()=>{};
    const countProof=h.consumptionReceipt.sourceCountProof;let sent=0,commits=0;
    h.requireUnchangedBoard=async()=>{};h.prepareHandInput=async()=>countProof;h.handPoints=()=>[700,900];
    h.inspectHandCard=async()=>{};h.drag=async()=>{sent++;};h.cardConfirm=async()=>{};
    const choose=T.choose,commit=T.commit;T.choose=()=>a;T.commit=(...args)=>{commits++;return commit(...args);};
    try{await p.act();}finally{T.choose=choose;T.commit=commit;}
    assert.equal(sent,1);assert.equal(commits,1);assert.equal(m.uncertainActions.length,0);
    assert.equal(m.supportStateKnown,true);assert.equal(m.supportSlots,2);
    assert.equal(m.supports[0].drawUsed,true);assert.equal(m.supports[1].id,"timaeus");assert.equal(m.supports[1].materials,2);
    assert.ok(!p.readyState.hand[1].instanceIds.includes(b.hand[0].instanceIds[0]));
    assert.ok(p.readyState.hand[2].instanceIds.includes(b.hand[1].instanceIds[0]));
    assert.equal(T.verify(a,b,f.c),false,"same name and reduced dice without a receipt are still insufficient");
    const free={type:"card",id:"liben",index:1,target:null};
    assert.equal(T.size(T.drawPayment(b,free,{...m,supports:[{id:"dunyarzad",drawUsed:false}]})),0);
    const ordinary=board(T,["house"]);
    assert.equal(T.drawPayment(ordinary,card(ordinary.hand[0]),m),null,
      "a support without retrieval does not opt into paid-draw proof");
  });
  await test("C01 consuming one item preserves other ambiguous origins and late-hand refresh",async()=>{
    const f=drawFixture("iansan",["draw","draw"],["draw"]),{T,h,m,b,a}=f;
    b.hand[0].instanceIds=[41,42];b.hand[1].instanceIds=[41,42];
    h.consumptionReceipt.sourceInstanceIds=[41,42];h.consumptionReceipt.beforeKey=T.boardKey(b);
    const result=await h.confirm(a,b,m);
    assert.equal(result.confirmed,true);assert.ok(result.hand[0].instanceIds.includes(41));assert.ok(result.hand[0].instanceIds.includes(42));
    for(const ids of [[],["sweet"]]){
      const g=drawFixture("iansan",["draw"],ids);const p=new g.Player(g.h,{maxMinutes:1});p.memory=g.m;
      const receipt=g.h.consumptionReceipt;g.h.executeInput=async()=>{g.h.consumptionReceipt=receipt;};p.observe=async()=>g.b;p.progress=()=>{};
      const choose=g.T.choose;g.T.choose=()=>g.a;try{await p.act();}finally{g.T.choose=choose;}
      assert.equal(g.m.uncertainActions.length,0);assert.equal(p.readyState,null);assert.equal(g.h.handCache,null);
    }
  });
  await test("C02 two actual fee probes retain independent E/Q quotes on the same board",async()=>{
    const {T,Host}=load("iansan"),h=new Host({}),s=board(T),m=T.freshMemory();
    s.active=2;s.dice={Anemo:2};s.characters[2].energy=2;m.soupDiscount[2]=null;m.troupe[2]=null;
    h.trace=()=>{};h.clickAt=()=>{};h.reset=async()=>{};h.requireUnchangedBoard=async()=>{};
    h.phaseIn=()=>({phase:"unknown",turn:"none"});h.frame=fn=>fn({});let fee=2;h.skillFeeIn=()=>fee;
    for(const skill of ["E","Q"]){fee=skill==="E"?2:3;await h.probeSkill({type:"probe",who:2,skill,key:skill},s,m);}
    assert.equal(T.size(T.skillCost(2,"E",m,s)),2);assert.equal(T.size(T.skillCost(2,"Q",m,s)),3);
    assert.equal(T.choose(s,m).type,"skill");assert.equal(T.choose(s,m).skill,"E");
  });
  await test("C02 failed quotes coexist; board changes and action boundaries expire only skill evidence",async()=>{
    for(const [e,q]of [[2,null],[3,2]]){
      const {T,Host}=load("iansan"),h=new Host({}),s=board(T),m=T.freshMemory();s.active=2;s.dice={Anemo:2};s.characters[2].energy=2;
      h.clickAt=()=>{};h.reset=async()=>{};h.requireUnchangedBoard=async()=>{};h.phaseIn=()=>({phase:"unknown",turn:"none"});h.frame=fn=>fn({});h.trace=()=>{};
      for(const [skill,fee]of [["E",e],["Q",q]]){h.skillFeeIn=()=>fee;await h.probeSkill({type:"probe",who:2,skill,key:skill},s,m);}
      assert.equal(T.skillQuote(s,m,{who:2,skill:"E"}).n,e);assert.equal(T.skillQuote(s,m,{who:2,skill:"Q"}).n,q);
      assert.equal(T.skillProbeAttempted(s,m,{who:2,skill:"Q"}),true);
      assert.equal(T.skillProbeAttempted(s,m,{who:1,skill:"Q"}),false);
    }
    for(const id of ["raiden","iansan","moonbloom"]){
      const {T}=load(id),s=board(T,["shift"]),m=T.freshMemory(),a=card(s.hand[0]);
      for(const event of ["commit","deferUncertain","rejectAction","nextRound"]){
        T.recordSkillCost(s,m,{who:0,skill:"E"},1);T[event](m,...(event==="nextRound"?[]:[a,s,s]));
        assert.equal(m.skillCosts,null,id+"/"+event);
      }
      m.probeKeys=["native-card-fact"];T.recordSkillCost(s,m,{who:0,skill:"E"},1);
      T.recordSkillCost(s,m,{who:0,skill:"T",technique:"ray"},1,"native-technique-preview");
      assert.equal(T.skillProbeAttempted(s,m,{who:0,skill:"T",technique:"boat"}),false);
      const changed=clone(s);changed.characters[0].hp--;T.refreshSkillCosts(m,changed);
      assert.equal(T.skillProbeAttempted(s,m,{who:0,skill:"E"}),false);
      assert.deepEqual(m.probeKeys,["native-card-fact"]);
    }
  });
  await test("C03 resource roots include the same unrefused kernel regardless of duplicate order",()=>{
    const {T}=load("moonbloom"),s=board(T),m=T.freshMemory();s.active=2;s.dice={Dendro:8};m.round=2;
    s.hand=T.indexedHand([observed(T,"seed",0),observed(T,"seed",1)]);
    s.characters[0].energy=1;s.characters[1].energy=1;
    Object.assign(s.enemies[0],{hp:5,aura:["Dendro"]});m.bloomResolved=true;
    m.frost=T.fact({uses:1,damage:1},"confirmed-action");m.ripple=T.fact(1,"confirmed-action");
    m.lunarMinimum=T.fact(2,"confirmed-action");m.kernelProduced=T.fact(2,"confirmed-action");
    T.rejectAction(m,card(s.hand[0]),s);const allowed=s.hand[1].instanceIds[0],project=T.projectResources;
    for(const hand of [s.hand,[s.hand[1],s.hand[0]].map((h,index)=>({...h,index}))]){
      const local={...s,hand},seen=[];T.projectResources=(b,n,a)=>{if(b===local&&a.id==="seed")seen.push(b.hand[a.index].instanceIds[0]);return project(b,n,a);};
      try{T.resourceRoutes(local,m);}finally{T.projectResources=project;}
      assert.ok(seen.includes(allowed),"equivalent grouping must not be occupied by a refused copy");
      const chosen=T.choose(local,m);assert.equal(chosen.id,"seed");assert.equal(local.hand[chosen.index].instanceIds[0],allowed);
    }
  });
  await test("C04 capped mixed-colour Gambler refunds accept only attributed generated totals",()=>{
    const {T,Host}=load("iansan"),h=new Host({}),s=board(T);
    // Synthetic total-capacity boundaries, not evidence that this deck reaches sixteen Omni.
    s.dice={Electro:8,Hydro:8};h.expectedDice=15;h.gamblerBudget={owner:0,remaining:3,enemies:2};
    assert.equal(h.diceBudgetMatches(s),true,"one observed defeat permits capped +1");
    h.expectedDice=13;h.gamblerBudget.enemies=3;assert.equal(h.diceBudgetMatches(s),true,"two defeats permit capped +3");
    h.gamblerBudget.enemies=2;assert.equal(h.diceBudgetMatches(s),false,"one defeat cannot explain +3");
    h.expectedDice=14;assert.equal(h.diceBudgetMatches(s),true,"ordinary +2");
    h.gamblerBudget.owner=1;assert.equal(h.diceBudgetMatches(s),false);
    h.gamblerBudget.owner=0;h.gamblerBudget.remaining=0;assert.equal(h.diceBudgetMatches(s),false);
    h.gamblerBudget.remaining=3;h.gamblerBudget.enemies=1;assert.equal(h.diceBudgetMatches(s),false);
  });
  await test("C04 an attributed capped refund confirms without redundant resource resynchronization",async()=>{
    const {T,Host}=load("iansan"),h=new Host({}),b=board(T),m=T.freshMemory();
    b.dice={Electro:8,Hydro:8};b.enemies[0].hp=2;b.enemies.push({...clone(b.enemies[0]),hp:10,active:false});
    const c=clone(b);c.dice={Electro:7,Hydro:8,Omni:1};c.enemies[0]={...c.enemies[0],hp:0,dead:true,active:false};c.enemies[1].active=true;
    c.characters[0].energy=1;c.handRead="full";
    h.phase=()=>({phase:"board",turn:"user"});h.observe=async()=>c;h.requireHandObservation=()=>{};
    h.removalEvidenceBeforeReset=async()=>null;h.trace=()=>{};h.boardReady=true;
    h.expectedDice=15;h.gamblerBudget={owner:0,remaining:3,enemies:2};
    h.observedResourceProof=async()=>{throw Error("valid capped refund must not enter fallback");};
    const result=await h.confirm({type:"skill",who:0,skill:"NA"},b,m);
    assert.equal(result.confirmed,true);assert.notEqual(result.resynchronized,true);
  });
};
