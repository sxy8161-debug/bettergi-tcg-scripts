"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {load,clone,nativeInput}=require("../../../shared/harness.cjs");
const root=process.env.TCG_TEST_ROOT;
const report=process.env.TCG_TEST_REPORT||path.resolve(__dirname,"../../../../reports/mozailu-latest.json");
async function run(test,loadContext=overrides=>load(root,overrides)) {
const C=loadContext(),T=C.TCG;
const memory=()=>Object.assign(T.freshMemory(),{round:1});
const enemy=(hp=10,active=true,aura=[])=>({hp,active,dead:false,aura,auraKnown:true,shield:0,defenseKnown:true,immuneElements:[]});
const board=(ids=[],active=0)=>({phase:"board",turn:"user",active,diceKnown:true,dice:{Omni:8},
  hand:T.indexedHand(ids.map((id,i)=>T.observedCard(T.byId[id].name,i))),
  characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),enemies:[enemy(30)]});
const card=(s,id,target=null)=>({type:"card",id,index:s.hand.findIndex(h=>h.id===id),target});

  await test("Diluc second and third E discount, third E damage, reset, and four-die Q",()=>{
    const s=board([],2),m=memory();m.talents[2]=true;s.characters[2].energy=3;
    const costs=[],damage=[];
    for(let i=0;i<4;i++) {costs.push(T.size(T.skillCost(2,"E",m,s)));damage.push(T.damageEstimate(s,m,2,"E").base);T.commit(m,{type:"skill",who:2,skill:"E"},s,s);}
    assert.deepEqual(costs,[3,2,2,3]);assert.deepEqual(damage,[3,3,5,3]);
    s.dice={Pyro:3};assert.equal(T.skillLegal(s,{who:2,skill:"Q"},m),false);
    s.dice={Pyro:4};assert.equal(T.skillLegal(s,{who:2,skill:"Q"},m),true);
    T.nextRound(m);assert.equal(m.dilucE,0);assert.equal(T.size(T.skillCost(2,"E",m,s)),3);
  });
  await test("Mona bubble multiplies character hit including vaporize, not swirl splash or future kick",()=>{
    const s=board([],2),m=memory();s.enemies=[enemy(20,true,["Hydro"])];m.bubble=true;m.weaponKinds[2]="wolf";m.weapons[2]=true;
    assert.equal(T.damageEstimate(s,m,2,"Q").direct,22);
    s.enemies=[enemy(10,true,["Hydro"]),enemy(10,false)];
    const e=T.damageEstimate(s,m,1,"E");assert.equal(e.direct,2);assert.equal(e.splash[0].direct,1);assert.equal(e.prepared,2);
    T.commit(m,{type:"skill",who:2,skill:"Q"},s,s);assert.equal(m.bubble,false);assert.equal(m.pyroInfusion,2);
    assert.equal(T.damageEstimate(s,m,2,"NA").element,"Pyro");T.nextRound(m);T.nextRound(m);assert.equal(T.damageEstimate(s,m,2,"NA").element,"Physical");
  });
  await test("Mona fast switch is once per round and not a free switch",()=>{
    const s=board(),m=memory();assert.equal(T.size(T.switchCost(m)),1);
    T.commit(m,{type:"switch",target:1},s,{...s,active:1});assert.equal(m.monaFastUsed,true);
    T.commit(m,{type:"switch",target:0},{...s,active:1},s);assert.equal(m.fastSwitch,false);
    T.nextRound(m);assert.equal(m.monaFastUsed,false);
    m.freeSwitch=true;assert.equal(T.size(T.switchCost(m)),0);
  });


  await test("equipment reducers and capped refunds consume only after confirmed play; Lyre is not discard",()=>{
    const s=board(["gilded","lyre"],1),m=memory();m.garden=true;m.boar=2;m.artifacts[1]=true;m.artifactKinds[1]="troupe";
    const a=card(s,"gilded",1),before=JSON.stringify(m);
    assert.equal(T.size(T.cardCost(a.id,a.target,m)),1);assert.equal(JSON.stringify(m),before);
    assert.deepEqual(clone(T.cardRefund(a,m,s)),{Anemo:2,Omni:1});
    T.commit(m,a,s,{...s,hand:s.hand.slice(1)});assert.equal(m.garden,false);assert.equal(m.boar,1);
    T.commit(m,card(s,"lyre",1),s,s);assert.equal(m.boar,1);assert.equal(m.lyre,1);assert.equal(m.artifactKinds[1],null);
    s.dice={Omni:16};m.garden=true;m.lyre=0;assert.equal(T.total(T.cardRefund(a,m,s)),1);
  });
  await test("Sayu's late kick cannot confirm a new unpaid cast; paid, zero-fee and Gambler casts still confirm",async()=>{
    for(const mode of ["late-kick","paid-zero-damage","gambler-refund","zero-fee"]){
      let time=100000;class Clock extends Date{static now(){return time;}}
      const inputs=[],c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;},
        ...nativeInput((...xy)=>inputs.push(xy))}),t=c.TCG,h=new c.TCGBetterGI.BetterGIHost({}),m=memory(),
        who=["zero-fee","gambler-refund"].includes(mode)?2:1,s=board([],who),a={type:"skill",who,skill:"E"};
      s.dice={Omni:4};s.characters[who].energy=t.team[who].maxEnergy;
      m.weapons[1]=true;m.weaponKinds[1]="wolf";m.artifacts[1]=true;m.artifactKinds[1]="gilded";
      if(mode==="gambler-refund"){
        m.artifacts[2]=true;m.artifactKinds[2]="gambler";m.talents[2]=true;m.dilucE=1;
        s.enemies=[enemy(2),enemy(10,false)];
      }
      if(mode==="zero-fee"){
        m.talents[2]=true;m.dilucE=1;m.artifacts[2]=true;m.artifactKinds[2]="troupe";m.troupe[2]=2;
      }
      const after=clone(s);after.handRead="full";
      if(mode==="late-kick"){
        // Native slot06 12:17:46 -> 12:17:56: old kick/enemy effects, 4 dice -> 4, same energy.
        after.characters[1].hp=7;after.enemies[0].hp-=2;
      }
      if(mode==="paid-zero-damage")after.dice={Omni:1};
      if(mode==="gambler-refund"){after.enemies[0].hp=0;after.enemies[0].dead=true;after.enemies[1].active=true;}
      if(mode==="zero-fee")after.enemies[0].hp-=3;
      h.trace=()=>{};h.memory=m;h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
      h.warnings=()=>({lack:false,text:""});h.requireUnchangedBoard=async()=>s;
      h.phase=()=>h.phaseIn();h.removalEvidenceBeforeReset=async()=>null;
      h.observe=async()=>{h.autoRisk=false;return clone(after);};
      h.diceIn=()=>({dice:clone(after.dice)});h.diceCountIn=()=>t.total(after.dice);
      await h.execute(a,s,m);const submitted=time,result=await h.confirm(a,s,m);
      assert.equal(result.confirmed,mode!=="late-kick",mode);
      assert.equal(inputs.length,2,"confirmation must not resend the skill");
      assert.ok(time-submitted<=1440,"unpaid effects use the existing resync, not a new wait loop");
      if(result.confirmed)t.commit(m,a,s,result);else t.deferUncertain(m,a,s);
      assert.equal(m.used[who],mode==="late-kick"?0:1,mode);
    }
  });
  await test("last Shift confirms actual empty fan; missing count alone or a stale receipt cannot prove zero",async()=>{
    let time=100000;class Clock extends Date{static now(){return time;}}
    const c=loadContext({Date:Clock,sleep:async ms=>{time+=ms;},...nativeInput((x,y)=>{
      assert.ok(x===967&&y===1041||x===1190&&y===545,"confirmation must not resubmit the action");
    })}),t=c.TCG;
    const h=new c.TCGBetterGI.BetterGIHost({}),s=board(["shift"],2),a=card(s,"shift"),m=memory();
    h.trace=()=>{};h.frame=fn=>fn({});h.phaseIn=()=>({phase:"board",turn:"user"});
    h.board=()=>({...clone(s),hand:null});h.boardReady=true;h.expectedDice=t.total(s.dice);
    h.handCountIn=()=>null;h.phase=()=>h.phaseIn();
    h.matches=()=>[];h.ocr=()=>"";h.ocrRows=()=>[];
    h.readHand=async()=>{throw Error("unnecessary full hand scan");};
    const receipt={inputSent:true,id:a.id,index:a.index,target:null,beforeKey:t.boardKey(s)};
    const proof={...receipt,kind:"native-empty-fan",sourceCount:1,stableReads:2};
    const after={...clone(s),hand:null,handEvidence:proof};
    assert.equal(t.emptyHandEffect(a,s,{...after,handEvidence:null}),false);
    assert.equal(t.emptyHandEffect(a,s,after),true);
    for(const patch of [{stableReads:1},{inputSent:false},{beforeKey:"stale"},{sourceCount:2},{id:"boar"},{index:1},{target:0}])
      assert.equal(t.emptyHandEffect(a,s,{...after,handEvidence:{...proof,...patch}}),false);
    assert.equal(t.emptyHandEffect(a,s,{...after,hand:s.hand}),false);
    assert.equal(t.emptyHandEffect(a,s,{...after,turn:"enemy"}),false);
    const countdown=board(["countdown3"]),tune={type:"tune",id:"countdown3",index:0,element:"Hydro"};
    assert.equal(t.emptyHandEffect(tune,countdown,{...countdown,hand:null,dice:{Omni:7,Hydro:1}}),false,
      "tuning can evolve Countdown; a dice change alone is not evidence of an empty hand");
    h.consumptionReceipt=receipt;
    const result=await h.confirm(a,s,m);
    assert.equal(result.confirmed,true);assert.equal(result.hand.length,0);assert.equal(h.consumptionReceipt,null);
    t.commit(m,a,s,result);assert.equal(m.freeSwitch,true);
  });



  await test("both talent payment pages confirm once, never send a separate skill",async()=>{
    for(const [id,who]of [["flowingFlame",2],["skivingNewAndImproved",1]]) {
      const inputs=[],c=loadContext({...nativeInput((...xy)=>inputs.push(xy))}),h=new c.TCGBetterGI.BetterGIHost({});
      h.trace=()=>{};h.frame=fn=>fn({});h.warnings=()=>({lack:false,text:""});h.phaseIn=()=>({phase:"unknown",turn:"none"});
      h.ocr=()=>"装备给出战中的"+T.team[who].name;h.ocrRows=()=>[{text:"打出手牌",x:860,y:920,w:200,h:50}];
      await h.cardConfirm({type:"card",id,index:0,target:who},board([id],who));assert.deepEqual(inputs,[[960,945]]);
    }
  });
}
module.exports=run;
if(require.main===module)(async()=>{
  if(!root)throw Error("Set TCG_TEST_ROOT to a staged package, or run npm test");
  const results=[];
  await run(async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});console.error(name+": "+e.stack);}});
  const out={at:new Date().toISOString(),passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
    scope:"production rules and synthetic host; no native duel",results};
  fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify({passed:out.passed,failed:out.failed}));if(out.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
