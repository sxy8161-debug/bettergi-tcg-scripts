"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const base=path.resolve(__dirname,".."),config=require("../players.json");
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
const commonAssets=["user_turn","enemy_turn","charge","uncharge","disable","hand_empty","hand_rim","hand_cost_neutral","hand_cost_element","hand_cost_dendro","hand_cost_electro","hand_cost_matching","hand_empowered",
 ...["Main","Roll"].flatMap(k=>elements.map(e=>"dice/Native"+k+e)),
 ...["角色状态_水泡","角色状态_冻结2","角色状态_冻结","确定","对方行动中","回合结算阶段","回合结束","出战角色","元素骰子不足","元素调和"].map(n=>"core/"+n),
 ...["Pyro","Hydro","Cryo","Electro","Dendro","Freeze"].map(n=>"state/State"+n),...[5,6,7,8,9,10].map(n=>"num/Hand"+n)];
function packageFiles(id,options={}) {
 const p=config.players[id];if(!p)throw new Error("Unknown player "+id);
 const result=new Map(),dir=path.join(base,"src/decks",id),dependencies=[];
 for(const name of ["core","bgi","player"]){
  const t=fs.readFileSync(path.join(dir,name+".js.tmpl"),"utf8");
  let text="// Generated from 牌手共享. Edit layered source, not this standalone output.\n"+render(t,dependencies,[],id);
  if(name==="core")for(const module of [...(p.coreModules||[])].reverse()) {
    if(!/^[\w-]+\.js$/.test(module))throw Error("Invalid core module: "+module);
    text=fs.readFileSync(path.join(dir,module),"utf8")+'\n'+text;
    dependencies.push("src/decks/"+id+"/"+module);
  }
  if(name==="core")text+='\nglobalThis.TCG.version = '+JSON.stringify(p.version)+';\nglobalThis.TCG.sharedVersion = '+JSON.stringify(config.sharedRevision)+';\nglobalThis.TCG.defaultStrategy = '+JSON.stringify(p.defaultStrategy||"default")+';\n'+render('/* @include src/shared/rules.inc.js#tcg-rules.strategyRegistry */')+'\n';
  if(name==="player")text=text.replace(/const VERSION = "[^"]+";/, "const VERSION = "+JSON.stringify(p.version)+";");
  if(text.includes("/* @include"))throw new Error("Unresolved include");
  new vm.Script(text,{filename:id+"/"+name+".js"}); result.set("lib/"+name+".js",Buffer.from(text));
 }
 let strategy=render(fs.readFileSync(path.join(dir,"strategy.js"),"utf8"),dependencies,[],id)+'\nglobalThis.TCG.registerStrategy("default", globalThis.TCG.choose);\n';
 for(const entry of p.strategyModules||[]) {
  if(!entry.startsWith("strategies/")||!entry.endsWith(".js"))throw Error("Strategy module must live in strategies/: "+entry);
  const full=path.resolve(dir,entry);if(!full.startsWith(dir+path.sep))throw Error("Strategy module outside deck root");
  const code=render(fs.readFileSync(full,"utf8"),dependencies,[],id);new vm.Script(code,{filename:entry});strategy+='\n'+code+'\n';
 }
 strategy+='\nglobalThis.TCG.selectStrategy(globalThis.TCG.defaultStrategy);\n';
 result.set("lib/strategy.js",Buffer.from(strategy));
 new vm.Script(result.get("lib/strategy.js").toString());
 for(const name of ["manifest.json","settings.json","README.md","ATTRIBUTION.md","LICENSE-GPL-3.0.txt"]) {
  let text=fs.readFileSync(path.join(dir,"public",name),"utf8");
  if(name==="manifest.json"){const m=JSON.parse(text);m.version=p.version;
   text=JSON.stringify(m,null,2)+"\n";}
  result.set(name,Buffer.from(text));
 }
 const recognition=p.recognition?recognitionFiles(id):new Map();
 for(const [rel,bytes]of recognition)result.set(rel,bytes);
 const readers=p.recognition?["collapsed-hand","opening-hand","hand-recognition"]:[];
 for(const name of readers){
  const rel="src/shared/"+name+".inc.js",bytes=fs.readFileSync(path.join(base,rel));
  new vm.Script(bytes.toString(),{filename:rel});result.set("lib/"+name+".js",bytes);dependencies.push(rel);
 }
 const select=p.recognition?'const {Host, Player} = TCGHandRecognition.classes(globalThis, JSON.parse(file.readTextSync("hand-bank.json")), JSON.parse(file.readTextSync("opening-bank.json")));':'const Host = TCGBetterGI.BetterGIHost, Player = TCGPlayer.Player;';
 const entry='for (const name of '+JSON.stringify(["core","strategy","bgi","player",...readers])+') {\n  eval(file.readTextSync("lib/" + name + ".js"));\n}\n(async function () {\n  "use strict";\n  const options = TCGPlayer.playerOptions(typeof settings === "undefined" ? {} : settings);\n  '+select+'\n  return new Player(new Host(options), options).run();\n})();\n';
 result.set("main.js",Buffer.from(entry));
 for(const n of [...commonAssets,...p.extraAssets])result.set("assets/"+n+".png",fs.readFileSync(path.join(base,"assets",n+".png")));
 for(const name of result.keys())if(/(?:tests|evidence|logs|tools|node_modules|src)\//.test(name))throw new Error("Internal file in runtime package: "+name);
 dependencies.push("src/shared/rules.inc.js#tcg-rules.strategyRegistry");
 const published=options.semanticAssets?require("./public-assets.cjs").semanticAssets(result).files:result;
 return {files:published,dependencies:[...new Set(dependencies)].sort()};
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
 for(const id of Object.keys(config.players)) {
  const tested=report.packages?.[id],current=hashes[id];
  if(!tested || !current || JSON.stringify(Object.keys(tested).sort())!==JSON.stringify(Object.keys(current).sort()))
   throw new Error("Tested package files changed: "+id);
  for(const [rel,hash]of Object.entries(current))
   if(tested[rel]!==hash)throw new Error("Source changed since validation: "+id+"/"+rel);
 }
}
function assertGeneratedClean(id,files,previous) {
 const p=config.players[id],source=path.resolve(base,p.source);
 const baseline=previous?.players[id]?.files;
 const initial=p.baselineSource?path.resolve(base,p.baselineSource):null;
 return assertTargetClean(id,source,files,baseline,initial,"Generated source changed outside shared layer");
}
const templatePath=/^assets\/(?:hand|opening|expanded)\/[\p{L}\p{N}_-]+\.png$/u;
function retiredTemplateFiles(files,baseline){
 const retained=new Set([...files].filter(([rel])=>templatePath.test(rel)).map(([,bytes])=>sha(bytes)));
 return new Map(Object.entries(baseline||{}).filter(([rel,hash])=>!files.has(rel)&&templatePath.test(rel)&&retained.has(hash)));
}
function retireTemplates(target,retired,backup){
 const root=path.resolve(target);
 for(const [rel,hash]of retired){
  const current=path.resolve(root,rel),saved=path.resolve(backup,rel);
  if(!templatePath.test(rel)||!current.startsWith(root+path.sep)||fs.lstatSync(current).isSymbolicLink()||sha(fs.readFileSync(current))!==hash||fs.existsSync(saved))
   throw Error("Retired template changed or backup exists: "+current);
  fs.mkdirSync(path.dirname(saved),{recursive:true});fs.renameSync(current,saved);
 }
}
function assertTargetClean(id,target,files,baseline,initial,label){
 const retired=retiredTemplateFiles(files,baseline);
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
 const packages=Object.fromEntries(Object.keys(config.players).map(id=>[id,packageFiles(id)]));
 if(targetedProof)report.validation={scope:"targeted",proof:targetedProof};
 const retired={};
 if(args.includes("--sync")){assertTested(packages,targetedProof);for(const [id,{files}]of Object.entries(packages))retired[id]=assertGeneratedClean(id,files,previous);}
 for(const id of Object.keys(config.players)) {
  const p=config.players[id],{files,dependencies}=packages[id],source=path.resolve(base,p.source);
  if(args.includes("--check"))for(const [rel,bytes] of files){if(!fs.existsSync(path.join(source,rel))||sha(fs.readFileSync(path.join(source,rel)))!==sha(bytes))throw new Error("Generated source drift: "+id+"/"+rel);}
  else {writeFiles(path.join(base,"build",id),files);if(args.includes("--sync")){
   if(retired[id].size){report.retiredBackup??=path.resolve(base,"../../backups","tcg-template-sync-"+new Date().toISOString().replace(/[:.]/g,"-"));retireTemplates(source,retired[id],path.join(report.retiredBackup,id));}
   writeFiles(source,files);
  }}
  report.players[id]={version:p.version,files:Object.fromEntries([...files].map(([n,b])=>[n,sha(b)])),dependencies};
 }
 if(!args.includes("--check")){fs.writeFileSync(path.join(base,"build-manifest.json"),JSON.stringify(report,null,2)+"\n");if(args.includes("--sync"))fs.writeFileSync(statePath,JSON.stringify(report,null,2)+"\n");}
 console.log(JSON.stringify({checked:args.includes("--check"),synced:args.includes("--sync"),players:Object.fromEntries(Object.entries(report.players).map(([id,p])=>[id,{version:p.version,files:Object.keys(p.files).length,sharedFragments:p.dependencies.length}]))}));return report;
}
if(require.main===module)build();
module.exports={base,config,sha,packageFiles,packageHashes,recognitionFiles,writeFiles,build,render,assertTested,targetedProofArg,assertGeneratedClean,assertTargetClean,retiredTemplateFiles,retireTemplates,commonAssets};
