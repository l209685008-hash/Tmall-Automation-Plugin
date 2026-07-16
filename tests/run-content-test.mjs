import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockPage = path.join(root, "tests", "mock-tmall-publish.html");
const contentScript = await readFile(path.join(root, "content.js"), "utf8");
const simpleXlsxScript = await readFile(path.join(root, "lib", "simple-xlsx.js"), "utf8");
const playwrightCandidates = [
  "playwright",
  "file:///C:/Users/Administrator/AppData/Local/OpenAI/Codex/runtimes/cua_node/1b23c930bdf84ed6/bin/node_modules/playwright/index.mjs",
  "file:///C:/Users/Administrator/AppData/Local/JetBrains/PyCharm2026.1/acp-agents/cortex-code/1.0.73/coco-1.0.73+180523.e6179a031de9-windows-amd64/node_modules/playwright/index.mjs"
];

let chromium;
let lastImportError;
for (const candidate of playwrightCandidates) {
  try {
    ({ chromium } = await import(candidate));
    break;
  } catch (error) {
    lastImportError = error;
  }
}
if (!chromium) {
  throw lastImportError || new Error("未找到 Playwright。");
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage();
await page.addInitScript(() => {
  window.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          window.chrome.runtime.onMessage._listener = listener;
        }
      },
      sendMessage: async (message) => {
        if (message?.type === "TMALL_AUTO_LISTING_DEBUG_CLICK") {
          const point = message.point || {};
          const target = document.elementFromPoint(point.x, point.y);
          if (!target) return { ok: false };
          const actionRoot = target.closest?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions],[class*=sendIcon],[class*=SendIcon]");
          const context = actionRoot?.closest?.(".searchExpandedWrapper-PBh1DQ,.sku-assistant,.sku,.sell-sku-table-wrapper-new");
          if (!actionRoot || !/价格取整|请输入指令|SKU助手|sendIcon|searchExpandedActions|send/i.test(`${actionRoot.className || ""} ${actionRoot.id || ""} ${actionRoot.getAttribute?.("alt") || ""} ${context?.textContent || ""}`)) {
            return { ok: false };
          }
          target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
          target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
          target.click();
          return { ok: true };
        }
        if (message?.type === "TMALL_AUTO_LISTING_DEBUG_REPLACE_TEXT") {
          const target = document.activeElement;
          if (!target || !("value" in target)) return { ok: false };
          target.value = message.text || "";
          target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          return { ok: true };
        }
        if (message?.type === "TMALL_AUTO_LISTING_DEBUG_PRESS_KEY") {
          const target = document.activeElement || document.body;
          target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, key: message.key || "Enter" }));
          target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true, key: message.key || "Enter" }));
          return { ok: true };
        }
        return { ok: false };
      }
    }
  };
});
await page.goto(`file:///${mockPage.replace(/\\/g, "/")}`);
await page.addScriptTag({ content: simpleXlsxScript });
await page.addScriptTag({ content: contentScript });

async function send(action, payload = {}) {
  return page.evaluate(
    ({ actionName, actionPayload }) =>
      new Promise((resolve) => {
        chrome.runtime.onMessage._listener(
          { type: "TMALL_AUTO_LISTING", action: actionName, payload: actionPayload },
          {},
          resolve
        );
      }),
    { actionName: action, actionPayload: payload }
  );
}

const diagnose = await send("diagnose");
const text = await send("fillText");
const attrs = await send("selectAttrs");
await page.evaluate(() => {
  const title = document.querySelector("#productTitle");
  title.value = "";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  title.dispatchEvent(new Event("change", { bubbles: true }));
});
const ensuredTitle = await send("ensureProductTitle");
const time = await send("setTime");
const sku = {
  ok: true,
  row_count: 2,
  valid_row_count: 2,
  warning_count: 1,
  rows: [
    { sku_name: "测试 A", price: 17.647, integer_price: 18, stock: 500, merchant_code: "A001", barcode: "" },
    { sku_name: "测试 B", price: 20, integer_price: 20, stock: 300, merchant_code: "B001", barcode: "" }
  ]
};

const partialSku = await page.evaluate(() =>
  SimpleXlsx.normalizeSkuRows(
    [
      ["颜色分类", "价格", "库存", "商家编码", "条形码"],
      ["有效规格", 10.4, 20, "OK001", ""],
      ["", "", "", "", "坏行信号"]
    ],
    "partial"
  )
);
if (!partialSku.ok || partialSku.valid_row_count !== 1 || partialSku.rows.length !== 1) {
  throw new Error(`SKU 部分有效行保留失败: ${JSON.stringify(partialSku)}`);
}

const longSku = await page.evaluate(() =>
  SimpleXlsx.normalizeSkuRows(
    [
      ["颜色分类", "价格", "库存", "商家编码", "条形码"],
      ["【高清三防横版】40*30*800张*5卷试用", 17.65, 500, "三防40*30*800张*5卷", ""]
    ],
    "long"
  )
);
if (longSku.rows[0].sku_display_name !== "40*30*800张*5卷试用") {
  throw new Error(`SKU 展示名未缩短: ${JSON.stringify(longSku.rows[0])}`);
}
if (longSku.rows[0].merchant_code !== "三防40*30*800张*5卷") {
  throw new Error(`商家编码不应被缩短: ${JSON.stringify(longSku.rows[0])}`);
}

const skuUpload = {
  name: "大箱价格.xlsx",
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  lastModified: Date.now(),
  base64: await page.evaluate((rows) => {
    const buffer = SimpleXlsx.createSkuUploadWorkbook(rows);
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }, sku.rows)
};

const applySku = await send("applySku", { sku, skuUpload });
const round = await send("roundPrices", { sku });
await page.evaluate(() => {
  const action = document.querySelector(".searchExpandedActions-yf2c_s");
  if (action) action.style.display = "none";
  for (const selector of [".price", "#realLikeA", "#realLikeC"]) {
    const input = document.querySelector(selector);
    if (!input) continue;
    input.value = selector === ".price" ? "17.647" : selector === "#realLikeA" ? "113.7" : "208.00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.querySelector("#skuAssistantStatus").textContent = "";
  window.__mockSkuAssistant.submitCount = 0;
});
const noSendRound = await send("roundPrices", { sku });
await page.evaluate(() => {
  const action = document.querySelector(".searchExpandedActions-yf2c_s");
  if (action) action.style.display = "";
});
const recoveryRound = await send("roundPrices", { sku });
const salesInfo = await send("fillSalesInfo", { sku });
const logisticsInfo = await send("fillLogisticsInfo", { sku });

await page.click("#publishButton");
await page.click("#saveButton");

const snapshot = await page.evaluate(() => ({
  productTitle: document.querySelector("#productTitle").value,
  guideTitle: document.querySelector("#guideTitle").value,
  sellingPoint: document.querySelector("#sellingPoint").value,
  manufacturer: document.querySelector("#manufacturer").value,
  brand: document.querySelector('[data-field="brand"] [role="combobox"]').textContent.trim(),
  material: document.querySelector('[data-field="material"] [role="combobox"]').textContent.trim(),
  applicable: Array.from(document.querySelectorAll('[data-field="applicableBrands"] [aria-selected="true"]')).map((item) => item.textContent.trim()),
  applicableText: document.querySelector('[data-field="applicableBrands"] [role="combobox"]').textContent.trim(),
  features: Array.from(document.querySelectorAll('[data-field="materialFeatures"] [aria-selected="true"]')).map((item) => item.textContent.trim()),
  featuresText: document.querySelector('[data-field="materialFeatures"] [role="combobox"]').textContent.trim(),
  paperType: document.querySelector('[data-field="paperType"] [role="combobox"]').textContent.trim(),
  time: document.querySelector('input[name="time"]:checked')?.value,
  skuPaste: document.querySelector("#skuPaste").value,
  uploadedFileName: document.querySelector("#uploadedFileName").textContent.trim(),
  upload: window.__mockUpload,
  skuAssistant: window.__mockSkuAssistant,
  price: document.querySelector(".price").value,
  realLikePrice: document.querySelector("#realLikeA").value,
  realLikeDecimalZeroPrice: document.querySelector("#realLikeC").value,
  realLikeStock: document.querySelector("#realLikeB").value,
  onePrice: document.querySelector("#onePrice").value,
  quantity: document.querySelector("#quantity").value,
  merchantCode: document.querySelector("#merchantCode").value,
  stockReduction: document.querySelector('input[name="stockReduction"]:checked')?.value,
  deliveryTime: document.querySelector('input[name="deliveryTime"]:checked')?.value,
  pickup: document.querySelector('input[name="pickup"]:checked')?.value,
  locationScope: document.querySelector('input[name="locationScope"]:checked')?.value,
  province: document.querySelector('[data-field="province"] [role="combobox"]').textContent.trim(),
  city: document.querySelector('[data-field="city"] [role="combobox"]').textContent.trim(),
  rebateRate: document.querySelector("#rebateRate").value,
  finalClicks: window.__mockFinalClicks,
  leftPreviewClicks: window.__mockLeftPreviewClicks
}));

const failures = [];
if (!diagnose.ok || diagnose.score <= 0) failures.push("诊断没有识别模拟发布页");
if (!text.ok) failures.push("文本字段填写失败");
if (!ensuredTitle.ok) failures.push(`商品标题二次确认失败: ${JSON.stringify(ensuredTitle)}`);
if (snapshot.productTitle !== "禹尚热敏标签纸打印纸整箱装") failures.push(`商品标题未填写: ${snapshot.productTitle}`);
if (!attrs.ok) failures.push(`下拉属性未全部完成: ${JSON.stringify(attrs.results)}`);
if (!time.ok) failures.push("上架时间未选择立刻上架");
if (!applySku.ok || !["uploaded-sku-file+round-prices", "uploaded-sku-file-and-confirmed+round-prices", "uploaded-sku-file-confirmed-and-added+round-prices", "recognized-sku-added+round-prices"].includes(applySku.mode)) failures.push(`SKU 上传模式不正确: ${JSON.stringify(applySku)}`);
if (!applySku.rounded?.submitted && !applySku.rounded?.completed) failures.push(`SKU 上传后未自动执行价格取整: ${JSON.stringify(applySku.rounded)}`);
if (/Enter/.test(applySku.rounded?.trigger || "")) failures.push(`SKU 上传后应点击右侧确认按钮，不应只按回车: ${JSON.stringify(applySku.rounded)}`);
if (!/任务完成|SKU修改成功/.test(applySku.rounded?.status || "")) failures.push(`SKU 上传后未等到任务完成状态: ${JSON.stringify(applySku.rounded)}`);
if (applySku.rounded?.directRounded) failures.push(`SKU 上传后不应把兜底改价当作成功: ${JSON.stringify(applySku.rounded)}`);
if (snapshot.uploadedFileName !== "大箱价格.xlsx") failures.push(`页面未收到上传文件: ${snapshot.uploadedFileName || "<empty>"}`);
if (!snapshot.upload.changeCount && !snapshot.upload.dropCount) failures.push("SKU 文件未触发上传 input/change 或 drop 事件");
if (!snapshot.upload.files?.[0]?.size || snapshot.upload.files[0].size <= 64) failures.push(`上传文件不是生成后的 xlsx: ${JSON.stringify(snapshot.upload.files)}`);
if (!snapshot.upload.confirmCount) failures.push("SKU 文件上传后未点击确认识别");
if (!snapshot.upload.addCount) failures.push("SKU 识别后未点击在当前规格后添加");
if (!round.ok || snapshot.price !== "18") failures.push("价格取整失败");
if (snapshot.realLikePrice !== "114") failures.push(`真实结构价格未取整: ${snapshot.realLikePrice}`);
if (snapshot.realLikeDecimalZeroPrice !== "208") failures.push(`真实结构 .00 价格未去小数: ${snapshot.realLikeDecimalZeroPrice}`);
if (round.remainingDecimals !== 0) failures.push(`价格取整后仍有小数输入: ${round.remainingDecimals}`);
if (!/任务完成|SKU修改成功/.test(round.status || "")) failures.push(`价格取整未等到任务完成状态: ${JSON.stringify(round)}`);
if (round.directRounded) failures.push(`价格取整不应把兜底改价当作成功: ${JSON.stringify(round)}`);
if (noSendRound.ok) failures.push(`No-send strict case should fail instead of using direct price edits or Enter: ${JSON.stringify(noSendRound)}`);
if (/Enter/.test(noSendRound.trigger || "")) failures.push(`No-send strict case should not use Enter fallback: ${JSON.stringify(noSendRound)}`);
if (!recoveryRound.ok || /Enter/.test(recoveryRound.trigger || "")) failures.push(`Recovery round should click the right-side send button and succeed: ${JSON.stringify(recoveryRound)}`);
if (snapshot.realLikeStock !== "501") failures.push(`真实结构库存被错误修改: ${snapshot.realLikeStock}`);
if (snapshot.skuAssistant.value !== "价格取整") failures.push(`SKU助手未填写价格取整: ${snapshot.skuAssistant.value || "<empty>"}`);
if (!snapshot.skuAssistant.inputCount || !snapshot.skuAssistant.changeCount) failures.push("SKU助手输入框未触发 input/change");
if (!snapshot.skuAssistant.submitCount) failures.push("SKU助手价格取整指令未执行");
if (!salesInfo.ok) failures.push(`销售信息未完成: ${JSON.stringify(salesInfo.results)}`);
if (!logisticsInfo.ok) failures.push(`物流售后未完成: ${JSON.stringify(logisticsInfo.results)}`);
if (snapshot.onePrice !== "18") failures.push(`一口价未填写首个 SKU 整数价: ${snapshot.onePrice}`);
if (snapshot.quantity !== "500") failures.push(`商品数量未填写首个 SKU 库存: ${snapshot.quantity}`);
if (snapshot.merchantCode !== "A001") failures.push(`商家编码未填写首个 SKU 编码: ${snapshot.merchantCode}`);
if (snapshot.stockReduction !== "付款减库存") failures.push("库存扣减方式未选择付款减库存");
if (snapshot.deliveryTime !== "48小时") failures.push("发货时间未选择48小时");
if (snapshot.pickup !== "邮寄") failures.push("提取方式未选择邮寄");
if (snapshot.locationScope !== "大陆及港澳台") failures.push("所在地范围未选择大陆及港澳台");
if (snapshot.province !== "浙江") failures.push(`所在地省份未选浙江: ${snapshot.province}`);
if (snapshot.city !== "金华") failures.push(`所在地城市未选金华: ${snapshot.city}`);
if (snapshot.rebateRate !== "0.1") failures.push(`返点比例未填写0.1: ${snapshot.rebateRate}`);
if (snapshot.brand !== "禹尚") failures.push("品牌未选中禹尚");
if (snapshot.material !== "热敏纸") failures.push("材质未选中热敏纸");
if (snapshot.paperType !== "方型") failures.push("纸张版型未选中方型");
for (const value of ["GODEx", "启锐", "快麦", "HPRT/汉印", "佳博", "ZEBRA/斑马", "科诚", "GPRINTER", "GODEX", "Deli/得力", "brother/兄弟", "Argox/立象科技"]) {
  if (!snapshot.applicable.includes(value) && !snapshot.applicableText.includes(value)) failures.push(`适用品牌缺少 ${value}`);
}
for (const value of ["打印清晰", "粘性强", "防水", "防油", "防刮", "三防"]) {
  if (!snapshot.features.includes(value) && !snapshot.featuresText.includes(value)) failures.push(`材质特性缺少 ${value}`);
}
if (snapshot.finalClicks !== 0) failures.push("最终发布/保存按钮保护失败");
if (snapshot.leftPreviewClicks !== 0) failures.push("左侧应用示例图片不应被点击");

await browser.close();

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, snapshot, diagnose, text, attrs, time, applySku, round, noSendRound, recoveryRound, salesInfo, logisticsInfo }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, snapshot, diagnoseScore: diagnose.score, applySku, round, noSendRound, recoveryRound, salesInfo, logisticsInfo }, null, 2));
