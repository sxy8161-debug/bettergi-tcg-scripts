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
  await test("R01 commit-before HP read admits only matching exited maxHP receipt",()=>{
    const {T,Host}=load("iansan"),h=new Host({}),b=board(T,["soup"]);h.trace=()=>{};
    h.has=()=>false;h.matches=()=>[];
    for(const target of [0,1]){
      const a={type:"card",id:"soup",index:0,target},key=T.actionKey(a)+"/"+T.boardKey(b);
      h.memory=T.freshMemory();h.confirmationSession={key,plan:{action:a,before:b}};
      h.hpAt=(f,x,y)=>y===600?String(T.team[target].maxHp+1):"";
      h.soupReceipt={origin:key,target,effect:"maxhp",exited:true};
      assert.equal(h.characterIn({},target).hp,T.team[target].maxHp+1);
      h.soupReceipt.origin="wrong";assert.equal(h.characterIn({},target).hp,null);
      h.soupReceipt.origin=key;h.soupReceipt.exited=false;assert.equal(h.characterIn({},target).hp,null);
    }
  });

  await test("R04 Player confirms consumption, refreshes late draw and keeps unrelated buffs",async()=>{
    let now=0,sent=0;class Clock extends Date{static now(){return now;}}
    const {T,Host,Player}=load("iansan",{Date:Clock,sleep:async n=>{now+=n;}}),h=new Host({}),p=new Player(h,{maxMinutes:1}),
      b=board(T,["draw","sweet","sweet"]);
    b.dice={Omni:1};b.characters.forEach(c=>{c.frozen=true;});
    Object.assign(p.memory,{freeSwitch:true,manchai:2,garden:true,soupDiscount:[2,0,0]});
    const c={...b,dice:{Omni:0},hand:T.indexedHand(b.hand.slice(1)),handRead:"full"};
    assert.equal(T.choose(b,p.memory).id,"draw");
    assert.equal(T.verify({type:"card",id:"draw",index:0,target:null},b,{...c,hand:b.hand}),false);
    p.observe=async()=>b;p.progress=()=>{};h.trace=()=>{};h.phase=()=>({phase:"board",turn:"user"});
    h.executeInput=async()=>{sent++;};h.observe=async()=>c;h.requireHandObservation=()=>{};
    h.removalEvidenceBeforeReset=async()=>null;h.diceBudgetMatches=()=>true;h.boardReady=true;
    await p.act();
    assert.equal(sent,1);assert.equal(p.memory.freeSwitch,true);assert.equal(p.memory.manchai,2);
    assert.equal(p.memory.garden,true);assert.equal(p.memory.soupDiscount[0],2);
    assert.equal(p.readyState,null);assert.equal(h.handCache,null);
  });
  await test("R04 only affected skill discounts become unknown and native fee probing is bounded",()=>{
    const {T}=load("iansan"),b=board(T),m=T.freshMemory();T.nextRound(m);
    Object.assign(m,{freeSwitch:true,garden:true,manchai:2,soupDiscount:[2,1,0]});
    T.deferUncertain(m,{type:"skill",who:0,skill:"E"},b);
    assert.equal(m.soupDiscount[0],null);assert.equal(m.soupDiscount[1],1);
    assert.equal(m.garden,true);assert.equal(m.freeSwitch,true);assert.equal(m.manchai,2);
    b.dice={Electro:2};assert.equal(T.skillLegal(b,{type:"skill",who:0,skill:"E"},m),false);
    const a=T.choose(b,m);assert.equal(a.type,"probe");assert.equal(a.skill,"E");
    T.recordSkillCost(b,m,a,null);assert.notEqual(T.choose(b,m).key,a.key);
    T.recordSkillCost(b,m,a,1);
    assert.equal(T.skillLegal(b,{type:"skill",who:0,skill:"E"},m),true);
  });
};
