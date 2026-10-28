"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs"),native=require("./fixtures/moon-countdown-native-20261017.json");
const clone=x=>JSON.parse(JSON.stringify(x));
function replay(data=native){
  let inputs=0;
  const {T,Host}=load("moonbloom"),h=new Host({}),b=clone(data.before),s=clone(data.after),
    a=clone(data.action),m=Object.assign(T.freshMemory(),clone(data.memory));
  h.memory=m;h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});h.trace=()=>{};
  h.frame=fn=>fn({});h.diceIn=()=>({dice:s.dice});h.diceCountIn=()=>T.total(s.dice);
  h.clickAt=()=>{inputs++;};h.drag=async()=>{inputs++;};
  h.requireHandObservation=()=>{};h.removalEvidenceBeforeReset=async()=>null;h.observe=async()=>clone(s);
  h.boardReady=true;h.expectedDice=T.total(s.dice);h.handProvenance=b.hand;
  h.choiceReceipt=clone(s.choiceReceipt);
  h.consumptionReceipt={id:a.id,index:a.index,target:a.target,beforeKey:T.boardKey(b),inputSent:true,
    sourceInstanceIds:b.hand[a.index].instanceIds.slice(),cost:T.cardCost(b,a,m),
    sourceCountProof:{count:data.inputCheck.expected,stableReads:2,source:data.inputCheck.sources.at(-1)}};
  return {T,h,b,s,a,m,inputs:()=>inputs};
}
module.exports=async function(test){
  await test("a source-bound Countdown redraw confirms with its known Research basic-die refund and commits once",async()=>{
    // Slot04,2026-10-26T16:48:33.063Z:7 dice pay3,4 convert to Omni,
    // Research returns one Hydro, and a new copy of Countdown3 is drawn.
    const {T}=load("moonbloom"),b=board(T,["seed","seed","seed","fan","lumen","countdown3","sashimi"]),
      a={type:"card",id:"countdown3",index:5,target:null};
    b.dice={Hydro:1,Electro:1,Dendro:4,Geo:1};
    b.hand=b.hand.map((h,index)=>({...h,currentCost:[5,4,5,2,1,3,0][index],costSource:"native-folded-cost-markers",instanceIds:[100+index],
      attachments:index===5?{source:"native",reduction:0,increase:0,empowered:false,noTuning:false,effectless:false}:h.attachments}));
    const s=clone(b);s.handRead="full";s.dice={Hydro:1,Omni:4};s.hand=board(T,["seed","seed","seed","fan","lumen","gleam","countdown3","meditation","research","sashimi"]).hand
      .map((h,index)=>({...h,currentCost:[5,4,5,2,1,0,2,1,0,0][index],instanceIds:[200+index]}));
    s.choiceReceipt={origin:T.actionKey(a)+"/"+T.boardKey(b),id:a.id,kind:"payment",exited:true};
    const data={before:b,after:s,action:a,memory:{researchRemaining:2,canopyPoints:[2,2],countdownStock:{countdown3:2}},
      inputCheck:{expected:7,sources:["native-badge"]}},f=replay(data);
    assert.equal(f.T.verify(f.a,f.b,f.s),false,"same-name count needs the existing paid-draw proof");
    const result=await f.h.confirm(f.a,f.b,f.m);assert.equal(result.confirmed,true);
    f.T.commit(f.m,f.a,f.b,result);assert.equal(f.m.researchRemaining,1);assert.equal(f.m.countdownStock.countdown3,1);
    assert.equal(f.inputs(),0,"confirmation must not resend the card");
    for(const [dice,remaining]of [[{Omni:4},2],[{Omni:4,Hydro:2},2],[{Omni:5},2],[{Omni:4,Hydro:1},null]]){
      const rejected=replay(data);rejected.s.dice=dice;rejected.m.researchRemaining=remaining;
      assert.equal(rejected.T.drawPaymentMatches(rejected.b,rejected.a,rejected.s,rejected.m,{aligned:3},false),false);
    }
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
