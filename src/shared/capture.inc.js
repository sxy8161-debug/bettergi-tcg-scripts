// Shared capture fragments. Inlined at build time; no runtime dependency.

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
enlargedOcrRows(f, roi, scale) {
      return this.memoFrame(f, "enlargedRows/" + roi.join(",") + "/" + scale, () => {
        let crop = null,
          resized = null,
          region = null;
        try {
          crop = f.DeriveCrop(...roi);
          resized = crop.SrcMat.Resize(
            new OpenCvSharp.OpenCvSharp.Size(roi[2] * scale, roi[3] * scale),
          );
          region = new ImageRegion(resized, 0, 0);
          return this.ocrRows(region, [0, 0, roi[2] * scale, roi[3] * scale]).map((r) => ({
            text: r.text,
            x: roi[0] + r.x / scale,
            y: roi[1] + r.y / scale,
            w: r.w / scale,
            h: r.h / scale,
          }));
        } finally {
          if (region) region.dispose();
          else if (resized) resized.dispose();
          if (crop) crop.dispose();
        }
      });
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
        requireCaptureSize(captureSize(f));
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
numericAt(f, roi, scale) {
      return this.memoFrame(f, "numeric/" + roi.join(",") + "/" + scale, () => {
        let crop = null,
          resized = null,
          region = null;
        try {
          crop = f.DeriveCrop(...roi);
          resized = crop.SrcMat.Resize(
            new OpenCvSharp.OpenCvSharp.Size(roi[2] * scale, roi[3] * scale),
          );
          region = new ImageRegion(resized, 0, 0);
          return this.ocr(region, [0, 0, roi[2] * scale, roi[3] * scale]);
        } finally {
          if (region) region.dispose();
          else if (resized) resized.dispose();
          if (crop) crop.dispose();
        }
      });
    }
// @endfragment bgi-host.numericAt

// @fragment bgi-host.ocr
ocr(f, roi) {
      const key = "ocr/" + roi.join(",");
      return this.memoFrame(f, key, () => {
        if (!this.roCache.has(key)) this.roCache.set(key, RecognitionObject.Ocr(...roi));
        const started = Date.now();
        this.metrics.ocrCalls++;
        const r = f.Find(this.roCache.get(key));
        const value = r.isExist() ? String(r.text ?? r.Text ?? "").trim() : "";
        this.metrics.ocrMs += Date.now() - started;
        return value;
      });
    }
// @endfragment bgi-host.ocr

// @fragment bgi-host.reportStop
reportStop(reason) {
      // Preserve the original stop even if its final log write fails.
      try {
        this.trace("stop", { reason });
      } catch (e) {
        log.warn("停止日志保存失败：" + e.message);
      }
    }
// @endfragment bgi-host.reportStop

// @fragment bgi-host.trace
trace(event, data) {
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
      // No OCR, templates, or game input until two native 1080P frames agree.
      let stable = 0,
        last = { width: null, height: null },
        lastKey = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        const f = captureGameRegion();
        try {
          last = captureSize(f);
        } finally {
          f.dispose();
        }
        const key = JSON.stringify(last);
        if (key !== lastKey) {
          this.trace("capture-size", { ...last, attempt });
          lastKey = key;
        }
        stable = last.width === 1920 && last.height === 1080 ? stable + 1 : 0;
        if (stable >= 2) {
          this.trace("capture-ready", last);
          return;
        }
        if (attempt < 19) await sleep(300);
      }
      requireCaptureSize(last);
      throw new Error("游戏捕获尺寸未稳定为1920×1080");
    }
// @endfragment bgi-host.waitForCapture

// @fragment tcg-ui.matches
matches(f, asset, roi, threshold = 0.88, useColor = false) {
      const key = asset + "/" + roi.join(",") + "/" + threshold + "/" + useColor;
      return this.memoFrame(f, "matches/"+key, () => {
      if (!this.roCache.has(key)) {
        if (!this.templates.has(asset)) {
          const mat = file.readImageMatSync("assets/" + asset + ".png");
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
ocrRows(f, roi) {
      return this.memoFrame(f, "ocrRows/" + roi.join(","), () => {
        const key = "ocr/" + roi.join(",");
        if (!this.roCache.has(key)) this.roCache.set(key, RecognitionObject.Ocr(...roi));
        const started = Date.now();
        this.metrics.ocrCalls++;
        const rs = f.FindMulti(this.roCache.get(key)),
          out = [];
        for (let i = 0; i < rs.count; i++) {
          const r = rs[i];
          out.push({
            text: String(r.text ?? r.Text ?? "").trim(),
            x: Number(r.x ?? r.X),
            y: Number(r.y ?? r.Y),
            w: Number(r.width ?? r.Width),
            h: Number(r.height ?? r.Height),
          });
        }
        this.metrics.ocrMs += Date.now() - started;
        return out;
      });
    }
// @endfragment tcg-ui.ocrRows
