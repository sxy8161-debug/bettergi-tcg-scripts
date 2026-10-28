"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs");
const clone=value=>JSON.parse(JSON.stringify(value));
module.exports=async function(test){
  const id="input";
  await test(id+": end round confirms after the popup animation and before its expiry",async()=>{
    for(const mode of ["popup","already-open","delayed-handoff","pick-during-popup","cancel"]){
      let now=0,phaseReads=0,phase={phase:"board",turn:"user"};const clicks=[];
      const {Host,T}=load("moonbloom",{sleep:async ms=>{
        if(mode==="cancel")throw Error("cancelled");now+=ms;
        if(mode==="pick-during-popup")phase={phase:"pick",turn:"none"};
      }}),h=new Host({});
      h.matches=()=>[{x:51,y:510,w:60,h:60}];h.trace=()=>{};
      h.clickAt=(x,y)=>{
        clicks.push({at:now,x,y});
        if(mode==="already-open"||mode==="popup"&&clicks.length===2&&now>=1000&&now<5000)
          phase={phase:"roll",turn:"none"};
        return [x,y];
      };
      h.phase=read=>{
        if(mode==="delayed-handoff"&&phaseReads>=2)phase={phase:"roll",turn:"none"};
        phaseReads++;if(read)read({},phase);return phase;
      };
      if(mode==="cancel"){
        await assert.rejects(()=>h.inputEnd(),/cancelled/);assert.equal(clicks.length,1);continue;
      }
      await h.inputEnd();
      assert.equal(clicks.length,["already-open","pick-during-popup"].includes(mode)?1:2);
      if(mode==="pick-during-popup")continue;
      const after=await h.confirmPending({type:"end"},require("./runtime.cjs").board(T));
      assert.equal(after.confirmed,true);assert.equal(after.phase,"roll");
    }
    for(const phase of [{phase:"board",turn:"user"},{phase:"pick",turn:"none"}]){
      const {Host}=load("consecrated"),h=new Host({});
      h.phase=read=>{read({},phase);return phase;};h.matches=()=>[];
      h.clickAt=()=>{throw Error("No end input without its native entry");};
      await assert.rejects(()=>h.inputEnd(),e=>e.code===(phase.phase==="pick"
        ?"TCG_OBSERVATION_INTERRUPTED":"TCG_STATE_REFRESH")&&e.phase===phase);
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
    h.trace=()=>{};
    const click=h.clickAt.bind(h);h.clickAt=(x,y)=>{const p=click(x,y);
      if(x===1175&&interrupt==="selection")scene={phase:"choice",turn:"none"};
      if(x===1820)scene={phase:"unknown",turn:"none"};return p;};
    return {T,h,state,inputs,inputTimes,time:()=>time};
  }
  await test(id+": late choice interrupts the selected role or payment before confirmation",async()=>{
    for(const point of ["selection","preview"]){
      const f=fixture(point);
      await assert.rejects(()=>f.h.execute({type:"switch",target:2},f.state,f.T.freshMemory()),
        e=>e.code==="TCG_OBSERVATION_INTERRUPTED"&&e.phase.phase==="choice");
      assert.deepEqual(f.inputs,point==="selection"?[[1175,720]]:[[1175,720],[1820,958]]);
    }
  });
  await test(id+": fixed-slot switch needs no character title and confirms payment once",async()=>{
    const f=fixture(),ocr=f.h.ocr;
    f.h.titleAt=()=>{throw Error("Fixed-slot switching must not inspect a character title");};
    f.h.ocr=(frame,area)=>{if(area.rect[0]===311)throw Error("Switching must not OCR the character title region");return ocr(frame,area);};
    await f.h.execute({type:"switch",target:2},f.state,f.T.freshMemory());
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
};
