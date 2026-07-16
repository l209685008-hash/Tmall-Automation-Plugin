import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../sku-image-content.js", import.meta.url), "utf8");

function createBackgroundHarness({ initiallyFilled = false, verificationFilled = false } = {}) {
  const calls = [];
  const scan = {
    selectedFrame: { frameId: 1 },
    selectedImageFrame: { frameId: 2 },
    diagnostics: [],
    result: {
      skuRows: [{ index: 0, sku_name: "40*60*550张*45卷/箱", filled: initiallyFilled }],
      plan: {
        items: [{
          index: 0,
          sku_name: "40*60*550张*45卷/箱",
          status: "auto",
          filled: initiallyFilled,
          confidence: 0.82,
          reason: "尺寸:40x60",
          image: { name: "40-60.jpg", src: "https://img.example/40-60.jpg", sizes: ["40x60"] }
        }]
      }
    }
  };

  const context = vm.createContext({
    console,
    URL,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
    importScripts() {},
    SkuImageMatcher: {
      extractSizes: () => ["40x60"],
      describeImage: (image) => image,
      buildMatchPlan: () => scan.result.plan
    },
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
  context.__scan = scan;
  context.__calls = calls;
  context.__initiallyFilled = initiallyFilled;
  context.__verificationFilled = verificationFilled;
  context.__prepared = false;
  context.__imageClicked = false;
  vm.runInContext(`
    scanSkuImageDialogWithFrameImages = async () => __scan;
    sendToSkuImageFrame = async (_tabId, _frameId, action, payload = {}) => {
      __calls.push({ action, payload });
      const state = {
        index: 0,
        sku_name: payload.sku_name || "40*60*550张*45卷/箱",
        filled: __initiallyFilled || __verificationFilled,
        selected: false,
        thumbnail: (__initiallyFilled || __verificationFilled) ? "https://img.example/40-60.jpg" : ""
      };
      if (action === "clickDialogSku") return { ok: true };
      if (action === "clickFrameImage") {
        __imageClicked = true;
        __prepared = false;
        return { ok: true };
      }
      if (action === "prepareDialogSku") {
        __prepared = true;
        return { ok: true, alreadyFilled: __initiallyFilled, state: { ...state, selected: true } };
      }
      if (action === "clearDialogSkuSelection") return { ok: true, alreadyClear: true, state };
      if (action === "clearDialogSkuSelectionsExcept") {
        __prepared = false;
        return { ok: true, cleared_selection_count: 0 };
      }
      if (action === "confirmDialog") return { ok: true };
      if (action === "getDialogSkuState") {
        return { ok: true, state: { ...state, selected: __prepared && !__imageClicked } };
      }
      if (action === "getDialogSkuStates") {
        return {
          ok: true,
          results: (payload.items || []).map(() => ({
            ok: true,
            state: { ...state, selected: __prepared && !__imageClicked }
          }))
        };
      }
      if (action === "getDialogFillSummary") {
        const filled = __initiallyFilled || __verificationFilled;
        return { ok: true, total_count: 1, filled_count: filled ? 1 : 0, missing_count: filled ? 0 : 1, selected_count: 0 };
      }
      return { ok: true };
    };
  `, context);

  return {
    calls,
    run: (payload = {}) => context.fillSkuImagesByFilenamePlan(99, {
      maxRows: 79,
      confirmAfterFill: true,
      verifyTimeoutMs: 1,
      verifyPollMs: 1,
      maxRetries: 1,
      ...payload
    })
  };
}

test("dialog SKU rows expose state needed for post-click verification", () => {
  const rowCollector = contentSource.match(/function collectDialogSkuRows\(dialog\) \{[\s\S]*?\n  \}\n\n  async function scanDialog/)?.[0] || "";
  const visualState = contentSource.match(/function dialogSkuVisualState\(row\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(rowCollector, /dialogSkuVisualState\(row\)/, "each collected SKU row must include its visual state");
  assert.match(visualState, /filled\s*:/, "SKU row must expose whether an image is already filled");
  assert.match(visualState, /\bselected\b/, "SKU row must expose whether it is currently selected");
  assert.match(visualState, /\bthumbnail\b/, "SKU row must expose its current thumbnail identity");
});

test("background exposes the verification protocol and strict confirm gate", () => {
  assert.match(contentSource, /message\.action === "getDialogSkuState"/);
  assert.match(contentSource, /message\.action === "getDialogSkuStates"/);
  assert.match(contentSource, /message\.action === "prepareDialogSku"/);
  assert.match(contentSource, /message\.action === "clearDialogSkuSelection"/);
  assert.match(contentSource, /message\.action === "clearDialogSkuSelectionsExcept"/);
  assert.match(contentSource, /message\.action === "getDialogFillSummary"/);
  assert.match(backgroundSource, /(?:async\s+)?function waitForDialogSkuFilled\s*\(/);
  assert.match(backgroundSource, /verification_failed_count/);
  assert.match(backgroundSource, /failed_skus/);
  assert.match(backgroundSource, /fill_summary/);
  assert.match(
    backgroundSource,
    /verification_failed_count\s*===\s*0[\s\S]{0,300}missing_count\s*===\s*0[\s\S]{0,300}selected_count\s*===\s*0/,
    "confirm gate must require zero verification failures, zero missing rows, and zero selected rows"
  );
});

test("a successful image click is not counted or confirmed until the row verifies filled", async () => {
  const harness = createBackgroundHarness({ verificationFilled: false });
  const run = await harness.run();
  const result = run.result;

  assert.equal(harness.calls.some((call) => call.action === "clickFrameImage"), true);
  assert.equal(
    harness.calls.filter((call) => call.action === "getDialogSkuState").length >= 3,
    true,
    "background must verify the same row again after clicking the image"
  );
  assert.equal(harness.calls.some((call) => call.action === "confirmDialog"), false);
  assert.equal(result.filled_count, 0);
  assert.equal(result.verification_failed_count, 1);
  assert.deepEqual(Array.from(result.failed_skus), ["40*60*550张*45卷/箱"]);
  assert.equal(result.fill_summary.missing_count, 1);
  assert.ok(
    result.actions.some((action) => action.sku_name === "40*60*550张*45卷/箱" && !action.filled && (action.failed || action.skipped || /verify|未落地|未填|timeout/i.test(action.reason || ""))),
    "result must preserve the concrete SKU that failed post-click verification"
  );
});

test("an already-filled SKU is skipped idempotently", async () => {
  const harness = createBackgroundHarness({ initiallyFilled: true, verificationFilled: true });
  const run = await harness.run();
  const skuActions = harness.calls.filter((call) => call.action === "clickDialogSku" || call.action === "clickFrameImage" || call.action === "prepareDialogSku");

  assert.deepEqual(skuActions, []);
  assert.ok(
    run.result.actions.some((action) => action.sku_name === "40*60*550张*45卷/箱" && (action.alreadyFilled || action.idempotent || /already|已填/i.test(action.reason || ""))),
    "the action ledger must explain that the SKU was already filled"
  );
});
