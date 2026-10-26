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
      const banner = this.cardBannerIn ? this.cardBannerIn(f) : this.ocr(f, this.roi("phase", [740, 510, 450, 65]));
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
      const banner = TCG.norm(this.ocr(f, this.roi("choice", kind === "target" ? [600, 510, 720, 65] : [740, 510, 450, 65]))),
        controls = this.cardPaymentControlsIn(f);
      return {
        banner, phase, controls,
        ...(kind === "target" && !controls.length ? { buttons: this.matches(f, "core/确定", this.roi("bottom", [770, 900, 380, 90])) } : {}),
      };
    }
// @endfragment bgi-host.cardChoicePreviewIn

// @fragment bgi-host.cardTargetPreviewIn
cardTargetPreviewIn(f) {
      const banner = TCG.norm(this.cardBannerIn ? this.cardBannerIn(f) : this.ocr(f, this.roi("phase", [740, 510, 450, 65]))),
        buttons = this.matches(f, "core/确定", this.roi("bottom", [770, 900, 380, 90]));
      return {
        banner, buttons,
        ...(!buttons.length ? { rows: this.ocrRows(f, this.roi("bottom", [770, 900, 380, 90])) } : {}),
        phase: this.phaseIn(f), warning: this.warnings(f),
      };
    }
// @endfragment bgi-host.cardTargetPreviewIn

// @fragment bgi-host.cardPaymentControlsIn
cardPaymentControlsIn(f) {
      // OCR Find returns only its first item, which may be a key hint. Read
      // complete native rows; confirmation still requires a unique exact label.
      return this.ocrRows(f, this.roi("bottom", [770, 900, 380, 90])).filter(
        (row) => TCG.norm(row.text) === "打出手牌",
      );
    }
// @endfragment bgi-host.cardPaymentControlsIn

// @fragment bgi-host.button
button(asset, roi = this.roi("viewport", [0, 540, 1920, 540])) {
      return this.frame((f) => this.matches(f, "core/" + asset, roi)[0] || null);
    }
// @endfragment bgi-host.button

// @fragment bgi-host.characterOverviewIn
characterOverviewIn(f) {
      // Native 17:18: the character overview has a role title, not a skill title.
      // Its right-hand section varies with equipment/statuses. Read this only
      // on a probe failure, never in the normal skill-confirm path.
      const name = this.ocr(f, this.roi("details", [311, 115, 341, 50]));
      const who = TCG.characterName(name);
      if (who < 0) return null;
      const heading = this.ocr(f, this.roi("details", [740, 123, 280, 44]));
      if (["角色装备", "角色状态", "阵营出战状态"].includes(TCG.norm(heading))) return { name, heading };
      const text = TCG.norm(this.ocr(f, this.roi("details", [350, 210, 300, 270])));
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
      const point = this.clickAt(...this.point("board",1190,545));
      this.overviewClearRevision = this.inputRevision;
      this.moveTo(...this.point("board",1555,545));
      this.trace("character-overview-dismissed", { reason, panel: second.panel, point });
      await sleep(300);
      return true;
    }
// @endfragment bgi-host.dismissCharacterOverview

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

// @fragment bgi-host.moveTo
moveTo(x, y) {
      const point = mousePoint(x, y, this.captureGeometry?.frameSize);
      this.requireMatchTime();
      // Recheck actual geometry even if the last OCR frame has the same size.
      // This also guards each interpolation step of a held drag, without OCR.
      this.checkInputGeometry();
      this.requireMatchTime();
      GameCaptureRegion.GameRegion1080PPosMove(point[0], point[1]);
      return point;
    }
// @endfragment bgi-host.moveTo

// @fragment bgi-host.requireSwitchPreview
async requireSwitchPreview(action, memory) {
      // Native normal switching has NO bottom action label. Only the fast
      // status displays 快速行动; absence alone never identifies this overlay.
      const expectedSpeed = memory.fastSwitch ? "快速行动" : "";
      for (let attempt = 0; attempt < 10; attempt++) {
        const sampledAt = Date.now();
        const preview = this.frame((f) => ({
          phase: this.phaseIn(f),
          banner: this.ocr(f, this.roi("phase", [700, 508, 580, 65])),
          control: this.ocr(f, this.roi("bottom", [1720, 835, 195, 75])),
          speed: this.ocr(f, this.roi("bottom", [850, 972, 260, 60])),
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
        if (matched) return { fast: actualSpeed === "快速行动", speed: actualSpeed };
        if (preview.phase.phase === "board" && preview.phase.turn === "user" &&
            !TCG.norm(preview.banner) && !TCG.norm(preview.control)) {
          // The first click did not open payment (native handoff was still
          // running). Nothing was submitted: return to the existing state
          // owner, rather than polling a nonexistent overlay or confirming it.
          this.autoRisk = true;
          const error = new Error("切换付款页未打开，交回当前牌桌重新决策");
          error.code = "TCG_STATE_REFRESH";
          throw error;
        }
        const remaining = 300 - (Date.now() - sampledAt);
        if (attempt < 9 && remaining > 0) await sleep(remaining);
      }
      throw new Error("切换确认页未核实横幅、控件与行动类型");
    }
// @endfragment bgi-host.requireSwitchPreview

// @fragment bgi-host.inputSkill
async inputSkill(action, before) {
      // executeInput already verified the current actor, board and resources.
      // Fixed role + fixed slot identifies the skill; no title/type OCR.
      const x = this.skillX(action);
      if (action.who !== before.active) throw new Error("技能槽位或当前出战角色不符");
      this.clickAt(...this.point("bottom",x,957));
      await sleep(1200);
      const preview = this.frame(f => ({ phase:this.phaseIn(f), warning:this.warnings(f) }));
      this.requireHandObservation(preview.phase, "before-skill-confirm");
      await this.requireNoWarning(preview.warning);
      this.clickAt(...this.point("bottom",x,957));
      // Sent is not confirmed. The existing pending session observes payment
      // and native effects; no missing tooltip or successful click proves a cast.
      this.trace("skill-confirm-clicked", { who:action.who, skill:action.skill, point:this.point("bottom",x,957) });
    }
// @endfragment bgi-host.inputSkill

// @fragment bgi-host.warnings
warnings(frame = null) {
      const read = (f) => ({
        lack: this.has(f, "core/元素骰子不足", this.roi("viewport", [960, 0, 960, 1080])),
        text: this.ocr(f, this.roi("bottom", [1490, 790, 410, 250])),
      });
      return frame ? read(frame) : this.frame(read);
    }
// @endfragment bgi-host.warnings

// @fragment tcg-ui.clickAt
clickAt(x, y) {
      const point = this.moveTo(x, y);
      this.requireMatchTime();
      this.boardReady = false;
      leftButtonClick();
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
          this.handContinuation = null;
          this.actionSubmittedAt = Date.now();
          this.trace("input-submitted", { action, ms: this.actionSubmittedAt - startedAt,
            inputRevision: this.inputRevision, awaitingChoice: !!this.choiceSession });
        }
        return result;
      } catch (e) {
        if (this.consumptionReceipt?.inputSent || e.code === "TCG_NATIVE_REJECTION")
          this.handContinuation = null;
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
async requireUnchangedBoard(before, action = null) {
      // One pre-input owner: a clean board is read with its phase in the same
      // frame. Only an actually raised view needs a phase guard and a reset.
      let entryPhasePending = !this.boardReady && !this.handFanReady && !this.handNeedsReset;
      if (this.handFanReady || this.handNeedsReset) {
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
      const matches=(a,b)=>this.boardsMatch(a,b,"execution",action);
      const recent=this.boardReady && matches(this.lastObservedState,before) &&
        this.lastObservedRevision===this.inputRevision && Date.now()-this.lastObservedAt<=1500 && !this.autoRisk;
      if (recent) {
        const phase = this.phase();
        if (phase.phase !== "board" || phase.turn !== "user") {
          const error = new Error("执行前页面/回合已变化");
          error.code = "TCG_OBSERVATION_INTERRUPTED"; error.phase = { ...phase, hand: null };
          throw error;
        }
        return before;
      }
      let last=null;
      for(let attempt=0;attempt<6;attempt++) {
        const sampledAt = Date.now();
        // A clean but unready entry has no reset/input between its phase and
        // full-board reads. Let this same fresh frame prove both.
        const entryPhase = entryPhasePending; entryPhasePending = false;
        try{last=this.board(true);if(entryPhase)this.adoptPhase(last);}catch(e){
          if(e.code!=="TCG_DICE_RETRY")throw e;
          this.trace("execution-board-wait",{attempt,error:String(e.message||e)});
          const remaining = 300 - (Date.now() - sampledAt);
          if(attempt<5 && remaining>0)await sleep(remaining);continue;
        }
        if(last.phase!=="board" || last.turn!=="user") {
        const error=new Error("执行前页面/回合已变化");
          error.code=!entryPhase && last.phase==="unknown" ? "TCG_STATE_REFRESH" : "TCG_OBSERVATION_INTERRUPTED";
          error.phase={...last,hand:null};this.boardReady=false;throw error;
        }
        const complete=!this.observationIssues(last).length;
        const matched=complete&&matches(before,last);
        const changes=matched?{}:boardDifferences(before,last,true);
        if(matched)return last;
        this.trace("execution-board-wait",{attempt,matched,active:last.active,dice:last.dice,changed:Object.keys(changes),changes});
        // A changed complete board invalidates the old decision immediately.
        // Only missing observations retry; never wait for old resources back.
        if(complete){
          const error=new Error("执行前局面已变化，重新决策");
          error.code="TCG_STATE_REFRESH";throw error;
        }
        const remaining = 300 - (Date.now() - sampledAt);
        if(attempt<5 && remaining>0)await sleep(remaining);
      }
      const error = new Error("执行前六次读取仍有缺失字段");
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
      this.clickAt(...this.point("bottom",1820,958));
      await sleep(120);
      const preview = await this.requireSwitchPreview(action, memory);
      this.clickAt(...this.point("bottom",1820,958));
      this.trace("switch-confirm-clicked", {
        target: action.target,
        point: this.point("bottom",1820,958),
        fast: preview.fast,
        predictedFast: memory.fastSwitch,
      });
// @endfragment bgi-host.switchInputBody

// @fragment bgi-host.endRoundInputBody
await this.clickButton("回合结束", this.roi("viewport", [0, 0, 384, 1080]));
      // Official RoundEnd waits 1000ms for the popup animation. clickButton
      // already waited 200ms; confirm inside the native five-second window.
      await sleep(800);
      if (this.phase().turn === "user") await this.clickButton("回合结束", this.roi("viewport", [0, 0, 384, 1080]));
// @endfragment bgi-host.endRoundInputBody
