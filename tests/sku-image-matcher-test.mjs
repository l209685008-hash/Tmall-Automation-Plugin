import assert from "node:assert/strict";
import matcher from "../lib/sku-image-matcher.js";

const skus = [
  {
    row: 2,
    sku_name: "【优质三防横版】40*30*800张*5卷试用",
    merchant_code: "三防40*30*800张*5卷"
  },
  {
    row: 3,
    sku_name: "【优质三防横版】60*40*800张*3卷试用",
    merchant_code: "三防60*40*800张*3卷"
  }
];

const images = [
  {
    name: "40x30mm 800张 5卷 三防热敏标签纸",
    cardText: "40x30mm 800张/卷 5卷 试用 三防"
  },
  {
    name: "60x40mm 800张 3卷 三防热敏标签纸",
    cardText: "60x40mm 800张/卷 3卷 试用 三防"
  }
];

const plan = matcher.buildMatchPlan(skus, images, { minConfidence: 0.45 });

assert.equal(plan.sku_count, 2);
assert.equal(plan.image_count, 2);
assert.equal(plan.items[0].image.name, images[0].name);
assert.equal(plan.items[1].image.name, images[1].name);
assert.ok(plan.items[0].confidence >= 0.45);
assert.ok(plan.items[1].confidence >= 0.45);

assert.deepEqual(matcher.extractSizes("双30-15.jpg"), ["30x15"]);
assert.deepEqual(matcher.extractSizes("30-15"), ["30x15"]);

const reusablePlan = matcher.buildMatchPlan([
  { row: 4, sku_name: "【优质三防横版】30*15*2000张*120卷/箱" },
  { row: 5, sku_name: "【优质三防横版】30*15*1000张*60卷/箱" }
], [
  { name: "双30-15.jpg", cardText: "双30-15.jpg 800x800" }
], { minConfidence: 0.78 });

assert.equal(reusablePlan.items[0].status, "auto");
assert.equal(reusablePlan.items[1].status, "auto");
assert.equal(reusablePlan.items[0].image.name, "双30-15.jpg");
assert.equal(reusablePlan.items[1].image.name, "双30-15.jpg");

const reversed = matcher.buildMatchPlan([
  { row: 6, sku_name: "【优质三防横版】30*15*2000张*120卷/箱" }
], [
  { name: "15-30.jpg" }
], { minConfidence: 0.78 });

assert.notEqual(reversed.items[0].status, "auto");
assert.ok(reversed.items[0].flags.includes("图片尺寸顺序与SKU相反"));

const duplicateSizePlan = matcher.buildMatchPlan([
  { row: 7, sku_name: "【优质三防横版】50*20*1500张*80卷/箱" }
], [
  { name: "双50-20.jpg", cardText: "双50-20.jpg" },
  { name: "50-20.jpg", cardText: "50-20.jpg" }
], { minConfidence: 0.78 });

assert.equal(duplicateSizePlan.items[0].status, "auto");
assert.equal(duplicateSizePlan.ambiguous_count, 0);
assert.equal(duplicateSizePlan.items[0].image.name, "50-20.jpg");

const lanePlan = matcher.buildMatchPlan([
  { row: 7, sku_name: "【优质三防横版】50*20*5000张双排*30卷/箱" }
], [
  { name: "50-20.jpg", cardText: "50-20.jpg" },
  { name: "双50-20.jpg", cardText: "双50-20.jpg" }
], { minConfidence: 0.78 });

assert.equal(lanePlan.items[0].status, "auto");
assert.equal(lanePlan.items[0].image.name, "双50-20.jpg");

const seventyFortyPlan = matcher.buildMatchPlan([
  { row: 8, sku_name: "【优质三防横版】70*40*1200张*36卷/箱" }
], [
  { name: "70-40.jpg", cardText: "70-40.jpg 800x800" },
  { name: "70-30.jpg", cardText: "70-30.jpg 800x800" }
], { minConfidence: 0.78 });

assert.equal(seventyFortyPlan.items[0].status, "auto");
assert.equal(seventyFortyPlan.items[0].image.name, "70-40.jpg");

const pixelSizePlan = matcher.buildMatchPlan([
  { row: 9, sku_name: "【优质三防横版】50*30*1000张*80卷/箱" }
], [
  { name: "50-20.jpg", cardText: "50-20.jpg 800x800" },
  { name: "50-30.jpg", cardText: "50-30.jpg 800x800" }
], { minConfidence: 0.78 });

assert.equal(pixelSizePlan.items[0].status, "auto");
assert.equal(pixelSizePlan.items[0].image.name, "50-30.jpg");
assert.deepEqual(matcher.describeImage({ name: "50-20.jpg", cardText: "50-20.jpg 800x800" }).sizes, ["50x20"]);
assert.deepEqual(matcher.describeImage({ name: "800x800", cardText: "50-30.jpg 800x800" }).sizes, ["50x30"]);
assert.deepEqual(matcher.describeImage({ name: "800x800", cardText: "800x800" }).sizes, []);

const mixedCard = matcher.describeImage({
  name: "50-20.jpg 50-30.jpg",
  cardText: "50-20.jpg 800x800 50-30.jpg 800x800"
});
assert.equal(mixedCard.ambiguousSizes, true);
assert.deepEqual(mixedCard.sizes, []);

const ambiguousCardPlan = matcher.buildMatchPlan([
  { row: 10, sku_name: "【优质三防横版】50*30*1000张*80卷/箱" }
], [
  { name: "50-20.jpg 50-30.jpg", cardText: "50-20.jpg 800x800 50-30.jpg 800x800" }
], { minConfidence: 0.78 });
assert.notEqual(ambiguousCardPlan.items[0].status, "auto");

const colorPlan = matcher.buildMatchPlan([
  { row: 11, sku_name: "【优质三防竖版】100*150*350张蓝底*24卷/箱" }
], [
  { name: "100-150白.jpg", cardText: "100-150白.jpg 800x800" },
  { name: "100-150蓝.jpg", cardText: "100-150蓝.jpg 800x800" }
], { minConfidence: 0.78 });
assert.equal(colorPlan.items[0].status, "auto");
assert.equal(colorPlan.items[0].image.name, "100-150蓝.jpg");

const missingColorPlan = matcher.buildMatchPlan([
  { row: 12, sku_name: "【优质三防竖版】100*150*350张蓝底*24卷/箱" }
], [
  { name: "100-150.jpg", cardText: "100-150.jpg 800x800" }
], { minConfidence: 0.78 });
assert.notEqual(missingColorPlan.items[0].status, "auto");

const manyImages = Array.from({ length: 95 }, (_, index) => ({
  name: index === 94 ? "55-33.jpg" : `${index + 1}-1.jpg`,
  cardText: index === 94 ? "55-33.jpg 800x800" : `${index + 1}-1.jpg 800x800`
}));
const deepImagePlan = matcher.buildMatchPlan([
  { row: 13, sku_name: "【优质三防横版】55*33*1000张*80卷/箱" }
], manyImages, { minConfidence: 0.78 });
assert.equal(deepImagePlan.items[0].status, "auto");
assert.equal(deepImagePlan.items[0].image.name, "55-33.jpg");

console.log(JSON.stringify({ ok: true, plan, reusablePlan, reversed, duplicateSizePlan, lanePlan, seventyFortyPlan, pixelSizePlan, colorPlan, missingColorPlan, deepImagePlan }, null, 2));
