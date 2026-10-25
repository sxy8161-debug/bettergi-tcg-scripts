"use strict";
const assert = require("node:assert/strict");
const {load,board} = require("./runtime.cjs");
const card = (h,target=null) => ({type:"card",id:h.id,index:h.index,target});
function observed(T,id,index,cost=T.size(T.byId[id].cost),attachments={}) {
  return {...T.observedCard(T.byId[id].name,index),currentCost:cost,costSource:"native-expanded-cost-markers",
    attachments:{source:"native",reduction:0,increase:0,empowered:false,noTuning:false,effectless:false,...attachments},canTune:true};
}
function ready(T) {
  const m=T.freshMemory();m.round=2;m.bloomResolved=true;
  m.frost=T.fact({uses:1,damage:1},"confirmed-action");m.ripple=T.fact(1,"confirmed-action");return m;
}
module.exports = async function(test) {
  const {T}=load("moonbloom");
  await test("R02: tuning remains in the comparison when deep routes exhaust 240 projections",()=>{
    const s=board(T),m=ready(T);s.active=2;s.dice={Dendro:4,Pyro:1};
    s.hand=["seed","gambler","sashimi","shift"].map((id,i)=>observed(T,id,i));
    s.enemies=[4,10].map((hp,i)=>({hp,dead:false,active:i===0,auraKnown:true,aura:[]}));
    const before=JSON.stringify([s,m]),a=T.choose(s,m);
    assert.equal(JSON.stringify([s,m]),before);
    assert.equal(a.type,"tune");assert.equal(a.id,"gambler");
    assert.equal(a.funding.goal,T.actionKey(card(s.hand[0])));
    assert.equal(a.projections.limit,240);assert.ok(a.projections.used<=240);
  });
  await test("R06: a retained reduced card preserves enhancement; sleepy only discounts the first kernel",()=>{
    const s=board(T),m=T.freshMemory();s.active=1;s.dice={Hydro:3};
    s.hand=[observed(T,"sashimi",0,0,{reduction:1}),observed(T,"fruit",1,2,{reduction:1})];
    Object.assign(s.enemies[0],{aura:["Hydro"],auraKnown:true});m.lunarMinimum=T.fact(3,"confirmed-action");m.passiveUsed=true;
    const p=T.projectResources(s,m,card(s.hand[0],1));
    assert.equal(T.damageEstimate(p.state,p.memory,1,"NA").enhancedReady,true);
    assert.ok(T.cardScore(s,m,card(s.hand[0],1),T.axis(s,m))>0);
    const denied=JSON.parse(JSON.stringify(m));T.rejectAction(denied,card(s.hand[0],1),s);
    assert.equal(T.cardScore(s,denied,card(s.hand[0],1),T.axis(s,denied)),0,"a refused food has no afterFood enhancement");
    const k=board(T),n=ready(T);k.active=2;k.dice={Dendro:8};n.sleepy=2;
    k.hand=[observed(T,"sashimi",0),observed(T,"seed",1,3),observed(T,"seed",2,3)];
    const food=T.projectResources(k,n,card(k.hand[0],2)),first=T.projectResources(food.state,food.memory,card(food.state.hand[0]));
    assert.equal(first.memory.sleepy,0);assert.equal(first.state.hand[0].currentCost,5);
    assert.equal(T.projectResources(first.state,first.memory,card(first.state.hand[0])),null);
    assert.equal(T.cardScore(k,n,card(k.hand[0],2),T.axis(k,n)),0);
  });
  await test("R05 integration: Moonbloom candidate checks preserve the other instance and target",()=>{
    const s=board(T),m=T.freshMemory();s.active=2;s.dice={Dendro:5};
    s.hand=T.indexedHand([observed(T,"seed",0),observed(T,"seed",1,3,{reduction:2})]);
    T.rejectAction(m,card(s.hand[0]),s);
    const seeds=T.candidates(s,m,T.axis(s,m)).filter(a=>a.type==="card"&&a.id==="seed");
    assert.ok(seeds.some(a=>a.index===1));assert.ok(!seeds.some(a=>a.index===0));
    const heal=board(T),n=T.freshMemory();heal.characters[0].hp=heal.characters[1].hp=5;
    heal.hand=T.indexedHand([observed(T,"tea",0)]);T.rejectAction(n,card(heal.hand[0],0),heal);
    const targets=T.candidates(heal,n,T.axis(heal,n)).filter(a=>a.id==="tea");
    assert.ok(targets.some(a=>a.target===1));assert.ok(!targets.some(a=>a.target===0));
  });
};
