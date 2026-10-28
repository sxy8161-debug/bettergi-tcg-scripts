"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {base,packageFiles,sha}=require("../../../../tools/build.cjs");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
const defaultLoad=overrides=>root?load(root,overrides):require("../../../business/runtime.cjs").load("consecrated",overrides).env;

// Use the same standalone main.js as the ordinary full-regression runner.
// Controlled observations are not pixel or native-game acceptance.
async function run(test,loadContext=defaultLoad) {
  const loadRules=(overrides={})=>{
    const context=loadContext({log:{info(){},warn(){},error(){}},
      file:{createDirectory(){},readTextSync:()=>JSON.stringify({name:"consecrated",version:"test"})},...overrides});
    return {T:context.TCG,Host:context.TCGBetterGI.BetterGIHost,Player:context.TCGPlayer.Player,
      options:context.TCGPlayer.playerOptions,recognitionClasses:()=>context.TCGHandRecognition.classes(context,
        {scoreFloor:.90,runnerUpGap:.20,entries:[],patches:[]})};
  };
  const T=loadRules().T;
  const hand=ids=>ids.map((id,i)=>({...T.observedCard(T.byId[id].name,i),
    attachments:{source:"native",reduction:0,increase:0}}));
  const board=(ids=[],active=1)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},hand:hand(ids),
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:60,active:true,dead:false}]});
  const memory=()=>T.freshMemory({newGame:true});

  await test("all three rapid talents accept living backend targets without requiring a skill",()=>{
    const s=board(),m=memory();s.characters[0].frozen=true;
    assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:0}),true);
    assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:1}),false);
    assert.equal(T.talentTargetLegal(s,{id:"crocodileTalent",target:2}),true);
    for (const [id,rule] of Object.entries(T.talents)) {
      const action={type:"card",id,index:0,target:rule.target},banner="装备给我方的"+T.team[rule.target].name;
      assert.equal(T.nativeCardScope(action,banner,s),true);
      assert.equal(T.nativeCardScope({...action,target:(rule.target+1)%3},banner,s),false);
    }
    s.active=2;s.characters[2].frozen=true;
    assert.equal(T.talentTargetLegal(s,{id:"crocodileTalent",target:2}),true);
    s.hand=hand(["crocodileTalent"]);s.dice={Electro:1};
    assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),false,"requires Hydro, not a free Pearl talent");
    s.dice={Hydro:1};assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),true);
    m.talents[2]=true;assert.equal(T.cardLegal(s,{id:"crocodileTalent",index:0,target:2},m),true,"repeated rapid talent still generates its entry block");
    s.characters[0].dead=true;assert.equal(T.talentTargetLegal(s,{id:"scorpionTalent",target:0}),false);
    for(const c of T.cards.filter(c=>c.type==="talent"))assert.equal(c.combatSkill,undefined);
    assert.equal(T.stormterrorEligible({type:"card",id:"serpentTalent"}),true);
    assert.equal(T.stormterrorEligible({type:"skill",who:1,skill:"Q"}),false);
    assert.equal(m.talents[0],false,"rule check does not equip it");
  });

  await test("highest current cost includes every tie and unknowns; final payment is not discard cost",()=>{
    const h=hand(["block","countdown3","adeptus","block"]);
    h[1].currentCost=0;assert.equal(T.discardCost(h[1]),3,"payment discount does not change ranking");
    assert.deepEqual(clone(T.blockDiscards(h,0).indices),[1]);
    h[1].attachments.reduction=1;
    let r=T.blockRisk(h,0,["adeptus"]);
    assert.deepEqual(clone(r.indices),[1,2]);assert.equal(r.essentialAtRisk,true);
    assert.deepEqual(clone(r.outcomes[0].deckTop),{id:"countdown2",destination:"deck-top"});
    delete h[2].attachments;r=T.blockRisk(h,0);
    assert.equal(r.known,false);assert.equal(r.minimumBlocks,null);
    assert.deepEqual(clone(r.unknown),[2]);
    r=T.blockRisk(hand(Array(7).fill("block")),0);
    assert.equal(r.minimumBlocks,5,"7 -> 6 source consumption -> 5 random second block");
    assert.equal(T.blockRisk(hand(["block"]),0).outcomes[0].discardIndex,null);
    assert.equal(T.blockRisk(hand(["block"]),0).minimumBlocks,0);
    const foreign=T.observedCard("禁忌知识",2),row=hand(["block","lair"]);
    row.push({...foreign,currentCost:0,costSource:"native-expanded-cost-markers",
      attachments:{source:"unknown",reduction:null,increase:null}});
    assert.equal(T.discardCost(row[2]),0,"a read native price does not depend on the fixed deck catalog");
    assert.deepEqual(clone(T.blockDiscards(row,0).indices),[1]);
    assert.equal(T.cardLegal({...board(),hand:row},{id:foreign.id,index:2,target:null},memory()),false,
      "price evidence does not teach an unsupported card's play effect");
    row[2].costSource="estimate";
    assert.equal(T.blockDiscards(row,0).known,false,"an estimated foreign price is not native evidence");
  });
  await test("normal block, tuning, burst discard and bottoming have distinct triggers",()=>{
    const s=board(["block"]),m=memory();m.talents[0]=m.talents[1]=true;
    let e=T.blockEffects("play",s,m);
    assert.equal(e.energyGain,0);assert.equal(e.draw,1);assert.equal(e.generatedDice,1);assert.equal(e.armWind,true);
    for(const mode of ["tune","burst-discard"]){e=T.blockEffects(mode,s,m);assert.equal(e.generatedDice,0);assert.equal(e.usesPlayLimit,false);}
    m.blockPlayed=true;assert.equal(T.blockEffects("play",s,m),null);
    m.blockPlayed=false;s.characters[0].dead=true;assert.equal(T.blockEffects("play",s,m).draw,0);
    assert.equal(T.countdownDiscard("countdown3","bottom"),null);
    assert.equal(T.countdownDiscard("countdown3","play"),null);
    assert.equal(T.countdownDiscard("show","discard"),null);
  });

  await test("block result checks full identities, highest-cost possibilities and the whole dice vector",()=>{
    const b=board(["block","countdown3","emblem","block"]),m=memory();
    m.talents[0]=true;
    const a={type:"card",id:"block",index:0},after=ids=>({...clone(b),hand:hand(ids),handRead:"full",dice:{Omni:8,Anemo:1}});
    assert.equal(T.blockResult(a,b,after(["emblem","block","countdown2"]),m),true);
    assert.equal(T.blockResult(a,b,after(["emblem","block","stars"]),m),true,"do not promise the drawn identity");
    assert.equal(T.blockResult(a,b,after(["emblem","block"]),m),true,"exhausted deck need not draw");
    assert.equal(T.blockResult(a,b,after(["countdown3","block","stars"]),m),false,"cannot discard the cheaper emblem");
    assert.equal(T.blockResult(a,b,after(["emblem","block","stars","draw"]),m),false,"cannot invent two draws");
    let c=after(["emblem","block","countdown2"]);c.dice={Omni:9};assert.equal(T.blockResult(a,b,c,m),false);
    c=after(["emblem","block","countdown2"]);c.handRead="remove";assert.equal(T.blockResult(a,b,c,m),false);
    c=after(["emblem","block","countdown2"]);c.active=0;assert.equal(T.blockResult(a,b,c,m),false);
    m.talents[0]=false;assert.equal(T.blockResult(a,b,after(["emblem","block","countdown2"]),m),false);
    const one=board(["block"]),last={...clone(one),hand:[],handRead:"full",dice:{Omni:8,Anemo:1}};
    assert.equal(T.blockResult(a,one,last,m),true,"source alone needs no second discard");
    const tied=board(["block","adeptus","emblem"]);m.talents[0]=true;
    assert.equal(T.blockResult(a,tied,{...after(["adeptus","stars"]),active:1},m),true);
    assert.equal(T.blockResult(a,tied,{...after(["emblem","stars"]),active:1},m),true);
  });
  await test("a compacted support row cannot relabel Liben and White Glove as the departed Harbors",()=>{
    const m=memory(),s=board();
    m.supports=[{id:"harbor",slot:0,remaining:1},{id:"harbor",slot:1,remaining:1},
      {id:"liben",slot:2,collected:2},{id:"whiteGlove",slot:3,remaining:2}];
    // Slot04 round4: occupied prefix2 with native counters2/1 after the two
    // one-use Harbors' end-phase departures. Occupancy does not prove names.
    s.supportCounts={known:true,slots:[2,1,null,null].map((counter,index)=>({index,present:counter!==null,counter}))};
    T.noteBoard(m,s);
    assert.equal(m.supportStateKnown,false);
    assert.equal(m.supports.some(x=>x.id==="harbor"),false,"new slot0/1 cannot replenish old Harbor uses");
    assert.equal(T.supportRoom(s),true,"current occupancy still permits a new support");
    s.supportCounts.slots.forEach(x=>{x.present=false;x.counter=null;});
    T.noteBoard(m,s);assert.equal(m.supportStateKnown,true,"an actually empty row has no unidentified supports");
  });
  await test("Lair discount attribution follows each native slot counter, not net dice",()=>{
    const m=memory(),b=board(["crocodileTalent"]),a={type:"card",id:"crocodileTalent",index:0,target:2},
      slots=counts=>({known:true,slots:counts.map((counter,index)=>({index,present:counter!==null,counter}))});
    m.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false},{id:"lair",slot:1,remaining:3,discountUsed:false}];
    b.supportCounts=slots([3,3,null,null]);
    const after={...board(["block"]),confirmed:true,supportCounts:slots([2,3,null,null])};
    T.commit(m,a,b,after);
    assert.equal(m.supports[0].discountUsed,true);assert.equal(m.supports[0].remaining,2);
    assert.equal(m.supports[1].discountUsed,false);assert.equal(m.supports[1].remaining,3);
    const missing=memory();missing.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    T.commit(missing,a,b,{...after,supportCounts:{known:false},dice:{Omni:7}});
    assert.equal(missing.supports[0].discountUsed,null,"net dice cannot attribute a missing native counter");
    assert.equal(missing.supports[0].remaining,null);
    const unknownBefore=memory();unknownBefore.supports=[{id:"lair",slot:0,remaining:3,discountUsed:false}];
    T.commit(unknownBefore,a,{...b,supportCounts:{known:false}},after);
    assert.equal(unknownBefore.supports[0].discountUsed,null,"a current counter alone cannot assign this round's use");
    assert.equal(unknownBefore.supports[0].remaining,2,"the current native count remains a separate fact");
    const alreadyUsed=memory();alreadyUsed.supports=[{id:"lair",slot:0,remaining:2,discountUsed:true}];
    T.commit(alreadyUsed,a,{...b,supportCounts:slots([2,null,null,null])},
      {...after,supportCounts:slots([2,null,null,null])});
    assert.equal(alreadyUsed.supports[0].discountUsed,true,"a second talent with no counter change must not restore the discount");
    const spent=memory();spent.supports=[{id:"lair",slot:0,remaining:1,discountUsed:false}];
    const last={...b,supportCounts:slots([1,null,null,null])};
    T.commit(spent,a,last,{...after,supportCounts:slots([null,null,null,null])});
    assert.equal(spent.supports.length,0,"the last charge's native departure removes that instance");
  });



  await test("native0113 late preceding-skill energy cannot confirm the next unpaid attack",()=>{
    const {before,action:a,after}=clone(require("../../../business/fixtures/player-native-regressions-20261025.json").consecratedLateEnergy);
    assert.equal(a.skill,"NA");assert.equal(T.total(after.dice),T.total(before.dice));
    assert.ok(after.characters[2].energy>before.characters[2].energy);
    assert.equal(T.verify(a,before,after),false,"no dice paid: the old E energy is not this NA's proof");
    const paid={...clone(after),dice:clone(T.payment(before.dice,T.skillCost(2,"NA")).remaining)};
    assert.equal(T.verify(a,before,paid),true,"real payment still confirms a hit with no visible HP difference");
    assert.equal(T.verify(a,before,{...paid,phase:"result",result:"win"}),true);
  });

  function nativeFixture() {
    let time=Date.parse("2026-10-23T12:00:00Z"),scene={phase:"board",turn:"user"},options=[],buttons=[];
    const clicks=[],events=[];
    class Clock extends Date {static now(){return time;}}
    const loaded=loadRules({...nativeInput((...p)=>clicks.push(p)),Date:Clock,sleep:async ms=>{time+=ms;}}),N=loaded.T;
    const host=new loaded.Host({}),m=N.freshMemory({newGame:true});host.memory=m;
    host.trace=(event,data)=>events.push({event,data});
    host.phaseIn=f=>scene.phase==="choice"?host.choiceIn(f):clone(scene);
    host.ocr=(_f,{rect:r})=>r[1]===155?"挑选卡牌 请选择一张卡牌":"";
    host.ocrRows=(_f,{rect:r})=>r[1]===705?options:[];
    host.matches=(_f,asset)=>asset==="core/确定"?buttons:[];
    host.nativeHandCountIn=()=>2;
    return {T:N,host,m,clicks,events,setScene:s=>{scene=s;},setOptions:ids=>{
      options=ids.map((id,i)=>({text:N.byId[id].name,x:500+i*800,y:727,w:120,h:28}));
    },setButtons:b=>{buttons=b;}};
  }
  await test("accepted discovery price replaces its row digit before block discard confirmation and wind bookkeeping",async()=>{
    // Native1.9.3 slot06: countdown2 row OCR5, accepted title frame digit2;
    // a tied Starsign was discarded and Thunder drew another block.
    const {Host}=loadRules(),host=new Host({}),s=board(["block","block","block","emblem","sand","stars","stars","countdown2","revel"],0),m=memory();
    s.dice={Hydro:1,Anemo:1,Electro:1,Dendro:2,Cryo:2,Omni:1};m.talents=[true,true,false];
    const costs=[0,0,0,2,0,2,2,5,2];
    s.hand=s.hand.map((h,i)=>({...h,currentCost:costs[i],attachments:{source:"unknown",reduction:null,increase:null}}));
    const c=clone(s);c.hand=s.hand.filter((_,i)=>i!==5);c.dice.Electro++;c.handRead="full";
    const a={type:"card",id:"block",index:0};assert.equal(T.blockResult(a,s,c,m),false);
    const points=host.handPoints(9);host.handFanReady=true;host.frame=fn=>fn({});
    host.phaseIn=()=>({phase:"board",turn:"user"});host.costHandIn=()=>({costs});
    await host.prepareHandObservation(9);
    host.selectedCardCostIn=()=>2;host.ocrRows=()=>{throw Error("discovery does not scan attachment descriptions");};
    host.readSelectedCardFacts({},T.byId.countdown2,points[7]);
    s.hand=host.finishHandObservation(s.hand);
    assert.equal(s.hand[7].currentCost,2);assert.equal(s.hand[7].costSource,"native-selected-card-cost");
    assert.equal(s.hand[5].currentCost,2);assert.equal(host.feeSample,null);
    a.blockBasis={actionKey:T.actionKey(a),beforeKey:T.boardKey(s),effect:T.blockEffects("play",s,m)};
    c.cardReceipt={inputSent:true,beforeKey:T.boardKey(s),id:a.id,index:a.index,target:null};
    c.confirmed=T.verify(a,s,c);assert.equal(c.confirmed,true);T.commit(m,a,s,c);
    assert.equal(m.blockPlayed,true);assert.equal(m.windRefund,true);
    host.selectedCardCostIn=()=>{throw Error("ordinary input has no observation row to update");};
    host.readSelectedCardFacts({},T.byId.countdown2,points[7]);
  });

  await test("rapid talent input handles backend frozen serpent through the common payment and block result",async()=>{
    const f=nativeFixture(),{T:N,host,m,clicks}=f,b=board(["serpentTalent","harbor","liben","sand","countdown3"],0),
      a={type:"card",id:"serpentTalent",index:0,target:1},banner="装备给我方的圣骸飞蛇",drags=[];
    b.dice={Electro:2,Anemo:1,Dendro:3,Cryo:1,Geo:1};b.characters[1].frozen=true;
    assert.equal(N.nativeCardScope(a,banner,b),true);
    assert.equal(N.nativeCardScope({...a,target:2},banner,b),false);
    assert.equal(N.nativeCardScope(a,"装备给我方的圣骸毒蝎",b),false);
    assert.equal(N.nativeCardScope(a,banner,{...b,characters:b.characters.map((c,i)=>i===1?{...c,dead:true,hp:0}:c)}),false);
    host.requireUnchangedBoard=async()=>{};host.prepareHandInput=async()=>({count:5});
    host.handPoints=()=>[500,700,900,1100,1300];host.inspectHandCard=async()=>{};host.requireNoWarning=async()=>{};
    host.drag=async(...points)=>{drags.push(points);f.setScene({phase:"unknown",turn:"none"});};
    host.ocr=(_f,{rect:r})=>r[1]===510?banner:"";
    host.ocrRows=(_f,{rect:r})=>r[1]===900?[{text:"打出手牌",x:800,y:920,w:300,h:60}]:[];
    await host.executeInput(a,b,m);
    assert.deepEqual(drags,[[500,945,960,720]]);
    assert.equal(host.choiceSession.kind,"payment");assert.equal(clicks.length,0);
    host.confirmationSession={key:N.actionKey(a)+"/"+N.boardKey(b),plan:{action:a,before:b,mode:"full"}};
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    await assert.rejects(host.resolveChoice(b,m),e=>e.code==="TCG_CHOICE_RETRY");
    assert.deepEqual(clicks,[[950,950]],"only the native payment control is submitted once");
    f.setScene({phase:"board",turn:"user"});await host.resolveChoice(b,m);
    const after={...b,hand:hand(["block","harbor","liben","sand","countdown3"]),dice:{Electro:2,Dendro:3,Cryo:1,Geo:1},
      handRead:"full",cardReceipt:clone(host.consumptionReceipt),choiceReceipt:clone(host.choiceReceipt)};
    assert.equal(N.verify(a,b,after),true);assert.equal(m.talents[1],false,"native page exit is not commit");
    assert.equal(N.verify(a,b,{...after,hand:hand(["harbor","liben","sand","countdown3"])}),false,"source removal alone is not entry generation");
    assert.equal(N.verify(a,b,{...after,handRead:"cache"}),false);
    assert.equal(N.verify(a,b,{...after,choiceReceipt:{...after.choiceReceipt,origin:"old-action"}}),false);
    assert.equal(N.verify(a,b,{...after,cardReceipt:{...after.cardReceipt,target:2}}),false);
    N.commit(m,a,b,{...after,confirmed:true});assert.equal(m.talents[1],true);
    assert.deepEqual(clone(m.used),[0,0,0]);assert.equal(after.active,0);
  });
  await test("actual shared pending owner confirms block only from bound submission, full hand and exact dice vector",async()=>{
    const f=nativeFixture(),{T:N,host,m}=f,b=board(["block","countdown3","stars"]),
      a={type:"card",id:"block",index:0,target:null};m.talents[0]=true;
    let submissions=0;
    host.requireUnchangedBoard=async()=>{};
    host.inputHand=async()=>{submissions++;host.consumptionReceipt={inputSent:true,beforeKey:N.boardKey(b),id:a.id,index:a.index,target:null};};
    await host.executeInput(a,b,m);
    const after={...board(["stars","countdown2"]),dice:{Omni:8,Anemo:1},handRead:"full",cardReceipt:clone(host.consumptionReceipt)};
    assert.equal(N.verify(a,b,after),true);
    assert.equal(N.verify(a,b,{...after,dice:{Omni:8,Electro:1}}),false);
    assert.equal(N.verify(a,b,{...after,hand:hand(["countdown3","stars"])}),true,"same-name redraw remains possible");
    assert.equal(N.verify(a,b,{...after,hand:hand(["countdown3","block"])}),false,"known retained Starsign cannot disappear");
    assert.equal(N.verify(a,b,{...after,handRead:"remove"}),false);
    assert.equal(N.verify({...a,blockBasis:{...a.blockBasis,beforeKey:"stale"}},b,after),false);
    host.removalEvidenceBeforeReset=async()=>null;host.observe=async()=>clone(after);
    const confirmed=await host.confirm(a,b,m);
    assert.equal(confirmed.confirmed,true);assert.equal(confirmed.handRefreshRequired,true);
    assert.equal(host.confirmationSession,null);assert.equal(submissions,1);assert.equal(m.blockPlayed,false);
    N.commit(m,a,b,confirmed);assert.equal(m.blockPlayed,true);
  });
  await test("consumed block waits in its submitted owner until delayed native dice arrive, without resubmission",async()=>{
    const {T:N,host,m}=nativeFixture(),b=board(["block","countdown3","sand"],0),a={type:"card",id:"block",index:0,target:null};
    b.dice={};let submitted=0,reads=0;
    host.requireUnchangedBoard=async()=>{};
    host.inputHand=async()=>{submitted++;host.consumptionReceipt={inputSent:true,beforeKey:N.boardKey(b),id:a.id,index:0,target:null};};
    await host.executeInput(a,b,m);host.removalEvidenceBeforeReset=async()=>null;
    host.observe=async()=>({...clone(b),hand:hand(["sand"]),handRead:"full",cardReceipt:clone(host.consumptionReceipt),
      dice:++reads<3?{}:{Electro:1}});
    const after=await host.confirm(a,b,m);
    assert.equal(after.confirmed,true);assert.equal(reads,3);assert.equal(submitted,1);
    N.commit(m,a,b,after);assert.equal(m.blockPlayed,true);assert.equal(host.confirmationSession,null);
  });
  await test("native slot08 Crocodile Q cannot confirm the two blocks that are about to disappear or reuse that failed snapshot",async()=>{
    const {T:N,host,m}=nativeFixture(),b=board(Array(2).fill("block"),2),a={type:"skill",who:2,skill:"Q"};
    b.characters[2].energy=2;let reads=0;
    host.frame=fn=>fn({});host.phase=host.phaseIn=()=>({phase:"board",turn:"user"});
    host.handCountIn=()=>null;host.handFanReady=host.handNeedsReset=false;host.boardReady=true;
    host.readHand=async()=>++reads===1?clone(b.hand):[];
    host.removalEvidenceBeforeReset=async()=>null;
    host.observe=async(_pending,plan)=>({...clone(b),dice:{Omni:5},hand:await host.observedHand(plan),handRead:"full"});
    const after=await host.confirm(a,b,m);
    assert.equal(after.confirmed,true);assert.equal(after.hand.length,0);assert.equal(reads,2);
    assert.equal(host.handCache.length,0);assert.equal(host.confirmationSession,null);
  });

  await test("shared tuning recovery carries confirmation to the actual player commit without resending",async()=>{
    const {T:N,Player,options}=loadRules(),events=[],host={trace:(e,d)=>events.push({e,d}),adoptObservedState(){}};
    const p=new Player(host,options()),b=board(["shift"]),a={type:"tune",id:"shift",index:0,element:"Anemo"};
    b.dice={Electro:2,Pyro:1};const after={...board([]),dice:{Electro:1,Pyro:1,Anemo:1},handRead:"full"};
    host.observe=async()=>after;
    let commits=0;const commit=N.commit;N.commit=(...args)=>{commits++;return commit(...args);};
    await p.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.equal(events.find(x=>x.e==="confirmed").d.after.confirmed,true);
    assert.equal(after.confirmed,undefined,"do not mutate the raw observed state");
    assert.deepEqual(clone(p.readyState.dice),after.dice);
    const refused=new Player(host,options());host.observe=async()=>b;
    await refused.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.equal(N.actionRefused(b,refused.memory,a),true);
    const uncertain=new Player(host,options());host.observe=async()=>({...after,dice:b.dice});
    await uncertain.recoverRejectedInput({code:"TCG_TUNE_UNCONFIRMED"},a,b,{});
    assert.equal(commits,1);assert.ok(events.some(x=>x.e==="action-uncertain"));
  });
}
module.exports=run;
if(require.main===module)(async()=>{
  const pack=packageFiles("consecrated"),files=["src/decks/consecrated/core.js.tmpl","src/decks/consecrated/strategy.js","src/decks/consecrated/bgi.js.tmpl","src/decks/consecrated/player.js.tmpl",...pack.dependencies.map(x=>x.split("#")[0])],
    hashes=Object.fromEntries([...new Set(files)].map(f=>[f,sha(fs.readFileSync(path.join(base,f)))])),results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(e.stack);}});
  for(const [f,hash]of Object.entries(hashes))assert.equal(sha(fs.readFileSync(path.join(base,f))),hash,"Source drift: "+f);
  const report={at:new Date().toISOString(),scope:"standalone production package rules/strategy and actual Host choice/confirmation with controlled observations; no native pixels or game input",
    nativeVerified:false,registered:true,packages:{consecrated:Object.fromEntries([...pack.files].map(([p,b])=>[p,sha(b)]))},sourceHashes:hashes,
    passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  const out=process.env.TCG_TEST_REPORT||path.join(base,"reports/consecrated-development-20261023/rules-test.json");
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:out}));
  if(report.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
