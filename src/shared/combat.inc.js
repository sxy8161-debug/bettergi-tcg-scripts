// Pure combat rules. Callers supply observations or private projections.
// @fragment tcg-rules.elementReaction
function elementReaction(element,aura=[],lunar=false) {
  const pair=(a,b)=>(element===a&&aura.includes(b))||(element===b&&aura.includes(a));
  const result=(name,bonus,consumed,extra={})=>({name,bonus,consumed,...extra});
  if(element==="Anemo"){
    const spread=["Cryo","Hydro","Pyro","Electro"].find(e=>aura.includes(e));
    if(spread)return result("swirl",0,spread,{spread});
  }
  if(pair("Hydro","Cryo"))return result("freeze",1,element==="Hydro"?"Cryo":"Hydro",{freeze:true});
  if(pair("Pyro","Hydro")||pair("Pyro","Cryo"))return result(pair("Pyro","Hydro")?"vaporize":"melt",2,
    element==="Pyro"?(aura.includes("Hydro")?"Hydro":"Cryo"):"Pyro");
  if(pair("Electro","Pyro"))return result("overload",2,element==="Electro"?"Pyro":"Electro",{forceSwitch:true});
  if(pair("Electro","Hydro")||pair("Electro","Cryo")){
    const water=pair("Electro","Hydro");
    return result(water?(lunar?"lunar-charged":"charged"):"superconduct",1,
      element==="Electro"?(water?"Hydro":"Cryo"):"Electro",water&&lunar?{lunar:true,futureUnknown:true}:{piercing:1});
  }
  if(pair("Dendro","Hydro"))return result(lunar?"lunar-bloom":"bloom",1,element==="Dendro"?"Hydro":"Dendro",
    lunar?{lunar:true}:{futureUnknown:true});
  if(pair("Dendro","Pyro")||pair("Dendro","Electro"))return result("dendro",1,
    element==="Dendro"?(aura.includes("Pyro")?"Pyro":"Electro"):"Dendro",{futureUnknown:true});
  return {name:null,bonus:0};
}
// @endfragment tcg-rules.elementReaction

// @fragment tcg-rules.damageAgainst
function damageAgainst(target,amount,element,piercing=false) {
  if(!target)return {direct:amount,shieldSpent:0,guaranteed:null};
  const immune=!piercing&&target.immuneElements?.includes(element),
    shieldSpent=!piercing&&!immune&&known(target.shield)?Math.min(target.shield,amount):0,
    direct=immune?0:Math.max(0,amount-shieldSpent);
  return {direct,shieldSpent,guaranteed:target.defenseKnown===true?direct:null};
}
// @endfragment tcg-rules.damageAgainst

// @fragment tcg-rules.enemyDamageEvidence
function enemyDamageEvidence(before,after) {
  const beforeCount=enemyCount(before),afterCount=enemyCount(after),
    defeats=beforeCount!==null&&afterCount!==null?Math.max(0,beforeCount-afterCount):null;
  const matched=before.enemies.flatMap((e,i)=>{
    const next=e.identity?after.enemies.find(x=>x.identity===e.identity):
      beforeCount!==null&&afterCount!==null&&before.enemies.length===after.enemies.length?after.enemies[i]:null;
    return alive(e)&&next&&(next.dead===true||known(next.hp)&&next.hp<e.hp)?[i]:[];
  });
  return {any:defeats>0||matched.length>0,defeats,matched};
}
// @endfragment tcg-rules.enemyDamageEvidence
