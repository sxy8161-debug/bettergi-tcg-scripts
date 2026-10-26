"use strict";
// Finite scripted capture/OCR/CV/native-input boundary. No gameplay simulator:
// two published input outcomes, not derived from the implementation under test.
// Player.act, Host.observe/board/execute/confirm, choose and commit stay real.
const {clone}=require("../../../shared/harness.cjs");
module.exports=function fixture(loadContext,mode,options={}){
  let time=100000,point=null,preview=null,stage=0,fan=false,selected=false,down=null,soupPage=false,optionSelected=false,
    summonPage=false,summonSelected=-1,mConfirmReadyAt=0,selectedId=null,supportPayment=false,pickSelected=-1,tuningPage=false,
    artifactPage=false,artifactSelected=false;
  const clicks=[],events=[],drags=[];
  const entryHand=["blessingM","surf","dragon","blessingM","surf","dragon","boar"];
  const supportBefore=[{index:0,counter:1},{index:1,counter:3},{index:2,counter:null}];
  const handXs={1:[1120],3:[914,1117,1322],4:[812,1015,1218,1421],5:[719,913,1115,1319,1528],7:[635,799,961,1117,1279,1438,1603]};
  const scenes=mode==="left-tune"?[
    {active:0,dice:3,colors:{Cryo:1,Geo:2},hp:10,energy:0,enemyHp:20,handIds:["dragon","surf","teaParty","gladiator","pilgrimage"]},
    {active:0,dice:3,colors:{Cryo:2,Geo:1},hp:10,energy:0,enemyHp:20,handIds:["surf","teaParty","gladiator","pilgrimage"]},
    {active:0,dice:3,colors:{Cryo:3},hp:10,energy:0,enemyHp:20,handIds:["teaParty","gladiator","pilgrimage"]}
  ]:mode.startsWith("tulpa-")?[
    {active:2,dice:6,hp:6,energy:mode==="tulpa-Q"?3:1,enemyHp:20,cold:2,half:1,cat:0,dead:[0,1]},
    {active:2,dice:3,hp:mode==="tulpa-Q"?8:7,energy:mode==="tulpa-Q"?0:2,enemyHp:mode==="tulpa-Q"?13:16,
      cold:mode==="tulpa-Q"?1:2,cat:0,dead:[0,1]},
    {active:2,dice:0,hp:6,energy:3,enemyHp:10,cold:1,cat:0,dead:[0,1]}
  ]:mode==="replacement"?[
    {active:null,dice:3,hp:10,energy:0,enemyHp:20,dead:[0,1]},
    {active:2,dice:3,hp:8,energy:0,enemyHp:20,dead:[0,1]}
  ]:mode==="support-life"?[
    {dice:1,hp:10,energy:0,enemyHp:20,cat:0,hand:"chef",supports:supportBefore},
    {dice:0,hp:10,energy:0,enemyHp:20,cat:0,supports:[...supportBefore,{index:3,counter:null}]},
    {dice:0,hp:10,energy:0,enemyHp:20,cat:0,handIds:["silver","boar","dragon"],supports:[{index:2,counter:null},{index:3,counter:null}]}
  ]:mode==="main-entry"?[
    {active:0,dice:8,hp:10,energy:0,enemyHp:20,cold:0,cat:0,handIds:entryHand},
    {active:0,dice:5,hp:10,energy:1,enemyHp:19,cold:2,cat:0,handIds:entryHand}
  ]:mode==="last-M"?[
    {dice:0,colors:{},hp:10,tulpaHp:8,energy:0,enemyHp:20,cold:2,half:2,cat:0,hand:"blessingM"},
    {dice:2,colors:{Pyro:1,Geo:1},hp:10,tulpaHp:10,energy:0,enemyHp:20,cold:2,cat:0},
    {dice:0,colors:{},hp:10,tulpaHp:10,energy:1,enemyHp:18,cold:2,cat:0}
  ]:mode==="last-soup"?[
    {dice:2,hp:10,energy:0,enemyHp:20,cat:0,hand:"soup"},
    {dice:1,hp:10,energy:0,enemyHp:20,cat:0},
    {dice:0,hp:9,energy:1,enemyHp:16,cat:1}
  ]:mode==="last-autumn"?[
    {dice:2,hp:10,energy:0,enemyHp:20,cat:0,hand:"autumnFrost"},
    {dice:2,hp:11,energy:0,enemyHp:20,cat:0}
  ]:[
    {dice:2,hp:10,energy:0,enemyHp:20,cat:0,hand:"gladiator"},
    {dice:2,hp:10,energy:0,enemyHp:20,cat:0},
    {dice:0,hp:9,energy:1,enemyHp:16,cat:1}
  ];
  class Clock extends Date{static now(){return time;}}
  const c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;},log:{info(){},warn(){},error(){}},
    genshin:{scaleTo1080PRatio:1},
    captureGameRegion:()=>({Width:1920,Height:1080,Prev:{Width:3840,Height:2160,Prev:null},
      scene:clone(scenes[stage]),preview,fan,selected,selectedId,soupPage,optionSelected,summonPage,summonSelected,supportPayment,pickSelected,tuningPage,artifactPage,artifactSelected,dispose(){}}),
    GameCaptureRegion:{GameRegion1080PPosMove:(...xy)=>{point=xy;}},
    leftButtonClick:()=>{
      clicks.push(point);
      const [x,y]=point;
      if(artifactPage&&x===960&&y===720)artifactSelected=true;
      if(artifactPage&&artifactSelected&&x===960&&y===945){stage=1;artifactPage=false;}
      if(tuningPage&&x===940&&y===935){stage++;tuningPage=false;selected=false;selectedId=null;fan=false;}
      if(mode==="replacement"&&stage===0&&x===1175&&y===720){if(pickSelected===2)stage=1;else pickSelected=2;}
      if(supportPayment&&x===960&&y===945){stage=1;supportPayment=false;}
      if(summonPage&&y===680&&[1460,1630].includes(x))summonSelected=x===1460?0:1;
      if(summonPage&&summonSelected>=0&&x===960&&y===945){stage=1;summonPage=false;}
      if(soupPage&&x===960&&y===540)optionSelected=true;
      if(soupPage&&optionSelected&&x===960&&y===916){stage=1;soupPage=false;}
      if(y===957){
        if(preview===x){stage++;preview=null;}
        else preview=x;
      }
      if(x===967&&y===1041)fan=!fan;
      if(x===1120&&y===945)selected=true;
      if(y===945&&scenes[stage].handIds){
        const index=handXs[scenes[stage].handIds.length].findIndex(px=>Math.abs(px-x)<4);
        if(index>=0){selected=true;selectedId=scenes[stage].handIds[index];}
      }
      if(x===1190&&y===545){fan=false;preview=null;selected=false;selectedId=null;}
    },leftButtonDown:()=>{down=point;},leftButtonUp:()=>{
      drags.push({from:down,to:point});
      if(mode==="left-tune"&&point[0]===1867&&point[1]===518)tuningPage=true;
      if(mode==="support-life"&&stage===0&&point[0]===1120&&point[1]===595){supportPayment=true;selected=false;fan=false;}
      if(mode==="last-M"&&stage===0&&point[0]===1120&&point[1]===595){
        summonPage=true;summonSelected=options.initialMSelection??-1;
        mConfirmReadyAt=time+(options.delayMConfirmMs||0);selected=false;fan=false;
      }
      if(mode.startsWith("last-")&&stage===0&&point[0]===960&&point[1]===720){
        if(mode==="last-soup")soupPage=true;else if(mode==="last-artifact")artifactPage=true;else stage=1;
        selected=false;fan=false;
      }
      down=null;
    }});
  const {Host,Player}=c.TCGHandRecognition.classes(c,
    JSON.parse(require("../../../../tools/build.cjs").packageFiles("ailin").files.get("hand-bank.json")),
    JSON.parse(require("../../../../tools/build.cjs").packageFiles("ailin").files.get("opening-bank.json")));
  const h=new Host({}),p=new Player(h,{maxMinutes:15});
  p.memory.round=1;p.memory.used[0]=1;p.openingFlow=new c.TCG.OpeningFlow("board");p.openingFlow.complete=true;
  if(mode==="left-tune")p.memory.used[0]=0;
  if(mode==="last-M"){p.memory.artifactKinds[1]="gladiator";}
  if(mode.startsWith("tulpa-")){p.memory.talents[0]=true;p.memory.coldSummon=2;}
  if(mode==="support-life"){
    p.memory.supports=[{id:"cooking",slot:0,remaining:1},{id:"silver",slot:1,elementCount:3},
      {id:"dunyarzad",slot:2,discountRound:1,drawUsed:true}];p.memory.supportSlots=3;
  }
  const box=(x,y,w=15,h=18)=>({x,y,w,h});
  h.matches=(f,asset,area)=>{
    const [x,y]=area.rect,s=f.scene;
    if(asset==="core/元素调和"&&f.tuningPage)return [box(920,920,40,30)];
    if(asset==="disable"&&y===545&&s.dead?.includes([663,873,1083].indexOf(x)))return [box(x,y)];
    if(asset==="ailin/target-selected"&&f.summonPage&&f.summonSelected>=0&&x===1395+170*f.summonSelected)
      return [box(x+20,y+40,45,38)];
    if(asset==="user_turn")return f.preview||f.soupPage||f.supportPayment||f.tuningPage||f.artifactPage||mode==="replacement"&&stage===0?[]:[box(64,518)];
    if(asset==="hand_rim"&&area.panel==="board")return (s.supports||[{index:0,counter:2}])
      .filter(item=>x===305+170*(item.index%2)&&y===585+198*Math.floor(item.index/2))
      .map(item=>box(350+170*(item.index%2),620+198*Math.floor(item.index/2),6,90))
      .concat(y===585&&x===1450&&(s.cold||s.cat)?[box(1515,620,6,90)]:[],
        y===585&&x===1620&&s.half?[box(1685,620,6,90)]:[]);
    if(asset==="core/确定"&&area.panel==="choice"&&f.soupPage&&f.optionSelected)return [box(928,900,64,32)];
    if(asset==="hand_cost_neutral"&&(s.hand||s.handIds)){
      const n=s.handIds?.length||1;
      if(area.panel==="handFolded"&&!f.fan)return Array.from({length:n},(_,i)=>box(862.7-(n-1)*85.3/2+i*85.3,983,30,30));
      if(area.panel==="handExpanded"&&f.fan)return handXs[n].map(px=>box(px-103,810,30,30));
    }
    if(asset==="charge"||asset==="uncharge"){
      const i=[812,1022,1233].indexOf(x),n=i===(s.active??1)?s.energy:0,max=c.TCG.team[i]?.maxEnergy||0;
      return Array.from({length:asset==="charge"?n:max-n},(_,j)=>box(x,y+j*35));
    }
    if(asset.startsWith("dice/NativeMain")||asset.startsWith("dice/NativeRoll")){
      const roll=asset.startsWith("dice/NativeRoll"),e=asset.slice(15),colors=s.colors||{Omni:s.dice},dice=Object.entries(colors).flatMap(([el,n])=>Array(n).fill(el));
      return dice.flatMap((el,j)=>el===e?[roll?box(600+j*120,400,30,30):box(1855,190+j*42)]:[]);
    }
    if(asset==="state/StateCryo"&&y<212)return [box(x+2,y+2)];
    if(asset==="ailin/cat"&&s.cat&&x===1350&&y===610)return [box(x+5,y+5)];
    if(asset==="ailin/cold"&&s.cold&&x===1350&&y===610)return [box(x+5,y+5)];
    if(asset==="ailin/half"&&s.half&&x===1520&&y===610)return [box(x+5,y+5)];
    return [];
  };
  h.localOcr=(f,area,_zoom,multiple)=>{
    if(multiple)return [];
    const [x,y,w]=area.rect,s=f.scene;
    if(x===68&&y===642)return String(s.dice);
    if(w===80){const item=(s.supports||[{index:0,counter:2}]).find(item=>
      x===350+170*(item.index%2)&&y===575+198*Math.floor(item.index/2));
      if(item?.counter!=null)return String(item.counter);}
    if(w===44){
      const who=[654,864,1074].indexOf(x);
      const active=Object.hasOwn(s,"active")?s.active:1;
      if([600,640].includes(y)&&who>=0)return y===(who===active?600:640)?String(who===active?s.hp:who===2?s.tulpaHp??10:10):"";
      if(x===864&&y===212)return String(s.enemyHp);
    }
    if(x===1460&&y===575&&s.cat)return String(s.cat);
    if(x===1460&&y===575&&s.cold)return String(s.cold);
    if(x===1630&&y===575&&s.half)return String(s.half);
    return "";
  };
  h.findOcr=(f,rect,multiple)=>{
    if(f.artifactPage){
      if(multiple)return rect[0]===770&&rect[1]===900&&f.artifactSelected?
        [{text:"打出手牌",x:860,y:920,w:200,h:50}]:[];
      return rect[0]===560&&rect[1]===508?"请选择要装备圣遗物的角色":"";
    }
    if(mode==="replacement"&&stage===0){
      if(multiple)return [];
      if(rect[0]===138&&rect[1]===1020)return "请选择出战角色";
      if(f.pickSelected===2&&rect[0]===311&&rect[1]===115)return "水形幻人";
      if(rect[0]===700&&rect[1]===508)return "请选择一位角色出战";
    }
    if(f.supportPayment){
      if(multiple)return rect[0]===770&&rect[1]===900?[{text:"打出手牌",x:860,y:920,w:200,h:50}]:[];
      return rect[0]===560&&rect[1]===508?"打出手牌卯师傅":"";
    }
    if(f.summonPage){
      if(multiple)return rect[0]===770&&rect[1]===900&&f.summonSelected>=0&&time>=mConfirmReadyAt?
        [{text:"确定",x:860,y:920,w:200,h:50}]:[];
      return [560,700].includes(rect[0])&&rect[1]===508?"对所选我方召唤物生效":"";
    }
    if(f.soupPage){
      if(multiple)return rect[0]===250&&rect[1]===705?
        ["疗愈","助佑","激愤"].map((name,i)=>({text:"奇瑰之汤·"+name,x:480+i*400,y:725,w:160,h:30})):[];
      if(rect[0]===844&&rect[1]===167)return "挑选卡牌";
      if(rect[0]===700&&rect[1]===155)return "挑选卡牌 请选择一张卡牌";
      return "";
    }
    return multiple?[]:rect[0]===1730&&rect[1]===700?String(f.scene.handIds?.length||(f.scene.hand?1:0)):
      rect[0]===311&&rect[1]===115&&f.selected&&(f.selectedId||f.scene.hand)?c.TCG.byId[f.selectedId||f.scene.hand].name:"";
  };
  h.artworkScore=()=>0; // Unknown new artwork takes the real title fallback.
  h.trace=(event,data)=>{h.recordRunDiagnostic(event,data);events.push({event,data:clone(data)});};
  return {c,T:c.TCG,h,p,clicks,events,drags,stage:()=>stage,
    advanceSupportSettlement(){if(mode!=="support-life"||stage!==1)throw Error("Unexpected scripted boundary transition");stage=2;}};
};
