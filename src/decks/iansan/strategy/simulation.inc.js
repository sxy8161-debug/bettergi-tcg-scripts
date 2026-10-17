  function enumerate(s, m) {
    const out = [],
      a = s.active,
      c = s.characters[a],
      wanted = intent(s, m),
      carry = outputRole(s, m),
      n = T.total(s.dice);
    const add = (x) => {
      if (!m.uncertainActions.includes(T.actionKey(x))) out.push(x);
    };
    for (const skill of ["E", "Q", "NA"])
      if (T.skillLegal(s, { who: a, skill }, m)) add({ type: "skill", who: a, skill });
    for (const target of switchTargets(s,m)) add({type:"switch",target});
    for (const h of s.hand) {
      const def = T.byId[h.id];
      if (!def) continue;
      let targets = [null];
      if (def.type === "weapon" || def.type === "artifact" || h.id === "lyre") targets = [0, 1, 2];
      if (def.type === "talent") targets = [2];
      if (def.type === "food" && h.id !== "sing") targets = [a];
      for (const target of targets) {
        const x = { type: "card", id: h.id, index: h.index, target };
        if (!T.cardLegal(s, x, m)) continue;
        if (["weapon", "artifact"].includes(def.type) && !equipmentWanted(s, m, h.id, target))
          continue;
        if (
          h.id === "lyre" &&
          (!T.byId[m.artifactKinds[target]] ||
            (m.artifactKinds[target] === "gambler" &&
              T.gamblerRemaining(m, target) > 0 &&
              enemy(s)?.hp <= 6))
        )
          continue;
        if (
          h.id === "boar" &&
          (m.boar > 0 ||
            !s.hand.some(
              (y) =>
                ["weapon", "artifact"].includes(T.byId[y.id]?.type) &&
                [0, 1, 2].some(
                  (target) =>
                    equipmentWanted(s, m, y.id, target) &&
                    (T.byId[y.id].type === "weapon" ? m.weapons[target] : m.artifacts[target]),
                ),
            ))
        )
          continue;
        if (h.id === "garden" && (m.garden || !setupEquipmentReachable(s, m, "garden"))) continue;
        if (h.id === "shift") {
          const afterCard={...s,hand:T.indexedHand(s.hand.filter(y=>y.index!==h.index))};
          if(m.freeSwitch || !switchTargets(afterCard,{...m,freeSwitch:true}).length)continue;
        }
        if (h.id === "fast" && (m.fastSwitch || !out.some((y) => y.type === "switch"))) continue;
        if (h.id === "sing" && (m.singCharges > 0 || n < 6 || s.hand.length > 7)) continue;
        if (
          ["sing", "draw", "revel"].includes(h.id) &&
          m.round === 1 &&
          m.used.every((n) => n === 0) &&
          (m.openingRevel || (m.openingDraws || 0) >= openingDrawLimit(m))
        )
          continue;
        if (h.id === "revel" && s.hand.length > 8)
          continue;
        if (h.id === "opera" && (m.operas.length >= 2 || n < 2 || m.round > 4)) continue;
        if (h.id === "house" && (m.houses.length >= 2 || !setupEquipmentReachable(s, m, "house")))
          continue;
        if (
          (h.id === "sweet" && c.hp >= T.effectiveMaxHp(m, a)) ||
          (h.id === "hashbrown" && c.hp > T.effectiveMaxHp(m, a) - 2) ||
          (h.id === "lotus" && c.hp > 5)
        )
          continue;
        if (h.id === "soup" && c.hp > T.effectiveMaxHp(m, a) - 2) {
          const p = T.payment(s.dice, T.cardCost("soup", a, m, s), T.team[a].element);
          if (!p || !soupDiscountReachable({ ...s, dice: p.remaining }, m, a)) continue;
        }
        if (h.id === "stars" && (c.energy >= T.team[a].maxEnergy || n < 5)) continue;
        if (
          h.id === "companion" &&
          ["E", "Q"].some((skill) => T.skillLegal(s, { who: a, skill }, m))
        )
          continue;
        add(x);
      }
    }
    for (const g of [wanted, ...["Q", "E", "NA"].map((skill) => ({ who: a, skill }))]) {
      const p = tuningPlan(s, m, g);
      if (p) {
        add({
          type: "tune",
          id: p.card.id,
          index: p.card.index,
          element: T.team[a].element,
          goal: g.skill,
        });
        break;
      }
    }
    add({ type: "end" });
    return out;
  }
  function simulate(s, m, a) {
    if (!T.projectionBudget.take()) return null;
    const next = copy(s),
      mem = copy(m),
      pay = T.payment(s.dice, actionCost(a, s, m), T.team[s.active].element);
    if (!pay) return null;
    next.dice = pay.remaining;
    let benefit = 0,
      prepared = 0,
      deferred = 0,
      boundary = null,
      unknownDraw = false,
      combat = false,
      leaf = false;
    if (a.type === "end") {
      // End-phase is delayed. Value the existing summon without fabricating
      // healing/HP/defeats now or using it to pay for another action.
      // The new summon was already valued at its burst node. Do not reward
      // ending again for the same future heal; existing summon value is common
      // to every candidate and cannot fund a hypothetical current action.
      return {
        state: next,
        memory: mem,
        benefit: 0,
        leaf: true,
        combat: false,
        delayed: "end-phase-summon",
      };
    }
    const active = next.characters[s.active];
    if (a.type === "tune") {
      const bad = T.diceOrder.find((e) => e !== a.element && e !== "Omni" && next.dice[e] > 0);
      if (!bad) return null;
      next.dice[bad]--;
      next.dice[a.element] = (next.dice[a.element] || 0) + 1;
      benefit = -0.45;
    }
    if (a.type === "switch") {
      next.active = a.target;
      combat = !m.fastSwitch;
      benefit = -0.15 + (retreatNeeded(s, m, a.target) ? 0.8 : 0);
      if (endCoverTargets(s, m).includes(a.target))
        benefit += Math.max(0, roundBoundaryRisk(s, m) - roundBoundaryRisk(next, mem));
      benefit += passiveHealing(s, m, a) * 0.65;
      if (a.target === 1 && m.gamingReturn) {
        const d = damageEstimate(next, m, 1, "P");
        const hit = applyDamage(next, d);
        benefit += hit.dealt * 0.7 + hit.kills * 1.8;
        if(hit.guaranteedKills&&m.artifactKinds[1]==="gambler")
          next.dice.Omni=(next.dice.Omni||0)+2*Math.min(hit.guaranteedKills,T.gamblerRemaining(m,1));
        next.characters[1].energy = Math.min(3, next.characters[1].energy + 1);
        leaf = true; // Native automatic plunge owns the next combat timing.
      }
    }
    if (a.type === "card") {
      const c = T.byId[a.id];
      next.hand = T.indexedHand(next.hand.filter((_, i) => i !== a.index));
      // Equipment is paid for and credited through realised subsequent damage,
      // payment or refund. Do not reward the same weapon once at entry and
      // again on every attack, nor credit moving a free Heart as engine profit.
      if (a.id === "gilded")
        next.dice[T.team[a.target].element] = (next.dice[T.team[a.target].element] || 0) + 2;
      if (
        ["weapon", "artifact"].includes(c.type) &&
        m.boar > 0 &&
        (c.type === "weapon" ? m.weapons[a.target] : m.artifacts[a.target])
      ) {
        next.dice.Omni = (next.dice.Omni || 0) + 1;
      }
      if (a.id === "lyre") {
        const returned = T.byId[m.artifactKinds[a.target]];
        next.hand.push({
          index: next.hand.length,
          id: returned.id,
          name: returned.name,
          supported: true,
        });
      }
      if (a.id === "companion") next.dice.Omni = (next.dice.Omni || 0) + 2;
      if (a.id === "lost") {
        next.dice.Omni = (next.dice.Omni || 0) + 1;
        active.energy = Math.min(T.team[s.active].maxEnergy, active.energy + 1);
        benefit = 0.5;
      }
      if (a.id === "stars") {
        active.energy++;
        benefit = 0.2;
      }
      if (a.id === "sweet" || a.id === "hashbrown") {
        const heal = Math.min(
          Math.max(0, T.effectiveMaxHp(m, a.target) - next.characters[a.target].hp),
          a.id === "sweet" ? 1 : 2,
        );
        next.characters[a.target].hp += heal;
        benefit = heal * (active.hp <= 4 ? 1 : 0.25);
      }
      if (a.id === "lotus") benefit = active.hp <= 3 ? 1.4 : 0.6;
      if (["draw", "revel", "sing", "soup"].includes(a.id)) {
        // Do not plan with unknown future cards or a favourable random soup.
        // Capacity is real; unknown identities cannot finance a later action.
        leaf = true;
        benefit =
          a.id === "draw"
            ? drawBenefit(s.hand.length)
            : a.id === "sing"
              ? 1.1
              : a.id === "soup"
                ? active.hp <= 4
                  ? 1
                  : 0.25
                : 0.55;
        if (a.id === "revel") {
          const counts = next.hand.reduce((r, h) => {
            const type = T.byId[h.id]?.type;
            if (type) r[type] = (r[type] || 0) + 1;
            return r;
          }, {});
          const refund = (counts.weapon > 1 ? 1 : 0) + (counts.artifact > 1 ? 1 : 0);
          next.dice.Omni = (next.dice.Omni || 0) + refund;
        }
      }
    }
    if (a.type === "skill" || (a.type === "card" && a.id === "skivingNewAndImproved")) {
      const who = a.id === "skivingNewAndImproved" ? 2 : a.who,
        skill = a.id === "skivingNewAndImproved" ? "E" : a.skill,
        d = damageEstimate(s, m, who, skill),
        e = enemy(next);
      const original = enemy(s),
        n = T.enemyCount(s),
        carry = outputRole(s, m);
      combat = true;
      const healing = who === 2 && skill === "E" ? passiveHealing(s, m, a) : 0;
      const hit=applyDamage(next,d),{dealt,kills}=hit;
      if(!hit.complete)leaf=true;
      if (d.prepared && !hit.replacementRequired) {
        const future = enemy(next),
          r = reaction(d.preparedElement, future?.auraKnown ? future.aura : []);
        // Opponent gets an action between hits. No instant prepared kill,
        // Gambler refund or subsequent free manual E in this projected node.
        const shadow = copy(next),
          weapon = m.weapons[who] ? (m.weaponKinds[who] === "wolf" && future?.hp <= 6 ? 3 : 1) : 0,
          direct = 2 + weapon + d.preparedBuff + (m.soupDamage[who] > 1 ? 1 : 0) + r.bonus,
          hit = future ? applyDamage(shadow, { direct, reaction: r,
            element: d.preparedElement, elemental: true }) : { dealt: 0, kills: 0 };
        prepared = hit.dealt * DAMAGE_VALUE + hit.kills * DEFEAT_VALUE;
        boundary = { kind: "prepared", state: shadow };
        leaf = true;
      }
      if (hit.guaranteedKills && m.artifactKinds[who] === "gambler")
        next.dice.Omni = (next.dice.Omni || 0) + 2 * Math.min(hit.guaranteedKills, T.gamblerRemaining(m, who));
      benefit =
        dealt * 0.7 +
        kills * 1.8 +
        healing * 0.65 +
        (who === carry && skill === "E" ? 0.4 : 0);
      if (a.id === "skivingNewAndImproved") benefit += m.talent ? 0.25 : 1.1;
      const draws=T.reactionDraws(m,s,who,skill,a.id==="skivingNewAndImproved");
      if (draws.talent || draws.gilded) {
        // Unknown draw identities must not become future playable cards.
        leaf = true;
        unknownDraw = true;
        benefit += 0.6;
      }
      if (who === 0 && skill === "E" && m.used[0] === 0) benefit += 2;
      // Iansan Q is valued through the remaining Kinetic effect ledger, not
      // an entry bonus counted again when the subsequent skills deal damage.
      if (who === 1 && skill === "Q" && m.manchai === 0) benefit += 2;
      if (who === 2 && skill === "Q") deferred = summonBenefit(s, m);
      if (who === 2 && skill === "E" && original?.auraKnown && original.aura.length === 0 && n >= 3)
        benefit -= 0.9;
      next.characters[who].energy =
        skill === "Q" ? 0 : Math.min(T.team[who].maxEnergy, next.characters[who].energy + 1);
      if (who === 1 && skill === "E") {
        if (m.manchai > 0 && next.characters[1].hp >= 5) next.characters[1].hp--;
        const nextRole = [(who + 1) % 3, (who + 2) % 3, who].find((i) =>
          T.alive(next.characters[i]),
        );
        next.active = nextRole;
      }
      if (d.reaction.futureUnknown) leaf = true;
      // Any actual opponent reply can change aura/health. Penalize exposed
      // fragile roles instead of pretending this is a complete minimax model.
    }
    if (a.type === "tune") next.hand = T.indexedHand(next.hand.filter((_, i) => i !== a.index));
    T.commit(mem, a, s, next, { projected: true });
    // Combat gives the opponent an opportunity; delayed Q healing cannot
    // cancel exposure now. Do not write imagined damage into character HP.
    const payoff = { immediate: benefit, prepared, deferred };
    benefit += prepared * preparedReliability(s, m) * 0.91 + deferred;
    if (combat && T.enemyCount(next) > 0) benefit -= exposureRisk(next, mem);
    // A threatened frontline may not get the next input. Keep its immediate
    // payoff in the comparison, but do not finance it with a later retreat,
    // return or delayed heal that assumes it survived the opponent's reply.
    if (combat && exposureRisk(next, mem) > 0 &&
        next.characters[next.active].hp <= pressureEstimate(mem)) leaf = true;
    if (T.total(next.dice) > 16) return null;
    if (T.enemyCount(s) > 0 && T.enemyCount(next) === 0) leaf = true;
    if (!boundary && unknownDraw && T.enemyCount(next) > 0 &&
        !(exposureRisk(next, mem) > 0 && next.characters[next.active].hp <= pressureEstimate(mem)))
      boundary = { kind: "unknown-draw", state: next };
    return { state: next, memory: mem, benefit, combat, leaf, payoff, boundary };
  }
