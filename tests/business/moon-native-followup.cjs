"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs"),native=require("./fixtures/moon-countdown-native-20261017.json");
const clone=x=>JSON.parse(JSON.stringify(x));
function replay(){
  let inputs=0;
  const {T,Host}=load("moonbloom"),h=new Host({}),b=clone(native.before),s=clone(native.after),
    a=clone(native.action),m=Object.assign(T.freshMemory(),clone(native.memory));
  h.memory=m;h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});h.trace=()=>{};
  h.frame=fn=>fn({});h.diceIn=()=>({dice:s.dice});h.diceCountIn=()=>T.total(s.dice);
  h.clickAt=()=>{inputs++;};h.drag=async()=>{inputs++;};
  h.requireHandObservation=()=>{};h.removalEvidenceBeforeReset=async()=>null;h.observe=async()=>clone(s);
  h.boardReady=true;h.expectedDice=T.total(s.dice);h.handProvenance=b.hand;
  h.choiceReceipt=clone(s.choiceReceipt);
  h.consumptionReceipt={id:a.id,index:a.index,target:a.target,beforeKey:T.boardKey(b),inputSent:true,
    sourceInstanceIds:b.hand[a.index].instanceIds.slice(),cost:T.cardCost(b,a,m),
    sourceCountProof:{count:native.inputCheck.expected,stableReads:2,source:native.inputCheck.sources.at(-1)}};
  return {T,h,b,s,a,m,inputs:()=>inputs};
}
module.exports=async function(test){
  await test("native countdown conversion confirms its source and preserves variant proof without resending",async()=>{
    const {T,h,b,s,a,m,inputs}=replay();
    assert.equal(T.cardTriggers(b.hand[a.index],m).known,false);
    assert.deepEqual(b.dice,{Pyro:0,Hydro:4,Anemo:0,Electro:0,Dendro:0,Cryo:1,Geo:0,Omni:0});
    assert.equal(T.verify(a,b,s),false,"same-name count alone cannot confirm");
    const result=await h.confirm(a,b,m);assert.equal(result.confirmed,true);
    assert.ok(result.hand.find(c=>c.id===a.id).instanceIds.every(id=>!b.hand[a.index].instanceIds.includes(id)));
    T.commit(m,a,b,result);assert.equal(m.countdownStock.countdown3,1);
    const cards=result.hand.map(c=>c.id===a.id?null:c),slots=result.hand.map((c,index)=>c.id===a.id?
      {index,titleCandidates:["countdown3","countdown2","countdown1","show"]}:{index,id:c.id});
    h.fillHandVariants(cards,slots,null);assert.ok(cards.every(Boolean));assert.equal(cards[5].id,"countdown3");
    assert.equal(h.confirmationSession,null);assert.equal(h.consumptionReceipt,null);
    assert.equal(inputs(),0);
  });
  await test("countdown proof rejects unrelated conversions, ambiguous refunds and unbound payment exits",async()=>{
    for(const mode of ["receipt","unexited","target","instance","badge","fee","no-conversion","refund","mixed-after","all-omni-before","transition","hp"]){
      const {T,h,b,s,a,m}=replay();h.confirmationSession={key:T.actionKey(a)+"/"+T.boardKey(b)};
      if(mode==="receipt")s.choiceReceipt.origin="other-action";
      if(mode==="unexited")s.choiceReceipt.exited=false;
      if(mode==="target")h.consumptionReceipt.target=0;
      if(mode==="instance")h.consumptionReceipt.sourceInstanceIds=[-1];
      if(mode==="badge")h.diceCountIn=()=>4;
      if(mode==="fee")h.consumptionReceipt.cost=null;
      if(mode==="no-conversion")s.dice={Hydro:3};
      if(mode==="refund")s.dice={Omni:4};
      if(mode==="mixed-after")s.dice={Omni:2,Hydro:1};
      if(mode==="all-omni-before"){
        b.dice={Omni:5};h.consumptionReceipt.beforeKey=T.boardKey(b);
        h.confirmationSession.key=T.actionKey(a)+"/"+T.boardKey(b);s.choiceReceipt.origin=h.confirmationSession.key;
      }
      if(mode==="transition")h.confirmationSession.transition=true;
      if(mode==="hp")s.characters[0].hp--;
      assert.equal(await h.provePaidDraw(a,b,s,m),false,mode);assert.equal(T.verify(a,b,s),false,mode);
    }
  });
};
