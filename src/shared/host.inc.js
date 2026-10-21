// Common host assembled from the maintained fragments. Deck rules are overrides.
(function (root) {
  "use strict";
  /* @include src/shared/geometry.inc.js#tcg-ui.elements */
  /* @include src/shared/geometry.inc.js#tcg-ui.handX */
  /* @include src/shared/geometry.inc.js#tcg-ui.charX */
  /* @include src/shared/geometry.inc.js#tcg-ui.costMarkerLayout */
  /* @include src/shared/geometry.inc.js#tcg-ui.costDigitRows */
  /* @include src/shared/geometry.inc.js#tcg-ui.costNumbersAt */
  /* @include src/shared/geometry.inc.js#tcg-ui.costHandSample */
  /* @include src/shared/geometry.inc.js#tcg-ui.handLayoutCount */
  /* @include src/shared/geometry.inc.js#tcg-ui.enemyHpXs */
  // This asset is the tooltip ABOVE the control, not its clickable area.
  // Use it only as a scene marker. First-pick confirmation uses the official
  // character-card path, not the separate tooltip/control geometry.
  /* @include src/shared/geometry.inc.js#tcg-ui.pickLabelROI */
  /* @include src/shared/geometry.inc.js#tcg-ui.number */
  /* @include src/shared/geometry.inc.js#tcg-ui.captureSize */
  /* @include src/shared/geometry.inc.js#tcg-ui.requireCaptureSize */
  /* @include src/shared/geometry.inc.js#tcg-ui.captureGeometry */
  /* @include src/shared/geometry.inc.js#tcg-ui.layoutRegions */
  /* @include src/shared/geometry.inc.js#tcg-ui.mousePoint */
  /* @include src/shared/board.inc.js#tcg-ui.boardDifferences */
  class BetterGIHost {
    constructor(options) {
      this.options = options;
      this.templates = new Map();
      this.roCache = new Map();
      // Ten reusable slots: LimitedFile can overwrite, but has no delete API.
      // Select a slot lazily on the first event, not merely on construction.
      this.path = "logs/run-slot-01.log";
      this.logAppend = null;
      this.emptyHandProven = false;
      this.expectedDice = null;
      this.gamblerBudget = null;
      this.hpReadKeys = new Map();
      this.diceReadKeys = new Map();
      this.handFanReady = false;
      this.handNeedsReset = false;
      this.handCountHint = null;
      this.handCache = null;
      this.handScanSerial = 0;
      this.precisionBoard = false;
      this.forcedPickSession = null;
      this.boardReady = false;
      this.choiceSession = null;
      this.pendingChoiceCard = null;
      this.lastObservedState = null;
      this.tossSession = null;
      this.diagnosticKeys = new Set();
      this.frameMemo = null;
      this.captureGeometry = null;
      this.captureGeometryError = null;
      this.metrics = {frames:0,captureMs:0,frameWorkMs:0,ocrCalls:0,ocrMs:0,memoHits:0,geometryChecks:0,geometryMs:0};
      this.runStage = "entry";
      this.runDiagnostics = { startedAt: Date.now(), phase: null,
        timing: { observationMs: 0, planningMs: 0, inputMs: 0, settlementMs: 0, postActionMs: 0 },
        counts: { planned: 0, submitted: 0, confirmed: 0 }, lastAction: null,
        missing: { board: null, hand: null }, lastMissing: null };
      this.inputRevision = 0;
      this.lastCostSample = null;
      this.handPositionProof = null;
      this.lastObservedAt = 0;
      this.lastObservedRevision = -1;
      this.consumptionReceipt = null;
      this.pendingHandEvidence = null;
      file.createDirectory("logs");
    }
    requireMatchTime() {
      if (Date.now() >= (this.matchDeadline ?? Infinity)) {
        const error = new Error("达到单局时间上限，不再开始观察或发送输入");
        error.code = "TCG_MATCH_TIMEOUT";
        throw error;
      }
    }
    /* @include src/shared/input.inc.js#tcg-ui.clickAt */
    /* @include src/shared/input.inc.js#bgi-host.moveTo */
    /* @include src/shared/capture.inc.js#bgi-host.trace */
    /* @include src/shared/capture.inc.js#bgi-host.recordRunDiagnostic */
    /* @include src/shared/capture.inc.js#bgi-host.runSummary */
    /* @include src/shared/capture.inc.js#bgi-host.reportRunSummary */
    /* @include src/shared/capture.inc.js#bgi-host.frame */
    /* @include src/shared/capture.inc.js#bgi-host.adoptCapture */
    /* @include src/shared/capture.inc.js#bgi-host.checkInputGeometry */
    /* @include src/shared/capture.inc.js#bgi-host.memoFrame */
    /* @include src/shared/geometry.inc.js#bgi-host.roi */
    /* @include src/shared/capture.inc.js#bgi-host.findOcr */
    /* @include src/shared/capture.inc.js#bgi-host.localOcr */
    /* @include src/shared/capture.inc.js#bgi-host.artworkScore */
    /* @include src/shared/capture.inc.js#bgi-host.metricSnapshot */
    /* @include src/shared/capture.inc.js#bgi-host.metricDelta */
    /* @include src/shared/capture.inc.js#bgi-host.waitForCapture */
    /* @include src/shared/capture.inc.js#bgi-host.ocr */
    /* @include src/shared/capture.inc.js#tcg-ui.ocrRows */
    
    
    /* @include src/shared/capture.inc.js#tcg-ui.matches */
    /* @include src/shared/capture.inc.js#bgi-host.has */
    /* @include src/shared/input.inc.js#bgi-host.button */
    /* @include src/shared/input.inc.js#bgi-host.clickButton */
    phaseIn(f) {
      const p = this.memoFrame(f, "phase", () => this.readPhaseIn(f));
      this.runDiagnostics.phase = { phase: p.phase, turn: p.turn, at: Date.now() };
      return p;
    }
    readPhaseIn(f) {
      // Native victory animation starts around y=500 before moving upward.
      // The old y=101..482 crop missed that exact terminal frame (20:11).
      const result = this.ocr(f, this.roi("phase", [763, 101, 394, 600]));
      if (/对局胜利/.test(result)) return { phase: "result", result: "win", turn: "none" };
      if (/对局失败/.test(result)) return { phase: "result", result: "lose", turn: "none" };
      const title = this.ocr(f, this.roi("header", [844, 167, 232, 65]));
      if (title.includes("初始手牌")) return { phase: "opening", turn: "none" };
      if (title.includes("重投骰子")) return { phase: "roll", turn: "none" };
      if(TCG.norm(title)==="挑选卡牌")return this.choiceIn(f) ||
        {phase:"choice",turn:"none",choiceKind:"unknown",options:[],recognized:false};
      // A hover tooltip is not a persistent scene marker. During defeat picks
      // it vanishes when the cursor moves onto the selected character.
      // Exclude the player-name row; saved native pixels passed 9 shifted/
      // brightness variants at native scale. No additional detail clicks.
      const pickPrompt=TCG.norm(this.ocr(f,this.roi("bottom", [138,1020,280,48])));
      if (/^(请选择|选择)出战角色/.test(pickPrompt) || this.has(f, "core/出战角色", this.roi("bottom", pickLabelROI))) return { phase: "pick", turn: "none" };
      if (this.has(f, "core/回合结算阶段", this.roi("viewport", [0, 0, 384, 1080]))) return { phase: "settlement", turn: "none" };
      // Native action banners can coexist with the user-turn icon, while HP,
      // generated cards and the hand-count badge are still animating.
      const banner = TCG.norm(this.ocr(f, this.roi("phase", [700, 508, 580, 65])));
      if (this.automaticBanners?.includes(banner)) return { phase: "automatic", turn: "none", automatic: banner };
      if (["我方行动", "对方行动", "行动阶段", "回合开始"].includes(banner)) return { phase: "transition", turn: "none" };
      const user = this.has(f, "user_turn", this.roi("phase", [64, 518, 33, 42]), 0.9);
      const enemy = this.has(f, "enemy_turn", this.roi("phase", [64, 518, 33, 42]), 0.9);
      const opponent = this.has(f, "core/对方行动中", this.roi("viewport", [0, 0, 384, 1080]));
      if (user && !enemy && !opponent) return { phase: "board", turn: "user" };
      if (enemy && !user || opponent) return { phase: "board", turn: "enemy" };
      const choice=this.choiceIn(f);
      if(choice)return choice;
      return { phase: "unknown", turn: "none" };
    }
    phase(read = null) {
      // Optional pure readers bind their controls to this exact phase frame.
      // The usual phase-adoption invalidation below remains the sole owner.
      const p=this.frame(f=>{const phase=this.phaseIn(f);if(read)read(f,phase);return phase;});
      return this.adoptPhase(p);
    }
    adoptPhase(p) {
      if(p.phase!=="board"||p.turn!=="user") { this.boardReady=false; this.lastObservedAt=0; this.preparedHandInput=null; }
      return p;
    }
    /* @include src/shared/board.inc.js#tcg-ui.admitFreshActionBoard */
    /* @include src/shared/input.inc.js#bgi-host.characterOverviewIn */
    /* @include src/shared/input.inc.js#bgi-host.dismissCharacterOverview */
    /* @include src/shared/board.inc.js#bgi-host.diceIn */
    /* @include src/shared/opening.inc.js#bgi-host.readRollDice */
    /* @include src/shared/opening.inc.js#bgi-host.actionReroll */
    
    async probeSkill(action,before,memory) {
      const x={NA:1608,E:1716,Q:1824}[action.skill];
      if(action.who!==before.active || !x)throw new Error("费用检视只能用于当前角色的固定技能槽");
      this.clickAt(...this.point("bottom",x,957));await sleep(1200);
      let fee=null,last=null,stable=0;
      for(let i=0;i<4;i++){
        const sample=this.frame(f=>({phase:this.phaseIn(f),fee:this.skillFeeIn(f,action)}));
        this.requireHandObservation(sample.phase,"skill-fee-probe");
        const n=sample.fee;stable=n!==null&&n===last?stable+1:1;last=n;
        if(n!==null&&stable>=2){fee=n;break;}await sleep(180);
      }
      // A fee probe NEVER casts. Cancel, then prove unchanged real resources.
      this.boardReady=false;await this.reset();await this.requireUnchangedBoard(before);
      TCG.recordSkillCost(before,memory,action,fee);
      this.trace("skill-fee-probed",{who:action.who,skill:action.skill,fee,unchanged:true,castInputs:0});
      return {...before,confirmed:false,probed:true};
    }
    /* @include src/shared/capture.inc.js#bgi-host.numericAt */
    /* @include src/shared/capture.inc.js#bgi-host.enlargedOcrRows */
    /* @include src/shared/board.inc.js#tcg-ui.hpAt */
    /* @include src/shared/board.inc.js#bgi-host.diceCountIn */
    /* @include src/shared/board.inc.js#bgi-host.usePrecisionBoard */
    /* @include src/shared/board.inc.js#bgi-host.releasePrecisionBoard */
    /* @include src/shared/board.inc.js#bgi-host.normalHpProfileIn */
    /* @include src/shared/board.inc.js#tcg-ui.characterIn */
    /* @include src/shared/board.inc.js#tcg-ui.enemiesIn */
    /* @include src/shared/board.inc.js#bgi-host.auraIn */
    
    /* @include src/shared/board.inc.js#tcg-ui.board */
    /* @include src/shared/observation.inc.js#bgi-host.observationIssues */
    /* @include src/shared/observation.inc.js#bgi-host.finishObservation */
    /* @include src/shared/observation.inc.js#bgi-host.observedResourceProof */
    
    /* @include src/shared/hand.inc.js#tcg-ui.reset */
    /* @include src/shared/hand.inc.js#bgi-host.expand */
    /* @include src/shared/hand.inc.js#tcg-ui.requireHandObservation */
    /* @include src/shared/hand.inc.js#bgi-host.titleIn */
    /* @include src/shared/hand.inc.js#bgi-host.inspectHandCard */
    /* @include src/shared/hand.inc.js#bgi-host.takePreparedHandInput */
    /* @include src/shared/hand.inc.js#tcg-ui.titleAt */
    /* @include src/shared/hand.inc.js#bgi-host.invalidateHand */
    /* @include src/shared/hand.inc.js#bgi-host.acceptHand */
    /* @include src/shared/hand.inc.js#bgi-host.handCostMarkersIn */
    /* @include src/shared/hand.inc.js#bgi-host.handCostLayoutIn */
    /* @include src/shared/hand.inc.js#bgi-host.handPriceIn */
    /* @include src/shared/hand.inc.js#bgi-host.costHandIn */
    /* @include src/shared/hand.inc.js#bgi-host.selectedCardCostIn */
    /* @include src/shared/hand.inc.js#tcg-ui.handSample */
    /* @include src/shared/hand.inc.js#bgi-host.foldedHandCostsIn */
    /* @include src/shared/hand.inc.js#bgi-host.handEmpowermentIn */
    /* @include src/shared/hand.inc.js#bgi-host.publishHandPositions */
    /* @include src/shared/hand.inc.js#bgi-host.handPoints */
    /* @include src/shared/hand.inc.js#tcg-ui.handCountIn */
    /* @include src/shared/hand.inc.js#bgi-host.recordHandLayout */
    /* @include src/shared/hand.inc.js#bgi-host.handCount */
    /* @include src/shared/hand.inc.js#tcg-ui.readHandTitles */
    /* @include src/shared/hand.inc.js#tcg-ui.readHand */
    /* @include src/shared/hand.inc.js#tcg-ui.observedHand */
    /* @include src/shared/observation.inc.js#bgi-host.settledBoard */
    /* @include src/shared/board.inc.js#bgi-host.requireDiceBudget */
    /* @include src/shared/observe.inc.js#bgi-host.observe */
    /* @include src/shared/hand.inc.js#bgi-host.handPresenceIn */
    async proveEmptyHand(plan,settled) {
      const receipt=this.consumptionReceipt,a=plan?.action,b=plan?.before;
      if(plan?.mode!=="remove" || plan.hand.length!==0 || b?.hand?.length!==1 || !a ||
          !receipt?.inputSent || receipt.beforeKey!==TCG.boardKey(b) || receipt.id!==a.id ||
          receipt.index!==a.index || receipt.target!==(a.target??null) ||
          settled.phase!=="board" || settled.turn!=="user")return false;
      const count = await this.handCount();
      // Share this observation with the ordinary removal path, even if a
      // deck's effect verifier needs more than empty-hand evidence.
      plan.countObservation = { count, revision: this.inputRevision };
      if (count !== 0) return false;
      const proof = { ...receipt, kind:"native-empty-fan", stableReads:2, sourceCount:1,
        method:"card-structure-absence", revision:this.inputRevision };
      if (!TCG.emptyHandEffect(a,b,{...settled,handEvidence:proof},false)) return false;
      this.pendingHandEvidence=proof;this.emptyHandProven=true;
      // With zero cards, expansion cannot cover the board. No fold toggle.
      this.handFanReady=false;this.handNeedsReset=false;this.boardReady=true;
      this.trace("empty-hand-proof",{action:a,proof,netDice:TCG.total(settled.dice)-TCG.total(b.dice)});
      return true;
    }
    
    /* @include src/shared/opening.inc.js#bgi-host.confirmOpening */
    /* @include src/shared/opening.inc.js#tcg-ui.opening */
    /* @include src/shared/opening.inc.js#tcg-ui.openingSelections */
    /* @include src/shared/hand.inc.js#bgi-host.removalEvidenceBeforeReset */
    
    markNativeCardConfirmation(action,layout) {
      const r=this.consumptionReceipt;
      if(r?.inputSent===true && r.id===action.id && r.index===action.index && r.target===(action.target??null)) {
        r.nativeConfirmed=true;r.confirmationLayout=layout;
      }
    }
    /* @include src/shared/opening.inc.js#bgi-host.firstPickObservation */
    /* @include src/shared/opening.inc.js#tcg-ui.pick */
    /* @include src/shared/opening.inc.js#bgi-host.pickSelectionIn */
    /* @include src/shared/opening.inc.js#tcg-ui.pickForced */
    /* @include src/shared/opening.inc.js#tcg-ui.roll */
    async drag(x, y, toX, toY) {
      // Validate BOTH endpoints before any movement or button press.
      const size = this.captureGeometry?.frameSize;
      const start = mousePoint(x, y, size), end = mousePoint(toX, toY, size);
      this.moveTo(start[0], start[1]);
      await sleep(60);
      this.requireMatchTime();
      this.checkInputGeometry();
      leftButtonDown();
      this.inputRevision++;
      this.handPositionProof = null;
      try {
        for (let i = 1; i <= 10; i++) {
          this.moveTo(start[0] + (end[0] - start[0]) * i / 10, start[1] + (end[1] - start[1]) * i / 10);
          await sleep(15);
        }
      } finally { leftButtonUp(); }
      await sleep(350);
    }
    /* @include src/shared/input.inc.js#bgi-host.warnings */
    /* @include src/shared/input.inc.js#bgi-host.cardPaymentControlsIn */
    /* @include src/shared/input.inc.js#bgi-host.cardConfirmationEntryIn */
    /* @include src/shared/input.inc.js#bgi-host.cardChoicePreviewIn */
    /* @include src/shared/input.inc.js#bgi-host.waitForSample */
    /* @include src/shared/input.inc.js#bgi-host.cardTargetPreviewIn */
    /* @include src/shared/input.inc.js#tcg-ui.requireNoWarning */
    /* @include src/shared/input.inc.js#bgi-host.requireSwitchPreview */
    
    /* @include src/shared/input.inc.js#tcg-ui.requireUnchangedBoard */
    preInputBoardClean() { return this.boardReady; }
    /* @include src/shared/input.inc.js#tcg-ui.execute */
    
    /* @include src/shared/hand.inc.js#bgi-host.inputHand */
    /* @include src/shared/input.inc.js#tcg-ui.confirmTune */
    /* @include src/shared/input.inc.js#bgi-host.inputSkill */
    
    async inputSwitch(action,before,memory) {
      /* @include src/shared/input.inc.js#bgi-host.switchInputBody */
    }
    async inputEnd() {
      /* @include src/shared/input.inc.js#bgi-host.endRoundInputBody */
    }
    /* @include src/shared/hand.inc.js#tcg-ui.prepareHandInput */
    /* @include src/shared/hand.inc.js#bgi-host.refreshHandBeforeInput */
    /* @include src/shared/confirmation.inc.js#bgi-host.confirm */
    /* @include src/shared/confirmation.inc.js#bgi-host.confirmPending */
    /* @include src/shared/confirmation.inc.js#bgi-host.forcedActionProof */
    adoptObservedState(state, reason) {
      if (!TCG.legalState(state)) throw new Error("重同步状态无效，不能作为下一动作基线");
      this.expectedDice = TCG.total(state.dice);
      this.gamblerBudget = null;
      this.emptyHandProven = state.hand.length === 0;
      this.boardReady=true;
      this.lastObservedState=state;
      this.lastObservedAt=0;this.lastObservedRevision=-1;
      this.consumptionReceipt=null;this.pendingHandEvidence=null;
      this.acceptHand(state.hand, reason);
    }
    /* @include src/shared/capture.inc.js#bgi-host.reportStop */
    /* @include src/shared/capture.inc.js#bgi-host.dispose */
  }
  root.TCGBetterGI = { BetterGIHost, handX, handLayoutCount, charX, number, mousePoint, captureSize, costMarkerLayout, costDigitRows, costNumbersAt, costHandSample, boardDifferences };
})(globalThis);
