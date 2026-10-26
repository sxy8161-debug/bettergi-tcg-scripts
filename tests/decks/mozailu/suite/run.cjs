"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
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

  await test("native automatic payment cannot promise preserved colours or a guaranteed finish",()=>{
    const m=memory();m.weaponKinds[1]="wolf";m.weapons[1]=true;m.supportSlots=1;
    const b=board(["wolf"]);b.dice={Pyro:2,Hydro:1,Electro:1,Dendro:1,Cryo:1,Geo:1,Omni:1};
    m.supports=[{id:"house",round:-1,left:2}];
    const before=JSON.stringify(b.dice),p=T.project(b,m,card(b,"wolf",1));
    assert.equal(p.conditionalPayment,true);assert.equal(T.total(p.state.dice),6);
    assert.equal((p.state.dice.Hydro||0)+(p.state.dice.Omni||0),0,"cannot promise native auto-pay preserves water+omni");
    assert.equal(JSON.stringify(b.dice),before);
    const finish=board(["wolf"],1),uncertain=memory();finish.dice={Anemo:1,Cryo:2,Omni:2};finish.enemies=[enemy(4)];
    uncertain.supports=[{id:"house",round:-1,left:2}];uncertain.supportSlots=1;
    const route=T.choose(finish,uncertain);
    assert.equal(route.type,"card");assert.equal(route.planning.conditionalPayment,true);
    assert.equal(route.planning.terminal,false,"a projected native auto-payment path is not a confirmed immediate lethal");

  });

  await test("Countdown family proof follows confirmed play/discard and invalidates uncertainty",()=>{
    const c=loadContext(),t=c.TCG,m=t.freshMemory(),s=board(["countdown3","countdown3"]);
    assert.equal(t.handVariantProof(m),null,"midgame/unknown initial stock cannot infer stage");
    const h=new c.TCGBetterGI.BetterGIHost({});h.trace=()=>{};
    const p=new c.TCGPlayer.Player(h,{maxMinutes:15});p.planOpening("initial-pick");
    Object.assign(m,p.memory);assert.deepEqual(clone(t.handVariantProof(m).ids),["countdown3"]);
    t.nextRound(m);t.nextRound(m);assert.deepEqual(clone(t.handVariantProof(m).ids),["countdown3"]);
    const a={type:"tune",id:"countdown3",index:0,element:"Hydro"};
    assert.equal(t.handVariantProof(m,a),null,"pending discard cannot reuse pre-input stock");
    t.commit(m,a,s,{...s,hand:s.hand.slice(1)});
    assert.deepEqual(clone(t.handVariantProof(m).ids),["countdown3","countdown2"],"mixed stages still need native titles");
    t.commit(m,{type:"card",id:"countdown3",index:0,target:null},s,{...s,hand:[]});
    assert.deepEqual(clone(t.handVariantProof(m).ids),["countdown2"],"play does not generate a successor");
    const after={...s,hand:[t.observedCard(t.byId.show.name,0)]};t.noteBoard(m,after);
    assert.equal(t.handVariantProof(m),null,"native contradictory stage wins");
    m.countdownStock={countdown3:2};t.deferUncertain(m,a,s);assert.equal(t.handVariantProof(m),null);
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
    // slot03, round4: native Gilded goes 10->12 dice, then after another
    // Lyre/Gambler/Boar cycle Gilded goes 12->12, not the old prediction 13.
    m.round=4;m.supports=[{id:"timaeus",materials:1,round:3}];m.lyre=2;
    assert.equal(T.size(T.cardCost("gilded",0,m)),0);
    T.commit(m,card(s,"gilded",0),s,s);
    assert.equal(m.supports[0].materials,0);assert.equal(m.supports[0].round,4);assert.equal(m.lyre,0);
    m.lyre=1;
    assert.equal(T.size(T.cardCost("gambler",2,m)),0);
    T.commit(m,{type:"card",id:"gambler",index:0,target:2},s,s);
    assert.equal(m.lyre,0);assert.equal(T.size(T.cardCost("gilded",2,m)),3);
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
    const supports=board(["dunyarzad","timaeus","liben","countdown2"]),v=memory();
    assert.equal(T.handPlan(card(supports,"dunyarzad"),supports,v).mode,"remove");
    assert.equal(T.handPlan(card(supports,"liben"),supports,v).mode,"remove");
    assert.equal(T.handPlan(card(supports,"timaeus"),supports,v).mode,"full");
    v.supports=[{id:"dunyarzad",round:-1,drawUsed:false}];
    const p2=T.handPlan(card(supports,"liben"),supports,v);
    assert.equal(p2.mode,"full");assert.ok(p2.retainedHand.some(h=>h.id==="countdown2"));
    v.supports[0].drawUsed=true;assert.equal(T.handPlan(card(supports,"liben"),supports,v).mode,"remove");
  });
  await test("last Shift confirms actual empty fan; missing count alone or a stale receipt cannot prove zero",async()=>{
    let time=100000;class Clock extends Date{static now(){return time;}}
    const c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;},...nativeInput((x,y)=>{
      assert.ok(x===967&&y===1041||x===1190&&y===545,"confirmation must not resubmit the action");
    })}),t=c.TCG;
    const h=new c.TCGBetterGI.BetterGIHost({}),s=board(["shift"],2),a=card(s,"shift"),m=memory();
    h.trace=()=>{};h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
    h.board=()=>({...clone(s),hand:null});h.boardReady=true;h.expectedDice=t.total(s.dice);
    h.handCountIn=()=>null;h.phase=()=>h.phaseIn();
    h.matches=()=>[];h.ocr=()=>"";h.ocrRows=()=>[];
    h.readHand=async()=>{throw Error("unnecessary full hand scan");};
    const receipt={inputSent:true,id:a.id,index:a.index,target:null,beforeKey:t.boardKey(s)};
    const proof={...receipt,kind:"native-empty-fan",sourceCount:1,stableReads:2};
    const after={...clone(s),hand:null,handEvidence:proof};
    assert.equal(t.emptyHandEffect(a,s,{...after,handEvidence:null}),false);
    assert.equal(t.emptyHandEffect(a,s,after),true);
    for(const patch of [{stableReads:1},{inputSent:false},{beforeKey:"stale"},{sourceCount:2},{id:"boar"},{index:1},{target:0}])
      assert.equal(t.emptyHandEffect(a,s,{...after,handEvidence:{...proof,...patch}}),false);
    assert.equal(t.emptyHandEffect(a,s,{...after,hand:s.hand}),false);
    assert.equal(t.emptyHandEffect(a,s,{...after,turn:"enemy"}),false);
    const countdown=board(["countdown3"]),tune={type:"tune",id:"countdown3",index:0,element:"Hydro"};
    assert.equal(t.emptyHandEffect(tune,countdown,{...countdown,hand:null,dice:{Omni:7,Hydro:1}}),false,
      "tuning can evolve Countdown; a dice change alone is not evidence of an empty hand");
    h.consumptionReceipt=receipt;
    const result=await h.confirm(a,s,m);
    assert.equal(result.confirmed,true);assert.equal(result.hand.length,0);assert.equal(h.consumptionReceipt,null);
    t.commit(m,a,s,result);assert.equal(m.freeSwitch,true);
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

  await test("native slot02: negative two-tune prefix reaches its skill before the beam budget is spent",()=>{
    const s=board(["skivingNewAndImproved","gambler","gambler","draw","draw"],2),m=memory();
    s.dice={Hydro:3,Anemo:2,Electro:1};s.enemies=[enemy(3),enemy(10,false),enemy(10,false)];
    s.enemies.forEach(e=>{e.auraKnown=false;e.defenseKnown=false;});
    s.characters[0].energy=1;s.characters[2].hp=6;s.characters[2].energy=1;
    m.round=2;m.used=[1,0,1];m.talents[2]=true;m.dilucE=1;m.monaFastUsed=true;
    m.artifacts=[false,true,true];m.artifactKinds=[null,"gilded","gilded"];
    m.supports=[{id:"house",round:2,left:1},{id:"liben",collected:0},{id:"timaeus",round:2,materials:0}];m.supportSlots=3;
    const before=JSON.stringify([s,m]),a=T.choose(s,m);
    assert.equal(a.type,"tune");assert.ok(a.planning.sequence.includes("skill:2:E"));
    assert.ok(a.projections.used<=320);assert.equal(a.planning.terminal,false);
    assert.equal(JSON.stringify([s,m]),before);
    const next=T.project(s,m,a),b=T.choose(next.state,next.memory);
    assert.equal(b.type,"tune","first tuning only unlocks NA; discounted E still needs the second");
    const ready=T.project(next.state,next.memory,b),c=T.choose(ready.state,ready.memory);
    assert.equal(c.type,"skill");assert.equal(c.skill,"E");
    T.rejectAction(ready.memory,{type:"skill",who:2,skill:"E"},ready.state);
    const refused=T.choose(ready.state,ready.memory);
    assert.ok(refused.type!=="skill"||refused.skill!=="E","no direct retry of the rejected skill on the unchanged board");
  });
  await test("native slot06: end-phase forced switch cannot manufacture a Troupe discount",()=>{
    const s=board(["gambler","garden","boar"],2),m=memory();
    m.lastActive=1;m.artifacts[2]=true;m.artifactKinds[2]="troupe";
    s.dice={Pyro:2,Hydro:2,Electro:3,Cryo:1};
    T.nextRound(m);assert.equal(m.troupe[2],0);
    T.noteBoard(m,s);assert.equal(m.troupe[2],0);assert.equal(T.skillLegal(s,{who:2,skill:"E"},m),false);
    const n=memory();n.lastActive=1;n.artifactKinds[2]="troupe";
    T.nextRound(n);s.active=1;T.noteBoard(n,s);T.noteBoard(n,s);
    assert.equal(n.troupe[2],1,"confirmed unchanged active admits at most one backstage increment");
  });

  await test("late paid draw cannot spend the last payable attack; opening and retained attack funds stay distinct",()=>{
    const s=board(["flowingFlame","skivingNewAndImproved","gambler","troupe","dunyarzad","shift","countdown3"]),m=memory();
    // Native19:40:03: only Mona remains, bubble active, five dice -> fee3 leaves2.
    s.characters[0].hp=3;s.characters[1].hp=s.characters[2].hp=0;
    s.characters[1].dead=s.characters[2].dead=true;
    s.enemies=[enemy(4,true,["Hydro"])];s.enemies[0].defenseKnown=false;
    s.dice={Electro:1,Dendro:1,Geo:1,Omni:2};
    m.round=5;m.used=[4,4,3];m.defeated=[false,true,true];m.bubble=true;
    m.artifacts=[true,false,false];m.artifactKinds=["gilded",null,null];m.legendUsed=true;
    m.supports=[{id:"dunyarzad",round:1,drawUsed:true},{id:"timaeus",round:3,materials:2},
      {id:"liben",round:-1,collected:0}];m.supportSlots=3;m.sayuSummon=1;
    const original=JSON.stringify([s,m]),a=T.choose(s,m);
    assert.ok(a.planning.sequence.some(k=>k.startsWith("skill:0:")),"retain a known payable attack, not a random rescue draw");
    assert.equal(a.planning.terminal,false);assert.ok(a.projections.used<=320);
    assert.equal(JSON.stringify([s,m]),original);
    const draw=card(s,"countdown3"),cutoff=T.project(s,m,draw);
    assert.equal(cutoff.attackReserveLost,true);
    assert.equal(cutoff.stop,true);assert.equal(cutoff.state.hand.length,s.hand.length-1,
      "no random cards or follow-up damage are invented");
    s.dice={Omni:6};
    assert.equal(T.project(s,m,draw).attackReserveLost,false,"three remaining dice retain an attack");
    s.dice={Omni:3};s.characters[0].frozen=true;
    assert.equal(T.project(s,m,draw).attackReserveLost,false,"no current legal attack to reserve");
    const free=board(["show"],0),fresh=memory();free.dice={Omni:3};fresh.round=5;fresh.used=[1,0,0];
    assert.equal(T.project(free,fresh,card(free,"show")).attackReserveLost,false,"zero-fee draw cannot consume attack funds");
    const ordinary=board(["draw"],0);ordinary.dice={Omni:3};
    assert.equal(T.project(ordinary,fresh,card(ordinary,"draw")).attackReserveLost,true,
      "the same lost-attack opportunity applies to ordinary paid draw, not just Countdown");
    const opening=board(["countdown3"],0),start=memory();opening.dice={Omni:5};
    assert.notEqual(T.choose(opening,start).planning.reason,"paid-draw-preserves-last-attack",
      "opening development is not subject to the late-round reserve");
    const discounted=board(["countdown3"],2),dm=memory();dm.round=3;dm.talents[2]=true;dm.dilucE=1;discounted.dice={Omni:5};
    assert.equal(T.project(discounted,dm,card(discounted,"countdown3")).attackReserveLost,false,
      "use actual discounted skill cost, not a hardcoded three-die reserve");
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
  if(!root)throw Error("Set TCG_TEST_ROOT to a staged package, or run npm test");
  const results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(name+": "+e.stack);}});
  const out={at:new Date().toISOString(),passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
    scope:"production rules and synthetic host; no native duel",results};
  fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify({passed:out.passed,failed:out.failed}));if(out.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
