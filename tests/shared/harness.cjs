"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scripts = ["core", "strategy", "bgi", "player"];
const clone = (value) => JSON.parse(JSON.stringify(value));

// Translate only a detached historical fixture, never its source bytes or the
// runtime catalog. Real card names bind old deck-local IDs to current identities.
function historical(T, value) {
  const names = { talent: ["飞叶迴斜", "偷懒的新方法"],
    woven: ["元素共鸣：交织之雷", "元素共鸣：交织之草"] };
  const ids = Object.fromEntries(Object.entries(names).map(([old, candidates]) =>
    [old, T.cards.find(c => candidates.includes(c.name))?.id || old]));
  function translate(x, key) {
    if (typeof x === "string" && key !== "type") {
      if (ids[x]) return ids[x];
      for (const [old, id] of Object.entries(ids)) for (const kind of ["card", "tune"])
        if (x === kind + ":" + old) return kind + ":" + id;
    }
    if (Array.isArray(x)) return x.map(item => translate(item));
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, translate(v, k)]));
    return x;
  }
  return translate(value);
}

// No native BetterGI APIs: tests must explicitly supply every input/capture mock.
function load(base, overrides = {}) {
  const context = vm.createContext({
    sleep: async () => {},
    ...overrides,
    file: { createDirectory() {}, isExists() { return false; }, writeTextSync() { return true; }, ...overrides.file },
  });
  for (const name of scripts) {
    vm.runInContext(fs.readFileSync(path.join(base, "lib", name + ".js"), "utf8"), context, {
      filename: name + ".js",
    });
  }
  return context;
}

// Explicit no-pixel input fixture. The tested API consumes normalized points;
// it does not pretend to recognize a frame or to run a native game.
function nativeInput(onClick = () => {}, onMove = () => {}) {
  let point = null;
  return {
    genshin: { scaleTo1080PRatio: 1 },
    captureGameRegion: () => ({ Width: 1920, Height: 1080,
      Prev: { Width: 3840, Height: 2160, Prev: null }, dispose() {} }),
    GameCaptureRegion: { GameRegion1080PPosMove(x, y) { point = [x, y]; onMove(x, y); } },
    leftButtonClick() { onClick(...point); },
  };
}
module.exports = { load, clone, historical, scripts, nativeInput };
