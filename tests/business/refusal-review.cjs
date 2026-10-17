"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
const copy=x=>JSON.parse(JSON.stringify(x));
const refused=(T,s,m,a)=>T.actionRefused(s,m,a);
module.exports=async function(test){
  await test("R05 host preserves blocked provenance across removal, insertion and ambiguous reread",()=>{
    const {T,Host}=load("raiden"),h=new Host({}),s=board(T,["draw","sweet","draw"]),m=T.freshMemory();h.trace=()=>{};
    h.acceptHand(s.hand,"initial");const a={type:"card",id:"draw",index:2,target:null};T.rejectAction(m,a,s);
    const removed=T.handPlan({type:"card",id:"sweet",index:1,target:0},s).hand;
    h.acceptHand(removed,"confirmed-remove");
    const shifted={...s,hand:copy(removed)};
    assert.equal(refused(T,shifted,m,{...a,index:1}),true,"removal must not re-enable the refused copy");
    assert.equal(refused(T,shifted,m,{...a,index:0}),false,"surviving unrelated copy remains usable");
    h.invalidateHand("full-read");
    const fresh=board(T,["draw","sweet","draw","draw"]).hand;h.acceptHand(fresh,"observed-full");
    assert.ok(fresh.filter(c=>c.id==="draw").every(c=>refused(T,{...s,hand:fresh},m,{...a,index:c.index})),
      "unresolved identical insertions retain all possible refused origins");
    assert.ok(fresh.filter(c=>c.id==="draw").every(c=>c.instanceAmbiguous===true));
    h.acceptHand([],"confirmed-empty");
    const newHand=board(T,["draw"]).hand;h.acceptHand(newHand,"new-card-after-empty");
    assert.equal(refused(T,{...s,hand:newHand},m,{...a,index:0}),false,"proved absence ends the old instance lineage");
    T.nextRound(m);assert.ok(fresh.every(c=>!refused(T,{...s,hand:fresh},m,{...a,index:c.index,id:c.id})));
  });
  await test("R05 actual native rejection recovery preserves duplicate row continuity",async()=>{
    const {T,Host,Player}=load("raiden"),h=new Host({}),s=board(T,["wovenThunder","wovenThunder"]),
      p=new Player(h,{maxMinutes:15}),a={type:"card",id:"wovenThunder",index:0,target:null};
    h.trace=()=>{};h.acceptHand(s.hand,"initial");
    h.readHand=async()=>board(T,["wovenThunder","wovenThunder"]).hand;
    h.observe=async(_full,plan)=>{
      assert.ok(T.actionRefused(s,p.memory,a),"refusal must precede the recovery observation");
      const hand=await h.observedHand(plan);h.acceptHand(hand,"native-rejection-resync");return {...s,hand};
    };
    assert.equal(await p.recoverRejectedInput(Object.assign(Error("native refusal"),{code:"TCG_INPUT_REJECTED"}),a,s,{}),true);
    assert.equal(T.actionRefused(p.readyState,p.memory,a),true);
    assert.equal(T.actionRefused(p.readyState,p.memory,{...a,index:1}),false);
    assert.ok(T.strategyEligible(p.readyState,p.memory).some(x=>x.type==="card"&&x.index===1));
  });
  await test("R05 native cost and attachments distinguish copies; uncertain cost changes stay blocked",()=>{
    const {T,Host}=load("moonbloom"),h=new Host({}),s=board(T,["seed","seed"]),m=T.freshMemory();h.trace=()=>{};h.memory=m;
    const facts=(n)=>({currentCost:n,attachments:{source:"native",empowered:false,noTuning:false,effectless:false,reduction:5-n,increase:0}});
    Object.assign(s.hand[0],facts(0));Object.assign(s.hand[1],facts(5));h.acceptHand(s.hand,"native-facts");
    const a={type:"card",id:"seed",index:0,target:null};T.rejectAction(m,a,s);
    const hand=board(T,["seed","seed"]).hand;
    Object.assign(hand[0],facts(5));Object.assign(hand[1],facts(0));h.invalidateHand("reread");h.acceptHand(hand,"native-reread");
    assert.equal(T.actionRefused({...s,hand},m,{...a,index:0}),false);
    assert.equal(T.actionRefused({...s,hand},m,{...a,index:1}),true);
    const repriced={...s,hand:copy(s.hand)};Object.assign(repriced.hand[0],facts(1));
    assert.equal(T.actionRefused(repriced,m,a),false,"positive refusal conditions changed natively");
    T.deferUncertain(m,a,s);assert.equal(T.actionRefused(repriced,m,a),true,"unknown outcome cannot be replayed after repricing");
    const unknownHand=board(T,["seed"]).hand;Object.assign(unknownHand[0],facts(2));h.acceptHand(unknownHand,"unknown-outcome-reread");
    assert.equal(T.actionRefused({...s,hand:unknownHand},m,a),true,"possible transformed uncertain origin remains blocked");
  });
  await test("R05 semantic skill conditions ignore dice property order and unrelated HP",()=>{
    const {T}=load("raiden"),s=board(T),m=T.freshMemory(),a={type:"skill",who:0,skill:"E"};
    s.dice={Omni:2,Electro:1};s.characters[0].frozen=true;T.rejectAction(m,a,s);
    const changed=copy(s);changed.dice={Electro:1,Omni:2};changed.characters[1].hp--;
    assert.equal(T.actionRefused(changed,m,a),true);
    changed.characters[0].frozen=false;assert.equal(T.actionRefused(changed,m,a),false);
    T.deferUncertain(m,a,s);assert.equal(T.actionRefused(changed,m,a),true);
  });
};
