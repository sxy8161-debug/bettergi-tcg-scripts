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
 await test("package migration preserves retired content, refuses drift and keeps unknown files",()=>{
  const temp=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"tcg-package-retirement-")),target=path.join(temp,"target"),backup=path.join(temp,"backup");
  try{
   const files=new Map(B.packageFiles("raiden").files),raw=B.recognitionFiles("raiden"),opening=JSON.parse(raw.get("opening-bank.json"));
   const logical=opening.entries[0].patches?.[0]||opening.entries[0].views[0].patches[0],png=raw.get(logical),image=require("pngjs").PNG.sync.read(png);
   const code=Buffer.from("globalThis.legacyModule = true;\n"),notice=Buffer.from("Original author and source\n"),license=Buffer.from("Complete license text\n");
   const old=new Map([["lib/core.js",code],["ATTRIBUTION.md",notice],["LICENSE-GPL-3.0.txt",license],
    ["assets/card-atlas/opening.png",png],["hand-bank.json",Buffer.from('{"atlas":{}}')],
    ["opening-bank.json",Buffer.from(JSON.stringify({atlas:{[logical]:{file:"assets/card-atlas/opening.png",rect:[0,0,image.width,image.height],sourceSha256:B.sha(png)}}}))]]);
   const baseline=Object.fromEntries([...old].map(([n,b])=>[n,B.sha(b)]));
   B.writeFiles(target,old);B.writeFiles(target,new Map([["personal.txt",Buffer.from("keep")]]));
   files.set("main.js",code);files.set("README.md",Buffer.concat([notice,license]));
   const retired=B.assertTargetClean("test",target,files,baseline,null,"drift");
   assert.deepEqual([...retired.keys()].sort(),["ATTRIBUTION.md","LICENSE-GPL-3.0.txt","assets/card-atlas/opening.png","lib/core.js"].sort());
   for(const [name,changed]of [["main.js",Buffer.from("different code")],["README.md",Buffer.from("missing author and license")]]){
    const bad=new Map(files);bad.set(name,changed);assert.throws(()=>B.assertTargetClean("test",target,bad,baseline,null,"drift"),/drift/);
   }
   const bad=new Map(files);
   for(const name of ["hand-bank.json","opening-bank.json"]){
    const bank=JSON.parse(bad.get(name));for(const section of Object.values(bank.decks))for(const r of Object.values(section.atlas))if(r.sourceSha256===B.sha(png))r.sourceSha256="0".repeat(64);
    bad.set(name,Buffer.from(JSON.stringify(bank)));
   }
   assert.throws(()=>B.assertTargetClean("test",target,bad,baseline,null,"drift"),/opening.png/);
   B.writeFiles(target,new Map([["lib/core.js",Buffer.from("user edit")]]));
   assert.throws(()=>B.retireFiles(target,retired,backup),/changed/);
   assert.ok(fs.existsSync(path.join(target,"ATTRIBUTION.md")),"validate all retirements before moving any");
   B.writeFiles(target,new Map([["lib/core.js",code]]));B.retireFiles(target,retired,backup);
   for(const [name]of retired){assert.equal(fs.existsSync(path.join(target,name)),false);assert.ok(fs.readFileSync(path.join(backup,name)).equals(old.get(name)));}
   assert.equal(fs.existsSync(path.join(target,"lib")),false);assert.equal(fs.readFileSync(path.join(target,"personal.txt"),"utf8"),"keep");
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 });
};
