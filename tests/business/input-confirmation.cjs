"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs");
const clone=value=>JSON.parse(JSON.stringify(value));
module.exports=async function(test){
  const id="input";
  await test(id+": end round confirms after the popup animation and before its expiry",async()=>{
    for(const mode of ["popup","already-open","cancel"]){
      let now=0,phase={phase:"board",turn:"user"};const clicks=[];
      const {Host,T}=load("moonbloom",{sleep:async ms=>{
        if(mode==="cancel")throw Error("cancelled");now+=ms;
      }}),h=new Host({});
      h.button=()=>({x:51,y:510,w:60,h:60});h.trace=()=>{};
      h.clickAt=(x,y)=>{
        clicks.push({at:now,x,y});
        if(mode==="already-open"||clicks.length===2&&now>=1000&&now<5000)
          phase={phase:"roll",turn:"none"};
        return [x,y];
      };
      h.phase=()=>phase;
      if(mode==="cancel"){
        await assert.rejects(()=>h.inputEnd(),/cancelled/);assert.equal(clicks.length,1);continue;
      }
      await h.inputEnd();
      assert.equal(clicks.length,mode==="already-open"?1:2);
      const after=await h.confirmPending({type:"end"},require("./runtime.cjs").board(T));
      assert.equal(after.confirmed,true);assert.equal(after.phase,"roll");
    }
  });
  await test(id+": changed complete preflight replans immediately; only missing fields retry",async()=>{
    const {T,Host}=load("ailin"),base=require("./runtime.cjs").board(T),changed=clone(base);
    changed.dice={Omni:2};
    for(const sequence of [[changed,changed],[changed,base,base]]){
      const h=new Host({}),events=[];let reads=0;
      h.boardReady=true;h.board=()=>clone(sequence[Math.min(reads++,sequence.length-1)]);
      h.trace=(event,data)=>events.push({event,data});
      h.clickAt=()=>{throw Error("preflight cannot send input");};
      {
        await assert.rejects(()=>h.requireUnchangedBoard(base),e=>e.code==="TCG_STATE_REFRESH");
        assert.equal(reads,1,"never wait for obsolete resources to return");
        assert.deepEqual(clone(events.at(-1).data.changes.dice),clone({before:T.diceOrder.map(e=>base.dice[e]||0),after:T.diceOrder.map(e=>changed.dice[e]||0)}));
      }
    }
    const h=new Host({}),gap=clone(changed);gap.characters[0].energy=null;
    let reads=0;h.boardReady=true;h.board=()=>{reads++;return clone(gap);};
    await assert.rejects(()=>h.requireUnchangedBoard(base),e=>e.code==="TCG_STATE_REFRESH");
    assert.equal(reads,6,"incomplete reads are not stable new facts");
    let events=[];h.trace=(event,data)=>events.push({event,data});h.prepareBoardObservation=()=>{};
    reads=0;h.autoRisk=true;h.board=()=>clone([base,changed,changed][Math.min(reads++,2)]);
    await h.settledBoard();
    assert.ok(events.some(e=>e.event==="board-settle-wait"&&e.data.changes?.dice),"existing samples explain the stability reset");
  });
  await test(id+": recent complete observation checks phase only; stale or intervening input reads one board",async()=>{
    const {T,Host}=load("ailin"),base=require("./runtime.cjs").board(T);
    for(const mode of ["recent","stale","input","choice"]){
      const h=new Host({});let reads=0;
      h.boardReady=true;h.lastObservedState=base;h.lastObservedAt=Date.now()-(mode==="stale"?2000:0);
      h.lastObservedRevision=h.inputRevision-(mode==="input"?1:0);
      h.phase=()=>mode==="choice"?{phase:"choice",turn:"none"}:{phase:"board",turn:"user"};
      h.board=()=>{reads++;return clone(base);};h.clickAt=()=>{throw Error("preflight is read-only");};
      if(mode==="choice")await assert.rejects(()=>h.requireUnchangedBoard(base),e=>e.code==="TCG_OBSERVATION_INTERRUPTED");
      else assert.deepEqual(clone(await h.requireUnchangedBoard(base)),clone(base));
      assert.equal(reads,["recent","choice"].includes(mode)?0:1);
    }
    const h=new Host({});h.trace=()=>{};h.frame=fn=>fn({});
    const forbidden=()=>{throw Error("non-user action observation must not scan board resources");};
    h.characterIn=h.diceIn=h.enemiesIn=h.boardExtrasIn=forbidden;
    for(const phase of [{phase:"board",turn:"enemy"},{phase:"unknown",turn:"none"}]){
      h.boardReady=true;h.phaseIn=()=>clone(phase);
      await assert.rejects(()=>h.requireUnchangedBoard(base),e=>
        e.code===(phase.phase==="unknown"?"TCG_STATE_REFRESH":"TCG_OBSERVATION_INTERRUPTED")&&e.phase.phase===phase.phase);
    }
    // The post-hand read also needs only phase once the opponent takes over.
    h.settledBoard=async()=>clone(base);h.initialObservationBoard=()=>clone(base);
    h.observedHand=async()=>{h.inputRevision++;return [];};
    h.phaseIn=()=>({phase:"board",turn:"enemy"});
    assert.equal((await h.observe()).turn,"enemy");
  });
  await test(id+": tuning keeps real pre-reset count proof and does not reopen the consumed hand",async()=>{
    const {T,Host}=load("ailin"),before=require("./runtime.cjs").board(T,["toss","chef"]),
      action={type:"tune",id:"toss",index:0,element:"Cryo"},plan={mode:"remove",hand:T.indexedHand(before.hand.slice(1)),action,before};
    for(const count of [1,2,null]){
      const h=new Host({});h.handFanReady=true;h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
      h.handCountIn=()=>count;h.consumptionReceipt={id:action.id,index:0,target:null,beforeKey:T.boardKey(before),inputSent:true};
      const proof=await h.removalEvidenceBeforeReset(plan);
      if(count!==1){assert.equal(proof,null);continue;}
      h.handFanReady=h.handNeedsReset=false;
      h.handCount=async()=>{throw Error("do not expand again after native removal proof");};
      const hand=await h.observedHand({...plan,preResetEvidence:proof});
      assert.deepEqual(clone(hand),clone(plan.hand));
    }
  });

  await test(id+": full support area is a blocking native choice, never a completed or repeated card",async()=>{
    const {T,Host}=load("ailin"),h=new Host({}),before={phase:"board",turn:"user",active:0,diceKnown:true,dice:{Omni:1},
      characters:T.team.map(t=>({hp:t.maxHp,energy:0,dead:false,frozen:false})),enemies:[],
      hand:T.indexedHand([T.observedCard("西尔弗和迈勒斯",0)])},
      action={type:"card",id:"silver",index:0,target:null};
    let clicks=0;h.frame=fn=>fn({});h.has=(_f,asset)=>asset==="user_turn";
    h.clickAt=()=>{clicks++;};h.ocr=(_f,area)=>area.panel==="phase"&&area.rect[0]===560?
      "支援区已满，需先选择一张支援牌弃置":"";
    h.cardPaymentControlsIn=()=>{throw Error("A support discard choice is not payment");};
    const phase=h.phaseIn({});assert.equal(phase.phase,"choice");assert.equal(phase.choiceKind,"support-discard");
    h.requireNoWarning=async()=>{};
    await assert.rejects(()=>h.cardConfirm(action,before),e=>e.code==="TCG_SUPPORT_FULL");
    h.phase=()=>phase;
    await assert.rejects(()=>h.confirm(action,before,T.freshMemory()),e=>e.code==="TCG_SUPPORT_FULL");
    assert.equal(clicks,0);assert.equal(h.confirmationSession,null);
  });
  function fixture(interrupt,deck="raiden"){
    let time=0,scene={phase:"board",turn:"user"},previews=0;
    class Clock extends Date{static now(){return 100000+time;}}
    let point=null;
    const inputs=[],inputTimes=[],{env:c}=load(deck,{Date:Clock,sleep:async ms=>{time+=ms;},
      genshin:{scaleTo1080PRatio:1},captureGameRegion:()=>({Width:1920,Height:1080,
        Prev:{Width:3840,Height:2160,Prev:null},dispose(){}}),
      GameCaptureRegion:{GameRegion1080PPosMove:(...xy)=>{point=xy;}},
      leftButtonClick:()=>{inputs.push(point);inputTimes.push(time);}}),T=c.TCG,
      h=new c.TCGBetterGI.BetterGIHost(c.TCGPlayer.playerOptions({})),state={phase:"board",turn:"user",active:1,
        diceKnown:true,dice:{Omni:5},hand:[],characters:T.team.map(t=>({hp:t.maxHp,energy:0,dead:false,frozen:false})),
        enemies:[{hp:10,dead:false,active:true,aura:[],auraKnown:false}]};
    h.frame=fn=>fn({});h.board=()=>clone(state);h.boardReady=true;h.phase=()=>clone(scene);
    // Interrupt before either restored OCR preview can authorize confirmation.
    h.phaseIn=()=>{if(scene.phase==="unknown"&&++previews===1&&interrupt==="preview")scene={phase:"choice",turn:"none"};return clone(scene);};
    h.warnings=()=>({lack:false,text:""});h.matches=()=>[];
    h.ocr=(_,{rect: roi})=>roi[0]===311?T.team[2].name:roi[0]===700?"将所选角色切换为出战角色":roi[0]===1720?"切换角色":"";
    h.trace=event=>{if(event==="title-read"&&interrupt==="title")scene={phase:"choice",turn:"none"};};
    const click=h.clickAt.bind(h);h.clickAt=(x,y)=>{const p=click(x,y);if(x===1820)scene={phase:"unknown",turn:"none"};return p;};
    return {T,h,state,inputs,inputTimes,time:()=>time};
  }
  await test(id+": late choice interrupts the selected role or payment before confirmation",async()=>{
    for(const point of ["title","preview"]){
      const f=fixture(point);
      await assert.rejects(()=>f.h.execute({type:"switch",target:2},f.state,f.T.freshMemory()),
        e=>e.code==="TCG_OBSERVATION_INTERRUPTED"&&e.phase.phase==="choice");
      assert.deepEqual(f.inputs,point==="title"?[[1175,720]]:[[1175,720],[1820,958]]);
    }
  });
  await test(id+": ordinary switch still selects the role and confirms payment once",async()=>{
    const f=fixture();await f.h.execute({type:"switch",target:2},f.state,f.T.freshMemory());
    assert.deepEqual(f.inputs,[[1175,720],[1820,958],[1820,958]]);
    assert.equal(f.inputs.length,3);
  });
  await test(id+": switch payment not opened during handoff returns to observation without submission",async()=>{
    const f=fixture(),events=[];f.h.phaseIn=()=>({phase:"board",turn:"user"});
    f.h.ocr=(_f,{rect:r})=>r[0]===311?f.T.team[2].name:"";
    f.h.trace=(event,data)=>events.push({event,data});
    await assert.rejects(()=>f.h.execute({type:"switch",target:2},f.state,f.T.freshMemory()),e=>e.code==="TCG_STATE_REFRESH");
    assert.deepEqual(f.inputs,[[1175,720],[1820,958]],"no final payment click or blind replay");
    assert.equal(f.h.autoRisk,true);
    assert.equal(events.some(e=>e.event==="input-submitted"),false);
  });
  await test(id+": long first-slot tuning drag holds down before moving, settles at destination and always releases",async()=>{
    for(const failHold of [false,true]){
      let time=0,point=null,held=false,pressedAt=null,arrivedAt=null,up=0,grabbed=false;
      const interrupted=Error("cancel during mouse-down hold"),moves=[],
        {env:c}=load("ailin",{sleep:async ms=>{time+=ms;if(failHold&&held&&moves.length===0)throw interrupted;},
          genshin:{scaleTo1080PRatio:1},captureGameRegion:()=>({Width:1920,Height:1080,
            Prev:{Width:3840,Height:2160,Prev:null},dispose(){}}),
          GameCaptureRegion:{GameRegion1080PPosMove:(...xy)=>{point=xy;if(held){
            if(moves.length===0){assert.ok(time-pressedAt>=100,"game must acquire the leftmost card before the first long move");grabbed=true;}
            moves.push(xy);if(xy[0]===1867&&xy[1]===518)arrivedAt=time;
          }}},leftButtonDown:()=>{held=true;pressedAt=time;},leftButtonUp:()=>{
            if(!failHold){assert.ok(grabbed);assert.ok(time-arrivedAt>=100,"settle in the tuning drop zone before release");}
            held=false;up++;
          }}),h=new c.TCGBetterGI.BetterGIHost({});
      if(failHold)await assert.rejects(()=>h.drag(719,945,1867,518),e=>e===interrupted);
      else {await h.drag(719,945,1867,518);assert.deepEqual(point,[1867,518]);}
      assert.equal(held,false);assert.equal(up,1,"no retry or stuck mouse button on cancellation");
    }
  });
  await test(id+": fixed actor and slot submit once without skill-name, type or preview-image recognition",async()=>{
    for(const [deck,who,skill,x] of [["raiden",0,"NA",1608],["iansan",0,"E",1716],["moonbloom",0,"E",1716],["mozailu",2,"Q",1824]]){
      const f=fixture(undefined,deck),events=[];f.state.active=who;
      f.state.characters[who].energy=f.T.team[who].maxEnergy;
      f.h.trace=(event,data)=>events.push({event,data});
      f.h.phaseIn=()=>({phase:"unknown",turn:"none"});
      f.h.ocr=f.h.numericAt=f.h.matches=()=>{throw Error("Ordinary skill submission must not identify the preview");};
      await f.h.execute({type:"skill",who,skill},f.state,f.T.freshMemory());
      assert.deepEqual(f.inputs,[[x,957],[x,957]],deck);
      assert.equal(events.filter(e=>e.event==="input-submitted").length,1,deck);
      assert.ok(f.inputTimes[1]-f.inputTimes[0]>=1200,"allow the first click's animation to open");
    }
  });
  await test(id+": resource, actor, freeze and late-phase guards stop before the final skill click",async()=>{
    for(const scenario of ["insufficient","wrong-actor","frozen","uncharged","warning","late-choice","enemy"]){
      const f=fixture(),events=[];f.state.active=0;
      f.h.trace=(event,data)=>events.push({event,data});
      const action={type:"skill",who:0,skill:scenario==="uncharged"?"Q":"NA"};
      if(scenario==="insufficient")f.state.dice={Omni:2};
      if(scenario==="wrong-actor")action.who=1;
      if(scenario==="frozen")f.state.characters[0].frozen=true;
      f.h.phaseIn=()=>scenario==="late-choice"?{phase:"choice",turn:"none"}:
        scenario==="enemy"?{phase:"board",turn:"enemy"}:{phase:"unknown",turn:"none"};
      if(scenario==="warning"){f.h.warnings=()=>({lack:true,text:""});f.h.reset=async()=>{};}
      await assert.rejects(()=>f.h.execute(action,f.state,f.T.freshMemory()),
        scenario==="warning"?e=>e.code==="TCG_INPUT_REJECTED":
        ["late-choice","enemy"].includes(scenario)?e=>e.code==="TCG_OBSERVATION_INTERRUPTED":/技能资源\/充能预检失败/);
      assert.equal(f.inputs.length,["warning","late-choice","enemy"].includes(scenario)?1:0,scenario);
      assert.ok(!events.some(e=>e.event==="input-submitted"),scenario);
    }
  });
  await test(id+": dice decrease confirms through the existing pending session without another input",async()=>{
    const f=fixture(),action={type:"skill",who:0,skill:"NA"},m=f.T.freshMemory();f.state.active=0;
    f.h.phaseIn=()=>({phase:"unknown",turn:"none"});
    await f.h.execute(action,f.state,m);
    let reads=0;
    f.h.observe=async()=>{const s=clone(f.state);if(++reads>1)s.dice={Omni:2};return s;};
    const result=await f.h.confirm(action,f.state,m);
    assert.equal(result.confirmed,true);assert.equal(result.freshObservationRequired,true);
    assert.deepEqual(f.inputs,[[1608,957],[1608,957]],"observations never resend the skill");
    assert.equal(f.h.confirmationSession,null);
  });
  await test(id+": early combat payment hands its observation risk to Player; late enemy phase cannot become a decision",async()=>{
    const {T,Host,Player}=load("consecrated"),h=new Host({}),p=new Player(h,{maxMinutes:15}),
      s=require("./runtime.cjs").board(T),a={type:"skill",who:0,skill:"E"};
    s.dice={Omni:8};p.memory=T.freshMemory({newGame:true});h.memory=p.memory;
    p.observe=async()=>s;p.progress=()=>{};T.choose=()=>a;
    h.executeInput=async()=>{};h.phase=()=>({phase:"board",turn:"user"});
    h.observe=async()=>({...clone(s),dice:{Omni:5}});h.diceBudgetMatches=()=>true;
    h.removalEvidenceBeforeReset=async()=>null;
    await p.act();assert.equal(p.readyState,null);assert.equal(h.autoRisk,true);
    h.handFanReady=h.handNeedsReset=false;
    h.board=()=>({phase:"board",turn:"enemy"});
    assert.equal((await h.settledBoard()).turn,"enemy");
    h.board=()=>clone(s);const after=await h.settledBoard();
    assert.equal(after.nativeStability.reads,2);assert.equal(h.autoRisk,false);
  });
  await test(id+": unresolved ordinary skill view resets once in its pending owner without replaying the skill",async()=>{
    for(const outcome of ["paid","unchanged","still-unknown"]){
      const f=fixture(),action={type:"skill",who:0,skill:"NA"},m=f.T.freshMemory();f.state.active=0;
      f.h.phaseIn=()=>({phase:"unknown",turn:"none"});
      await f.h.execute(action,f.state,m);
      let phase={phase:"unknown",turn:"none"};f.h.phase=()=>clone(phase);
      const click=f.h.clickAt.bind(f.h);
      f.h.clickAt=(x,y)=>{const p=click(x,y);if(x===1190&&y===545&&outcome!=="still-unknown")phase={phase:"board",turn:"user"};return p;};
      f.h.observe=async()=>({...clone(f.state),dice:{Omni:outcome==="paid"?2:5},handRead:"full"});
      f.h.observedResourceProof=async()=>({revision:f.h.inputRevision});
      if(outcome==="still-unknown"){
        for(let i=0;i<2;i++)await assert.rejects(()=>f.h.confirm(action,f.state,m),e=>e.code==="TCG_CONFIRMATION_RETRY");
        assert.ok(f.h.confirmationSession,"the same owner survives both observation windows");
      }else{
        const after=await f.h.confirm(action,f.state,m);
        assert.equal(after.confirmed,outcome==="paid","clearing details is never effect proof");
        assert.equal(f.h.confirmationSession,null);
      }
      assert.deepEqual(f.inputs,[[1608,957],[1608,957],[1190,545]],"only one blank-area reset, no third skill click");
    }
    const f=fixture(),action={type:"skill",who:0,skill:"NA"};f.state.active=0;
    f.h.phaseIn=()=>({phase:"unknown",turn:"none"});
    await f.h.execute(action,f.state,f.T.freshMemory());
    f.h.phase=()=>({phase:"unknown",turn:"none",cardTarget:true});
    f.h.matchDeadline=100000+f.time()+1500;
    await assert.rejects(()=>f.h.confirm(action,f.state,f.T.freshMemory()),e=>e.code==="TCG_CONFIRMATION_RETRY");
    assert.deepEqual(f.inputs,[[1608,957],[1608,957]],"an identified target page is not a stale ordinary skill detail");
    // Native enemy/settlement exits can be followed by unknown animation frames.
    // The submitted owner survives a timeout without reopening its old detail.
    for(const [via,exit] of [
      ["phase",{phase:"board",turn:"enemy"}],
      ["observe",{phase:"board",turn:"enemy"}],
      ["observe",{phase:"settlement",turn:"none"}],
    ]){
      const g=fixture(),a={type:"skill",who:0,skill:"NA"},memory=g.T.freshMemory();g.state.active=0;
      await g.h.execute(a,g.state,memory);
      let reads=0;
      g.h.phase=()=>g.h.adoptPhase(reads++===0
        ?via==="phase"?clone(exit):{phase:"board",turn:"user"}
        :{phase:"unknown",turn:"none"});
      g.h.observe=async()=>clone(exit);
      g.h.matchDeadline=100000+g.time()+2400;
      await assert.rejects(()=>g.h.confirm(a,g.state,memory),e=>e.code==="TCG_CONFIRMATION_RETRY");
      const owner=g.h.confirmationSession;
      assert.ok(owner);assert.equal(owner.transition,exit.turn==="enemy","settlement is not combat handoff proof");
      g.h.matchDeadline+=1800;
      await assert.rejects(()=>g.h.confirm(a,g.state,memory),e=>e.code==="TCG_CONFIRMATION_RETRY");
      assert.equal(g.h.confirmationSession,owner);
      assert.deepEqual(g.inputs,[[1608,957],[1608,957]],via+"/"+exit.phase+": no animation reset or skill replay");
      g.h.phase=()=>({phase:"result",turn:"none",result:"win"});
      g.h.matchDeadline+=100;
      assert.equal((await g.h.confirm(a,g.state,memory)).result,"win");
    }
  });
  await test(id+": vanished warning and unchanged resources are not a successful cast or permission to repeat",async()=>{
    const f=fixture(),action={type:"skill",who:0,skill:"NA"},m=f.T.freshMemory();f.state.active=0;
    f.h.phaseIn=()=>({phase:"board",turn:"user"});
    f.h.observe=async()=>clone(f.state);f.h.observedResourceProof=async()=>({revision:f.h.inputRevision});
    await f.h.execute(action,f.state,m);
    const result=await f.h.confirm(action,f.state,m);
    assert.equal(result.confirmed,false);
    f.T.deferUncertain(m,action,f.state);
    const next=f.T.choose(f.state,m);
    assert.notEqual(f.T.actionKey(next),f.T.actionKey(action),"existing refusal memory excludes unresolved input");
    assert.deepEqual(f.inputs,[[1608,957],[1608,957]]);
  });
  await test(id+": actual skill verification handles payment, refunds and zero-cost energy changes",()=>{
    for(const deck of ["raiden","iansan","moonbloom","mozailu"]){
      const f=fixture(undefined,deck),b=f.state,a={type:"skill",who:0,skill:"NA"};b.active=0;
      const paid=clone(b);paid.dice={Omni:2};assert.equal(f.T.verify(a,b,paid),true,deck+"/payment");
      assert.equal(f.T.verify(a,b,clone(b)),false,deck+"/unchanged");
      const refunded=clone(b);refunded.characters[0].energy=1;
      assert.equal(f.T.verify(a,b,refunded),true,deck+"/no-net-dice-change");
    }
  });
  await test(id+": read-only numeric fee inspection never confirms a skill or reads its name",async()=>{
    for(const quote of ["2",""]){
      const f=fixture(undefined,"iansan"),m=f.T.freshMemory(),events=[];f.state.active=0;
      f.h.trace=(event,data)=>events.push({event,data});f.h.phaseIn=()=>({phase:"unknown",turn:"none"});
      f.h.ocr=()=>{throw Error("Fee probe must not read skill identity");};f.h.numericAt=()=>quote;
      const result=await f.h.execute({type:"probe",who:0,skill:"E"},f.state,m);
      assert.equal(result.probed,true);assert.equal(result.confirmed,false);
      assert.equal(f.T.skillQuote(f.state,m,{who:0,skill:"E"}).n,quote?2:null);
      assert.equal(f.inputs.filter(p=>p[0]===1716).length,1);
      assert.ok(!events.some(e=>e.event==="input-submitted"));
    }
  });
};
