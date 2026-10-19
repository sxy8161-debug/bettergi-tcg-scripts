// Equipment / recycle / talent confirmation shared by compatible adapters.
    cardBannerIn(f) {
      // A short crop cut the real recycle prompt after 「角」. All card
      // confirmation stages must read the same complete banner, not accept
      // a truncated prefix or infer scope from the central payment button.
      return this.ocr(f, this.roi("phase", [560, 508, 790, 70]));
    }
    namedCardBannerMatches(action, banner) {
      const text = TCG.norm(banner),
        prefix = "打出手牌";
      if (!text.startsWith(prefix)) return false;
      const card = TCG.identify(text.slice(prefix.length));
      return !!card && card.id === action.id;
    }
    async cardConfirm(action, before = null) {
      await this.requireNoWarning();
      const type = TCG.byId[action.id].type;
      const weaponKind = ["moon", "tassel"].includes(action.id)
        ? "pole"
        : ["wolf", "greatsword"].includes(action.id)
          ? "claymore"
          : null;
      const weaponLabel = { pole: "长柄武器", claymore: "双手剑" }[weaponKind];
      const targetedBanners = {
        food: ["请选择一个角色食用料理"],
        legend: ["请选择一个角色", "对所选角色生效"],
        recycle: [
          "请选择一个角色",
          "请选择要卸下圣遗物的角色",
          "请选择一个角色卸下圣遗物",
          "请选择一个装备了圣遗物的角色",
          "对所选角色生效",
        ],
        artifact: [
          "请选择要装备圣遗物的角色",
          "请选择一个角色装备圣遗物",
          "请选择一个角色",
          "对所选角色生效",
        ],
        weapon: [
          "请选择要装备武器的角色",
          "请选择一个角色装备武器",
          "请选择一个角色",
          "对所选角色生效",
          "请选择要装备" + weaponLabel + "的角色",
          "请选择一个角色装备" + weaponLabel,
        ],
      };
      const entrySampledAt = Date.now(), entryRevision = this.inputRevision;
      const foodPage = this.frame((f) => this.cardConfirmationEntryIn(f, targetedBanners[type] || []));
      this.trace("card-page", { id: action.id, target: action.target, type, ...foodPage });
      if (
        type === "weapon" &&
        (!weaponKind ||
          TCG.team[action.target]?.weapon !== weaponKind ||
          !before ||
          !TCG.alive(before.characters?.[action.target]))
      )
        throw new Error("装备确认目标与武器类型不适配");
      if (
        targetedBanners[type]?.includes(TCG.norm(foodPage.banner)) &&
        foodPage.phase.phase === "unknown" &&
        foodPage.phase.turn === "none"
      ) {
        if (
          !Number.isInteger(action.target) ||
          action.target < 0 ||
          action.target > 2 ||
          !before ||
          !TCG.alive(before.characters?.[action.target])
        )
          throw new Error("卡牌目标不合法或已经倒下");
        const layout = type === "food" ? "food" : "targeted";
        const point = this.clickAt(...this.point("board",charX[action.target],720));
        this.trace("card-target-clicked", {
          id: action.id,
          target: action.target,
          point,
          layout,
          banner: foodPage.banner,
        });
        await sleep(120);
        for (let attempt = 0; attempt < 6; attempt++) {
          const sampledAt = Date.now();
          const selected = this.frame((f) => this.cardTargetPreviewIn(f));
          await this.requireNoWarning(selected.warning);
          // A direct native resolution is verified by confirm(), not assumed
          // successful here. Never send a second selection or a skill input.
          if (
            selected.phase.result ||
            (selected.phase.phase === "board" && selected.phase.turn === "user") ||
            (action.id === "soup" && selected.phase.phase === "choice" &&
              selected.phase.choiceKind === "soup" && selected.phase.recognized)
          ) {
            this.trace("card-target-resolved", {
              id: action.id,
              target: action.target,
              proof: "native-page-exit-only",
            });
            return;
          }
          const play = selected.rows.filter((r) => TCG.norm(r.text) === "打出手牌" ||
            type === "food" && TCG.norm(r.text) === "确定");
          const controls = selected.buttons.length ? selected.buttons : play;
          const otherTarget = Object.values(targetedBanners).some(labels => labels.includes(selected.banner)) &&
            !targetedBanners[type].includes(selected.banner);
          const matched =
            !otherTarget &&
            controls.length === 1 &&
            selected.phase.phase === "unknown" &&
            selected.phase.turn === "none";
          this.trace("card-target-preview", {
            id: action.id,
            target: action.target,
            attempt,
            matched,
            ...selected,
          });
          if (matched) {
            const b = controls[0];
            const confirmPoint = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
            this.trace("card-confirm-clicked", {
              id: action.id,
              target: action.target,
              point: confirmPoint,
              layout,
            });
            
            return;
          }
          if (attempt < 5) await this.waitForSample(sampledAt, 250);
        }
        this.trace("targeted-card-unresolved", {id:action.id,target:action.target,reason:"目标卡牌选人后确认页未核实"});
        throw new Error("目标卡牌选人后确认页未核实");
      }
      // Native 星天之兆 opens a payment page with a CENTER button. Its detail
      // panel is gone and the right skill buttons are not the confirmation.
      const centralScopeMatches = (banner) => {
        const card = TCG.byId[action.id];
        const activeScope =
          ["stars", "voltage", "calx", "lost"].includes(action.id) &&
          banner === "对我方出战角色生效";
        const namedEvent =
          [
            "dice",
            "draw",
            "switch",
            "energy",
            "support",
            "reroll",
            "recovery",
            "event",
            "legend",
            "food",
            "recycle",
          ].includes(card.type) && this.namedCardBannerMatches(action, banner);
        const teamEvent =
          (action.id === "sing" && ["对我方所有角色生效", "对所有我方角色生效"].includes(banner)) ||
          (["garden", "boar"].includes(action.id) &&
            ["对我方生效", "对我方全体生效"].includes(banner));
        const talentWho = this.talentTargets?.[action.id] ?? (action.id === "skivingNewAndImproved" ? 2 : null);
        const activeTalent =
          talentWho !== null &&
          action.target === talentWho &&
          before?.active === talentWho &&
          TCG.alive(before.characters?.[talentWho]) &&
          !before.characters[talentWho].frozen &&
          banner === "装备给出战中的" + TCG.norm(TCG.team[talentWho].name);
        return (action.target === null && (activeScope || namedEvent || teamEvent)) ||
          activeTalent || (action.id === "lyre" && namedEvent);
      };
      const entryReused = this.inputRevision === entryRevision && foodPage.targets?.length === 1 &&
        foodPage.phase.phase === "unknown" && foodPage.phase.turn === "none" &&
        centralScopeMatches(TCG.norm(foodPage.banner));
      const central = entryReused ? foodPage : this.frame((f) => {
        // Find() returns only the first OCR row, which can be the O hint.
        // Read complete control rows once; scope authorizes one payment click.
        const targets = this.cardPaymentControlsIn(f);
        return { banner: this.cardBannerIn(f), targets, phase: this.phaseIn(f) };
      });
      if (entryReused) this.trace("card-payment-entry-reused", { id: action.id, banner: central.banner, entrySampledAt });
      if (central.targets.length) {
        const banner = TCG.norm(central.banner);
        if (
          central.targets.length !== 1 ||
          !centralScopeMatches(banner) ||
          central.phase.phase !== "unknown" ||
          central.phase.turn !== "none"
        ) {
          throw new Error("中央出牌确认页的卡牌类型/作用范围未核实");
        }
        const b = central.targets[0];
        // A talent is already selected on its active wearer. Confirm the
        // observed payment button once; the card itself invokes the skill.
        // Never add a target click or a separate skill cast here.
        const point = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
        this.trace("card-confirm-clicked", {
          id: action.id,
          point,
          layout: "central",
          banner: central.banner,
        });
        
        return;
      }
      if (
        action.target !== null &&
        ["food", "artifact", "weapon", "talent", "legend", "recycle"].includes(type)
      ) {
        // Only click a target while the selected card is still displayed in its detail panel.
        const title = this.frame((f) => this.ocr(f, this.roi("details", [311, 115, 341, 50])));
        // A drag directly onto the intended character may already resolve the card.
        // In that case, issue no more input; the state verifier must prove acceptance.
        if (!title) return;
        if (TCG.identify(title)?.id !== action.id) throw new Error("出牌后的选目标页面未确认");
        this.clickAt(...this.point("board",charX[action.target],720));
        await sleep(120);
      }
      // Zero-cost untargeted events can resolve immediately. Never click a skill button
      // as a fallback confirmation for those events.
      const text = this.frame((f) => this.ocr(f, this.roi("bottom", [1550, 850, 360, 190])));
      if (/确认|使用|打出/.test(text) && !/无法|不足|不能/.test(text)) {
        const targets = this.frame(f => this.ocrRows(f, this.roi("bottom", [1550, 850, 360, 190]))
          .filter(r => /^(确认|使用|打出)(卡牌)?$/.test(r.text.replace(/\s/g, ""))));
        if (targets.length !== 1) throw new Error("无法唯一识别出牌确认按钮");
        const b = targets[0];
        const point = this.clickAt(b.x + b.w / 2, b.y + b.h / 2);
        this.trace("card-confirm-clicked", { id: action.id, point });
        
      }
    }

