// One pending-action owner. Observation can retry; submitted input cannot.

// @fragment bgi-host.confirm
async confirm(action, before, memory = TCG.freshMemory()) {
      let pending = false;
      try { return await this.confirmPending(action, before, memory); }
      catch (e) {
        pending = ["TCG_CONFIRMATION_RETRY", "TCG_BOARD_RETRY", "TCG_DICE_RETRY", "TCG_HAND_RETRY"].includes(e.code);
        throw e;
      }
      finally {
        if (!pending) {
          this.confirmationSession = null;
          this.actionSubmittedAt = null;
          this.consumptionReceipt = null;
          this.pendingHandEvidence = null;
          this.soupReceipt = null;
        }
      }
    }
// @endfragment bgi-host.confirm

// @fragment bgi-host.confirmPending
async confirmPending(action, before, memory = TCG.freshMemory()) {
      const key = TCG.actionKey(action) + "/" + TCG.boardKey(before);
      if (this.confirmationSession && this.confirmationSession.key !== key)
        throw new Error("上一个动作仍待确认，禁止提交另一动作");
      const session = this.confirmationSession || { key, transition: false, submittedAt: this.actionSubmittedAt ?? null,
        plan: action.type === "end" ? null : { ...TCG.handPlan(action, before, memory), action, before } };
      this.confirmationSession = session;
      const deadline = Math.min(Date.now() + 45000, this.matchDeadline ?? Infinity);
      let lastPhase = null;
      let sampledAt = 0;
      // Polling intervals include this cycle's OCR/observation work. This does
      // not shorten the input helpers' animation waits or replay an input.
      const waitForSample = async interval => {
        const remaining = Math.min(interval - (Date.now() - sampledAt), deadline - Date.now());
        if (remaining > 0) await sleep(remaining);
      };
      const combat = ["skill", "switch", "end"].includes(action.type) ||
        action.type === "card" && ["floralSidewinder", "skivingNewAndImproved", "wedge", "penance"].includes(action.id);
      // The existing combat flag also owns switch/end recovery. This new
      // refresh policy is only for casts, not ordinary fast/manual switches.
      const effectAction = combat && !["switch", "end"].includes(action.type);
      while (Date.now() < deadline) {
        sampledAt = Date.now();
        const p = this.phase();
        lastPhase = p;
        if (p.result) return { ...p, confirmed: true };
        if (p.turn === "enemy" || ["choice", "roll", "pick", "settlement"].includes(p.phase))
          session.handObservation = null;
        if (this.choiceSession || p.phase === "choice") {
          session.handObservation = null;
          try { await this.resolveChoice(before, memory); }
          catch (e) { if (e.code !== "TCG_CHOICE_RETRY") throw e;
            this.trace("choice-deferred", { action, reason: e.message }); await waitForSample(300); continue; }
          // A verified payment/target exit is not a generated-card choice.
          // Keep simple removal only when this action owns the completed exit.
          const receipt = this.soupReceipt || this.choiceReceipt;
          if (!(session.plan?.mode === "remove" && receipt?.origin === session.key &&
              receipt.exited === true && (this.soupReceipt === receipt || ["payment", "target"].includes(receipt.kind))))
            session.plan = { mode: "full", action, before, expectedCount: this.handCountHint,
              retainedHand: session.plan?.retainedHand,retainedVariantFamilies:session.plan?.retainedVariantFamilies };
          continue;
        }
        if (action.type === "card" && action.id === "toss" && (this.tossSession || p.phase === "roll")) {
          const proof = await this.actionReroll(before, memory);
          session.plan = { ...session.plan, rerollConfirmed: proof?.confirmations === 2 }; continue;
        }
        if (p.turn === "enemy") session.transition = true;
        if (action.type === "end" && TCG.verify(action, before, p)) return { ...p, confirmed: true };
        // End-turn confirmation is a phase transition, not a hand effect.
        // While its animation still reports our board, keep the same submitted
        // session; no full observation, hand invalidation or second click.
        if (action.type === "end" && p.phase === "board" && p.turn === "user") { await waitForSample(450); continue; }
        if (p.phase === "pick") {
          if (session.plan?.mode === "unchanged") this.acceptHand(session.plan.hand, "forced-pick-unchanged-action");
          else this.invalidateHand("forced-character-pick-hand-changing-action");
          const independent = combat && !session.transition && await this.forcedActionProof(action, before);
          const confirmed = combat && (session.transition || independent);
          this.trace("confirmation-forced-pick", { action, transition: session.transition, independent, confirmed });
          return { ...p, confirmed };
        }
        if (p.turn === "user") {
          let after;
          try {
            this.requireHandObservation(p, "before-confirm-reset");
            const receipt = await this.removalEvidenceBeforeReset(session.plan);
            if (!this.boardReady && (this.handNeedsReset || this.handFanReady)) await this.reset();
            if (receipt && this.inputRevision >= receipt.revision && this.inputRevision <= receipt.revision + 1)
              session.plan = { ...session.plan, preResetEvidence: { ...receipt, revision: this.inputRevision } };
            after = await this.observe(true, session.plan ? { ...session.plan, transitionPassed: session.transition } : null);
          } catch (e) {
            if (["TCG_BOARD_RETRY", "TCG_DICE_RETRY", "TCG_HAND_RETRY"].includes(e.code)) {
              this.trace("confirmation-read-deferred", { action, code: e.code, missing: e.missing, reason: e.message });
              await waitForSample(400); continue;
            }
            if (e.code !== "TCG_OBSERVATION_INTERRUPTED") throw e;
            after = { ...e.phase, hand: null };
          }
          if (after.result) return { ...after, confirmed: true };
          if (after.phase !== "board" || after.turn !== "user") {
            if (after.turn === "enemy" || ["choice", "roll", "pick", "settlement"].includes(after.phase))
              session.handObservation = null;
            if (after.turn === "enemy") session.transition = true;
            this.trace("confirmation-deferred", { action, phase: after.phase, turn: after.turn });
            await waitForSample(450); continue;
          }
          // Consumed source can precede a late soup page. Keep its owner even
          // after a complete resync; neither success nor uncertain exit closes it.
          if (TCG.confirmationReady && !TCG.confirmationReady(action, before, after)) {
            await waitForSample(250); continue;
          }
          const verified = TCG.verify(action, before, after, session.transition);
          const budgetMatches = this.diceBudgetMatches(after);
          // Begin observing immediately after submission. A positive effect may
          // confirm early; the unchanged pre-animation board cannot reject or
          // resynchronize the action during the former fixed 1200ms wait.
          if (!verified && !session.transition && session.submittedAt !== null &&
              Date.now() - session.submittedAt < 1200) {
            this.trace("confirmation-awaiting-effect", { action, elapsed: Date.now() - session.submittedAt });
            await waitForSample(120); continue;
          }
          if (verified && budgetMatches) {
            this.acceptHand(after.hand, "confirmed-" + (session.plan?.mode || "full"));
            // Resource/consumption proof can precede the combat's visible
            // effects. Keep that cast confirmed (never resend it), but do not
            // hand this early snapshot straight to the next planner. A new
            // full observation is required when no enemy turn was observed;
            // it must not wait for predicted damage or exclude zero damage.
            return { ...after, ...this.confirmationExtras?.(), confirmed: true,
              freshObservationRequired: effectAction && !session.transition };
          }
          if (!budgetMatches && !await this.observedResourceProof(after)) {
            this.trace("budget-reconciliation-wait", { action, expectedDice: this.expectedDice,
              observedDice: TCG.total(after.dice), missing: ["native-dice-count-proof"] });
            await waitForSample(400); continue;
          }
          this.trace("state-resync", { action, verified, budgetMatches, expectedDice: this.expectedDice,
            observedDice: TCG.total(after.dice), reuseFullRead: after.handRead === "full" });
          if (!verified && session.plan?.mode !== "unchanged" && after.handRead !== "full") {
            this.invalidateHand("post-action-state-mismatch"); this.emptyHandProven = false;
            after = await this.observe(true, { mode: "full", expectedCount: null });
          }
          if (after.result) return { ...after, confirmed: true };
          if (after.phase !== "board" || after.turn !== "user") {
            if (after.turn === "enemy") session.transition = true;
            await waitForSample(450); continue;
          }
          if (!TCG.legalState(after)) {
            await waitForSample(400); continue;
          }
          if (TCG.confirmationReady && !TCG.confirmationReady(action, before, after)) {
            await waitForSample(250); continue;
          }
          const confirmed = TCG.verifyResynchronized(action, before, after, session.transition);
          this.adoptObservedState(after, "post-action-resync");
          this.trace("state-resynced", { action, confirmed, after });
          return { ...after, ...this.confirmationExtras?.(), confirmed, resynchronized: true,
            freshObservationRequired: confirmed && effectAction && !session.transition };
        }
        if (p.phase === "roll" && combat) return { ...p, confirmed: session.transition };
        await waitForSample(450);
      }
      const error = new Error("动作仍待核实，保留本次输入并继续观察");
      error.code = "TCG_CONFIRMATION_RETRY";
      error.phase = lastPhase;
      error.elapsedMs = session.submittedAt === null ? null : Date.now() - session.submittedAt;
      throw error;
    }
// @endfragment bgi-host.confirmPending

// @fragment bgi-host.forcedActionProof
async forcedActionProof(action, before) {
      // Death/energy reset is not proof of a cast. Preserve deck verification,
      // but require two fresh identical frames and a positive resource effect.
      if (action.type !== "skill") return false;
      const revision = this.inputRevision;
      let previous = "";
      for (let i = 0; i < 2; i++) {
        const sampledAt = Date.now();
        let after;
        try { after = this.board(); }
        catch (e) { if (["TCG_BOARD_RETRY", "TCG_DICE_RETRY"].includes(e.code)) return false; throw e; }
        const caster = after.characters?.[action.who], oldCaster = before.characters?.[action.who];
        const paid = after.diceKnown===true&&before.diceKnown===true&&TCG.total(after.dice) < TCG.total(before.dice);
        const charged = TCG.alive(caster) && Number.isInteger(caster.energy) &&
          Number.isInteger(oldCaster?.energy) && caster.energy > oldCaster.energy;
        if (after.phase !== "pick" || this.inputRevision !== revision || !(paid || charged)) return false;
        const key = JSON.stringify([after.phase, after.characters, after.dice, after.enemies]);
        if (i === 1) return key === previous;
        previous = key;
        const remaining = 120 - (Date.now() - sampledAt);
        if (remaining > 0) await sleep(remaining);
      }
      return false;
    }
// @endfragment bgi-host.forcedActionProof
