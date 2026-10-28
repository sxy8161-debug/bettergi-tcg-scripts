"use strict";
const assert = require("node:assert/strict");
const { load } = require("./runtime.cjs");
const plain = value => JSON.parse(JSON.stringify(value));

// Model the public Region owner chain, not a resized image or native-game proof.
function frame(width, height, dispose = () => {}) {
  const desktop = { Width: 3840, Height: 2160, Prev: null };
  const raw = { Width: width, Height: height, Prev: desktop, dispose };
  return width > 1920
    ? { Width: 1920, Height: height * 1920 / width, Prev: raw, dispose }
    : raw;
}
function fixture(id = "raiden", width = 1920, height = 1080) {
  const calls = [], events = [];
  let size = [width, height], disposed = 0, time = 100000;
  class Clock extends Date { static now() { return time; } }
  const { env, Host, Player } = load(id, {
    Date: Clock,
    sleep: async ms => { time += ms; },
    genshin: { scaleTo1080PRatio: width / 1920 },
    captureGameRegion: () => frame(...size, () => { disposed++; }),
    GameCaptureRegion: { GameRegion1080PPosMove: (...xy) => calls.push(["move", ...xy]) },
    leftButtonClick: () => calls.push(["click"]),
    leftButtonDown: () => calls.push(["down"]),
    leftButtonUp: () => calls.push(["up"]),
    click: () => { throw Error("old click route"); },
    moveMouseTo: () => { throw Error("old move route"); },
  });
  const host = new Host({ maxMinutes: 1 });
  host.trace = (event, data) => events.push({ event, data });
  return { env, host, Player, calls, events, now: () => time, disposed: () => disposed,
    resize: (...next) => { size = next; } };
}


module.exports = async function (test) {

  await test("geometry: measured folded marker art false peak uses color only at actual1440; incomplete/extra rows still reject", async () => {
    const samples=require("./fixtures/raiden-folded-markers-1440-20261018.json").rows;
    for(const size of [[1920,1080],[2560,1440]]){
      const f=fixture("raiden",...size),h=f.host;
      await h.waitForCapture();
      const color=size[0]===2560;
      for(let i=0;i<samples.length;i++){
        const sample=samples[i], modes=[];
        h.matches=(_frame,asset,area,threshold,useColor)=>{
          assert.equal(area.panel,"handFolded");assert.equal(threshold,.9);modes.push(useColor);
          return asset==="hand_cost_neutral"?sample[useColor?"color":"gray"].map(([x,y])=>({x,y,w:10,h:30})):[];
        };
        const read=h.frame(frame=>h.collapsedLayoutIn(frame));
        assert.ok(modes.length>0&&modes.every(mode=>mode===color));
        assert.equal(read.count,!color&&i===0?null:sample.expectedCount);
      }
      const C=f.env.TCGCollapsedHand,marks=samples[0].color.map(([x,y])=>({x,y}));
      const first=Math.min(...marks.map(m=>m.x));
      assert.notEqual(C.locate(1920,1080,marks.filter(m=>m.x!==first)).status,"readable");
      assert.notEqual(C.locate(1920,1080,[...marks,{x:1206,y:983}]).status,"readable");
    }
  });
  await test("geometry: actual local OCR dimensions round-trip to F once, cache only this frame and release on error", async () => {
   for(const scenario of [
    {height:1440,panel:"details",rect:[135.4,122.4,238.2,42.2],zoom:1.25,crop:[135,122,238,42],output:[298,53],box:[254,143,23.8,4.2],click:[266,145]},
    {height:1600,panel:"opening",rect:[283,730,200,60],zoom:1,crop:[307,783,193,58],output:[200,60],box:[403.5,812,19.3,5.8],click:[413,815]},
   ]){
    const f = fixture("raiden",2560,scenario.height), dispose=[], crops=[];
    await f.host.waitForCapture();
    const capture=f.env.captureGameRegion,[width,height]=scenario.output;
    let reads=0, fail=false;
    f.env.RecognitionObject={Ocr:(...roi)=>({roi})};
    f.env.OpenCvSharp={OpenCvSharp:{Size:class{constructor(w,h){this.w=w;this.h=h;}}}};
    f.env.ImageRegion=class{
      constructor(mat){this.mat=mat;}
      FindMulti(ro){reads++;assert.deepEqual(Array.from(ro.roi),[0,0,width,height]);if(fail)throw new TypeError("scripted OCR failure");
        return {count:1,0:{text:"确定",x:width/2,y:height/2,width:width/10,height:height/10}};}
      dispose(){dispose.push("region");this.mat.dispose();}
    };
    f.env.captureGameRegion=()=>Object.assign(capture(),{DeriveCrop(...roi){crops.push(roi);return {
      SrcMat:{Resize(size){assert.deepEqual([size.w,size.h],scenario.output);return {dispose(){dispose.push("resized");}};}},dispose(){dispose.push("crop");}};}});
    const area=f.host.roi(scenario.panel,scenario.rect);
    const sample=()=>f.host.frame(image=>{const a=f.host.enlargedOcrRows(image,area,scenario.zoom);
      assert.equal(f.host.enlargedOcrRows(image,area,scenario.zoom),a);return a;});
    const rows=sample();assert.equal(reads,1);assert.deepEqual(crops,[scenario.crop]);
    ["x","y","w","h"].forEach((key,i)=>assert.ok(Math.abs(rows[0][key]-scenario.box[i])<1e-9));
    f.host.clickAt(rows[0].x+rows[0].w/2,rows[0].y+rows[0].h/2);
    assert.deepEqual(f.calls,[["move",...scenario.click],["click"]]);
    sample();assert.equal(reads,2);fail=true;
    assert.throws(sample,/scripted OCR failure/);
    assert.equal(reads,3);assert.deepEqual(dispose,Array(3).fill(["region","resized","crop"]).flat());
   }
  });
  await test("geometry:1600 roll uses measured native dice scale and all eight distinct slots",async()=>{
    const evidence=require("./fixtures/roll-1600-native-20261018.json"),f=fixture("raiden",2560,1600),h=f.host;
    await h.waitForCapture();
    // Recorded rectangles are independent pixel measurements, not generated
    // by panelTransform. This tests consumers, not a new pixel accuracy claim.
    h.matches=(_,asset,area)=>{
      assert.equal(area.panel,"rollDice");
      assert.ok(area.scale>=evidence.measuredScaleRange[0]&&area.scale<=evidence.measuredScaleRange[1]);
      const [x,y,w,hh]=area.rect;
      return evidence.hits.filter(r=>asset==="dice/NativeRoll"+r.element&&r.x>=x&&r.y>=y&&r.x+r.w<=x+w&&r.y+r.h<=y+hh);
    };
    const dice=h.frame(image=>h.diceIn(image,true));
    assert.deepEqual(plain(dice.items.map(d=>[d.element,d.slot])),evidence.hits.map((d,i)=>[d.element,i]));
    assert.deepEqual(plain(dice.dice),{Cryo:0,Hydro:2,Pyro:2,Electro:2,Anemo:1,Geo:0,Dendro:0,Omni:1});
  });

  await test("geometry: normalized observations click once through native input without a second scale", async () => {
    const f = fixture("moonbloom", 2560, 1440);
    await f.host.waitForCapture();
    f.host.clickAt(960.5, 945.5);
    assert.deepEqual(f.calls, [["move", 961, 946], ["click"]]);
    assert.equal(f.host.inputRevision, 1);
    for (const point of [[NaN, 1], [Infinity, 1], [-1, 1], [1920, 1], [1919.6, 1], [1, 1079.6]])
      assert.throws(() => f.host.clickAt(...point));
    assert.equal(f.calls.length, 2);
  });
};
