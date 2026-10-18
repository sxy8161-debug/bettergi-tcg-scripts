"use strict";
const vm = require("node:vm");
const { packageFiles } = require("../../tools/build.cjs");
function load(id, overrides = {}) {
  const { files } = packageFiles(id);
  const env = vm.createContext({sleep:async()=>{}, log:{info(){},warn(){},error(){}},
    file:{createDirectory(){},isExists(){return false;},writeTextSync(){return true;}}, ...overrides});
  for (const name of ["core","strategy","bgi","player","collapsed-hand","opening-hand","hand-recognition"])
    vm.runInContext(files.get("lib/"+name+".js").toString(),env,{filename:id+"/"+name+".js"});
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
module.exports={load,board};
