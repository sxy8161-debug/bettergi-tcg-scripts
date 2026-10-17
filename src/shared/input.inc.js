// Shared input fragments. Inlined at build time; no runtime dependency.

// @fragment bgi-host.waitForSample
async waitForSample(sampledAt, interval, revision = this.inputRevision) {
      // Pure observation already spent part (or all) of the sampling interval.
      // An intervening click starts a new animation boundary: keep the full
      // old post-input wait rather than charging pre-input OCR against it.
      const remaining = revision === this.inputRevision ? interval - (Date.now() - sampledAt) : interval;
      const wait = Math.min(remaining, (this.matchDeadline ?? Infinity) - Date.now());
      if (wait > 0) await sleep(wait);
      this.requireMatchTime();
    }
// @endfragment bgi-host.waitForSample

// @fragment bgi-host.cardConfirmationEntryIn
cardConfirmationEntryIn(f, targetedBanners = []) {
      const banner = this.cardBannerIn ? this.cardBannerIn(f) : this.ocr(f, [740, 510, 450, 65]);
      const phase = this.phaseIn(f);
      // A real target page owns a different input. Do not OCR its payment
      // control until the target owner has selected the character.
      const paymentPhase = phase.phase === "unknown" && phase.turn === "none";
      const targeted = paymentPhase && targetedBanners.includes(TCG.norm(banner));
      // Callers can reuse entry controls only in this phase. Other entries
      // still take their original fresh payment frames; no unused OCR here.
      return { banner, phase, ...(paymentPhase && !targeted ? { targets: this.cardPaymentControlsIn(f) } : {}) };
    }
// @endfragment bgi-host.cardConfirmationEntryIn

// @fragment bgi-host.cardChoicePreviewIn
cardChoicePreviewIn(f, kind, phase = this.phaseIn(f)) {
      return {
        banner: TCG.norm(this.ocr(f, kind === "target" ? [600, 510, 720, 65] : [740, 510, 450, 65])),
        phase, controls: this.cardPaymentControlsIn(f),
        ...(kind === "target" ? { buttons: this.matches(f, "core/确定", [770, 900, 380, 90]) } : {}),
      };
    }
// @endfragment bgi-host.cardChoicePreviewIn

// @fragment bgi-host.cardTargetPreviewIn
cardTargetPreviewIn(f) {
      return {
        banner: TCG.norm(this.cardBannerIn ? this.cardBannerIn(f) : this.ocr(f, [740, 510, 450, 65])),
        buttons: this.matches(f, "core/确定", [770, 900, 380, 90]),
        rows: this.ocrRows(f, [770, 900, 380, 90]),
        phase: this.phaseIn(f), warning: this.warnings(f),
      };
    }
// @endfragment bgi-host.cardTargetPreviewIn

// @fragment bgi-host.cardPaymentPreviewIn
cardPaymentPreviewIn(f) {
      return {
        banner: TCG.norm(this.cardBannerIn ? this.cardBannerIn(f) : this.ocr(f, [740, 510, 450, 65])),
        controls: this.cardPaymentControlsIn(f),
        phase: this.phaseIn(f), warning: this.warnings(f),
      };
    }
// @endfragment bgi-host.cardPaymentPreviewIn

// @fragment bgi-host.requireStableCardPayment
async requireStableCardPayment(action, central, sampledAt) {
      const banner = TCG.norm(central.banner), b = central.targets[0];
      let stable = 1;
      for (let attempt = 0; attempt < 6; attempt++) {
        await this.waitForSample(sampledAt, 250); sampledAt = Date.now();
        const current = this.frame(f => this.cardPaymentPreviewIn(f));
        await this.requireNoWarning(current.warning);
        const c = current.controls[0], matched = current.banner === banner && current.controls.length === 1 &&
          current.phase.phase === "unknown" && current.phase.turn === "none" &&
          Math.abs(c.x + c.w / 2 - b.x - b.w / 2) <= 3 && Math.abs(c.y + c.h / 2 - b.y - b.h / 2) <= 3;
        stable = matched ? stable + 1 : 0;
        this.trace("card-payment-preview", { id: action.id, attempt, matched, stable, ...current });
        if (stable >= 2) return;
        if (attempt === 5) throw new Error("中央出牌确认控件未连续核实");
      }
    }
// @endfragment bgi-host.requireStableCardPayment

// @fragment bgi-host.cardPaymentControlsIn
cardPaymentControlsIn(f) {
      // OCR Find returns only its first item, which may be a key hint. Read
      // complete native rows; confirmation still requires a unique exact label.
      return this.ocrRows(f, [770, 900, 380, 90]).filter(
        (row) => TCG.norm(row.text) === "打出手牌",
      );
    }
// @endfragment bgi-host.cardPaymentControlsIn

// @fragment bgi-host.button
button(asset, roi = [0, 540, 1920, 540]) {
      return this.frame((f) => this.matches(f, "core/" + asset, roi)[0] || null);
    }
// @endfragment bgi-host.button

// @fragment bgi-host.characterOverviewIn
characterOverviewIn(f) {
      // Native 17:18: the character overview has a role title, not a skill title.
      // Its right-hand section varies with equipment/statuses. Read this only
      // on a failed preview, never in the normal two-frame skill-confirm path.
      const name = this.ocr(f, [311, 115, 341, 50]);
      const who = TCG.characterName(name);
      if (who < 0) return null;
      const heading = this.ocr(f, [740, 123, 280, 44]);
      if (["角色装备", "角色状态", "阵营出战状态"].includes(TCG.norm(heading))) return { name, heading };
      const text = TCG.norm(this.ocr(f, [350, 210, 300, 270]));
      const skills = Object.values(TCG.team[who].skills).filter(skill => text.includes(TCG.norm(skill)));
      return skills.length >= 2 ? { name, heading: "角色技能", skills } : null;
    }
// @endfragment bgi-host.characterOverviewIn

// @fragment bgi-host.dismissCharacterOverview
async dismissCharacterOverview(reason) {
      // Only an unreadable board calls this. A payment/choice/unknown page is
      // never a blank-click opportunity; a persistent panel gets one attempt.
      if (this.overviewClearRevision === this.inputRevision) return false;
      const read = () => this.frame(f => {
        const phase = this.phaseIn(f);
        return { phase, panel: phase.phase === "board" && phase.turn === "user"
          ? this.characterOverviewIn(f) : null };
      });
      const first = read();
      if (!first.panel) return false;
      const revision = this.inputRevision;
      await sleep(120);
      const second = read();
      if (!second.panel || this.inputRevision !== revision ||
          TCG.norm(first.panel.name) !== TCG.norm(second.panel.name) ||
          TCG.norm(first.panel.heading) !== TCG.norm(second.panel.heading) ||
          JSON.stringify(first.panel.skills || []) !== JSON.stringify(second.panel.skills || [])) return false;
      const point = this.clickAt(1190, 545);
      this.overviewClearRevision = this.inputRevision;
      this.moveTo(1555, 545);
      this.trace("character-overview-dismissed", { reason, panel: second.panel, point });
      await sleep(300);
      return true;
    }
// @endfragment bgi-host.dismissCharacterOverview

// @fragment bgi-host.characterSkillPreview
characterSkillPreview(p) {
      const names = [p.name, p.nativeName, p.enlargedName].map((v) => TCG.norm(v || ""));
      const named = names.filter(Boolean);
      return (
        !p.identity &&
        !TCG.norm(p.detail || "") &&
        !TCG.norm(p.aliasDetail || "") &&
        named.length > 0 &&
        named.every((name) => name === named[0] && TCG.characterName(name) >= 0) &&
        p.phase?.phase === "board" &&
        p.phase.turn === "user"
      );
    }
// @endfragment bgi-host.characterSkillPreview

// @fragment bgi-host.clickButton
async clickButton(asset, roi) {
      if (asset === "出战角色") throw new Error("出战角色模板是提示文字，不是按钮");
      const b = this.button(asset, roi);
      if (!b) throw new Error("没有识别到按钮：" + asset);
      const point = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
      this.trace("button-clicked", { asset, point });
      await sleep(200);
    }
// @endfragment bgi-host.clickButton

// @fragment bgi-host.emptySkillPreview
emptySkillPreview(p) {
      return (
        !p.identity &&
        ![p.name, p.nativeName, p.enlargedName, p.detail, p.aliasDetail].some((v) =>
          TCG.norm(v || ""),
        ) &&
        p.phase?.phase === "board" &&
        p.phase.turn === "user"
      );
    }
// @endfragment bgi-host.emptySkillPreview

// @fragment bgi-host.moveTo
moveTo(x, y) {
      const point = mousePoint(x, y);
      this.requireMatchTime();
      moveMouseTo(point[0], point[1]);
      return point;
    }
// @endfragment bgi-host.moveTo

// @fragment bgi-host.requireSwitchPreview
async requireSwitchPreview(action, memory) {
      // Native normal switching has NO bottom action label. Only the fast
      // status displays 快速行动; absence alone never identifies this overlay.
      const expectedSpeed = memory.fastSwitch ? "快速行动" : "";
      let stable = 0,
        previousSpeed = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const sampledAt = Date.now();
        const preview = this.frame((f) => ({
          phase: this.phaseIn(f),
          banner: this.ocr(f, [700, 508, 580, 65]),
          control: this.ocr(f, [1720, 835, 195, 75]),
          speed: this.ocr(f, [850, 972, 260, 60]),
          warning: this.warnings(f),
        }));
        await this.requireNoWarning(preview.warning);
        this.requireHandObservation(preview.phase, "switch-preview");
        const matched =
          preview.phase.phase === "unknown" &&
          preview.phase.turn === "none" &&
          TCG.norm(preview.banner) === "将所选角色切换为出战角色" &&
          TCG.norm(preview.control) === "切换角色" &&
          ["", "快速行动"].includes(TCG.norm(preview.speed));
        this.trace("switch-preview", {
          attempt,
          target: action.target,
          expectedSpeed,
          matched,
          ...preview,
        });
        if (preview.phase.phase === "board" && preview.phase.turn === "user" &&
            TCG.norm(preview.banner) === "元素骰子不足") {
          const error = new Error("游戏拒绝动作：" + preview.banner);
          error.code = "TCG_NATIVE_REJECTION";
          throw error;
        }
        const actualSpeed = TCG.norm(preview.speed);
        stable = matched ? (actualSpeed === previousSpeed ? stable + 1 : 1) : 0;
        previousSpeed = matched ? actualSpeed : null;
        if (stable >= 2) return { fast: actualSpeed === "快速行动", speed: actualSpeed };
        const remaining = (matched ? 120 : 300) - (Date.now() - sampledAt);
        if (attempt < 9 && remaining > 0) await sleep(remaining);
      }
      throw new Error("切换确认页未核实横幅、控件与行动类型");
    }
// @endfragment bgi-host.requireSwitchPreview

// @fragment bgi-host.requireSkillPreview
async requireSkillPreview(action, feeProbe=false, readFee=false) {
      let stable = 0, last = null, fee = null, feeStable = 0, absent = true, missing = true;
      for (let attempt = 0; attempt < 10; attempt++) {
        const sampledAt = Date.now();
        last = this.frame(f => {
          const preview = this.skillPreviewIn(f);
          return { ...preview, phase: this.phaseIn(f),
            fee: readFee && !feeProbe && ["E","Q"].includes(action.skill)
              ? this.skillFeeIn(f, action, preview.identity) : null,
            warning: feeProbe ? null : this.warnings(f) };
        });
        if (!feeProbe) await this.requireNoWarning(last.warning);
        const matched = last.identity?.who === action.who && last.identity?.skill === action.skill &&
          ["unknown", "board"].includes(last.phase.phase) && last.phase.turn !== "enemy";
        this.trace("skill-preview", { attempt, matched, ...last });
        absent=absent && this.emptySkillPreview(last);
        missing=missing && (this.emptySkillPreview(last) || this.characterSkillPreview(last));
        stable = matched ? stable + 1 : 0;
        feeStable = matched && last.fee!==null ? last.fee===fee ? feeStable+1 : 1 : 0;
        fee = last.fee;
        if (stable >= 2) return { fee:feeStable>=2?fee:null };
        const remaining = (matched ? 120 : 250) - (Date.now() - sampledAt);
        if (attempt < 9 && remaining > 0) await sleep(remaining);
      }
      const error=new Error("技能确认页未核实目标技能：" + (last?.name || "空标题"));
      if(absent)error.code="TCG_SKILL_PREVIEW_ABSENT";
      else if(missing)error.code="TCG_SKILL_PREVIEW_CHARACTER";
      throw error;
    }
// @endfragment bgi-host.requireSkillPreview

// @fragment bgi-host.inputSkill
async inputSkill(action, before, memory, cost, readFee = false) {
      const x = { NA: 1608, E: 1716, Q: 1824 }[action.skill];
      this.clickAt(x, 957);
      await sleep(120);
      const preview = await this.requireOpenedSkill(action, before, x, readFee);
      if (this.expectedDice !== null && preview.fee !== null) {
        this.expectedDice = TCG.total(before.dice) - preview.fee;
        this.trace("skill-fee-budget", { who: action.who, skill: action.skill,
          nominal: cost, actual: preview.fee, expectedDice: this.expectedDice,
          source: "current-confirmed-preview" });
      }
      this.clickAt(x, 957);
      this.trace("skill-confirm-clicked", { who: action.who, skill: action.skill, point: [x, 957] });
    }
// @endfragment bgi-host.inputSkill

// @fragment bgi-host.warnings
warnings(frame = null) {
      const read = (f) => ({
        lack: this.has(f, "core/元素骰子不足", [960, 0, 960, 1080]),
        text: this.ocr(f, [1490, 790, 410, 250]),
      });
      return frame ? read(frame) : this.frame(read);
    }
// @endfragment bgi-host.warnings

// @fragment tcg-ui.clickAt
clickAt(x, y) {
      const point = mousePoint(x, y);
      this.requireMatchTime();
      this.boardReady = false;
      click(point[0], point[1]);
      this.inputRevision++;
      this.handPositionProof = null;
      return point;
    }
// @endfragment tcg-ui.clickAt

// @fragment tcg-ui.confirmTune
async confirmTune() {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.requireNoWarning();
        const b = this.button("元素调和");
        if (b) {
          const point = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
          this.trace("button-clicked", { asset: "元素调和", point });
          await sleep(120);
          return;
        }
        if (attempt < 2) await sleep(300);
      }
      const error = new Error("调和确认按钮未读清，核对实际手牌与骰子后再选择");
      error.code = "TCG_TUNE_UNCONFIRMED";
      throw error;
    }
// @endfragment tcg-ui.confirmTune

// @fragment tcg-ui.execute
async execute(action, before, memory) {
      this.consumptionReceipt = null;
      this.pendingHandEvidence = null;
      this.currentAction = action;
      this.actionSubmittedAt = null;
      const startedAt = Date.now();
      try {
        if (action.type === "tune" && !TCG.handCardKnown(before.hand.find(
            h => h.index === action.index && h.id === action.id)))
          throw new Error("未核实身份的牌禁止调和");
        const result = await this.executeInput(action, before, memory);
        if (!result?.probed) {
          this.actionSubmittedAt = Date.now();
          this.trace("input-submitted", { action, ms: this.actionSubmittedAt - startedAt,
            inputRevision: this.inputRevision, awaitingChoice: !!this.choiceSession });
        }
        return result;
      } catch (e) {
        this.consumptionReceipt = null;
        this.pendingHandEvidence = null;
        const nativeRejection = e.code === "TCG_NATIVE_REJECTION";
        if (!nativeRejection && !(action.type === "tune" && e.code === "TCG_TUNE_UNCONFIRMED"))
          throw e;
        if (nativeRejection) e.code = "TCG_INPUT_REJECTED";
        // Dismiss the existing preview once. A missing tuning button is NOT a
        // rejection proof: Player must reread hand/resources before retrying.
        this.boardReady = false;
        await this.reset();
        throw e;
      } finally {
        this.currentAction = null;
      }
    }
// @endfragment tcg-ui.execute

// @fragment tcg-ui.requireNoWarning
async requireNoWarning(warning = this.warnings()) {
      if (warning.lack || /无法|不足|不能|充能未满/.test(warning.text)) {
        const e = new Error("游戏拒绝动作：" + warning.text);
        e.code = "TCG_NATIVE_REJECTION";
        throw e;
      }
    }
// @endfragment tcg-ui.requireNoWarning

// @fragment tcg-ui.requireUnchangedBoard
async requireUnchangedBoard(before) {
      // One pre-input owner: a clean board is read with its phase in the same
      // frame. Only an actually raised view needs a phase guard and a reset.
      let entryPhasePending = !this.boardReady && !this.handFanReady && !this.handNeedsReset;
      if (!this.boardReady && !entryPhasePending) {
        const phase = this.phase();
        if (phase.phase !== "board" || phase.turn !== "user") {
          const error = new Error("执行前页面/回合已变化");
          error.code = "TCG_OBSERVATION_INTERRUPTED"; error.phase = { ...phase, hand: null };
          throw error;
        }
        if (this.handFanReady || this.handNeedsReset) await this.reset();
      }
      // Dice maps are unordered and zero entries may be omitted. Compare
      // resources semantically, not by host dictionary insertion order.
      const keyOf=s=>JSON.stringify([s.active,TCG.diceOrder.map(e=>s.dice?.[e]||0),s.characters,s.enemies,s.quicken||null,s.supportCounts||null]);
      const expected=keyOf(before);let stable=0,last=null;
      const recent=this.preInputBoardClean() && this.lastObservedState && keyOf(this.lastObservedState)===expected &&
        this.lastObservedRevision===this.inputRevision && Date.now()-this.lastObservedAt<=1500 && !this.autoRisk;
      for(let attempt=0;attempt<6;attempt++) {
        const sampledAt = Date.now();
        // A clean but unready entry has no reset/input between its phase and
        // full-board reads. Let this same fresh frame prove both. Do not turn
        // it into boardReady/recent evidence or remove either stable board.
        const entryPhase = entryPhasePending; entryPhasePending = false;
        try{last=entryPhase ? this.adoptPhase(this.board(true)) : this.board();}catch(e){
          if(e.code!=="TCG_DICE_RETRY")throw e;
          stable=0;this.trace("execution-board-wait",{attempt,error:String(e.message||e)});
          const remaining = 300 - (Date.now() - sampledAt);
          if(attempt<5 && remaining>0)await sleep(remaining);continue;
        }
        if(last.phase!=="board" || last.turn!=="user") {
        const error=new Error("执行前页面/回合已变化");
          error.code=!entryPhase && last.phase==="unknown" ? "TCG_STATE_REFRESH" : "TCG_OBSERVATION_INTERRUPTED";
          error.phase={...last,hand:null};this.boardReady=false;throw error;
        }
        const matched=keyOf(last)===expected;stable=matched?stable+1:0;
        this.trace("execution-board-wait",{attempt,matched,stable,active:last.active,dice:last.dice,changed:matched?[]:boardDifferences(before,last)});
        if(stable>=2 || recent&&attempt===0&&matched)return last;
        const remaining = 300 - (Date.now() - sampledAt);
        if(attempt<5 && remaining>0)await sleep(remaining);
      }
      const error = new Error("执行前牌桌已变化或六次读取未稳定匹配");
      error.code = "TCG_STATE_REFRESH";
      throw error;
    }
// @endfragment tcg-ui.requireUnchangedBoard

// @fragment bgi-host.switchInputBody
if (!Number.isInteger(action.target) || action.target < 0 || action.target > 2 ||
          action.target === before.active || before.characters[action.target].dead !== false)
        throw new Error("切换目标非法");
      // Opening details verifies the target before the payment overlay.
      const raw = await this.titleAt(charX[action.target], 720, false, false, "character", action.target, true);
      this.requireHandObservation(this.phase(), "before-switch-payment");
      if (TCG.characterName(raw) !== action.target) throw new Error("切换目标角色标题未核实");
      this.clickAt(1820, 958);
      await sleep(120);
      const preview = await this.requireSwitchPreview(action, memory);
      this.clickAt(1820, 958);
      this.trace("switch-confirm-clicked", {
        target: action.target,
        point: [1820, 958],
        fast: preview.fast,
        predictedFast: memory.fastSwitch,
      });
// @endfragment bgi-host.switchInputBody

// @fragment bgi-host.endRoundInputBody
await this.clickButton("回合结束", [0, 0, 384, 1080]);
      if (this.phase().turn === "user") await this.clickButton("回合结束", [0, 0, 384, 1080]);
// @endfragment bgi-host.endRoundInputBody
