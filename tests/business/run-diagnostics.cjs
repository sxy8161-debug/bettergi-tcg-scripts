"use strict";
const assert=require("node:assert/strict"),{load,board}=require("./runtime.cjs");
function fixture(){
  let time=100000;const files=new Map(),messages=[];
  class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const {T,Host,Player}=load("raiden",{Date:Clock,sleep:async ms=>{time+=ms;},
    file:{createDirectory(){},isExists:p=>files.has(p),readTextSync:p=>files.get(p),
      writeTextSync(p,text,append){files.set(p,append?(files.get(p)||"")+text:text);return true;}},
    log:{info:s=>messages.push(s),warn:s=>messages.push(s),error:s=>messages.push(s)}});
  const h=new Host({}),p=new Player(h,{maxMinutes:15}),b=board(T);
  h.trace("start",{version:T.version,sharedVersion:T.sharedVersion});
  p.openingFlow={complete:true};h.dispose=()=>{};
  const rows=()=>files.get(h.path).trim().split("\n").map(JSON.parse);
  return {T,h,p,b,messages,advance:ms=>{time+=ms;},rows,
    summary:()=>rows().at(-1).data.summary};
}
module.exports=async test=>{
  await test("diagnostics: observation retries retain failed time and the actual missing fields",async()=>{
    const f=fixture(),missing=["own[0].energy","own[1].energy","own[2].energy"];
    f.h.observe=async()=>{f.advance(250);const e=Error("energy unknown");e.code="TCG_BOARD_RETRY";e.missing=missing;throw e;};
    assert.equal(await f.p.observe(),null);assert.equal(await f.p.observe(),null);
    f.h.reportStop("test timeout");
    const timings=f.rows().filter(r=>r.event==="observation-timing");
    assert.equal(timings.length,2);assert.equal(timings[0].data.outcome,"deferred");
    assert.equal(timings.reduce((n,r)=>n+r.data.ms,0),1300);
    const s=f.summary();assert.equal(s.outcome,"stopped");assert.equal(s.stage,"observation");
    assert.equal(s.timing.observationMs,1300);assert.deepEqual(s.missing[0].fields,missing);
    assert.equal(s.counts.submitted,0);assert.equal(s.lastAction,null);
  });
  await test("diagnostics: recovered input and read-only probes keep timing without inventing submissions",async()=>{
    for(const probe of [false,true]){
      const f=fixture(),action=probe?{type:"probe",who:0,skill:"E"}:{type:"skill",who:0,skill:"E"};
      f.p.observe=async()=>f.b;f.T.choose=()=>{f.advance(7);return action;};
      f.p.execute=async()=>{f.advance(90);return probe?{sent:true,result:{...f.b,probed:true}}:{sent:false};};
      await f.p.act();f.h.reportStop("fixture done");
      const a=f.rows().find(r=>r.event==="action-timing").data,s=f.summary();
      assert.equal(a.planningMs,7);assert.equal(a.inputMs,90);assert.equal(a.totalMs,97);
      assert.equal(a.outcome,probe?"probed":"not-submitted");
      assert.equal(s.counts.submitted,0);assert.equal(s.lastAction.status,probe?"probed":"not-submitted");
    }
  });
  await test("diagnostics: planning/input/confirmation failures retain original errors and all elapsed work",async()=>{
    for(const failAt of ["planning","input","confirmation"]){
      const f=fixture(),error=Error("original "+failAt),action={type:"skill",who:0,skill:"E"};
      f.p.observe=async()=>f.b;f.T.choose=()=>{f.advance(10);if(failAt==="planning")throw error;return action;};
      f.p.execute=async()=>{f.advance(20);if(failAt==="input")throw error;f.h.trace("input-submitted",{action});return {sent:true};};
      f.p.awaitConfirmation=async()=>{f.advance(700);throw error;};
      await assert.rejects(()=>f.p.act(),e=>e===error);f.h.reportStop(error.message);
      const a=f.rows().find(r=>r.event==="action-timing").data,s=f.summary();
      assert.equal(a.outcome,"failed");assert.equal(a.totalMs,failAt==="planning"?10:failAt==="input"?30:730);
      assert.equal(a.totalMs,a.planningMs+a.inputMs+a.settlementMs+a.postActionMs);
      assert.equal(s.stage,failAt);assert.equal(s.counts.confirmed,0);
      if(failAt==="confirmation")assert.equal(s.lastAction.status,"pending");
    }
  });
  await test("diagnostics: resolved gaps do not become a stale stop cause; loss remains normal completion",()=>{
    const f=fixture(),action={type:"skill",who:0,skill:"E"};
    f.h.trace("board-settle-wait",{missing:["own[0].energy"]});f.advance(600);
    f.h.trace("board-settle-wait",{valid:true,missing:[]});
    f.h.trace("state",{state:f.b});f.h.trace("decision",action);
    f.h.trace("input-submitted",{action});f.h.trace("confirmed",{action,after:f.b});
    f.h.trace("result",{phase:"result",result:"lose"});
    const s=f.summary();assert.equal(s.outcome,"completed");assert.equal(s.result,"lose");
    assert.deepEqual(s.missing,[]);assert.equal(s.lastMissing.resolved,true);
    assert.equal(s.lastAction.status,"confirmed");assert.equal(s.counts.submitted,1);assert.equal(s.counts.confirmed,1);
    assert.equal(f.rows().at(-1).event,"result");assert.ok(f.messages.some(x=>x.includes("对局摘要")&&x.includes("失败")));
    assert.equal(f.h.metrics.frames,0,"summary must not capture or recognize another frame");
  });
  await test("diagnostics: board recovery and failed hand finally cannot clear an unresolved hand read",()=>{
    const f=fixture();
    f.h.trace("board-settle-wait",{missing:["own[0].energy"]});
    f.h.trace("hand-read-deferred",{error:"unknown card"});f.advance(600);
    f.h.trace("board-settle-wait",{valid:true,missing:[]});
    f.h.trace("hand-read-completed",{count:null});f.advance(400);
    f.h.reportStop("fixture done");
    const s=f.summary();assert.deepEqual(s.missing.map(g=>g.fields),[["hand"]]);
    assert.equal(s.missing[0].spanMs,1000);assert.equal(s.missing[0].lastSeenAgoMs,1000);
    const next=fixture();next.h.trace("hand-read-deferred",{});
    next.h.trace("hand-read-completed",{count:0});next.h.reportStop("fixture done");
    assert.deepEqual(next.summary().missing,[]);
  });
  await test("diagnostics: a timing write failure never replaces the original observation or action error",async()=>{
    for(const observe of [false,true]){
      const f=fixture(),original=Error("original cancellation"),writeError=Error("diagnostic write failed");
      const trace=f.h.trace.bind(f.h);
      f.h.trace=(event,data)=>{if(event.endsWith("-timing"))throw writeError;return trace(event,data);};
      if(observe){f.h.observe=async()=>{throw original;};await assert.rejects(()=>f.p.observe(),e=>e===original);}
      else {f.p.observe=async()=>f.b;f.T.choose=()=>{throw original;};await assert.rejects(()=>f.p.act(),e=>e===original);}
    }
    const f=fixture(),writeError=Error("diagnostic write failed");
    f.h.observe=async()=>f.b;f.h.trace=event=>{if(event==="observation-timing")throw writeError;};
    await assert.rejects(()=>f.p.observe(),e=>e===writeError,"without a primary error, logging failures stay explicit");
  });
  await test("diagnostics: run exits keep terminal events, entry-only status and cancellation error identity",async()=>{
    for(const ending of ["win","entry","cancel"]){
      const f=fixture(),error=Error("A task was canceled.");let disposed=0;
      f.h.dispose=()=>{disposed++;};
      f.p.enter=async()=>{if(ending==="entry"){f.h.trace("terminal-entry",{phase:"result",result:"win"});return false;}return true;};
      f.h.phase=()=>ending==="win"?{phase:"result",result:"win"}:{phase:"board",turn:"user"};
      f.p.act=async()=>{f.h.runStage="confirmation";throw error;};
      if(ending==="cancel")await assert.rejects(()=>f.p.run(),e=>e===error);else await f.p.run();
      const s=f.summary();assert.equal(s.outcome,ending==="entry"?"already-ended":ending==="cancel"?"stopped":"completed");
      assert.equal(disposed,1);assert.equal(f.messages.filter(x=>x.includes("对局摘要")).length,1);
    }
  });
};
