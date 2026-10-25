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
  await test("the30-minute setting reaches each standalone player's actual deadline without changing defaults",()=>{
    const B=require("../../tools/build.cjs"),time=100000;
    class Clock extends Date{static now(){return time;}}
    for(const id of Object.keys(B.config.players)){
      const {env,Host,Player}=load(id,{Date:Clock}),settings=JSON.parse(B.packageFiles(id).files.get("settings.json")),
        field=settings.find(x=>x.name==="maxMinutes"),read=env.TCGPlayer.playerOptions;
      assert.ok(field.options.includes("30"),id+" exposes30min");
      const options=read({maxMinutes:"30"});assert.equal(options.maxMinutes,30);
      const host=new Host(options),player=new Player(host,options);
      assert.equal(player.deadline,time+1800000);assert.equal(host.matchDeadline,player.deadline);
      const expected=id==="moonbloom"?45:15;
      assert.equal(read({}).maxMinutes,expected);assert.equal(Number(field.default),expected);
    }
  });
  await test("diagnostics: write failures propagate without replacing the original observation, action or hand error",async()=>{
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
    for(const method of ["readHand","folded"])for(const failedRead of [true,false]){
      const f=fixture(),original=Error("A task was canceled."),writeError=Error("diagnostic write failed");
      const event=method==="readHand"?"hand-read-completed":"folded-hand";
      f.h.trace=name=>{if(name===event)throw writeError;};
      f.h.phase=f.h.phaseIn=()=>({phase:"board",turn:"user"});
      if(method==="readHand"){
        f.h.handFanReady=true;f.h.fillHandArtwork=async()=>{};
        f.h.titleAt=async()=>{if(failedRead)throw original;return f.T.byId.draw.name;};
        f.h.reset=async()=>{f.h.handFanReady=false;};
      }else{
        f.h.frame=fn=>{if(failedRead)throw original;return fn({});};
        f.h.collapsedIn=()=>({status:"readable",count:1,slots:[{id:"draw",index:0}]});
        f.h.nativeHandCountIn=()=>1;
      }
      await assert.rejects(()=>method==="readHand"
        ?f.h.readHand(1,{count:1},{titles:0,cards:[null]}):f.h.folded("board"),
        e=>e===(failedRead?original:writeError),method+": original error first, otherwise diagnostic error");
    }
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
