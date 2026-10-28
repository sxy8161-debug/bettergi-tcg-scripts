"use strict";
const assert = require("node:assert/strict");
const {load, board} = require("./runtime.cjs");
const clone = x => JSON.parse(JSON.stringify(x));

module.exports = async function(test) {
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
};

