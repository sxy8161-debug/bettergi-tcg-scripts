"use strict";
// Two fixed native-input outcomes for M's summon target page, not a duel model.
const {clone}=require("../../../shared/harness.cjs");
module.exports=function fixture(loadContext,options={}){
  let time=100000,point=null,stage=0,fan=false,selected=false,down=null,
    summonPage=false,summonSelected=-1,confirmAt=0;
  const clicks=[],events=[],drags=[],scenes=[
    {dice:0,colors:{},hp:10,tulpaHp:8,energy:0,enemyHp:20,cold:2,half:2,hand:"blessingM"},
    {dice:2,colors:{Pyro:1,Geo:1},hp:10,tulpaHp:10,energy:0,enemyHp:20,cold:2}
  ];
  class Clock extends Date{static now(){return time;}}
  const c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;},log:{info(){},warn(){},error(){}},
    genshin:{scaleTo1080PRatio:1},
    captureGameRegion:()=>({Width:1920,Height:1080,Prev:{Width:3840,Height:2160,Prev:null},
      scene:clone(scenes[stage]),fan,selected,summonPage,summonSelected,dispose(){}}),
    GameCaptureRegion:{GameRegion1080PPosMove:(...xy)=>{point=xy;}},
    leftButtonClick:()=>{
      clicks.push(point);const [x,y]=point;
      if(summonPage&&y===680&&[1460,1630].includes(x))summonSelected=x===1460?0:1;
      if(summonPage&&summonSelected>=0&&x===960&&y===945){stage=1;summonPage=false;}
      if(x===967&&y===1041)fan=!fan;
      if(x===1120&&y===945)selected=true;
      if(x===1190&&y===545){fan=false;selected=false;}
    },
    leftButtonDown:()=>{down=point;},
    leftButtonUp:()=>{
      drags.push({from:down,to:point});
      if(stage===0&&point[0]===1120&&point[1]===595){
        summonPage=true;summonSelected=options.initialMSelection??-1;
        confirmAt=time+(options.delayMConfirmMs||0);selected=false;fan=false;
      }
      down=null;
    }});
  const files=require("../../../../tools/build.cjs").packageFiles("ailin").files,
    {Host,Player}=c.TCGHandRecognition.classes(c,JSON.parse(files.get("hand-bank.json")).decks.ailin,
      JSON.parse(files.get("opening-bank.json")).decks.ailin),
    h=new Host({}),p=new Player(h,{maxMinutes:15});
  p.memory.round=1;p.memory.used[0]=1;p.memory.artifactKinds[1]="gladiator";
  p.openingFlow=new c.TCG.OpeningFlow("board");p.openingFlow.complete=true;
  const box=(x,y,w=15,h=18)=>({x,y,w,h});
  h.matches=(f,asset,area)=>{
    const [x,y]=area.rect,s=f.scene;
    if(asset==="ailin/target-selected"&&f.summonPage&&f.summonSelected>=0&&x===1395+170*f.summonSelected)
      return [box(x+20,y+40,45,38)];
    if(asset==="user_turn")return [box(64,518)];
    if(asset==="hand_rim"&&area.panel==="board")return (
      x===305&&y===585?[box(350,620,6,90)]:[])
      .concat(y===585&&x===1450&&s.cold?[box(1515,620,6,90)]:[],
        y===585&&x===1620&&s.half?[box(1685,620,6,90)]:[]);
    if(asset==="hand_cost_neutral"&&s.hand){
      if(area.panel==="handFolded"&&!f.fan)return [box(862.7,983,30,30)];
      if(area.panel==="handExpanded"&&f.fan)return [box(1017,810,30,30)];
    }
    if(asset==="charge"||asset==="uncharge"){
      const i=[812,1022,1233].indexOf(x),max=c.TCG.team[i]?.maxEnergy||0;
      return Array.from({length:asset==="charge"?0:max},(_,j)=>box(x,y+j*35));
    }
    if(asset.startsWith("dice/NativeMain")||asset.startsWith("dice/NativeRoll")){
      const e=asset.slice(15),dice=Object.entries(s.colors).flatMap(([el,n])=>Array(n).fill(el));
      return dice.flatMap((el,j)=>el===e?[box(1855,190+j*42)]:[]);
    }
    if(asset==="state/StateCryo"&&y<212)return [box(x+2,y+2)];
    if(asset==="ailin/cold"&&s.cold&&x===1350&&y===610)return [box(x+5,y+5)];
    if(asset==="ailin/half"&&s.half&&x===1520&&y===610)return [box(x+5,y+5)];
    return [];
  };
  h.localOcr=(f,area,_zoom,multiple)=>{
    if(multiple)return [];const [x,y,w]=area.rect,s=f.scene;
    if(x===68&&y===642)return String(s.dice);
    if(w===80&&x===350&&y===575)return "2";
    if(w===44){
      const who=[654,864,1074].indexOf(x);
      if([600,640].includes(y)&&who>=0)return y===(who===1?600:640)?
        String(who===1?s.hp:who===2?s.tulpaHp:10):"";
      if(x===864&&y===212)return String(s.enemyHp);
    }
    if(x===1460&&y===575&&s.cold)return String(s.cold);
    if(x===1630&&y===575&&s.half)return String(s.half);
    return "";
  };
  h.findOcr=(f,rect,multiple)=>{
    if(f.summonPage){
      if(multiple)return rect[0]===770&&rect[1]===900&&f.summonSelected>=0&&time>=confirmAt?
        [{text:"确定",x:860,y:920,w:200,h:50}]:[];
      return [560,700].includes(rect[0])&&rect[1]===508?"对所选我方召唤物生效":"";
    }
    return multiple?[]:rect[0]===1730&&rect[1]===700?String(f.scene.hand?1:0):
      rect[0]===311&&rect[1]===115&&f.selected&&f.scene.hand?c.TCG.byId[f.scene.hand].name:"";
  };
  h.artworkScore=()=>0;
  h.trace=(event,data)=>{h.recordRunDiagnostic(event,data);events.push({event,data:clone(data)});};
  return {h,p,clicks,events,drags,stage:()=>stage};
};
