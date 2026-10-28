"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
const copy=x=>JSON.parse(JSON.stringify(x));
module.exports=async function(test){
  await test("moonbloom keeps surviving identities across native insertions without assigning ambiguous new slots",()=>{
    const {T,Host}=load("moonbloom"),h=new Host({}),s=board(T,["fruit","sand","gleam","razor","razor"]),
      plan=T.handPlan({type:"skill",who:0,skill:"E"},s,T.freshMemory());
    h.trace=()=>{};
    assert.equal(plan.retainedHandOrder,true);
    const bind=(old,ids)=>{
      const cards=ids.map((id,index)=>id?T.observedCard(T.byId[id].name,index):null),
        slots=ids.map((id,index)=>({id,index}));
      h.fillHandVariants(cards,slots,T.indexedHand(old.map(id=>T.observedCard(T.byId[id].name,0))),[],true);
      return copy(cards.map(c=>c?.id||null));
    };
    assert.deepEqual(bind(["fruit","sand","gleam","razor","razor"],
      ["seed","overgrow",null,"sand","gleam",null,null]),
      ["seed","overgrow","fruit","sand","gleam","razor","razor"]);
    assert.deepEqual(bind(["calx"],[null,null]),[null,null],"a survivor may occupy either unknown slot");
    assert.deepEqual(bind(["calx","draw"],["draw",null]),["draw",null],"a conflicting current identity is not overwritten");
  });
  await test("retained hand reuses a count first obtained after unfolding; changed rows and identity conflicts still read",async()=>{
    const {T,Host}=load("ailin"),s=board(T,["autumnFrost","teaParty","teaParty","chef","silver","boar"]),
      plan=T.handPlan({type:"switch",target:0},s,T.freshMemory());
    for(const scene of ["same","added","unordered","conflict"]){
      const h=new Host({}),ids=scene==="added"?s.hand.map(c=>c.id).concat("draw"):
        scene==="conflict"?["soup",...s.hand.slice(1).map(c=>c.id)]:s.hand.map(c=>c.id);
      let titles=0,resets=0,prepared=0;
      h.trace=()=>{};h.frame=fn=>fn({});h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
      h.handCountIn=()=>null;h.collapsedLayoutIn=()=>({status:"unreadable"});h.folded=async()=>null;
      // Like slot08, the collapsed view cannot establish quantity. The
      // existing count reader opens the fan and obtains a native badge.
      h.handCount=async()=>{h.handFanReady=true;return ids.length;};
      h.handPoints=n=>Array.from({length:n},(_,i)=>i);
      h.prepareHandObservation=n=>{prepared=n;};
      h.expandedHandIn=()=>null;
      h.titleAt=async index=>{titles++;return T.byId[ids[index]].name;};
      h.reset=async()=>{resets++;h.handFanReady=h.handNeedsReset=false;};
      const scan={titles:0,...(scene==="conflict"?{handIdentity:{count:ids.length,card:T.observedCard(T.byId.soup.name,0)}}:{})};
      const hand=await h.observedHand({...plan,retainedHandOrder:scene!=="unordered"},scan);
      assert.deepEqual(copy(hand.map(c=>c.id)),ids);
      assert.equal(prepared,ids.length,"current per-deck hand facts still refresh");
      assert.equal(resets,1,"the opened fan is closed once");
      if(scene==="same")assert.equal(titles,0,"six proven identities need no second six-title pass");
      else assert.ok(titles>0,"new cards, unproven order and a positive conflict cannot inherit a whole old row");
    }
  });
  await test("input identity conflict replaces stale retention through real recovery; changed counts discard the old slot",async()=>{
    for(const scene of ["title", "artwork", "changed-count"]){
      const f=load("ailin"),h=new f.Host({}),p=new f.Player(h,{maxMinutes:15}),
        s=board(f.T,["wavekissedSands","dunyarzad","draw"]),a={type:"card",id:"wavekissedSands",index:0,target:null},
        ids=scene==="changed-count"?["soup","chef","dunyarzad","draw"]:s.hand.map(c=>c.id),events=[];
      h.trace=(event,data)=>events.push({event,data});h.frame=fn=>fn({});
      h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
      h.initialObservationBoard=()=>copy(s);h.settledBoard=async()=>copy(s);
      h.handCountIn=h.nativeHandCountIn=()=>ids.length;
      // Reproduce slot03's folded false positive even after the cache is cleared.
      h.folded=async()=>({status:"readable",count:ids.length,nativeCount:ids.length,
        slots:ids.map((id,index)=>({id,index}))});
      h.expandedHandIn=()=>scene==="artwork"?{slots:[{index:0,id:"verdantGift"}]}:null;
      h.titleAt=async()=>f.T.byId.verdantGift.name;
      h.prepareHandObservation=()=>{};h.finishHandObservation=hand=>hand;
      h.reset=async()=>{h.handFanReady=h.handNeedsReset=false;};
      h.handCache=copy(s.hand);h.handContinuation=f.T.handPlan({type:"switch",target:1},s,p.memory);
      let error;try{await h.inspectHandCard(a,914,s);}catch(e){error=e;}
      assert.equal(error?.code,"TCG_HAND_REFRESH");
      await p.recoverBeforeConfirmation(error,a,s,{});
      assert.deepEqual(copy(p.readyState.hand.map(c=>c.id)),scene==="changed-count"?ids:["verdantGift","dunyarzad","draw"]);
      assert.ok(!events.some(e=>e.event==="input-submitted"),"identity repair cannot submit the rejected action");
      assert.equal(h.handContinuation,null,"the contradicted retained identities must not return on the next observation");
      if(scene!=="changed-count")
        await h.inspectHandCard({...a,id:"verdantGift"},914,p.readyState);
    }
  });

  await test("hand continuity: confirmed retained identities reach the next late-insertion observation, not a new round",async()=>{
    const f=load("consecrated"),h=new f.Host({}),p=new f.Player(h,{maxMinutes:15}),
      s=board(f.T,["block","countdown3"]),a={type:"skill",who:1,skill:"E"};
    s.active=1;s.dice={Omni:4};
    const after={...copy(s),dice:{Omni:1},handRead:"full"};
    h.trace=()=>{};h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.frame=fn=>fn({});h.boardReady=true;h.removalEvidenceBeforeReset=async()=>null;
    h.observe=async()=>copy(after);h.diceBudgetMatches=()=>true;h.executeInput=async()=>{};
    p.observe=async()=>s;p.progress=()=>{};f.T.choose=()=>a;
    await p.act();
    let slots=[{index:0,id:"block"},{index:1,id:"block"},
      {index:2,titleCandidates:["countdown3","countdown2","countdown1","show"]}];
    h.handCountIn=()=>3;
    h.collapsedIn=()=>({status:"readable",count:3,slots});
    h.readHand=async(_count,_evidence,scan)=>{
      const cards=slots.map(x=>x.id?f.T.observedCard(f.T.byId[x.id].name,x.index):null);
      h.fillHandVariants(cards,slots,scan.retainedHand,scan.retainedVariantFamilies);
      return cards;
    };
    const current=await h.observedHand();
    assert.equal(current[2]?.id,"countdown3","the native new block must not erase the unchanged countdown");
    h.acceptHand(current,"test-native-row");
    slots=[slots[2],slots[0],slots[1]].map((s,index)=>({...s,index}));
    assert.equal((await h.observedHand())[0]?.id,"countdown3","same-count native reordering cannot reuse old positions");
    h.reset=async()=>{};
    let conflict;
    try{await h.refreshHandBeforeInput("late-row-conflict");}catch(e){conflict=e;}
    h.observe=async(_pending,plan)=>({...copy(after),hand:await h.observedHand(plan)});
    await p.recoverBeforeConfirmation(conflict,{type:"card",id:"block",index:0,target:null},s,{});
    assert.equal(p.readyState.hand[0]?.id,"countdown3","pre-drag recovery must keep the preceding retention contract");
    h.invalidateHand("new-round-draw-order-unknown");
    assert.equal((await h.observedHand())[0],null,"a new round has no action-bound retention guarantee");
    h.handContinuation={retainedHand:s.hand};
    await h.execute(a,s,p.memory);
    assert.equal(h.handContinuation,null,"a new submitted action replaces the old retention contract");
  });


  await test("hand observation: HUD text crossing the old title crop cannot block last-card tuning through Player.act",async()=>{
    let now=100000;
    class Clock extends Date{static now(){return now;}}
    const f=load("mozailu",{Date:Clock,sleep:async ms=>{now+=ms;}}),
      h=new f.Host({}),p=new f.Player(h,{maxMinutes:15}),events=[];
    const s=board(f.T,["skivingNewAndImproved"]);
    s.active=2;s.dice={Pyro:1,Electro:1};
    const a={type:"tune",id:"skivingNewAndImproved",index:0,element:"Pyro"},
      after={...copy(s),dice:{Pyro:2},hand:null};
    h.trace=(event,data)=>events.push({event,data});h.frame=fn=>fn({width:1920,height:1080});
    h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.board=()=>copy(after);h.boardReady=true;h.has=()=>false;h.matches=()=>[];
    // Saved post-stop 1920x1080 frame SHA57e09e70...44bdcf8.
    // Installed V4 offline OCR: the old crop reads "束"; the full row
    // reads "已宣布结束" at [39,124,115,26], outside the detail-title panel.
    // This is an observed backend fixture, not live OCR or a new game run.
    h.ocr=(_f,area)=>area.panel==="details"&&area.rect[0]===135?"束":"";
    h.ocrRows=(_f,area)=>area.panel==="details"
      ?[{text:"已宣布结束",x:39,y:124,w:115,h:26}]:[];
    h.clickAt=()=>{h.inputRevision++;h.boardReady=false;h.handPositionProof=null;};h.moveTo=()=>{};
    let submitted=0;
    h.executeInput=async()=>{
      submitted++;
      h.consumptionReceipt={inputSent:true,beforeKey:f.T.boardKey(s),id:a.id,index:0,target:null};
      h.handNeedsReset=h.handFanReady=true;h.boardReady=false;
    };
    p.openingFlow={complete:true};
    const observe=p.observe.bind(p);p.observe=async()=>s;f.T.choose=()=>a;p.progress=()=>{};
    await p.act();
    assert.equal(submitted,1);
    assert.ok(p.readyState?.confirmed,"real confirmation hands its result back to the player");
    assert.equal(p.readyState.hand.length,0);
    assert.ok(events.some(e=>e.event==="empty-hand-proof"));
    assert.ok(!events.some(e=>e.event==="hand-read-deferred"));
    p.observe=observe;
    assert.equal((await p.observe()).hand.length,0,"next decision can proceed without repeating the submitted tune");
  });
  function fixture(){
    let now=100000;
    class Clock extends Date{static now(){return now;}}
    const f=load("mozailu",{Date:Clock,sleep:async ms=>{now+=ms;}});
    const h=new f.Host({}),events=[],inputs=[];
    h.memory=f.T.freshMemory();h.boardReady=true;
    h.trace=(event,data)=>events.push({event,data});h.frame=fn=>fn({width:1920,height:1080});
    h.matches=()=>[]; // No image backend in lifecycle fixtures: native layout is explicitly unknown.
    h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.clickAt=(...p)=>{inputs.push(p);h.inputRevision++;h.boardReady=false;h.handPositionProof=null;};
    h.moveTo=()=>{};h.nativeHandCountIn=()=>null;
    h.fillHandArtwork=async()=>{};
    const ids=["draw","shift"],slots=ids.map((id,index)=>({id,index,marker:{x:800+85*index,y:983}}));
    h.folded=async()=>({count:2,nativeCount:null,status:"readable",slots:copy(slots)});
    return {...f,h,events,inputs,slots,now:()=>now};
  }

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
