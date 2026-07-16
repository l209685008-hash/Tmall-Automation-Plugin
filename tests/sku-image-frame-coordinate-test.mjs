import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");

function createBackgroundContext() {
  const context = vm.createContext({
    console,
    URL,
    Math,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
    importScripts() {},
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      tabs: {},
      debugger: {},
      scripting: {},
      storage: { local: { set: async () => {} } },
      webNavigation: {}
    }
  });
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  return context;
}

test("nested iframe points include owner border and CSS scale", async () => {
  const context = createBackgroundContext();
  context.__frames = [
    { frameId: 7, parentFrameId: 3, url: "https://child.example/final" },
    { frameId: 3, parentFrameId: 0, url: "https://parent.example/final" }
  ];
  context.__rects = {
    7: { left: 100, top: 50, clientLeft: 2, clientTop: 3, scaleX: 2, scaleY: 0.5 },
    3: { left: 7, top: 11, clientLeft: 1, clientTop: 2, scaleX: 0.5, scaleY: 2 }
  };
  context.__calls = [];
  vm.runInContext(`
    getFrames = async () => __frames;
    findChildFrameRect = async (_tabId, _parentFrameId, childFrameId) => {
      __calls.push(childFrameId);
      return __rects[childFrameId];
    };
  `, context);

  const result = await context.mapPointToTopFrame(99, 7, { x: 10, y: 20 });

  assert.equal(result.ok, true);
  assert.equal(result.mapped, true);
  assert.equal(result.point.x, 69.5);
  assert.equal(result.point.y, 138);
  assert.deepEqual(Array.from(context.__calls), [7, 3]);
});

test("frame owner discovery identifies the exact child window instead of matching iframe URLs", () => {
  assert.match(backgroundSource, /candidate\.contentWindow === event\.source/);
  assert.match(backgroundSource, /window\.parent\.postMessage/);
  assert.doesNotMatch(backgroundSource, /findChildFrameRect\(tabId, parentFrameId, childUrl\)/);
});
