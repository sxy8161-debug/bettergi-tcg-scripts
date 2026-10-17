/* Bounded look-ahead, not an opponent simulator. All branches are estimates.
 * Replan after every actual action; random draws / choices terminate a branch. */
(function (root) {
  "use strict";
  const T = root.TCG,
    copy = (x) => JSON.parse(JSON.stringify(x));
  /* @include src/shared/strategy.inc.js#tcg-strategy.freeSwitchPreparation */
  const enemy = (s) => (s.enemies || []).find((e) => T.alive(e) && e.active === true);
  const SEARCH_LIMITS = Object.freeze({
    depth: 5,
    width: 14,
    nodes: 1800,
    equipment: 450,
    funding: 450,
    boundary: 120,
  });
  const INPUT_EFFORT = Object.freeze({ end: 0, card: 0.1, tune: 0.08, switch: 0.12, skill: 0.035 });
  // Compare combat resolutions, not input depth. Sayu E occupies two slots
  // (initial hit + prepared hit); fast equipment/tuning occupies none.
  const PAYOFF_WINDOW = 3;
  // The played card leaves the hand before two draws enter (maximum ten).
  const drawBenefit = (count) => 0.325 * Math.max(0, Math.min(2, 11 - count));
  const openingDrawLimit = (m) => m.singCharges > 0 ? 3 : 2;

  function uniqueGoals(goals) {
    const seen = new Set();
    return goals.filter((goal) => {
      if (!goal || goal.who === undefined) return false;
      const key = goal.who + ":" + goal.skill;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function route(s, m) {
    const n = T.enemyCount(s),
      ids = s.hand.map((h) => h.id);
    if (n !== null && n <= 2 && T.alive(s.characters[1])) return "伊嘉轴";
    if (m.weaponKinds[2] === "wolf" || (ids.includes("wolf") && T.alive(s.characters[2])))
      return "狼末轴";
    if (m.weaponKinds[0] === "moon" || (ids.includes("moon") && T.alive(s.characters[0])))
      return "伊早轴";
    if (ids.includes("sing") && !m.food.some(Boolean)) return "欢唱轴";
    return "接力轴";
  }
  function outputRole(s, m) {
    // Enemy count is an opening prior, not a reason to abandon a funded
    // equipped incumbent or ignore an already-earned native return.
    if(m.gamingReturn&&T.alive(s.characters[1])&&!s.characters[1].frozen&&
      T.payment(s.dice,T.switchCost(m),"Pyro"))return 1;
    if([1,2].includes(s.active)&&!s.characters[s.active].frozen&&
      (m.weapons[s.active]||s.active===2&&m.talent||s.characters[s.active].energy===T.team[s.active].maxEnergy)&&
      ["E","Q","NA"].some(skill=>T.skillLegal(s,{who:s.active,skill},m)))return s.active;
    const n = T.enemyCount(s);
    if (n !== null && n <= 2 && T.alive(s.characters[1]) && !s.characters[1].frozen) return 1;
    if (T.alive(s.characters[2]) && !s.characters[2].frozen) return 2;
    if (T.alive(s.characters[1]) && !s.characters[1].frozen) return 1;
    return 0;
  }
  function battleObjective(s, m) {
    const carry = outputRole(s, m), target = enemy(s), support = s.characters[0];
    // The five openings develop into the same role contract. A weapon drawn
    // after the handoff is not permission to restart the opening from scratch.
    const phase = m.used[1] + m.used[2] > 0 ? "output" : "develop";
    const supportReady = T.alive(support) && !support.frozen;
    return {
      phase,
      carry,
      developSupport: supportReady && !m.iansanBurst &&
        (phase === "develop" || carry === 0 || support.energy === 2 || supportDevelopmentReachable(s, m)),
      refreshAura: supportReady && target?.auraKnown === true && target.aura.length === 0,
      task: s.active !== 1 && m.gamingReturn ? "native-return" :
        phase === "develop" ? "setup-and-handoff" : "sustain-output",
    };
  }
  function openingCharacter(enemies, m) {
    // The guide's ordinary default is Iansan E -> fast Sayu relay. An
    // independently observed existing swirlable aura can make the setup
    // unnecessary; choose Sayu for FREE here, not after the paid-action start.
    const target = (enemies || []).find((e) => T.alive(e) && e.active === true);
    const count = T.enemyCount({ enemies });
    if (
      !(m.openingIds || []).includes("moon") &&
      count !== null &&
      count >= 3 &&
      target?.auraKnown === true &&
      ["Cryo", "Hydro", "Pyro", "Electro"].some((e) => target.aura?.includes(e))
    )
      return {
        target: 2,
        reason:
          "敌方开场已有正匹配的可扩散附着且未保留贯月矢，直接早柚首发，省去无行动伊安珊的付费切换",
      };
    return {
      target: 0,
      reason: (m.openingIds || []).includes("moon")
        ? "保留贯月矢，伊安珊先行动蓄爆"
        : "没有已确认的直接扩散开场，按攻略伊安珊首发挂元素再接力",
    };
  }
  function intent(s, m) {
    const a = s.active,
      c = s.characters[a],
      objective = battleObjective(s, m),
      carry = objective.carry;
    // Start with confirmed Electro application. Afterwards a charged support
    // can burst, but low HP is not a mandate to tank three actions.
    if (T.alive(s.characters[0]) && !s.characters[0].frozen) {
      if (m.used[0] === 0 && !(m.openingTarget === 2 && m.round === 1))
        return { type: "skill", who: 0, skill: "E" };
      if (
        objective.developSupport &&
        s.characters[0].hp >= 5 &&
        (m.weaponKinds[0] === "moon" || s.characters[0].energy === 2)
      )
        return { type: "skill", who: 0, skill: s.characters[0].energy === 2 ? "Q" : "E" };
      if (
        carry !== 0 &&
        objective.refreshAura &&
        m.round > 1 &&
        s.characters[0].hp >= 4
      )
        return {
          type: "skill",
          who: 0,
          skill: s.characters[0].energy === 2 && !m.iansanBurst ? "Q" : "E",
        };
    }
    if (a === 1 && m.gamingReturn && !c.frozen)
      return { type: "wait", reason: "等嘉明原生踏云献瑞结算" };
    return {
      type: "skill",
      who: carry,
      skill:
        carry === 1 && s.characters[1].energy === 3 && m.manchai === 0
          ? "Q"
          : carry === 2 &&
              s.characters.some((x) => T.alive(x) && x.hp <= 4) &&
              s.characters[2].energy === 2 &&
              m.sayuSummon === 0
            ? "Q"
            : "E",
    };
  }
/* @include src/decks/iansan/strategy/evaluation.inc.js */
/* @include src/decks/iansan/strategy/simulation.inc.js */
/* @include src/decks/iansan/strategy/search.inc.js */
  function choose(s, m) {
    return T.projectionBudget.run(SEARCH_LIMITS.nodes, () => chooseAction(s, m));
  }
  function chooseAction(s, m) {
    if (!T.legalState(s))
      return { type: "stop", reason: "行动页的回合、手牌、血量、状态或充能未读清" };
    // An unresolved action invalidates only its own discounts. Read a native
    // quote once per skill/round instead of treating an unknown cut as zero or
    // repeatedly opening the same preview. A failed read leaves the safe,
    // undiscounted cost bound in place; it never authorizes a cast.
    const who=s.active;
    if(!s.characters[who].frozen)for(const skill of ["E","Q"]){
      const unknown=m.soupDiscount[who]===null || skill==="E"&&
        (m.moonRound[who]===null||m.troupe[who]===null||who===1&&m.manchai===null),
        key="uncertain-fee/"+m.round+"/"+who+"/"+skill;
      if(unknown&&!m.probeKeys.includes(key)&&T.total(s.dice)>0&&
        (skill!=="Q"||s.characters[who].energy>=T.team[who].maxEnergy))
        return {type:"probe",who,skill,key,reason:"未决动作后局部核实当前技能费用，不提交技能"};
    }
    m.route = route(s, m);
    if (m.relayTask && !pendingRelay(s, m)) m.relayTask = null;
    const direct = terminalFinisher(s, m);
    if (direct)
      return {
        ...direct.action,
        route: m.route,
        reason: "优先现成合法技能收尾，无此技能再考虑原生返场；原生结算后复核",
        search: { nodes: 0, value: 0, terminal: true, sequence: [direct.action] },
      };
    const opening = singOpening(s, m);
    if (opening) return opening;
    // The failed direct check above is still valid: opening only projects
    // clones, and neither the observed board nor confirmed memory changed.
    const p = searchPlan(s, m, {}, true),
      setup = p.terminal ? null : discountPreparation(s, m, p.action),
      prepared = setup ? replaySequence(s, m, [setup, ...p.sequence]) : null,
      sequence = prepared ? prepared.path : p.sequence,
      a = sequence[0] || p.action;
    const preparation=!p.terminal&&freeSwitchPreparation(s,m,a,T.switchCost(m),x=>T.cardCost(x.id,x.target,m,s));
    if(preparation)return {...preparation,route:m.route,
      reason:"已选付费切换，先用已知零费换班；确认后重算",
      search:{nodes:p.expanded,value:p.value,terminal:false,sequence:[preparation]}};
    const endCover = a.type === "switch" && endCoverTargets(s, m).includes(a.target),
      retreat = a.type === "switch" && (retreatNeeded(s, m, a.target) || endCover),
      objective = battleObjective(s, m),
      followup = a.type === "switch" ? sequence.slice(1).find((x) =>
        x.type === "skill" || x.type === "switch" || (x.type === "card" && x.id === "skivingNewAndImproved")) : null,
      // Retreat can also hand off a funded skill. Keep that realised intention,
      // but do not invent one for bare cover or a branch ending in random draws.
      relayTask = a.type === "switch" && !(a.target === 1 && m.gamingReturn) &&
        ((followup?.type === "skill" && followup.who === a.target) ||
          (followup?.id === "skivingNewAndImproved" && a.target === 2))
        ? { target: a.target, origin: s.active, round: m.round,
            allowNA: !activeOutputReachable(s, m),
            goal: followup.skill || "E" }
        : null;
    if (a.type === "tune") {
      const next = sequence.find((x) => x.type === "skill" || x.type === "switch" ||
        (x.type === "card" && x.id === "skivingNewAndImproved"));
      if (next?.type === "skill" && next.who === s.active) a.goal = next.skill;
      if (next?.id === "skivingNewAndImproved" && s.active === 2) a.goal = "E";
    }
    return {
      ...a,
      route: m.route,
      reason: p.budgetExhausted ? "搜索额度已用尽，保留当前可支付技能；确认后重算" : prepared
        ? "同一已选装备先兑现可验证的零费减费；全段索引和支付已重算"
        : endCover ? "本回合已无可支付输出，回合末交接保护站场输出位；下轮按真实骰子重算"
          : m.relayTask ? "优先兑现已确认交接的输出任务；后续仍按真实牌面重算"
          : "按展开、交接、持续输出目标规划；伤害与承伤风险为估计",
      search: { nodes: p.expanded, value: p.value, terminal: !!p.terminal, sequence,
        payoffWindow: p.window || PAYOFF_WINDOW,
        ...(p.boundaryPayoff ? { boundaryPayoff: p.boundaryPayoff } : {}),
        objective, ...(relayTask ? { relayTask } : {}),
        ...(retreat ? { retreat: true, pressureEstimate: pressureEstimate(m) } : {}) },
    };
  }
  function pendingRelay(s, m) {
    const task = m.relayTask;
    if (!task || task.round !== m.round || s.active !== task.target ||
        !T.alive(s.characters[task.target]) || s.characters[task.target].frozen ||
        coverTargets(s, m).some((target) => retreatNeeded(s, m, target))) return null;
    // Keep a role's promised payoff through gear/tuning and ordinary HP
    // changes, but release it when no funded task remains. Never lock a queue.
    const funded = ["E", "Q"].some((skill) =>
      followupReachable(s, m, { who: task.target, skill }));
    let usefulNA = false;
    if (!funded && followupReachable(s, m, { who: task.target, skill: "NA" })) {
      const d = damageEstimate(s, m, task.target, "NA"),
        hit = T.skillLegal(s, { who: task.target, skill: "NA" }, m)
          ? simulate(s, m, { type: "skill", who: task.target, skill: "NA" }) : null;
      usefulNA = task.allowNA || d.weapon + d.buff + d.soup > 0 ||
        (enemy(s) && d.direct >= enemy(s).hp) ||
        (hit && !hit.leaf && followupReachable(hit.state, hit.memory,
          { who: task.target, skill: "Q" }));
    }
    if (!funded && !usefulNA) return null;
    return { ...task, cover: false };
  }
  function advanceBattleTask(m, a, before, after) {
    if (a.type === "switch") {
      m.relayTask = a.search?.relayTask && after?.active === a.target
        ? { ...a.search.relayTask } : null;
      return;
    }
    const task = m.relayTask;
    if (!task) return;
    const who = a.type === "skill" ? a.who : a.type === "card" && a.id === "skivingNewAndImproved" ? 2 : null;
    const d = who === task.target ? damageEstimate(before, m, who, a.skill || "E") : null;
    if (a.type === "end" || after?.active !== task.target ||
        (d && (a.skill !== "NA" || task.allowNA || d.weapon + d.buff + d.soup > 0 ||
          T.enemyCount(after) < T.enemyCount(before)))) m.relayTask = null;
  }
  function replacement(s, m) {
    if (
      !Array.isArray(s?.characters) ||
      s.characters.length !== 3 ||
      s.characters.some((c) => c.dead !== true && !T.alive(c))
    )
      return null;
    const options = [];
    for (let who = 0; who < 3; who++)
      if (T.alive(s.characters[who])) {
        const c = s.characters[who],
          local = {
            ...s,
            phase: "board",
            turn: "user",
            active: who,
            hand: [],
            diceKnown: true,
            dice: s.dice || {},
          };
        const ready = ["Q", "E", "NA"].some((skill) => T.skillLegal(local, { who, skill }, m));
        options.push({
          who,
          score:
            (c.frozen ? -50 : 20) +
            c.hp +
            (ready ? 12 : 0) +
            (who === outputRole(local, m) ? 6 : 0) +
            (who === 1 && m.gamingReturn ? 5 : 0),
        });
      }
    options.sort((a, b) => b.score - a.score);
    return options[0] ? { who: options[0].who } : null;
  }
  function soupChoice(options, s, target, m = T.freshMemory()) {
    const c = s?.characters?.[target],
      rank =
        c?.hp <= 4
          ? { healing: 100, shield: 90, soothing: 85, discount: 75, fury: 50, maxhp: 40 }
          : {
              discount: 100,
              fury: 85,
              healing: c?.hp <= 8 ? 75 : 10,
              soothing: 65,
              shield: 55,
              maxhp: 30,
            };
    if (!soupDiscountReachable(s, m, target)) rank.discount = -1;
    if (c && c.hp >= T.effectiveMaxHp(m, target)) rank.healing = 0;
    return options.slice().sort((a, b) => (rank[b.effect] || 0) - (rank[a.effect] || 0))[0] || null;
  }
  Object.assign(T, {
    route,
    intent,
    outputRole,
    battleObjective,
    supportDevelopmentReachable,
    pendingRelay,
    advanceBattleTask,
    pressureEstimate,
    exposureRisk,
    preparedReliability,
    summonBenefit,
    summonValue,
    effectValue,
    outputProtectionValue,
    roundBoundaryRisk,
    endCoverTargets,
    retreatNeeded,
    openingCharacter,
    followupReachable,
    tuningPlan,
    burnableHand,
    damageEstimate,
    actionCost,
    equipmentWanted,
    setupEquipmentReachable,
    enumerate,
    simulate,
    plan,
    choose,
    replacement,
    soupChoice,
    reaction,
    applyDamage,
    passiveHealing,
    soupDiscountReachable,
    discountPreparation,
    replaySequence,
    singOpening,
    terminalFinisher,
    actionRerollGoal: (s, m) => ({ ...intent(s, m), element: T.team[s.active].element }),
    switchPreparationReachable: followupReachable,
  });
})(globalThis);
