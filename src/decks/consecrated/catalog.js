/* GPL-3.0. Independently transcribed ordinary-mode game rules, not reference-engine code.
 * Sources and unresolved native boundaries: reports/consecrated-development-20261023.
 * Character and card effects stay separate from shared input/observation. */
globalThis.TCGConsecratedCatalog = {
  shareCode: "F5ERZ3IWInAi1yUhItBR8noPFyCh9HsPF0Cw+JsPCYGwirMYC6IwB8EgDHEQCskQDKAA",
  guide: "https://www.miyoushe.com/ys/article/73568256",
  openingActive: 1,
  team: [
    {gameId:2405,name:"圣骸毒蝎",element:"Electro",maxHp:10,maxEnergy:2,weapon:null,
      skills:{NA:"蝎爪钳击",E:"蝎尾锥刺",Q:"雷锥散射"}},
    {gameId:2503,name:"圣骸飞蛇",element:"Anemo",maxHp:10,maxEnergy:2,weapon:null,
      skills:{NA:"旋尾迅击",E:"盘绕风引",Q:"错落风涡"}},
    {gameId:2207,name:"圣骸角鳄",element:"Hydro",maxHp:11,maxEnergy:2,weapon:null,
      skills:{NA:"尖牙噬咬",E:"鳄齿锐波",Q:"凶鳄狂浪"}}
  ],
  cards: [
    ["crocodileTalent","亡水溢流",222071,{element:"Hydro",n:1},"talent",2],
    ["scorpionTalent","亡雷凝蓄",224051,{element:"Electro",n:1},"talent",2],
    ["serpentTalent","亡风啸卷",225031,{element:"Anemo",n:1},"talent",2],
    ["emblem","绝缘之旗印",312008,{aligned:2},"artifact",2],
    ["harbor","璃月港口",321001,{aligned:2},"support",2],
    ["lair","风龙废墟",321015,{aligned:2},"support",2],
    ["liben","立本",322008,{},"support",2],
    ["whiteGlove","白手套和渔夫",322025,{},"support",2],
    ["nre","便携营养袋",323002,{aligned:1},"support",1],
    ["sand","「沙中遗事」",330012,{},"legend",1],
    ["shift","换班时间",332002,{},"switch",2],
    ["draw","运筹帷幄",332004,{aligned:1},"draw",2],
    ["stars","星天之兆",332008,{any:2},"energy",2],
    ["countdown3","幻戏倒计时：3",332032,{aligned:3},"draw",2],
    ["revel","「狂欢节奏」",332055,{any:2},"draw",2],
    ["adeptus","仙跳墙",333002,{any:2},"food",2],
    ["block","噬骸能量块",124051,{},"event",0],
    ["cleanup","「清洁工作」",302203,{},"event",0],
    ["countdown2","幻戏倒计时：2",332033,{aligned:2},"draw",0],
    ["countdown1","幻戏倒计时：1",332034,{aligned:1},"draw",0],
    ["show","幻戏开始！",332035,{},"draw",0],
    ["disperse","驱逐灾厄",300008,{},"branch",0],
    ["sanctify","肃净污染",300009,{},"branch",0]
  ].map(([id,name,gameId,cost,type,copies]) => ({id,name,gameId,cost,type,copies})),
  // The three rapid talents use the same wearer equipment flow.
  talents: {
    scorpionTalent:{target:0,requiresActive:false,entryBlock:1},
    serpentTalent:{target:1,requiresActive:false,entryBlock:1},
    crocodileTalent:{target:2,requiresActive:false,entryBlock:1}
  },
  openingKeep:["harbor","lair","countdown3","liben","draw","sand"],
  sandOptions:{"驱逐灾厄":"disperse","肃净污染":"sanctify"}
};
