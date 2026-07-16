import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const content = await readFile(new URL("../sku-image-content.js", import.meta.url), "utf8");

test("batch fill confirm button is not treated as a final publish action", () => {
  const blockedActions = content.match(/const BLOCKED_ACTIONS = \[(.*?)\];/s)?.[1] || "";

  assert.doesNotMatch(blockedActions, /"确定"/);
  assert.match(blockedActions, /"提交"/);
  assert.match(blockedActions, /"保存并发布"/);
});

test("final action guard can be replaced on reinjection", () => {
  assert.match(content, /__tmallSkuImageFinalGuardHandler/);
  assert.match(content, /removeEventListener\("click", window\.__tmallSkuImageFinalGuardHandler, true\)/);
});

test("fill workflow exposes a scoped dialog confirm action", () => {
  assert.match(content, /function findDialogConfirmButton\(dialog\)/);
  assert.match(content, /function findGenericSkuImageDialog\(\)/);
  assert.match(content, /async function confirmDialog\(\)/);
  assert.match(content, /message\.action === "confirmDialog"/);
  assert.match(content, /dialog === document\.body/);
});

test("SKU image clicks use trusted coordinates and iframe material targets", () => {
  assert.match(content, /TMALL_AUTO_LISTING_DEBUG_CLICK/);
  assert.match(content, /async function trustedClick\(element, options = \{\}\)/);
  assert.match(content, /function backgroundUrlOf\(element\)/);
  assert.match(content, /target: card/);
  assert.match(content, /target\.target \|\| target\.img \|\| target\.element/);
  assert.match(content, /targetRow\.filled/);
  assert.match(content, /fallbackRow/);
});

test("material matching clicks the whole card instead of a nested image", () => {
  const collectFrameImages = content.match(/function collectFrameImages\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(collectFrameImages, /target: card/);
  assert.doesNotMatch(collectFrameImages, /target: imageElement/);
});

test("material retry uses the exact CDN source when one is supplied", () => {
  const matcher = content.match(/function frameImageMatchesPayload\(card, payload, expectedSizes\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(matcher, /if \(payload\.src\) return card\.src === payload\.src;/);
  assert.doesNotMatch(matcher, /payload\.src && card\.src === payload\.src\) return true/);
});

test("group fill can clear off-screen selections and bulk-verify virtual rows", () => {
  assert.match(content, /async function clearDialogSkuSelectionsExcept\(payload = \{\}\)/);
  assert.match(content, /async function getDialogSkuStates\(payload = \{\}\)/);
  assert.match(content, /findWithScroll\([\s\S]*?item\.selected/);
  assert.match(content, /scanWithScroll\([\s\S]*?collectDialogSkuRows/);
});

test("trusted-click fallback is opt-in for verifiable SKU and material actions", () => {
  const trustedClick = content.match(/async function trustedClick\(element, options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(trustedClick, /hasExtensionRuntime/);
  assert.match(trustedClick, /trusted-click-failed/);
  assert.match(trustedClick, /options\.allowSyntheticFallback/);
  assert.match(trustedClick, /fallback: true/);
  assert.match(content, /clickFrameImage[\s\S]*?allowSyntheticFallback: true/);
  assert.match(content, /async function confirmDialog\(\)[\s\S]*?trustedClick\(button\)/);
  assert.doesNotMatch(content, /async function confirmDialog\(\)[\s\S]*?trustedClick\(button, \{ allowSyntheticFallback: true \}\)/);
});
