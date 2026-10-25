"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),B=require("../../tools/build.cjs");
module.exports=async function(test){
  await test("registered players cover builds, declared runtime suites and trusted publication verifier",()=>{
    const config=B.config.players,ids=Object.keys(config).sort();
    assert.deepEqual(Object.keys(B.scriptFolders).sort(),ids);
    for(const id of ids){
      const p=config[id];assert.equal(B.scriptFolders[id],p.packageId);
      for(const name of ["core.js.tmpl","bgi.js.tmpl","player.js.tmpl","strategy.js"])
        assert(fs.existsSync(path.join(B.base,"src/decks",id,name)),id+"/"+name);
      // The local registry declares all full runners. Public source keeps only
      // publicSuite's deck-specific suites; the other adapters still have the
      // exported shared/business checks, not a promised full local suite.
      if(p.testRunner||p.publicSuite===true)
        assert(fs.existsSync(path.join(B.base,"tests/decks",id,"suite",p.testRunner||"run.cjs")),id+" declared test runner");
      if(p.installed)assert.equal(path.basename(p.installed),p.packageId,id+" installation folder");
    }
    const yaml=fs.readFileSync(path.join(B.base,"distribution/release-publish.yml"),"utf8"),
      match=/const players = (\{[^;]+\});/.exec(yaml);
    assert(match,"trusted no-code artifact verifier has no player allowlist");
    const publication=JSON.parse(JSON.stringify(vm.runInNewContext("("+match[1]+")")));
    assert.deepEqual(publication,B.scriptFolders,"trusted verifier omitted/added a registered package");
    // This is the exact test-file list consumed by sourceFiles(). Re-running
    // the local-only exporter from its own public output would require local
    // workflow inputs that are deliberately not part of that output.
    const exported=require("../business.cjs").files;
    for(const [id,p]of Object.entries(config))if(p.publicSuite)
      assert(exported.includes("tests/decks/"+id+"/suite/run.cjs"),id+" public suite is absent from export list");
    for(const rel of exported)assert(fs.existsSync(path.join(B.base,rel)),"Missing declared test export: "+rel);
    const release=require("../../tools/build-release.cjs").releaseFiles({sourceCommit:"a".repeat(40),sourceDate:"2026-10-22T00:00:00Z"});
    assert.deepEqual(Object.keys(release.manifest.playerVersions).sort(),ids);
    assert.deepEqual(release.index.indexes[0].children.map(n=>n.name).sort(),Object.values(B.scriptFolders).sort());
  });
};
