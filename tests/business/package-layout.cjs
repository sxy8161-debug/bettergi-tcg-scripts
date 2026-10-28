"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),B=require("../../tools/build.cjs");
module.exports=async function(test){
 await test("suite entry selects one deck and reports effective settings before capture or input",async()=>{
  {
   const files=B.packageFiles().files,dir=path.join(B.base,"src/suite");
   const manifest=JSON.parse(files.get("manifest.json"));
   assert.equal(manifest.main,"main.js");assert.equal(manifest.settings_ui,"settings.json");
   assert.deepEqual([...files.keys()].filter(n=>n.endsWith(".js")),["main.js"]);
   const settings=JSON.parse(files.get("settings.json"));
   assert.deepEqual(settings.find(s=>s.name==="deck").options,Object.values(B.config.players).map(p=>p.title+"（"+p.label+"）"));
   assert.ok(!settings.some(s=>s.name==="mulligan"));
   for(const [index,[id,p]]of Object.entries(B.config.players).entries()){
    let core,player,coreLoads=0,runs=0;const logs=[],traces=[],minutes=[15,10,20,30,45,15][index],actionEntry=index%2?"确认新开局未行动":"禁止从行动页启动";
    const c=vm.createContext({settings:{...Object.fromEntries(settings.map(s=>[s.name,s.name==="deck"?p.title+"（"+p.label+"）":s.default])),maxMinutes:String(minutes),actionEntry},log:{info:s=>logs.push(s)},
      file:{createDirectory(){},isExists(){return false;},readTextSync:n=>files.get(n).toString()}});
    Object.defineProperty(c,"TCG",{get:()=>core,set:v=>{core=v;coreLoads++;}});
    Object.defineProperty(c,"TCGPlayer",{get:()=>player,set:v=>{
      player=v;v.Player.prototype.run=async function(){
        runs++;assert.equal(core.deckId,id);assert.equal(this.options.maxMinutes,minutes);assert.equal(player.playerOptions().maxMinutes,15);
        assert.equal(this.options.mulligan,core.openingSetting());
        assert.equal(this.options.mulligan,"优先装备与启动牌");
        const boundary=Error("capture boundary reached");
        this.host.trace=(event,data)=>traces.push({event,data});
        this.host.waitForCapture=async()=>{throw boundary;};
        await assert.rejects(this.enter(),error=>error===boundary);
        const start=traces.find(t=>t.event==="start").data;
        assert.equal(traces.filter(t=>t.event==="start").length,1);assert.equal(start.deckId,id);assert.equal(start.deckLabel,p.label);
        assert.equal(start.options.maxMinutes,minutes);assert.equal(start.options.actionEntry,actionEntry);
        assert.equal(logs.filter(s=>s.includes("[启动摘要]")).length,1);
        for(const value of [p.title,p.label,manifest.version,String(minutes)+"分钟",actionEntry,"自动换牌"])assert.ok(logs[0].includes(value),value);
        this.host.dispose();
      };
    }});
    await vm.runInContext(files.get("main.js").toString(),c);
    assert.equal(coreLoads,1);assert.equal(runs,1);
   }
  }
 });
};
