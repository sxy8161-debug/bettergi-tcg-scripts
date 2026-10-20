"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs");
const clone=value=>JSON.parse(JSON.stringify(value));
module.exports=async function(test){
  const id="input";
  function fixture(interrupt){
    let time=0,scene={phase:"board",turn:"user"},previews=0;
    class Clock extends Date{static now(){return 100000+time;}}
    let point=null;
    const inputs=[],inputTimes=[],{env:c}=load("raiden",{Date:Clock,sleep:async ms=>{time+=ms;},
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
    h.warnings=()=>({lack:false,text:""});
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
  await test(id+": restored skill OCR requires the selected name and type before one confirmation",async()=>{
    for(const scenario of ["valid","alias","empty","wrong-name","fuzzy-wrong-name","wrong-type","late-choice"]){
      const f=fixture(),events=[];
      f.h.trace=(event,data)=>events.push({event,data});
      f.h.phaseIn=()=>scenario==="late-choice"?{phase:"choice",turn:"none"}:{phase:"unknown",turn:"none"};
      f.h.ocr=(_,{rect:roi})=>{
        if(scenario==="empty")return "";
        if(roi[0]===135)return scenario==="wrong-name"?f.T.team[0].skills.E:
          scenario==="fuzzy-wrong-name"?"神变恶耀开眼":
          scenario==="alias"?"拂花偶叶":f.T.team[1].skills.E;
        if(roi[0]===70)return scenario==="wrong-type"?"普通攻击":"元素战技";
        throw Error("Unexpected restored skill OCR region");
      };
      f.h.executeInput=(a,b,m)=>f.h.inputSkill(a,b,m,3);
      const action={type:"skill",who:1,skill:"E"};
      if(["valid","alias"].includes(scenario)){
        await f.h.execute(action,f.state,f.T.freshMemory());
        assert.equal(f.inputs.length,2);
        assert.equal(events.filter(e=>e.event==="skill-preview"&&e.data.matched).length,2);
        assert.equal(events.filter(e=>e.event==="input-submitted").length,1);
      }else{
        await assert.rejects(()=>f.h.execute(action,f.state,f.T.freshMemory()),
          /未核实目标技能/);
        assert.equal(f.inputs.length,1);assert.ok(!events.some(e=>e.event==="input-submitted"));
      }
    }
  });
  await test(id+": reported Raiden title with trailing UI glyph reaches one skill confirmation",async()=>{
    // Reporter run-slot-07, 2026-10-20T15:31:22.202Z..24.408Z, SHA256
    // 533680b8de3e940133c6bc76d6bf2d67a28986198fe31771a6b5b42b7963dd72:
    // all ten native title reads were 源流\nA; the type was 普通攻击.
    // This replays recorded OCR results, not pixels or a native game run.
    const f=fixture(),events=[];let samples=0;
    f.state.active=0;
    f.h.trace=(event,data)=>events.push({event,data});
    f.h.ocr=(_,{rect:roi})=>roi[0]===135?"源流\nA":"普通攻击\n造成2点物理伤害。";
    f.h.phaseIn=()=>samples++===0?{phase:"board",turn:"user"}:{phase:"unknown",turn:"none"};
    await f.h.inputSkill({type:"skill",who:0,skill:"NA"},f.state,f.T.freshMemory(),3);
    assert.deepEqual(f.inputs,[[1608,957],[1608,957]]);
    assert.equal(events.filter(e=>e.event==="skill-confirm-clicked").length,1);
    assert.equal(events.filter(e=>e.event==="skill-preview"&&e.data.matched).length,2);
    assert.equal(events.find(e=>e.event==="skill-preview").data.name,"源流\nA");
  });
  await test(id+": fuzzy skill titles retain bounded evidence, types and unique identity",()=>{
    const f=fixture();let name="源流",detail="普通攻击";
    f.h.ocr=(_,{rect:roi})=>roi[0]===135?name:detail;
    for(const value of ["源流","源流\nA","A\n源流","源流A","原流","源留"]){
      name=value;assert.deepEqual(clone(f.h.skillPreviewIn({}).identity),{who:0,skill:"NA"});
    }
    for(const value of ["源","攻击","源流\n3","源流AB","源A流","说明源流","源流\n普通攻击","源流\n祈颂射艺",""]){
      name=value;assert.equal(f.h.skillPreviewIn({}).identity,null,value);
    }
    name="源流\nA";
    for(const value of ["","元素战技"]){detail=value;assert.equal(f.h.skillPreviewIn({}).identity,null);}
    detail="普通攻击";f.T.team[1].skills.NA="源留";name="源刘";
    assert.equal(f.h.skillPreviewIn({}).identity,null,"equally close registered names");
    f.T.team[1].skills.NA="源流";name="源流";
    assert.equal(f.h.skillPreviewIn({}).identity,null,"ambiguous registered name");
  });
  await test(id+": all adapters share fuzzy titles without dropping dedicated skill aliases",()=>{
    for(const [deck,who,skill,name,detail] of [
      ["raiden",1,"E","拂花偶叶\nA","元素战技"],
      ["iansan",1,"Q","璨焰金貌舞\nA","元素爆发"],
      ["moonbloom",2,"NA","游吐信\nA","普通攻击"],
      ["mozailu",0,"E","水中幻愿\nA","元素战技"],
      ["raiden",0,"E","神变恶耀开限","元素战技"],
      ["mozailu",0,"E","水中幻原","元素战技"]]){
      const {env:c}=load(deck),h=new c.TCGBetterGI.BetterGIHost(c.TCGPlayer.playerOptions({}));
      h.ocr=(_,{rect:roi})=>roi[0]===135?name:detail;
      h.numericAt=()=>name;
      assert.deepEqual(clone(h.skillPreviewIn({}).identity),{who,skill},deck);
    }
  });
  await test(id+": missed skill opening can reopen once only after unchanged boards and empty panel",async()=>{
    for(const changed of [false,true]){
      const f=fixture(),events=[];let boards=0;
      f.h.trace=(event,data)=>events.push({event,data});
      f.h.phaseIn=()=>f.inputs.length<2?{phase:"board",turn:"user"}:{phase:"unknown",turn:"none"};
      f.h.ocr=(_,{rect:roi})=>f.inputs.length<2?"":roi[0]===135?f.T.team[1].skills.E:
        roi[0]===70?"元素战技":"";
      f.h.board=()=>{boards++;const b=clone(f.state);if(changed)b.characters[1].hp--;return b;};
      const action={type:"skill",who:1,skill:"E"};
      if(changed){
        await assert.rejects(()=>f.h.inputSkill(action,f.state,f.T.freshMemory(),3),e=>e.code==="TCG_STATE_REFRESH");
        assert.equal(f.inputs.length,1);
      }else{
        await f.h.inputSkill(action,f.state,f.T.freshMemory(),3);
        assert.equal(boards,2);assert.equal(f.inputs.length,3);
        assert.equal(events.filter(e=>e.event==="skill-preview-reopen").length,1);
        assert.equal(events.filter(e=>e.event==="skill-confirm-clicked").length,1);
      }
    }
  });
};
