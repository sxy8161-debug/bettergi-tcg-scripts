"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs");
const clone=value=>JSON.parse(JSON.stringify(value));
module.exports=async function(test){
  const id="input";
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
