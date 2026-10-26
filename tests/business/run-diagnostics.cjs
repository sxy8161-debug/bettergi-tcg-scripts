"use strict";
const assert=require("node:assert/strict"),{load}=require("./runtime.cjs");
module.exports=async test=>{
  await test("Player.run preserves cancellation and disposes on result, ended entry and failure",async()=>{
    for(const ending of ["win","entry","cancel"]){
      const {Host,Player}=load("raiden"),h=new Host({}),p=new Player(h,{maxMinutes:15}),
        error=Error("A task was canceled.");let disposed=0,actions=0;
      h.dispose=()=>{disposed++;};
      p.enter=async()=>ending!=="entry";
      h.phase=()=>ending==="win"?{phase:"result",turn:"none",result:"win"}:{phase:"board",turn:"user"};
      p.act=async()=>{actions++;throw error;};
      if(ending==="cancel")await assert.rejects(()=>p.run(),e=>e===error);else await p.run();
      assert.equal(disposed,1);assert.equal(actions,ending==="cancel"?1:0);
    }
  });
};
