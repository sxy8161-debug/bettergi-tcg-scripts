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
};
