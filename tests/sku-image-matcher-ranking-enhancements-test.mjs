import assert from "node:assert/strict";
import test from "node:test";
import matcher from "../lib/sku-image-matcher.js";

function buildSinglePlan(sku, images, options = {}) {
  return matcher.buildMatchPlan([{ row: 1, sku_name: sku }], images, options);
}

function assertSingleAutoImage(plan, expectedName) {
  assert.equal(plan.sku_count, 1);
  assert.equal(plan.items[0].status, "auto");
  assert.equal(plan.items[0].image.name, expectedName);
}

test("same-size candidates prefer the plain image for non-lane SKUs", () => {
  const plan = buildSinglePlan("【优质三防横版】50*20*1500张*80卷/箱", [
    { name: "双50-20.jpg", cardText: "双50-20.jpg 800x800" },
    { name: "三排50-20.jpg", cardText: "三排50-20.jpg 800x800" },
    { name: "50-20.jpg", cardText: "50-20.jpg 800x800" }
  ]);

  assertSingleAutoImage(plan, "50-20.jpg");
  assert.equal(plan.ambiguous_count, 0);
  assert.ok(plan.items[0].candidates.length >= 3);
  assert.equal(plan.items[0].candidates[0].image.name, "50-20.jpg");
  assert.ok(plan.items[0].candidates[0].confidence > plan.items[0].candidates[1].confidence);
});

test("same-size plain candidates without distinguishing signals stay ambiguous", () => {
  const plan = buildSinglePlan("【优质三防横版】50*20*1500张*80卷/箱", [
    { name: "50-20-a.jpg", cardText: "50-20-a.jpg 800x800" },
    { name: "50-20-b.jpg", cardText: "50-20-b.jpg 800x800" }
  ]);

  assert.equal(plan.items[0].status, "ambiguous");
  assert.equal(plan.ambiguous_count, 1);
  assert.equal(plan.items[0].candidates[0].confidence, plan.items[0].candidates[1].confidence);
});

test("missing image color keeps a colored SKU in review even with a direct size match", () => {
  const plan = buildSinglePlan("【优质三防竖版】100*150*350张蓝底*24卷/箱", [
    { name: "100-150.jpg", cardText: "100-150.jpg 800x800" }
  ]);

  assert.equal(plan.items[0].status, "review");
  assert.equal(plan.items[0].image.name, "100-150.jpg");
  assert.equal(plan.items[0].confidence, 0.7);
  assert.equal(plan.items[0].candidates[0].directSizeMatch, true);
  assert.ok(plan.items[0].flags.includes("图片颜色未识别"));
});

test("double-row SKUs prefer double-row images over same-size plain and triple-row images", () => {
  const plan = buildSinglePlan("【优质三防横版】50*20*5000张双排*30卷/箱", [
    { name: "50-20.jpg", cardText: "50-20.jpg 800x800" },
    { name: "三排50-20.jpg", cardText: "三排50-20.jpg 800x800" },
    { name: "双50-20.jpg", cardText: "双50-20.jpg 800x800" }
  ]);

  assertSingleAutoImage(plan, "双50-20.jpg");
  assert.match(plan.items[0].reason, /排版:双排/);
  assert.equal(plan.items[0].candidates[0].image.name, "双50-20.jpg");
});

test("triple-row SKUs prefer triple-row images over same-size plain and double-row images", () => {
  const plan = buildSinglePlan("【优质三防横版】50*20*7500张三排*30卷/箱", [
    { name: "双50-20.jpg", cardText: "双50-20.jpg 800x800" },
    { name: "50-20.jpg", cardText: "50-20.jpg 800x800" },
    { name: "三排50-20.jpg", cardText: "三排50-20.jpg 800x800" }
  ]);

  assertSingleAutoImage(plan, "三排50-20.jpg");
  assert.match(plan.items[0].reason, /排版:三排/);
  assert.equal(plan.items[0].candidates[0].image.name, "三排50-20.jpg");
});

test("size-key mode allows a triple-row SKU to reuse the only same-size double-row image", () => {
  const plan = buildSinglePlan("【高清三防横版】32*19*5000张三排*18卷/箱", [
    { name: "双32-19.jpg", cardText: "双32-19.jpg 800x800" }
  ]);

  assertSingleAutoImage(plan, "双32-19.jpg");
  assert.deepEqual(plan.items[0].image.sizes, ["32x19"]);
  assert.equal(plan.items[0].flags.includes("图片排版疑似不一致"), true);
});

test("size-key mode does not allow reversed dimensions", () => {
  const plan = buildSinglePlan("【高清三防横版】30*15*2000张*54卷/箱", [
    { name: "15-30.jpg", cardText: "15-30.jpg 800x800" }
  ]);

  assert.notEqual(plan.items[0].status, "auto");
});
