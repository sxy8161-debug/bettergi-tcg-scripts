"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),B=require("../../tools/build.cjs");
module.exports=async function(test){
 await test("standalone manifest loads the packaged entry and actual settings",()=>{
  for(const id of Object.keys(B.config.players)){
   const files=B.packageFiles(id).files,dir=path.join(B.base,"src/decks",id,"public");
   assert.ok(files.get("settings.json").equals(fs.readFileSync(path.join(dir,"settings.json"))));
   const manifest=JSON.parse(files.get("manifest.json"));
   assert.equal(manifest.main,"main.js");assert.equal(manifest.settings_ui,"settings.json");
   assert.deepEqual([...files.keys()].filter(n=>n.endsWith(".js")),["main.js"]);
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
    const bank=JSON.parse(bad.get(name));for(const r of Object.values(bank.atlas))if(r.sourceSha256===B.sha(png))r.sourceSha256="0".repeat(64);
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
