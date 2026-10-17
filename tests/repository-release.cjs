"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),B=require("../tools/build.cjs"),S=require("../tools/public-assets.cjs"),R=require("../tools/build-release.cjs");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS "+name);}
function references(bank){
 const rows=[];for(const [part,layout]of [[bank,"main"],[bank.expanded,"expanded"]])if(part)for(const e of part.entries){
  if(e.patches)rows.push(...e.patches.map((p,i)=>[layout,e.id,"legacy",i,p]));
  for(const [v,view]of (e.views||[]).entries())rows.push(...view.patches.map((p,i)=>[layout,e.id,v,i,p]));
 }return rows;
}
test("semantic names preserve original pixels, compatibility aliases and every non-path bank field",()=>{
 for(const id of Object.keys(B.config.players)){
  const raw=B.packageFiles(id).files,{files,names}=S.semanticAssets(raw);assert.equal(raw.size,files.size);
  for(const [rel,bytes]of raw)if(!names.has(rel)&&!rel.endsWith("-bank.json"))assert.ok(bytes.equals(files.get(rel)),rel);
  for(const [old,rel]of names){assert.ok(raw.get(old).equals(files.get(rel)));assert.match(rel,/^assets\/(hand|opening|expanded)\/[\p{L}\p{N}_-]+-v\d+-p\d+\.png$/u);}
  for(const key of ["hand-bank.json","opening-bank.json"]){
   const before=JSON.parse(raw.get(key)),after=JSON.parse(files.get(key)),oldRefs=references(before),newRefs=references(after);
   assert.equal(oldRefs.length,newRefs.length);for(let i=0;i<oldRefs.length;i++){assert.deepEqual(oldRefs[i].slice(0,4),newRefs[i].slice(0,4));assert.equal(names.get(oldRefs[i][4]),newRefs[i][4]);}
   const restore=value=>typeof value==="string"?[...names].find(([,n])=>n===value)?.[0]||value:Array.isArray(value)?value.map(restore):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,restore(v)])):value;
   assert.deepEqual(restore(after),before);
  }
 }
});
test("semantic layout is idempotent and keeps all script bytes unchanged",()=>{
 for(const id of Object.keys(B.config.players)){
  const raw=B.packageFiles(id).files,a=B.packageFiles(id,{semanticAssets:true}).files,b=S.semanticAssets(a).files;
  assert.deepEqual(B.packageHashes({x:{files:a}}),B.packageHashes({x:{files:b}}));
  for(const [rel,bytes]of raw)if(rel.endsWith(".js"))assert.ok(a.get(rel).equals(bytes));
 }
});
test("unsafe names, missing images, Windows case collisions and unreferenced images fail closed",()=>{
 for(const name of ["",":/","CON","nul"])assert.throws(()=>S.cardStem(name));
 const base={scoreFloor:.95,runnerUpGap:.2,patches:[[0]],entries:[{id:"one",name:"Card",patches:["assets/hand/a.png"]},{id:"two",name:"card",patches:["assets/hand/b.png"]}]};
 const files=new Map([["hand-bank.json",Buffer.from(JSON.stringify(base))],["assets/hand/a.png",Buffer.from("a")],["assets/hand/b.png",Buffer.from("b")]]);
 assert.throws(()=>S.semanticAssets(files),/collision/);files.delete("assets/hand/b.png");assert.throws(()=>S.semanticAssets(files),/Unbound/);
 const one={patches:[[0]],entries:[base.entries[0]]},extra=new Map([["hand-bank.json",Buffer.from(JSON.stringify(one))],["assets/hand/a.png",Buffer.from("a")],["assets/hand/unused.png",Buffer.from("extra")]]);
 assert.throws(()=>S.semanticAssets(extra),/Unreferenced/);
});
test("release tree uses compatible JS leaf nodes, complete standalone packages and matching gzip",()=>{
 const {files,index,manifest}=R.releaseFiles({sourceCommit:"a".repeat(40),sourceDate:"2026-10-17T00:00:00Z"});
 assert.equal(index.indexes.length,1);assert.equal(index.indexes[0].name,"js");assert.equal(index.indexes[0].children.length,3);
 for(const [id,folder]of Object.entries(require("../distribution/repository.json").players)){const n=index.indexes[0].children.find(n=>n.name===folder);assert.equal(n.children,undefined);assert.ok(n.description.includes("~|~"));assert.ok(files.has("repo/js/"+n.name+"/manifest.json"));assert.equal(n.version,B.config.players[id].version);assert.equal(manifest.playerVersions[id],n.version);}
 assert.equal(manifest.sharedVersion,B.config.sharedRevision);
 assert.equal(index.time,"20261017080000");assert.ok(index.url.endsWith("/refs/heads/release.zip"));
 assert.equal(Object.keys(manifest.files).length+1,files.size);for(const [n,sha]of Object.entries(manifest.files))assert.equal(B.sha(files.get(n)),sha);
 assert.ok(require("node:zlib").gunzipSync(files.get("repo.json.gz")).equals(files.get("repo.json")));
 assert.equal([...files.keys()].filter(n=>n.startsWith("repo/")).length,756);
});
test("release inputs and relative paths reject traversal, drive paths and missing commit identity",()=>{
 for(const rel of ["../bad","/bad","a/../bad","C:/bad","a\\b",".git/config",".Git/config","a//b","a\nb"])assert.equal(R.safeRel(rel),false,rel);
 assert.throws(()=>R.releaseFiles({sourceCommit:"main",sourceDate:"today"}));assert.throws(()=>R.chinaTime("invalid"));
});
test("release output is reproducible for one exact source commit and date",()=>{
 const arg={sourceCommit:"b".repeat(40),sourceDate:"2026-10-17T01:02:03Z"},a=R.releaseFiles(arg).files,b=R.releaseFiles(arg).files;
 assert.deepEqual(B.packageHashes({x:{files:a}}),B.packageHashes({x:{files:b}}));
});
console.log(JSON.stringify({passed,failed:0,scope:"publication-paths-and-repository-format-not-native-gameplay"}));
