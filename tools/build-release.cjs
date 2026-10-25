"use strict";
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),cp=require("node:child_process");
const B=require("./build.cjs"),repo=require("../distribution/repository.json");
const json=value=>Buffer.from(JSON.stringify(value,null,2)+"\n");
function safeRel(rel){return typeof rel==="string"&&rel.length>0&&!path.isAbsolute(rel)&&!/[\\:\u0000-\u001f\u007f]/.test(rel)&&rel.split("/").every(p=>p&&p!=="."&&p!==".."&&!p.toLowerCase().startsWith(".git"));}
function listFiles(root,prefix=""){
 if(!fs.existsSync(root))return [];
 return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(e=>{
  const rel=prefix+e.name;if(e.isSymbolicLink())throw Error("Symlink in publication: "+rel);
  return e.isDirectory()?listFiles(root,rel+"/"):[rel];
 }).sort();
}
function chinaTime(date){
 const d=new Date(new Date(date).getTime()+8*3600000);if(!Number.isFinite(+d))throw Error("Invalid source date");
 const human=d.toISOString().slice(0,19).replace("T"," ");return {human,compact:human.replace(/[- :]/g,"")};
}
function releaseFiles({sourceCommit,sourceDate}){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error("Source commit must be a full Git SHA");
 const stamp=chinaTime(sourceDate),files=new Map(),players={},children=[];
 for(const [id,folder]of Object.entries(B.scriptFolders)){
  if(!/^[A-Za-z][A-Za-z0-9]+$/.test(folder))throw Error("Invalid script directory");
  const pack=B.packageFiles(id,{semanticAssets:true}),m=JSON.parse(pack.files.get("manifest.json"));
  if(!m.main||!pack.files.has(m.main)||m.version!==B.config.sharedRevision)throw Error("Invalid manifest: "+id);
  for(const [rel,bytes]of pack.files){if(!safeRel(rel))throw Error("Invalid runtime path");files.set(`repo/js/${folder}/${rel}`,bytes);}
  players[id]=m.version;
  children.push({name:folder,type:"directory",version:m.version,author:m.authors?.[0]?.name||"",authors:m.authors,
   description:m.name+"~|~"+m.description,tags:["七圣召唤","PVE",m.version],lastUpdated:stamp.human});
 }
 const index={time:stamp.compact,url:`https://github.com/${repo.releaseRepository}/archive/refs/heads/${repo.releaseBranch}.zip`,file:"repo.json",indexes:[{name:"js",type:"directory",children}]};
 files.set("repo.json",json(index));files.set("repo.json.gz",zlib.gzipSync(files.get("repo.json"),{mtime:0}));
 files.set("README.md",fs.readFileSync(path.join(B.base,"distribution/README.md")));
 files.set("LICENSE-GPL-3.0.txt",fs.readFileSync(path.join(B.base,"src/decks/raiden/public/LICENSE-GPL-3.0.txt")));
 const manifest={schemaVersion:1,sourceRepository:repo.sourceRepository,sourceCommit,sourceDate,sharedVersion:B.config.sharedRevision,
  playerVersions:players,files:Object.fromEntries([...files].map(([name,bytes])=>[name,B.sha(bytes)]))};
 files.set("release-manifest.json",json(manifest));return {files,manifest,index};
}
function verifyRelease(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,"release-manifest.json")));
 const expected=Object.keys(manifest.files).concat("release-manifest.json").sort(),actual=listFiles(root);
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error("Release tree differs from manifest");
 for(const [rel,hash]of Object.entries(manifest.files)){
  if(!safeRel(rel)||!/^[a-f0-9]{64}$/.test(hash)||B.sha(fs.readFileSync(path.join(root,rel)))!==hash)throw Error("Release hash mismatch: "+rel);
 }
 const index=JSON.parse(fs.readFileSync(path.join(root,"repo.json")));
 if(!zlib.gunzipSync(fs.readFileSync(path.join(root,"repo.json.gz"))).equals(fs.readFileSync(path.join(root,"repo.json"))))throw Error("Compressed index mismatch");
 const nodes=index.indexes.find(n=>n.name==="js")?.children;
 if(!nodes||nodes.length!==Object.keys(B.scriptFolders).length)throw Error("Missing JS index");
 for(const folder of Object.values(B.scriptFolders)){
  const node=nodes.find(n=>n.name===folder),dir=path.join(root,"repo/js",folder),m=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json")));
  if(!node||node.children?.length||node.version!==m.version||!safeRel(m.main)||!fs.existsSync(path.join(dir,m.main)))throw Error("JS leaf/entry mismatch");
  require("./card-atlas.cjs").validateAtlas(new Map(listFiles(dir).map(rel=>[rel,fs.readFileSync(path.join(dir,rel))])));
 }
 return manifest;
}
function main(){
 const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
 const allowed=new Set(["--output","--source-sha","--source-date","--verify"]);
 for(let i=0;i<args.length;i+=2)if(!allowed.has(args[i])||!args[i+1])throw Error("Usage: --output dir [--source-sha sha --source-date ISO] | --verify dir");
 if(get("--verify")){console.log(JSON.stringify({verified:true,...verifyRelease(path.resolve(get("--verify")))}));return;}
 const target=path.resolve(get("--output")||"dist");
 if(target===B.base||target===path.parse(target).root)throw Error("Unsafe output directory");
 const git=arg=>cp.execFileSync("git",arg,{cwd:B.base,encoding:"utf8"}).trim();
 const sourceCommit=get("--source-sha")||git(["rev-parse","HEAD"]),sourceDate=get("--source-date")||git(["show","-s","--format=%cI","HEAD"]);
 const {files,manifest}=releaseFiles({sourceCommit,sourceDate});
 for(const rel of listFiles(target))if(!files.has(rel))throw Error("Stale/foreign output; use a fresh directory: "+rel);
 B.writeFiles(target,files);verifyRelease(target);
 console.log(JSON.stringify({built:true,output:target,sourceCommit,playerVersions:manifest.playerVersions,runtimeFiles:[...files.keys()].filter(n=>n.startsWith("repo/")).length}));
}
if(require.main===module)main();
module.exports={releaseFiles,verifyRelease,safeRel,listFiles,chinaTime};
