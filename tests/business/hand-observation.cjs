"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
const copy=x=>JSON.parse(JSON.stringify(x));
module.exports=async function(test){
  function fixture(){
    let now=100000;
    class Clock extends Date{static now(){return now;}}
    const f=load("mozailu",{Date:Clock,sleep:async ms=>{now+=ms;}});
    const h=new f.Host({}),events=[],inputs=[];
    h.memory=f.T.freshMemory();h.boardReady=true;
    h.trace=(event,data)=>events.push({event,data});h.frame=fn=>fn({});
    h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.clickAt=(...p)=>{inputs.push(p);h.inputRevision++;h.boardReady=false;h.handPositionProof=null;};
    h.moveTo=()=>{};h.nativeHandCountIn=()=>null;
    h.fillHandArtwork=async()=>{};
    const ids=["draw","shift"],slots=ids.map((id,index)=>({id,index,marker:{x:800+85*index,y:983}}));
    h.folded=async()=>({count:2,nativeCount:null,status:"readable",slots:copy(slots)});
    return {...f,h,events,inputs,slots,now:()=>now};
  }
  await test("hand observation: one reader owns folded/partial/fallback completion and one reset",async()=>{
    for(const route of ["full","partial","fallback"]){
      const f=fixture();let titles=0,prepares=0,finishes=0;
      if(route==="partial")f.slots[1].id=null;
      f.h.folded=async()=>route==="fallback"?null:{count:2,nativeCount:null,status:"readable",slots:copy(f.slots)};
      f.h.handCount=async()=>{await f.h.expand(false);return 2;};
      f.h.titleAt=async(_x,_y)=>{titles++;return route==="partial"?f.T.byId.shift.name:
        f.T.byId[titles===1?"draw":"shift"].name;};
      f.h.prepareHandObservation=async()=>{prepares++;};
      f.h.finishHandObservation=hand=>{finishes++;return hand;};
      const hand=await f.h.readHand();
      assert.deepEqual(copy(hand.map(c=>c.id)),["draw","shift"]);
      assert.equal(titles,route==="full"?0:route==="partial"?1:2);
      assert.equal(prepares,1);assert.equal(finishes,1);assert.equal(f.h.handScanSerial,1);
      assert.equal(f.h.handFanReady,false);assert.equal(f.h.handNeedsReset,false);
      assert.equal(f.events.filter(e=>e.event==="hand-reset").length,route==="full"?0:1);
      assert.equal(f.events.filter(e=>e.event==="hand-read-completed").length,1);
    }
  });
  await test("hand observation: retry retains known slots, conflicts discard them, interruption never folds a foreign page",async()=>{
    const f=fixture(),scan={titles:0};let folded=0,title=0,count=2;
    f.h.folded=async()=>{folded++;return null;};
    f.h.handCount=async()=>{if(!f.h.handFanReady)await f.h.expand(false);return count;};
    f.h.titleAt=async()=>++title===1?f.T.byId.draw.name:title===2?"":f.T.byId.shift.name;
    await assert.rejects(()=>f.h.readHand(null,null,scan),e=>e.code==="TCG_HAND_RETRY");
    assert.equal(scan.cards[0].id,"draw");assert.equal(f.h.handNeedsReset,true);
    assert.equal(f.events.filter(e=>e.event==="hand-reset").length,0);
    await f.h.readHand(null,null,scan);
    assert.equal(title,3);assert.equal(folded,1);
    // A new measured count invalidates the scratch identities, not merely its price.
    count=1;const next=await f.h.readHand(null,null,scan);
    assert.deepEqual(copy(next.map(c=>c.id)),["shift"]);
    const g=fixture();g.slots[0].id=null;g.slots[1].id=null;
    g.h.folded=async()=>({count:2,nativeCount:null,status:"readable",slots:g.slots});
    g.h.titleAt=async()=>{g.h.phase=()=>({phase:"choice",turn:"none"});return g.T.byId.draw.name;};
    await assert.rejects(()=>g.h.readHand(),e=>e.code==="TCG_OBSERVATION_INTERRUPTED");
    assert.equal(g.events.filter(e=>e.event==="hand-reset").length,0);
    assert.equal(g.h.handNeedsReset,true);
  });
  await test("confirmation: view closes before handoff wait despite stale boardReady, never on enemy or choice",async()=>{
    for(const scene of ["user","enemy","choice"]){
      const f=fixture(),s=board(f.T),a={type:"skill",who:0,skill:"E"};
      f.h.captureGeometry={actualSize:{width:2560,height:1600},layoutKey:"16:10"};
      f.h.handFanReady=f.h.handNeedsReset=f.h.boardReady=true;
      f.h.actionSubmittedAt=f.now();f.h.matchDeadline=f.now()+1000;
      f.h.phase=()=>({phase:scene==="choice"?"choice":"board",turn:scene==="choice"?"none":scene});
      f.h.resolveChoice=async()=>{throw Object.assign(Error("not ready"),{code:"TCG_CHOICE_RETRY"});};
      f.h.observe=async()=>{throw Error("handoff not ready");};
      await assert.rejects(()=>f.h.confirm(a,s,f.T.freshMemory()),e=>e.code==="TCG_CONFIRMATION_RETRY");
      assert.equal(f.inputs.length,scene==="user"?1:0);
      if(scene==="user")assert.equal(f.h.handNeedsReset,false);
      assert.ok(f.h.confirmationSession,"pending action survives its polling window");
    }
  });
  await test("confirmation: full replacement and possibly delayed draw carry different refresh decisions to Player",async()=>{
    for(const id of ["lyre","draw"]){
      const f=fixture(),p=new f.Player(f.h,{maxMinutes:15}),s=board(f.T,[id,"shift"]);
      s.active=2;s.dice={Omni:3};
      p.memory.artifactKinds[2]="troupe";p.memory.artifacts[2]=true;
      const a={type:"card",id,index:0,target:id==="lyre"?2:null};
      const after={...copy(s),dice:{Omni:id==="lyre"?3:2},
        hand:board(f.T,id==="lyre"?["shift","troupe"]:["shift"]).hand,handRead:"full"};
      let submitted=0;
      p.observe=async()=>s;p.progress=()=>{};f.T.choose=()=>a;
      f.h.executeInput=async()=>{submitted++;};
      f.h.observe=async()=>copy(after);f.h.diceBudgetMatches=()=>true;
      f.h.removalEvidenceBeforeReset=async()=>null;f.h.boardReady=true;
      await p.act();
      assert.equal(submitted,1);
      if(id==="lyre"){
        assert.ok(p.readyState,"complete native replacement must not trigger another full scan");
        assert.equal(p.readyState.handRefreshRequired,false);
      }else{
        assert.equal(p.readyState,null,"consumption is not complete delayed insertion");
        assert.equal(f.h.handCache,null);
      }
    }
  });
  await test("confirmation: card-backed skill keeps delayed hand refresh through the real Moon adapter",async()=>{
    // Both complete-board exits must keep the original card semantics. No
    // predicted draw is supplied: only consumption has been observed so far.
    for(const resynchronized of [false,true]){
      let now=100000;
      class Clock extends Date{static now(){return now;}}
      const f=load("moonbloom",{Date:Clock,sleep:async ms=>{now+=ms;}}),
        h=new f.Host({}),p=new f.Player(h,{maxMinutes:15}),
        s=board(f.T,["seed","draw"]),events=[];
      s.enemies[0].auraKnown=true;s.enemies[0].aura=[];
      p.memory.supports=["seelie"];p.memory.seelieRemaining=1;
      const a={type:"card",id:"seed",index:0,target:null},
        after={...copy(s),dice:{Omni:1},hand:board(f.T,["draw"]).hand,handRead:"full"};
      assert.equal(f.T.handPlan(a,s,p.memory).mode,"full");
      let phases=0,submitted=0;
      h.trace=(event,data)=>events.push({event,data});h.boardReady=true;
      h.phase=()=>({phase:"board",turn:phases++===0?"enemy":"user"});
      p.observe=async()=>s;p.progress=()=>{};f.T.choose=()=>a;
      h.executeInput=async()=>{submitted++;};
      h.observe=async()=>copy(after);h.diceBudgetMatches=()=>!resynchronized;
      h.observedResourceProof=async()=>({revision:h.inputRevision});
      await p.act();
      assert.equal(submitted,1);
      assert.equal(p.readyState,null,"a card-backed skill cannot publish the pre-insertion hand");
      assert.equal(h.handCache,null,"the next observation must not reuse the consumed-only cache");
      const confirmed=events.find(e=>e.event==="confirmed")?.data.after;
      assert.equal(confirmed?.confirmed,true);
      assert.equal(confirmed.handRefreshRequired,true);
      assert.equal(!!confirmed.resynchronized,resynchronized);
    }
  });
  await test("confirmation: phase change inside removal sampling interrupts before reset and preserves the pending action",async()=>{
    // The first phase is our board; the next native count frame can already
    // belong to a late soup page, enemy turn or an unreadable transition.
    for(const next of [{phase:"choice",turn:"none"},{phase:"board",turn:"enemy"},{phase:"unknown",turn:"none"}]){
      let now=100000,scene={phase:"board",turn:"user"};
      class Clock extends Date{static now(){return now;}}
      const f=load("iansan",{Date:Clock,sleep:async ms=>{now+=ms;if(now>=100120)scene=next;}}),
        h=new f.Host({}),s=board(f.T,["soup","draw"]),a={type:"card",id:"soup",index:0,target:0},
        inputs=[],events=[];
      h.memory=f.T.freshMemory();h.trace=(event,data)=>events.push({event,data});
      h.frame=fn=>fn({});h.phase=h.phaseIn=()=>({...scene});h.handCountIn=()=>1;
      h.handFanReady=h.handNeedsReset=true;h.boardReady=false;
      h.actionSubmittedAt=now;h.matchDeadline=now+600;
      h.consumptionReceipt={inputSent:true,beforeKey:f.T.boardKey(s),id:a.id,index:0,target:0};
      h.clickAt=(...point)=>{inputs.push({phase:scene.phase,point});h.inputRevision++;};h.moveTo=()=>{};
      h.observe=async()=>({...scene,hand:null});
      h.resolveChoice=async()=>{throw Object.assign(Error("choice pending"),{code:"TCG_CHOICE_RETRY"});};
      await assert.rejects(()=>h.confirm(a,s,h.memory),e=>e.code==="TCG_CONFIRMATION_RETRY");
      assert.deepEqual(inputs,[],"a newer non-board frame forbids the old phase's reset click");
      assert.ok(h.confirmationSession,"interruption must not permit the submitted card to be replayed");
      assert.equal(h.handNeedsReset,true,"view cleanup waits for a later positive own board");
      assert.ok(events.some(e=>e.event==="confirmation-deferred"&&e.data.phase===next.phase));
    }
  });
};
