// Shared opening fragments. Inlined at build time; no runtime dependency.

// @fragment bgi-host.actionReroll
async actionReroll(before, memory = TCG.freshMemory()) {
      const count = TCG.total(before.dice);
      if (count < 1 || count > 16) throw new Error("战中重投的真实骰数无效");
      const goal = TCG.actionRerollGoal(before, memory);
      if (!this.tossSession)
        this.tossSession = {
          sent: 0,
          expected: 2,
          selection: null,
          wanted: goal?.element || TCG.team[before.active].element,
          transitioned: false,
          previousDice: null,
          blankReady: false,
          blankSent: false,
        };
      const session = this.tossSession,
        counterROI = [700, 835, 520, 65];
      let stable = 0,
        key = "",
        lastTrace = "",
        lastError = "重投页面尚未稳定";
      for (let attempt = 0; attempt < 60; attempt++) {
        let page;
        try {
          page = this.frame((f) => {
            const phase = this.phaseIn(f);
            if (phase.phase !== "roll") return { phase };
            const text = this.ocr(f, this.roi("bottom", counterROI)),
              remaining = TCG.rerollCounter(text);
            const blank = remaining === null && TCG.norm(text) === "";
            return {
              phase,
              text,
              remaining,
              blank,
              blankHeader: blank
                ? TCG.norm(this.ocr(f, this.roi("header", [844, 167, 232, 65]))) === "重投骰子" &&
                  TCG.norm(this.ocr(f, this.roi("header", [700, 230, 520, 50]))) === "请选择要重投的骰子"
                : false,
              buttons: this.matches(f, "core/确定", this.roi("bottom", [500, 900, 920, 150])),
              dice:
                !session.selection &&
                (remaining === session.expected ||
                  (blank && session.sent === 1) ||
                  (session.blankSent && session.sent === 2 && remaining === 1))
                  ? this.diceIn(f, true, count, true)
                  : null,
            };
          });
        } catch (e) {
          if (e.code !== "TCG_DICE_RETRY") throw e;
          lastError = e.message;
          stable = 0;
          key = "";
          await sleep(300);
          continue;
        }
        const p = page.phase;
        if (session.sent > 0 && p.phase !== "roll") session.transitioned = true;
        if (p.phase === "board" && p.turn === "user" && session.sent < 2) {
          const observed = await this.settledBoard(true);
          if (observed.phase === "board" && observed.turn === "user") {
            this.tossSession = null;
            this.trace("action-reroll-resolved", { count, confirmations:session.sent,
              wanted:session.wanted, recovery:"complete-native-board", unresolved:true });
            return { confirmations:session.sent, inputConfirmations:session.sent, unresolved:true };
          }
          stable = 0; key = ""; await sleep(300); continue;
        }
        if (p.result || (p.phase === "board" && p.turn === "user" && session.sent >= 2)) {
          const current = JSON.stringify([p.phase, p.turn, p.result]);
          stable = current === key ? stable + 1 : 1;
          key = current;
          if (stable >= 2) {
            this.trace("action-reroll-resolved", {
              count,
              confirmations: session.sent,
              wanted: session.wanted,
            });
            this.tossSession = null;
            return { confirmations: 2, inputConfirmations: session.sent };
          }
          await sleep(300);
          continue;
        }
        const traceKey = JSON.stringify([p.phase, page.remaining, page.text, page.buttons?.length]);
        if (traceKey !== lastTrace) {
          this.trace("action-reroll-page", {
            phase: p.phase,
            remaining: page.remaining,
            text: page.text,
            expected: session.expected,
            count,
            wanted: session.wanted,
          });
          lastTrace = traceKey;
        }
        const diceKey = page.dice ? JSON.stringify(page.dice.items) : null;
        const blankOK =
          page.blank &&
          page.blankHeader &&
          session.sent === 1 &&
          (session.blankReady ||
            session.transitioned ||
            (diceKey !== null && diceKey !== session.previousDice));
        // A counterless page may be either the second selection or an interim
        // acknowledgement. Only an explicit subsequent "1" permits a third
        // button confirmation; never repeat a counterless page after sending it.
        const countedOK =
          (page.remaining === session.expected && session.sent < 2) ||
          (session.blankSent && session.sent === 2 && page.remaining === 1);
        if (
          p.phase !== "roll" ||
          !(countedOK || blankOK) ||
          page.buttons.length !== 1 ||
          session.sent >= 3
        ) {
          lastError = page.remaining === null ? "战中重投次数未识别" : "战中重投页面未就绪";
          stable = 0;
          key = "";
          await sleep(300);
          continue;
        }
        if (!session.selection) {
          const bad = page.dice.items.filter(
            (d) => d.element !== session.wanted && d.element !== "Omni",
          );
          // Persist selection BEFORE any input. A delayed OCR/control cannot
          // cause a second click to toggle the same die back off.
          session.blankReady = blankOK;
          session.selection = {
            remaining: page.remaining,
            selected: bad.length,
            diceKey,
            blank: blankOK,
          };
          for (const die of bad) {
            this.clickAt(die.x, die.y);
            await sleep(120);
          }
          stable = 0;
          key = "";
          await sleep(250);
          continue;
        }
        // Fresh same-frame phase, exact counter and unique control after dice
        // selection. Empty OCR retries read-only; no selection replay.
        const b = page.buttons[0];
        this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
        // 1440 can restore the raised fan on leaving reroll. Let the existing
        // action-board boundary fold it before reading HP/death/status again.
        const actual = this.captureGeometry?.actualSize;
        if (actual?.width === 2560 && [1440,1600].includes(actual.height)) this.handNeedsReset = true;
        session.sent++;
        session.expected = page.remaining === null ? 0 : page.remaining - 1;
        const selected = session.selection.selected;
        session.previousDice = session.selection.diceKey;
        session.blankSent ||= session.selection.blank;
        session.selection = null;
        session.blankReady = false;
        session.transitioned = false;
        this.trace("action-reroll-confirmed", {
          remaining: page.remaining,
          selected,
          count,
          wanted: session.wanted,
        });
        stable = 0;
        key = "";
        await sleep(1000);
      }
      this.trace("action-reroll-layout", { reason: lastError });
      const error = new Error("战中重投等待超时：" + lastError);
      error.code = "TCG_DICE_RETRY";
      throw error;
    }
// @endfragment bgi-host.actionReroll

// @fragment bgi-host.confirmOpening
async confirmOpening(data) {
      if (this.phase().phase !== "opening") throw new Error("确认起手前页面已改变");
      this.moveTo(1791, 860);
      await sleep(150);
      await this.clickButton("确定", this.roi("bottom", [720, 880, 480, 140]));
      // Confirm exactly once, then prove progression; no blind double-click.
      let stable = 0,
        previous = "";
      for (let attempt = 0; attempt < 40; attempt++) {
        const p = this.phase();
        const accepted = ["pick", "roll"].includes(p.phase);
        stable = accepted ? (p.phase === previous ? stable + 1 : 1) : 0;
        if (p.phase !== previous || attempt === 0)
          this.trace("opening-confirm-wait", { attempt, phase: p.phase });
        previous = p.phase;
        if (stable >= 2) {
          this.trace("opening-confirmed", { ...data, phase: p.phase });
          return p;
        }
        if (!["opening", "unknown", "transition", "pick", "roll"].includes(p.phase))
          throw new Error("起手确认后出现意外页面：" + p.phase);
        if (attempt < 39) await sleep(400);
      }
      throw new Error("初始手牌确认未生效：未进入稳定的选人或掷骰页");
    }
// @endfragment bgi-host.confirmOpening

// @fragment bgi-host.firstPickObservation
firstPickObservation() {
      // Read the already-opened target title and phase from ONE fresh frame.
      // No startup inspection of all roles and no extra character-detail click.
      return this.frame((f) => {
        const p = this.phaseIn(f);
        return {
          ...p,
          selectedTarget:
            p.phase === "pick" ? TCG.characterName(this.ocr(f, this.roi("details", [311, 115, 341, 50]))) : null,
        };
      });
    }
// @endfragment bgi-host.firstPickObservation

// @fragment bgi-host.pickSelectionIn
pickSelectionIn(f) {
      // Native forced selection can leave ALL character cards lowered. The
      // selected card opens its exact identity and a dedicated selection banner.
      return {
        who: TCG.characterName(this.ocr(f, this.roi("details", [311, 115, 341, 50]))),
        banner: TCG.norm(this.ocr(f, this.roi("phase", [700, 508, 580, 65]))),
      };
    }
// @endfragment bgi-host.pickSelectionIn

// @fragment bgi-host.readRollDice
async readRollDice() {
      let previousKey = "",
        observed = null,
        lastError = "骰子尚未稳定";
      for (let attempt = 0; attempt < 12; attempt++) {
        const p = this.phase();
        if (p.phase !== "roll" && p.phase !== "unknown")
          throw new Error("稳定识别骰子前已离开投骰页");
        if (p.phase === "roll") {
          try {
            observed = this.frame((f) => this.diceIn(f, true));
            const key = JSON.stringify(observed.items.map((d) => [d.slot, d.element]));
            this.trace("roll-dice-wait", {
              attempt,
              stable: key === previousKey,
              count: observed.items.length,
            });
            if (key === previousKey) return observed;
            previousKey = key;
            lastError = "八颗骰子的分类尚未取得连续两帧一致";
          } catch (e) {
            if (e.code !== "TCG_DICE_RETRY") throw e;
            previousKey = "";
            lastError = String(e.message || e);
            this.trace("roll-dice-wait", { attempt, stable: false, error: lastError });
          }
        } else previousKey = "";
        if (attempt < 11) await sleep(500);
      }
      throw new Error("重投骰子识别12次未稳定：" + lastError);
    }
// @endfragment bgi-host.readRollDice

// @fragment tcg-ui.opening
async opening() {
      const startingXs = [383, 665, 960, 1248, 1535];
      if (TCG.openingSetting(this.options.mulligan) === "全部保留") {
        await this.confirmOpening({
          policy: "confirm-current",
          reason: "keep-setting",
          selectedByScript: [],
        });
        return;
      }
      // User and native tests confirmed hover does not reveal these titles.
      // One click reads a title AND toggles replacement; track the actual
      // marker, then adjust only the final mismatches. No hover probe.
      const original = await this.openingSelections(startingXs);
      let selected = original.slice(), pendingInspection = null;
      const cards = [];
      const recordInput = (index, purpose, observed) => {
        const verified = !!observed && observed.every((value, i) => value === (i === index ? !selected[i] : selected[i]));
        this.trace("opening-card-input", {index, purpose, before:selected[index], after:observed?.[index]??null, verified});
        return verified;
      };
      const toggle = async (index, purpose) => {
        // First card's centre is covered by its own left detail panel.
        this.clickAt(...this.point("opening",startingXs[index]+70,540));
        await sleep(350);
        let observed;
        try { observed = await this.openingSelections(startingXs); }
        catch (error) { recordInput(index, purpose, null); throw error; }
        if (!recordInput(index, purpose, observed)) {
          throw new Error("起手置换标记未证实，不重复点击第" + (index + 1) + "张牌");
        }
        selected = observed;
      };
      try {
        for (let i = 0; i < 5; i++) {
          pendingInspection = i;
          const raw = await this.titleAt(startingXs[i] + 70, 540, true, false);
          let observed;
          try { observed = await this.openingSelections(startingXs); }
          catch (error) { recordInput(i, "inspect-unknown", null); pendingInspection = null; throw error; }
          const verified = recordInput(i, "inspect-unknown", observed); pendingInspection = null;
          if (!verified) {
            throw new Error("起手读牌后的置换标记不符，不猜测选择状态");
          }
          selected = observed;
          const c = TCG.observedCard(raw, i);
          if (!c) throw new Error("第" + (i + 1) + "张初始牌标题未读清，不自动确认开局");
          cards.push(c);
          this.trace("opening-title-method", { index: i, method: "click", selectionChanged: true });
        }
      } catch (error) {
        // Recover only when the actual marker can still be read. Do not
        // confirm a game whose initial cards or selected replacements are unknown.
        let observed;
        try { observed = await this.openingSelections(startingXs); }
        catch (failure) { if(pendingInspection!==null)recordInput(pendingInspection,"inspect-unknown",null); throw failure; }
        if(pendingInspection!==null)recordInput(pendingInspection,"inspect-unknown",observed);
        selected = observed;
        for (let i = 0; i < 5; i++) if (selected[i] !== original[i]) await toggle(i, "rollback");
        throw error;
      }
      this.trace("opening", cards);
      const context = TCG.openingContext({});
      const plan = TCG.openingPlan(cards, original, context);
      this.openingCards = plan.keep;
      const wanted = plan.replace;
      this.trace("opening-plan", {
        cards,
        keep: cards.filter((h) => !wanted[h.index]).map((h) => h.id),
        replace: cards.filter((h) => wanted[h.index]).map((h) => h.id),
        replaceIndices: wanted.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
        duplicateWeaponIndices: plan.duplicateWeapons,
        context,
      });
      const final = wanted;
      // Settle kept inspection marks first; no undo after final replacements start.
      for (let i = 0; i < 5; i++) if (selected[i] && !final[i]) await toggle(i, "reconcile");
      for (let i = 0; i < 5; i++) if (!selected[i] && final[i]) await toggle(i, "reconcile");
      this.moveTo(1791, 860);
      this.trace("opening-selection-verified", {
        original,
        selected,
        proof: "two-stable-native-replace-labels-per-input",
      });
      await this.confirmOpening({
        policy: "known-priority",
        selectedByScript: selected.map((s, i) => (s ? i : -1)).filter((i) => i >= 0),
      });
    }
// @endfragment tcg-ui.opening

// @fragment tcg-ui.openingSelections
async openingSelections(xs) {
      let previous = "",
        stable = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        const observation = this.frame((f) => ({
          phase: this.phaseIn(f).phase,
          labels: xs.map((x) => TCG.norm(this.ocr(f, this.roi("opening", [x - 100, 730, 200, 60])))),
        }));
        if (observation.phase !== "opening") throw new Error("起手置换检查期间页面改变");
        if (observation.labels.some((t) => t !== "" && t !== "替换")) {
          previous = "";
          stable = 0;
        } else {
          const key = JSON.stringify(observation.labels);
          stable = key === previous ? stable + 1 : 1;
          previous = key;
          if (stable >= 2) return observation.labels.map((t) => t === "替换");
        }
        await sleep(200);
      }
      throw new Error("初始牌置换标记未稳定");
    }
// @endfragment tcg-ui.openingSelections

// @fragment tcg-ui.pick
async pick(target, first = true) {
      if (!Number.isInteger(target) || target < 0 || target >= charX.length) throw new Error("出战角色索引无效");
      if(!first)return this.pickForced(target);
      if (this.phase().phase !== "pick") throw new Error("当前不是出战页");
      this.clickAt(...this.point("board",charX[target],720));
      this.trace("pick-target-clicked", { target, name:TCG.team[target].name, first, point:[charX[target],720] });
      await sleep(500);
      // A preselected card can confirm on the FIRST click (native 11:07 run).
      // Otherwise ChooseFirst uses the same card again, but only after positive
      // selected-target evidence. Never send a second input to a roll/board.
      let confirmationSent = false;
      let stable = 0, lastKey = "", last = { phase: "unknown", turn: "none" };
      for (let attempt = 0; attempt < 60; attempt++) {
        last = this.firstPickObservation();
        if (last.phase === "pick" && !confirmationSent && last.selectedTarget === target) {
          this.trace("pick-selected", { target, name:TCG.team[target].name, first, proof:"exact-target-title-on-pick-page" });
          this.clickAt(...this.point("board",charX[target],720));
          confirmationSent = true;
          this.trace("pick-confirm-clicked", { target, first, point:[charX[target],720], method:"official-character-card" });
          this.moveTo(1555, 860);
          stable = 0; lastKey = "";
          await sleep(500);
          continue;
        }
        let accepted = last.phase === "roll" || !!last.result;
        if (last.phase === "board" && ["user", "enemy"].includes(last.turn)) {
          try { last = this.board(); } catch (e) {
            if (!["TCG_BOARD_RETRY", "TCG_DICE_RETRY"].includes(e.code)) throw e;
            stable = 0; lastKey = ""; await sleep(400); continue;
          }
          accepted = last.phase === "board" && ["user", "enemy"].includes(last.turn) && last.active === target &&
            TCG.total(last.dice) > 0 && TCG.legalState({ ...last, turn: "user", hand: [] });
        }
        const key = JSON.stringify([last.phase, last.turn, last.result, last.active, last.characters,
          last.dice ? TCG.diceOrder.map(e => last.dice[e] || 0) : null]);
        stable = accepted ? key === lastKey ? stable + 1 : 1 : 0;
        if (key !== lastKey) this.trace("pick-wait", { target, first, attempt, phase: last.phase, turn: last.turn });
        lastKey = key;
        if (stable >= 2) { this.trace("pick-confirmed", { target, first, phase:last.phase, turn:last.turn,
          characterInputs:confirmationSent ? 2 : 1, method:"official-character-card" }); return last; }
        if (!["pick","unknown","transition","settlement","roll","board","result"].includes(last.phase)) {
          throw new Error("首次出战后出现意外页面：" + last.phase);
        }
        if (attempt < 59) await sleep(400);
      }
      throw new Error("出战角色确认未生效：未进入投骰页或完整稳定牌桌；最后页面 " + last.phase);
    }
// @endfragment tcg-ui.pick

// @fragment tcg-ui.pickForced
async pickForced(target) {
      // Official Character.SwitchWhenTakenOut selects and confirms on the
      // character card itself. Do not reuse first-pick tooltip/icon geometry.
      if(this.forcedPickSession)target=this.forcedPickSession.target;
      if(!this.forcedPickSession) {
        const initial=this.board(false, true);
        if(initial.result)return initial;
        if(initial.phase!=="pick" || !TCG.alive(initial.characters?.[target])) {
          const e=new Error("强制换人局面尚未核实");e.code="TCG_PICK_RETRY";throw e;
        }
        this.clickAt(...this.point("board",charX[target],720));
        this.forcedPickSession={target,confirmed:false};
        this.trace("forced-pick-selected",{target,name:TCG.team[target].name});
        await sleep(500);
      }
      let confirmed=this.forcedPickSession.confirmed,stable=0,key="",last=null;
      for(let attempt=0;attempt<40;attempt++) {
        try{last=this.board(false, true);}catch(e){
          if(!["TCG_DICE_RETRY","TCG_BOARD_RETRY"].includes(e.code))throw e;
          stable=0;key="";
          this.trace("forced-pick-read-deferred",{target,attempt,code:e.code});await sleep(400);continue;
        }
        if(last.result){this.forcedPickSession=null;return last;}
        const c=last.characters?.[target];
        const selected=last.pickSelection?.who===target &&
          ["请选择一位角色出战","请选择一个角色出战"].includes(last.pickSelection.banner);
        if(last.phase==="pick" && TCG.alive(c) && (c.raised===true || selected) && !confirmed) {
          // Positive selected-card evidence; exactly one confirmation input.
          this.clickAt(...this.point("board",charX[target],720));confirmed=true;this.forcedPickSession.confirmed=true;
          this.trace("forced-pick-confirm-clicked",{target,point:[charX[target],720],method:"official-character-card",
            proof:selected?"exact-target-title-and-pick-banner":"raised-living-target"});
          stable=0;key="";
        } else if(last.phase==="board" && ["user","enemy"].includes(last.turn) &&
            last.active===target && TCG.alive(c)) {
          const next=JSON.stringify([last.phase,last.turn,last.active]);
          stable=next===key?stable+1:1;key=next;
          if(stable>=2) {
            this.trace("forced-pick-confirmed",{target,phase:last.phase,turn:last.turn,confirmationInputs:confirmed?1:0});
            this.forcedPickSession=null;
            if (last.enemies?.some(e => e.dead !== true &&
                (!Number.isInteger(e.hp) || e.dead !== false)) &&
                await this.dismissCharacterOverview("forced-pick-handoff"))
              return this.board(false, true);
            return last;
          }
        } else if(last.phase==="board"&&last.turn==="user"&&last.active!==target) {
          const observed=await this.settledBoard(true,last);
          if(observed.phase==="board"&&observed.turn==="user"&&observed.active!==target){
            this.trace("forced-pick-handoff",{target,actualActive:observed.active,
              confirmationInputs:confirmed?1:0,proof:"complete-native-board-overrides-planned-target"});
            this.forcedPickSession=null;return observed;
          }
          stable=0;key="";
        } else if(["settlement","choice","roll"].includes(last.phase)) {
          // End-phase damage can require a replacement BEFORE remaining summons,
          // a blessing choice, and next-round dice. Hand off the stable native
          // phase; it is not proof of the target's final active/alive state.
          // A preselected target can finish on the FIRST card click. Native
          // phase exit is enough to transfer page ownership, never to assert
          // a cast, card consumption, or an unobserved active character.
          const next=JSON.stringify(["handoff",last.phase,last.turn]);
          stable=next===key?stable+1:1;key=next;
          if(stable>=2) {
            this.trace("forced-pick-handoff",{target,attempt,phase:last.phase,turn:last.turn,
              selectionInputs:1,confirmationInputs:confirmed?1:0,
              proof:"selection-input-and-two-stable-native-phase-exit-frames"});
            this.forcedPickSession=null;
            return {phase:last.phase,turn:last.turn};
          }
        } else {
          stable=0;key="";
          if(confirmed && last.phase==="pick" && c?.dead===true) {
            this.trace("forced-pick-defeated-again",{target});this.forcedPickSession=null;return last;
          }
          if(["opening","roll"].includes(last.phase))throw new Error("阵亡换人出现非预期起手/投骰页");
        }
        this.trace("forced-pick-wait",{target,attempt,phase:last.phase,turn:last.turn,confirmationSent:confirmed});
        await sleep(400);
      }
      const error = new Error("阵亡换人长时间未取得完整出战证据");
      error.code = "TCG_PICK_RETRY";
      throw error;
    }
// @endfragment tcg-ui.pickForced

// @fragment tcg-ui.roll
async roll(memory, { allowInitialPick = false } = {}) {
      // Only a first roll can lead to the still-pending first character pick.
      const mayPick = allowInitialPick && memory.round === 0;
      if (this.phase().phase !== "roll") throw new Error("当前不是投骰页");
      const observed = await this.readRollDice();
      if (this.phase().phase !== "roll") throw new Error("选择骰子前页面已改变");
      const plan = TCG.rerollPlan(observed.items, memory, memory.openingContext || {});
      const keep = plan.elements;
      for (let i = 0; i < observed.items.length; i++)
        if (!plan.indices.includes(i)) {
          const die = observed.items[i];
          this.clickAt(die.x, die.y);
          await sleep(130);
        }
      this.trace("reroll-plan", plan);
      if (this.phase().phase !== "roll") throw new Error("重投确认前已离开投骰页");
      await this.clickButton("确定");
      let stable = 0,
        lastKey = "",
        last = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        last = this.phase();
        const accepted =
          !!last.result ||
          (last.phase === "board" && ["user", "enemy"].includes(last.turn)) ||
          (mayPick && last.phase === "pick");
        const key = JSON.stringify([last.phase, last.turn, last.result]);
        stable = accepted ? (key === lastKey ? stable + 1 : 1) : 0;
        if (key !== lastKey)
          this.trace("roll-wait", { attempt, phase: last.phase, turn: last.turn });
        lastKey = key;
        if (stable >= 2) break;
        if (last.phase === "opening" || (last.phase === "pick" && !mayPick))
          throw new Error("重投确认后出现意外页面：" + last.phase);
        if (attempt < 29) await sleep(500);
      }
      if (stable < 2) throw new Error("重投确认未生效；最后页面 " + last.phase);
      TCG.nextRound(memory);
      const nextCount = this.handCache === null ? null : Math.min(10, this.handCache.length + 2);
      this.invalidateHand("new-round-draw-order-unknown");
      this.handCountHint = nextCount; // Common round draw is a candidate, not proof.
      this.handFanReady = false;
      this.handNeedsReset = false;
      this.boardReady = false;
      this.emptyHandProven = false; // Round draw adds two known cards (before deck exhaustion).
      this.consumptionReceipt = null;
      this.lastObservedAt = 0;
      this.lastObservedRevision = -1;
      this.expectedDice = 8;
      this.gamblerBudget = null;
      this.trace("round", { round: memory.round, keep });
      return last;
    }
// @endfragment tcg-ui.roll
