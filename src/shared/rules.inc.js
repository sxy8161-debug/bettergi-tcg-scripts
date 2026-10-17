// Shared rules fragments. Inlined at build time; no runtime dependency.

// @fragment tcg-rules.projectionBudget
// One synchronous decision, including nested helpers and failed projections.
// No cross-decision cache; exhaustion is not evidence of action illegality.
const projectionBudget = (() => {
  let current = null;
  return {
    run(limit, decide) {
      if (current) return decide();
      current = { used: 0, limit };
      try {
        const result = decide();
        return { ...result, projections: { ...current, exhausted: current.used >= current.limit } };
      } finally { current = null; }
    },
    available() { return !current || current.used < current.limit; },
    take() {
      if (!current) return true; // Standalone rule projection, not a decision.
      if (current.used >= current.limit) return false;
      current.used++; return true;
    },
  };
})();
// @endfragment tcg-rules.projectionBudget

// @fragment tcg-rules.strategyRegistry
(function (T) {
  const strategies = new Map();
  T.registerStrategy = function (id, choose) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || typeof choose !== "function" || strategies.has(id))
      throw new Error("策略标识无效、重复或缺少决策函数：" + id);
    strategies.set(id, choose);
  };
  T.selectStrategy = function (id) {
    if (!strategies.has(id)) throw new Error("未注册策略：" + id);
    T.choose = strategies.get(id);
    T.activeStrategy = id;
  };
  T.availableStrategies = function () { return [...strategies.keys()]; };
})(globalThis.TCG);
// @endfragment tcg-rules.strategyRegistry

// @fragment tcg-rules.OpeningFlow
class OpeningFlow {
    constructor(entry) {
      if (!["opening", "pick", "roll", "board"].includes(entry)) throw new Error("请在起手、首次选人、首次掷骰或未行动的新开局牌桌启动");
      this.entry = entry;
      this.route = [entry];
      this.opened = false;
      this.picked = false;
      this.rolled = false;
      this.complete = false;
    }
    record(stage) {
      const property = { opening: "opened", pick: "picked", roll: "rolled" }[stage];
      if (!property || this.complete || this[property]) throw new Error("开局阶段已确认或已结束，不重复执行：" + stage);
      this[property] = true;
      if (this.route[this.route.length - 1] !== stage) this.route.push(stage);
    }
    enterBoard(memory) {
      if (this.complete) return null;
      if (!known(memory.round) || memory.round > 1) throw new Error("开局回合状态不一致，不接管中途对局");
      const seeded = memory.round === 0;
      if (seeded) nextRound(memory);
      this.complete = true;
      if (this.route[this.route.length - 1] !== "board") this.route.push("board");
      return { entry: this.entry, route: this.route.slice(), round: memory.round, roundSeeded: seeded, midgameRestore: false };
    }
  }
// @endfragment tcg-rules.OpeningFlow

// @fragment tcg-rules.actionKey
function actionKey(action) {
    return action.type + ":" + (action.id || (["skill","probe"].includes(action.type) ? action.who + ":" + action.skill : action.target));
  }
// @endfragment tcg-rules.actionKey

// @fragment tcg-rules.countedPaymentBody
    const groups = Object.entries(dice || {}), need = size(cost),
      count = groups.reduce((n, [, amount]) => n + amount, 0);
    if (need > count || count > 16) return null;
    if (!need) return { indices: [], remaining: { ...dice }, ...emptyPaymentWeight };
    const counts = Array(groups.length).fill(0), offsets = [];
    let offset = 0, best = null;
    for (const [, amount] of groups) { offsets.push(offset); offset += amount; }
    function visit(at, left, weight, matching, aligned) {
      if (best && weight > best.weight) return;
      if (left === 0) {
        if (cost.n && matching < cost.n) return;
        const indices = counts.flatMap((n, i) => Array.from({ length: n }, (_, j) => offsets[i] + j));
        // Original subset enumeration chose the earliest slot list on equal
        // weight. Count enumeration preserves that tie without identical dice subsets.
        if (best && weight === best.weight) {
          const different = indices.findIndex((n, i) => n !== best.indices[i]);
          if (different < 0 || indices[different] > best.indices[different]) return;
        }
        const remaining = { ...dice };
        groups.forEach(([element], i) => { remaining[element] -= counts[i]; });
        best = { indices, remaining, weight }; return;
      }
      if (at === groups.length) return;
      const [element, amount] = groups[at],
        fee = element === "Omni" ? 10 : element === preserve ? 6 : secondaryPaymentWeights[element] || 1;
      for (let n = 0; n <= Math.min(amount, left); n++) {
        if (n && cost.aligned && element !== "Omni" && aligned && aligned !== element) continue;
        counts[at] = n;
        visit(at + 1, left - n, weight + n * fee,
          matching + (element === cost.element || element === "Omni" ? n : 0),
          n && element !== "Omni" ? element : aligned);
      }
      counts[at] = 0;
    }
    visit(0, need, 0, 0, null);
    return best;
// @endfragment tcg-rules.countedPaymentBody

// @fragment tcg-rules.alive
const alive = (c) => !!c && c.dead === false && known(c.hp) && c.hp > 0;
// @endfragment tcg-rules.alive

// @fragment tcg-rules.bag
function bag(hand) {
    const out = {};
    for (const h of hand || []) out[h.id] = (out[h.id] || 0) + 1;
    return out;
  }
// @endfragment tcg-rules.bag

// @fragment tcg-rules.cardCountDecreased
function cardCountDecreased(before, after, id) {
    // Unrelated hand growth or sent input cannot prove this card was consumed.
    return Array.isArray(before) && Array.isArray(after) &&
      (bag(before)[id] || 0) > (bag(after)[id] || 0);
  }
// @endfragment tcg-rules.cardCountDecreased

// @fragment tcg-rules.boardKey
function boardKey(s) {
    return JSON.stringify([s.active,diceOrder.map(e=>s.dice?.[e]||0),s.characters,
      (s.hand||[]).map(h=>h.id),s.enemies,s.quicken||null,s.supportCounts||null,s.eye||null,s.dendroCore||null]);
  }
// @endfragment tcg-rules.boardKey

// @fragment tcg-rules.characterName
function characterName(text) {
  const title=norm(text),canonical=characterAliases[title]||title;
  return team.findIndex(c=>norm(c.name)===norm(canonical));
}
// @endfragment tcg-rules.characterName

// @fragment tcg-rules.diceOrder
const diceOrder = ["Pyro","Hydro","Anemo","Electro","Dendro","Cryo","Geo","Omni"];
// @endfragment tcg-rules.diceOrder

// @fragment tcg-rules.enemyCount
function enemyCount(s) {
    const es=s?.enemies;
    if(!Array.isArray(es) || !es.length || !es.every(e=>e.dead===true || alive(e)))return null;
    return es.filter(alive).length;
  }
// @endfragment tcg-rules.enemyCount

// @fragment tcg-rules.freshActionBoard
function freshActionBoard(s) {
    // Visible checks reject obvious midgame positions, but cannot prove that
    // a zero-cost hidden status was never played. An explicit user declaration
    // is additionally required by main before admitting a board entry.
    return !!s && s.phase === "board" && ["user", "enemy"].includes(s.turn) &&
      legalState({ ...s, turn: "user", hand: [] }) && total(s.dice) === 8 &&
      s.characters.every((c, i) => c.hp === team[i].maxHp && c.energy === 0 && c.dead === false && c.frozen === false);
  }
// @endfragment tcg-rules.freshActionBoard

// @fragment tcg-rules.handCardKnown
function handCardKnown(h) {
    if (!h || typeof h.id !== "string") return false;
    if (byId[h.id]) return h.supported !== false;
    const parsed = observedCard(h.name, h.index);
    return h.supported === false && parsed && parsed.supported === false && parsed.id === h.id;
  }
// @endfragment tcg-rules.handCardKnown

// @fragment tcg-rules.identify
function identify(text) {
  const title = norm(text);
  // User-approved two-glyph anchor. Other titles remain exact aliases only.
  if (title.includes("运筹") && byId.draw) return byId.draw;
  const canonical = cardTitleAliases[title] || title;
  return cards.find(c => norm(c.name) === norm(canonical)) || null;
}
// @endfragment tcg-rules.identify

// @fragment tcg-rules.indexedHand
let handInstanceSerial = 0;
function indexedHand(hand) {
    if (!Array.isArray(hand) || !hand.every(handCardKnown)) throw new Error("手牌缓存身份不完整");
    return hand.map((h, index) => ({ ...h, index,
      instanceIds: h.instanceIds?.length ? h.instanceIds.slice() : [++handInstanceSerial] }));
  }
function handInstanceFacts(h) {
    return [h.currentCost ?? null, ...["empowered", "noTuning", "effectless", "reduction", "increase"]
      .map(k => h.attachments?.[k] ?? null)];
  }
// Quotes and failed attempts belong to one observed board, not a whole round.
// Card-fact probeKeys are independent and are never cleared here.
function skillQuoteKey(a) { return [a.who,a.skill,a.technique ?? null].join("/"); }
function skillQuote(s,m,a) {
    return m.skillCosts?.key === boardKey(s) ? m.skillCosts.entries[skillQuoteKey(a)] : undefined;
  }
function skillProbeAttempted(s,m,a) { return skillQuote(s,m,a) !== undefined; }
function recordSkillCost(s,m,a,n,source="native-skill-preview") {
    const key=boardKey(s);
    if(m.skillCosts?.key!==key)m.skillCosts={key,entries:{}};
    m.skillCosts.entries[skillQuoteKey(a)]={n,source};
  }
function clearSkillCosts(m) { m.skillCosts=null; }
function refreshSkillCosts(m,s) {
    if(m?.skillCosts&&m.skillCosts.key!==boardKey(s))clearSkillCosts(m);
  }
function drawConsumptionProven(a,b,s) {
    const r=s?.drawConsumption,h=b?.hand?.[a?.index];
    return a?.type==="card"&&byId[a.id]?.type==="draw"&&s.phase==="board"&&s.turn==="user"&&
      r?.kind==="native-paid-draw"&&r.beforeKey===boardKey(b)&&r.id===a.id&&r.index===a.index&&
      r.target===(a.target??null)&&r.inputSent===true&&r.stableReads===2&&r.cost>0&&
      h?.id===a.id&&r.sourceInstanceIds?.length>0&&JSON.stringify(r.sourceInstanceIds)===JSON.stringify(h.instanceIds)&&
      r.diceKey===JSON.stringify(diceOrder.map(e=>s.dice?.[e]||0));
  }
// Positive native rejection proves that input did not mutate the hand. Only
// that recovery may bind an unchanged complete ordered row directly. Else use
// native cost/attachment distinctions; indistinguishable copies stay ambiguous.
function reconcileHand(previous, observed, unchanged = false, uncertainRecords = []) {
    const next = indexedHand(observed), prior = previous || [],
      continuous = unchanged && prior.length === next.length && prior.every((h, i) => h.id === next[i].id),
      compatible = (a, b) => handInstanceFacts(a).every((v, i) => v === null || handInstanceFacts(b)[i] === null || v === handInstanceFacts(b)[i]);
    return next.map((h, index) => {
      if (continuous && prior[index].instanceIds?.length) return { ...h,
        instanceIds: prior[index].instanceIds.slice(), ...(prior[index].instanceAmbiguous ? {instanceAmbiguous:true} : {}) };
      const old = prior.filter(c => c.id === h.id && (compatible(c, h) ||
        uncertainRecords.some(r => r.id === c.id && (!r.instanceIds || r.instanceIds.some(id => c.instanceIds?.includes(id)))))),
        origins = [...new Set(old.flatMap(c => c.instanceIds || []))];
      if (!origins.length || h.instanceIds.every(id => origins.includes(id))) return h;
      if (old.length === 1 && next.filter(c => c.id === h.id && compatible(c, old[0])).length === 1)
        return { ...h, instanceIds: origins, ...(old[0].instanceAmbiguous ? {instanceAmbiguous:true} : {}) };
      return { ...h, instanceIds: [...new Set([...origins, ...h.instanceIds])], instanceAmbiguous: true };
    });
  }
function refusalScope(s, action, m) {
    const a = action.cardAction || action,
      handAction = ["card", "tune"].includes(a.type) || a.type === "probe" && a.scope === "card",
      card = handAction && s?.hand?.[a.index], actor = s?.characters?.[a.who ?? s.active],
      target = s?.characters?.[a.target], cost = s && root.TCG.refusalCost?.(s,m,a);
    return { type: a.type, id: a.id ?? null, target: a.target ?? null,
      who: a.who ?? null, skill: a.skill ?? null, technique: a.technique ?? null,
      element: a.type === "tune" ? a.element ?? team[s?.active]?.element ?? null : null,
      active: a.type === "card" && a.target == null ? s?.active ?? null : null,
      handAction, instanceIds: card?.id === a.id ? card.instanceIds?.slice() || null : null,
      conditions: s ? JSON.stringify([cost ? Object.keys(cost).sort().map(k => [k,cost[k]]) : null,
        diceOrder.map(e => s.dice?.[e] || 0), actor?.frozen, actor?.dead,
        a.skill === "Q" ? actor?.energy : null, target && [target.hp,target.dead,target.frozen],
        card ? handInstanceFacts(card) : null]) : null };
  }
function blockAction(m, action, before, uncertain = false) {
    const key = actionKey(action), scope = refusalScope(before, action, m);
    m.uncertainActions ||= [];
    if (!m.uncertainActions.includes(key)) m.uncertainActions.push(key);
    m.refusedActions ||= [];
    const record = { key, round: m.round, uncertain, ...scope };
    if (!m.refusedActions.some(r => JSON.stringify(r) === JSON.stringify(record))) m.refusedActions.push(record);
  }
function actionRefused(s, m, action) {
    const key = actionKey(action);
    const records = (m.refusedActions || []).filter(r => r.round === m.round && r.key === key);
    // Old callers may still supply display-only blocks. New records are never
    // interpreted as a name-wide ban through this compatibility path.
    if (!records.length) return (m.uncertainActions || []).includes(key);
    const scope = refusalScope(s, action, m);
    return records.some(r => ["type", "id", "target", "who", "skill", "technique", "element", "active"]
      .every(k => r[k] === scope[k] || ["active", "element"].includes(k) && (r[k] === null || scope[k] === null)) &&
      (!r.handAction || !r.instanceIds || !scope.instanceIds || r.instanceIds.some(id => scope.instanceIds.includes(id))) &&
      (r.uncertain || r.conditions === null || scope.conditions === null || r.conditions === scope.conditions));
  }
// @endfragment tcg-rules.indexedHand

// @fragment tcg-rules.known
const known = n => Number.isInteger(n) && n >= 0;
// @endfragment tcg-rules.known

// @fragment tcg-rules.norm
const norm = (t) =>
    String(t || "")
      .replace(/[\s:：·!！。，,（）()「」『』【】\[\]“”"‘’']/g, "")
      .replace(/迴/g, "回");
// @endfragment tcg-rules.norm

// @fragment tcg-rules.observedCard
function observedCard(text, index) {
    const name = String(text || "").trim(), t = norm(name), c = identify(name);
    if (c) return { index, id: c.id, name: c.name, supported: true };
    if (t.length < 2 || t.length > 24 || !/[\u3400-\u9fffA-Za-z]/.test(t) ||
        !/^[\u3400-\u9fffA-Za-z0-9「」『』\-—]+$/.test(t) ||
        /^(初始手牌|请选择要替换的手牌|确定|取消|出战角色|回合结束|元素调和)$/.test(t)) return null;
    return { index, id: "unsupported:" + t, name, supported: false };
  }
// @endfragment tcg-rules.observedCard

// @fragment tcg-rules.removedOne
function removedOne(before, after, id) {
    const b = bag(before), a = bag(after);
    return before.length === after.length + 1 && Object.keys({ ...b, ...a }).every(k => (b[k] || 0) - (a[k] || 0) === (k === id ? 1 : 0));
  }
// @endfragment tcg-rules.removedOne

// @fragment tcg-rules.rerollCounter
function rerollCounter(text) {
    const t=norm(text),values=[];
    for(const match of t.matchAll(/(?:还可重投([12])轮|(?:可重投次数|剩余重投次数|剩余次数)([12]))/g))
      values.push(Number(match[1]||match[2]));
    return values.length===1?values[0]:null;
  }
// @endfragment tcg-rules.rerollCounter

// @fragment tcg-rules.size
const size = cost => (cost.n || 0) + (cost.any || 0) + (cost.aligned || 0);
// @endfragment tcg-rules.size

// @fragment tcg-rules.total
const total = dice => Object.values(dice || {}).reduce((sum, n) => sum + n, 0);
// @endfragment tcg-rules.total
