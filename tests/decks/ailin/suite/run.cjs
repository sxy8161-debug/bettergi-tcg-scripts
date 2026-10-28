"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
async function run(test,loadContext=overrides=>load(root,overrides)){
  const C=loadContext(),T=C.TCG;
  const memory=()=>Object.assign(T.freshMemory(),{round:1});
  const board=(ids=[],active=0)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},
    hand:T.indexedHand(ids.map((id,i)=>T.observedCard(T.byId[id].name,i))),
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:20,dead:false,active:true,aura:[],auraKnown:true,defenseKnown:true,shield:0,immuneElements:[]}]});

  await test("ailin: native four-cost E/Q badges fund skills and tuning, including projected own reductions",()=>{
    // slot10 2026-10-25T05:19:58.214Z: E rejected with three Pyro at
    // seq534; E/Q badges are both4 in the timestamp-matched native image.
    const h=new C.TCGBetterGI.BetterGIHost({}),m=memory(),s=board(["draw","verdantGift","soup"],1);
    m.round=2;m.used=[1,1,0];m.props=3;s.characters[1].hp=3;s.characters[1].energy=2;
    s.enemies=[{hp:4,dead:false,active:true,aura:["Hydro"],auraKnown:true}];
    h.summonSlotsIn=()=>[];h.supportSlotsIn=()=>({known:false});
    const areas=[];h.numericAt=(_f,area)=>{areas.push(clone(area.rect));return "4";};
    h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
    h.characterIn=(_f,i)=>({...s.characters[i],raised:i===s.active});
    h.diceIn=()=>({dice:s.dice});h.diceCountIn=()=>T.total(s.dice);h.enemiesIn=()=>s.enemies;
    Object.assign(s,h.board(true),{hand:s.hand});
    assert.deepEqual(areas,[[1698,1010,36,35],[1780,1010,36,35]]);
    assert.equal(s.skillFees.who,1);assert.equal(s.skillFees.entries.E.n,4);
    s.dice={Pyro:3};
    for(const skill of ["E","Q"]){assert.equal(T.size(T.skillCost(1,skill,m,s)),4);assert.equal(T.skillLegal(s,{who:1,skill},m),false);}
    const a=T.choose(s,m);assert.ok(!(a.type==="skill"&&["E","Q"].includes(a.skill)));
    s.dice={Anemo:1,Electro:1,Dendro:1};
    const poor=T.choose(s,m);assert.ok(!["E","Q"].includes(poor.followup?.skill),"three total dice cannot fund the four-cost skill through tuning");
    s.dice={Pyro:2,Omni:2};assert.equal(T.skillLegal(s,{who:1,skill:"E"},m),true);
    assert.equal(T.skillCost(0,"E",m,{...s,active:0}).n,3,"switch projections cannot borrow another actor's badges");
    const reduced=clone(s);reduced.skillFees.entries.E.reduction=T.skillReduction(1,"E",m,s);
    const next=clone(m);next.foodDiscount[1]=1;
    assert.equal(T.skillCost(1,"E",next,reduced).n,3,"a new own food can reduce the observed four-cost fee");
    assert.equal(T.skillCost(1,"E",next,s).n,4,"an observed fee already includes current discounts; never subtract twice");
    T.recordSkillCost(s,m,{who:1,skill:"E"},5);assert.equal(T.skillCost(1,"E",m,s).n,5);
    T.clearSkillCosts(m);
    const changed=clone(s);changed.skillFees.entries.E.n=3;
    assert.notEqual(T.boardKey(s),T.boardKey(changed));
    assert.equal(h.boardsMatch(s,changed,"execution",{type:"skill",who:1,skill:"E"}),false);
    h.numericAt=()=>"";
    assert.equal(h.boardExtrasIn({},s,1).skillFees.entries.E.n,null,"a missing number remains missing");
  });

  await test("ailin: confirmed charged shot builds props; E consumes props, not native HP",()=>{
    const m=memory(),s=board([],1),a={type:"skill",who:1,skill:"CA"},after={...clone(s),confirmed:true};
    assert.equal(T.damageEstimate(s,m,1,"CA").selfDamage,1);
    T.commit(m,a,s,after);assert.equal(m.props,1);assert.equal(m.catSummon,1);
    assert.equal(after.characters[1].hp,10,"bookkeeping cannot predict native self damage");
    T.commit(m,a,s,after);assert.equal(m.props,2);assert.equal(m.catSummon,2);
    assert.equal(T.damageEstimate(s,m,1,"E").base,5);
    T.commit(m,{type:"skill",who:1,skill:"E"},s,after);assert.equal(m.props,0);
    assert.throws(()=>T.commit(m,a,s,{...after,confirmed:false}),/未确认/);
  });
  await test("ailin: last-card gladiator reduction and persistent dishes reset on the right boundary",()=>{
    const m=memory(),s=board(["gladiator"],1),a={type:"card",id:"gladiator",index:0,target:1},after={...clone(s),hand:[],confirmed:true};
    assert.equal(T.cardLegal(s,a,m),true);T.commit(m,a,s,after);
    after.dice={Pyro:2};assert.equal(T.skillLegal(after,{who:1,skill:"CA"},m),true);
    T.commit(m,{type:"skill",who:1,skill:"CA"},after,{...after,confirmed:true});
    assert.equal(T.skillLegal(after,{who:1,skill:"CA"},m),false);
    m.foodDiscount[1]=1;m.nextDamage[1]=1;m.gildedDamage[1]=2;m.soupDiscount[1]=2;
    T.nextRound(m);assert.equal(m.foodDiscount[1],1);assert.equal(m.nextDamage[1],1);
    assert.equal(m.gildedDamage[1],0);assert.equal(m.soupDiscount[1],0);
    const full=board(["autumnFrost"],1);
    assert.equal(T.cardLegal(full,{type:"card",id:"autumnFrost",index:0,target:1},m),true);
  });


  await test("ailin: new combat/summon/team-food payment scopes use the shared unique central control",async()=>{
    for(const id of ["surf","dragon","wavekissedSands","verdantGift"]){
      const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({});
      h.frame=fn=>fn({});h.warnings=()=>({lack:false,text:""});h.phaseIn=()=>({phase:"unknown",turn:"none"});
      h.ocr=()=>"打出手牌"+T.byId[id].name;
      h.ocrRows=()=>[{text:"打出手牌",x:860,y:920,w:200,h:50}];
      await h.cardConfirm({type:"card",id,index:0,target:null},board([id]));
      assert.deepEqual(inputs,[[960,945]],id);
      h.ocr=()=>"打出手牌"+T.byId.draw.name;
      await assert.rejects(()=>h.cardConfirm({type:"card",id,index:0,target:null},board([id])));
      assert.equal(inputs.length,1,"wrong card scope cannot pay again");
    }
  });
  await test("ailin: last M confirms its real target once and consumes native refund/healing",async()=>{
    const f=require("./native-boundary.cjs")(loadContext);
    await f.p.act();
    assert.equal(f.p.actions,1);assert.equal(f.stage(),1);assert.equal(f.drags.length,1);
    const action=f.events.find(e=>e.event==="decision").data;
    assert.equal(action.id,"blessingM");assert.equal(action.summonIndex,1);
    const after=f.events.find(e=>e.event==="confirmed").data.after;
    assert.equal(after.summonReceipt.exited,true);assert.equal(after.summonReceipt.index,1);
    assert.equal(after.characters[2].hp,10);assert.equal(after.hand.length,0);
    assert.equal(after.dice.Pyro,1);assert.equal(after.dice.Geo,1);
    assert.equal(after.summons.length,1);assert.equal(after.summons[0].name,"厨艺机关·低温冷藏模式");
    assert.equal(f.h.choiceSession,null);
    assert.deepEqual(f.clicks.filter(([x,y])=>y===680||x===960&&y===945),[[1630,680],[960,945]]);
    assert.equal(f.events.filter(e=>e.event==="summon-target-confirmed").length,1);
  });
  await test("ailin: pending M resumes without a second target click; an already selected target is not double-clicked",async()=>{
    for(const options of [{delayMConfirmMs:8000},{initialMSelection:1}]){
      const f=require("./native-boundary.cjs")(loadContext,options);
      await f.p.act();assert.equal(f.p.actions,1);assert.equal(f.stage(),1);
      assert.equal(f.clicks.filter(([,y])=>y===680).length,options.initialMSelection===1?0:1);
      assert.equal(f.events.filter(e=>e.event==="summon-target-confirmed").length,1);
      if(options.delayMConfirmMs)assert.ok(f.events.some(e=>e.event==="choice-deferred"));
      assert.equal(f.drags.length,1);assert.equal(f.h.choiceSession,null);
    }
  });
  await test("ailin: native untunable attachment rejects before dragging, without assuming all generated dishes are untunable",async()=>{
    const c=loadContext(),h=new c.TCGBetterGI.BetterGIHost({}),s=board(["autumnFrost","gambler"]),m=memory(),
      a={type:"tune",id:"autumnFrost",index:0,element:"Cryo"};
    let resets=0,drags=0,reads=0,rows=["附着效果状态","电击","不可调和"];
    h.frame=fn=>fn({});h.reset=async()=>{resets++;};
    h.ocrRows=()=>{reads++;return rows.map(text=>({text}));};
    h.executeInput=async()=>{h.readSelectedCardFacts({},T.byId.autumnFrost);drags++;};
    await assert.rejects(()=>h.execute(a,s,m),e=>e.code==="TCG_INPUT_REJECTED");
    assert.equal(resets,1);assert.equal(drags,0);assert.equal(h.consumptionReceipt,null);
    T.rejectAction(m,a,s);assert.equal(T.actionRefused(s,m,a),true);
    assert.equal(T.actionRefused(s,m,{type:"card",id:a.id,index:0,target:0}),false,"tuning prohibition is not a food-use prohibition");
    h.currentAction={type:"card",id:a.id,index:0,target:0};h.readSelectedCardFacts({},T.byId.autumnFrost);
    assert.equal(reads,1,"ordinary cards do not acquire extra attachment OCR");
    h.currentAction=a;rows=["附着效果状态","电击"];h.readSelectedCardFacts({},T.byId.autumnFrost);
    rows=["不可调和"];h.readSelectedCardFacts({},T.byId.autumnFrost);
    h.currentAction={...a,id:"gambler",index:1};rows=["附着效果状态","不可调和"];
    assert.throws(()=>h.readSelectedCardFacts({},T.byId.gambler),e=>e.code==="TCG_NATIVE_REJECTION");
  });
  await test("ailin: current support-specific edge proves presence without counter or memory; contradictory edges remain unknown",()=>{
    const h=new C.TCGBetterGI.BetterGIHost({});h.numericAt=()=>"";
    h.matches=(_f,asset,area)=>asset==="ailin/support-rim"&&area.rect[0]===412&&area.rect[1]===585?[{x:419,y:620}]:[];
    let native=h.supportSlotsIn({});assert.equal(native.known,true);
    assert.deepEqual(Array.from(native.slots,s=>s.present),[false,true,false,false]);
    h.matches=(_f,asset,area)=>asset==="ailin/support-rim"&&area.rect[0]===412&&area.rect[1]===585?[{x:413,y:620},{x:430,y:620}]:[];
    native=h.supportSlotsIn({});assert.equal(native.known,false);assert.equal(native.slots[1].present,null);
  });

}
module.exports=run;
if(require.main===module)(async()=>{
  const results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(name+": "+e.stack);}},
    root?undefined:overrides=>require("../../../business/runtime.cjs").load("ailin",overrides).env);
  const result={at:new Date().toISOString(),scope:"assembled production rules and scripted native boundary; not native gameplay",passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};
  const report=process.env.TCG_TEST_REPORT||path.resolve(__dirname,"../../../../reports/ailin-development-20261022/targeted.json");
  fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({passed:result.passed,failed:result.failed}));if(result.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
