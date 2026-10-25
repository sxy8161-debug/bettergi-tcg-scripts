// Observation owns native completeness/stability; reconciliation owns budgets.

// @fragment bgi-host.boardsMatch
boardsMatch(before, after, purpose = "observation", _action = null) {
      const key=s=>JSON.stringify([s.phase,s.turn,s.active,TCG.diceOrder.map(e=>s.dice?.[e]||0),s.characters,s.enemies,
        s.quicken||null,s.supportCounts||null,...(purpose==="observation"?[s.eye||null,s.dendroCore||null]:[]),s.summonLayout||null]);
      return !!before && !!after && key(before)===key(after);
    }
// @endfragment bgi-host.boardsMatch

// @fragment bgi-host.observationIssues
observationIssues(state) {
      const issues = [];
      if (state.phase !== "board") issues.push("phase");
      if (state.turn !== "user") issues.push("turn");
      if (state.diceKnown !== true) issues.push("dice");
      if (!Number.isInteger(state.active) || !TCG.alive(state.characters?.[state.active])) issues.push("active");
      if (!Array.isArray(state.characters) || state.characters.length !== 3) issues.push("own");
      else state.characters.forEach((c, i) => {
        if (c?.dead === true) return;
        if (!TCG.alive(c)) issues.push(`own[${i}].hp`);
        if (!Number.isInteger(c?.energy) || c.energy < 0 || c.energy > TCG.team[i].maxEnergy) issues.push(`own[${i}].energy`);
        if (typeof c?.frozen !== "boolean") issues.push(`own[${i}].status`);
      });
      if (TCG.enemyCount(state) === null) issues.push("enemy");
      if (!issues.length && !TCG.legalState({ ...state, hand: [] })) issues.push("board-rules");
      return issues;
    }
// @endfragment bgi-host.observationIssues

// @fragment bgi-host.settledBoard
async settledBoard(_pendingAction = false, firstBoard = null) {
      // A failed hand read or completed choice can leave cards/details raised.
      // Normalize at the full-board boundary, never OCR obscured HP in a loop.
      if (this.handFanReady || this.handNeedsReset) {
        const phase = this.phase();
        if (phase.phase !== "board" || phase.turn !== "user") return { ...phase, hand: null };
        await this.reset();
        firstBoard = null;
      }
      this.prepareBoardObservation?.();
      const requiredReads = this.autoRisk ? 2 : 1;
      let stableReads = 0, hpGapReads = 0;
      let last = null, previousBoard = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const sampledAt = Date.now();
        try { last = attempt === 0 && firstBoard ? firstBoard : this.board(true); }
        catch (e) {
          if (e.code !== "TCG_DICE_RETRY") throw e;
          previousBoard = null; stableReads = 0; hpGapReads = 0;
          this.trace("board-settle-wait", { attempt, missing: ["dice"], reason: e.message });
          const remaining = 400 - (Date.now() - sampledAt);
          if (attempt < 11 && remaining > 0) await sleep(remaining);
          continue;
        }
        if (last.result || ["pick", "roll", "settlement", "choice"].includes(last.phase) || last.turn === "enemy") {
          this.releasePrecisionBoard("scene-exit");
          return { ...last, hand: null };
        }
        const issues = this.observationIssues(last);
        const hpGap = last.phase === "board" && last.turn === "user" &&
          [...(last.characters || []), ...(last.enemies || [])].some(c => c?.dead !== true && !TCG.alive(c));
        hpGapReads = hpGap ? hpGapReads + 1 : 0;
        if (hpGapReads === 1 && await this.dismissCharacterOverview("board-hp-gap")) {
          previousBoard = null; stableReads = 0; hpGapReads = 0;
          continue;
        }
        if (!issues.length) {
          if (this.boardsMatch(previousBoard,last)) stableReads++;
          else stableReads = 1;
          // Ordinary actions need a complete current board, not repeated
          // equality. Combat/automatic effects retain one corroborating frame.
          if (stableReads >= requiredReads) {
            if (this.autoRisk) this.trace("automatic-settled", { active: last.active, proof: "two-complete-native-boards" });
            this.autoRisk = false;
            if (last.normalHpReadable === true) this.releasePrecisionBoard("complete-normal-hp-profile");
            const observed=previousBoard ? this.stabilizeBoardExtras?.(previousBoard,last)||last : last;
            return { ...observed, nativeStability: { reads: stableReads, key: TCG.boardKey({ ...observed, hand: [] }), inputRevision: this.inputRevision } };
          }
        } else stableReads = 0;
        const changes=previousBoard?boardDifferences(previousBoard,last,true):{};
        previousBoard = issues.length ? null : last;
        this.trace("board-settle-wait", { attempt, phase: last.phase, turn: last.turn,
          valid: issues.length === 0, missing: issues, hpGapReads, changed:Object.keys(changes),changes });
        if (hpGapReads === 3 && !this.precisionBoard) {
          this.usePrecisionBoard("three-consecutive-user-hp-gaps");
          previousBoard = null; stableReads = 0;
        }
        const remaining = 400 - (Date.now() - sampledAt);
        if (attempt < 11 && remaining > 0) await sleep(remaining);
      }
      const missing = last ? this.observationIssues(last) : ["capture"];
      const error = new Error("行动页12次读取未稳定" + (missing.length ? "：" + missing.join("、") : ""));
      error.code = "TCG_BOARD_RETRY"; error.missing = missing;
      throw error;
    }
// @endfragment bgi-host.settledBoard

// @fragment bgi-host.finishObservation
finishObservation(state, pendingAction, handRead, observedAt = Date.now()) {
      if (!TCG.legalState(state) || TCG.enemyCount(state) === null) {
        const error = new Error("完整观察仍有未知字段：" + this.observationIssues(state).join("、"));
        error.code = "TCG_BOARD_RETRY"; throw error;
      }
      let resynchronized = false;
      TCG.refreshSkillCosts(this.memory,state);
      if (!pendingAction) {
        if (!this.diceBudgetMatches(state)) {
          this.trace("state-resync", { reason: "observation-budget", expectedDice: this.expectedDice, observedDice: TCG.total(state.dice) });
          this.adoptObservedState(state, "observation-resync"); resynchronized = true;
          this.trace("state-resynced", { reason: "observation-budget", after: state });
        }
        if (!resynchronized) this.acceptHand(state.hand, "observed-stable-board");
      }
      this.boardReady = true; this.lastObservedState = state; this.lastObservedAt = observedAt;
      this.lastObservedRevision = this.inputRevision;
      return { ...state, handRead, ...(resynchronized ? { resynchronized: true } : {}) };
    }
// @endfragment bgi-host.finishObservation

// @fragment bgi-host.observedResourceProof
async observedResourceProof(state) {
      if (!TCG.legalState(state) || this.autoRisk || this.handNeedsReset || this.handFanReady) return null;
      const revision = this.inputRevision, count = TCG.total(state.dice);
      for (let attempt = 0; attempt < 2; attempt++) {
        const sampledAt = Date.now();
        let sample;
        try { sample = this.frame(f => {
          const phase = this.phaseIn(f);
          if (phase.phase !== "board" || phase.turn !== "user") return phase;
          return { ...phase, dice: this.diceIn(f).dice, badge: this.diceCountIn(f) };
        }); } catch (e) { if (e.code === "TCG_DICE_RETRY") return null; throw e; }
        if (sample.phase !== "board" || sample.turn !== "user" || sample.badge !== count ||
            !TCG.diceOrder.every(e => (sample.dice?.[e] || 0) === (state.dice[e] || 0)) ||
            TCG.total(sample.dice) !== count || this.inputRevision !== revision) return null;
        const remaining = 120 - (Date.now() - sampledAt);
        if (attempt === 0 && remaining > 0) await sleep(remaining);
      }
      const proof = { kind: "two-fresh-element-and-count-frames", count, stableReads: 2, revision };
      this.trace("resource-native-proof", { ...proof, expectedDice: this.expectedDice, attributedEffect: null });
      return proof;
    }
// @endfragment bgi-host.observedResourceProof
