"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs"),native=require("./fixtures/moon-countdown-native-20261017.json");
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
  await test("read-only card facts survive board recovery without repeating inspection or crossing slots",async()=>{
    // Native slot07 lines450-496: canopy cost0 was replaced by pre-probe null
    // during enemy-only refresh, then the same instance was inspected again.
    // Scripted reader outputs exercise production probe/guard/recovery/observe.
    for(const mode of ["fee","markers","count-change","phase-exit"]){
      const {T,Host,Player}=load("moonbloom"),h=new Host({}),p=new Player(h,{}),
        before=board(T,["canopy","canopy"]),events=[];
      before.hand=before.hand.map((c,i)=>({...c,instanceIds:[37+i],currentCost:null,
        attachments:{source:"unknown",empowered:null},canTune:false}));
      let live=clone(before),inspections=0,fullReads=0;
      const a={type:"probe",scope:"card",id:"canopy",index:0,
        ...(mode==="markers"?{requirement:"empowerment-row"}:{}),key:"initial-probe"};
      h.memory=p.memory;h.boardReady=true;
      h.trace=(event,data)=>events.push({event,data});h.frame=fn=>fn({});
      h.phase=h.phaseIn=()=>({phase:live.phase,turn:live.turn});
      h.board=h.initialObservationBoard=()=>clone(live);
      h.handPoints=n=>Array.from({length:n},(_,i)=>100+i*100);
      h.handCountIn=()=>live.hand.length;h.collapsedLayoutIn=()=>({status:"unreadable"});
      h.prepareHandInput=async()=>{h.handFanReady=true;return null;};
      h.inspectHandCard=async(_a,x)=>{inspections++;h.cardDetails.set(x,{id:"canopy",cost:0,
        attachments:{source:"native",reduction:0,increase:0,empowered:false,noTuning:false,effectless:false},canTune:true});};
      h.prepareHandObservation=async()=>{h.factPoints=h.handPoints(2);h.feeSample={costs:[0,null],empowered:[true,false]};};
      h.reset=async()=>{
        h.handFanReady=false;h.handNeedsReset=false;h.inputRevision++;
        live.enemies[0].aura=["Dendro"];live.enemies[0].auraKnown=true;
        if(mode==="count-change")live.hand=board(T,["draw"]).hand;
        if(mode==="phase-exit")live.turn="enemy";
      };
      h.readHand=async()=>{fullReads++;return clone(live.hand);};
      h.clickAt=h.drag=()=>{throw Error("Read-only probe/recovery must not submit a card or skill");};
      const execution=await p.execute(a,before);
      assert.equal(execution.sent,false,"changed board still enters existing recovery");
      assert.equal(events.some(e=>e.event==="input-submitted"),false);
      assert.ok(events.some(e=>e.event==="execution-deferred"));
      if(mode==="phase-exit")assert.equal(p.readyState,null,"enemy turn cannot become a ready decision");
      else if(mode==="count-change"){
        assert.equal(fullReads,1);assert.equal(p.readyState.hand[0].id,"draw");
        assert.notEqual(p.readyState.hand[0].currentCost,0,"old facts cannot fill a replacement hand");
      }else{
        const hand=p.readyState.hand;
        assert.equal(hand[0].currentCost,0);
        assert.equal(hand[0].attachments.empowered,mode==="markers");
        assert.equal(hand[1].currentCost,null,"same-name neighbour was not inspected");
        assert.deepEqual(clone(hand.map(c=>c.instanceIds)),[[37],[38]]);
        assert.deepEqual(clone(p.readyState.enemies[0].aura),["Dendro"],"fresh board, not old snapshot");
        assert.equal(fullReads,0);assert.equal(inspections,mode==="markers"?0:1);
        if(mode==="fee"){
          assert.equal(T.cardFactsKnown(hand[0]),true,"planner does not need the same payment probe again");
          h.cardDetails.set(100,{id:"canopy",cost:1,attachments:clone(hand[0].attachments),canTune:true});
          await assert.rejects(h.checkCardInput({type:"card",id:"canopy",index:0,target:null},p.readyState,100,p.memory),
            e=>e.code==="TCG_STATE_REFRESH","a newly changed selected fee still blocks input");
          assert.equal(p.readyState.hand[0].currentCost,1);
        }
      }
    }
  });
};
