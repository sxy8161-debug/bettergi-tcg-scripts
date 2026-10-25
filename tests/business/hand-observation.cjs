"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
const copy=x=>JSON.parse(JSON.stringify(x));
module.exports=async function(test){
  await test("hand continuity: support entry without a draw consumes only its source; a live draw trigger stays explicit",()=>{
    const {T}=load("ailin"),s=board(T,["wavekissedSands","chef"]),m=T.freshMemory(),
      a={type:"card",id:"chef",index:1,target:null};
    const plain=T.handPlan(a,s,m);
    assert.equal(plain.mode,"remove");
    assert.deepEqual(copy(plain.hand.map(h=>h.id)),["wavekissedSands"]);
    m.supports.push({id:"dunyarzad",drawUsed:false});
    const draw=T.handPlan(a,s,m);
    assert.equal(draw.mode,"full");assert.equal(draw.refreshAfterConsumption,true);
    m.supports[1].drawUsed=true;
    assert.equal(T.handPlan(a,s,m).mode,"remove");
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
  await test("hand input: current artwork replaces redundant title clicks, but conflicting slots and required details do not",async()=>{
    for(const scene of ["known","unknown","wrong","moon-details","ailin-tune"]){
      const id=scene==="moon-details"?"moonbloom":scene==="ailin-tune"?"ailin":"mozailu",
        f=load(id),h=new f.Host({}),s=board(f.T,["draw","shift"].filter(x=>f.T.byId[x])),
        a={type:scene==="ailin-tune"?"tune":"card",id:"draw",index:0,target:null};
      let titles=0,drags=0;
      h.frame=fn=>fn({});h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});h.trace=()=>{};
      h.expandedHandIn=()=>({slots:[{index:0,id:scene==="unknown"?null:scene==="wrong"?"companion":"draw"}]});
      h.titleAt=async()=>{titles++;return f.T.byId.draw.name;};h.reset=async()=>{};h.drag=async()=>{drags++;};
      if(scene==="wrong")await assert.rejects(()=>h.inspectHandCard(a,1120,s),e=>e.code==="TCG_HAND_REFRESH");
      else await h.inspectHandCard(a,1120,s);
      assert.equal(titles,["known","wrong","ailin-tune"].includes(scene)?0:1,scene);
      assert.equal(drags,0);
    }
  });
  await test("hand input: a stable wrong title exits to refresh instead of reading the same mismatch ten times",async()=>{
    const f=fixture();let reads=0;
    f.h.titleIn=()=>{reads++;return f.T.byId.draw.name;};
    assert.equal(await f.h.titleAt(1120,945,false,false,"card","shift",true),f.T.byId.draw.name);
    assert.equal(reads,2);
  });
  await test("hand input: production artwork classification binds the drag to its current slot and submits once",async()=>{
    const {packageFiles}=require("../../tools/build.cjs"),bank=JSON.parse(packageFiles("mozailu").files.get("hand-bank.json")),
      entry=bank.expanded.entries.find(e=>e.id==="draw"),
      files=new Set([...(entry.patches||[]),...(entry.views||[]).flatMap(v=>v.patches)]);
    for(const scene of ["match","count-conflict","backend-error"]){
      const f=load("mozailu"),h=new f.Host({}),s=board(f.T,["shift","draw"]),
        a={type:"card",id:"draw",index:1,target:null},drags=[];
      let confirmations=0;
      h.frame=fn=>fn({width:1920,height:1080});h.trace=()=>{};
      h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});h.reset=async()=>{};
      h.nativeHandCountIn=()=>scene==="count-conflict"?3:2;
      h.handCostLayoutIn=()=>({markers:[{x:800,y:820},{x:998,y:820}],points:[903,1101]});
      h.artworkScore=(_f,area,file)=>{
        if(scene==="backend-error")throw Error("backend unavailable");
        assert.ok(area.rect[0]>=998,"only the input target is classified");
        return files.has(file)?.99:0;
      };
      h.prepareHandInput=async()=>null;h.handPoints=()=>[880,1080];
      h.titleAt=async()=>{throw Error("known artwork must not click the title");};
      h.drag=async(...points)=>drags.push(points);h.cardConfirm=async()=>{confirmations++;};
      if(scene==="match"){
        await h.inputHand(a,s,f.T.freshMemory());
        assert.equal(drags.length,1);assert.equal(drags[0][0],1101);
        assert.equal(confirmations,1);assert.equal(h.consumptionReceipt.inputSent,true);
      }else{
        await assert.rejects(()=>h.inputHand(a,s,f.T.freshMemory()),e=>scene==="count-conflict"
          ?e.code==="TCG_HAND_REFRESH":e.message==="backend unavailable");
        assert.equal(drags.length,0);assert.equal(confirmations,0);
      }
    }
  });
  await test("empty input title refreshes the actual hand through Player instead of replanning the cached slot",async()=>{
    const f=fixture(),p=new f.Player(f.h,{maxMinutes:30}),s=board(f.T,["draw","shift"]),
      a={type:"card",id:"draw",index:0,target:null};
    f.h.handCache=copy(s.hand);f.h.titleAt=async()=>"";
    let error;try{await f.h.inspectHandCard(a,1019);}catch(e){error=e;}
    assert.equal(error?.code,"TCG_HAND_REFRESH");assert.equal(f.h.handCache,null);
    f.h.observe=async(_pending,plan)=>{
      assert.equal(plan.mode,"full","the recovery must not reuse the stale two-card hand");
      return {...copy(s),hand:[],handRead:"full"};
    };
    await p.recoverBeforeConfirmation(error,a,s,{});
    assert.equal(p.readyState.hand.length,0);
    assert.ok(!f.events.some(e=>e.event==="input-submitted"));
  });
  await test("hand artwork: identical declared families share a runner-up group but never become an exact title",()=>{
    const C=require("../../src/shared/collapsed-hand.inc.js"),family=["a","b"],
      bank={scoreFloor:.93,runnerUpGap:.20,patches:[[0,0,1,1],[0,1,1,1]],entries:[
        {id:"a",titleCandidates:family,patches:["a0","a1"]},
        {id:"b",titleCandidates:["b","a"],patches:["b0","b1"]},
        {id:"other",patches:["o0","o1"]}]},
      read=scores=>C.identify({status:"readable",slots:[{index:0}]},bank,(_s,_p,f)=>scores[f[0]]).slots[0];
    const same=read({a:.99,b:.98,o:.3});
    assert.equal(same.id,null);assert.deepEqual(same.titleCandidates,family);
    assert.equal(read({a:.99,b:.98,o:.97}).titleCandidates,undefined,"a different identity still competes");
    bank.entries[1].titleCandidates=["b","c"];
    assert.equal(read({a:.99,b:.98,o:.3}).titleCandidates,undefined,"overlapping but unequal families remain ambiguous");
  });
  await test("hand artwork: missing first fan layout gets one read-only follow-up, never an input or unbounded retry",async()=>{
    for(const scenario of ["ready","moving","missing","input-change","phase-change"]){
      const {Host}=load("ailin"),h=new Host({}),cards=[null],scan={};let reads=0;
      h.trace=()=>{};h.frame=fn=>fn({});h.clickAt=h.moveTo=()=>{throw Error("Artwork follow-up must be read-only");};
      h.expandedHandIn=()=>{
        reads++;
        if(scenario==="input-change"){h.inputRevision++;return null;}
        if(scenario==="phase-change"&&reads>1)throw Object.assign(Error("choice"),{code:"TCG_OBSERVATION_INTERRUPTED"});
        return scenario==="ready"||scenario==="moving"&&reads>1?{slots:[{index:0,id:"soup"}]}:null;
      };
      if(["input-change","phase-change"].includes(scenario)){
        await assert.rejects(()=>h.fillHandArtwork(cards,scan),e=>["TCG_HAND_RETRY","TCG_OBSERVATION_INTERRUPTED"].includes(e.code));
        assert.equal(cards[0],null);
      }else{
        await h.fillHandArtwork(cards,scan);
        assert.equal(cards[0]?.id??null,scenario==="missing"?null:"soup");
      }
      assert.ok(reads<=(scenario==="ready"||scenario==="input-change"?1:2));
    }
  });
  await test("Ailin hand retention: observed family count can reuse old food; new, mixed and incomplete rows cannot",()=>{
    const {Host,T}=load("ailin"),h=new Host({}),s=board(T,["verdantGift","dragon"]),m=T.freshMemory(),
      family=["wavekissedSands","verdantGift","gildedHall","autumnFrost"],
      plan=T.handPlan({type:"card",id:"dragon",index:1,target:null},s,m);
    assert.equal(plan.mode,"full");assert.deepEqual(copy(plan.retainedHand.map(c=>c.id)),["verdantGift"]);
    assert.equal(T.handPlan({type:"switch",target:1},s,m).retainedHandOrder,true);
    assert.equal(T.handPlan({type:"skill",who:0,skill:"E"},s,m).retainedHandOrder,true);
    m.fastSwitch=true;
    assert.deepEqual(copy(T.handPlan({type:"switch",target:1},s,m).retainedHand.map(c=>c.id)),["verdantGift","dragon"]);
    h.trace=()=>{};
    const retained=slots=>{const cards=slots.map(x=>x.id?T.observedCard(T.byId[x.id].name,x.index):null);
      h.fillHandVariants(cards,slots,plan.retainedHand);return cards.map(c=>c?.id??null);};
    assert.deepEqual(retained([{index:0,titleCandidates:family},{index:1,id:"dragon"}]),["verdantGift","dragon"]);
    assert.deepEqual(retained([{index:0,titleCandidates:family},{index:1,titleCandidates:family}]),[null,null]);
    assert.deepEqual(retained([{index:0,titleCandidates:family},{index:1}]),[null,null]);
    plan.retainedHand.push(T.observedCard(T.byId.gildedHall.name,2));
    assert.deepEqual(retained([{index:0,titleCandidates:family},{index:1,titleCandidates:family}]),[null,null]);
  });
  await test("Ailin mixed dishes keep observed relative identities through full confirmation and input, not new family members",async()=>{
    const {T,Host,Player}=load("ailin"),h=new Host({}),p=new Player(h,{maxMinutes:30}),
      s=board(T,["autumnFrost","verdantGift","draw"]),a={type:"skill",who:1,skill:"CA"},
      family=["wavekissedSands","verdantGift","gildedHall","autumnFrost"];
    s.active=1;s.dice={Pyro:4};p.memory.round=2;
    let slots=[{index:0,titleCandidates:family,point:719},{index:1,titleCandidates:family,point:913},{index:2,id:"draw",point:1115}];
    h.trace=()=>{};h.frame=fn=>fn({});h.phase=h.phaseIn=()=>({phase:"board",turn:"user"});
    h.boardReady=true;h.removalEvidenceBeforeReset=async()=>null;
    h.observe=async()=>({...copy(s),dice:{Pyro:1},handRead:"full"});
    h.diceBudgetMatches=()=>true;h.executeInput=async()=>{};
    p.observe=async()=>s;p.progress=()=>{};T.choose=()=>a;
    await p.act();assert.equal(h.handContinuation.retainedHandOrder,true);
    h.folded=async()=>({status:"readable",count:slots.length,nativeCount:slots.length,slots});
    h.handPoints=()=>slots.map(x=>x.point);h.handCountIn=h.nativeHandCountIn=()=>slots.length;
    h.fillHandArtwork=async()=>{};
    h.titleAt=async()=>{throw Error("unchanged dishes must not read their titles again");};
    const current=await h.observedHand({mode:"full",...h.handContinuation});
    assert.deepEqual(copy(current.map(x=>x.id)),["autumnFrost","verdantGift","draw"]);
    const bank=JSON.parse(require("../../tools/build.cjs").packageFiles("ailin").files.get("hand-bank.json")).expanded,
      files=Object.fromEntries(["wavekissedSands","draw"].map(id=>{
        const entry=bank.entries.find(e=>e.id===id);
        return [id,new Set([...(entry.patches||[]),...(entry.views||[]).flatMap(v=>v.patches)])];
      })),frames=new Set(),classified=new Set(),
      markers=slots.map(s=>({x:s.point-103,y:820}));
    h.handCostLayoutIn=()=>({markers,points:slots.map(s=>s.point)});
    h.artworkScore=(frame,area,file)=>{
      frames.add(frame);
      const index=markers.findIndex(m=>bank.patches.some(p=>area.rect[0]===m.x+p[0]));
      assert.ok(index>=0);classified.add(index);
      return files[index===2?"draw":"wavekissedSands"].has(file)?.99:0;
    };
    assert.equal(await h.inspectHandCard({type:"tune",id:"verdantGift",index:1},913,{...s,hand:current}),913);
    assert.equal(frames.size,1,"target identity and complete family count belong to the same native frame");
    assert.deepEqual([...classified].sort(),[0,1,2]);
    const cards=()=>slots.map(x=>x.id?T.observedCard(T.byId[x.id].name,x.index):null),fill=()=>{
      const found=cards();h.fillHandVariants(found,slots,current,[],true);return found.map(x=>x?.id??null);};
    slots=[{index:0,id:"soup"},...slots.map(x=>({...x,index:x.index+1}))];
    assert.deepEqual(fill(),["soup","autumnFrost","verdantGift","draw"],"unrelated insertion relocates, not forgets, old dishes");
    slots[0]={index:0,titleCandidates:family};
    assert.deepEqual(fill(),[null,null,null,"draw"],"a newly inserted dish is not an old identity");
    slots=[{index:0,id:"verdantGift"},{index:1,titleCandidates:family}];
    assert.deepEqual(fill(),["verdantGift",null],"positive identity conflict defeats the old order");
  });
  await test("hand view: native expanded or folded layout outranks a stale toggle flag",async()=>{
    for(const scene of ["native-expanded","stale-expanded-flag","unknown","enemy"]){
      const {Host}=load("moonbloom"),h=new Host({});
      let expanded=scene!=="stale-expanded-flag",clicks=0;
      h.boardReady=true;h.handFanReady=["stale-expanded-flag","unknown"].includes(scene);h.handNeedsReset=h.handFanReady;
      h.trace=()=>{};h.frame=fn=>fn({width:1920,height:1080});
      h.phaseIn=()=>({phase:"board",turn:scene==="enemy"?"enemy":"user"});
      // Folded markers are the logged native 9-card row at12:44:25/29.
      // Raised markers use the existing calibrated geometry. Only the
      // matching backend is substituted; both production locators execute.
      h.matches=(_f,asset,area)=>asset!=="hand_cost_neutral"||scene==="unknown"?[]:
        (expanded&&area.panel==="handExpanded"
          ?[587,716,847,976,1103,1225,1352,1492,1634].map(x=>({x:x-103,y:820,w:10,h:30}))
          :!expanded&&area.panel==="handFolded"
            ?[522,607,692,777,863,948,1033,1119,1204].map(x=>({x,y:983,w:10,h:30})):[]);
      h.clickAt=()=>{clicks++;expanded=!expanded;h.inputRevision++;h.boardReady=false;};
      h.moveTo=()=>{};
      if(scene==="enemy"){
        await assert.rejects(()=>h.expand(false),e=>e.code==="TCG_OBSERVATION_INTERRUPTED");
        assert.equal(clicks,0);continue;
      }
      await h.expand(false);
      assert.equal(expanded,true,scene);
      assert.equal(clicks,scene==="stale-expanded-flag"?1:0,scene);
      assert.equal(h.handFanReady,true);assert.equal(h.handNeedsReset,true);
      if(scene!=="unknown")assert.equal(h.boardReady,false);
      await h.expand(false);
      assert.equal(clicks,scene==="stale-expanded-flag"?1:0,"unknown is not permission to repeat the toggle");
    }
    for(const scene of ["enemy-before-reset","enemy-after-reset","unknown-needs-reset"]){
      const {Host}=load("moonbloom"),h=new Host({}),inputs=[];
      h.boardReady=scene==="unknown-needs-reset";
      h.lastObservedAt=100000;h.preparedHandInput={};
      h.trace=()=>{};h.frame=fn=>fn({width:1920,height:1080});h.matches=()=>[];h.moveTo=()=>{};
      h.phaseIn=()=>scene==="enemy-before-reset"||scene==="enemy-after-reset"&&inputs.length
        ?{phase:"board",turn:"enemy"}:scene==="unknown-needs-reset"&&!inputs.length
          ?{phase:"unknown",turn:"none"}:{phase:"board",turn:"user"};
      h.clickAt=(...point)=>{inputs.push(point);h.inputRevision++;h.boardReady=false;return point;};
      if(scene==="unknown-needs-reset"){
        await h.expand();
        assert.deepEqual(inputs,[[1190,545],[967,1041]],"unknown invalidates board readiness before the reset decision");
        assert.equal(h.lastObservedAt,0);assert.equal(h.preparedHandInput,null);
      }else{
        await assert.rejects(()=>h.expand(),e=>e.code==="TCG_OBSERVATION_INTERRUPTED");
        assert.deepEqual(inputs,scene==="enemy-before-reset"?[]:[[1190,545]],"reset and fan toggle retain separate phase boundaries");
      }
    }
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
    for(const scene of ["empty","late-card"]){
      const f=fixture();let foldedReads=0,countReads=0;
      f.h.folded=f.Host.prototype.folded;
      const collapsed=f.h.collapsedIn.bind(f.h);
      f.h.collapsedIn=frame=>{foldedReads++;return collapsed(frame);};
      f.h.ocr=()=>"";f.h.ocrRows=()=>[];
      f.h.handSample=()=>({count:++countReads>=3&&scene==="late-card"?1:null,source:"native-badge"});
      f.h.titleAt=async()=>f.T.byId.draw.name;
      const hand=await f.h.observedHand({mode:"full",expectedCount:null});
      assert.equal(foldedReads,1,"no row enters native counting without exhausting folded retries");
      assert.deepEqual(copy(hand.map(c=>c.id)),scene==="empty"?[]:["draw"],"a later insertion defeats empty-hand proof");
      assert.deepEqual(f.inputs,scene==="empty"?[[967,1041]]:[[967,1041],[1190,545]],"only a nonempty fan needs folding");
      assert.equal(f.h.boardReady,true);assert.equal(f.h.handNeedsReset,false);
      if(scene==="empty")assert.ok(f.events.find(e=>e.event==="hand-count").data.stableMs>=600);
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
  await test("confirmation: view closes before observation despite stale boardReady, never on enemy or choice",async()=>{
    for(const scene of ["user","enemy","choice"]){
      const f=fixture(),s=board(f.T),a={type:"skill",who:0,skill:"E"};
      f.h.captureGeometry={actualSize:{width:2560,height:1600},layoutKey:"16:10"};
      f.h.handFanReady=f.h.handNeedsReset=f.h.boardReady=true;
      f.h.actionSubmittedAt=f.now();f.h.matchDeadline=f.now()+1000;
      f.h.phase=()=>({phase:scene==="choice"?"choice":"board",turn:scene==="choice"?"none":scene});
      f.h.resolveChoice=async()=>{throw Object.assign(Error("not ready"),{code:"TCG_CHOICE_RETRY"});};
      f.h.observe=async()=>{assert.equal(f.h.handNeedsReset,false);throw Object.assign(Error("missing board"),{code:"TCG_BOARD_RETRY"});};
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
      let scene={phase:"choice",turn:"none"};
      f.h.phase=()=>scene;
      f.h.resolveChoice=async()=>{
        f.h.choiceReceipt={origin:f.T.actionKey(a)+"/"+f.T.boardKey(s),kind:"payment",id,exited:true};
        scene={phase:"board",turn:"user"};
      };
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
