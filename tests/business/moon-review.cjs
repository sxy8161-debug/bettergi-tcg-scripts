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
  await test("R06: consuming the sole reduced sashimi must prefer the already enhanced NA",()=>{
    const s=board(T),m=T.freshMemory();s.active=1;s.dice={Hydro:3};
    s.hand=[observed(T,"sashimi",0,0,{reduction:1})];Object.assign(s.enemies[0],{aura:["Hydro"],auraKnown:true});
    m.lunarMinimum=T.fact(3,"confirmed-action");m.passiveUsed=true;
    const before=JSON.stringify([s,m]),food=card(s.hand[0],1),p=T.projectResources(s,m,food),
      direct=T.damageEstimate(s,m,1,"NA"),after=T.damageEstimate(p.state,p.memory,1,"NA"),
      score=T.cardScore(s,m,food,T.axis(s,m)),a=T.choose(s,m);
    assert.equal(JSON.stringify([s,m]),before);
    assert.equal(direct.enhancedReady,true);assert.equal(after.enhancedReady,false);
    assert.equal(direct.direct,3);assert.equal(after.direct,2);
    assert.equal(score,0);assert.equal(a.type,"skill");assert.equal(a.skill,"NA");
  });
  await test("R02: a full hand covers skills, cards, switches, probes and one-tune hits before deep expansion",()=>{
    const s=board(T),m=T.freshMemory();s.active=2;s.dice={Dendro:4,Hydro:4,Pyro:4,Omni:4};
    s.characters.forEach(c=>c.energy=2);s.characters[2].hp=3;
    s.hand=["seed","gambler","sashimi","shift","fruit","calx","meditation","lumen","ray","draw"]
      .map((id,i)=>observed(T,id,i));s.hand[9].currentCost=null;
    s.enemies=[20,20,20].map((hp,i)=>({hp,dead:false,active:i===0,auraKnown:true,aura:[]}));
    const before=JSON.stringify([s,m]),values=new Map(),first=[],project=T.projectResources;
    let granted=0,rootCards=0;
    T.projectResources=(state,memory,a)=>{
      if(T.projectionBudget.available())granted++;
      if(state===s&&memory===m&&a.type==="card")rootCards++;
      return project(state,memory,a);
    };
    try {
      const result=T.projectionBudget.run(240,()=>{
        const ranked=T.candidates(s,m,T.axis(s,m),true,values),categories=new Set(ranked.map(a=>a.type));
        for(const type of ["skill","card","switch","probe"])assert.ok(categories.has(type),type);
        for(const h of s.hand)for(const target of T.characterTarget(T.byId[h.id])?[0,1,2]:[null]){
          const a=card(h,target);if(T.cardLegal(s,a,m))assert.ok(values.get(JSON.stringify(a))?.projection,h.id+":"+target);
        }
        const cards=rootCards,tune=T.tuningPlan(s,m,values,true,first);
        assert.ok(tune);assert.equal(rootCards,cards,"tuning reuses completed material scores");
        const routes=T.resourceRoutes(s,m);assert.equal(routes.truncated,true);
        const retained=T.tuningPlan(s,m,values,false,first);
        assert.ok(retained);assert.equal(retained.id,tune.id);assert.equal(retained.score,tune.score);
        const after=T.candidates(s,m,T.axis(s,m),false,values);
        for(const a of ranked)
          assert.ok(after.some(b=>T.actionKey(a)===T.actionKey(b)),"exhaustion dropped "+T.actionKey(a));
        return {type:"end"};
      });
      assert.equal(result.projections.limit,240);assert.equal(result.projections.used,granted);
      assert.ok(granted<=240);
    } finally {T.projectResources=project;}
    assert.equal(JSON.stringify([s,m]),before);
    const a=T.choose(s,m);assert.notEqual(a.type,"end");assert.ok(a.projections.used<=240);
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
