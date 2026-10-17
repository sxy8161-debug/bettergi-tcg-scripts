"use strict";
const assert = require("node:assert/strict");
const {load, board} = require("./runtime.cjs");
const clone = x => JSON.parse(JSON.stringify(x));
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-9, `${actual} != ${expected}`);

module.exports = async function(test) {
  const {T} = load("raiden");
  const equip = {type:"card",id:"gambler",index:0,target:2};
  const skill = {type:"skill",who:2,skill:"E"};
  function fixture() {
    const s=board(T,["gambler"]),m=T.freshMemory();
    T.nextRound(m);
    // Establish burst history through production commit, including Keqing's +2.
    const before=board(T);before.characters[0].energy=2;
    const after=clone(before);after.characters[0].energy=0;
    after.characters[1].energy=2;after.characters[2].energy=2;
    T.commit(m,{type:"skill",who:0,skill:"Q"},before,after);
    after.active=1;const collei=clone(after);collei.characters[1].energy=0;
    T.commit(m,{type:"skill",who:1,skill:"Q"},after,collei);
    s.characters=collei.characters;s.active=2;s.dice={Omni:4};
    // Match native output: empty standby aura is unknown, defense is absent.
    s.enemies=[{hp:1,dead:false,active:true,auraKnown:true,aura:["Dendro"]},
      {hp:10,dead:false,active:false,auraKnown:false,aura:[]}];
    return {s,m};
  }
  function equipped(s,m) {const p=T.projectedAction(s,m,equip);assert.ok(p);return p;}
  function compare(s,m,action=skill) {
    const plain=clone(m);plain.artifactKinds[2]=null;plain.artifacts[2]=false;
    const p=T.projectedAction(s,m,action),q=T.projectedAction(s,plain,action);
    assert.ok(p&&q);return {p,bonus:p.benefit-q.benefit};
  }

  await test("R03 native-shaped gambler enters the main planner after payment",()=>{
    const {s,m}=fixture(),snapshot=JSON.stringify([s,m]);
    assert.equal(T.legalState(s),true);assert.equal(T.cardLegal(s,equip,m),true);
    assert.equal(Object.hasOwn(s.enemies[0],"defenseKnown"),false);
    const eligible=T.strategyEligible(s,m).some(a=>a.id==="gambler"),chosen=T.choose(s,m);
    console.log("R03 planner "+JSON.stringify({eligible,sequence:chosen.planning.sequence,value:chosen.planning.value,terminal:chosen.planning.terminal}));
    assert.equal(eligible,true);assert.equal(chosen.id,"gambler");
    assert.equal(chosen.planning.sequence.join(","),"card:gambler,skill:2:E");
    const p=equipped(s,m);assert.equal(T.actionKey(T.intent(s,m)),T.actionKey(T.intent(p.state,p.memory)));
    assert.equal(JSON.stringify([s,m]),snapshot);
    s.dice={Omni:3};assert.equal(T.strategyEligible(s,m).some(a=>a.id==="gambler"),false);
  });

  await test("R03 nominal refunds score once without becoming spendable dice",()=>{
    const {s,m}=fixture(),setup=equipped(s,m),{p,bonus}=compare(setup.state,setup.memory);
    console.log("R03 nominal "+JSON.stringify({bonus,dice:p.state.dice,provenFinish:p.provenFinish}));
    close(bonus,.62);assert.equal(T.total(p.state.dice),0);assert.equal(p.provenFinish,false);
    assert.equal(T.skillLegal(p.state,{who:2,skill:"NA"},p.memory),false);
    assert.equal(p.memory.gamblerUsed[2],1);assert.equal(m.gamblerUsed[2],0);
    // A turn-passing switch discounts the same skill settlement bonus by .9.
    const start=clone(setup.state);start.active=0;start.dice={Omni:4};
    start.characters[0].frozen=true;start.characters[1].frozen=true;
    const mem=clone(setup.memory);
    const plain=clone(mem);plain.artifactKinds[2]=null;
    close(T.plan(start,mem,{depth:2}).value-T.plan(start,plain,{depth:2}).value,.62*.9);
  });

  await test("R03 known shield and guaranteed refunds use actual damage and resources",()=>{
    const {s,m}=fixture(),setup=equipped(s,m);
    setup.state.enemies[0].defenseKnown=true;setup.state.enemies[0].shield=10;
    let result=compare(setup.state,setup.memory);close(result.bonus,0);
    assert.equal(T.total(result.p.state.dice),0);assert.equal(result.p.memory.gamblerUsed[2],0);
    s.enemies[0].defenseKnown=true;s.enemies[0].shield=10;
    assert.equal(T.strategyEligible(s,m).some(a=>a.id==="gambler"),false);
    setup.state.enemies[0].shield=0;result=compare(setup.state,setup.memory);
    close(result.bonus,0);assert.equal(result.p.state.dice.Omni,2);
    assert.equal(result.p.memory.gamblerUsed[2],1);assert.equal(result.p.provenFinish,false);
    // Guaranteed dice have the existing .31 resource value, without nominal credit.
    const plain=clone(setup.memory);plain.artifactKinds[2]=null;
    close(T.plan(setup.state,setup.memory,{depth:1}).value-T.plan(setup.state,plain,{depth:1}).value,.62);
  });

  await test("R03 trigger limits, capacity and mixed certainty never double count",()=>{
    const {s,m}=fixture();s.hand=[];s.dice={Omni:16};s.characters[2].energy=3;
    s.enemies=[1,3,3,10].map((hp,i)=>({hp,dead:false,active:i===0,auraKnown:true,aura:[]}));
    m.artifactKinds[2]="gambler";const burst={type:"skill",who:2,skill:"Q"};
    let result=compare(s,m,burst);close(result.bonus,4*.31);assert.equal(T.total(result.p.state.dice),12);
    m.gamblerUsed[2]=2;result=compare(s,m,burst);close(result.bonus,2*.31);
    m.gamblerUsed[2]=3;result=compare(s,m,burst);close(result.bonus,0);
    m.gamblerUsed[2]=0;s.dice={Omni:15};
    s.enemies[0].defenseKnown=true;s.enemies[1].defenseKnown=true;
    result=compare(s,m,burst);close(result.bonus,.31);assert.equal(T.total(result.p.state.dice),15);
    s.enemies[2].defenseKnown=true;result=compare(s,m,burst);
    close(result.bonus,0);assert.equal(T.total(result.p.state.dice),16);
  });

  await test("R03 no future target means no nominal value; only proven finishes are terminal",()=>{
    const {s,m}=fixture();s.enemies=s.enemies.slice(0,1);
    const setup=equipped(s,m),result=compare(setup.state,setup.memory);
    close(result.bonus,0);assert.equal(result.p.provenFinish,false);
    assert.equal(T.choose(s,m).planning.terminal,false);
    s.enemies[0].defenseKnown=true;s.enemies[0].shield=0;
    const chosen=T.choose(s,m);assert.equal(chosen.type,"skill");assert.equal(chosen.planning.terminal,true);
    assert.equal(chosen.planning.sequence.length,1);
  });
};

