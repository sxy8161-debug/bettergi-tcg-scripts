"use strict";
const assert = require("node:assert/strict");
const {load, board} = require("./runtime.cjs");
const clone = x => JSON.parse(JSON.stringify(x));
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-9, `${actual} != ${expected}`);

module.exports = async function(test) {
  const {T} = load("raiden");
  await test("single planner: exhausted budget keeps the evaluated action and releases its decision scope",()=>{
    const s=board(T,["voltage","sweet"]),m=T.freshMemory();s.characters[0].hp=2;
    const limited=T.projectionBudget.run(1,()=>T.choose(s,m));
    assert.equal(limited.planning.status,"budget-exhausted");assert.equal(limited.projections.used,1);
    assert.equal(limited.type,"skill");assert.ok(T.skillLegal(s,limited,m));
    assert.equal(limited.planning.sequence.length,1,"no unevaluated deeper plan or legacy fallback");
    const normal=T.choose(s,m);assert.equal(normal.projections.limit,1500);
    assert.ok(normal.projections.used>1&&normal.projections.used<=1500);
  });
  await test("single planner: native refusals exclude the same action from roots, funding and reselection",()=>{
    const s=board(T,["voltage"]),m=T.freshMemory();s.characters[0].energy=1;s.dice={Omni:4};
    const first=T.choose(s,m);assert.equal(first.id,"voltage");T.rejectAction(m,first,s);
    const next=T.choose(s,m);assert.notEqual(T.actionKey(next),T.actionKey(first));
    assert.ok(!next.planning.sequence.includes(T.actionKey(first)));
    assert.equal(T.actionRefused(s,m,next),false);
    const candidates=T.strategyEligible(s,m);
    for(const a of candidates)T.rejectAction(m,a,s);
    assert.equal(T.choose(s,m).type,"end");
  });
  function feeFixture(outcome="confirmed",retry=false) {
    let now=100000,clicks=0,totalClicks=0,casts=0,deferred=false;
    class Clock extends Date { static now(){return now;} }
    const {T,env}=load("raiden",{Date:Clock,sleep:async ms=>{now+=ms;}}),
      options=env.TCGPlayer.playerOptions({}),h=new env.TCGBetterGI.BetterGIHost(options),
      p=new env.TCGPlayer.Player(h,options),m=p.memory,events=[];
    let current=board(T);current.active=1;current.dice={Dendro:2};current.quicken={known:false};
    for(const who of [0,2])Object.assign(current.characters[who],{hp:0,dead:true});
    current.enemies=[3,3,10].map((hp,i)=>({hp,dead:false,active:i===0,aura:["Electro"],auraKnown:true}));
    m.round=1;m.thundergrassSupport="sharpkernel";m.artifactKinds[1]="gambler";
    p.openingFlow={complete:true};
    h.frame=fn=>fn({});h.board=()=>clone(current);
    h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.skillFeeIn=()=>2;h.diceIn=()=>({dice:clone(current.dice)});h.diceCountIn=()=>T.total(current.dice);
    h.warnings=()=>({lack:outcome==="rejected",text:""});
    h.trace=(event,data)=>events.push({event,data:clone(data)});
    h.reset=async()=>{clicks=0;h.handNeedsReset=false;h.handFanReady=false;};
    h.clickAt=()=>{
      totalClicks++;h.inputRevision++;h.boardReady=false;
      if(++clicks!==2)return;
      clicks=0;casts++;
      if(outcome!=="confirmed")return;
      // Scripted native observations, not a second damage/payment engine:
      // each confirmed E defeats one target; Gambler refunds two Omni dice.
      const after=clone(current);after.dice={Omni:2};after.characters[1].energy=casts;
      after.enemies[casts-1]={hp:0,dead:true,active:false,aura:[],auraKnown:true};
      after.enemies[casts].active=true;after.quicken={known:true,charges:1};current=after;
    };
    h.observe=async(_force,plan)=>{
      const after=h.finishObservation(clone(current),plan,"unchanged");
      if(plan && retry && casts===1 && !deferred){
        deferred=true;now+=46000;
        const error=new Error("scripted observation retry across the confirmation window");
        error.code="TCG_BOARD_RETRY";throw error;
      }
      return after;
    };
    return {T,h,p,m,events,state:()=>clone(current),clicks:()=>totalClicks,casts:()=>casts};
  }
  await test("Raiden adopted fee survives observation expiry and two refunded casts consume both Sharpkernel uses",async()=>{
    const f=feeFixture("confirmed",true),used=[];
    await f.p.act(); // Actual strategy probe, including two fee samples and cancel.
    assert.equal(f.casts(),0);assert.equal(f.m.blessingUsed,0);
    assert.equal(f.T.skillQuote(f.state(),f.m,{who:1,skill:"E"}).n,2);
    await f.p.act();used.push(f.m.blessingUsed);
    assert.equal(f.m.skillCosts,null,"new board expires quotes normally");
    await f.p.act();used.push(f.m.blessingUsed);
    assert.deepEqual(used,[1,2]);
    assert.equal(f.m.gamblerUsed[1],2);assert.equal(f.T.total(f.state().dice),2);
    assert.equal(f.T.size(f.T.skillCost(1,"E",f.m,f.state())),3);
    assert.equal(f.T.choose(f.state(),f.m).type,"end");
    assert.equal(f.events.filter(e=>e.event==="input-submitted").length,2);
    assert.equal(f.events.filter(e=>e.event==="confirmed").length,2);
    assert.ok(f.events.some(e=>e.event==="confirmation-pending"),"fee basis survives the same pending action's resumed window");
    assert.equal(f.clicks(),5,"one probe plus two two-click casts, no extra inputs");
  });

  await test("Raiden adopted fee is bound to its action, observed board and round, not a reusable quote",async()=>{
    const f=feeFixture();await f.p.act();
    const before=f.state(),action=f.T.choose(before,f.m);
    await f.h.execute(action,before,f.m);
    f.h.finishObservation(f.state(),{action,before},"unchanged");
    assert.equal(f.m.skillCosts,null);
    assert.equal(action.skillCostBasis.cost,2);assert.equal(action.skillCostBasis.source,"native-skill-preview");
    for(const mismatch of ["none","action","board","round","support","used"]){
      const a=clone(action),b=clone(before),m=clone(f.m);
      if(mismatch==="action")a.skill="Q";
      if(mismatch==="board")b.characters[1].hp--;
      if(mismatch==="round")m.round++;
      if(mismatch==="support")m.thundergrassSupport="shatterbolt";
      if(mismatch==="used")m.blessingUsed++;
      const previous=m.blessingUsed;
      f.T.commit(m,a,b);
      assert.equal(m.blessingUsed-previous,mismatch==="none"?1:0,mismatch);
      assert.equal(m.skillCosts,null,"the basis never becomes a future quote");
    }
  });
  await test("Raiden rejected or unconfirmed discounted input does not consume a blessing use",async()=>{
    for(const outcome of ["rejected","unconfirmed"]){
      const f=feeFixture(outcome);await f.p.act();await f.p.act();
      assert.equal(f.m.blessingUsed,0,outcome);
      assert.equal(f.events.filter(e=>e.event==="confirmed").length,0,outcome);
      assert.equal(f.m.skillCosts,null,outcome);
    }
  });
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
    const plain=clone(m);plain.artifactKinds[2]=null;
    const p=T.projectedAction(s,m,action),q=T.projectedAction(s,plain,action);
    assert.ok(p&&q);return {p,bonus:p.benefit-q.benefit};
  }

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

};

