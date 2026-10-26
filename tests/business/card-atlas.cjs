"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{PNG}=require("pngjs"),B=require("../../tools/build.cjs"),
 A=require("../../tools/card-atlas.cjs"),S=require("../../tools/public-assets.cjs");
const decode=bytes=>PNG.sync.read(bytes),rgb=png=>A.rgbRegion(png,[0,0,png.width,png.height]);
function sourceTemplates(id){
 const files=B.recognitionFiles(id);
 for(const asset of [...B.commonAssets,...B.config.players[id].extraAssets]){
  const name="assets/"+asset+".png";files.set(name,fs.readFileSync(path.join(B.base,name)));
 }
 return files;
}
function verify(raw,packed){
 const index=A.validateAtlas(packed),images=new Map();
 const sourceImages=[...raw.keys()].filter(n=>n.endsWith(".png"));
 assert.deepEqual([...index.keys()].sort(),sourceImages.sort());
 for(const [name,item]of index){
  assert.equal(item.sourceSha256,B.sha(raw.get(name)),name);
  assert.equal(packed.has(name),false,"Individual PNG leaked into runtime");
  if(!images.has(item.file))images.set(item.file,decode(packed.get(item.file)));
  const original=decode(raw.get(name));
  assert.deepEqual(item.rect.slice(2),[original.width,original.height]);
  assert.ok(A.rgbRegion(images.get(item.file),item.rect).equals(rgb(original)),name+" pixel change");
 }
 for(const name of ["hand-bank.json","opening-bank.json"]){
  const bank=JSON.parse(packed.get(name));delete bank.atlas;delete bank.uiAtlas;
  assert.deepEqual(bank,JSON.parse(raw.get(name)),"Card identities, views, pairs, thresholds and geometry must not change");
 }
 return index;
}
module.exports=async function(test){
 await test("registered atlas packages retain every original template pixel and bank field",()=>{
  for(const id of Object.keys(B.config.players))for(const semanticAssets of [false,true]){
   const original=sourceTemplates(id),raw=semanticAssets?S.semanticAssets(original).files:original;
   const p=B.packageFiles(id,{semanticAssets});verify(raw,p.files);
   const opening=JSON.parse(p.files.get("opening-bank.json"));
   assert.ok(Object.values(opening.atlas).every(r=>r.file==="assets/card-atlas/hand.png"));
   const retire=B.retiredTemplateFiles(p.files,Object.fromEntries([...raw].map(([n,b])=>[n,B.sha(b)])));
   assert.deepEqual([...retire.keys()].sort(),[...raw.keys()].filter(n=>n.endsWith(".png")).sort());
  }
 });
 await test("actual host crops atlas tiles with independent ownership",()=>{
  const raw=sourceTemplates("raiden"),files=B.packageFiles("raiden").files,index=A.validateAtlas(files),disposed=[],reads=[],matches=[];
  class Mat{
   constructor(image,label){this.image=image;this.Rows=image.height;this.Cols=image.width;this.label=label;}
   empty(){return false;}
   SubMat(top,bottom,left,right){
    assert.ok(top>=0&&left>=0&&bottom<=this.Rows&&right<=this.Cols);
    const data=Buffer.alloc((bottom-top)*(right-left)*4,255),r=A.rgbRegion(this.image,[left,top,right-left,bottom-top]);
    for(let i=0;i<r.length/3;i++)r.copy(data,i*4,i*3,i*3+3);
    return new Mat({width:right-left,height:bottom-top,data},"roi");
   }
   Clone(){return new Mat({...this.image,data:Buffer.from(this.image.data)},"owned-tile");}
   dispose(){assert.equal(this.disposed,undefined,"double release");this.disposed=true;disposed.push(this);}
  }
  const ctx=require("./runtime.cjs").load("raiden",{file:{createDirectory(){},
   readImageMatSync(name){reads.push(name);return new Mat(decode(files.get(name)),name);}},
   RecognitionObject:{TemplateMatch(mat,...rect){return {mat,rect};}}});
  const h=new ctx.Host({});
  for(const name of [...index.keys()].filter((n,i)=>i===0||i===1||n.includes("opening")).slice(0,4)){
   const tile=h.readTemplateImage(name);assert.ok(rgb(tile.image).equals(rgb(decode(raw.get(name)))));
   assert.ok(disposed.some(x=>x.label==="roi"));h.templates.set(name,tile);
  }
  const frame={Width:1920,Height:1080,FindMulti(ro){matches.push(ro);return {count:1,0:{X:30,Y:50,Width:12,Height:14}};}};
  const area=h.roi("viewport",[10,20,300,200]);
  for(const color of [false,true]){
   const result=h.matches(frame,"hand_cost_neutral",area,.9,color),ro=matches.at(-1);
   assert.deepEqual(JSON.parse(JSON.stringify(result)),[{x:30,y:50,w:12,h:14}]);
   assert.deepEqual(ro.rect,[10,20,300,200]);assert.equal(ro.threshold,.9);assert.equal(ro.Use3Channels,color);
   assert.ok(rgb(ro.mat.image).equals(rgb(decode(raw.get("assets/hand_cost_neutral.png")))));
  }
  assert.equal(reads.filter(n=>n==="assets/card-atlas/ui.png").length,1);
  assert.equal(matches[0].mat,matches[1].mat,"Color and gray matchers share the original BGR template");
  h.dispose();assert.ok([...h.templates.values()].length===0);
  assert.ok(disposed.some(x=>x.label==="owned-tile"));
 });
};
