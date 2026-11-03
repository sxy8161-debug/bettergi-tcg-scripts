// @fragment commentary.actionCommentary
const TACTICAL_REASONS={
  "opening-water-before-dry-relay":"先让莫娜挂水，再把扩散或蒸发接上",
  "opening-development-preserves-water":"先发展伙伴和手牌，同时留够莫娜战技的骰子",
  "paid-draw-preserves-last-attack":"把骰子留给这回合的攻击，付费过牌先缓一缓",
  "equipment-loss-insurance":"先铺野猪公主，让接下来的装备替换接上返骰",
  "partner-before-retrieval":"先用迪娜泽黛减费和检索，再接其他伙伴",
  "同一已选装备先兑现可验证的零费减费；全段索引和支付已重算":"先把装备减费铺好，省下的骰子接到后续输出",
  "本回合已无可支付输出，回合末交接保护站场输出位；下轮按真实骰子重算":"这轮输出已经打完，换队友承伤，保留主攻角色下一轮接力",
  "优先兑现已确认交接的输出任务；后续仍按真实牌面重算":"接力已经到位，先兑现这次输出",
  "已选付费切换，先用已知零费换班；确认后重算":"先用换班省下切换骰子，再把出战位交出去",
  "先欢唱过牌并保留已知启动预算，不要求狂欢或装备对提前齐全；抽到什么再重算":"先用欢唱补充手牌，同时留够伊安珊的启动骰子",
  "欢唱后先用现有运筹铺垫，仍保留战技预算；不猜抽牌和狂欢返骰":"欢唱已经铺好，接运筹补牌，继续留住战技的骰子",
  "至少两张实际装备允许狂欢搏上限；只用已知返骰下界保留战技预算，随后转输出":"装备组件已经到手，用狂欢接过牌与返骰，随后转入输出",
  "给当前出战飞蛇快速补能":"先补齐飞蛇的充能，把攻击机会留给爆发",
  "后台亡雷建立抽牌或补齐现有块对":"启动毒蝎的供块与抽牌联动，为飞蛇攒成对能量块",
  "亡风补块并保留后续切换收益":"补齐能量块，同时为后面的切换准备返骰",
  "后台亡水补块并建立打出能量块后的额外治疗":"补齐能量块，并让后续打块接上角鳄治疗",
  "在当前输出预算之外装备飞蛇，保留后续爆发收益":"当前攻击的骰子已经留好，用余下资源给飞蛇增伤",
  "现有块配料理可达到名义血量；料理检索后先重读，不预测新牌":"手里的能量块配上料理增伤，可以争取这一轮补刀",
  "有空间时即时过牌，抽到后重算":"手牌还有空间，先过牌寻找充能和爆发组件",
  "有空间且先付得起倒计时，再按真实新手牌行动":"用倒计时补牌，把空出的手牌位置利用起来",
  "狂欢按全额付款；不预支抽牌后的返骰":"先补充手牌，寻找下一步的进攻资源",
  "空支援位用于后续抽牌；不保证回合末所有抽牌都有空间":"利用空支援位铺过牌，为后续回合接续资源",
  "缺天赋时检索，不猜会抽到哪张":"先检索天赋，把供块与爆发组件补起来",
  "有空位时准备后续清洁牌库收益":"趁支援区还有空位，准备清洁工作给后续攻击增伤",
  "扣除现有立本竞争后，余下不同色骰仍可推进新实例":"余下的不同色骰还能供立本收集，换取后续骰子与手牌",
  "已知料理库存且不占最后关键支援位时检索":"牌库里还有料理，先把爆发增伤检索到手",
  "最高费并列最差结果可接受，过量倍率可换产骰、治疗或抽牌；只正常打出一次块":"拿多余能量块换资源，把骰子、抽牌与治疗接到这一轮进攻",
  "块还没成对，先把拥挤的天赋、增伤和多余过牌换底，寻找启动资源":"能量块还没成对，先换掉拥挤的铺垫牌，寻找启动资源",
  "过量块产骰可补足两次续攻资金，先读缺失的最高费弃牌事实":"准备把多余能量块换成续攻骰子，先看清这次会舍弃哪张牌",
  "已知防御下达到当前血量；同样击倒优先保留续攻资源":"先争取击倒当前目标，同时留出后续进攻的资源",
  "名义伤害达到当前血量；同样击倒优先保留续攻资源":"先争取击倒当前目标，同时留出后续进攻的资源",
  "飞蛇阵亡，转现有辅助技能与陷阱收尾":"飞蛇已经退场，改由毒蝎、角鳄和陷阱接着打",
  "已知最后回合，比较当前可兑现伤害":"已经到了最后一轮，把当前能打出的伤害集中兑现",
  "继续用能承接行动的角色输出；飞蛇受压时交给健康队友接力，准备下一轮爆发":"爆发后继续进攻，让能承接行动的队友补伤害",
  "飞蛇已受压，先兑现强于普通攻击的现有爆发，再补能或交给队友接力":"飞蛇血线已经受压，先打出更强的现有爆发，再安排补能和接力",
  "飞蛇优先少准备地补能；同等操作优先战技伤害与抽牌":"先给飞蛇攒充能，用战技同时补伤害和手牌",
  "现有爆发强于普通攻击，供块中断或满手无法补牌，先开大再补能续攻":"继续等牌的收益已经不高，先把更强的大招打出去，再靠攻击补能续攻",
  "飞蛇已满能但组件不足且无有效发育动作，用可支付战技补伤抽牌后重算":"飞蛇已经满能，先保留大招，用战技补伤害、找齐爆发组件",
  "现有资源可切回飞蛇补能，交棒后重新观察":"现在的资源够飞蛇接着补能，切回去为爆发蓄势",
  "结束前调位先用现有零费换班，不白交切换骰子":"先用手里的换班省骰，再完成这一轮的承伤交接",
  "本轮已无有效输出，结束前换健康队友承伤；本回合只做一次结束调位":"这轮已经没有合适的输出，换健康队友承伤，保住下一轮的进攻",
  "最后一人仍有合法正伤害动作，不因低血评分空过":"只剩最后一名角色，抓住当前机会继续打伤害"
};
function commentaryStep(step){
  if(typeof step!=="string")return step;
  const [type,id,skill,technique]=step.split(":");
  if(type==="skill")return {type,who:Number(id),skill,technique};
  if(type==="switch")return {type,target:Number(id)};
  return {type,id};
}
function commentaryStepLabel(a){
  if(a.type==="skill")return T.team[a.who].name+"的「"+(a.skill==="T"?T.techniques[a.technique].name:T.team[a.who].skills[a.skill])+"」";
  if(a.type==="switch")return "切换"+T.team[a.target].name;
  if(a.type==="end")return "结束回合";
  return (a.type==="tune"?"调和":"使用")+"「"+T.byId[a.id].name+"」";
}
function actionCommentary(a,s,m){
  const planning=a.planning||a.search,parts=[actionDescription(a,s,m)],
    reason=a.intent||TACTICAL_REASONS[a.reason||planning?.reason];
  if(reason)parts.push(reason+"。");
  const objective=planning?.objective;
  if(!reason&&a.type!=="end"&&!planning?.terminal&&!planning?.retreat&&objective){
    if(objective.task==="native-return")parts.push("嘉明的回场追击已经备好，准备接上踏云献瑞。");
    else if(objective.phase==="develop")parts.push("先完成启动与交接，把输出条件铺给"+T.team[objective.carry].name+"。");
    else parts.push("这一轮围绕"+T.team[objective.carry].name+"持续输出，资源优先接到他的出手上。");
  }
  if(!reason&&a.axis&&a.type!=="end"&&!planning?.terminal){
    const direction={burst:"核与充能已经成形，把这轮资源集中到爆发上",fallback:"组件还没齐，先用手里的核与技能续上伤害",reaction:"先把元素反应接起来，为核减费和后续爆发铺垫",
      relay:"把出战位交给哥伦比娅接力，延续当前反应与输出",sustain:"对手血量还多，先稳住循环，用核与技能持续压血",cleanup:"进入补刀阶段，优先兑现当前伤害"}[a.axis];
    parts.push(direction+"。");
  }
  let steps=(planning?.sequence||[]).map(commentaryStep);
  if(!steps.length){
    steps=[a];
    const next=a.followup||(a.funding?.goal?commentaryStep(a.funding.goal):a.plan?.terminal);
    if(next&&T.actionKey(next)!==T.actionKey(a)){
      steps.push(next);
      if(next.followup)steps.push(next.followup);
    }
  }
  if(!planning?.terminal){
    const burst=steps.slice(1).find(step=>step.type==="skill"&&step.skill==="Q");
    if(burst){
      const need=T.team[burst.who].maxEnergy-s.characters[burst.who].energy;
      if(need>0)parts.push(T.team[burst.who].name+"还差"+need+"点充能，先补齐再接大招。");
    }
  }
  const seeds=planning?.ledger?.[0]?.seeds;
  if(seeds&&a.type==="card"&&T.byId[a.id].type==="attachment"){
    const free=seeds.filter(cost=>cost===0).length;
    if(free>0)parts.push("这步之后预计有"+free+"张零费核，把减费接到后续输出。");
  }
  if(a.plan?.followupDamage>0)parts.push("这条路线还留出"+a.plan.remainingDice+"颗骰子，准备继续补伤害。");
  if(steps.length>1)parts.push("接下来准备："+steps.slice(1,4).map(commentaryStepLabel).join(" → ")+"。");
  return parts.join(" ");
}
// @endfragment commentary.actionCommentary
