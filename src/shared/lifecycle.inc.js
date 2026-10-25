// Shared lifecycle fragments. Inlined at build time; no runtime dependency.

// @fragment lifecycle.BOARD_RETRIES
const BOARD_RETRIES = ["TCG_BOARD_RETRY", "TCG_DICE_RETRY"];
// @endfragment lifecycle.BOARD_RETRIES

// @fragment lifecycle.BUDGET_FIELDS
const BUDGET_FIELDS = [
    "expectedDice",
    "emptyHandProven",
    "gamblerBudget",
  ];
// @endfragment lifecycle.BUDGET_FIELDS

// @fragment lifecycle.ELEMENT_NAMES
const ELEMENT_NAMES = {
    Pyro: "火",
    Hydro: "水",
    Anemo: "风",
    Electro: "雷",
    Dendro: "草",
    Cryo: "冰",
    Geo: "岩",
    Omni: "万能",
  };
// @endfragment lifecycle.ELEMENT_NAMES

// @fragment lifecycle.INPUT_REFRESHES
const INPUT_REFRESHES = ["TCG_OBSERVATION_INTERRUPTED", "TCG_HAND_REFRESH", "TCG_STATE_REFRESH"];
// @endfragment lifecycle.INPUT_REFRESHES

// @fragment lifecycle.admitActionHand
admitActionHand(state) {
      if (!this.actionEntryHandPending) return;
      if (state.hand?.length !== 7)
        throw new Error("新开局手牌数量不符：应有7张未使用的初始手牌，当前" + state.hand?.length + "张");
      this.host.trace("fresh-action-hand-verified", { count: state.hand.length, reusedFirstRead: true });
      this.actionEntryHandPending = false;
    }
// @endfragment lifecycle.admitActionHand

// @fragment lifecycle.checkStalled
checkStalled(message) {
      if (Date.now() >= this.deadline) throw new Error("达到单局时间上限，仍有未恢复的状态");
      if (Date.now() - this.lastProgress > 60000)
        this.notice("recovery:" + message, "[等待恢复] " + message.replace(/超时（60秒）/, "暂未读清") + "，继续核对，不重复输入。");
    }
// @endfragment lifecycle.checkStalled

// @fragment lifecycle.choice
async choice() {
      this.host.runStage = "choice";
      try {
        await this.host.resolveChoice(null, this.memory);
        this.progress();
      } catch (e) {
        await this.defer(e, ["TCG_CHOICE_RETRY"], "choice-deferred", "挑选卡牌等待超时（60秒）");
      }
      this.readyState = null;
    }
// @endfragment lifecycle.choice

// @fragment lifecycle.constructor
constructor(host, options) {
      this.host = host;
      this.options = options;
      this.memory = T.freshMemory();
      if(T.openingContext)this.memory.openingContext=T.openingContext({});
      host.memory=this.memory;
      this.deadline = Date.now() + options.maxMinutes * 60000;
      host.matchDeadline = this.deadline;
      this.actions = 0;
      this.lastProgress = Date.now();
      this.readyState = null;
      this.openingFlow = null;
      this.actionEntryHandPending = false;
      this.lastNotice = null;
    }
// @endfragment lifecycle.constructor

// @fragment lifecycle.defer
async defer(error, codes, event, message) {
      if (!codes.includes(error.code)) throw error;
      this.checkStalled(message);
      this.host.trace(event, { code: error.code, missing: error.missing, phase: error.phase,
        reason: String(error.message || error) });
      await sleep(400);
    }
// @endfragment lifecycle.defer

// @fragment lifecycle.enter
async enter() {
      const host = this.host;
      const manifest = JSON.parse(file.readTextSync("manifest.json"));
      host.trace("start", {
        version: manifest.version,
        scriptName: manifest.name,
        sharedVersion: T.sharedVersion,
        options: this.options,
      });
      host.trace("team-assumed", {
        names: T.team.map((c) => c.name),
        order: "left-to-right",
        userConfirmed: true,
      });
      await host.waitForCapture();
      const initial = host.phase();
      if (initial.phase === "result") {
        host.trace("terminal-entry", initial);
        log.info("当前对局已结束，请进入新对局后再启动。");
        return false;
      }
      this.openingFlow = new T.OpeningFlow(initial.phase);
      host.trace("opening-entry", {
        entry: initial.phase,
        actionEntry: this.options.actionEntry,
        midgameRestore: false,
      });
      if (initial.phase === "board") {
        if (this.options.actionEntry !== "确认新开局未行动")
          throw new Error("行动页启动需要选择“确认新开局未行动”");
        const board = await host.admitFreshActionBoard();
        host.expectedDice = T.total(board.dice);
        this.actionEntryHandPending = true;
        this.finishOpening();
      }
      return true;
    }
// @endfragment lifecycle.enter

// @fragment lifecycle.finishOpening
finishOpening() {
      const accepted = this.openingFlow.enterBoard(this.memory);
      if (!accepted) return;
      T.initializeOpening?.(this.memory);
      if (accepted.roundSeeded)
        this.host.trace("round", {
          round: this.memory.round,
          source: "verified-opening-board",
          keep: null,
        });
      this.host.trace("opening-ready", accepted);
    }
// @endfragment lifecycle.finishOpening

// @fragment lifecycle.notice
notice(key, text) {
      if (this.lastNotice !== key) {
        this.lastNotice = key;
        log.info(text);
      }
    }
// @endfragment lifecycle.notice

// @fragment lifecycle.opening
async opening() {
      this.host.runStage = "opening";
      const flow = this.openingFlow;
      if (flow.opened || flow.picked || flow.rolled || flow.complete)
        throw new Error("开局阶段异常：再次出现初始手牌");
      await this.host.opening();
      const kept = this.host.openingCards;
      if (this.options.mulligan === "全部保留") log.info("[起手] 按设置确认当前手牌，不主动置换。");
      else if (Array.isArray(kept))
        log.info(
          "[起手] " +
            (kept.length === 5
              ? "保留全部五张手牌，不置换。"
              : kept.length
                ? `保留${kept.map((c) => `「${c.name}」`).join("、")}，其余${5 - kept.length}张置换，寻找更合适的启动牌。`
                : "置换全部五张手牌，重新寻找启动牌。"),
        );
      this.memory.openingIds = (this.host.openingCards || []).map((c) => c.id);
      flow.record("opening");
      this.progress();
    }
// @endfragment lifecycle.opening

// @fragment lifecycle.pick
async pick() {
      this.host.runStage = "pick";
      if (this.openingFlow.complete || this.actions > 0) return this.replacement();
      if (this.openingFlow.picked) throw new Error("开局阶段异常：首次出战后再次出现选人页");
      const choice = this.planOpening();
      const after = await this.host.pick(choice.target, true);
      this.memory.lastActive = choice.target;
      this.openingFlow.record("pick");
      if (after?.phase === "board") this.finishOpening();
      this.progress();
    }
// @endfragment lifecycle.pick

// @fragment lifecycle.playerOptions
function playerOptions(settings = {}) {
  const supplied=settings||{};
  const defaultMinutes=TCG.defaultMaxMinutes||15;
  const options={enemyCount:3,maxMinutes:Number(supplied.maxMinutes||defaultMinutes),
    mulligan:TCG.openingSetting(supplied.mulligan),
    actionEntry:supplied.actionEntry||"禁止从行动页启动"};
  if(![10,15,20,30,defaultMinutes].includes(options.maxMinutes)||
    !["全部保留","优先装备与启动牌"].includes(options.mulligan)||
    !["禁止从行动页启动","确认新开局未行动"].includes(options.actionEntry))throw new Error("设置值无效");
  return options;
}
// @endfragment lifecycle.playerOptions

// @fragment lifecycle.progress
progress() {
      this.lastProgress = Date.now();
      this.lastNotice = null;
    }
// @endfragment lifecycle.progress

// @fragment lifecycle.awaitConfirmation
async awaitConfirmation(action, before, memory = this.memory) {
      this.host.matchDeadline = this.deadline;
      while (Date.now() < this.deadline) {
        try { return await this.host.confirm(action, before, memory); }
        catch (e) {
          if (!["TCG_CONFIRMATION_RETRY", "TCG_BOARD_RETRY", "TCG_DICE_RETRY", "TCG_HAND_RETRY"].includes(e.code)) throw e;
          this.notice("pending:" + T.actionKey(action), "[等待恢复] 动作已经提交，继续核对结果，不重复输入。");
          this.host.trace("confirmation-pending", { action, code: e.code, missing: e.missing,
            phase: e.phase?.phase, turn: e.phase?.turn, elapsedMs: e.elapsedMs, reason: e.message });
          const remaining = this.deadline - Date.now();
          if (remaining > 0) await sleep(Math.min(400, remaining));
        }
      }
      throw new Error("达到单局时间上限，待确认动作未能安全恢复");
    }
// @endfragment lifecycle.awaitConfirmation

// @fragment lifecycle.awaitObservation
async awaitObservation(plan) {
      while (Date.now() < this.deadline) {
        try { return await this.host.observe(true, plan); }
        catch (e) {
          await this.defer(e, [...BOARD_RETRIES, "TCG_HAND_RETRY"], "recovery-read-deferred", "牌桌重新同步超时（60秒）");
        }
      }
      throw new Error("达到单局时间上限，实际牌面仍未读清");
    }
// @endfragment lifecycle.awaitObservation

// @fragment lifecycle.recoverBeforeConfirmation
async recoverBeforeConfirmation(error, action, state, previousBudget) {
      const host = this.host;
      this.readyState = null;
      if (await this.recoverRejectedInput(error, action, state, previousBudget)) return;
      if (!INPUT_REFRESHES.includes(error.code)) throw error;
      Object.assign(host, previousBudget);
      host.trace("execution-deferred", { action, phase: error.phase?.phase, turn: error.phase?.turn,
        code: error.code, reason: String(error.message || error) });
      if (error.code !== "TCG_OBSERVATION_INTERRUPTED") {
        this.notice("resync", "[调整] 牌面发生变化，重新同步后继续。");
          let refreshed;
          try { refreshed = await host.observe(true, error.code === "TCG_HAND_REFRESH"
            ? { mode: "full", ...host.handContinuation } : { mode: "unchanged", hand: state.hand });
          } catch (e) {
            await this.defer(e, [...BOARD_RETRIES, "TCG_HAND_RETRY"], "execution-resync-deferred", "牌桌重新同步超时（60秒）");
            return;
          }
          if (refreshed.phase === "board" && refreshed.turn === "user" && T.legalState(refreshed)) {
            host.adoptObservedState(refreshed, "before-input-resync"); this.readyState = refreshed;
          }
      }
      await sleep(300);
    }
// @endfragment lifecycle.recoverBeforeConfirmation

// @fragment lifecycle.recoverRejectedInput
async recoverRejectedInput(error, action, state, previousBudget) {
      const tune = action.type === "tune";
      if (error.code !== "TCG_INPUT_REJECTED" && !(tune && error.code === "TCG_TUNE_UNCONFIRMED")) return false;
      const host = this.host;
      this.readyState = null;
      Object.assign(host, previousBudget);
      if (error.code === "TCG_INPUT_REJECTED") T.rejectAction(this.memory, action, state);
      let after = await this.awaitObservation({ mode: "full",
        ...(error.code === "TCG_INPUT_REJECTED" ? { rejectedHand: state.hand } : {}) });
      if (tune && error.code === "TCG_TUNE_UNCONFIRMED") {
        if (T.verifyResynchronized(action, state, after, false)) {
          // The same native effect predicate has confirmed recovery. Carry
          // that fact to commit, without changing the raw observed frame.
          after = { ...after, confirmed: true };
          T.commit(this.memory, action, state, after);
          host.trace("confirmed", { action, after, memory: this.memory, source: "tuning-recovery" });
          log.info("[调和] 已核实手牌消耗与元素骰变化，继续后续行动。");
        } else if (!this.rejectUnchangedTune(action, state, after)) {
          T.deferUncertain(this.memory, action, state);
          host.trace("action-uncertain", { action, after, memory: this.memory });
          log.warn("[调整] 调和结果未能确认，按实际牌面继续，不重复烧牌。");
        }
      } else {
        this.notice("input-rejected", tune
          ? "[调和] 当前牌未被游戏接受，改用其他牌或行动。"
          : "[调整] 当前行动未被游戏接受，重新同步后换一种选择。");
        host.trace("native-input-rejected", { action, reason: error.message });
      }
      if (T.legalState(after)) {
        host.adoptObservedState(after, tune ? "tuning-recovery-resync" : "native-rejection-resync");
        this.readyState = after;
      }
      T.noteBoard(this.memory, after);
      this.actions++;
      this.progress();
      return true;
    }
// @endfragment lifecycle.recoverRejectedInput

// @fragment lifecycle.rejectUnchangedTune
rejectUnchangedTune(action, before, after) {
      if (action.type !== "tune" || !T.legalState(after) || T.boardKey(before) !== T.boardKey(after))
        return false;
      T.rejectAction(this.memory, action, before);
      this.host.trace("tuning-retry-alternative", { action, proof: "full-hand-and-board-unchanged" });
      const card = before.hand[action.index]?.name || "这张牌";
      this.notice("tune-rejected:" + action.id, `[调和] 「${card}」未调和成功，手牌与骰子未变，改用其他牌或行动。`);
      return true;
    }
// @endfragment lifecycle.rejectUnchangedTune

// @fragment lifecycle.replacement
async replacement() {
      this.host.runStage = "replacement";
      const host = this.host,
        memory = this.memory;
      this.readyState = null;
      try {
        if (host.forcedPickSession) {
          const after = await host.pick(host.forcedPickSession.target, false);
          if (after) T.noteBoard(memory, after);
          this.progress();
          return;
        }
        const board = host.board();
        T.noteBoard(memory, board);
        const wanted = T.replacement(board, memory);
        if (!wanted) {
          const error = new Error("阵亡后的存活角色未读清");
          error.code = "TCG_PICK_RETRY";
          throw error;
        }
        host.trace("replacement-plan", {
          target: wanted.who,
          characters: board.characters,
          dice: board.dice,
        });
        host.trace("replacement-hand-policy", {
          mode: host.handCache === null ? "full-read-required" : "reuse-with-visible-count-check",
        });
        const defeated = board.characters.flatMap((c, i) =>
          c.dead === true ? [T.team[i].name] : [],
        );
        this.notice(
          "replacement:" + defeated.join(",") + ":" + wanted.who,
          "[接力] " +
            (defeated.length ? defeated.join("、") + "已阵亡，" : "") +
            "准备切换" +
            T.team[wanted.who].name +
            "继续作战。",
        );
        const after = await host.pick(wanted.who, false);
        if (after) T.noteBoard(memory, after);
        this.progress();
      } catch (error) {
        await this.defer(
          error,
          ["TCG_PICK_RETRY", ...BOARD_RETRIES],
          "replacement-deferred",
          "阵亡换人识别超时（60秒）",
        );
      }
    }
// @endfragment lifecycle.replacement

// @fragment lifecycle.roll
async roll() {
      this.host.runStage = "roll";
      const flow = this.openingFlow;
      if (!flow.complete && flow.rolled) throw new Error("开局阶段异常：首次掷骰后再次出现重投页");
      if (!flow.complete && !flow.picked && this.memory.openingTarget === null)
        this.planOpening("before-initial-roll");
      const after = await this.host.roll(this.memory, {
        allowInitialPick: !flow.complete && !flow.picked,
      });
      if (!flow.complete) {
        flow.record("roll");
        if (after?.phase === "board") this.finishOpening();
      }
      this.progress();
    }
// @endfragment lifecycle.roll

// @fragment lifecycle.run
async run() {
      try {
        this.host.runStage = "entry";
        if (await this.enter() === false) return;
        while (Date.now() < this.deadline && this.actions < 180) {
          this.host.runStage = "phase-wait";
          const sampledAt = Date.now();
          const p = this.host.phase();
          if (p.phase !== "board" || p.turn !== "user") this.readyState = null;
          if (p.result) {
            this.host.trace("result", p);
            this.reportResult(p);
            return;
          }
          if (this.host.forcedPickSession) await this.replacement();
          else if (this.host.choiceSession || p.phase === "choice") await this.choice();
          else if (p.phase === "opening") await this.opening();
          else if (p.phase === "pick") await this.pick();
          else if (p.phase === "roll") await this.roll();
          else if (p.turn === "user") await this.act();
          else {
            this.checkStalled("对局等待超时（60秒）");
            const remaining = 500 - (Date.now() - sampledAt);
            if (remaining > 0) await sleep(remaining);
          }
        }
        throw new Error("达到单局时间或动作上限");
      } catch (e) {
        const reason = String(e.message || e);
        this.host.reportStop(reason, e.code);
        log.error("牌手停止：" + reason);
        throw e;
      } finally {
        this.host.dispose();
      }
    }
// @endfragment lifecycle.run

// @fragment lifecycle.observe
async observe() {
      const host = this.host, start = Date.now(), metrics = host.metricSnapshot?.(),
        reused = !!this.readyState;
      host.runStage = "observation";
      let state, outcome = "failed", failure = null, readError = null;
      try {
        try { state = this.readyState || (await host.observe()); }
        catch (e) {
          readError = e;
          this.readyState = null;
          await this.defer(e, [...BOARD_RETRIES, "TCG_HAND_RETRY"], "observation-deferred", "牌桌识别超时（60秒）");
          outcome = "deferred";
          return null;
        }
        if (this.readyState)
          host.trace("decision-state-reused", { handCount: this.readyState.hand.length });
        this.readyState = null;
        if (state.phase !== "board" || state.turn !== "user") {
          host.trace("decision-deferred", { phase: state.phase, turn: state.turn });
          await sleep(300);
          outcome = "deferred";
          return null;
        }
        this.admitActionHand(state);
        if (!this.openingFlow.complete) this.finishOpening();
        T.refreshSkillCosts(this.memory,state);
        T.noteBoard(this.memory, state);
        host.trace("state", { round: this.memory.round, state, memory: this.memory });
        outcome = "complete";
        return state;
      } catch (e) { failure = e; throw e; }
      finally {
        try {
          host.trace("observation-timing", { ms: Date.now() - start, reused, outcome,
            handRead: state?.handRead, code: readError?.code, missing: readError?.missing,
            recognition: host.metricDelta?.(metrics) });
        } catch (e) { if (!failure) throw e; } // Secondary diagnostic failure must not replace the original error.
      }
    }
// @endfragment lifecycle.observe

// @fragment lifecycle.execute
async execute(action, state) {
      const budget = Object.fromEntries(BUDGET_FIELDS.map(key => [key, this.host[key]]));
      try { return { sent: true, result: await this.host.execute(action, state, this.memory) }; }
      catch (e) { await this.recoverBeforeConfirmation(e, action, state, budget); return { sent: false }; }
    }
// @endfragment lifecycle.execute

// @fragment lifecycle.act
async act() {
      const state = await this.observe();
      if (!state) return;
      const host = this.host, memory = this.memory, started = Date.now(), metrics = host.metricSnapshot?.();
      let action, inputAt = null, confirmationAt = null, postActionAt = null,
        outcome = "failed", confirmed = false, failure = null;
      host.runStage = "planning";
      try {
        action = T.choose(state, memory);
        host.trace("decision", action);
        if (action.type === "stop") throw new Error(action.reason);
        inputAt = Date.now(); host.runStage = "input";
        const execution = await this.execute(action, state);
        if (!execution.sent) { outcome = "not-submitted"; return; }
        log.info("[第" + memory.round + "回合] " + actionCommentary(action, state, memory));
        if (action.type === "probe" && execution.result?.probed) {
          outcome = "probed"; this.readyState = execution.result; this.progress(); return;
        }
        confirmationAt = Date.now(); host.runStage = "confirmation";
        const after = await this.awaitConfirmation(action, state, memory);
        postActionAt = Date.now(); host.runStage = "post-action";
        confirmed = !!after.confirmed;
        if (after.confirmed) {
          T.commit(memory, action, state, after);
          host.trace("confirmed", { action, after, memory });
        } else if (!(after.handRead === "full" && this.rejectUnchangedTune(action, state, after))) {
          T.deferUncertain(memory, action, state);
          host.trace("action-uncertain", { action, after, memory });
          log.warn("动作效果未确认，已重新同步，不重复输入。");
        }
        T.noteBoard(memory, after);
        host.handContinuation = after.handContinuation || null;
        const refreshHand = after.confirmed && after.handRefreshRequired === true;
        if (refreshHand) {
          // Consumption can precede card insertion (native draw 3 -> 2). Do not
          // plan from that partial hand. This also covers non-draw categories
          // explicitly declaring delayed insertion. No predicted count or replayed input.
          host.invalidateHand("consumed-hand-changing-card-needs-fresh-hand", host.handContinuation);
          host.trace("draw-hand-refresh-required", { id: action.id, beforeCount: state.hand.length,
            observedCount: after.hand.length, handPlanMode: "full", consumptionConfirmed: true, effectsComplete: false });
        }
        if (refreshHand || after.confirmed && after.freshObservationRequired) {
          // A new observe(), not a blanket sleep or a model-damage predicate.
          // Drop the recent-board shortcut too; unchanged hand identity may stay.
          this.readyState = null;
          host.boardReady = false; host.lastObservedAt = 0; host.lastObservedRevision = -1;
          host.preparedHandInput = null;
          if (after.freshObservationRequired) host.autoRisk = true;
          host.trace("post-confirmation-refresh-required", { action, handRefresh: refreshHand,
            combatWithoutObservedTransition: after.freshObservationRequired === true,
            quietObservationRequired: after.freshObservationRequired === true,
            consumptionConfirmed: after.confirmed, effectsComplete: false });
        } else if (after.phase === "board" && after.turn === "user" && T.legalState(after)) this.readyState = after;
        this.actions++; this.progress();
        outcome = confirmed ? "confirmed" : "unconfirmed";
      } catch (e) { failure = e; throw e; }
      finally {
        const ended = Date.now();
        try {
          host.trace("action-timing", { action: action ? T.actionKey(action) : null, outcome, confirmed,
            planningMs: (inputAt ?? ended) - started,
            inputMs: (confirmationAt ?? ended) - (inputAt ?? ended),
            settlementMs: (postActionAt ?? ended) - (confirmationAt ?? ended),
            postActionMs: ended - (postActionAt ?? ended), totalMs: ended - started,
            recognition: host.metricDelta?.(metrics), scope: "actual-runtime-not-offline-estimate" });
        } catch (e) { if (!failure) throw e; } // Keep cancellation/program errors intact.
      }
    }
// @endfragment lifecycle.act
