  function pressureEstimate(m) {
    const e = m.hpLossEvidence;
    // An ordinary exposure floor, raised by recent measured loss. Neither
    // value claims to identify the next opponent action.
    return Math.max(3, e && m.round - e.round >= 0 && m.round - e.round <= 1
      ? Math.min(6, e.loss) : 0);
  }
  function coverTargets(s, m) {
    const current = s.characters[s.active], pressure = pressureEstimate(m);
    return s.characters.flatMap((c, i) =>
      i !== s.active && T.alive(c) && !c.frozen &&
      c.hp >= current.hp + 3 && c.hp > pressure ? [i] : []);
  }
  function exposureRisk(s, m, prior = 0) {
    if (!T.enemyCount(s) || !coverTargets(s, m).length) return 0;
    const who = s.active, pressure = pressureEstimate(m),
      hp = s.characters[who].hp - prior * pressure,
      risk = Math.max(0, Math.min(1, (pressure + 2 - hp) / 2)),
      value = 2.5 + (m.weaponKinds[who] === "wolf" ? 3 : m.weapons[who] ? 1 : 0) +
        (who === 2 && m.talent ? 1 : 0) + (who === 0 && m.nightsoulEstimate > 0 ? 1.5 : 0);
    // Preserve equipped output/support when a healthy cover exists. With no
    // cover, the guide's sacrifice/last-character relay remains available.
    return risk * value;
  }
  function preparedReliability(s, m, prior = 0) {
    // One opponent reply precedes the prepared hit. This allowance is only
    // a scoring heuristic; never write imagined damage into observed HP.
    const reserve = s.characters[s.active].hp - (prior + 1) * pressureEstimate(m);
    return reserve > pressureEstimate(m) ? 0.65 : reserve > 0 ? 0.35 : 0.15;
  }
  const DAMAGE_VALUE = 0.7, DEFEAT_VALUE = 1.8, DIE_VALUE = 0.18;
  const enemyHealth = s => (s.enemies || []).filter(T.alive).reduce((n, e) => n + e.hp, 0);
  function combatTarget(s) {
    const targets = (s.enemies || []).filter(e => T.alive(e) && e.active === true);
    return targets.length === 1 ? targets[0] : null;
  }
  function summonValue(s, m) {
    if (!m.sayuSummon || !T.enemyCount(s)) return 0;
    const injured = s.characters.flatMap((c, i) => T.alive(c) ? [{
      missing: Math.max(0, T.effectiveMaxHp(m, i) - c.hp),
      // A threatened active role may not reach the end phase. A healthy
      // injured teammate still benefits; no hypothetical switch is required.
      confidence: i === s.active && c.hp <= pressureEstimate(m) ? 0.25 : 1,
    }] : []).sort((a, b) => b.missing - a.missing);
    let value = 0;
    const shadow = copy(s);
    for (let i = 0; i < m.sayuSummon; i++) {
      if (!T.enemyCount(shadow)) break;
      const target = injured[0], heal = Math.min(2, target?.missing || 0);
      // First end phase and next round are different horizons. Neither can
      // prove an immediate kill/heal/refund or sustain a current continuation.
      // Only the first phase can use the currently known aura. Later opponent
      // actions may change it; don't multiply today's swirl by both usages.
      const r = reaction("Anemo", i === 0 && enemy(shadow)?.auraKnown ? enemy(shadow).aura : []),
        hit = applyDamage(shadow, { direct: 1 + r.bonus,
          reaction: r, element: "Anemo", elemental: true });
      if (!hit) break;
      value += (hit.dealt * DAMAGE_VALUE + hit.kills * DEFEAT_VALUE +
        heal * (target?.confidence || 0) * 0.65) * (i === 0 ? 0.55 : 0.3);
      if (target) target.missing -= heal;
      injured.sort((a, b) => b.missing - a.missing);
    }
    return value;
  }
  function summonBenefit(s, m) {
    // Replacing one existing usage adds the later phase, not another first heal.
    return summonValue(s, { ...m, sayuSummon: 2 }) - summonValue(s, m);
  }
  function effectValue(s, m, exposures = [0, 0, 0]) {
    const hp = enemyHealth(s), support = s.characters[0];
    if (!hp) return 0;
    // Kinetic: +2 for two usages. Night points extend these usages, but are
    // hidden estimates, so only a quarter of their potential is banked.
    const night = T.alive(support) ? (m.nightsoulEstimate || 0) * 0.25 : 0,
      kinetic = Math.min(hp, 2 * (m.kineticEstimate + (m.kineticEstimate ? night : 0))) *
        DAMAGE_VALUE * 0.55;
    let readyBurst = 0;
    if (m.weaponKinds[0] === "moon" && m.used[1] + m.used[2] === 0 &&
        T.alive(support) && !support.frozen && support.energy === 2 && !m.iansanBurst) {
      const reserve = support.hp - exposures[0] * pressureEstimate(m),
        confidence = reserve > pressureEstimate(m) ? 0.55 : reserve > 0 ? 0.25 : 0,
        activation = 3 * DIE_VALUE + 0.15 + INPUT_EFFORT.skill +
          (s.active === 0 ? 0 : T.size(T.switchCost(m)) * DIE_VALUE + 0.15 + INPUT_EFFORT.switch);
      // Ready energy unlocks a future Q. Value only its guaranteed two +2
      // usages, less its activation cost; future dice are NOT made available.
      readyBurst = Math.max(0, Math.min(hp, 4) * DAMAGE_VALUE - activation) * confidence;
    }
    return kinetic + readyBurst + summonValue(s, m);
  }
  function outputProtectionValue(s, m, who = s.active) {
    const local = { ...m, kineticEstimate: 0 }, e = damageEstimate(s, local, who, "E"),
      second = e.prepared || damageEstimate(s, local, who, "NA").direct;
    return Math.min(enemyHealth(s), e.direct + second) * DAMAGE_VALUE +
      (who === 2 && m.talent ? 0.65 : 0);
  }
  function roundBoundaryRisk(s, m) {
    if (!T.enemyCount(s) || activeOutputReachable(s, m)) return 0;
    const c = s.characters[s.active], pressure = pressureEstimate(m),
      reserve = c.hp - 2 * pressure,
      risk = Math.max(0, Math.min(1, (pressure + 2 - reserve) / 2));
    // End phase + next opener, not a claimed damage amount. Existing equipment
    // determines how much output is at stake; no simulated HP is published.
    return risk * outputProtectionValue(s, m) * 0.35;
  }
  function endCoverTargets(s, m) {
    if (!T.payment(s.dice, T.switchCost(m)) ||
        activeOutputReachable(s, m) || roundBoundaryRisk(s, m) === 0) return [];
    return s.characters.flatMap((c, i) => i !== s.active && T.alive(c) && !c.frozen &&
      c.hp > s.characters[s.active].hp && c.hp > pressureEstimate(m) ? [i] : []);
  }
  function followupReachable(s, m, g) {
    if (!g || !T.alive(s.characters[g.who]) || s.characters[g.who].frozen) return false;
    let dice = s.dice;
    if (g.who !== s.active) {
      // Use the same estimated switch payment as simulate. A different
      // preserved element can invent a followup that loses its only die.
      if (T.actionRefused(s, m, { type: "switch", target: g.who })) return false;
      const p = T.payment(dice, T.switchCost(m), T.team[s.active].element);
      if (!p) return false;
      dice = p.remaining;
    }
    const local = { ...s, active: g.who, dice };
    if (T.actionRefused(local, m, { type: "skill", ...g })) return false;
    return T.skillLegal(local, g, m) || !!tuningPlan(local, m, g);
  }
  function activeOutputReachable(s, m) {
    return ["E", "Q", "NA"].some((skill) => followupReachable(s, m, { who: s.active, skill }));
  }
  function retreatNeeded(s, m, target) {
    // Cover is a task only at critical exposure or after usable output is
    // exhausted. More HP alone must not interrupt a funded on-field action.
    return exposureRisk(s, m) > 0 && coverTargets(s, m).includes(target) &&
      (s.characters[s.active].hp <= pressureEstimate(m) || !activeOutputReachable(s, m));
  }
  function burnableHand(s, m) {
    const carry = outputRole(s, m),
      values = {
        wolf: m.weaponKinds[carry] === "wolf" ? 15 : 95,
        moon: m.weaponKinds[0] ? 25 : 85,
        skivingNewAndImproved: m.talent ? 35 : 90,
        gambler: 70,
        gilded: 60,
        troupe: 45,
        heart: 30,
        opera: 55,
        house: 40,
        garden: m.legendUsed ? 0 : 95,
        lyre: 60,
        boar: 35,
        revel: 50,
        draw: 45,
        shift: 25,
        sing: 40,
        soup: s.characters[s.active].hp <= 4 ? 90 : 40,
      };
    return s.hand
      .filter(T.handCardKnown)
      .filter((h) => !T.actionRefused(s, m,
        { type: "tune", id: h.id, index: h.index, element: T.team[s.active].element }))
      .slice()
      .sort((a, b) => (values[a.id] ?? 15) - (values[b.id] ?? 15));
  }
  function tuningPlan(s, m, g) {
    if (
      !g ||
      g.who !== s.active ||
      s.characters[g.who].frozen ||
      (g.skill === "Q" && s.characters[g.who].energy < T.team[g.who].maxEnergy)
    )
      return null;
    const cost = T.skillCost(g.who, g.skill, m, s),
      element = T.team[g.who].element;
    if (T.total(s.dice) < T.size(cost) || T.payment(s.dice, cost, element)) return null;
    const needed = Math.max(0, (cost.n || 0) - (s.dice[element] || 0) - (s.dice.Omni || 0)),
      cards = burnableHand(s, m),
      bad = T.total(s.dice) - (s.dice[element] || 0) - (s.dice.Omni || 0);
    if (!needed || needed > bad || needed > cards.length) return null;
    return { card: cards[0], needed, goal: g };
  }
  function reaction(element, aura = []) {
    return T.elementReaction(element,aura);
  }
  function damageEstimate(s, m, who, skill) {
    const e = enemy(s),
      element = skill === "NA" ? "Physical" : T.team[who].element,
      wolf = m.weaponKinds[who] === "wolf";
    // Pinned 7590c11 Q base is 2. Both native 7 -> 4 samples equipped
    // Wolf: base 2 + weapon 1, not naked base 3 plus another weapon bonus.
    // The native return is a separate 2-Pyro plunge, never another burst.
    const base = who === 0 ? 2 : who === 1 ? (skill === "E" ? 1 : 2) : skill === "NA" ? 2 : 1;
    const r = reaction(element, e?.auraKnown === true ? e.aura : []),
      elemental = element !== "Physical";
    const weapon = m.weapons[who] ? (wolf && e?.hp <= 6 ? 3 : 1) : 0,
      skillBonus = who === 1 && skill === "E" && m.manchai > 0 ? 1 : 0,
      buff = m.kineticEstimate > 0 ? 2 : 0,
      preparedBuff = m.kineticEstimate > 1 ||
        (m.kineticEstimate > 0 && m.nightsoulEstimate > 0) ? 2 : 0,
      soup = m.soupDamage[who] > 0 ? 1 : 0;
    const shatter=e?.frozen===true&&["Pyro","Physical"].includes(element)?2:0,
      rawDirect=base+weapon+skillBonus+buff+soup+r.bonus+shatter,
      direct=T.damageAgainst(e,rawDirect,element).direct;
    const preparedElement = r.spread || "Anemo";
    const prepared =
      who === 2 && skill === "E"
        ? 2 +
          (m.weapons[who] ? (wolf && e?.hp - direct <= 6 ? 3 : 1) : 0) +
          preparedBuff +
          (m.soupDamage[who] > 1 ? 1 : 0)
        : 0;
    const splash =
      r.spread || r.piercing ? (s.enemies || []).filter((x) => T.alive(x) && x !== e).length : 0;
    return {
      base,
      weapon,
      skillBonus,
      buff,
      soup,
      direct,
      rawDirect,
      prepared,
      preparedBuff,
      preparedElement,
      splash,
      swirl: !!r.spread,
      overload: !!r.forceSwitch,
      elemental,
      element,
      reaction: r,
      target: e,
    };
  }
  function applyDamage(next, d) {
    const e = combatTarget(next);
    if (!e) return null;
    const targets=next.enemies.filter(T.alive),backgrounds=targets.filter(x=>x!==e);
    let dealt=0,complete=true;
    const hit=(x,amount,element,piercing=false)=>{
      const damage=T.damageAgainst(x,amount,element,piercing);
      dealt+=Math.min(x.hp,damage.direct);x.hp=Math.max(0,x.hp-damage.direct);
      if(T.known(x.shield))x.shield-=damage.shieldSpent;
    };
    const update=(x,element,r)=>{
      if(element==="Physical"){
        if(x.frozen===true)x.frozen=false;
        return;
      }
      if(x.frozen===true&&element==="Pyro")x.frozen=false;
      if(r.freeze)x.frozen=true;
      if(x.auraKnown!==true){complete=false;return;}
      if(r.consumed)x.aura=x.aura.filter(a=>a!==r.consumed);
      else if(!["Anemo","Geo"].includes(element))x.aura=[...new Set([...x.aura,element])];
      if(r.futureUnknown)complete=false;
    };
    hit(e,d.rawDirect??d.direct,d.element);update(e,d.element,d.reaction);
    if(d.reaction.piercing)for(const x of backgrounds)hit(x,1,"Physical",true);
    if(d.reaction.spread)for(const x of backgrounds){
      const element=d.reaction.spread,r=reaction(element,x.auraKnown?x.aura:[]),
        shatter=x.frozen===true&&element==="Pyro"?2:0;
      hit(x,1+r.bonus+shatter,element);update(x,element,r);
      if(r.piercing)for(const other of targets)if(other!==x)hit(other,1,"Physical",true);
      // Secondary overload affects only its background target, not the active.
    }
    let kills = 0;
    for (const x of next.enemies)
      if (x.hp === 0 && x.dead === false) {
        x.dead = true;
        kills++;
      }
    const currentIndex = next.enemies.indexOf(e);
    const survivors=next.enemies.filter(T.alive),replacementRequired=e.dead&&survivors.length>1;
    if (replacementRequired) {
      next.enemies.forEach(x=>{x.active=false;});complete=false;
    } else if(e.dead&&survivors.length===1){
      next.enemies.forEach(x=>{x.active=x===survivors[0];});
    } else if (d.reaction.forceSwitch) {
      const survivor = next.enemies
        .slice(currentIndex + 1)
        .concat(next.enemies.slice(0, currentIndex + 1))
        .find(T.alive);
      if (survivor) {
        next.enemies.forEach((x) => (x.active = false));
        survivor.active = true;
      }
    }
    return { dealt, kills, guaranteedKills:targets.every(x=>x.defenseKnown===true&&x.auraKnown===true)?kills:0,
      complete, replacementRequired };
  }
  function passiveHealing(s, m, a) {
    const potential = T.passiveHealingEstimate(s, m, a);
    // Potential value only. Replanning always uses actual reread HP; hidden
    // global switch parity must not manufacture survival or pay for a branch.
    return potential.amount * potential.confidence;
  }
  function soupDiscountReachable(s, m, target = s?.active) {
    if (!s || target !== s.active || !T.alive(s.characters[target]) || s.characters[target].frozen)
      return false;
    const future = copy(m);
    future.soupDiscount[target] = 2;
    return ["NA", "E", "Q"].some(
      (skill) =>
        T.skillLegal(s, { who: target, skill }, future) ||
        !!tuningPlan(s, future, { who: target, skill }),
    );
  }
  function actionCost(a, s, m) {
    return a.type === "skill"
      ? T.skillCost(a.who, a.skill, m, s)
      : a.type === "switch"
        ? T.switchCost(m)
        : a.type === "card"
          ? T.cardCost(a.id, a.target, m, s)
          : {};
  }
  function equipmentWanted(s, m, id, target) {
    const def = T.byId[id],
      carry = outputRole(s, m);
    if (!T.alive(s.characters[target])) return false;
    if (def?.type === "weapon") {
      return (
        T.weaponCompatible(id, target) &&
        m.weaponKinds[target] !== id &&
        s.characters[target].hp >= 4 &&
        !(id === "moon" && (m.weapons[0] ||
          (!battleObjective(s, m).developSupport && carry !== 0)))
      );
    }
    if (def?.type !== "artifact") return false;
    if (m.artifactKinds[target] === id && id !== "gilded") return false;
    if (id === "troupe" && target === s.active && m.artifacts[target]) return false;
    if (id === "gambler" && (target !== s.active || !enemy(s))) return false;
    if (id === "heart" && target !== s.active)
      return false;
    return true;
  }
  function setupEquipmentReachable(s, m, setup) {
    const future = copy(m);
    if (setup === "house") future.houses.push({ left: 2, round: -1 });
    if (setup === "garden") future.garden = true;
    for (const h of s.hand)
      for (let target = 0; target < 3; target++) {
        if (!equipmentWanted(s, m, h.id, target)) continue;
        const before = T.size(T.cardCost(h.id, target, m, s)),
          after = T.size(T.cardCost(h.id, target, future, s));
        if (
          after < before &&
          T.cardLegal(s, { type: "card", id: h.id, index: h.index, target }, future)
        )
          return true;
      }
    return false;
  }
  function switchTargets(s, m) {
    const covers = coverTargets(s, m).filter(target => retreatNeeded(s, m, target))
      .concat(endCoverTargets(s, m));
    return s.characters.flatMap((c, target) =>
      target !== s.active && T.alive(c) && !c.frozen &&
      !T.actionRefused(s, m, { type: "switch", target }) &&
      T.payment(s.dice,T.switchCost(m),T.team[target].element) &&
      (["E","Q","NA"].some(skill => followupReachable(s,m,{who:target,skill})) ||
        target===1 && m.gamingReturn || covers.includes(target)) ? [target] : []);
  }
