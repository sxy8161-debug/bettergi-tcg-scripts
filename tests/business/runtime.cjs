"use strict";
const vm = require("node:vm");
const { packageFiles } = require("../../tools/build.cjs");
function loadDefinitions(code,env,filename="main.js") {
  const config=require("../../players.json"),id=process.env.TCG_TEST_DECK||"raiden";
  env.settings={deck:config.players[id].title+"（"+config.players[id].label+"）",...env.settings};
  const entry=code.indexOf("\n// @tcg-entry\n");
  if(entry<0)throw Error("Missing packaged entry boundary: "+filename);
  // Unit fixtures omit only auto-start; the entry smoke test executes the whole file.
  vm.runInContext(code.slice(0,entry),env,{filename});
}
function load(id, overrides = {}) {
  const { files } = packageFiles(id);
  const p=require("../../players.json").players[id],deck=p.title+"（"+p.label+"）";
  const env = vm.createContext({settings:{deck},sleep:async()=>{}, log:{info(){},warn(){},error(){}},
    file:{createDirectory(){},isExists(){return false;},writeTextSync(){return true;}}, ...overrides});
  env.settings={deck,...overrides.settings};
  loadDefinitions(files.get("main.js").toString(),env,id+"/main.js");
  const {Host,Player} = env.TCGHandRecognition.classes(env,
    JSON.parse(files.get("hand-bank.json")).decks[id],JSON.parse(files.get("opening-bank.json")).decks[id]);
  return {env,T:env.TCG,Host,Player};
}
function board(T, ids = []) {
  return {phase:"board",turn:"user",active:0,diceKnown:true,dice:{Omni:3},
    characters:T.team.map(c=>({hp:c.maxHp,energy:0,dead:false,frozen:false})),
    enemies:[{hp:10,dead:false,active:true,auraKnown:false,aura:[]}],
    hand:T.indexedHand(ids.map(id=>({id,name:T.byId[id].name,supported:true})))};
}
module.exports={load,board,loadDefinitions};
