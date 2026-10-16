"use strict";
// Publication-only names. Frozen source banks, original pixels and evidence are never edited.
function cardStem(name) {
 const stem=String(name).normalize("NFC").replace(/[^\p{L}\p{N}_-]+/gu,"-").replace(/^-+|-+$/g,"");
 if(!stem||/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem))throw Error("Unsafe card filename: "+name);
 return stem;
}
function semanticAssets(files) {
 const names=new Map(),destinations=new Map(),banks=new Map();
 for(const [filename,stage]of [["hand-bank.json","hand"],["opening-bank.json","opening"]]){
  if(!files.has(filename))continue;
  const bank=JSON.parse(files.get(filename).toString("utf8"));
  for(const [part,layout]of [[bank,stage],[bank.expanded,"expanded"]]){
   if(!part)continue;
   for(const entry of part.entries){
    const stem=cardStem(entry.name),views=entry.views||[{patches:entry.patches}];
    views.forEach((view,v)=>{view.patches=view.patches.map((old,p)=>{
     if(!/^assets\/(?:hand|opening|expanded)\/[^/\\]+\.png$/.test(old)||!files.has(old))throw Error("Unbound template: "+old);
     const name=names.get(old)||`assets/${layout}/${stem}-v${String(v+1).padStart(2,"0")}-p${String(p+1).padStart(2,"0")}.png`;
     const key=name.toLocaleLowerCase("en-US");
     if(destinations.has(key)&&destinations.get(key)!==old)throw Error("Template name collision: "+name);
     names.set(old,name);destinations.set(key,old);return name;
    });});
    if(!entry.views)entry.patches=views[0].patches;
    else if(entry.patches)entry.patches=entry.patches.map(old=>{if(!names.has(old))throw Error("Unbound legacy patch: "+old);return names.get(old);});
   }
  }
  banks.set(filename,Buffer.from(JSON.stringify(bank,null,2)+"\n"));
 }
 const result=new Map();
 for(const [rel,bytes]of files){
  if(/^assets\/(?:hand|opening|expanded)\//.test(rel)&&!names.has(rel))throw Error("Unreferenced publication template: "+rel);
  const target=names.get(rel)||rel;if(result.has(target))throw Error("Duplicate publication path: "+target);
  result.set(target,banks.get(rel)||bytes);
 }
 if(result.size!==files.size)throw Error("Publication file count changed");
 return {files:result,names};
}
module.exports={cardStem,semanticAssets};
