"use strict";
const fs=require("node:fs"),path=require("node:path"),registry=require("../players.json");
const publicDecks=Object.entries(registry.players).filter(([,p])=>p.publicSuite===true).map(([id])=>id);
const modules=["iansan-confirmation-review","iansan-projection-review","moon-review","raiden-review","refusal-review","review251","moon-native-followup","geometry","input-confirmation","hand-observation","run-diagnostics","card-atlas","package-layout","registry"];
async function run(test){for(const name of modules)await require("./business/"+name+".cjs")(test);}
if(require.main===module){
  let passed=0,failed=0;
  const test=async(name,fn)=>{try{await fn();passed++;console.log("PASS "+name);}catch(e){failed++;console.error("FAIL "+name+"\n"+e.stack);}};
  run(test)
    .then(async()=>{for(const id of publicDecks)await require("./decks/"+id+"/suite/run.cjs")(test,
      overrides=>require("./business/runtime.cjs").load(id,overrides).env);})
    .then(()=>{console.log(JSON.stringify({passed,failed,scope:"actual-assembled-code-with-scripted-host-not-native-gameplay"}));
      if(failed)process.exitCode=1;else require("./repository-release.cjs");})
    .catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports=run;
module.exports.files=["tests/business.cjs","tests/business/runtime.cjs","tests/shared/harness.cjs",
  ...publicDecks.flatMap(id=>fs.readdirSync(path.join(__dirname,"decks",id,"suite")).filter(n=>n.endsWith(".cjs")).map(n=>"tests/decks/"+id+"/suite/"+n)),
  "tests/business/fixtures/moon-countdown-native-20261017.json","tests/business/fixtures/raiden-folded-markers-1440-20261018.json","tests/business/fixtures/roll-1600-native-20261018.json","tests/business/fixtures/raiden-fast-relay-20261020.json","tests/business/fixtures/player-native-regressions-20261025.json",...modules.map(n=>"tests/business/"+n+".cjs")];
