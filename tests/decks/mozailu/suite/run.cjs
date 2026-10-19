"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT||path.resolve(__dirname,"../../../../build/mozailu");
const report=process.env.TCG_TEST_REPORT||path.resolve(__dirname,"../../../../reports/mozailu-latest.json");
async function run(test,loadContext=overrides=>load(root,overrides)) {
const C=loadContext(),T=C.TCG;
const memory=()=>Object.assign(T.freshMemory(),{round:1});
const enemy=(hp=10,active=true,aura=[])=>({hp,active,dead:false,aura,auraKnown:true,shield:0,defenseKnown:true,immuneElements:[]});
const board=(ids=[],active=0)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},
  hand:T.indexedHand(ids.map((id,i)=>T.observedCard(T.byId[id].name,i))),
  characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),enemies:[enemy(30)]});
const card=(s,id,target=null)=>({type:"card",id,index:s.hand.findIndex(h=>h.id===id),target});
  await test("first complete board uses the real deck adapter without fabricated hooks",()=>{
    const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({});
    const s=board();s.characters.forEach((character,i)=>character.raised=i===s.active);
    s.enemies=[enemy(8),enemy(10,false),enemy(10,false),enemy(8,false)];
    // Supply only the pixel-reader results. Keep board() and its deck hooks real.
    h.frame=fn=>fn({});h.phaseIn=()=>({phase:s.phase,turn:s.turn});
    h.characterIn=(_,i)=>clone(s.characters[i]);h.enemiesIn=()=>clone(s.enemies);
    h.diceIn=()=>({dice:clone(s.dice)});h.diceCountIn=()=>8;
    const observed=h.initialObservationBoard();
    assert.equal(observed.active,0);assert.equal(observed.diceKnown,true);
    assert.deepEqual(clone(observed.characters),clone(s.characters));
    assert.deepEqual(clone(observed.enemies),s.enemies);assert.deepEqual(clone(observed.dice),s.dice);
    assert.equal(observed.hand,null);assert.equal(inputs.length,0);
  });
  await test("exact team, 30 cards, generated countdowns and independent native title identities",()=>{
    assert.deepEqual(clone(T.team.map(c=>c.name)),["莫娜","早柚","迪卢克"]);
    assert.equal(T.cards.reduce((n,c)=>n+c.copies,0),30);
    for(const c of T.cards)assert.equal(T.identify(c.name).id,c.id);
    assert.equal(T.identify("流火"),null);
    assert.equal(T.byId.flowingFlame.combatSkill.who,2);
    assert.equal(T.byId.skivingNewAndImproved.combatSkill.who,1);
  });
  await test("Diluc second and third E discount, third E damage, reset, and four-die Q",()=>{
    const s=board([],2),m=memory();m.talents[2]=true;s.characters[2].energy=3;
    const costs=[],damage=[];
    for(let i=0;i<4;i++) {costs.push(T.size(T.skillCost(2,"E",m,s)));damage.push(T.damageEstimate(s,m,2,"E").base);T.commit(m,{type:"skill",who:2,skill:"E"},s,s);}
    assert.deepEqual(costs,[3,2,2,3]);assert.deepEqual(damage,[3,3,5,3]);
    s.dice={Pyro:3};assert.equal(T.skillLegal(s,{who:2,skill:"Q"},m),false);
    s.dice={Pyro:4};assert.equal(T.skillLegal(s,{who:2,skill:"Q"},m),true);
    T.nextRound(m);assert.equal(m.dilucE,0);assert.equal(T.size(T.skillCost(2,"E",m,s)),3);
  });
  await test("playing a talent is not paying the discounted skill twice",()=>{
    const s=board(["flowingFlame"],2),m=memory();m.talents[2]=true;m.dilucE=1;m.troupe[2]=1;
    assert.equal(T.size(T.skillCost(2,"E",m)),1);
    assert.equal(T.size(T.cardCost("flowingFlame",2,m)),2);
    assert.equal(T.cardLegal(s,card(s,"flowingFlame",1),m),false);
    T.commit(m,card(s,"flowingFlame",2),s,{...s,hand:[]});assert.equal(m.dilucE,2);assert.equal(m.troupe[2],0);
  });
  await test("Mona bubble multiplies character hit including vaporize, not swirl splash or future kick",()=>{
    const s=board([],2),m=memory();s.enemies=[enemy(20,true,["Hydro"])];m.bubble=true;m.weaponKinds[2]="wolf";m.weapons[2]=true;
    assert.equal(T.damageEstimate(s,m,2,"Q").direct,22);
    s.enemies=[enemy(10,true,["Hydro"]),enemy(10,false)];
    const e=T.damageEstimate(s,m,1,"E");assert.equal(e.direct,2);assert.equal(e.splash[0].direct,1);assert.equal(e.prepared,2);
    T.commit(m,{type:"skill",who:2,skill:"Q"},s,s);assert.equal(m.bubble,false);assert.equal(m.pyroInfusion,2);
    assert.equal(T.damageEstimate(s,m,2,"NA").element,"Pyro");T.nextRound(m);T.nextRound(m);assert.equal(T.damageEstimate(s,m,2,"NA").element,"Physical");
  });
  await test("known shield and immunity affect damage; prepared output cannot prove immediate lethal",()=>{
    const s=board([],1),m=memory();s.enemies=[enemy(3)];
    const p=T.project(s,m,{type:"skill",who:1,skill:"E"});assert.equal(p.terminal,false);assert.equal(p.stop,true);
    s.enemies[0].shield=2;assert.equal(T.damageEstimate(s,m,2,"E").direct,1);
    s.enemies[0].immuneElements=["Pyro"];assert.equal(T.damageEstimate(s,m,2,"E").direct,0);
    s.enemies[0].defenseKnown=false;assert.equal(T.damageEstimate(s,m,2,"E").guaranteed,null);
    s.enemies[0]=enemy(10);s.enemies[0].frozen=true;
    assert.equal(T.damageEstimate(s,m,2,"E").direct,5);
    assert.equal(T.damageEstimate(s,m,2,"NA").direct,4);
    s.enemies[0]=enemy(10);s.enemies[0].shield=1;
    const e=T.damageEstimate(s,m,1,"E");assert.equal(e.direct,0);assert.equal(e.prepared,2);
    s.enemies[0].active=false;assert.equal(T.damageEstimate(s,m,1,"E").total,0);
    assert.equal(T.damageEstimate(s,m,1,"E").prepared,0);
  });
  await test("Mona fast switch is once per round and not a free switch",()=>{
    const s=board(),m=memory();assert.equal(T.size(T.switchCost(m)),1);
    T.commit(m,{type:"switch",target:1},s,{...s,active:1});assert.equal(m.monaFastUsed,true);
    T.commit(m,{type:"switch",target:0},{...s,active:1},s);assert.equal(m.fastSwitch,false);
    T.nextRound(m);assert.equal(m.monaFastUsed,false);
    m.freeSwitch=true;assert.equal(T.size(T.switchCost(m)),0);
  });
  await test("equipment reducers and capped refunds consume only after confirmed play; Lyre is not discard",()=>{
    const s=board(["gilded","lyre"],1),m=memory();m.garden=true;m.boar=2;m.artifacts[1]=true;m.artifactKinds[1]="troupe";
    const a=card(s,"gilded",1),before=JSON.stringify(m);
    assert.equal(T.size(T.cardCost(a.id,a.target,m)),1);assert.equal(JSON.stringify(m),before);
    assert.deepEqual(clone(T.cardRefund(a,m,s)),{Anemo:2,Omni:1});
    T.commit(m,a,s,{...s,hand:s.hand.slice(1)});assert.equal(m.garden,false);assert.equal(m.boar,1);
    T.commit(m,card(s,"lyre",1),s,s);assert.equal(m.boar,1);assert.equal(m.lyre,1);assert.equal(m.artifactKinds[1],null);
    s.dice={Omni:16};m.garden=true;m.lyre=0;assert.equal(T.total(T.cardRefund(a,m,s)),1);
  });
  await test("Timaeus stock and partner discount are confirmed-action state, not invented draws",()=>{
    const s=board(["timaeus","gilded"]),m=memory();m.supports=[{id:"dunyarzad",round:-1,drawUsed:false}];m.supportSlots=1;
    assert.equal(T.size(T.cardCost("timaeus",null,m)),1);
    T.commit(m,card(s,"timaeus"),s,s);assert.equal(m.supports[0].drawUsed,true);assert.equal(m.supports[1].materials,2);
    T.nextRound(m);assert.equal(m.supports[1].materials,3);assert.equal(T.size(T.cardCost("gilded",1,m)),0);
    T.commit(m,card(s,"gilded",1),s,s);assert.equal(m.supports[1].materials,0);
    const p=T.project(s,m,card(s,"timaeus"));assert.equal(p.stop,true);assert.ok(!p.state.hand.some(h=>h.id!=="gilded"));
    m.supports=[{id:"timaeus",materials:2,round:-1},{id:"house",left:2,round:-1}];
    assert.equal(T.size(T.cardCost("gilded",1,m)),2,"House cannot retroactively make Timaeus qualify");
  });
  await test("gambler replacement has fresh per-copy capacity; defeated equipment is cleared",()=>{
    const s=board(["gambler"],1),m=memory();m.gamblerUsed[1]=3;m.artifacts[1]=true;m.artifactKinds[1]="gilded";
    T.commit(m,card(s,"gambler",1),s,s);assert.equal(T.gamblerRemaining(m,1),3);
    const dead=clone(s);dead.characters[1]={hp:0,dead:true,energy:0,frozen:false};T.noteBoard(m,dead);
    assert.equal(m.artifactKinds[1],null);assert.equal(m.defeated[1],true);assert.notEqual(T.replacement(dead,m).who,1);
  });
  await test("pending draws and talent draws request full actual hand; no predicted generated identity",()=>{
    const s=board(["countdown3","draw"]),m=memory(),a=card(s,"countdown3");
    assert.equal(T.handPlan(a,s,m).mode,"full");const p=T.project(s,m,a);assert.equal(p.stop,true);
    assert.deepEqual(clone(p.state.hand.map(h=>h.id)),["draw"]);assert.deepEqual(clone(p.state.dice),{Omni:5});
    assert.equal(T.verify(a,s,s),false);
    m.talents[1]=true;assert.equal(T.handPlan({type:"skill",who:1,skill:"E"},s,m).mode,"full");
    assert.equal(T.verify({type:"skill",who:0,skill:"E"},s,{...s,dice:{Omni:5}}),true,"zero damage is valid when payment is observed");
  });
  await test("decision is read-only, bounded, legal, does not invoke talent while tuning it",()=>{
    for(const [ids,active]of [[[],0],[["flowingFlame","wolf","garden","gilded","troupe"],2],[["dunyarzad","timaeus","countdown3"],0]]){
      const s=board(ids,active),m=memory();s.enemies=[enemy(10,true,["Hydro"]),enemy(8,false),enemy(6,false)];
      const input=JSON.stringify([s,m]),a=T.choose(s,m);assert.equal(JSON.stringify([s,m]),input);
      assert.ok(a.projections.used<=320);
      if(a.type==="card")assert.equal(T.cardLegal(s,a,m),true);if(a.type==="skill")assert.equal(T.skillLegal(s,a,m),true);
    }
    const s=board(["flowingFlame"],2),m=memory();s.dice={Pyro:2,Cryo:1};
    const p=T.project(s,m,{type:"tune",id:"flowingFlame",index:0,element:"Pyro"});assert.equal(p.estimate,null);assert.equal(p.memory.dilucE,0);
    const q=board(["flowingFlame","flowingFlame","draw"],2);q.dice={Cryo:3};
    assert.ok(T.enumerate(q,m).some(a=>a.type==="tune"),"multiple tuning steps can fund a real skill");
    const wait=board([],1);wait.enemies=[enemy(2)];wait.characters[1].frozen=true;
    const choice=T.choose(wait,m);assert.equal(choice.type,"switch");assert.equal(choice.planning.terminal,false);
  });
  await test("native rejection remains blocked and unknown support outcome does not free a slot",()=>{
    const s=board(["timaeus"]),m=memory(),a=card(s,"timaeus");T.rejectAction(m,a,s);
    assert.equal(T.enumerate(s,m).some(x=>x.type==="card"&&x.id===a.id),false);
    T.deferUncertain(m,a,s);T.nextRound(m);assert.equal(T.cardLegal(s,a,m),false);
  });
  await test("actual skill host uses two icon clicks; Diluc four-cost preview is admitted",async()=>{
    const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy)),log:{info(){},warn(){},error(){}}}),h=new c.TCGBetterGI.BetterGIHost({});
    h.trace=()=>{};h.requireUnchangedBoard=async()=>{};h.frame=fn=>fn({});h.phaseIn=()=>({phase:"unknown",turn:"none"});
    h.skillPreviewIn=()=>({identity:{who:2,skill:"Q"},name:"黎明",detail:"元素爆发"});h.numericAt=()=>"4";h.warnings=()=>({lack:false,text:""});
    assert.equal(h.skillFeeIn({}, {who:2,skill:"Q"}),4);
    const s=board([],2),m=memory();s.characters[2].energy=3;
    await h.executeInput({type:"skill",who:2,skill:"Q"},s,m);
    assert.deepEqual(inputs,[[1824,957],[1824,957]]);assert.equal(h.expectedDice,4);
  });
  await test("both talent payment pages confirm once, never send a separate skill",async()=>{
    for(const [id,who]of [["flowingFlame",2],["skivingNewAndImproved",1]]) {
      const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({});
      h.trace=()=>{};h.frame=fn=>fn({});h.warnings=()=>({lack:false,text:""});h.phaseIn=()=>({phase:"unknown",turn:"none"});
      h.ocr=()=>"装备给出战中的"+T.team[who].name;h.ocrRows=()=>[{text:"打出手牌",x:860,y:920,w:200,h:50}];
      await h.cardConfirm({type:"card",id,index:0,target:who},board([id],who));assert.deepEqual(inputs,[[960,945]]);
    }
  });
}
module.exports=run;
if(require.main===module)(async()=>{
  const results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(name+": "+e.stack);}});
  const out={at:new Date().toISOString(),passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
    scope:"production rules and synthetic host; no native duel",results};
  fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify({passed:out.passed,failed:out.failed}));if(out.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
