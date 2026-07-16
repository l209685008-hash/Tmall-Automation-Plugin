import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import matcher from "../lib/sku-image-matcher.js";

const sharedSkuNames = [
  "【高清三防横版】60*30*1000张*27卷/箱",
  "【高清三防横版】60*30*1200张*23卷/箱"
];

const duplicateSources = [
  {
    name: "60-30.jpg",
    cardText: "60-30.jpg 800x800",
    src: "https://img.alicdn.example/folder-a/60-30.jpg?v=1"
  },
  {
    name: "60-30.jpg",
    cardText: "60-30.jpg 800x800",
    src: "https://img.alicdn.example/folder-b/60-30.jpg?v=2"
  }
];

test("duplicate src values with the same 60-30.jpg filename are one logical material", () => {
  const plan = matcher.buildMatchPlan(
    [{ row: 1, sku_name: sharedSkuNames[0] }],
    duplicateSources,
    { minConfidence: 0.78 }
  );

  assert.equal(plan.image_count, 2);
  assert.equal(plan.logical_image_count, 1);
  assert.equal(plan.duplicate_image_count, 1);
  assert.equal(plan.ambiguous_count, 0);
  assert.equal(plan.items[0].status, "auto");
  assert.equal(plan.items[0].image.name, "60-30.jpg");
  assert.deepEqual(plan.items[0].image.equivalentSources, duplicateSources.map((image) => image.src));
});

test("same filename with a different lane or folder context is not collapsed", () => {
  const ordinary = { ...duplicateSources[0], folder: "普通卷筒" };
  const doubleLane = { ...duplicateSources[1], folder: "双排" };
  const collapsed = matcher.collapseEquivalentImages([ordinary, doubleLane]);

  assert.equal(collapsed.length, 2);
  assert.notEqual(matcher.imageLogicalKey(ordinary), matcher.imageLogicalKey(doubleLane));
});

test("one 60-30.jpg logical material can be reused by multiple same-size SKUs", () => {
  const plan = matcher.buildMatchPlan(
    sharedSkuNames.map((sku_name, index) => ({ row: index + 1, sku_name })),
    [duplicateSources[0]],
    { minConfidence: 0.78 }
  );

  assert.equal(plan.auto_count, 2);
  assert.equal(plan.ambiguous_count, 0);
  assert.deepEqual(plan.items.map((item) => item.status), ["auto", "auto"]);
  assert.deepEqual(plan.items.map((item) => item.image.name), ["60-30.jpg", "60-30.jpg"]);
  assert.equal(matcher.imageLogicalKey(plan.items[0].image), matcher.imageLogicalKey(plan.items[1].image));
});

const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");

function createSharedImageFillHarness({ preserveOffscreenSelections = true, groupMode = false, confirmAfterFill = false } = {}) {
  const calls = [];
  const selected = new Set();
  const filled = new Set();
  const image = matcher.collapseEquivalentImages(duplicateSources)[0];
  const items = sharedSkuNames.map((sku_name, index) => ({
    index,
    sku_name,
    status: "auto",
    confidence: 0.94,
    reason: "尺寸:60x30，材质:三防，版型:横版",
    image
  }));
  const scan = {
    selectedFrame: { frameId: 1 },
    selectedImageFrame: { frameId: 2 },
    diagnostics: [],
    result: {
      skuRows: items.map(({ index, sku_name }) => ({ index, sku_name, filled: false })),
      plan: { items }
    }
  };

  const stateFor = (payload = {}) => {
    const index = Number(payload.index);
    return {
      index,
      sku_name: sharedSkuNames[index],
      filled: filled.has(index),
      selected: selected.has(index),
      thumbnail: filled.has(index) ? duplicateSources[0].src : ""
    };
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
    SkuImageMatcher: matcher,
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
  context.__selected = selected;
  context.__filled = filled;
  context.__stateFor = stateFor;
  vm.runInContext(`
    scanSkuImageDialogWithFrameImages = async () => __scan;
    sendToSkuImageFrame = async (_tabId, _frameId, action, payload = {}) => {
      __calls.push({
        action,
        payload: { ...payload },
        selectedBefore: [...__selected],
        filledBefore: [...__filled]
      });
      const index = Number(payload.index);
      if (action === "getDialogSkuState") {
        return { ok: true, state: __stateFor(payload) };
      }
      if (action === "getDialogSkuStates") {
        return {
          ok: true,
          results: (payload.items || []).map((item) => ({ ok: true, state: __stateFor(item) }))
        };
      }
      if (action === "clearDialogSkuSelectionsExcept") {
        const keep = new Set(payload.keepSelectedSkus || []);
        for (const selectedIndex of [...__selected]) {
          if (!keep.has(__scan.result.plan.items[selectedIndex].sku_name)) __selected.delete(selectedIndex);
        }
        return { ok: true };
      }
      if (action === "prepareDialogSku") {
        const keep = new Set(payload.keepSelectedSkus || []);
        if (!${preserveOffscreenSelections}) __selected.clear();
        for (const selectedIndex of [...__selected]) {
          if (!keep.has(__scan.result.plan.items[selectedIndex].sku_name)) __selected.delete(selectedIndex);
        }
        __selected.add(index);
        return { ok: true, state: __stateFor(payload) };
      }
      if (action === "clickFrameImage") {
        for (const selectedIndex of __selected) __filled.add(selectedIndex);
        __selected.clear();
        return { ok: true };
      }
      if (action === "clearDialogSkuSelection") {
        __selected.delete(index);
        return { ok: true, state: __stateFor(payload) };
      }
      if (action === "getDialogFillSummary") {
        return {
          ok: true,
          total_count: __scan.result.plan.items.length,
          filled_count: __filled.size,
          missing_count: __scan.result.plan.items.length - __filled.size,
          selected_count: __selected.size
        };
      }
      if (action === "confirmDialog") return { ok: true };
      return { ok: true };
    };
  `, context);

  return {
    calls,
    run: () => context.fillSkuImagesByFilenamePlan(99, {
      maxRows: 79,
      confirmAfterFill,
      groupMode,
      verifyTimeoutMs: 1,
      verifyPollMs: 1,
      maxRetries: 1
    })
  };
}

test("fill groups shared logical materials, preserves multi-select, clicks once, then verifies every row", async () => {
  const harness = createSharedImageFillHarness({ groupMode: true, confirmAfterFill: true });
  const run = await harness.run();
  const result = run.result;
  const prepares = harness.calls.filter((call) => call.action === "prepareDialogSku");
  const imageClicks = harness.calls.filter((call) => call.action === "clickFrameImage");
  const imageClickIndex = harness.calls.findIndex((call) => call.action === "clickFrameImage");
  const postClickVerifications = harness.calls
    .slice(imageClickIndex + 1)
    .filter((call) => call.action === "getDialogSkuStates");
  const selectionResetIndex = harness.calls.findIndex((call) => call.action === "clearDialogSkuSelectionsExcept");
  const firstPrepareIndex = harness.calls.findIndex((call) => call.action === "prepareDialogSku");

  assert.equal(prepares.length, 2);
  assert.deepEqual(Array.from(prepares[1].selectedBefore), [0], "selecting the second SKU must preserve the first selection");
  assert.deepEqual(Array.from(prepares[1].payload.keepSelectedSkus), sharedSkuNames);
  assert.equal(imageClicks.length, 1, "a shared logical material must be clicked only once");
  assert.deepEqual(Array.from(imageClicks[0].selectedBefore), [0, 1], "both SKU rows must be selected before the material click");
  assert.equal(selectionResetIndex < firstPrepareIndex, true, "all off-screen residual selections must be cleared before group selection");
  assert.equal(postClickVerifications.length, 1, "one bulk scan must verify the whole shared-image group");
  assert.deepEqual(Array.from(postClickVerifications[0].payload.items, (item) => item.index), [0, 1]);
  assert.equal(result.image_group_count, 1);
  assert.equal(result.image_click_count, 1);
  assert.equal(result.filled_count, 2);
  assert.equal(result.verification_failed_count, 0);
  assert.deepEqual(Array.from(result.failed_skus), []);
  assert.equal(result.actions.filter((action) => action.filled && action.shared_image).length, 2);
  assert.equal(harness.calls.filter((call) => call.action === "confirmDialog").length, 1);
});

test("default fill reuses one logical image sequentially for virtual-list SKUs", async () => {
  const harness = createSharedImageFillHarness({ preserveOffscreenSelections: false });
  const run = await harness.run();
  const result = run.result;
  const imageClicks = harness.calls.filter((call) => call.action === "clickFrameImage");

  assert.equal(imageClicks.length, 2, "the same logical material should be clicked once for each SKU after fallback");
  assert.deepEqual(imageClicks.map((call) => Array.from(call.selectedBefore)), [[0], [1]]);
  assert.equal(result.sequential_fallback_count, 1);
  assert.equal(result.sequential_mode, true);
  assert.equal(result.image_click_count, 2);
  assert.equal(result.filled_count, 2);
  assert.equal(result.verification_failed_count, 0);
  assert.deepEqual(Array.from(result.failed_skus), []);
  assert.equal(harness.calls.filter((call) => call.action === "confirmDialog").length, 0);
});
