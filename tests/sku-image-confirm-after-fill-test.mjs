import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");

test("background attempts dialog confirm before final rescan", () => {
  const confirmIndex = background.indexOf('"confirmDialog"');
  const rescanIndex = background.indexOf("after = await scanSkuImageDialogWithFrameImages");

  assert.ok(confirmIndex > -1);
  assert.ok(rescanIndex > -1);
  assert.ok(confirmIndex < rescanIndex);
});

test("popup leaves the SKU image dialog open after verified fill", () => {
  assert.match(popup, /fillByPlan[\s\S]*?confirmAfterFill: false/);
});

test("popup records progress before the long-running fill request completes", () => {
  assert.match(popup, /开始执行，请保持当前商品页和填充弹窗打开/);
  assert.ok(popup.indexOf("开始执行，请保持当前商品页和填充弹窗打开") < popup.indexOf("const response = await sendSkuImage(action"));
});
