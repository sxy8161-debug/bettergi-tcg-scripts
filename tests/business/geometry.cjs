"use strict";
const assert = require("node:assert/strict");
const { load } = require("./runtime.cjs");
const plain = value => JSON.parse(JSON.stringify(value));

// Model the public Region owner chain, not a resized image or native-game proof.
function frame(width, height, dispose = () => {}) {
  const desktop = { Width: 3840, Height: 2160, Prev: null };
  const raw = { Width: width, Height: height, Prev: desktop, dispose };
  return width > 1920
    ? { Width: 1920, Height: height * 1920 / width, Prev: raw, dispose }
    : raw;
}
function fixture(id = "raiden", width = 1920, height = 1080) {
  const calls = [], events = [];
  let size = [width, height], disposed = 0, time = 100000;
  class Clock extends Date { static now() { return time; } }
  const { env, Host, Player } = load(id, {
    Date: Clock,
    sleep: async ms => { time += ms; },
    genshin: { scaleTo1080PRatio: width / 1920 },
    captureGameRegion: () => frame(...size, () => { disposed++; }),
    GameCaptureRegion: { GameRegion1080PPosMove: (...xy) => calls.push(["move", ...xy]) },
    leftButtonClick: () => calls.push(["click"]),
    leftButtonDown: () => calls.push(["down"]),
    leftButtonUp: () => calls.push(["up"]),
    click: () => { throw Error("old click route"); },
    moveMouseTo: () => { throw Error("old move route"); },
  });
  const host = new Host({ maxMinutes: 1 });
  host.trace = (event, data) => events.push({ event, data });
  return { env, host, Player, calls, events, now: () => time, disposed: () => disposed,
    resize: (...next) => { size = next; } };
}

async function combatFixture({size=[2560,1440],skill="E",enemyFrom=6000,enemyUntil=10000,fast=false}={}) {
  const f=fixture("raiden",...size), h=f.host, T=f.env.TCG;
  await h.waitForCapture();
  const started=f.now(), times=[], hand=T.indexedHand(["voltage","companion"].map(id=>T.observedCard(T.byId[id].name,0)));
  const before={phase:"board",turn:"user",active:2,diceKnown:true,dice:{Omni:6},hand,
    characters:T.team.map((t,i)=>({hp:t.maxHp,dead:false,energy:0,frozen:false,raised:i===2})),
    enemies:[{hp:20,dead:false,active:true,aura:[],auraKnown:false}]};
  const after=plain(before); after.dice={Omni:3};after.characters[2].energy=1;
  if(skill==="E"&&!fast)after.hand=T.indexedHand([...hand,T.observedCard(T.byId.wedge.name,2)]);
  if(fast){after.active=0;after.characters.forEach((c,i)=>c.raised=i===0);}
  h.phaseIn=()=>({phase:"board",turn:f.now()-started>=enemyFrom&&f.now()-started<enemyUntil?"enemy":"user"});
  h.board=()=>({...plain(after),...h.phaseIn()});h.boardReady=true;
  h.handCountIn=h.nativeHandCountIn=()=>after.hand.length;
  h.folded=async()=>({status:"readable",count:after.hand.length,nativeCount:after.hand.length,
    slots:after.hand.map((c,index)=>({id:c.id,index}))});
  const observeHand=h.observedHand.bind(h);
  h.observedHand=async(...args)=>{times.push(f.now()-started);return observeHand(...args);};
  h.titleAt=async()=>{throw Error("complete folded identities must not reread titles");};
  h.diceBudgetMatches=()=>true;h.actionSubmittedAt=started;
  const memory=T.freshMemory();memory.fastSwitch=fast;
  return {...f,before,after,memory,handTimes:times,elapsed:()=>f.now()-started,
    action:fast?{type:"switch",target:0}:{type:"skill",who:2,skill}};
}

// Scripted native boundaries for run-slot-09's reroll exit, not a pixel replay.
async function rerollFixture(width = 2560, height = 1440, exitAfter = 2) {
  const f = fixture("raiden", width, height), h = f.host, T = f.env.TCG;
  await h.waitForCapture();
  let confirmations = 0, fan = false, delayed = false, boardReads = 0;
  const before = { phase:"board", turn:"user", active:2, diceKnown:true,
    dice:{Pyro:1,Anemo:1,Dendro:2}, hand:[{id:"toss",name:T.byId.toss.name,index:0,supported:true}],
    characters:[{hp:5,dead:false,energy:0,frozen:false,raised:false},
      {hp:0,dead:true,energy:0,frozen:false,raised:false},
      {hp:9,dead:false,energy:3,frozen:false,raised:true}],
    enemies:[{hp:17,dead:false,active:true,aura:[],auraKnown:false}] };
  h.boardReady = true;
  T.actionRerollGoal = () => ({element:"Electro"});
  h.phaseIn = () => confirmations < exitAfter ? {phase:"roll",turn:"none"} :
    delayed ? {phase:"unknown",turn:"none"} : {phase:"board",turn:"user"};
  h.ocr = (_, {rect}) => rect[1] === 835 ? (confirmations ? "" : "还可重投2轮") :
    rect[1] === 167 ? "重投骰子" : rect[1] === 230 ? "请选择要重投的骰子" : "";
  h.matches = (_, asset, {rect}) => asset === "core/确定" ? [{x:900,y:920,w:120,h:50}] :
    asset === "charge" && rect[0] === 1233 ? Array(3).fill({}) :
    asset === "uncharge" && rect[0] === 812 ? Array(T.team[0].maxEnergy).fill({}) : [];
  h.has = (_, asset, {rect}) => asset === "disable" && rect[0] === 873 && !fan;
  h.hpAt = (_, x, y) => x === 646 && y === 640 ? "5" : x === 1066 && y === 600 ? "9" : "";
  h.numericAt = (_, {rect:[x,y]}) => y === 212 ? "17" :
    x < 800 && y === 640 ? "5" : x > 1000 && y === 600 ? "9" : "";
  h.diceIn = (_, roll) => roll ? {items:(confirmations ? ["Electro","Electro","Electro","Pyro"] :
    ["Dendro","Pyro","Dendro","Anemo"]).map((element,i)=>({element,x:800+i*80,y:400}))} :
    {dice:{Electro:3,Pyro:1}};
  h.diceCountIn = () => 4;
  h.enemiesIn = () => plain(before.enemies);
  h.boardExtrasIn = () => ({});
  h.observedHand = async () => [];
  const click = h.clickAt.bind(h), board = h.board.bind(h);
  h.clickAt = (x,y) => {
    if (x === 1190 && y === 545) {
      assert.deepEqual(plain(h.phaseIn()),{phase:"board",turn:"user"}); fan = false;
    } else {
      assert.equal(h.phaseIn().phase,"roll","no repeat input after reroll exit");
      if (x === 960 && y === 945) {
        confirmations++;
        // 1440 returns an expanded fan despite the old clean-view flags.
        if (confirmations === exitAfter) fan = width === 2560;
      }
    }
    return click(x,y);
  };
  h.board = (...args) => { boardReads++; return board(...args); };
  return {...f,before,confirmations:()=>confirmations,boardReads:()=>boardReads,
    delay(value){delayed=value;}};
}

module.exports = async function (test) {
  await test("geometry:1600 measured hand rows, semantic inputs and viewport preserve1080 identity", async()=>{
    const f=fixture("raiden",2560,1600),h=f.host;
    await h.waitForCapture();
    assert.equal(h.captureGeometry.layoutKey,"16:10");
    assert.deepEqual(plain(h.point("bottom",1716,957)),[1716,1077]);
    assert.deepEqual(plain(h.point("board",750,720)),[750,780]);
    assert.deepEqual(plain(h.roi("viewport",[0,0,384,1080]).rect),[0,0,384,1200]);
    assert.deepEqual(plain(h.roi("mainDice",[1848,177,38,737]).rect),[1848,177,38,737]);
    assert.deepEqual(plain(h.observedRoi("board",[800,900,20,30]).rect),[800,900,20,30]);
    // Values measured from manual-layout captures recorded in the development
    // report, not screenshots synthesized from1080 and not automatic acceptance.
    const rows=[[695,779,864,948,1032],[737,822,906,990]];
    // External native pick frame ee2fd2a8a1235a46af7b4b77: the fifth corner
    // peaks at .882749. Keep whole-row admission after collecting that corner.
    h.matches=(_frame,asset,_area,threshold)=>asset==="hand_cost_neutral"?
      rows[0].map((x,i)=>({x,y:1038,score:i===4?.882749:.94})).filter(m=>m.score>=threshold):[];
    assert.equal(h.frame(frame=>h.collapsedLayoutIn(frame)).count,5);
    assert.equal(h.handCostMarkersIn({},h.roi("handExpanded",[450,750,1310,200])).length,4);
    for(const xs of rows){
      const marks=xs.map(x=>({x,y:1038,w:10,h:30}));
      const read=f.env.TCGCollapsedHand.locate(1920,1200,marks,h.panelTransform("handFolded"));
      assert.equal(read.count,xs.length);assert.equal(read.slots[0].marker.y,1038);
      assert.notEqual(f.env.TCGCollapsedHand.locate(1920,1200,marks.slice(1),h.panelTransform("handFolded")).status,"readable");
    }
    const markers=[[698,874],[912,842],[1129,874],[1326,874]].map(([x,y])=>({x,y,w:10,h:30}));
    const row=f.env.TCGBetterGI.costMarkerLayout(markers,4,h.panelTransform("handExpanded"));
    assert.equal(row.count,4);assert.deepEqual(plain(row.points),[801,1015,1232,1429]);
    await h.drag(1232,1000,...h.point("board",960,720));
    assert.equal(f.calls.filter(c=>c[0]==="down").length,1);assert.equal(f.calls.at(-1)[0],"up");
    assert.deepEqual(f.calls.at(-2),["move",960,780]);
    const normal=fixture();await normal.host.waitForCapture();
    for(const panel of ["phase","board","details","opening","handFolded","handExpanded","header","bottom","mainDice","rollDice"])
      assert.deepEqual(plain(normal.host.point(panel,700,800)),[700,800]);
    f.resize(2560,1440);assert.throws(()=>h.clickAt(100,100),e=>e.code==="TCG_CAPTURE_GEOMETRY");
  });
  await test("geometry:1600 artwork below1080 is read, required clipping fails and temporary images are released",async()=>{
    const f=fixture("raiden",2560,1600),h=f.host;await h.waitForCapture();
    const crops=[],released=[];h.templates.set("existing.png",{});
    const image={Width:1920,Height:1200,SrcMat:{SubMat(...rect){crops.push(rect);return {dispose(){released.push("crop");}};}}};
    const area=h.observedRoi("handFolded",[982,1111,46,22]);
    assert.equal(h.artworkScore(image,area,"existing.png",2,()=>.95),.95);
    assert.deepEqual(crops,[[1109,1135,980,1030]]);assert.deepEqual(released,["crop"]);
    assert.throws(()=>h.artworkScore(image,h.observedRoi("handFolded",[982,1190,46,22]),"existing.png",2,()=>1),e=>e.code==="TCG_CAPTURE_GEOMETRY");
    assert.throws(()=>h.artworkScore(image,area,"existing.png",2,()=>{throw Error("rank failure");}),/rank failure/);
    assert.equal(released.length,2);
  });
  await test("geometry: measured folded marker art false peak uses color only at actual1440; incomplete/extra rows still reject", async () => {
    const samples=require("./fixtures/raiden-folded-markers-1440-20261018.json").rows;
    for(const size of [[1920,1080],[2560,1440]]){
      const f=fixture("raiden",...size),h=f.host;
      await h.waitForCapture();
      const color=size[0]===2560;
      for(let i=0;i<samples.length;i++){
        const sample=samples[i], modes=[];
        h.matches=(_frame,asset,area,threshold,useColor)=>{
          assert.equal(area.panel,"handFolded");assert.equal(threshold,.9);modes.push(useColor);
          return asset==="hand_cost_neutral"?sample[useColor?"color":"gray"].map(([x,y])=>({x,y,w:10,h:30})):[];
        };
        const read=h.frame(frame=>h.collapsedLayoutIn(frame));
        assert.deepEqual(modes,Array(5).fill(color));
        assert.equal(read.count,!color&&i===0?null:sample.expectedCount);
      }
      const C=f.env.TCGCollapsedHand,marks=samples[0].color.map(([x,y])=>({x,y}));
      const first=Math.min(...marks.map(m=>m.x));
      assert.notEqual(C.locate(1920,1080,marks.filter(m=>m.x!==first)).status,"readable");
      assert.notEqual(C.locate(1920,1080,[...marks,{x:1206,y:983}]).status,"readable");
    }
  });
  await test("geometry: 1440 late enemy handoff blocks hand scans, including across confirmation timeout", async () => {
    for(const enemyUntil of [10000,50000]){
      const f=await combatFixture({enemyUntil}),h=f.host;
      if(enemyUntil>45000){
        await assert.rejects(()=>h.confirm(f.action,f.before,f.memory),e=>e.code==="TCG_CONFIRMATION_RETRY");
        assert.equal(f.handTimes.length,0);assert.equal(f.calls.length,0);
      }
      const after=await h.confirm(f.action,f.before,f.memory);
      assert.equal(after.confirmed,true);assert.ok(f.handTimes.length>0);
      assert.ok(f.handTimes.every(at=>at>=enemyUntil+2000),"no early hand expansion/scan in the temporary own-turn window");
      assert.equal(f.calls.length,0);assert.equal(h.confirmationSession,null);
      assert.ok(f.events.some(e=>e.event==="combat-handoff-ready"&&e.data.transition===true));
      assert.ok(f.events.some(e=>e.event==="hand-read-completed"&&e.data.route==="folded-full"&&e.data.titleSlots===0));
    }
  });
  await test("geometry: 1440 continuous own turn is bounded; fast switch and actual1080 retain their old path", async () => {
    for(const skill of ["E","Q"]){
      const f=await combatFixture({skill,enemyFrom:Infinity,enemyUntil:Infinity});
      const after=await f.host.confirm(f.action,f.before,f.memory);
      assert.equal(after.confirmed,true);assert.equal(after.enemies[0].hp,f.before.enemies[0].hp,"zero damage is legitimate");
      assert.ok(f.handTimes.every(at=>at>=(skill==="Q"?15000:10000)+2000));
      assert.ok(f.elapsed()<22000);assert.equal(f.calls.length,0);
    }
    for(const options of [{fast:true,enemyFrom:Infinity},{size:[1920,1080],enemyFrom:Infinity}]){
      const f=await combatFixture(options);await f.host.confirm(f.action,f.before,f.memory);
      assert.ok(f.elapsed()<2000);assert.equal(f.events.some(e=>e.event==="combat-handoff-wait"),false);
      assert.equal(f.calls.length,0);
    }
    const terminal=await combatFixture();
    terminal.host.phaseIn=()=>({phase:"result",turn:"none",result:"win"});
    const result=await terminal.host.confirm(terminal.action,terminal.before,terminal.memory);
    assert.equal(result.result,"win");assert.equal(terminal.handTimes.length,0);assert.equal(terminal.calls.length,0);
  });
  await test("geometry: 1440 late pre-drag phase safely defers, then folds once and rereads no titles", async () => {
    for(const late of [{phase:"board",turn:"enemy"},{phase:"unknown",turn:"none"}]){
      const f=await combatFixture(),h=f.host,p=new f.Player(h,{maxMinutes:2}),scene={phase:"board",turn:"user"};
      h.phaseIn=()=>({...scene});h.board=()=>({...plain(f.before),...scene});h.handCache=null;
      h.prepareHandInput=async()=>{await h.expand(false);return {count:2,stableReads:2,source:"full-cost-layout"};};
      h.inspectHandCard=async(_a,x)=>{h.clickAt(x,945);Object.assign(scene,late);};
      h.drag=async()=>{throw Error("no drag or card confirmation after interrupted phase");};
      h.executeInput=(a,b,m)=>h.inputHand(a,b,m);
      const action={type:"card",id:"voltage",index:0,target:null};
      const execution=await p.execute(action,f.before);
      assert.equal(execution.sent,false);assert.equal(h.handNeedsReset,true);
      assert.equal(f.events.some(e=>e.event==="input-submitted"),false);
      assert.ok(f.events.some(e=>e.event==="execution-deferred"&&e.data.phase===late.phase&&e.data.turn===late.turn));
      Object.assign(scene,{phase:"board",turn:"user"});
      h.handCountIn=h.nativeHandCountIn=()=>2;
      h.folded=async()=>({status:"readable",count:2,nativeCount:2,slots:f.before.hand.map((c,index)=>({id:c.id,index}))});
      const fresh=await h.observe(true,{mode:"full"});assert.equal(fresh.hand.length,2);
      assert.equal(f.events.filter(e=>e.event==="hand-expanded").length,1,"no recovery expansion");
      assert.equal(f.events.filter(e=>e.event==="hand-reset").length,1);
      assert.ok(f.events.some(e=>e.event==="hand-read-completed"&&e.data.route==="folded-full"&&e.data.titleSlots===0));
    }
  });
  await test("geometry: 1440 reroll exit folds the returned fan before fresh death/energy observation; 1080 stays unchanged", async () => {
    for (const size of [[2560,1440],[1920,1080]]) {
      const f = await rerollFixture(...size), h = f.host;
      const after = await h.confirm({type:"card",id:"toss",index:0,target:null},f.before,f.env.TCG.freshMemory());
      assert.equal(after.confirmed,true); assert.equal(f.confirmations(),2);
      assert.equal(after.characters[1].dead,true); assert.equal(after.characters[1].energy,0);
      assert.equal(after.characters[1].hp,0); assert.ok(f.boardReads() >= 2);
      assert.equal(f.events.some(e=>e.event==="confirmation-read-deferred"),false);
      assert.equal(f.events.filter(e=>e.event==="hand-reset").length,size[0]===2560?1:0);
      assert.ok(f.events.some(e=>e.event==="hp-read"&&e.data.index===1&&e.data.hpSource==="native-death-marker"));
      assert.equal(h.tossSession,null); assert.equal(h.confirmationSession,null);
    }
  });
  await test("geometry: 1440 reroll timeout and early board exit retain cleanup without replaying confirmations", async () => {
    const f = await rerollFixture(), h = f.host, action = {type:"card",id:"toss",index:0,target:null};
    f.delay(true);
    await assert.rejects(()=>h.confirm(action,f.before,f.env.TCG.freshMemory()),e=>e.code==="TCG_DICE_RETRY");
    assert.equal(f.confirmations(),2); assert.equal(f.boardReads(),0);
    assert.equal(f.events.some(e=>e.event==="hand-reset"),false);
    f.delay(false);
    const after = await h.confirm(action,f.before,f.env.TCG.freshMemory());
    assert.equal(after.confirmed,true); assert.equal(f.confirmations(),2);
    assert.equal(f.events.filter(e=>e.event==="hand-reset").length,1);
    const early = await rerollFixture(2560,1440,1);
    const proof = await early.host.actionReroll(early.before,early.env.TCG.freshMemory());
    assert.equal(proof.confirmations,1); assert.equal(proof.unresolved,true);
    assert.equal(early.confirmations(),1); assert.equal(early.host.tossSession,null);
    assert.equal(early.events.filter(e=>e.event==="hand-reset").length,1);
  });
  await test("geometry: one explicit region contract rejects bare, stale, unaccepted-scale and clipped required ROIs", () => {
    const { host } = fixture(), f = frame(1920, 1080), a = host.roi("details", [100, 200, 30, 40]);
    assert.deepEqual(plain(a), { rect:[100,200,30,40], scale:1, layoutKey:"16:9", panel:"details" });
    assert.deepEqual(plain(host.checkedRoi(f, a)), [100,200,30,40]);
    for (const bad of [[100,200,30,40], {...a,layoutKey:"16:10"}, {...a,scale:2},
      {...a,rect:[-0.2,200,30,40]}, {...a,rect:[1900,200,30,40]}])
      assert.throws(() => host.ocr(f, bad), e => e.code === "TCG_CAPTURE_GEOMETRY");
    assert.deepEqual(plain(host.observedRoi("details", [101,202,30,40]).rect), [101,202,30,40]);
  });
  await test("geometry: actual local OCR dimensions round-trip to F once, cache only this frame and release on error", async () => {
   for(const scenario of [
    {height:1440,panel:"details",rect:[135.4,122.4,238.2,42.2],zoom:1.25,crop:[135,122,238,42],output:[298,53],box:[254,143,23.8,4.2],click:[266,145]},
    {height:1600,panel:"opening",rect:[283,730,200,60],zoom:1,crop:[307,783,193,58],output:[200,60],box:[403.5,812,19.3,5.8],click:[413,815]},
   ]){
    const f = fixture("raiden",2560,scenario.height), dispose=[], crops=[];
    await f.host.waitForCapture();
    const capture=f.env.captureGameRegion,[width,height]=scenario.output;
    let reads=0, fail=false;
    f.env.RecognitionObject={Ocr:(...roi)=>({roi})};
    f.env.OpenCvSharp={OpenCvSharp:{Size:class{constructor(w,h){this.w=w;this.h=h;}}}};
    f.env.ImageRegion=class{
      constructor(mat){this.mat=mat;}
      FindMulti(ro){reads++;assert.deepEqual(Array.from(ro.roi),[0,0,width,height]);if(fail)throw new TypeError("scripted OCR failure");
        return {count:1,0:{text:"确定",x:width/2,y:height/2,width:width/10,height:height/10}};}
      dispose(){dispose.push("region");this.mat.dispose();}
    };
    f.env.captureGameRegion=()=>Object.assign(capture(),{DeriveCrop(...roi){crops.push(roi);return {
      SrcMat:{Resize(size){assert.deepEqual([size.w,size.h],scenario.output);return {dispose(){dispose.push("resized");}};}},dispose(){dispose.push("crop");}};}});
    const area=f.host.roi(scenario.panel,scenario.rect);
    const sample=()=>f.host.frame(image=>{const a=f.host.enlargedOcrRows(image,area,scenario.zoom);
      assert.equal(f.host.enlargedOcrRows(image,area,scenario.zoom),a);return a;});
    const rows=sample();assert.equal(reads,1);assert.deepEqual(crops,[scenario.crop]);
    ["x","y","w","h"].forEach((key,i)=>assert.ok(Math.abs(rows[0][key]-scenario.box[i])<1e-9));
    f.host.clickAt(rows[0].x+rows[0].w/2,rows[0].y+rows[0].h/2);
    assert.deepEqual(f.calls,[["move",...scenario.click],["click"]]);
    sample();assert.equal(reads,2);fail=true;
    assert.throws(sample,/scripted OCR failure/);
    assert.equal(reads,3);assert.deepEqual(dispose,Array(3).fill(["region","resized","crop"]).flat());
   }
  });
  await test("geometry:1600 roll uses measured native dice scale and all eight distinct slots",async()=>{
    const evidence=require("./fixtures/roll-1600-native-20261018.json"),f=fixture("raiden",2560,1600),h=f.host;
    await h.waitForCapture();
    // Recorded rectangles are independent pixel measurements, not generated
    // by panelTransform. This tests consumers, not a new pixel accuracy claim.
    h.matches=(_,asset,area)=>{
      assert.equal(area.panel,"rollDice");
      assert.ok(area.scale>=evidence.measuredScaleRange[0]&&area.scale<=evidence.measuredScaleRange[1]);
      const [x,y,w,hh]=area.rect;
      return evidence.hits.filter(r=>asset==="dice/NativeRoll"+r.element&&r.x>=x&&r.y>=y&&r.x+r.w<=x+w&&r.y+r.h<=y+hh);
    };
    const dice=h.frame(image=>h.diceIn(image,true));
    assert.deepEqual(plain(dice.items.map(d=>[d.element,d.slot])),evidence.hits.map((d,i)=>[d.element,i]));
    assert.deepEqual(plain(dice.dice),{Cryo:0,Hydro:2,Pyro:2,Electro:2,Anemo:1,Geo:0,Dendro:0,Omni:1});
  });
  await test("recognition: complete views and different-identity margin decide acceptance",()=>{
    const {env}=load("raiden"),layout={status:"readable",count:1,slots:[{index:0}]};
    const entry=(id,views)=>({id,views:views.map((patches,i)=>({name:String(i),patches}))});
    const identify=(entries,scores)=>env.TCGCollapsedHand.identify(layout,{scoreFloor:.9,runnerUpGap:.2,
      patches:[[0,0,46,22],[0,26,46,22]],entries},(_slot,_patch,file)=>scores[file]).slots[0];
    const a=entry("a",[["a1","a2"],["a3","a4"]]),b=entry("b",[["b1","b2"]]);
    // A's two complete views do not compete against each other for the gap.
    assert.equal(identify([a,b],{a1:.99,a2:.99,a3:.98,a4:.98,b1:.6,b2:.6}).id,"a");
    const ambiguous=identify([a,b],{a1:.99,a2:.99,a3:.98,a4:.98,b1:.98,b2:.98});
    assert.equal(ambiguous.id,null);assert.equal(ambiguous.rejectionReason,"runner-up-gap");
    // Never splice individually good patches across incomplete/different views.
    assert.equal(identify([a,b],{a1:.99,a2:.1,a3:.1,a4:.99,b1:.2,b2:.2}).id,null);
    assert.equal(identify([entry("a",[["a1"]]),b],{a1:.99,b1:.2,b2:.2}).id,null);
  });
  await test("geometry: Iansan fee, payment banner and soup coordinates preserve1080 and follow1600 panels", async()=>{
   for(const height of [1080,1600]){
    const f=fixture("iansan",height===1080?1920:2560,height),h=f.host;
    await h.waitForCapture();
    const dy=height===1600?60:0,rois=[];
    h.numericAt=(_,area)=>{rois.push(plain(area.rect));return "0";};
    assert.equal(h.skillFeeIn({}, {who:0,skill:"E"},{who:0,skill:"E"}),0);
    assert.deepEqual(rois,[[1698,1010+dy*2,36,35]]);
    h.ocr=(_,area)=>{
      rois.push(plain(area.rect));
      if(!["header","choice"].includes(area.panel))return "打出手牌";
      // Shared native choice title: its top is197 at1600, not body y215.
      const top=173+(height===1600?24:0),[x,y,w,hh]=area.rect;
      return x<=849&&y<=top&&x+w>=1074&&y+hh>=top+55?"挑选卡牌 请选择一张卡牌":"挑选下牌 请选择一张卡牌";
    };
    h.cardBannerIn({});assert.deepEqual(rois.at(-1),[560,508+dy,790,70]);
    h.ocrRows=()=>Object.keys(f.env.TCG.soupOptions).slice(0,3).map((text,i)=>({text,x:400+i*450,y:742+dy,w:120,h:32}));
    const choice=h.choiceIn({});assert.equal(choice.recognized,true);
    assert.deepEqual(rois.at(-1),[700,155+(height===1600?24:0),520,130]);
    assert.deepEqual(plain(choice.options.map(c=>c.point)),[[460,558+dy],[910,558+dy],[1360,558+dy]]);
    h.prepareBoardObservation();assert.deepEqual(f.calls.at(-1),["move",1555,545+dy]);
   }
  });
  await test("geometry: Moon fees and technique inputs share bottom panel while details retain top anchor", async()=>{
   for(const [width,height] of [[1920,1080],[2560,1600]]){
    const f=fixture("moonbloom",width,height),h=f.host,T=f.env.TCG;
    await h.waitForCapture();
    const dy=height===1600?120:0,rois=[];
    h.numericAt=(_,area)=>{rois.push(plain(area.rect));return "2";};
    assert.equal(h.skillFeeIn({}, {skill:"E"}),2);
    assert.equal(h.skillFeeIn({}, {skill:"Q"}),2);
    assert.deepEqual(rois,[[1698,1010+dy,36,35],[1780,1010+dy,36,35]]);
    h.ocr=(_,area)=>{rois.push(plain(area.rect));return "特技";};
    h.phaseIn=()=>({phase:"board",turn:"user"});h.warnings=()=>({});h.requireNoWarning=async()=>{};
    const memory=T.freshMemory();memory.techniques[0]={id:"tepetli",uses:2};
    await h.inputTechnique({type:"skill",who:0,skill:"T",technique:"tepetli"},
      {active:0,dice:{Omni:8},hand:[]},memory);
    assert.deepEqual(rois.slice(2),[[1482,1010+dy,36,35],[70,210,320,85]]);
    assert.deepEqual(f.calls,[["move",1500,957+dy],["click"],["move",1500,957+dy],["click"]]);
   }
  });
  await test("geometry: Moon target selection transforms board coordinates but not observed confirmation controls", async()=>{
   for(const [width,height] of [[1920,1080],[2560,1600]]){
    const f=fixture("moonbloom",width,height),h=f.host,dy=height===1600?60:0;
    await h.waitForCapture();
    h.choiceSession={kind:"target",id:"fruit",target:2,action:{type:"card",id:"fruit",target:2},selected:false,confirmed:false};
    h.phase=()=>h.choiceSession.confirmed?{phase:"board",turn:"user"}:{phase:"unknown",turn:"none"};
    h.cardChoicePreviewIn=()=>({phase:{phase:"unknown",turn:"none"},banner:"请选择要装备法器的角色",
      controls:[{x:800,y:900+dy,w:300,h:60}],buttons:[]});
    await h.resolveChoice(null,f.env.TCG.freshMemory());
    assert.deepEqual(f.calls,[["move",1175,720+dy],["click"],["move",950,930+dy],["click"]]);
    assert.equal(h.choiceSession,null);assert.equal(h.choiceReceipt.exited,true);
   }
  });
  await test("geometry: Moon generated-choice bounds use reference space and retain observed input points", async()=>{
   for(const [width,height] of [[1920,1080],[2560,1600]]){
    const f=fixture("moonbloom",width,height),h=f.host,T=f.env.TCG,dy=height===1600?60:0;
    await h.waitForCapture();
    // The saved1600 choice scene has its title at F y197..252, not y215+.
    // Clipping the upper glyph strokes produces "挑选下牌" in saved-frame OCR.
    const titleBox=[849,173+(height===1600?24:0),225,55];
    h.ocr=(_,area)=>{
      const [x,y,w,hh]=area.rect,[tx,ty,tw,th]=titleBox;
      return x<=tx&&y<=ty&&x+w>=tx+tw&&y+hh>=ty+th?
        "挑选卡牌 请选择一张卡牌":"挑选下牌 请选择一张卡牌";
    };
    // A narrow OCR row at the bottom of the choice-title ROI stays a valid option.
    h.ocrRows=()=>["sanctify","disperse"].map((id,i)=>({text:T.byId[id].name,x:600+i*600,y:790+dy,w:120,h:4}));
    const choice=h.choiceIn({});assert.equal(choice.recognized,true);assert.equal(choice.choiceKind,"sand");
    assert.deepEqual(plain(choice.options.map(o=>o.point)),[[660,592+dy],[1260,592+dy]]);
    assert.equal(f.calls.length,0);
   }
  });
  await test("geometry: raw and normalized Region owners bind actual size without mistaking desktop", async () => {
    for (const id of ["raiden", "iansan", "moonbloom"]) for (const size of [[1920, 1080], [2560, 1440], [2560, 1600]]) {
      const f = fixture(id, ...size);
      await f.host.waitForCapture();
      assert.deepEqual(plain(f.host.captureGeometry.actualSize), { width: size[0], height: size[1] });
      assert.deepEqual(plain(f.host.captureGeometry.frameSize), { width: 1920, height: size[1]===1600?1200:1080 });
      assert.equal(f.host.captureGeometry.layoutKey, size[1]===1600?"16:10":"16:9");
      assert.equal(f.disposed(), 2);
      assert.equal(f.calls.length, 0);
    }
    const f = fixture("raiden", 2560, 1440);
    let reads = 0;
    f.env.captureGameRegion = () => frame(...(++reads === 1 ? [1920, 1080] : [2560, 1440]));
    // A different actual size with the same F size cannot count toward stability.
    f.env.genshin.scaleTo1080PRatio = 1;
    f.env.sleep = async () => { f.env.genshin.scaleTo1080PRatio = 2560 / 1920; };
    await f.host.waitForCapture();
    assert.equal(reads, 3);
  });
  await test("geometry: normalized observations click once through native input without a second scale", async () => {
    const f = fixture("moonbloom", 2560, 1440);
    await f.host.waitForCapture();
    f.host.clickAt(960.5, 945.5);
    assert.deepEqual(f.calls, [["move", 961, 946], ["click"]]);
    assert.equal(f.host.inputRevision, 1);
    for (const point of [[NaN, 1], [Infinity, 1], [-1, 1], [1920, 1], [1919.6, 1], [1, 1079.6]])
      assert.throws(() => f.host.clickAt(...point));
    assert.equal(f.calls.length, 2);
  });
  await test("geometry: scale mismatch and unsupported client sizes stop before OCR or input", async () => {
    for (const size of [[1920, 1200], [1600, 900], [3440, 1440]]) {
      const f = fixture("raiden", ...size);
      await assert.rejects(() => f.host.waitForCapture(), e => e.code === "TCG_CAPTURE_GEOMETRY");
      assert.equal(f.calls.length, 0);
    }
    const f = fixture("iansan", 2560, 1440);
    f.env.genshin.scaleTo1080PRatio = 1;
    assert.throws(() => f.host.frame(() => { throw Error("must not read OCR"); }),
      e => e.code === "TCG_CAPTURE_GEOMETRY");
    assert.equal(f.disposed(), 1);
    assert.equal(f.calls.length, 0);
    const missingOwner = fixture();
    missingOwner.env.captureGameRegion = () => ({ Width: 1920, Height: 1080, dispose() {} });
    assert.throws(() => missingOwner.host.clickAt(960, 945), e => e.code === "TCG_CAPTURE_GEOMETRY");
    assert.equal(missingOwner.calls.length, 0);
  });
  await test("geometry: changed actual size is terminal even when normalized frame is unchanged", async () => {
    for (const size of [[1920, 1080], [2560, 1600]]) {
      const f = fixture("moonbloom", 2560, 1440);
      await f.host.waitForCapture();
      f.host.boardReady = true;
      f.host.handPositionProof = { old: true };
      f.host.preparedHandInput = { old: true };
      f.resize(...size);
      assert.throws(() => f.host.clickAt(960, 945), e => e.code === "TCG_CAPTURE_GEOMETRY");
      assert.equal(f.host.boardReady, false);
      assert.equal(f.host.handPositionProof, null);
      assert.equal(f.host.preparedHandInput, null);
      f.resize(2560, 1440);
      assert.throws(() => f.host.clickAt(960, 945), e => e.code === "TCG_CAPTURE_GEOMETRY");
      const player = new f.Player(f.host, { maxMinutes: 1 });
      await assert.rejects(() => player.defer(f.host.captureGeometryError, ["TCG_DICE_RETRY"], "retry", "wait"),
        e => e.code === "TCG_CAPTURE_GEOMETRY");
      assert.equal(f.calls.length, 0);
    }
  });
  await test("geometry: resize during a held drag releases the button and sends no further motion", async () => {
    const f = fixture();
    await f.host.waitForCapture();
    await assert.rejects(() => f.host.drag(500, 945, 1920, 595), e => e.code === "TCG_CAPTURE_GEOMETRY");
    assert.equal(f.calls.length, 0);
    f.env.leftButtonDown = () => { f.calls.push(["down"]); f.resize(2560, 1600); };
    await assert.rejects(() => f.host.drag(500, 945, 960, 595), e => e.code === "TCG_CAPTURE_GEOMETRY");
    assert.deepEqual(f.calls, [["move", 500, 945], ["down"], ["up"]]);
  });
};
