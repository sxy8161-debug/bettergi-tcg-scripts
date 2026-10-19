// Shared hand fragments. Inlined at build time; no runtime dependency.

// @fragment bgi-host.handCostMarkersIn
handCostMarkersIn(f, roi, useColor = false) {
      const threshold = roi.panel === "handFolded" && roi.layoutKey === "16:10" ? .88 : .9;
      return ["hand_cost_neutral", "hand_cost_element", "hand_cost_dendro", "hand_cost_electro", "hand_cost_matching"]
        .flatMap(asset => this.matches(f, asset, roi, threshold, useColor));
    }
// @endfragment bgi-host.handCostMarkersIn

// @fragment bgi-host.acceptHand
acceptHand(hand, reason) {
      this.handCache = TCG.reconcileHand(this.handProvenance, hand, false,
        (this.memory?.refusedActions || []).filter(r => r.uncertain && r.round === this.memory.round));
      // Publish the same provenance into the observation returned to planning.
      hand.forEach((card, index) => Object.assign(card, this.handCache[index]));
      this.handProvenance = this.handCache;
      this.trace("hand-cache-updated", { reason, count: this.handCache.length });
    }
// @endfragment bgi-host.acceptHand

// @fragment bgi-host.handCostLayoutIn
handCostLayoutIn(f, nativeCount = null) {
      return this.memoFrame(f, "costLayout:" + nativeCount, () => {
        const measured = nativeCount ?? (this.handFanReady ? this.memoFrame(f, "hand/rim-count", () =>
          handLayoutCount(this.matches(f, "hand_rim", this.roi("handExpanded", [500, 900, 1260, 135]), 0.85, false).map(r => r.x))) : null);
        return costMarkerLayout(this.handCostMarkersIn(f, this.roi("handExpanded", [450, 750, 1310, 200])), measured, this.panelTransform("handExpanded"));
      });
    }
// @endfragment bgi-host.handCostLayoutIn

// @fragment bgi-host.handPriceIn
handPriceIn(f, marker) {
      const cost = number(this.numericAt(f, this.observedRoi("handExpanded", [Math.round(marker.x + 12), Math.round(marker.y - 5), 36, 42]), 4));
      return cost !== null ? { cost, reads: 1 } : {
        cost: number(this.numericAt(f, this.observedRoi("handExpanded", [Math.round(marker.x), Math.round(marker.y - 30), 60, 90]), 4)), reads: 2,
      };
    }
// @endfragment bgi-host.handPriceIn

// @fragment bgi-host.costHandIn
costHandIn(f, nativeCount = null) {
      return this.memoFrame(f, "costHand:" + nativeCount, () => {
        const roi = [450, 750, 1310, 200];
        const matches = this.handCostMarkersIn(f, this.roi("handExpanded", roi)), layout = this.handCostLayoutIn(f, nativeCount);
        const unresolved = (reason, detail = {}) => {
          const key = "hand-cost-unresolved:" + reason;
          if (!this.diagnosticKeys.has(key)) {
            this.diagnosticKeys.add(key);
            this.trace("hand-cost-unresolved", { reason, matches, layout, nativeCount, ...detail });
          }
          return null;
        };
        if (!layout) return unresolved("geometry");
        const yy = Math.floor(
          Math.max(this.point("handExpanded",0,750)[1], Math.min(this.point("handExpanded",0,840)[1], Math.min(...layout.markers.map((m) => m.y)) - 40)),
        );
        const numbers = costDigitRows(this.enlargedOcrRows(f, this.observedRoi("handExpanded", [470, yy, 1290, 110]), 3));
        let localRecoveryCalls = 0;
        for (const m of layout.markers) {
          const found = costNumbersAt(m, numbers);
          if (found.length > 1) { unresolved("ambiguous-digit", { marker: m, numbers }); continue; }
          if (found.length === 1 && found[0].value < 10) continue;
          if (found.length === 1) {
            // Whole-row OCR can concatenate neighbouring strokes (native 1→11).
            // Verify only this digit in its tight crop; legal two-digit prices
            // are retained, never clamped to the printed card cost.
            numbers.splice(numbers.indexOf(found[0]),1);
            const value=number(this.numericAt(f,this.observedRoi("handExpanded", [Math.round(m.x+12),Math.round(m.y-5),36,42]),4));
            localRecoveryCalls++;
            if(value!==null)numbers.push({...found[0],value});
            continue;
          }
          // The tight crop also reads zeroes that a broad OCR row drops.
          // Use the same numeric ROI as selected/folded prices before wider rows.
          const digit=number(this.numericAt(f,this.observedRoi("handExpanded", [Math.round(m.x+12),Math.round(m.y-5),36,42]),4));
          localRecoveryCalls++;
          if(digit!==null){numbers.push({value:digit,x:m.x+28,y:m.y+15});continue;}
          // Only missing locations: at most three wider crops on the SAME frame.
          // No clicks, title expansion, guessed values, or unbounded ROI search.
          let recovered = false;
          for (const [dx, dy, w, h] of [
            [0, -30, 60, 90],
            [8, -18, 44, 68],
            [-4, -30, 68, 90],
          ]) {
            const local = costNumbersAt(
              m,
              costDigitRows(
                this.enlargedOcrRows(f, this.observedRoi("handExpanded", [Math.floor(m.x + dx), Math.floor(m.y + dy), w, h]), 4),
              ),
            );
            localRecoveryCalls++;
            if (local.length > 1) {
              numbers.push(...local);
              unresolved("ambiguous-digit", { marker: m, numbers, local });
              recovered = true;
              break;
            }
            if (local.length === 1) {
              numbers.push(local[0]);
              recovered = true;
              break;
            }
          }
          if (!recovered)
            unresolved("missing-digit", { marker: m, numbers, localRecoveryCalls });
        }
        const sample = costHandSample(layout, numbers);
        return { ...sample, localRecoveryCalls };
      });
    }
// @endfragment bgi-host.costHandIn

// @fragment bgi-host.foldedHandCostsIn
foldedHandCostsIn(f, layout) {
      // The same native digits (including green prices), on an already bound
      // folded row. A missing price does not invalidate any card identity.
      const numbers=costDigitRows(this.enlargedOcrRows(f,this.roi("handFolded", [430,965,1050,70]),3));
      const costs=layout.slots.map(({marker})=>{
        const found=costNumbersAt(marker,numbers);
        if(found.length===1&&found[0].value<10)return found[0].value;
        if(found.length>1)return null;
        return number(this.numericAt(f,this.observedRoi("handFolded", [marker.x+12,marker.y-5,36,42]),4));
      });
      return {costs,source:"native-folded-cost-markers"};
    }
// @endfragment bgi-host.foldedHandCostsIn

// @fragment bgi-host.handEmpowermentIn
handEmpowermentIn(f, markers) {
      // A covered/missing badge is unknown, never proof of no empowerment.
      return markers.map(m => this.matches(f, "hand_empowered",
        this.observedRoi("handExpanded", [Math.round(m.x + 68), Math.round(m.y - 12), 68, 66]), .92, true).length ? true : null);
    }
// @endfragment bgi-host.handEmpowermentIn

// @fragment bgi-host.selectedCardCostIn
selectedCardCostIn(f, x) {
      const roi = [Math.round(x - 125), this.point("handExpanded",0,750)[1], 80, 140];
      const marks = this.handCostMarkersIn(f, this.observedRoi("handExpanded", roi))
        .filter(m => Math.abs(m.x + 103 - x) <= 32).sort((a,b) => a.y - b.y);
      if (!marks.length) return null;
      const m = marks[0];
      const read = this.handPriceIn(f, m);
      let cost = read.cost;
      if (read.reads > 1) {
        this.trace("selected-cost-retry", { point:x, cost, additionalInputs:0 });
      }
      if (cost === null) {
        const p = this.selectedCostProof, age = p ? Date.now() - p.at : Infinity;
        const index = p ? p.points.indexOf(x) : -1;
        if (p && this.inputRevision === p.revision + 1 && age >= 0 && age <= 5000 && TCG.known(p.costs[index])) {
          cost = p.costs[index];
          this.trace("selected-cost-reused", { index, cost, proof:"two-native-cost-frames-before-selection", additionalInputs:0 });
        }
      }
      if (cost === null) this.trace("selected-cost-unread", { point:x, marker:m });
      return cost;
    }
// @endfragment bgi-host.selectedCardCostIn

// @fragment bgi-host.expand
async expand(resetFirst = true) {
      // The native control is a toggle. Card selection does not close the fan;
      // never click that control again while the same layout remains ready.
      if (this.handFanReady) {
        this.trace("hand-expand-skipped", { reason: "fan-already-ready" });
        return;
      }
      if (resetFirst && !this.boardReady) await this.reset();
      this.clickAt(...this.point("handFolded",967,1041));
      this.moveTo(...this.point("bottom",1791,917));
      await sleep(180);
      this.handFanReady = true;
      this.handNeedsReset = true;
      this.trace("hand-expanded", { resetFirst });
    }
// @endfragment bgi-host.expand

// @fragment bgi-host.handCount
async handCount(expected = null) {
      this.requireHandObservation(this.phase(), "before-hand-expand");
      if (!this.handFanReady) await this.expand();
      const readCount = () =>
        this.frame((f) => {
          // The fan's count badge is transient. Collect consecutive read-only
          // count frames quickly; full phase OCR between them can outlive it.
          // A fresh phase guard follows the bounded sampling BEFORE any input.
          return this.handSample(f);
        });
      const reads = [],
        samples = [];
      let previous = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const sampledAt = Date.now();
        const sample = readCount(),
          result =
            Number.isInteger(sample.count) && sample.count >= 0 && sample.count <= 10
              ? sample.count
              : null;
        reads.push(result);
        samples.push(sample);
        if (result !== null && result === previous) {
          this.requireHandObservation(this.phase(), "hand-count-resolved");
          this.publishHandPositions(samples, result);
          if (this.emptyHandProven && result > 0) {
            this.emptyHandProven = false;
            this.invalidateHand("visible-cards-after-empty-hand");
          }
          this.trace("hand-count", { count: result, reads });
          this.recordHandLayout(result);
          return result;
        }
        previous = result;
        // Recycle/discount and drawn-card animations can outlast the transient
        // badge. Keep the same raised fan and wait read-only, rather than
        // immediately toggling it. The normal two-clean-frame path is unchanged.
        const remaining = (attempt < 3 ? 120 : 300) - (Date.now() - sampledAt);
        if (attempt < 7 && remaining > 0) await sleep(remaining);
      }
      this.requireHandObservation(this.phase(), "hand-count-unresolved");
      const knownCounts = [...new Set(reads.filter((n) => n !== null))];
      if (knownCounts.length > 0) {
        const error = new Error(
          (knownCounts.length > 1 ? "手牌计数复读不稳定：" : "手牌计数未得到连续证据：") +
            JSON.stringify(reads),
        );
        error.code = "TCG_HAND_RETRY";
        throw error;
      }
      // Missing badge/rim evidence is never a guessed zero or a reason to
      // click candidate positions. Retry read-only on the same raised fan.
      if (this.emptyHandProven) return 0;
      const error = new Error("无法确认手牌数量");
      error.code = "TCG_HAND_RETRY";
      throw error;
    }
// @endfragment bgi-host.handCount

// @fragment bgi-host.handPoints
handPoints(count) {
      const p = this.handPositionProof,
        age = p ? Date.now() - p.at : Infinity;
      return p &&
        p.count === count &&
        p.revision === this.inputRevision &&
        age >= 0 &&
        age <= 5000 &&
        this.handFanReady
        ? p.points.slice()
        : (handX[count] || []).slice();
    }
// @endfragment bgi-host.handPoints

// @fragment bgi-host.invalidateHand
invalidateHand(reason) {
      if (this.handCache !== null)
        this.trace("hand-cache-invalidated", { reason, count: this.handCache.length });
      this.handCache = null;
      this.handCountHint = null;
      this.handPositionProof = null;
      if (this.confirmationSession) this.confirmationSession.handObservation = null;
    }
// @endfragment bgi-host.invalidateHand

// @fragment bgi-host.publishHandPositions
publishHandPositions(samples, count) {
      this.handPositionProof = null;
      if (samples.length < 2 || !this.handFanReady) return;
      const [a, b] = samples.slice(-2),
        p = a.cost,
        q = b.cost;
      if (
        !p ||
        !q ||
        a.count !== count ||
        b.count !== count ||
        p.count !== count ||
        q.count !== count ||
        p.revision !== this.inputRevision ||
        q.revision !== this.inputRevision ||
        p.points.length !== count ||
        q.points.length !== count ||
        p.costs.length !== count ||
        q.costs.length !== count ||
        p.markerYs.length !== count ||
        q.markerYs.length !== count ||
        [p, q].some(
          (s) => !Number.isFinite(s.at) || Date.now() - s.at < 0 || Date.now() - s.at > 5000,
        ) ||
        p.points.some(
          (x, i) =>
            !Number.isFinite(x) || !Number.isFinite(q.points[i]) || Math.abs(x - q.points[i]) > 8,
        ) ||
        p.markerYs.some(
          (y, i) =>
            !Number.isFinite(y) ||
            !Number.isFinite(q.markerYs[i]) ||
            Math.abs(y - q.markerYs[i]) > 8,
        )
      )
        return;
      this.handPositionProof = {
        count,
        points: q.points.slice(),
        costs: q.costs.map((cost, i) => cost === p.costs[i] ? cost : null),
        revision: this.inputRevision,
        at: q.at,
      };
      this.trace(this.handPositionProof.costs.some(TCG.known)?"hand-cost-proof":"hand-position-proof", {
        count,
        points: q.points,
        costs: this.handPositionProof.costs,
        stableReads: 2,
        localRecoveryCalls: q.localRecoveryCalls,
        additionalInputs: 0,
      });
    }
// @endfragment bgi-host.publishHandPositions

// @fragment bgi-host.recordHandLayout
recordHandLayout(count) {
      const key = "hand-layout:" + count;
      if (count >= 1 && count <= 4 && !this.diagnosticKeys.has(key)) {
        this.trace("hand-layout", { count });
        this.diagnosticKeys.add(key);
      }
    }
// @endfragment bgi-host.recordHandLayout

// @fragment bgi-host.refreshHandBeforeInput
async refreshHandBeforeInput(reason) {
      this.invalidateHand(reason);
      this.requireHandObservation(this.phase(), "before-cache-refresh-reset");
      await this.reset();
      const error = new Error(reason);
      error.code = "TCG_HAND_REFRESH";
      throw error;
    }
// @endfragment bgi-host.refreshHandBeforeInput

// @fragment bgi-host.removalEvidenceBeforeReset
async removalEvidenceBeforeReset(plan) {
      const r = this.consumptionReceipt,
        a = plan?.action,
        b = plan?.before;
      // Ordinary consumption only. Draw/recycle/talent and the final-card
      // empty-fan branch keep their existing independent native proofs.
      if (
        plan?.mode !== "remove" ||
        plan.hand.length === 0 ||
        a?.type !== "card" ||
        !r?.inputSent ||
        r.beforeKey !== TCG.boardKey(b) ||
        r.id !== a.id ||
        r.index !== a.index ||
        r.target !== (a.target ?? null) ||
        !this.handFanReady
      )
        return null;
      const revision = this.inputRevision;
      let stable = 0,
        last = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const sampledAt = Date.now();
        const p = this.frame((f) => {
          const phase = this.phaseIn(f);
          return {
            ...phase,
            count: phase.phase === "board" && phase.turn === "user" ? this.handCountIn(f) : null,
          };
        });
        if (p.phase !== "board" || p.turn !== "user" || this.inputRevision !== revision)
          return null;
        stable =
          p.count === plan.hand.length && p.count === last
            ? stable + 1
            : p.count === plan.hand.length
              ? 1
              : 0;
        last = p.count;
        const remaining = 120 - (Date.now() - sampledAt);
        if (attempt === 0 && remaining > 0) await sleep(remaining);
      }
      this.trace("hand-pre-reset-proof", {
        id: a.id,
        count: last,
        expected: plan.hand.length,
        stableReads: stable,
        additionalInputs: 0,
      });
      return stable >= 2
        ? { ...r, count: last, stableReads: stable, at: Date.now(), revision }
        : null;
    }
// @endfragment bgi-host.removalEvidenceBeforeReset

// @fragment tcg-ui.handCountIn
handCountIn(f) {
      this.lastCostSample = null;
      this.lastHandCountSource = null;
      const counts = [];
      for (let n = 5; n <= 10; n++)
        if (this.has(f, "num/Hand" + n, this.roi("handExpanded", [1463, 700, 439, 124]), 0.92)) counts.push(n);
      if (counts.length > 1) {
        const error = new Error("手牌数量模板相互冲突：" + JSON.stringify(counts));
        error.code = "TCG_HAND_RETRY";
        throw error;
      }
      if (counts.length === 1) {
        this.lastHandCountSource = "native-badge";
        return counts[0];
      }
      const n = number(this.ocr(f, this.roi("handExpanded", [1730, 700, 170, 124])));
      if (n !== null && n <= 10) {
        this.lastHandCountSource = "native-badge";
        return n;
      }
      if (!this.handFanReady) return null;
      const layout = this.handCostLayoutIn(f);
      if (layout) {
        // An unbound row still checks outer numeric evidence. No per-slot
        // digit recovery is needed just to establish quantity/positions.
        const y=Math.floor(Math.max(this.point("handExpanded",0,750)[1],Math.min(this.point("handExpanded",0,840)[1],Math.min(...layout.markers.map(m=>m.y))-40))),
          numbers=layout.measuredCount===null?costDigitRows(this.enlargedOcrRows(f,this.observedRoi("handExpanded", [470,y,1290,110]),3)):[],
          sample=costHandSample(layout,numbers);
        if(sample){
          this.lastHandCountSource = "full-cost-layout";
          this.lastCostSample = { ...sample, revision: this.inputRevision, at: Date.now() };
          return layout.count;
        }
      }
      // Grayscale rim gradient: usable-card gold glow must not change count.
      const rimCount = this.memoFrame(f, "hand/rim-count", () => handLayoutCount(
        this.matches(f, "hand_rim", this.roi("handExpanded", [500, 900, 1260, 135]), 0.85, false).map((r) => r.x),
      ));
      if (rimCount !== null) this.lastHandCountSource = "full-rim-layout";
      return rimCount;
    }
// @endfragment tcg-ui.handCountIn

// @fragment tcg-ui.handSample
handSample(f, priceIndex = null) {
      this.lastCostSample = null;
      const count = this.handCountIn(f);
      let cost = this.lastCostSample;
      // Quantity/positions need corners, not every digit. Only the impending
      // target gets a price proof on these same preselection frames.
      if (count > 0 && this.handFanReady) {
        const layout = this.handCostLayoutIn(f, count);
        if (layout) {
          cost = { ...costHandSample(layout, []), revision: this.inputRevision, at: Date.now() };
          if (priceIndex !== null && priceIndex < count)
            cost.costs[priceIndex] = this.handPriceIn(f, layout.markers[priceIndex]).cost;
        }
      }
      return { count, cost, source: this.lastHandCountSource };
    }
// @endfragment tcg-ui.handSample

// @fragment tcg-ui.observedHand
async observedHand(plan = null, scan = { titles: 0 }) {
      if (plan?.mode === "full") {
        const session = this.confirmationSession,
          observed = session?.handObservation;
        if (observed && observed.revision === this.inputRevision) {
          session.handObservation = null;
          const count = this.frame(f => {
            this.requireHandObservation(this.phaseIn(f), "before-pending-hand-reuse");
            return this.handCountIn(f);
          });
          if (count === null || count === observed.hand.length) {
            session.handObservation = observed;
            this.trace("hand-full-read-reused", { count: observed.hand.length, visibleCount: count,
              proof: "completed-native-read-in-same-pending-action", additionalInputs: 0 });
            return TCG.indexedHand(observed.hand);
          }
        }
        scan.retainedHand = plan.retainedHand;
        scan.retainedVariantFamilies = plan.retainedVariantFamilies;
        scan.settling = true;
        this.invalidateHand("generated-drawn-or-replaced-card");
        let hand = await this.readHand(plan.expectedCount ?? null, null, scan);
        if (plan.rejectedHand && !this.autoRisk)
          hand = TCG.reconcileHand(plan.rejectedHand, hand, true);
        if (session) session.handObservation = { hand: TCG.indexedHand(hand), revision: this.inputRevision };
        return hand;
      }
      if (plan?.mode === "remove") {
        const proof = plan.preResetEvidence,
          receipt = this.consumptionReceipt;
        const age = proof ? Date.now() - proof.at : Infinity;
        if (
          proof &&
          receipt?.inputSent &&
          plan.action?.type === "card" &&
          proof.beforeKey === TCG.boardKey(plan.before) &&
          proof.id === plan.action.id &&
          proof.index === plan.action.index &&
          proof.target === (plan.action.target ?? null) &&
          proof.beforeKey === receipt.beforeKey &&
          proof.id === receipt.id &&
          proof.index === receipt.index &&
          proof.target === receipt.target &&
          proof.count === plan.hand.length &&
          proof.stableReads >= 2 &&
          proof.revision === this.inputRevision &&
          age >= 0 &&
          age <= 5000 &&
          !this.handFanReady &&
          !this.handNeedsReset
        ) {
          const count = this.frame((f) => this.handCountIn(f));
          if (count === null || count === proof.count) {
            this.trace("hand-incremental", {
              mode: "remove",
              count: proof.count,
              proof: "two-native-counts-before-single-reset",
            });
            return TCG.indexedHand(plan.hand);
          }
          this.invalidateHand("unexpected-count-after-pre-reset-proof");
          return await this.readHand(null, null, scan);
        }
        if (plan.effectProven || plan.paidProven) {
          // The settled board proves consumption independently. A visible count
          // disagreement still forces a real scan; unreadable badge is not zero.
          const count = this.frame(f => this.handCountIn(f));
          if (count === null || count === plan.hand.length) {
            this.trace("hand-incremental", { mode:"remove", count:plan.hand.length,
              proof:plan.paidProven?"confirmed-paid-card-two-stable-boards":"independent-native-effect", visibleCount:count });
            return TCG.indexedHand(plan.hand);
          }
          this.emptyHandProven = false;
          this.invalidateHand("unexpected-post-effect-count");
          return await this.readHand(null, null, scan);
        }
        // Publishing the projected list requires native count evidence first.
        // The independent resource/HP/energy effect is still checked by confirm.
        if (plan.hand.length === 0 && this.emptyHandProven) {
          this.trace("hand-incremental", { mode:"remove", count:0, proof:"independent-empty-hand-effect" });
          return TCG.indexedHand(plan.hand);
        }
        const n = await this.handCount(plan.hand.length);
        if (n === plan.hand.length) {
          this.requireHandObservation(this.phase(), "before-incremental-reset");
          await this.reset();
          this.trace("hand-incremental", { mode:"remove", count:n, proof:"native-count" });
          return TCG.indexedHand(plan.hand);
        }
        this.invalidateHand("unexpected-post-action-count");
        return await this.readHand(null,{count:n},scan);
      }
      const cached = plan?.mode === "unchanged" ? plan.hand : this.handCache;
      if (cached !== null && cached !== undefined) {
        // Read-only anomaly detector, not a proof that a missing badge is zero.
        // All real card/tune inputs check visible anomalies and exact target title.
        const count = this.frame(f => this.handCountIn(f));
        if (count === null || count === cached.length) {
          this.trace("hand-cache-reused", { count:cached.length, mode:plan?.mode || "cached", visibleCount:count });
          return TCG.indexedHand(cached);
        }
        this.invalidateHand("unexpected-visible-count");
      }
      return await this.readHand(null, null, scan);
    }
// @endfragment tcg-ui.observedHand

// @fragment tcg-ui.prepareHandInput
async prepareHandInput(expected, priceIndex = null, requireReusableCount = false, deferToTitle = false) {
      this.requireHandObservation(this.phase(), "before-target-expand");
      // execute already normalized and verified the board; do not blank-click
      // a second time simply to raise the fan.
      await this.expand(false);
      // Known order/count comes from this session's confirmed hand. Look for
      // visible anomalies without the redundant 1–4-card boundary/title loop.
      const revision = this.inputRevision, samples = [], sampledTimes = [];
      const validCount = s => s.count === expected && Number.isInteger(s.count) &&
        ["native-badge", "full-cost-layout", "full-rim-layout"].includes(s.source);
      const requireRevision = () => {
        if (this.inputRevision === revision) return;
        this.handPositionProof = null;
        const error = new Error("执行前手牌采样期间输入已变化");
        error.code = "TCG_STATE_REFRESH";
        throw error;
      };
      let sampledAt;
      const sample = (recovery = false) => {
        sampledAt = Date.now();
        sampledTimes.push(sampledAt);
        return this.frame(f => {
          if (recovery) this.requireHandObservation(this.phaseIn(f), "target-count-recovery");
          return this.handSample(f, priceIndex);
        });
      };
      try {
        samples.push(sample());
        const remaining = 120 - (Date.now() - sampledAt);
        if (remaining > 0) await sleep(remaining);
        requireRevision();
        samples.push(sample());
        // Only a read-only inspection requests reusable count authority. A
        // first-frame miss may recover once; positive conflicts and unknown
        // sources never authorize another attempt or a fabricated stable pair.
        if (requireReusableCount === true && samples[0].count === null && validCount(samples[1])) {
          const remaining = 120 - (Date.now() - sampledAt);
          if (remaining > 0) await sleep(remaining);
          requireRevision();
          samples.push(sample(true));
        }
      } catch (e) {
        if (e.code !== "TCG_HAND_RETRY") throw e;
        await this.refreshHandBeforeInput("执行前手牌数量证据冲突");
      }
      const reads = samples.map((s) => s.count), sources = samples.map((s) => s.source);
      // Ordinary input immediately enters inspectHandCard, whose titleAt
      // takes a fresh phase before the title click. Keep that later guard,
      // rather than capturing two adjacent phase-only frames with no input
      // between them. Price-only probes/standalone callers keep this guard.
      if (deferToTitle !== true) this.requireHandObservation(this.phase(), "before-target-title");
      requireRevision();
      this.trace("hand-input-check", {
        expected, reads, sources, boundaryProbe: false,
      });
      if (reads.some((n) => n !== null && n !== expected)) {
        await this.refreshHandBeforeInput("执行前手牌张数已变化");
      }
      this.publishHandPositions(samples, expected);
      // Reuse the existing read-only count frames; no extra hand expansion.
      const stableSamples = samples.slice(-2);
      if (stableSamples.every(validCount)) this.recordHandLayout(expected);
      // Layout sources already validate every slot, expected spacing and extra
      // edges/markers. A single raw hit or two unreadable samples is NOT proof.
      // The transient badge can replace a complete calibrated row between
      // frames. Stable quantity needs two native counts, not identical readers.
      return stableSamples.every(validCount) && sampledTimes.slice(-2).every(at =>
        Date.now() - at >= 0 && Date.now() - at <= 5000)
        ? { count: expected, stableReads: 2, source: stableSamples[0].source, reads, sources } : null;
    }
// @endfragment tcg-ui.prepareHandInput

// @fragment tcg-ui.readHandTitles
async readHandTitles(cards, points, scan = { titles: 0 }) {
      for (let i = 0; i < cards.length; i++) if (!cards[i]) {
        scan.titles++;
        const raw = await this.titleAt(points[i], 945, false, false, "card", null, true);
        const card = TCG.observedCard(raw, i);
        if (!card || scan.titleCandidates?.[i] && !scan.titleCandidates[i].includes(card.id)) {
          const error = new Error("第 " + (i + 1) + " 张手牌卡名无法可靠读取：" + (raw || "OCR为空"));
          error.code = "TCG_HAND_RETRY";
          throw error;
        }
        cards[i] = card;
      }
    }
// @endfragment tcg-ui.readHandTitles

// @fragment tcg-ui.readHand
async readHand(expected = this.handCountHint, evidence = null, scan = { titles: 0 }) {
      // Evidence passed here was obtained in this very observation, not an
      // estimated count or the previous action's projected hand.
      const n = evidence ? evidence.count : await this.handCount(expected);
      // This scratch list belongs to one observe() call: no submitted action,
      // phase transition or next round can inherit it. A changed native count
      // replaces it; a failed title alone does not erase successful slots.
      if (scan.cards && scan.cards.length !== n) scan.titleCandidates = null;
      const hand = scan.cards?.length === n ? scan.cards : Array(n).fill(null);
      scan.cards = hand;
      // Establish the expanded fan once. Selecting a card only raises that
      // card; it does not require resetting/re-expanding the whole hand.
      if (n > 0 && !this.handFanReady) {
        this.requireHandObservation(this.phase(), "before-scan-expand");
        await this.expand();
      }
      this.handScanSerial++;
      // Copy all positions before the first title click invalidates the proof.
      // Selection raises one card but does not reorder the rest of this fan.
      const points = this.handPoints(n);
      await this.prepareHandObservation?.(n);
      this.trace("hand-scan", { count: n, expected, reusedCount: !!evidence });
      await this.fillHandArtwork?.(hand, scan);
      await this.readHandTitles(hand, points, scan);
      const observed = this.finishHandObservation ? this.finishHandObservation(hand, scan) : hand;
      this.requireHandObservation(this.phase(), "before-hand-reset");
      await this.reset();
      this.handCountHint = null;
      return observed;
    }
// @endfragment tcg-ui.readHand

// @fragment tcg-ui.requireHandObservation
requireHandObservation(phase = this.phase(), stage = "hand") {
      // Details may legitimately hide the turn icon (unknown). Only positive
      // phase evidence interrupts observation; unreadable titles on a stable
      // board remain genuine errors, never converted into a fabricated win.
      if (
        phase.result ||
        ["pick", "roll", "settlement", "transition", "choice", "automatic"].includes(phase.phase) ||
        phase.turn === "enemy"
      ) {
        this.handFanReady = false;
        const error = new Error("读牌期间页面变化：" + phase.phase + "/" + phase.turn);
        error.code = "TCG_OBSERVATION_INTERRUPTED";
        error.phase = { ...phase, hand: null };
        this.trace("hand-phase-interrupted", { stage, ...phase });
        throw error;
      }
    }
// @endfragment tcg-ui.requireHandObservation

// @fragment tcg-ui.reset
async reset() {
      if (this.boardReady && !this.handNeedsReset && !this.handFanReady) {
        this.trace("hand-reset-skipped", { reason: "already-clean-board" });
        return;
      }
      this.handFanReady = false;
      this.clickAt(...this.point("board",1190,545));
      this.moveTo(...this.point("board",1555,545));
      await sleep(300);
      this.handNeedsReset = false;
      this.boardReady = true;
      this.trace("hand-reset", {});
    }
// @endfragment tcg-ui.reset

// @fragment bgi-host.titleIn
titleIn(f, roi, kind = "card", names = null) {
      const native = this.ocr(f, this.roi("details", roi));
      const identify = text => names ? names.some(name => TCG.norm(name) === TCG.norm(text)) :
        kind === "character" ? TCG.characterName(text) >= 0 : !!TCG.identify(text);
      const card = kind === "card" ? TCG.identify(native) : null;
      if (card && TCG.norm(native) !== TCG.norm(card.name)) {
        this.trace("title-exact-alias", { native, canonical:card.name, id:card.id, additionalInputs:0 });
        return card.name;
      }
      if (identify(native) || !native) return native;
      const enlarged = this.numericAt(f, this.roi("details", roi), 3);
      if (identify(enlarged)) {
        this.trace("title-pixel-recovery", { roi, kind, native, enlarged, scale:3, additionalInputs:0 });
        return enlarged;
      }
      const key = "unknown-title:" + TCG.norm(native);
      if (kind !== "character" && !this.diagnosticKeys.has(key)) {
        this.diagnosticKeys.add(key);
        this.trace("unresolved-title", { kind, roi, native, enlarged });
      }
      return native;
    }
// @endfragment bgi-host.titleIn

// @fragment bgi-host.inspectHandCard
async inspectHandCard(action, x) {
      const raw = await this.titleAt(x, 945, false, false, "card", action.id, true);
      if (!raw) {
        // No title is not a conflicting identity. No action was submitted;
        // restore the view and retry this slot through the state owner.
        this.requireHandObservation(this.phase(), "missing-input-title");
        await this.reset();
        const error = new Error("目标手牌标题暂未读到，保留身份后重试目标槽");
        error.code = "TCG_STATE_REFRESH";
        throw error;
      }
      if (TCG.observedCard(raw, action.index)?.id !== action.id)
        await this.refreshHandBeforeInput("目标手牌卡名校验失败，重新核对手牌");
    }
// @endfragment bgi-host.inspectHandCard

// @fragment bgi-host.takePreparedHandInput
takePreparedHandInput(action, before) {
      const prepared = this.preparedHandInput;
      this.preparedHandInput = null;
      const inspecting = action.type === "probe" && action.scope === "card";
      const sameSlot = !!prepared && prepared.id === action.id && prepared.index === action.index;
      const target = before.hand.find(h => h.index === action.index);
      const age = prepared ? Date.now() - prepared.at : Infinity;
      if (!prepared || !(inspecting || action.type === "card" || action.type === "tune") ||
          !inspecting && (!Number.isInteger(action.index) || action.index < 0 || action.index >= before.hand.length ||
            target?.id !== action.id || !TCG.handCardKnown(target)) ||
          prepared.revision !== this.inputRevision || !Number.isFinite(age) || age < 0 || age > 5000 ||
          prepared.beforeKey !== TCG.boardKey(before)) return null;
      const count = this.frame(f => {
        this.requireHandObservation(this.phaseIn(f), "after-card-inspection");
        return this.nativeHandCountIn(f);
      });
      if (count !== null && count !== before.hand.length) return null;
      // A new direct target may keep the fan only with a definite current
      // native count. Missing count falls back to the full board/input path.
      if (!sameSlot && !inspecting && count !== before.hand.length) return null;
      const viewOnly = inspecting || !sameSlot;
      this.trace("hand-input-inspection-reused", { id:action.id, index:action.index,
        viewOnly, additionalInputs:0 });
      // View authority carries no selected position, identity, price or count
      // proof from the inspected slot. The next target establishes its own.
      return viewOnly ? { viewOnly:true } : prepared;
    }
// @endfragment bgi-host.takePreparedHandInput

// @fragment tcg-ui.titleAt
async titleAt(
      x,
      y,
      opening = false,
      hover = false,
      kind = "card",
      expected = null,
      watchPhase = false,
    ) {
      if (watchPhase) this.requireHandObservation(this.phase(), "before-title-input");
      // Opening/character arguments are reference points. Hand x is already
      // measured in F; only its reference row y needs the hand-panel transform.
      if (opening || kind === "character") [x,y]=this.point(opening?"opening":"board",x,y);
      else y=this.point("handExpanded",0,y)[1];
      if (!opening && kind === "card") this.selectedCostProof = this.handPositionProof;
      if (hover) this.moveTo(x, y);
      else this.clickAt(x, y);
      // Official DSTCG getHandMsg clicks consecutive titles on one raised fan.
      // A hand-card click is not evidence of collapse. An empty/unstable title
      // leaves layout unknown and is normalized before any further toggle.
      if (!hover && !opening) this.handNeedsReset = true;
      if (!hover && (opening || kind === "character")) this.handFanReady = false;
      // Known input targets can be sampled early: an old neighbouring title
      // cannot pass the expected identity. Blind title discovery keeps its delay.
      await sleep(expected === null ? 350 : 120);
      const roi = opening ? [58, 112, 339, 53] : [311, 115, 341, 50];
      const reads = [];
      let previousKey = "",
        lastStable = "";
      const attempts = expected === null ? 6 : 10;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const sampledAt = Date.now();
        const raw = this.frame((f) => {
          if (watchPhase) this.requireHandObservation(this.phaseIn(f), "title-sampling");
          const title = this.titleIn(f, roi, kind);
          // Use the already captured stable title frame for optional deck facts.
          // Normal decks have no facts reader and perform no additional OCR.
          if (!opening && kind === "card" && previousKey === "title:" + TCG.norm(title)) {
            const card = TCG.identify(title);
            if (card) this.readSelectedCardFacts?.(f, card, x);
          }
          return title;
        });
        reads.push(raw);
        const who = kind === "character" ? TCG.characterName(raw) : -1;
        const key = raw ? (who >= 0 ? "character:" + who : "title:" + TCG.norm(raw)) : "";
        const stable = !!key && key === previousKey;
        lastStable = stable ? raw : "";
        const matchesExpected = expected === null || (kind === "character"
          ? who === expected : TCG.observedCard(raw, 0)?.id === expected);
        if (stable && matchesExpected) {
          this.trace("title-read", {
            point: [x, y],
            roi,
            kind,
            expected,
            reads,
            stable: true,
            matchesExpected: true,
          });
          return raw;
        }
        previousKey = key;
        const remaining = (expected === null ? 150 : 120) - (Date.now() - sampledAt);
        if (attempt < attempts - 1 && remaining > 0) await sleep(remaining);
      }
      this.trace("title-read", {
        point: [x, y],
        roi,
        kind,
        expected,
        reads,
        stable: !!lastStable,
        matchesExpected: false,
      });
      if (!hover && !opening) this.handFanReady = false;
      // A stable wrong character remains wrong; preserve its raw title for the error.
      return kind === "character" || expected !== null ? lastStable : "";
    }
// @endfragment tcg-ui.titleAt
// @fragment bgi-host.inputHand
async inputHand(action,before,memory,prepared=null) {
      const current = before.hand;
      const h = current.find(c => c.index === action.index);
      if (!h || h.id !== action.id) throw new Error("执行前重新核对卡名失败");
      const selected = prepared && !prepared.viewOnly;
      if (prepared?.viewOnly && !this.handFanReady) await this.requireUnchangedBoard(before);
      const priceIndex = action.type==="card"&&this.checkCardInput?action.index:null;
      // Non-selected inputs always enter inspectHandCard below. Its fresh
      // pre-click phase owns the boundary; quantity reads stay independent.
      let sourceCount=selected?prepared.sourceCount:await this.prepareHandInput(before.hand.length,priceIndex,false,true);
      if (prepared?.viewOnly && !sourceCount) {
        // No title/drag has been sent for this target. Unknown new quantity
        // cannot authorize bypassing the ordinary complete-board preflight.
        await this.requireUnchangedBoard(before);
        sourceCount=await this.prepareHandInput(before.hand.length,priceIndex,false,true);
      }
      const x = selected?prepared.x:this.handPoints(current.length)[action.index];
      if (!selected) await this.inspectHandCard(action, x);
      await this.checkCardInput?.(action,before,x,memory);
      const phase = this.phase();
      if (phase.turn !== "user") {
        const error = new Error("拖牌前回合已改变"), actual = this.captureGeometry?.actualSize;
        if (actual?.width === 2560 && [1440,1600].includes(actual.height)) {
          error.code = "TCG_OBSERVATION_INTERRUPTED"; error.phase = { ...phase, hand: null };
          this.boardReady = false; this.preparedHandInput = null; this.autoRisk = true;
          this.trace("hand-input-interrupted", { action, stage: "before-drag", phase: phase.phase,
            turn: phase.turn, inputSubmitted: false });
        }
        throw error;
      }
      const targeted = action.type === "card" && action.target !== null;
      const drawCost = action.type === "card" ? TCG.drawPayment(before,action,memory) : null;
      this.consumptionReceipt={id:action.id,index:action.index,target:action.target??null,
        beforeKey:TCG.boardKey(before),inputSent:false,
        ...(drawCost?{sourceInstanceIds:h.instanceIds?.slice()||[],cost:drawCost}:{}),
        ...(sourceCount?{sourceCountProof:sourceCount}:{})};
      const destination=action.type==="tune"?this.point("phase",1867,518):
        targeted?this.point("board",charX[action.target],720):[x,this.point("board",0,595)[1]];
      await this.drag(x, this.point("handExpanded",0,945)[1], ...destination);
      this.consumptionReceipt.inputSent=true;
      if (action.type === "tune") await this.confirmTune();
      else await this.cardConfirm(action,before);
    }
// @endfragment bgi-host.inputHand

