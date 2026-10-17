  function terminalFinisher(s, m) {
    if (!T.legalState(s) || !(T.enemyCount(s) > 0)) return null;
    if (!s.enemies.filter(T.alive).every(e => e.defenseKnown === true && e.auraKnown === true)) return null;
    // Only currently legal immediate damage, including the native return
    // after a paid/fast Gaming switch. Prepared/end-phase estimates cannot
    // prove a terminal state; simulate never applies those delayed hits.
    const order = (a) => (a.type === "skill" ? ["NA", "E", "Q"].indexOf(a.skill) : 3);
    const candidates = enumerate(s, m).filter(
        (a) => a.type === "skill" || (a.type === "switch" && a.target === 1 && m.gamingReturn),
      ).sort((a, b) => order(a) - order(b));
    // All manual skill projections are combat; there is only one Gaming
    // return candidate. This is the same active NA/E/Q-before-return order
    // as sorting successful hits, without calculating lower-priority hits.
    for (const a of candidates) {
      const p = simulate(s, m, a);
      if (p && T.enemyCount(p.state) === 0) return { action: a, projection: p };
    }
    return null;
  }
  function evaluation(s, m, exposures) {
    // Exposure is charged at the combat opportunity in simulate, not again
    // as an endpoint rebate for switching to a healthy role.
    let value = T.total(s.dice) * 0.18;
    for (let i = 0; i < 3; i++)
      if (T.alive(s.characters[i])) value += s.characters[i].energy * 0.18;
    if (m.garden) value += 0.05;
    if (m.lyre) value += 0.05;
    return value + effectValue(s, m, exposures);
  }
  function fundedSkill(s, m, g, step) {
    if (
      !g ||
      !["E", "Q", "NA"].includes(g.skill) ||
      !T.alive(s.characters[g.who]) ||
      s.characters[g.who].frozen ||
      m.uncertainActions.includes(T.actionKey({ type: "skill", ...g })) ||
      (g.skill === "Q" && s.characters[g.who].energy < T.team[g.who].maxEnergy)
    )
      return null;
    let local = copy(s),
      mem = copy(m),
      path = [],
      parts = [];
    const apply = (a) => {
      const p = step(local, mem, a);
      if (!p) return null;
      path.push(a);
      parts.push(p);
      local = p.state;
      mem = p.memory;
      return p;
    };
    if (g.who !== local.active) {
      const a = { type: "switch", target: g.who };
      if (
        mem.uncertainActions.includes(T.actionKey(a)) ||
        !T.payment(local.dice, T.switchCost(mem))
      )
        return null;
      const p = apply(a);
      if (!p) return null;
      if (p.leaf) return { path, parts, state: local, memory: mem }; // Gaming's native plunge is already a payoff.
    }
    for (let i = 0; i < 3 && !T.skillLegal(local, g, mem); i++) {
      const funding = tuningPlan(local, mem, g);
      if (!funding) return null;
      if (
        !apply({
          type: "tune",
          id: funding.card.id,
          index: funding.card.index,
          element: T.team[g.who].element,
          goal: g.skill,
        })
      )
        return null;
    }
    if (!T.skillLegal(local, g, mem) || !apply({ type: "skill", who: g.who, skill: g.skill }))
      return null;
    return { path, parts, state: local, memory: mem };
  }
  function supportDevelopmentReachable(s, m) {
    const skills = s.characters[0].energy === 1 ? ["E", "Q"] : ["E", "NA", "Q"],
      exposures = skills.length + (s.active !== 0 && !m.fastSwitch ? 1 : 0);
    if (s.characters[0].hp <= pressureEstimate(m) * exposures) return false;
    const variants = [null], moon = s.hand.find((h) => h.id === "moon");
    if (moon && !m.weapons[0]) variants.push({ type: "card", id: "moon", index: moon.index, target: 0 });
    // A late investment may still be good, but must reach the actual burst
    // with existing resources and withstand the whole relay/E(A)Q chain.
    // This small certificate cannot borrow a next-round die or unknown draw.
    for (const gear of variants) {
      let local = s, mem = m;
      if (gear) {
        if (!T.cardLegal(local, gear, mem) || mem.uncertainActions.includes("card:moon")) continue;
        const p = simulate(local, mem, gear);
        if (!p) continue;
        local = p.state; mem = p.memory;
      }
      let complete = true;
      for (const skill of skills) {
        const p = fundedSkill(local, mem, { who: 0, skill }, simulate);
        if (!p || (p.parts[p.parts.length - 1].leaf && skill !== "Q")) { complete = false; break; }
        local = p.state; mem = p.memory;
      }
      if (complete && mem.iansanBurst) return true;
    }
    return false;
  }
  function discountPreparation(s, m, a) {
    if (a.type !== "card" || !["weapon", "artifact"].includes(T.byId[a.id]?.type)) return null;
    const original = T.size(T.cardCost(a.id, a.target, m, s));
    for (const id of ["garden", "house"]) {
      const h = s.hand.find((x) => x.id === id);
      if (!h || m.uncertainActions.includes("card:" + id)) continue;
      const setup = { type: "card", id, index: h.index, target: null };
      if (
        !T.cardLegal(s, setup, m) ||
        (id === "garden" && m.garden) ||
        (id === "house" && m.houses.length >= 2)
      )
        continue;
      const p = simulate(s, m, setup);
      if (!p) continue;
      const lowered = T.size(T.cardCost(a.id, a.target, p.memory, p.state));
      if (
        lowered < original &&
        T.cardLegal(
          p.state,
          { ...a, index: p.state.hand.findIndex((x) => x.id === a.id) },
          p.memory,
        )
      )
        return setup;
    }
    return null;
  }
  function replaySequence(s, m, sequence) {
    let local = copy(s),
      mem = copy(m);
    const path = [],
      parts = [];
    for (const input of sequence) {
      const a = { ...input };
      // Same-name copies are interchangeable, but numeric indices are NOT:
      // an inserted/removed preparation card shifts every subsequent slot.
      if (["card", "tune"].includes(a.type)) a.index = local.hand.findIndex((h) => h.id === a.id);
      if (
        (["card", "tune"].includes(a.type) && a.index < 0) ||
        (a.type === "switch" &&
          (a.target === local.active || !T.alive(local.characters[a.target]))) ||
        (a.type === "tune" &&
          (a.element !== T.team[local.active].element ||
            !T.diceOrder.some((e) => e !== a.element && e !== "Omni" && local.dice[e] > 0)))
      )
        return null;
      if (
        mem.uncertainActions.includes(T.actionKey(a)) ||
        (a.type === "card" && !T.cardLegal(local, a, mem)) ||
        (a.type === "skill" && !T.skillLegal(local, a, mem))
      )
        return null;
      const p = simulate(local, mem, a);
      if (!p) return null;
      path.push(a);
      parts.push(p);
      local = p.state;
      mem = p.memory;
      if (p.leaf && path.length !== sequence.length) return null;
    }
    return { path, parts, state: local, memory: mem };
  }
  function singOpening(s, m) {
    if (
      m.round !== 1 ||
      !m.used.every((n) => n === 0) ||
      s.active !== 0 ||
      !T.alive(s.characters[0]) ||
      s.characters[0].frozen ||
      s.characters[0].hp < 8 ||
      m.openingRevel || (m.openingDraws || 0) >= openingDrawLimit(m)
    )
      return null;
    const sing = s.hand.find((h) => h.id === "sing"),
      draw = s.hand.find((h) => h.id === "draw"),
      revel = s.hand.find((h) => h.id === "revel");
    const entering = !!sing && m.singCharges === 0 && (m.openingDraws || 0) === 0,
      continuing = m.singCharges === 2 && [1, 2].includes(m.openingDraws);
    if (!entering && !continuing) return null;
    const counts = s.hand.reduce((r, h) => {
        const type = T.byId[h.id]?.type;
        if (type) r[type] = (r[type] || 0) + 1;
        return r;
      }, {}),
      floor = (counts.weapon >= 2 ? 1 : 0) + (counts.artifact >= 2 ? 1 : 0),
      gear = (counts.weapon || 0) + (counts.artifact || 0),
      candidates = entering ? [sing] : [
        ...(m.openingDraws === 1 && draw ? [draw] : []),
        ...(revel && gear >= 2 ? [revel] : []),
      ];
    for (const h of candidates) {
      if (!h || s.hand.length > (h.id === "sing" ? 7 : 9)) continue;
      const a = { type: "card", id: h.id, index: h.index, target: null };
      if (!T.cardLegal(s, a, m) || m.uncertainActions.includes(T.actionKey(a))) continue;
      const p = simulate(s, m, a);
      // Only this ONE draw is chosen. Pay first, then reserve a known-funded
      // Iansan E. Never borrow identities/refunds from its unknown new cards.
      if (!p || !fundedSkill(p.state, p.memory, { who: 0, skill: "E" }, simulate)) continue;
      return {
        ...a, route: "欢唱轴",
        reason: h.id === "sing"
          ? "先欢唱过牌并保留已知启动预算，不要求狂欢或装备对提前齐全；抽到什么再重算"
          : h.id === "draw"
            ? "欢唱后先用现有运筹铺垫，仍保留战技预算；不猜抽牌和狂欢返骰"
            : "至少两张实际装备允许狂欢搏上限；只用已知返骰下界保留战技预算，随后转输出",
        search: { nodes: 0, value: 0, sequence: [a],
          knownRefundFloor: h.id === "revel" ? floor : 0, unknownDraws: true },
      };
    }
    return null;
  }
  function plan(s, m, options = {}) {
    return T.projectionBudget.run(SEARCH_LIMITS.nodes, () => searchPlan(s, m, options));
  }
  function searchPlan(s, m, options, terminalChecked = false) {
    // Retain an ordinary legal root candidate before helpers can spend the
    // scope. This is not another simulator or a queued future action.
    const currentSkill = ["Q", "E", "NA"].map(skill => ({ type: "skill", who: s.active, skill }))
      .find(a => T.skillLegal(s, a, m) && !m.uncertainActions.includes(T.actionKey(a)));
    const direct = terminalChecked ? null : terminalFinisher(s, m);
    if (direct)
      return {
        action: direct.action,
        sequence: [direct.action],
        terminal: true,
        value: 0,
        expanded: 0,
        completionNodes: 0,
        equipmentNodes: 0,
      };
    const depth = options.depth || SEARCH_LIMITS.depth,
      width = options.width || SEARCH_LIMITS.width;
    let frontier = [{ state: s, memory: m, path: [], score: 0, combat: 0,
        relay: pendingRelay(s, m), exposures: [0, 0, 0], risk: 0 }],
      best = null,
      expanded = 0,
      completionNodes = 0,
      equipmentNodes = 0,
      boundaryNodes = 0;
    const boundaryCache = new Map();
    const start = evaluation(s, m), objective = battleObjective(s, m),
      window = PAYOFF_WINDOW,
      seen = new Map();
    const effort = (path) =>
      path.reduce((total, action) => total + (INPUT_EFFORT[action.type] ?? 0.035), 0);
    const outputDelay = (path) => {
      if (objective.phase !== "output" || s.active !== objective.carry) return 0;
      const first = path.findIndex((a) =>
        (a.type === "skill" && a.who === objective.carry) ||
        (a.type === "card" && a.id === "skivingNewAndImproved" && objective.carry === 2) ||
        (a.type === "switch" && a.target === 1 && m.gamingReturn));
      // Once the carry is already working, credit a detour only AFTER its
      // entire restart overhead. Native confirmed inputs take roughly 9-16s;
      // tiny speculative gains must not postpone the funded damage chain.
      // This is a soft objective, not a switch ban or a forced action queue.
      return 0.06 * (first < 0 ? path.length : first);
    };
    const valueOf = (node) =>
      node.score +
      evaluation(node.state, node.memory, node.exposures) -
      start -
      0.15 * node.combat -
      effort(node.path) -
      outputDelay(node.path) + (node.boundaryValue || 0) -
      0.02 *
        Math.max(
          0,
          node.path.findIndex(
            (a) => a.type === "skill" || (a.type === "card" && a.id === "skivingNewAndImproved"),
          ),
        );
    const consider = (node) => {
      const terminal = T.enemyCount(s) > 0 && T.enemyCount(node.state) === 0 &&
        s.enemies.filter(T.alive).every(e => e.defenseKnown === true && e.auraKnown === true);
      // Keep unfinished relay prefixes in the beam, but never select them as
      // payoff. Bare NA must actually reach E/Q, finish a target, add damage,
      // or unlock output that the former active role could not afford.
      if (node.combat > window || node.idleRelay || node.unsurvivable || (!terminal && node.fragileContinuation) ||
          (node.relay && !node.relay.cover)) return -Infinity;
      const supportActions = node.path.filter((a) => a.type === "skill" && a.who === 0).length;
      if (
        !terminal &&
        supportActions > 1 &&
        (s.characters[0].hp <= pressureEstimate(m) * supportActions ||
          (m.round === 1 && s.characters[0].hp < 8 && m.used[0] + supportActions >= 3))
      )
        return -Infinity;
      const value = valueOf(node), actions = node.path.length;
      // Lethal beats setup/survival points. Among the same complete outcome,
      // minimise inputs first, then combat opportunities and input effort.
      let better = !best;
      if (best) {
        if (terminal !== best.terminal) better = terminal;
        else if (terminal)
          better =
            actions < best.sequence.length ||
            (actions === best.sequence.length &&
              (node.combat < best.combat ||
                (node.combat === best.combat &&
                  effort(node.path) < effort(best.sequence))));
        else {
          // A negligible heuristic gain cannot justify another threatened
          // combat opportunity. This margin applies to any action type.
          const close = Math.abs(value - best.value) <= 0.1 && node.combat !== best.combat &&
            (node.risk > 0 || best.risk > 0);
          better = close ? node.combat < best.combat : value > best.value;
        }
      }
      if ((terminal || value > 0) && better)
        best = {
          action: node.path[0],
          sequence: node.path,
          value,
          terminal,
          combat: node.combat,
          risk: node.risk || 0,
          window,
          boundaryPayoff: node.boundaryPayoff || null,
        };
      return value;
    };
    const append = (node, a, p) => {
      let relay = node.relay || null;
      const idleRelay = node.idleRelay ||
        (a.type === "switch" && relay !== null && !relay.cover);
      if (a.type === "switch")
        relay = a.target === 1 && node.memory.gamingReturn ? null : {
          target: a.target,
          // Replan end cover on the exhausted observed board. Do not fund a
          // speculative cover now by spending cards before available damage.
          cover: retreatNeeded(node.state, node.memory, a.target) ||
            (!activeOutputReachable(s, m) && endCoverTargets(node.state, node.memory).includes(a.target)),
          allowNA: !activeOutputReachable(node.state, node.memory),
        };
      const who = a.type === "skill" ? a.who : a.type === "card" && a.id === "skivingNewAndImproved" ? 2 : null;
      if (relay && who === relay.target) {
        const d = damageEstimate(node.state, node.memory, who, a.skill || "E");
        if (a.skill !== "NA" || relay.allowNA || d.weapon + d.buff + d.soup > 0 ||
            T.enemyCount(p.state) < T.enemyCount(node.state)) relay = null;
      }
      if (!relay && a.type === "skill" && a.skill === "NA" &&
          who !== outputRole(node.state, node.memory) && node.memory.gamingReturn) {
        const d = damageEstimate(node.state, node.memory, who, "NA");
        if (d.weapon + d.buff + d.soup === 0 &&
            T.enemyCount(p.state) === T.enemyCount(node.state) &&
            ["E", "Q"].some((skill) => followupReachable(node.state, node.memory,
              { who: outputRole(node.state, node.memory), skill })))
          // Gaming's automatic exit still owes its native return. Ordinary
          // incumbents may attack: the full-budget comparison, not a nominal
          // carry assignment, decides whether paying for a handoff is better.
          relay = { target: who, cover: false, allowNA: false };
      }
      const exposures = node.exposures.slice(),
        acting = a.type === "switch" ? a.target : who,
        prior = acting === null ? 0 : exposures[acting],
        allowance = acting === null ? Infinity :
          node.state.characters[acting].hp - prior * pressureEstimate(node.memory),
        guarded = prior > 0 && node.state.characters.some((c, i) =>
          i !== acting && T.alive(c) && !c.frozen && c.hp >= allowance + 3 &&
          c.hp > pressureEstimate(node.memory));
      // Count opponent opportunities across the ENTIRE proposed chain, not
      // just support skills. These are risk allowances, never observed HP.
      // In particular, a paid switch also spends one exposure before its task.
      const prepared = p.payoff?.prepared > 0 && node.combat + 1 < window;
      if (p.combat && T.enemyCount(p.state) > 0)
        exposures[p.state.active] += prepared ? 2 : 1;
      // Do not reward empty preparations for merely making room for a random
      // draw. Useful refunds/damage still count, and a fresh real state can
      // reassess its new capacity after those actions actually happen.
      let benefit = p.payoff?.immediate ?? p.benefit;
      if (a.type === "card" && a.id === "draw") benefit = Math.min(benefit, drawBenefit(s.hand.length));
      if (prepared) {
        const confidence = preparedReliability(node.state, node.memory, node.exposures[node.state.active]);
        // The conditional hit can consume the enemy health/defeat that an
        // outstanding summon also values. Share that health on the shadow
        // board instead of banking both outcomes for the same target.
        const effects = effectValue(p.boundary.state, p.memory, exposures) -
          effectValue(p.state, p.memory, exposures);
        benefit += (p.payoff.prepared + effects) * confidence * 0.91;
      }
      // Outstanding Q/summon effects are credited once in endpoint evaluation.
      // Their realised damage removes the corresponding potential value.
      const risk = p.combat && T.enemyCount(p.state) > 0
        ? exposureRisk(p.state, p.memory, node.exposures[p.state.active]) : 0;
      benefit -= risk;
      const child = {
        state: p.state,
        memory: p.memory,
        path: node.path.concat(a),
        score: node.score + benefit * 0.91 ** node.combat,
        combat: node.combat + (p.combat ? 1 : 0) + (prepared ? 1 : 0),
        risk: (node.risk || 0) + risk,
        relay,
        idleRelay,
        exposures,
        unsurvivable: node.unsurvivable || (p.combat && prior > 0 && allowance <= 0),
        fragileContinuation: node.fragileContinuation ||
          (p.combat && guarded && allowance <= pressureEstimate(node.memory)),
      };
      if (p.boundary && child.combat < window) valueBoundary(child, p.boundary);
      return child;
    };
    function valueBoundary(node, boundary) {
      // Value-only continuation, never an executable sequence across a draw or
      // automatic skill. Only existing cards/dice can pay; no delayed refunds.
      const local = copy(boundary.state), mem = copy(node.memory),
        prior = Math.max(0, node.exposures[local.active] - 1),
        confidence = preparedReliability(local, mem, prior),
        slots = window - node.combat;
      for (const e of local.enemies || []) e.auraKnown = false;
      const base = evaluation(local, mem, node.exposures);
      const key = T.boardKey(local) + JSON.stringify(mem) +
        JSON.stringify([node.exposures, slots, boundary.kind]);
      if (boundaryCache.has(key)) {
        node.boundaryPayoff = boundaryCache.get(key);
        node.boundaryValue = node.boundaryPayoff.value;
        return;
      }
      let bestValue = 0, sequence = [];
      for (const skill of ["NA", "E", "Q"]) {
        const p = fundedSkill(local, mem, { who: local.active, skill }, (s, m, a) => {
          if (boundaryNodes >= SEARCH_LIMITS.boundary || !T.projectionBudget.available()) return null;
          boundaryNodes++; expanded++;
          return simulate(s, m, a);
        });
        if (!p) continue;
        let benefit = 0;
        for (let i = 0; i < p.path.length; i++) {
          const q = p.parts[i], before = i ? p.parts[i-1].memory : mem;
          benefit += (q.payoff?.immediate ?? q.benefit) - INPUT_EFFORT[p.path[i].type];
          if (q.combat) benefit -= 0.15 + exposureRisk(q.state, q.memory, node.exposures[local.active]);
          if (slots > 1 && q.payoff?.prepared) benefit += q.payoff.prepared *
            preparedReliability(local, before, node.exposures[local.active]) * 0.91;
        }
        const exposures = node.exposures.slice(); exposures[local.active]++;
        const value = (benefit + evaluation(p.state, p.memory, exposures) - base) *
          confidence * 0.91 ** node.combat;
        if (value > bestValue) { bestValue = value; sequence = p.path; }
      }
      node.boundaryValue = bestValue;
      node.boundaryPayoff = { kind: boundary.kind, confidence, slots, value: bestValue,
        knownOnly: true, sequence };
      boundaryCache.set(key, node.boundaryPayoff);
    }
    const equipmentStep = (local, mem, a) => {
      if (equipmentNodes >= SEARCH_LIMITS.equipment || !T.projectionBudget.available()) return null;
      equipmentNodes++;
      expanded++;
      return simulate(local, mem, a);
    };
    function equipmentPayoff(node, equippedTarget) {
      if (node.combat >= window) return;
      const who = node.state.active,
        carry = outputRole(node.state, node.memory),
        goals = [
          { who: equippedTarget, skill: "E" },
          intent(node.state, node.memory),
          { who: carry, skill: "E" },
          { who, skill: "Q" },
          { who, skill: "NA" },
        ];
      for (const g of uniqueGoals(goals)) {
        const p = fundedSkill(node.state, node.memory, g, equipmentStep);
        if (!p) continue;
        let paid = node;
        for (let i = 0; i < p.path.length; i++) paid = append(paid, p.path[i], p.parts[i]);
        consider(paid);
        if (p.parts[p.parts.length - 1].leaf || paid.combat >= window) continue;
        // Iansan's setup may fund a carry relay or the legal EAQ burst.
        for (const follow of [
          { who: carry, skill: "E" },
          { who: 0, skill: "Q" },
          { who: 0, skill: "NA" },
        ]) {
          const q = fundedSkill(paid.state, paid.memory, follow, equipmentStep);
          if (!q) continue;
          let done = paid;
          for (let i = 0; i < q.path.length; i++) done = append(done, q.path[i], q.parts[i]);
          consider(done);
          if (
            done.combat < window && !q.parts[q.parts.length - 1].leaf &&
            done.state.active === 0 &&
            T.skillLegal(done.state, { who: 0, skill: "Q" }, done.memory) &&
            !done.memory.uncertainActions.includes("skill:0:Q")
          ) {
            const a = { type: "skill", who: 0, skill: "Q" },
              hit = equipmentStep(done.state, done.memory, a);
            if (hit) consider(append(done, a, hit));
          }
        }
      }
    }
    // Small deterministic equipment bundles, not hard-coded five opening
    // queues. At most two zero-cost setup cards then the chosen equipment;
    // compare their ACTUAL funded skill/relay before pruning the setup prefix.
    function equipmentBundles(seed) {
      const visited = new Set();
      function visit(node, level) {
        if (node.combat >= window || equipmentNodes >= SEARCH_LIMITS.equipment) return;
        const key = T.boardKey(node.state) + JSON.stringify(node.memory) +
          JSON.stringify([node.relay, node.exposures]) + level;
        if (visited.has(key)) return;
        visited.add(key);
        const actions = enumerate(node.state, node.memory);
        // Discount/recycle before another irrelevant zero artifact target.
        const setups =
          level >= 2
            ? []
            : actions.filter(
                (a) =>
                  a.type === "card" &&
                  T.size(T.cardCost(a.id, a.target, node.memory, node.state)) === 0 &&
                  (["garden", "house", "lyre", "boar"].includes(a.id) ||
                    T.byId[a.id]?.type === "artifact"),
              );
        setups.sort(
          (a, b) =>
            (T.byId[a.id].type === "artifact" ? 1 : 0) - (T.byId[b.id].type === "artifact" ? 1 : 0),
        );
        for (const a of setups) {
          const hit = equipmentStep(node.state, node.memory, a);
          if (hit && !hit.leaf) visit(append(node, a, hit), level + 1);
        }
        for (const a of actions.filter(
          (a) => a.type === "card" && ["weapon", "artifact"].includes(T.byId[a.id]?.type),
        )) {
          const hit = equipmentStep(node.state, node.memory, a);
          if (hit) equipmentPayoff(append(node, a, hit), a.target);
        }
      }
      visit(seed, 0);
    }
    if (
      m.used[0] === 0 &&
      T.skillLegal(s, { who: 0, skill: "E" }, m) &&
      !m.uncertainActions.includes("skill:0:E")
    ) {
      const a = { type: "skill", who: 0, skill: "E" },
        p = equipmentStep(s, m, a);
      if (p) equipmentBundles(append(frontier[0], a, p));
    }
    equipmentBundles(frontier[0]);
    const completionCache = new Map();
    function complete(node) {
      if (node.combat >= window) return valueOf(node);
      const cacheKey = T.boardKey(node.state) + JSON.stringify(node.memory);
      let completions = completionCache.get(cacheKey);
      if (!completions) {
        completions = [];
        const wanted = intent(node.state, node.memory),
          carry = outputRole(node.state, node.memory);
        const goals = [
          wanted,
          { who: carry, skill: "E" },
          ...(node.path.length === 0
            ? ["Q", "NA"].map((skill) => ({ who: node.state.active, skill }))
            : []),
        ];
        for (const g of uniqueGoals(goals)) {
          const p = fundedSkill(node.state, node.memory, g, (local, mem, a) => {
            if (completionNodes >= SEARCH_LIMITS.funding || !T.projectionBudget.available()) return null;
            completionNodes++;
            expanded++;
            return simulate(local, mem, a);
          });
          if (p) completions.push(p);
        }
        completionCache.set(cacheKey, completions);
      }
      let priority = valueOf(node);
      for (const p of completions) {
        let closed = node;
        for (let i = 0; i < p.path.length; i++) closed = append(closed, p.path[i], p.parts[i]);
        const value = consider(closed);
        priority = Math.max(priority, value);
      }
      return priority;
    }
    // Close switch/tune/gear prefixes to a real skill BEFORE ranking the beam.
    // Five primitive levels remain bounded; completion can add <=5 legal
    // inputs, and shares the SAME 1800 node budget. Value-only leaf work has
    // its own small cap; it cannot starve the equipment/funded relay quotas.
    complete(frontier[0]);
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const node of frontier)
        for (const a of enumerate(node.state, node.memory)) {
          if (node.path.length >= depth || node.combat >= window) continue;
          if (
            a.type === "switch" &&
            node.path[node.path.length - 1]?.type === "switch" &&
            !(a.target === 1 && node.memory.gamingReturn)
          )
            continue;
          if (!T.projectionBudget.available()) break;
          expanded++;
          const p = simulate(node.state, node.memory, a);
          if (!p) continue;
          // Fast actions do not hand priority to the opponent. Discount by
          // combat opportunities, not card-click count: otherwise free Garden
          // unfairly delays the same Wolf+E and loses to paying full price.
          const child = append(node, a, p),
            value = valueOf(child);
          if (child.idleRelay) continue;
          // Resource/discount by itself is not an action payoff. Random draw is
          // a labelled leaf, not a licence to invent future cards.
          if (p.combat || (p.leaf && a.type !== "end") || p.benefit > 0) consider(child);
          if (!p.leaf && child.combat < window) {
            // The same board can arrive with a completed or still-unpaid
            // relay. Do not let one prefix prune the other's task status.
            const key = T.boardKey(p.state) + JSON.stringify(p.memory) +
              JSON.stringify([child.relay, child.exposures, !!child.fragileContinuation]);
            if ((seen.get(key) ?? -Infinity) >= value) continue;
            seen.set(key, value);
            const priority = complete(child);
            // A ready Iansan Q is a short terminal payoff, not a long funding
            // completion. Don't lose EAQ just because the shared completion
            // quota was spent inspecting earlier equipment targets.
            if (
              child.state.active === 0 &&
              !child.memory.iansanBurst &&
              T.skillLegal(child.state, { who: 0, skill: "Q" }, child.memory) &&
              !child.memory.uncertainActions.includes("skill:0:Q") &&
              T.projectionBudget.available()
            ) {
              expanded++;
              const q = { type: "skill", who: 0, skill: "Q" },
                hit = simulate(child.state, child.memory, q);
              if (hit) consider(append(child, q, hit));
            }
            if (child.path.length < depth) next.push({ ...child, value: priority });
          }
        }
      if (!T.projectionBudget.available()) break;
      next.sort((a, b) => b.value - a.value);
      frontier = next.slice(0, width);
    }
    if (!best && currentSkill && !T.projectionBudget.available())
      return { action: currentSkill, sequence: [currentSkill], value: 0,
        expanded, completionNodes, equipmentNodes, budgetExhausted: true };
    return best
      ? { ...best, expanded, completionNodes, equipmentNodes }
      : {
          action: { type: "end" },
          sequence: [],
          value: 0,
          expanded,
          completionNodes,
          equipmentNodes,
        };
  }
