// Shared Mystique Soup native labels, one selection and action-bound exit receipt.
    choiceIn(f) {
      const header = TCG.norm(this.ocr(f, this.roi("header", [700, 155, 520, 130])));
      if (!header.includes("挑选卡牌") || !header.includes("请选择一张卡牌")) return null;
      // Native supplied 1920x1080 screenshot: names below the two cards at
      // y=742, cards centred at y=540. Anchor to exact OCR title rectangles,
      // not a fixed left/right preference or a guessed generic choice page.
      const rows = this.ocrRows(f, this.roi("choice", [250, 705, 1430, 90])),
        options = [];
      for (const r of rows) {
        const entry = Object.entries(TCG.soupOptions).find(
          ([name]) => TCG.norm(name) === TCG.norm(r.text),
        );
        if (!entry) continue;
        const point = [r.x + r.w / 2, r.y + r.h / 2 - 200];
        const reference = this.referencePoint("choice", ...point);
        if (
          ![r.x, r.y, r.w, r.h, ...point].every(Number.isFinite) ||
          r.w <= 0 ||
          r.h <= 0 ||
          reference[0] < 250 ||
          reference[0] > 1680 ||
          reference[1] < 470 ||
          reference[1] > 600
        )
          continue;
        options.push({
          id: entry[0],
          effect: entry[1],
          point: mousePoint(...point),
          title: r.text,
        });
      }
      return {
        phase: "choice",
        turn: "none",
        choiceKind: "soup",
        options,
        recognized: options.length === 3 && new Set(options.map((c) => c.id)).size === 3,
      };
    }
    async resolveChoice(before = null, memory = TCG.freshMemory()) {
      const owner = this.confirmationSession, action = owner?.plan?.action;
      let stable = 0,
        key = "",
        last = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        const sampledAt = Date.now(), revision = this.inputRevision;
        last = this.phase();
        if (last.phase !== "choice") {
          if (
            !this.choiceSession ||
            !["board", "pick", "roll", "settlement", "result"].includes(last.phase) ||
            (last.phase === "board" && !["user", "enemy"].includes(last.turn))
          ) {
            stable = 0;
            key = "";
          } else {
            const current = JSON.stringify([last.phase, last.turn, last.result]);
            stable = current === key ? stable + 1 : 1;
            key = current;
            if (stable >= 2) {
              const session = this.choiceSession;
              this.choiceSession = null;
              // Soup applies an effect immediately; it generates NO hand card.
              this.soupReceipt = { origin: session.origin, target: session.target,
                effect: session.effect, exited: true };
              this.pendingChoiceCard = null;
              this.handFanReady = false;
              this.handNeedsReset = true;
              this.emptyHandProven = false;
              this.boardReady = false;
              this.trace("choice-resolved", {
                id: session.id,
                confirmationInputs: session.confirmed ? 1 : 0,
                phase: last.phase,
                turn: last.turn,
              });
              return last;
            }
          }
        } else if (!this.choiceSession) {
          if (last.choiceKind !== "soup" || !last.recognized || action?.id !== "soup" || action.type !== "card") {
            stable = 0;
            key = "";
          } else {
            const basis = owner.plan.before;
            const paid =
              basis &&
              TCG.payment(
                basis.dice,
                TCG.cardCost("soup", action.target, memory, basis),
                TCG.team[basis.active].element,
              );
            const choiceState = paid ? { ...basis, dice: paid.remaining } : basis;
            const target = TCG.soupChoice(
                last.options,
                choiceState,
                action.target,
                memory,
              ),
              id = target?.id;
            if (target) {
              this.choiceSession = {
                origin: owner.key, target: action.target,
                id,
                effect: target.effect,
                confirmed: false,
              };
              this.clickAt(...target.point);
              this.trace("choice-selected", {
                id,
                point: target.point,
                proof: "native-card-labels-and-choice-header",
              });
              stable = 0;
              key = "";
              await sleep(120);
            }
          }
        } else if (!this.choiceSession.confirmed) {
          // The supplied screenshot has no confirm button before selection.
          // The session owns the selected option. A unique confirm template
          // authorizes one click without rereading its title.
          const preview = this.frame((f) => ({
            phase: this.phaseIn(f),
            buttons: this.matches(f, "core/确定", this.roi("choice", [500, 800, 920, 240])),
          }));
          if (["choice", "unknown"].includes(preview.phase.phase) && preview.phase.turn === "none" && preview.buttons.length === 1) {
            const b = preview.buttons[0];
            this.choiceSession.confirmed = true;
            const point = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
            this.trace("choice-confirm-clicked", { id: this.choiceSession.id, point });
            stable = 0;
            key = "";
            await sleep(120);
          }
        }
        if (attempt < 23) await this.waitForSample(sampledAt, 250, revision);
      }
      const error = new Error("挑选卡牌状态未读清");
      error.code = "TCG_CHOICE_RETRY";
      error.phase = last;
      throw error;
    }
