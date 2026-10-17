"use strict";
const assert = require("node:assert/strict");
const { load, board } = require("./runtime.cjs");
const clone = value => JSON.parse(JSON.stringify(value));
const memory = T => { const m = T.freshMemory(); T.nextRound(m); return m; };
const enemies = (s, hp, aura = []) => {
  s.enemies = hp.map((hp, i) => ({ hp, dead: false, active: i === 0,
    auraKnown: true, aura: i === 0 ? aura : [], defenseKnown: true }));
};

// In-memory packageFiles runtime; no build directory, private fixtures or game APIs.
module.exports = async function (test) {
  const { T } = load("iansan");
  await test("R07: paid card refunds preserve ordered colours, capacity and equipment effects", () => {
    for (const count of [15, 16]) for (const boar of [0, 1]) {
      const s = board(T, ["gilded"]), m = memory(T);
      s.dice = { Omni: count }; m.garden = true; m.boar = boar;
      m.artifacts[0] = true; m.artifactKinds[0] = "troupe";
      const a = { type: "card", id: "gilded", index: 0, target: 0 },
        before = JSON.stringify([s, m]), p = T.simulate(s, m, a);
      assert.equal(T.cardLegal(s, a, m), true);
      assert.ok(p, `Gilded ${count} dice, Boar ${boar} remains executable`);
      assert.equal(p.state.dice.Omni, count - 1, "pay first; Gilded fills capacity before Boar");
      assert.equal(p.state.dice.Electro, 17 - count);
      assert.equal(T.total(p.state.dice), 16);
      assert.equal(p.state.hand.length, 0);
      assert.equal(T.refundedCardEffect(a,s,p.state,m),true,"the same capped colours prove native consumption");
      assert.equal(p.memory.artifactKinds[0], "gilded");
      assert.equal(p.memory.garden, false);
      assert.equal(p.memory.boar, 0, "replacement still consumes the Boar trigger at capacity");
      assert.equal(JSON.stringify([s, m]), before, "projection leaves observed inputs intact");
    }
    for (const [id, count, expected, target] of [
      ["gilded", 8, 10, 0], ["troupe", 16, 16, 0],
      ["companion", 16, 16, null], ["lost", 16, 16, null], ["lost", 15, 16, null],
    ]) {
      const s = board(T, [id]), m = memory(T);
      s.dice = { Omni: count }; m.garden = true; m.boar = 1;
      m.artifacts[0] = true; m.artifactKinds[0] = "heart"; m.defeatRound = m.round;
      const p = T.simulate(s, m, { type: "card", id, index: 0, target });
      assert.ok(p, id); assert.equal(T.total(p.state.dice), expected, id);
      assert.equal(p.state.hand.length, 0);
      if (id === "lost") assert.equal(p.state.characters[0].energy, 1);
    }
  });
  await test("R07: proven Gambler kills and return hits cap generation; unknown defence cannot fund dice", () => {
    for (const count of [15, 16]) {
      const s = board(T), m = memory(T);
      s.active = 2; s.dice = { Omni: count }; enemies(s, [1, 1, 1], ["Hydro"]);
      m.artifacts[2] = true; m.artifactKinds[2] = "gambler";
      const a = { type: "skill", who: 2, skill: "E" }, p = T.simulate(s, m, a);
      assert.ok(p, `three proven defeats at ${count} dice`);
      assert.equal(T.total(p.state.dice), 16);
      assert.equal(T.enemyCount(p.state), 0);
      const unknown = clone(s); unknown.enemies.forEach(e => { delete e.defenseKnown; });
      assert.equal(T.total(T.simulate(unknown, m, a).state.dice), count - 3);
      const r = board(T), n = memory(T);
      r.dice = { Omni: count }; enemies(r, [1, 10, 10]);
      n.gamingReturn = true; n.artifacts[1] = true; n.artifactKinds[1] = "gambler";
      const q = T.simulate(r, n, { type: "switch", target: 1 });
      assert.ok(q, `automatic return at ${count} dice`);
      assert.equal(T.total(q.state.dice), 16);
      assert.equal(q.state.enemies[0].hp, 0);
      assert.equal(q.memory.gamingReturn, false);
      assert.equal(q.state.characters[1].energy, 1);
    }
    const s = board(T, ["revel", "wolf", "moon", "gilded", "troupe"]), m = memory(T);
    s.dice = { Omni: 16 };
    const p = T.simulate(s, m, { type: "card", id: "revel", index: 0, target: null });
    assert.equal(T.total(p.state.dice), 16);
    assert.equal(p.state.hand.length, 4);
    assert.equal(p.leaf, true, "unknown cards are not made playable");
  });
  await test("R08: damage requires a unique living active target across manual, talent and return paths", () => {
    for (const activeCount of [0, 2]) {
      const s = board(T, ["skivingNewAndImproved"]), m = memory(T);
      enemies(s, [10, 10, 10]); s.enemies.forEach((e, i) => { e.active = i < activeCount; });
      const before = JSON.stringify(s), d = T.damageEstimate(s, m, 0, "NA");
      assert.equal(T.applyDamage(s, d), null, `active count ${activeCount}`);
      assert.equal(JSON.stringify(s), before);
      assert.equal(T.simulate(s, m, { type: "skill", who: 0, skill: "NA" }), null);
      s.active = 2;
      assert.equal(T.simulate(s, m,
        { type: "card", id: "skivingNewAndImproved", index: 0, target: 2 }), null);
      s.active = 0; m.gamingReturn = true;
      assert.equal(T.simulate(s, m, { type: "switch", target: 1 }), null);
      m.sayuSummon = 2;
      assert.equal(T.summonValue(s, m), 0, "no phantom summon damage");
    }
  });
  await test("R08: replacement outranks draw valuation; observed replacement restores normal planning", () => {
    const s = board(T), m = memory(T);
    s.dice = { Electro: 6 }; enemies(s, [1, 10, 10], ["Dendro"]);
    // Match the review's native-shaped board, which does not assert known defence.
    s.enemies.forEach(e => { delete e.defenseKnown; });
    m.artifacts[0] = true; m.artifactKinds[0] = "gilded";
    const a = { type: "skill", who: 0, skill: "E" }, p = T.simulate(s, m, a);
    assert.deepEqual(clone(p.state.enemies.map(e => e.hp)), [0, 10, 10]);
    assert.equal(p.state.enemies.some(e => e.active), false);
    assert.equal(p.benefit, 5.1, "keep the real hit, defeat and triggered draw value");
    assert.equal(p.memory.gildedDrawUsed[0], 1);
    assert.equal(p.leaf, true);
    assert.equal(p.boundary, null);
    assert.equal(T.simulate(p.state, p.memory, { type: "skill", who: 0, skill: "NA" }), null);
    const chosen = T.choose(s, m);
    assert.equal(chosen.skill, "E");
    assert.equal(chosen.search.boundaryPayoff ?? null, null);
    assert.deepEqual(clone(chosen.search.sequence), [a]);
    const resumed = clone(p.state); resumed.enemies[1].active = true;
    const hit = T.simulate(resumed, p.memory, { type: "skill", who: 0, skill: "NA" });
    assert.ok(hit); assert.ok(hit.state.enemies[1].hp < 10);
    const drawOnly = clone(s); drawOnly.enemies[0].hp = 10;
    const draw = T.simulate(drawOnly, m, a), drawChoice = T.choose(drawOnly, m);
    assert.equal(draw.boundary.kind, "unknown-draw");
    assert.equal(drawChoice.search.boundaryPayoff?.knownOnly, true);
    assert.ok(drawChoice.search.boundaryPayoff.sequence.length > 0);
  });
  await test("R05: candidates, tuning and funding query the actual instance and local conditions", () => {
    const s = board(T, ["troupe", "troupe"]), m = memory(T),
      a = { type: "card", id: "troupe", index: 0, target: 0 };
    T.rejectAction(m, a, s);
    const cards = T.enumerate(s, m).filter(x => x.type === "card" && x.id === a.id);
    assert.ok(!cards.some(x => x.index === 0 && x.target === 0));
    assert.ok(cards.some(x => x.index === 1 && x.target === 0));
    assert.ok(cards.some(x => x.index === 0 && x.target === 1));
    assert.equal(T.simulate(s, m, a), null, "direct projections cannot bypass the matcher");
    const t = board(T, ["sweet", "sweet"]), n = memory(T);
    t.dice = { Electro: 2, Hydro: 1 };
    T.rejectAction(n, { type: "tune", id: "sweet", index: 0, element: "Electro" }, t);
    assert.deepEqual(clone(T.burnableHand(t, n).map(h => h.index)), [1]);
    assert.equal(T.tuningPlan(t, n, { who: 0, skill: "E" }).card.index, 1);
    const f = board(T), k = memory(T);
    f.active = 2; f.dice = { Omni: 4 };
    T.rejectAction(k, { type: "skill", who: 0, skill: "E" }, f);
    assert.equal(T.followupReachable(f, k, { who: 0, skill: "E" }), true,
      "the paid switch changes the conditions before the funded skill");
    const o = board(T, ["sing", "sing"]), om = memory(T);
    o.dice = { Omni: 6 };
    T.rejectAction(om, { type: "card", id: "sing", index: 0, target: null }, o);
    assert.equal(T.singOpening(o, om)?.index, 1);
    const d = board(T, ["house", "house", "wolf"]), dm = memory(T);
    d.active = 2; d.dice = { Omni: 2 };
    T.rejectAction(dm, { type: "card", id: "house", index: 0, target: null }, d);
    assert.equal(T.discountPreparation(d, dm,
      { type: "card", id: "wolf", index: 2, target: 2 })?.index, 1);
  });
  await test("R05: replay preserves the selected copy and its provenance across a preparation", () => {
    const s = board(T, ["troupe", "troupe"]), m = memory(T),
      a = { type: "card", id: "troupe", index: 1, target: 0 },
      p = T.replaySequence(s, m, [a]);
    assert.equal(p.path[0].index, 1);
    assert.deepEqual(clone(p.state.hand[0].instanceIds), clone(s.hand[0].instanceIds));
    T.rejectAction(m, { ...a, index: 0 }, s);
    assert.ok(T.replaySequence(s, m, [a]), "a refused sibling cannot replace the chosen copy");
    const b = board(T, ["house", "troupe", "troupe"]), n = memory(T),
      selected = { ...a, index: 2, instanceIds: clone(b.hand[2].instanceIds) };
    T.rejectAction(n, { ...a, index: 1 }, b);
    const q = T.replaySequence(b, n,
      [{ type: "card", id: "house", index: 0, target: null }, selected]);
    assert.ok(q);
    assert.equal(q.path[1].index, 1, "locate the original instance after the prefix removed a slot");
    assert.deepEqual(clone(q.state.hand[0].instanceIds), clone(b.hand[1].instanceIds));
    const ambiguous = clone(b);
    ambiguous.hand[1].instanceIds = clone(b.hand[2].instanceIds);
    assert.equal(T.replaySequence(ambiguous, n, [selected]), null,
      "ambiguous provenance cannot silently choose the first matching card");
  });
};

