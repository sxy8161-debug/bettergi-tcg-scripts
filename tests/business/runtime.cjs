"use strict";
const vm = require("node:vm");
const { packageFiles } = require("../../tools/build.cjs");
function loadDefinitions(code,env,filename="main.js") {
  const entry=code.indexOf("\n// @tcg-entry\n");
  if(entry<0)throw Error("Missing packaged entry boundary: "+filename);
  // Unit fixtures omit only auto-start; the entry smoke test executes the whole file.
  vm.runInContext(code.slice(0,entry),env,{filename});
}
function load(id, overrides = {}) {
  const { files } = packageFiles(id);
  const env = vm.createContext({sleep:async()=>{}, log:{info(){},warn(){},error(){}},
    file:{createDirectory(){},isExists(){return false;},writeTextSync(){return true;}}, ...overrides});
  loadDefinitions(files.get("main.js").toString(),env,id+"/main.js");
  const {Host,Player} = env.TCGHandRecognition.classes(env,
    JSON.parse(files.get("hand-bank.json")),JSON.parse(files.get("opening-bank.json")));
  return {env,T:env.TCG,Host,Player};
}
function board(T, ids = []) {
  return {phase:"board",turn:"user",active:0,diceKnown:true,dice:{Omni:3},
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:10,dead:false,active:true,auraKnown:false,aura:[]}],
    hand:T.indexedHand(ids.map(id=>({id,name:T.byId[id].name,supported:true})))};
}
module.exports={load,board,loadDefinitions};
