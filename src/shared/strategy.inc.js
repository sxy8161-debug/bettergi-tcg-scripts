// @fragment tcg-strategy.freeSwitchPreparation
function freeSwitchPreparation(s,m,action,switchCost,costOf) {
  if(action.type!=="switch"||T.size(switchCost)===0)return null;
  for(const h of s.hand)if(h.id==="shift"){
    const a={type:"card",id:h.id,index:h.index,target:null},cost=costOf(a);
    if(cost!==null&&T.size(cost)===0&&!T.actionRefused(s,m,a)&&T.cardLegal(s,a,m))
      return a;
  }
  return null;
}
// @endfragment tcg-strategy.freeSwitchPreparation
