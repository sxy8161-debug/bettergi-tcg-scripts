"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
module.exports=async function(test){

  await test("R01 late soup page stays pending; selection once; receipt cleared after confirmation",async()=>{
    let now=2000,clicks=0,reads=0;class Clock extends Date{static now(){return now;}}
    const {T,Host}=load("iansan",{Date:Clock,sleep:async n=>{now+=n;}}),h=new Host({}),b=board(T,["soup"]),
      a={type:"card",id:"soup",index:0,target:1};
    h.trace=()=>{};h.actionSubmittedAt=0;h.boardReady=true;h.currentAction=null;h.matchDeadline=7000;
    const choice={phase:"choice",choiceKind:"soup",recognized:true,
      options:["疗愈","助佑","鼓舞"].map((s,i)=>{const id="奇瑰之汤·"+s;return {id,effect:T.soupOptions[id],point:[500+i*300,540]};})};
    h.phase=()=>now>=2500&&!clicks?choice:{phase:"board",turn:"user"};
    h.clickAt=()=>{clicks++;};h.requireHandObservation=()=>{};h.removalEvidenceBeforeReset=async()=>null;
    h.reset=async()=>{h.handNeedsReset=false;h.handFanReady=false;h.boardReady=true;};
    h.observe=async()=>{reads++;return {...b,dice:{Omni:2},hand:[],handRead:"full",soupReceipt:h.soupReceipt};};
    h.diceBudgetMatches=()=>true;
    const c=await h.confirm(a,b,T.freshMemory());
    assert.equal(c.confirmed,true);assert.ok(reads>=3);assert.equal(clicks,1);
    assert.equal(c.soupReceipt.origin,T.actionKey(a)+"/"+T.boardKey(b));assert.equal(c.soupReceipt.target,1);
    assert.equal(c.soupReceipt.exited,true);assert.equal(h.soupReceipt,null);assert.equal(h.confirmationSession,null);
    // An unresolved soup remains owned through the bounded observation timeout.
    h.soupReceipt=null;h.actionSubmittedAt=0;h.phase=()=>({phase:"board",turn:"user"});h.matchDeadline=now+500;
    await assert.rejects(()=>h.confirm(a,b,T.freshMemory()),e=>e.code==="TCG_CONFIRMATION_RETRY");
    assert.ok(h.confirmationSession);assert.equal(clicks,1);
  });

};
