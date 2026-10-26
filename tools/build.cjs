"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const base=path.resolve(__dirname,".."),config=require("../players.json");
const scriptFolders={suite:config.package.packageId};
if(!/^[A-Za-z][A-Za-z0-9]+$/.test(config.package.packageId))throw Error("Missing/invalid suite packageId");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const includes=/\/\* @include (src\/(?:shared\/[\w/-]+|decks\/[\w-]+\/[\w/-]+)\.inc\.js)(?:#([\w.-]+))? \*\//g;
function render(text, dependencies = [], stack = [], deck = null) {
 return text.replace(includes,(_,rel,fragment)=>{
  const owner=/^src\/decks\/([\w-]+)\//.exec(rel)?.[1];
  if(owner && owner!==deck)throw new Error("Deck include outside current player: "+rel);
  const key=rel+(fragment?"#"+fragment:"");
  if(stack.includes(key))throw new Error("Recursive shared include: "+key);
  dependencies.push(key);
  const full=path.resolve(base,rel);
  if(!full.startsWith(base+path.sep))throw new Error("Include outside shared root");
  const source=fs.readFileSync(full,"utf8").replace(/\r\n/g,"\n");
  if(!fragment)return render(source.trimEnd(),dependencies,[...stack,key],deck);
  const begin="// @fragment "+fragment+"\n",end="\n// @endfragment "+fragment;
  const at=source.indexOf(begin),to=source.indexOf(end,at+begin.length);
  if(at<0||to<0||source.indexOf(begin,at+begin.length)>=0)throw new Error("Missing/duplicate shared fragment "+rel+"#"+fragment);
  return render(source.slice(at+begin.length,to).trimEnd(),dependencies,[...stack,key],deck);
 });
}
const elements=["Pyro","Hydro","Anemo","Electro","Dendro","Cryo","Geo","Omni"];
const commonAssets=["user_turn","enemy_turn","charge","uncharge","disable","hand_rim","hand_cost_neutral","hand_cost_element","hand_cost_dendro","hand_cost_electro","hand_cost_matching","hand_cost_pyro","hand_empowered",
 ...["Main","Roll"].flatMap(k=>elements.map(e=>"dice/Native"+k+e)),
 ...["角色状态_水泡","角色状态_冻结2","角色状态_冻结","确定","对方行动中","回合结算阶段","回合结束","出战角色","元素骰子不足","元素调和"].map(n=>"core/"+n),
 ...["Pyro","Hydro","Cryo","Electro","Dendro","Freeze"].map(n=>"state/State"+n),...[5,6,7,8,9,10].map(n=>"num/Hand"+n)];
function documentationLinks(text){
 return text.replace(/\]\(ATTRIBUTION\.md\)/g,"](#attribution)")
  .replace(/\]\(LICENSE-GPL-3\.0\.txt\)/g,"](#license)")
  .replace(/`ATTRIBUTION\.md`/g,"[素材来源与署名](#attribution)")
  .replace(/`LICENSE-GPL-3\.0\.txt`/g,"[许可证全文](#license)");
}
function deckParts(id,dependencies) {
 const p=config.players[id],dir=path.join(base,"src/decks",id),parts={};
 for(const name of ["core","bgi","player"]){
  let source=fs.readFileSync(path.join(dir,name+".js.tmpl"),"utf8");
  if(name==="bgi"){
   const host="/* @include src/shared/host.inc.js */";
   if(!source.startsWith(host))throw Error("Deck adapter must begin with the common host: "+id);
   source=source.slice(host.length);
  }
  let text=render(source,dependencies,[],id);
  if(name==="core")for(const module of [...(p.coreModules||[])].reverse()){
   if(!/^[\w-]+\.js$/.test(module))throw Error("Invalid core module: "+module);
   text=fs.readFileSync(path.join(dir,module),"utf8")+"\n"+text;
   dependencies.push("src/decks/"+id+"/"+module);
  }
  if(name==="core")text+="\nglobalThis.TCG.version="+JSON.stringify(config.sharedRevision)+";\nglobalThis.TCG.sharedVersion="+JSON.stringify(config.sharedRevision)+";\nglobalThis.TCG.deckId="+JSON.stringify(id)+";\nglobalThis.TCG.defaultStrategy="+JSON.stringify(p.defaultStrategy||"default")+";\n"+render("/* @include src/shared/rules.inc.js#tcg-rules.strategyRegistry */",dependencies)+"\n";
  if(name==="core")text+="\nglobalThis.TCG.deckTitle="+JSON.stringify(p.title)+";\nglobalThis.TCG.deckLabel="+JSON.stringify(p.label)+";\n";
  if(name==="player")text=text.replace(/const VERSION = "[^"]+";/,"const VERSION = "+JSON.stringify(config.sharedRevision)+";");
  parts[name]=text;
 }
 let strategy=render(fs.readFileSync(path.join(dir,"strategy.js"),"utf8"),dependencies,[],id)+"\nglobalThis.TCG.registerStrategy(\"default\",globalThis.TCG.choose);\n";
 for(const module of p.strategyModules||[]){
  if(!/^strategies\/[\w-]+\.js$/.test(module))throw Error("Invalid strategy module: "+module);
  strategy+=render(fs.readFileSync(path.join(dir,module),"utf8"),dependencies,[],id)+"\n";
 }
 parts.strategy=strategy+"\nglobalThis.TCG.selectStrategy(globalThis.TCG.defaultStrategy);\n";
 return parts;
}
function suiteTemplates() {
 const files=new Map(),hands={decks:{}},openings={decks:{}},uiByDeck={};
 for(const [id,p]of Object.entries(config.players)){
  const raw=require("./public-assets.cjs").semanticAssets(recognitionFiles(id)).files;
  const names=new Map([...raw.keys()].filter(n=>n.endsWith(".png")).map(n=>[n,n.replace(/^(assets\/(?:hand|opening|expanded)\/)/,"$1"+id+"-")]));
  const rename=x=>typeof x==="string"?(names.get(x)||x):Array.isArray(x)?x.map(rename):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,rename(v)])):x;
  hands.decks[id]=rename(JSON.parse(raw.get("hand-bank.json")));
  openings.decks[id]=rename(JSON.parse(raw.get("opening-bank.json")));
  for(const [name,bytes]of raw)if(name.endsWith(".png"))files.set(names.get(name),bytes);
  uiByDeck[id]=[...commonAssets,...p.extraAssets].map(n=>"assets/"+n+".png");
  for(const name of uiByDeck[id])files.set(name,fs.readFileSync(path.join(base,name)));
 }
 files.set("hand-bank.json",Buffer.from(JSON.stringify(hands,null,2)+"\n"));
 files.set("opening-bank.json",Buffer.from(JSON.stringify(openings,null,2)+"\n"));
 return {files,uiByDeck};
}
function packageFiles(id="suite",options={}) {
 if(id!=="suite"&&!config.players[id])throw Error("Unknown player "+id);
 const dependencies=[],parts=Object.fromEntries(Object.keys(config.players).map(id=>[id,deckParts(id,dependencies)]));
 const labels=Object.fromEntries(Object.entries(config.players).map(([id,p])=>[p.title+"（"+p.label+"）",id]));
 const selected="const TCGSelectedDeck=("+JSON.stringify(labels)+")[(typeof settings===\"undefined\"?{}:settings).deck||"+JSON.stringify(Object.keys(labels)[0])+"];\nif(!TCGSelectedDeck)throw Error(\"未知牌组设置\");\n";
 const cases=names=>"switch(TCGSelectedDeck){\n"+Object.entries(parts).map(([id,p])=>"case "+JSON.stringify(id)+": {\n"+names.map(n=>"// @module "+id+"/"+n+"\n"+p[n]).join("\n;\n")+"\n;break;\n}").join("\n")+"\n}\n";
 let main='"use strict";\n'+selected+cases(["core","strategy"])+"\n// @module common-host\n"+render("/* @include src/shared/host.inc.js */",dependencies)+"\n;\n"+cases(["bgi","player"]);
 for(const name of ["collapsed-hand","opening-hand","hand-recognition"]){
  const rel="src/shared/"+name+".inc.js";main+="\n// @module "+name+"\n"+fs.readFileSync(path.join(base,rel),"utf8")+"\n;\n";dependencies.push(rel);
 }
 main+='\n// @tcg-entry\n(async function(){\n"use strict";\nconst supplied={...(typeof settings==="undefined"?{}:settings)};\ndelete supplied.mulligan;\nconst options=TCGPlayer.playerOptions(supplied);\nconst {Host,Player}=TCGHandRecognition.classes(globalThis,JSON.parse(file.readTextSync("hand-bank.json")).decks[TCGSelectedDeck],JSON.parse(file.readTextSync("opening-bank.json")).decks[TCGSelectedDeck]);\nreturn new Player(new Host(options),options).run();\n})();\n';
 new vm.Script(main,{filename:"suite/main.js"});
 const raw=suiteTemplates(),files=raw.files;
 const manifest=JSON.parse(fs.readFileSync(path.join(base,"src/suite/manifest.json"),"utf8"));manifest.name=config.package.title;manifest.version=config.sharedRevision;
 files.set("manifest.json",Buffer.from(JSON.stringify(manifest,null,2)+"\n"));
 const settings=JSON.parse(fs.readFileSync(path.join(base,"src/suite/settings.json"),"utf8")),deckSetting=settings.find(s=>s.name==="deck");
 deckSetting.options=Object.keys(labels);deckSetting.default=deckSetting.options[0];
 files.set("settings.json",Buffer.from(JSON.stringify(settings,null,2)+"\n"));
 files.set("main.js",Buffer.from(main));
 files.set("README.md",Buffer.from(fs.readFileSync(path.join(base,"distribution/README.md"),"utf8")+'\n\n<a id="license"></a>\n\n## 许可证全文\n\n<details>\n<summary>GNU General Public License v3.0（完整原文）</summary>\n\n```text\n'+fs.readFileSync(path.join(base,"src/decks/raiden/public/LICENSE-GPL-3.0.txt"),"utf8")+'\n```\n\n</details>\n'));
 return {files:require("./card-atlas.cjs").packCardAtlases(files,{uiByDeck:raw.uiByDeck}),dependencies:[...new Set(dependencies)].sort()};
}
function recognitionFiles(id,directory=config.players[id].recognition){
  const dir=path.resolve(base,directory);
 if(!dir.startsWith(path.join(base,"src/decks",id)+path.sep))throw Error("Recognition outside registered deck source");
 const source=JSON.parse(fs.readFileSync(path.join(dir,"sources.json"))),result=new Map();
 if(source.deck!==id||source.validationUsedAsTraining!==false)throw Error("Unreviewed recognition sources");
 for(const [rel,hash]of Object.entries(source.runtimeFiles)){
  if(!/^(?:(?:hand|opening)-bank\.json|assets\/(?:hand|opening|expanded)\/[\p{L}\p{N}_-]+\.png)$/u.test(rel))throw Error("Non-runtime recognition file: "+rel);
  const pooled=source.assetFiles?.[rel];
  if(pooled!==undefined&&(!rel.endsWith(".png")||typeof pooled!=="string"||!/^assets\/templates\/[\p{L}\p{N}_\/-]+\.png$/u.test(pooled)||pooled.split("/").includes("..")))throw Error("Invalid pooled asset: "+rel);
  const full=pooled?path.resolve(base,pooled):path.join(dir,rel);
  const bytes=fs.readFileSync(full);if(sha(bytes)!==hash)throw Error("Recognition asset drift: "+id+"/"+rel);
  result.set(rel,bytes);
 }
 for(const name of ["hand-bank.json","opening-bank.json"]){
  if(!result.has(name))throw Error("Missing recognition bank: "+name);
  const bank=JSON.parse(result.get(name));
  if(!Number.isFinite(bank.scoreFloor)||bank.scoreFloor<=0||bank.scoreFloor>1||bank.runnerUpGap!==.20)
   throw Error("Invalid recognition thresholds");
  for(const entry of [...bank.entries,...(bank.expanded?.entries||[])])for(const view of entry.views||[{patches:entry.patches}])
   for(const asset of view.patches)if(!result.has(asset))throw Error("Unpackaged recognition asset: "+asset);
 }
 // Preserve every view and patch position; only identical image bytes share a path.
 const images=new Map(),aliases=new Map();
 for(const [rel,bytes]of result)if(rel.endsWith(".png")){
  const hash=sha(bytes),first=images.get(hash);
  if(first){aliases.set(rel,first);result.delete(rel);}else images.set(hash,rel);
 }
 if(aliases.size)for(const name of ["hand-bank.json","opening-bank.json"]){
  const bank=JSON.parse(result.get(name)),resolve=rel=>aliases.get(rel)||rel;
  for(const part of [bank,bank.expanded].filter(Boolean))for(const entry of part.entries){
   if(entry.patches)entry.patches=entry.patches.map(resolve);
   for(const view of entry.views||[])view.patches=view.patches.map(resolve);
  }
  result.set(name,Buffer.from(JSON.stringify(bank,null,2)+"\n"));
 }
 return result;
}
function writeFiles(target,files) {
 for(const [rel,bytes] of files){const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);if(sha(fs.readFileSync(dest))!==sha(bytes))throw new Error("Readback mismatch "+dest);}
}
function packageHashes(packages) {
 return Object.fromEntries(Object.entries(packages).map(([id, {files}]) => [
  id, Object.fromEntries([...files].map(([filename, bytes]) => [filename, sha(bytes)])),
 ]));
}
function targetedProofArg(args) {
 const proofs=args.filter(a=>a.startsWith("--targeted-proof="));
 if(proofs.length>1||proofs.some(a=>!a.slice(17)))throw Error("Specify one nonempty --targeted-proof path");
 return proofs[0]?.slice(17);
}
function assertTested(packages,targetedProof=null,{allowFullReport=false}={}) {
 const reportPath=path.resolve(base,targetedProof||"reports/shared-latest.json");
 if(!fs.existsSync(reportPath))throw new Error("Run npm test before synchronizing/deploying");
 const report=JSON.parse(fs.readFileSync(reportPath));
 if(report.proofSchema!==1)throw new Error("Tested-byte proof missing; run npm test before synchronizing/deploying");
 const accepted=targetedProof
   ?allowFullReport&&report.full===true ||
     report.full===false&&report.scope==="targeted"&&report.authorization?.skipFullRegression===true&&
     typeof report.authorization.instruction==="string"&&report.authorization.instruction.length>0&&report.passed>0
   :report.full;
 if(report.failed!==0||!accepted||report.sharedVersion!==config.sharedRevision)throw new Error("Current validation has not passed for the requested scope");
 const hashes=packageHashes(packages);
 for(const id of Object.keys(packages)) {
  const tested=report.packages?.[id],current=hashes[id];
  if(!tested || !current || JSON.stringify(Object.keys(tested).sort())!==JSON.stringify(Object.keys(current).sort()))
   throw new Error("Tested package files changed: "+id);
  for(const [rel,hash]of Object.entries(current))
   if(tested[rel]!==hash)throw new Error("Source changed since validation: "+id+"/"+rel);
 }
}
function assertGeneratedClean(id,files,previous) {
 const p=config.package,source=path.resolve(base,p.source);
 const baseline=previous?.players[id]?.files;
 const initial=p.baselineSource?path.resolve(base,p.baselineSource):null;
 return assertTargetClean(id,source,files,baseline,initial,"Generated source changed outside shared layer");
}
const {templatePath}=require("./card-atlas.cjs");
function retiredTemplateFiles(files,baseline){
 const retained=new Set([...files].filter(([rel])=>templatePath.test(rel)).map(([,bytes])=>sha(bytes)));
 if(files.has("hand-bank.json")&&(JSON.parse(files.get("hand-bank.json")).atlas||JSON.parse(files.get("hand-bank.json")).decks))
  for(const region of require("./card-atlas.cjs").validateAtlas(files).values())retained.add(region.sourceSha256);
 return new Map(Object.entries(baseline||{}).filter(([rel,hash])=>!files.has(rel)&&templatePath.test(rel)&&retained.has(hash)));
}
function retiredRuntimeFiles(target,files,baseline){
 const retired=retiredTemplateFiles(files,baseline),main=files.get("main.js")?.toString(),readme=files.get("README.md")?.toString();
 for(const [rel,hash]of Object.entries(baseline||{})){
  if(files.has(rel)||retired.has(rel))continue;
  if(/^lib\/(core|strategy|bgi|player|collapsed-hand|opening-hand|hand-recognition)\.js$/.test(rel)){
   if(main?.includes(fs.readFileSync(path.join(target,rel),"utf8")))retired.set(rel,hash);
  }else if(["ATTRIBUTION.md","LICENSE-GPL-3.0.txt"].includes(rel)){
   const text=fs.readFileSync(path.join(target,rel),"utf8");
   if(readme?.includes(rel==="ATTRIBUTION.md"?documentationLinks(text):text))retired.set(rel,hash);
  }else if(rel==="assets/card-atlas/opening.png"){
   const index=require("./card-atlas.cjs").validateAtlas(files),retained=new Set([...index.values()].map(r=>r.sourceSha256+":"+r.rect.slice(2).join(",")));
   const old=["hand-bank.json","opening-bank.json"].flatMap(name=>Object.values(JSON.parse(fs.readFileSync(path.join(target,name),"utf8")).atlas||{})).filter(r=>r.file===rel);
   if(old.length&&old.every(r=>retained.has(r.sourceSha256+":"+r.rect.slice(2).join(","))))retired.set(rel,hash);
  }
 }
 return retired;
}
function retireFiles(target,retired,backup){
 const root=path.resolve(target),backupRoot=path.resolve(backup);
 for(const [rel,hash]of retired){
  const current=path.resolve(root,rel),saved=path.resolve(backupRoot,rel);
  if(!current.startsWith(root+path.sep)||!saved.startsWith(backupRoot+path.sep)||fs.lstatSync(current).isSymbolicLink()||sha(fs.readFileSync(current))!==hash||fs.existsSync(saved))
   throw Error("Retired file changed or backup exists: "+current);
 }
 for(const [rel]of retired){
  const current=path.resolve(root,rel),saved=path.resolve(backupRoot,rel);
  fs.mkdirSync(path.dirname(saved),{recursive:true});fs.renameSync(current,saved);
  let parent=path.dirname(current);
  while(parent.startsWith(root+path.sep)&&!fs.readdirSync(parent).length){fs.rmdirSync(parent);parent=path.dirname(parent);}
 }
}
function assertTargetClean(id,target,files,baseline,initial,label){
 const retired=retiredRuntimeFiles(target,files,baseline);
 for(const rel of new Set([...Object.keys(baseline||{}),...files.keys()])){
  const oldPath=initial?path.join(initial,rel):null,reference=baseline?baseline[rel]:oldPath&&fs.existsSync(oldPath)?sha(fs.readFileSync(oldPath)):null;
  const current=path.join(target,rel),exists=fs.existsSync(current);
  if(reference?(!files.has(rel)&&!retired.has(rel)||!exists||sha(fs.readFileSync(current))!==reference):exists)
   throw Error(label+": "+id+"/"+rel+". Reconcile it before writing.");
 }
 return retired;
}
function build(){
 const args=process.argv.slice(2),targetedProof=targetedProofArg(args);
 if(args.some(a=>!["--check","--sync"].includes(a)&&!a.startsWith("--targeted-proof=")))throw new Error("Usage: node tools/build.cjs [--check|--sync] [--targeted-proof=path]");
 const statePath=path.join(base,"build-state.json"),previous=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):null,report={sharedRevision:config.sharedRevision,players:{}};
 const packages={suite:packageFiles()};
 if(targetedProof)report.validation={scope:"targeted",proof:targetedProof};
 const retired={};
 if(args.includes("--sync")){assertTested(packages,targetedProof);for(const [id,{files}]of Object.entries(packages))retired[id]=assertGeneratedClean(id,files,previous);}
 for(const id of Object.keys(packages)) {
  const p=config.package,{files,dependencies}=packages[id],source=path.resolve(base,p.source);
  if(args.includes("--check"))for(const [rel,bytes] of files){if(!fs.existsSync(path.join(source,rel))||sha(fs.readFileSync(path.join(source,rel)))!==sha(bytes))throw new Error("Generated source drift: "+id+"/"+rel);}
  else if(args.includes("--sync")){
   if(retired[id].size){report.retiredBackup??=path.resolve(base,"../../backups","tcg-package-sync-"+new Date().toISOString().replace(/[:.]/g,"-"));retireFiles(source,retired[id],path.join(report.retiredBackup,id));}
   writeFiles(source,files);
  }
  report.players[id]={version:config.sharedRevision,files:Object.fromEntries([...files].map(([n,b])=>[n,sha(b)])),dependencies};
 }
 if(!args.includes("--check")){fs.writeFileSync(path.join(base,"build-manifest.json"),JSON.stringify(report,null,2)+"\n");if(args.includes("--sync"))fs.writeFileSync(statePath,JSON.stringify(report,null,2)+"\n");}
 console.log(JSON.stringify({checked:args.includes("--check"),synced:args.includes("--sync"),players:Object.fromEntries(Object.entries(report.players).map(([id,p])=>[id,{version:p.version,files:Object.keys(p.files).length,sharedFragments:p.dependencies.length}]))}));return report;
}
if(require.main===module)build();
module.exports={base,config,scriptFolders,sha,packageFiles,packageHashes,recognitionFiles,suiteTemplates,writeFiles,build,render,assertTested,targetedProofArg,assertGeneratedClean,assertTargetClean,retiredTemplateFiles,retiredRuntimeFiles,retireFiles,commonAssets};
