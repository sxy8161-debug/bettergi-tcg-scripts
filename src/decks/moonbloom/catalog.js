(function(root){
  "use strict";
  const roster = [
    {name:"菈乌玛",element:"Dendro",maxHp:11,maxEnergy:2,skills:{NA:"林麓旅踏",E:"圣言述咏·终宵永眠",Q:"圣言述咏·众心为月"}},
    {name:"哥伦比娅",element:"Hydro",maxHp:10,maxEnergy:3,skills:{NA:"月露泼降",E:"万古潮汐",Q:"她的乡愁"}},
    // Native 2026-10-14 11:06 preview: OCR drops the rare 虵 in all six reads.
    {name:"奈芙尔",element:"Dendro",maxHp:10,maxEnergy:2,skills:{NA:"游虵吐信",E:"弈术·千夜一舞",Q:"圣约·真眸幻戏"}}
  ];
  const team = roster.slice();
  const cards = [
    ["fruit","盈满之实",{any:3},"weapon",2],
    ["gambler","赌徒的耳环",{aligned:1},"artifact",1],
    ["canopy","「悬木人」",{},"support",2],
    ["sand","「沙中遗事」",{},"legend",1],
    ["bloom","元素幻变：绽放祝佑",{aligned:2},"support",1],
    ["wovenWeeds","元素共鸣：交织之草",{},"dice",2],
    ["gleam","月兆·满辉",{},"attachment",2],
    ["shift","换班时间",{},"switch",1],
    ["draw","运筹帷幄",{aligned:1},"draw",2],
    ["calx","白垩之术",{aligned:1},"energy",1],
    ["razor","藏锋何处",{},"return",2],
    ["countdown3","幻戏倒计时：3",{aligned:3},"draw",2],
    ["meditation","困困冥想术",{aligned:1},"choice",2],
    ["adventure","水仙十字大冒险",{aligned:1},"adventure",2],
    ["upgrade","天才的改造法",{},"attachment",2],
    ["cleaning","清扫时间",{},"dice",2],
    ["research","科研的动力",{aligned:1},"status",2],
    ["sashimi","刺身拼盘",{aligned:1},"food",1],
    ["seed","诳言之核",{element:"Dendro",n:5},"kernel",0],
    ["overgrow","绽放祝佑·蔓生",{element:"Dendro",n:2},"support",0],
    ["amrita","绽放祝佑·甘露",{element:"Hydro",n:2},"support",0],
    ["countdown2","幻戏倒计时：2",{aligned:2},"draw",0],
    ["countdown1","幻戏倒计时：1",{aligned:1},"draw",0],
    ["show","幻戏开始！",{},"draw",0],
    ["disperse","驱逐灾厄",{},"branch",0],
    ["sanctify","肃净污染",{},"branch",0],
    ["transformer","参量质变仪",{any:2},"support",0],
    ["nre","便携营养袋",{aligned:1},"support",0],
    ["fan","红羽团扇",{aligned:2},"support",0],
    ["seelie","寻宝仙灵",{aligned:1},"support",0],
    ["seedbox","化种匣",{},"support",0],
    ["lens","留念镜",{aligned:1},"support",0],
    ["lumen","流明石触媒",{any:3},"support",0],
    ["kusava","苦舍桓",{aligned:1},"support",0],
    ["ray","异色猎刀鳐",{},"technique",0],
    ["yumka","匿叶龙",{aligned:1},"technique",0],
    ["kohola","鳍游龙",{aligned:2},"technique",0],
    ["tepetli","嵴锋龙",{aligned:2},"technique",0],
    ["ikto","暝视龙",{aligned:2},"technique",0],
    ["qucu","绒翼龙",{aligned:1},"technique",0],
    ["boat","浪船",{aligned:5},"technique",0],
    ["tatanka","突角龙",{any:4},"technique",0],
    ["rawr","呀！呀！",{aligned:2},"technique",0],
    ["blubber","膨膨兽",{aligned:1},"technique",0],
    ["toy","木质玩具剑",{aligned:1},"heal-dice",0],
    ["tea","沉玉茶露",{},"food",0],
    ["chenyu","沉玉谷",{},"choice-option",0],
    ["tower","自体自身之塔",{},"choice-option",0],
    ["tonatiuh","天蛇船",{},"choice-option",0],
    ["chasm","层岩巨渊",{},"choice-option",0],
    ["reforge","重铸圣剑",{any:4},"heal",0]
  ].map(([id,name,cost,type,copies])=>({id,name,cost,type,copies}));
  // Names/costs are independently transcribed card rules, not game-state facts.
  // Unsupported target/prepare pages are excluded from active skill candidates.
  const techniques = {
    ray:{name:"原海水刃",cost:{any:2},damage:2,active:true},
    yumka:{name:"钩物巧技",cost:{aligned:2},damage:1,hand:true,active:true},
    kohola:{name:"游隙灵道",cost:{aligned:1},active:false,reason:"需要实际召唤物及目标页，霜林和涟漪不是召唤物"},
    tepetli:{name:"掘进突击",cost:{any:2},hand:true,active:true},
    ikto:{name:"灵性援护",cost:{aligned:1},active:false,reason:"任意场地/道具/料理二次选择页尚未验收"},
    qucu:{name:"迅疾滑翔",cost:{aligned:1},hand:true,switches:true,active:true},
    boat:{name:"浪船·迅击炮",cost:{aligned:1},damage:2,active:true},
    tatanka:{name:"昂扬状态",cost:{any:3},active:false,reason:"两次准备普攻的原生会话尚未验收"},
    rawr:{name:"呀！呀！",cost:{any:2},hand:true,active:true},
    blubber:{name:"膨膨音波",cost:{aligned:1},hand:true,switches:true,active:true}
  };
  const byId = Object.fromEntries(cards.map(c=>[c.id,c]));
  const initialNames = new Set(cards.filter(c=>c.copies>0).map(c=>c.name));
  root.TCGMoonCatalog={roster,cards,techniques,shareCode:"JUBC+WwQJGGQBn0YB6HQipcdG7GR27khIeLSHkMjDoKwOOskJHJSR0UlD+IgXvQRDyAA"};
  if(typeof module!=="undefined"&&module.exports)module.exports=root.TCGMoonCatalog;
})(globalThis);
