// Shared capture fragments. Inlined at build time; no runtime dependency.

// @fragment bgi-host.findOcr
findOcr(f, roi, multiple, contextKey) {
      const key = "ocr/" + contextKey;
      if (!this.roCache.has(key)) this.roCache.set(key, RecognitionObject.Ocr(...roi));
      const started = Date.now();
      this.metrics.ocrCalls++;
      try {
        if (!multiple) {
          const r = f.Find(this.roCache.get(key));
          return r.isExist() ? String(r.text ?? r.Text ?? "").trim() : "";
        }
        const found = f.FindMulti(this.roCache.get(key)), rows = [];
        for (let i = 0; i < found.count; i++) {
          const r = found[i];
          rows.push({ text: String(r.text ?? r.Text ?? "").trim(), x: Number(r.x ?? r.X),
            y: Number(r.y ?? r.Y), w: Number(r.width ?? r.Width), h: Number(r.height ?? r.Height) });
        }
        return rows;
      } finally { this.metrics.ocrMs += Date.now() - started; }
    }
// @endfragment bgi-host.findOcr

// @fragment bgi-host.localOcr
localOcr(f, area, zoom, multiple) {
      const roi = this.checkedRoi(f, area);
      if (!Number.isFinite(zoom) || zoom <= 0) throw captureGeometryError("局部OCR倍率无效");
      const key = JSON.stringify(["localOcr", area, roi, zoom, multiple]);
      return this.memoFrame(f, key, () => {
        let crop = null, resized = null, region = null;
        const width = Math.round(roi[2] * zoom / area.scale), height = Math.round(roi[3] * zoom / area.scale);
        if (width <= 0 || height <= 0) throw captureGeometryError("局部OCR尺寸无效");
        try {
          crop = f.DeriveCrop(...roi);
          resized = crop.SrcMat.Resize(new OpenCvSharp.OpenCvSharp.Size(width, height));
          region = new ImageRegion(resized, 0, 0);
          const read = this.findOcr(region, [0, 0, width, height], multiple, key);
          if (!multiple) return read;
          // Round-trip through actual integer crop/output sizes, not a nominal
          // scale. Returned rectangles are already F; callers must not map again.
          const sx = roi[2] / width, sy = roi[3] / height;
          return read.map(r => ({ text: r.text, x: roi[0] + r.x * sx, y: roi[1] + r.y * sy,
            w: r.w * sx, h: r.h * sy }));
        } finally {
          if (region) region.dispose();
          else if (resized) resized.dispose();
          if (crop) crop.dispose();
        }
      });
    }
// @endfragment bgi-host.localOcr

// @fragment bgi-host.artworkScore
artworkScore(f, area, filename, pad, rank) {
      const required=this.checkedRoi(f,area),size=captureSize(f);
      if(!Number.isFinite(pad)||pad<0)throw captureGeometryError("牌面搜索边距无效");
      const key=JSON.stringify(["artwork",area,filename,pad]);
      return this.memoFrame(f,key,()=>{
        if(!this.templates.has(filename)){
          const mat=this.readTemplateImage(filename);
          if(mat.empty()){mat.dispose();throw new Error("缺少牌面模板："+filename);}
          this.templates.set(filename,mat);
        }
        const margin=pad*area.scale,[x,y,w,h]=required,
          left=Math.max(0,Math.floor(x-margin)),top=Math.max(0,Math.floor(y-margin)),
          right=Math.min(size.width,Math.ceil(x+w+margin)),bottom=Math.min(size.height,Math.ceil(y+h+margin));
        let crop=null,normalized=null;
        try {
          crop=(f.srcMat??f.SrcMat).SubMat(top,bottom,left,right);
          if(area.scale!==1)normalized=crop.Resize(new OpenCvSharp.OpenCvSharp.Size(
            Math.round((right-left)/area.scale),Math.round((bottom-top)/area.scale)));
          return rank(normalized||crop,this.templates.get(filename));
        } finally { if(normalized)normalized.dispose();if(crop)crop.dispose(); }
      });
    }
// @endfragment bgi-host.artworkScore

// @fragment bgi-host.dispose
dispose() {
      const gray = new Set();
      for (const ro of this.roCache.values()) {
        const mat = ro.templateImageGreyMat ?? ro.TemplateImageGreyMat;
        if (mat && !gray.has(mat)) {
          gray.add(mat);
          mat.dispose();
        }
      }
      for (const mat of this.templates.values()) mat.dispose();
      this.templates.clear();
      this.roCache.clear();
    }
// @endfragment bgi-host.dispose

// @fragment bgi-host.enlargedOcrRows
enlargedOcrRows(f, area, scale) {
      return this.localOcr(f, area, scale, true);
    }
// @endfragment bgi-host.enlargedOcrRows

// @fragment bgi-host.frame
frame(fn) {
      this.requireMatchTime();
      const started = Date.now(),
        previousMemo = this.frameMemo;
      const f = captureGameRegion();
      const captured = Date.now();
      this.metrics.frames++;
      this.metrics.captureMs += captured - started;
      this.frameMemo = new WeakMap();
      try {
        this.adoptCapture(f);
        this.requireMatchTime();
        const result = fn(f);
        this.requireMatchTime();
        return result;
      } finally {
        this.metrics.frameWorkMs += Date.now() - captured;
        this.frameMemo = previousMemo;
        f.dispose();
      }
    }
// @endfragment bgi-host.frame

// @fragment bgi-host.adoptCapture
adoptCapture(f) {
      if (this.captureGeometryError) throw this.captureGeometryError;
      try {
        const geometry = captureGeometry(f, Number(genshin.scaleTo1080PRatio));
        if (this.captureGeometry && JSON.stringify(geometry) !== JSON.stringify(this.captureGeometry))
          throw captureGeometryError("本局客户区或归一帧尺寸已变化，请重新启动捕获器及牌手后开新局");
        this.captureGeometry = geometry;
        return geometry;
      } catch (error) {
        if (error.code !== "TCG_CAPTURE_GEOMETRY") throw error;
        this.captureGeometryError = error;
        this.boardReady = false;
        this.handPositionProof = null;
        this.preparedHandInput = null;
        throw error;
      }
    }
// @endfragment bgi-host.adoptCapture

// @fragment bgi-host.checkInputGeometry
checkInputGeometry() {
      this.requireMatchTime();
      if (this.captureGeometryError) throw this.captureGeometryError;
      const started = Date.now(), f = captureGameRegion();
      this.metrics.geometryChecks++;
      this.metrics.frames++;
      this.metrics.captureMs += Date.now() - started;
      try { this.adoptCapture(f); }
      finally { f.dispose(); this.metrics.geometryMs += Date.now() - started; }
      this.requireMatchTime();
    }
// @endfragment bgi-host.checkInputGeometry

// @fragment bgi-host.has
has(f, asset, roi, threshold) {
      return this.matches(f, asset, roi, threshold).length > 0;
    }
// @endfragment bgi-host.has

// @fragment bgi-host.memoFrame
memoFrame(f, key, read) {
      if (!this.frameMemo) return read();
      let cache = this.frameMemo.get(f);
      if (!cache) {
        cache = new Map();
        this.frameMemo.set(f, cache);
      }
      if (cache.has(key)) {
        this.metrics.memoHits++;
        return cache.get(key);
      }
      const value = read();
      cache.set(key, value);
      return value;
    }
// @endfragment bgi-host.memoFrame

// @fragment bgi-host.metricDelta
metricDelta(before) {
      return Object.fromEntries(
        Object.keys(this.metrics).map((k) => [k, this.metrics[k] - (before?.[k] || 0)]),
      );
    }
// @endfragment bgi-host.metricDelta

// @fragment bgi-host.metricSnapshot
metricSnapshot() {
      return { ...this.metrics };
    }
// @endfragment bgi-host.metricSnapshot

// @fragment bgi-host.numericAt
numericAt(f, area, scale) {
      return this.localOcr(f, area, scale, false);
    }
// @endfragment bgi-host.numericAt

// @fragment bgi-host.ocr
ocr(f, area) {
      if (area.scale !== 1) return this.localOcr(f, area, 1, false);
      const roi = this.checkedRoi(f, area), key = JSON.stringify(["ocr", area, roi]);
      return this.memoFrame(f, key, () => this.findOcr(f, roi, false, key));
    }
// @endfragment bgi-host.ocr

// @fragment bgi-host.reportStop
reportStop(reason, code) {
      // Preserve the original stop even if its final log write fails.
      try {
        this.trace("stop", { reason, code });
      } catch (e) {
        log.warn("停止日志保存失败：" + e.message);
      }
    }
// @endfragment bgi-host.reportStop

// @fragment bgi-host.recordRunDiagnostic
recordRunDiagnostic(event, data, now) {
      const d = this.runDiagnostics;
      if (event === "start") d.startedAt = now;
      if (event === "observation-timing") d.timing.observationMs += data.ms;
      if (event === "action-timing") {
        for (const key of ["planningMs", "inputMs", "settlementMs", "postActionMs"])
          d.timing[key] += data[key] || 0;
        // A recovered execute() can return sent:false after native confirmation.
        // Never overwrite that evidence, or infer submission from execute.sent.
        if (d.lastAction?.key === data.action && d.lastAction.status === "planned")
          d.lastAction.status = data.outcome === "failed" ? "failed-before-submission" : data.outcome;
      }
      if (event === "decision") {
        d.counts.planned++;
        d.lastAction = { key: TCG.actionKey(data), status: "planned", at: now };
      }
      const status = { "input-submitted": "pending", confirmed: "confirmed",
        "action-uncertain": "unconfirmed", "native-input-rejected": "rejected",
        "tuning-retry-alternative": "rejected" }[event];
      if (status && data.action) {
        d.lastAction = { key: TCG.actionKey(data.action), status, at: now };
        if (event === "input-submitted") d.counts.submitted++;
        if (event === "confirmed") d.counts.confirmed++;
      }
      const gap = (kind, fields) => {
        const previous = d.missing[kind];
        if (!fields.length) {
          if (previous) d.lastMissing = { ...previous, resolved: true, resolvedAt: now };
          d.missing[kind] = null;
        } else {
          const same = previous && JSON.stringify(previous.fields) === JSON.stringify(fields);
          d.missing[kind] = { fields: [...fields], firstAt: same ? previous.firstAt : now, lastAt: now, resolved: false };
          d.lastMissing = d.missing[kind];
        }
      };
      if (Array.isArray(data?.missing)) {
        if (data.missing.length || event === "board-settle-wait") gap("board", data.missing);
      } else if (data?.code === "TCG_DICE_RETRY") gap("board", ["dice"]);
      if (["hand-count-unresolved", "hand-read-deferred"].includes(event) ||
          ["TCG_HAND_RETRY", "TCG_HAND_UNRESOLVED"].includes(data?.code))
        gap("hand", [event === "hand-count-unresolved" ? "hand.count" : "hand"]);
      if (event === "hand-read-completed" && Number.isInteger(data.count)) gap("hand", []);
      const state = event === "state" ? data.state :
        ["state-resynced", "confirmed"].includes(event) ? data.after : null;
      if (state?.phase === "board" && state.turn === "user" && TCG.legalState(state) && !this.observationIssues(state).length) {
        gap("board", []);
        if (Array.isArray(state.hand)) gap("hand", []);
      }
    }
// @endfragment bgi-host.recordRunDiagnostic

// @fragment bgi-host.runSummary
runSummary(event, data, now) {
      const d = this.runDiagnostics, elapsedMs = now - d.startedAt;
      const describe = gap => gap && { ...gap,
        spanMs: (gap.resolved ? gap.resolvedAt : now) - gap.firstAt,
        lastSeenAgoMs: now - gap.lastAt };
      return { outcome: event === "result" ? "completed" : event === "terminal-entry" ? "already-ended" : "stopped",
        result: data.result || null, reason: data.reason, code: data.code,
        stage: this.runStage, phase: d.phase && { ...d.phase, ageMs: now - d.phase.at }, elapsedMs,
        timing: { ...d.timing, otherMs: Math.max(0, elapsedMs - Object.values(d.timing).reduce((a,b) => a+b, 0)) },
        counts: { ...d.counts }, lastAction: d.lastAction && { ...d.lastAction },
        missing: Object.values(d.missing).filter(Boolean).map(describe), lastMissing: describe(d.lastMissing),
        recognition: this.metricSnapshot() };
    }
// @endfragment bgi-host.runSummary

// @fragment bgi-host.reportRunSummary
reportRunSummary(s) {
      const seconds = ms => (ms / 1000).toFixed(1) + "秒";
      const stages = { entry: "启动", "phase-wait": "阶段等待", observation: "观察", planning: "决策",
        input: "输入及恢复", confirmation: "效果确认", "post-action": "确认后记账",
        opening: "起手", pick: "选人", replacement: "阵亡换人", roll: "重投", choice: "挑选卡牌" };
      const statuses = { planned: "仅计划", pending: "已提交、待确认", confirmed: "已确认",
        unconfirmed: "未确认", rejected: "游戏拒绝", "not-submitted": "未完成提交", probed: "仅检视",
        "failed-before-submission": "未形成提交记录即失败" };
      const fieldName = field => {
        const match = /^own\[(\d)\]\.(energy|hp|status)$/.exec(field);
        return match ? (TCG.team[Number(match[1])]?.name || match[1]) +
          { energy: "充能", hp: "生命", status: "状态" }[match[2]] :
          ({ dice: "骰子", active: "出战角色", hand: "手牌", "hand.count": "手牌数量", phase: "页面阶段", turn: "行动方" }[field] || field);
      };
      const outcome = s.outcome === "completed" ? "正常结束（" + (s.result === "win" ? "胜利" : s.result === "lose" ? "失败" : "结果未知") + "）" :
        s.outcome === "already-ended" ? "启动时已在结束页，不计本轮结果" : "脚本停止";
      const missing = s.missing.length ? s.missing.map(g => g.fields.map(fieldName).join("、") +
        "（未解决记录跨度" + seconds(g.spanMs) + "，距末次缺读" + seconds(g.lastSeenAgoMs) + "）").join("；") : "无未解决的缺读记录";
      log.info("[对局摘要] " + outcome + "；处理阶段：" + (stages[s.stage] || s.stage) +
        "；总用时" + seconds(s.elapsedMs) + "，观察" + seconds(s.timing.observationMs) +
        "，输入/恢复" + seconds(s.timing.inputMs) + "，确认" + seconds(s.timing.settlementMs) +
        "（均含重试，非纯等待）" + "；计划/提交/确认：" + s.counts.planned + "/" + s.counts.submitted + "/" + s.counts.confirmed +
        "；最后动作：" + (s.lastAction ? s.lastAction.key + " " + (statuses[s.lastAction.status] || s.lastAction.status) : "无") +
        "；缺读：" + missing + (s.reason ? "；停止原因：" + s.reason : ""));
    }
// @endfragment bgi-host.reportRunSummary

// @fragment bgi-host.trace
trace(event, data) {
      const now = Date.now();
      this.recordRunDiagnostic(event, data, now);
      if (["result", "stop", "terminal-entry"].includes(event)) {
        const summary = this.runSummary(event, data, now);
        data = { ...data, summary };
        this.reportRunSummary(summary);
      }
      const text = JSON.stringify({ at: new Date().toISOString(), event, data });
      if (this.logAppend === null) {
        const indexPath = "logs/tcg-log-index.json";
        let next = 0;
        if (file.isExists(indexPath)) {
          try {
            const index = JSON.parse(file.readTextSync(indexPath));
            if (Number.isInteger(index?.next) && index.next >= 0 && index.next < 10) next = index.next;
            else log.warn("日志轮转索引无效，从第一个日志槽继续。");
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
            log.warn("日志轮转索引损坏，从第一个日志槽继续。");
          }
        }
        this.path = "logs/run-slot-" + String(next + 1).padStart(2, "0") + ".log";
        if (!file.writeTextSync(indexPath, JSON.stringify({ next: (next + 1) % 10 }), false))
          throw new Error("无法写入日志轮转索引：" + indexPath);
        this.logAppend = false;
      }
      if (!file.writeTextSync(this.path, text + "\n", this.logAppend))
        throw new Error("无法写入对局日志：" + this.path);
      this.logAppend = true;
    }
// @endfragment bgi-host.trace

// @fragment bgi-host.waitForCapture
async waitForCapture() {
      // Give an in-progress window transition a bounded chance to settle.
      // Bind both actual and normalized sizes; no OCR or input during settling.
      let stable = 0,
        last = null, lastError = null, lastKey = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        this.requireMatchTime();
        if (this.captureGeometryError) throw this.captureGeometryError;
        const f = captureGameRegion(), frameSize = captureSize(f);
        try {
          last = captureGeometry(f, Number(genshin.scaleTo1080PRatio));
          lastError = null;
        } catch (error) {
          if (error.code !== "TCG_CAPTURE_GEOMETRY") throw error;
          lastError = error;
          last = null;
        } finally {
          f.dispose();
        }
        const key = JSON.stringify(last || { frameSize, error: lastError.message });
        stable = last ? key === lastKey ? stable + 1 : 1 : 0;
        if (key !== lastKey) {
          this.trace("capture-size", { ...last, error: lastError?.message, attempt });
          lastKey = key;
        }
        if (stable >= 2) {
          if (this.captureGeometry && JSON.stringify(last) !== JSON.stringify(this.captureGeometry))
            throw captureGeometryError("本局捕获尺寸已变化，不能重新绑定旧局");
          this.captureGeometry = last;
          this.trace("capture-ready", last);
          return;
        }
        if (attempt < 19) await sleep(300);
      }
      throw lastError || captureGeometryError("游戏客户区及归一帧尺寸未稳定");
    }
// @endfragment bgi-host.waitForCapture

// @fragment tcg-ui.matches
matches(f, asset, area, threshold = 0.88, useColor = false) {
      const roi = this.checkedRoi(f, area);
      if (area.scale !== 1) {
        return this.memoFrame(f,JSON.stringify(["localMatch",asset,area,threshold,useColor]),()=>{
          let crop=null,resized=null,region=null;
          const width=Math.round(roi[2]/area.scale),height=Math.round(roi[3]/area.scale);
          try {
            crop=f.DeriveCrop(...roi);
            resized=crop.SrcMat.Resize(new OpenCvSharp.OpenCvSharp.Size(width,height));
            region=new ImageRegion(resized,0,0);
            const local={rect:[0,0,width,height],scale:1,layoutKey:area.layoutKey,panel:"details"};
            return this.matches(region,asset,local,threshold,useColor).map(r=>({
              x:roi[0]+r.x*roi[2]/width,y:roi[1]+r.y*roi[3]/height,
              w:r.w*roi[2]/width,h:r.h*roi[3]/height}));
          } finally { if(region)region.dispose();else if(resized)resized.dispose();if(crop)crop.dispose(); }
        });
      }
      const key = asset + "/" + JSON.stringify([area, roi, threshold, useColor]);
      return this.memoFrame(f, "matches/"+key, () => {
      if (!this.roCache.has(key)) {
        if (!this.templates.has(asset)) {
          const mat = this.readTemplateImage("assets/" + asset + ".png");
          if (mat.empty()) { mat.dispose(); throw new Error("缺少模板：" + asset); }
          this.templates.set(asset, mat);
        }
        const ro = RecognitionObject.TemplateMatch(this.templates.get(asset), ...roi);
        ro.threshold = threshold;
        ro.Use3Channels = useColor;
        this.roCache.set(key, ro);
      }
      const found = f.FindMulti(this.roCache.get(key));
      const results = [];
      for (let i = 0; i < found.count; i++) {
        const r = found[i];
        // Copy managed scalar data while the source image is still alive.
        results.push({ x: Number(r.x ?? r.X), y: Number(r.y ?? r.Y),
          w: Number(r.width ?? r.Width), h: Number(r.height ?? r.Height) });
      }
      return results;
      });
    }
// @endfragment tcg-ui.matches

// @fragment tcg-ui.ocrRows
ocrRows(f, area) {
      if (area.scale !== 1) return this.localOcr(f, area, 1, true);
      const roi = this.checkedRoi(f, area), key = JSON.stringify(["ocrRows", area, roi]);
      return this.memoFrame(f, key, () => this.findOcr(f, roi, true, key));
    }
// @endfragment tcg-ui.ocrRows
