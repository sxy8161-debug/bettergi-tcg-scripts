"use strict";
const {PNG}=require("pngjs"),crypto=require("node:crypto");
const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const cardPath=/^assets\/(hand|opening|expanded)\/[\p{L}\p{N}_-]+\.png$/u;
const templatePath=/^assets\/(?:[\p{L}\p{N}_-]+\/)*[\p{L}\p{N}_-]+\.png$/u;
// Repeated package assembly in one build/test process reuses only content-bound encodings.
const sheets=new Map();
function regions(bank){
 return [bank,bank.expanded].filter(Boolean).flatMap(part=>part.entries.flatMap(entry=>
  [...(entry.patches||[]),...(entry.views||[]).flatMap(view=>view.patches)]));
}
function sheet(images){
 const key=digest(JSON.stringify(images.map(([name,bytes])=>[name,digest(bytes)])));
 if(sheets.has(key))return sheets.get(key);
 const tiles=images.map(([name,bytes])=>({name,sourceSha256:digest(bytes),image:PNG.sync.read(bytes)}));
 tiles.sort((a,b)=>b.image.height-a.image.height||b.image.width-a.image.width||(a.name<b.name?-1:a.name>b.name?1:0));
 const width=Math.max(512,...tiles.map(t=>t.image.width));
 let x=0,y=0,rowHeight=0;
 for(const tile of tiles){
  const {width:w,height:h}=tile.image;
  if(x+w>width){x=0;y+=rowHeight;rowHeight=0;}
  tile.rect=[x,y,w,h];x+=w;rowHeight=Math.max(rowHeight,h);
 }
 const height=y+rowHeight,data=Buffer.alloc(width*height*4,255),index={};
 for(const tile of tiles){
  const [left,top,w,h]=tile.rect;
  for(let row=0;row<h;row++)tile.image.data.copy(data,((top+row)*width+left)*4,row*w*4,(row+1)*w*4);
  index[tile.name]={rect:tile.rect,sourceSha256:tile.sourceSha256};
 }
 // BetterGI decodes templates in Color mode. No resampling, colour conversion or quantisation.
 const bytes=PNG.sync.write({width,height,data},{colorType:2,inputColorType:6,deflateLevel:9});
 const result={bytes,index};sheets.set(key,result);return result;
}
function packCardAtlases(input){
 const files=new Map(input),index={},uiAtlas={};
 for(const stage of ["hand","opening","expanded","ui"]){
  const images=[...input].filter(([name])=>templatePath.test(name)&&
   (stage==="ui"?!cardPath.test(name):cardPath.test(name)&&name.startsWith("assets/"+stage+"/")));
  if(!images.length)continue;
  const name="assets/card-atlas/"+stage+".png",packed=sheet(images);
  if(files.has(name))throw Error("Duplicate atlas output: "+name);
  files.set(name,Buffer.from(packed.bytes));
  for(const [logical,region]of Object.entries(packed.index))(stage==="ui"?uiAtlas:index)[logical]={file:name,...region};
  for(const [logical]of images)files.delete(logical);
 }
 const used=new Set();
 for(const name of ["hand-bank.json","opening-bank.json"]){
  if(!files.has(name))continue;
  const bank=JSON.parse(files.get(name));
  if(bank.atlas||bank.uiAtlas)throw Error("Source bank must contain individual templates, not generated atlases");
  bank.atlas={};
  if(name==="hand-bank.json")bank.uiAtlas=uiAtlas;
  for(const logical of regions(bank)){
   if(!index[logical])throw Error("Missing atlas template: "+logical);
   bank.atlas[logical]=index[logical];used.add(logical);
  }
  files.set(name,Buffer.from(JSON.stringify(bank,null,2)+"\n"));
 }
 if(used.size!==Object.keys(index).length)throw Error("Unreferenced card atlas template");
 return files;
}
function rgbRegion(image,rect){
 const png=Buffer.isBuffer(image)?PNG.sync.read(image):image,[x,y,w,h]=rect;
 if(!rect.every(Number.isInteger)||x<0||y<0||w<=0||h<=0||x+w>png.width||y+h>png.height)throw Error("Invalid atlas rectangle");
 const rgb=Buffer.alloc(w*h*3);
 for(let row=0;row<h;row++)for(let col=0;col<w;col++){
  const src=((y+row)*png.width+x+col)*4,dst=(row*w+col)*3;
  png.data.copy(rgb,dst,src,src+3);
 }
 return rgb;
}
function validateAtlas(files){
 const declared=new Map(),images=new Map();
 for(const name of ["hand-bank.json","opening-bank.json"]){
  const bank=JSON.parse(files.get(name));
  if(!bank.atlas||typeof bank.atlas!=="object")throw Error("Missing card atlas index");
  const used=new Set(regions(bank));
  if(JSON.stringify([...used].sort())!==JSON.stringify(Object.keys(bank.atlas).sort()))throw Error("Atlas reference set mismatch");
  if(name==="hand-bank.json"&&(!bank.uiAtlas||typeof bank.uiAtlas!=="object"))throw Error("Missing UI atlas index");
  const entries=[...used].map(logical=>[logical,bank.atlas[logical],false]);
  if(name==="hand-bank.json")for(const [logical,region]of Object.entries(bank.uiAtlas))entries.push([logical,region,true]);
  for(const [logical,region,ui]of entries){
   if(!(ui?templatePath.test(logical)&&!cardPath.test(logical)&&!logical.startsWith("assets/card-atlas/"):cardPath.test(logical))||
    !region||!(ui?region.file==="assets/card-atlas/ui.png":/^assets\/card-atlas\/(hand|opening|expanded)\.png$/.test(region.file))||
    !Array.isArray(region.rect)||region.rect.length!==4||!region.rect.every(Number.isInteger)||
    !/^[a-f0-9]{64}$/.test(region.sourceSha256))throw Error("Invalid atlas template: "+logical);
   if(declared.has(logical)&&JSON.stringify(declared.get(logical))!==JSON.stringify(region))throw Error("Conflicting atlas template: "+logical);
   if(!images.has(region.file)){
    if(!files.has(region.file))throw Error("Missing atlas image: "+region.file);
    images.set(region.file,PNG.sync.read(files.get(region.file)));
   }
   const [x,y,w,h]=region.rect,png=images.get(region.file);
   if(x<0||y<0||w<=0||h<=0||x+w>png.width||y+h>png.height)throw Error("Atlas rectangle outside image: "+logical);
   declared.set(logical,region);
  }
 }
 return declared;
}
module.exports={packCardAtlases,validateAtlas,rgbRegion,regions,templatePath};
