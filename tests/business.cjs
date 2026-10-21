"use strict";
const modules=["iansan-confirmation-review","iansan-projection-review","moon-review","raiden-review","refusal-review","review251","moon-native-followup","geometry","input-confirmation","hand-observation","run-diagnostics","card-atlas","package-layout"];
async function run(test){for(const name of modules)await require("./business/"+name+".cjs")(test);}
if(require.main===module){
  let passed=0,failed=0;
  const test=async(name,fn)=>{try{await fn();passed++;console.log("PASS "+name);}catch(e){failed++;console.error("FAIL "+name+"\n"+e.stack);}};
  run(test)
    // Public CI reuses the new deck's actual suite; local full regression runs
    // it once against the staged bytes through its registered deck runner.
    .then(()=>require("./decks/mozailu/suite/run.cjs")(test,overrides=>require("./business/runtime.cjs").load("mozailu",overrides).env))
    .then(()=>{console.log(JSON.stringify({passed,failed,scope:"actual-assembled-code-with-scripted-host-not-native-gameplay"}));
      if(failed)process.exitCode=1;else require("./repository-release.cjs");})
    .catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports=run;
module.exports.files=["tests/business.cjs","tests/business/runtime.cjs","tests/shared/harness.cjs","tests/decks/mozailu/suite/run.cjs","tests/business/fixtures/moon-countdown-native-20261017.json","tests/business/fixtures/raiden-folded-markers-1440-20261018.json","tests/business/fixtures/roll-1600-native-20261018.json","tests/business/fixtures/raiden-fast-relay-20261020.json",...modules.map(n=>"tests/business/"+n+".cjs")];
