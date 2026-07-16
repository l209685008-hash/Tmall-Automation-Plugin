/* global chrome, SimpleXlsx */
"use strict";

const state = {
  sku: null,
  skuUpload: null,
  busy: false,
  skuImagePagePlan: null,
  skuImageDiagnostics: null
};

const PANEL_SETTINGS_KEY = "tmallAutoListingPanelSettings";
let statusRefreshTimer = 0;

const elements = {
  pageStatus: document.getElementById("pageStatus"),
  skuFile: document.getElementById("skuFile"),
  skuStatus: document.getElementById("skuStatus"),
  skuImagePagePlanStatus: document.getElementById("skuImagePagePlanStatus"),
  skuImageConfidence: document.getElementById("skuImageConfidence"),
  skuImageConfidenceValue: document.getElementById("skuImageConfidenceValue"),
  skuImageMaxRows: document.getElementById("skuImageMaxRows"),
  log: document.getElementById("log")
};

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button,input").forEach((element) => {
    element.disabled = busy || element.dataset.permanentDisabled === "true";
  });
}

function schedulePanelStatusRefresh(delay = 160) {
  clearTimeout(statusRefreshTimer);
  statusRefreshTimer = setTimeout(() => {
    if (state.busy) return;
    void Promise.all([refreshPageStatus(), refreshSkuImagePageStatus()]);
  }, delay);
}

function log(message, tone = "") {
  const li = document.createElement("li");
  li.textContent = message;
  if (tone) li.className = tone;
  elements.log.prepend(li);
}

function summarizeSku(sku) {
  if (!sku) return "尚未导入 SKU 表。";
  const errors = sku.errors?.length || 0;
  const warnings = sku.warning_count || 0;
  return `${sku.sheet || "Sheet1"}: ${sku.valid_row_count || 0}/${sku.row_count || 0} 行有效，错误 ${errors}，警告 ${warnings}。价格将使用整数列。`;
}

function setSku(sku) {
  state.sku = sku;
  elements.skuStatus.textContent = summarizeSku(sku);
  elements.skuStatus.className = `status ${sku?.ok ? (sku.warning_count ? "warn" : "ok") : "bad"}`;
}

function describeRun(result) {
  if (!result) return "无返回结果。";
  if (result.error) return result.error;
  if (result.reason) return result.reason;
  if (result.ok === false || result.rounded?.ok === false) {
    const failed = result.rounded?.ok === false ? result.rounded : result;
    return [
      failed.note || failed.error || failed.reason || "执行未完成",
      failed.status ? `状态: ${failed.status}` : "",
      Number.isFinite(failed.remainingDecimals) ? `剩余小数价格: ${failed.remainingDecimals}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (result.results) {
    return result.results
      .map((item) => {
        if (item.ok) return `${item.label}: 完成`;
        if (item.missing?.length) return `${item.label}: 缺少 ${item.missing.join("、")}`;
        return `${item.label}: ${item.reason || "未完成"}`;
      })
      .join("\n");
  }
  if (result.steps) {
    return result.steps
      .map((step) => `${step.action}: ${step.result?.ok === false ? "未完成" : "完成"}`)
      .join("\n");
  }
  if (result.row_count) return `SKU: ${result.row_count} 行，${result.note || result.mode || "完成"}`;
  if (result.command) return `${result.command}: 完成`;
  if (result.note) return result.note;
  if (Array.isArray(result.fields)) {
    const present = result.fields.filter((item) => item.present).length;
    return `页面诊断: ${present}/${result.fields.length} 个字段可见，SKU 信号 ${result.skuSignals?.length || 0} 个。`;
  }
  return JSON.stringify(result, null, 2);
}

async function send(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_POPUP", action, payload });
}

async function sendSkuImage(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: "TMALL_SKU_IMAGE_FILL_POPUP", action, payload });
}

function setStatus(element, text, tone = "") {
  element.textContent = text;
  element.className = `status ${tone}`.trim();
}

function skuImageMinConfidence() {
  return Number(elements.skuImageConfidence.value || 0.78);
}

function skuImageMaxRows() {
  return Math.max(1, Number(elements.skuImageMaxRows.value || 79));
}

function summarizeSkuImagePlan(plan) {
  if (!plan) return "尚未生成网页素材匹配方案。";
  const logicalText = plan.logical_image_count != null
    ? `（逻辑素材 ${plan.logical_image_count}，同名重复 ${plan.duplicate_image_count || 0}）`
    : "";
  return `SKU ${plan.sku_count}，网页素材图 ${plan.image_count}${logicalText}，自动 ${plan.auto_count}，复核 ${plan.review_count}，冲突 ${plan.ambiguous_count}，缺图 ${plan.missing_count}`;
}

function updateSkuImagePageState(result) {
  if (result?.plan) {
    state.skuImagePagePlan = result.plan;
    if (result.matchPreview) state.skuImagePagePlan.matchPreview = result.matchPreview;
    setStatus(elements.skuImagePagePlanStatus, summarizeSkuImagePlan(result.plan), result.plan.ok ? "ok" : "warn");
  }
  if (result?.diagnostics) {
    state.skuImageDiagnostics = result.diagnostics;
  }
}

async function refreshSkuImagePageStatus() {
  try {
    const response = await sendSkuImage("pageStatus");
    if (!response?.ok) throw new Error(response?.error || "无法读取当前页面");
    const best = (response.diagnostics || [])[0];
    if (!best) {
      setStatus(elements.skuImagePagePlanStatus, "未检测到可执行页面。", "warn");
      return;
    }
    state.skuImageDiagnostics = response.diagnostics || [];
    const frameImages = (response.diagnostics || []).reduce((sum, item) => sum + (item.frameImageCount || 0), 0);
    setStatus(
      elements.skuImagePagePlanStatus,
      `主表SKU ${best.mainSkuCount || 0}，已填图 ${best.mainFilledImageCount || 0}，弹窗SKU ${best.dialogSkuCount || 0}，网页素材图 ${best.dialogImageCount || frameImages || 0}`,
      best.dialogSkuCount || best.mainSkuCount ? "ok" : "warn"
    );
  } catch (error) {
    setStatus(elements.skuImagePagePlanStatus, error.message || "请切换到天猫/淘宝发布页。", "warn");
  }
}

async function runSkuImageAction(action, label, payload = {}) {
  if (state.busy) return;
  setBusy(true);
  log(`${label}：开始执行，请保持当前商品页和填充弹窗打开。`);
  try {
    const response = await sendSkuImage(action, { minConfidence: skuImageMinConfidence(), maxRows: skuImageMaxRows(), ...payload });
    if (!response?.ok) throw new Error(response?.error || "执行失败");
    const result = response.result || response;
    updateSkuImagePageState(result);
    if (result.openedFrom) {
      log(`${label}：已从第 ${result.openedFrom.index + 1} 行打开，${result.reason || "完成"}`, result.ok ? "ok" : "warn");
    } else if (result.filled_count != null) {
      const confirmText = result.confirmResult?.ok ? "，已点击确定" : result.confirmResult?.reason ? `，确定未点击：${result.confirmResult.reason}` : "";
      const missingText = result.fill_summary?.missing_count ? `，仍缺 ${result.fill_summary.missing_count}` : "";
      const failedText = result.verification_failed_count ? `，落地失败 ${result.verification_failed_count}（${(result.failed_skus || []).slice(0, 3).join("、")}）` : "";
      const groupText = result.image_group_count != null ? `，素材分组 ${result.image_group_count}，实际点击 ${result.image_click_count || 0}` : "";
      log(
        `${label}：本次验证填充 ${result.filled_count}，跳过 ${result.skipped_count || 0}${groupText}${missingText}${failedText}${confirmText}`,
        result.complete && result.confirmResult?.ok !== false ? "ok" : "warn"
      );
    } else if (result.plan) {
      log(`${label}：${summarizeSkuImagePlan(result.plan)}`, result.plan.ok ? "ok" : "warn");
    } else {
      log(`${label}：完成`, "ok");
    }
    await refreshSkuImagePageStatus();
  } catch (error) {
    log(`${label}：${error.message || String(error)}`, "bad");
  } finally {
    setBusy(false);
    schedulePanelStatusRefresh();
  }
}

async function copySkuImagePlan() {
  const payload = {
    diagnostics: state.skuImageDiagnostics,
    pagePlan: state.skuImagePagePlan
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
}

async function run(action, label, payload = {}) {
  if (state.busy) return;
  setBusy(true);
  try {
    const response = await send(action, {
      ...payload,
      sku: state.sku,
      skuUpload: payload.skuUpload || state.skuUpload
    });
    const selected = response.selectedFrame ? `框架 ${response.selectedFrame.frameId}` : "";
    const result = response?.result || response;
    if (!response?.ok || result?.ok === false) {
      log(`${label}${selected ? ` (${selected})` : ""}\n${describeRun(result)}`, "bad");
      return;
    }
    log(`${label}${selected ? ` (${selected})` : ""}\n${describeRun(result)}`, "ok");
  } catch (error) {
    log(`${label}\n${error.message || String(error)}`, "bad");
  } finally {
    setBusy(false);
    schedulePanelStatusRefresh();
  }
}

async function refreshPageStatus() {
  try {
    const response = await send("pageStatus");
    if (!response?.ok) throw new Error(response?.error || "无法读取页面");
    const best = (response.diagnostics || [])[0];
    const title = response.tab?.title || "";
    if (!best) {
      elements.pageStatus.textContent = title ? `当前页: ${title}` : "未检测到可执行页面。";
      return;
    }
    const fieldHits = best.fields?.filter((item) => item.present).length || 0;
    elements.pageStatus.textContent = `当前页: ${title || best.title || "已连接"}，字段 ${fieldHits}/${best.fields?.length || 0}`;
  } catch (error) {
    elements.pageStatus.textContent = error.message || "请切换到已登录的天猫/淘宝发布页。";
  }
}

async function readSkuFile(file) {
  const workbook = await SimpleXlsx.readWorkbook(file);
  const sheet = workbook.sheets[0];
  return SimpleXlsx.normalizeSkuRows(sheet.rows, sheet.name);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

document.getElementById("loadDefault").addEventListener("click", async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    const response = await send("readDefaultSku");
    if (!response?.ok) throw new Error(response?.error || "默认表读取失败");
    setSku(response.sku);
    state.skuUpload = response.skuUpload || null;
    log(`默认 SKU 表已读取\n${summarizeSku(response.sku)}`, response.sku.ok ? "ok" : "bad");
  } catch (error) {
    log(`读取默认表失败\n${error.message || String(error)}\n可改用文件选择器导入。`, "bad");
  } finally {
    setBusy(false);
  }
});

document.getElementById("clearSku").addEventListener("click", async () => {
  setSku(null);
  state.skuUpload = null;
  await send("storeSku", { sku: null });
  log("SKU 数据已清空。");
});

elements.skuFile.addEventListener("change", async () => {
  const file = elements.skuFile.files?.[0];
  if (!file) return;
  setBusy(true);
  try {
    const sku = await readSkuFile(file);
    const uploadBuffer = SimpleXlsx.createSkuUploadWorkbook(sku.rows);
    const uploadName = (file.name || "sku.xlsx").replace(/\.(csv|txt|xlsm|xls)$/i, ".xlsx");
    state.skuUpload = {
      name: /\.xlsx$/i.test(uploadName) ? uploadName : `${uploadName}.xlsx`,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      lastModified: file.lastModified || Date.now(),
      base64: arrayBufferToBase64(uploadBuffer)
    };
    setSku(sku);
    await send("storeSku", { sku, skuUpload: state.skuUpload });
    log(`SKU 表已导入\n${summarizeSku(sku)}`, sku.ok ? "ok" : "bad");
  } catch (error) {
    state.skuUpload = null;
    log(`SKU 表解析失败\n${error.message || String(error)}`, "bad");
  } finally {
    setBusy(false);
  }
});

elements.skuImageConfidence.addEventListener("input", () => {
  elements.skuImageConfidenceValue.textContent = skuImageMinConfidence().toFixed(2);
  void persistPanelSettings();
});

elements.skuImageMaxRows.addEventListener("change", () => {
  void persistPanelSettings();
});

document.getElementById("diagnose").addEventListener("click", () => run("pageStatus", "诊断页面"));
document.getElementById("fillText").addEventListener("click", () => run("fillText", "填写文本信息"));
document.getElementById("selectAttrs").addEventListener("click", () => run("selectAttrs", "选择下拉属性"));
document.getElementById("setTime").addEventListener("click", () => run("setTime", "上架时间：立刻上架"));
document.getElementById("applySku").addEventListener("click", () => run("applySku", "导入/填充 SKU", { skuUpload: state.skuUpload }));
document.getElementById("roundPrices").addEventListener("click", () => run("roundPrices", "SKU助手：价格取整"));
document.getElementById("fillSalesInfo").addEventListener("click", () => run("fillSalesInfo", "填写销售信息"));
document.getElementById("fillLogisticsInfo").addEventListener("click", () => run("fillLogisticsInfo", "填写物流售后"));
document.getElementById("runPrepare").addEventListener("click", () => run("runPrepare", "全流程准备", { skuUpload: state.skuUpload }));

document.getElementById("skuImageDiagnosePage").addEventListener("click", () => runSkuImageAction("pageStatus", "SKU图片：诊断当前页"));
document.getElementById("skuImageOpenDialog").addEventListener("click", () => runSkuImageAction("openFirstEmptyImageDialog", "SKU图片：打开填充弹窗"));
document.getElementById("skuImageScanPage").addEventListener("click", () => runSkuImageAction("scanDialog", "SKU图片：扫描网页素材"));
document.getElementById("skuImageFillPage").addEventListener("click", () => runSkuImageAction("fillByPlan", "SKU图片：按图片名尺寸填充", { confirmAfterFill: false }));
document.getElementById("skuImageFillOrder").addEventListener("click", () => {
  log("SKU图片：按当前可见顺序填充已禁用，请使用图片名尺寸匹配。", "warn");
});
document.getElementById("skuImageCopyPlan").addEventListener("click", async () => {
  try {
    await copySkuImagePlan();
    log("SKU图片：诊断/匹配方案已复制。", "ok");
  } catch (error) {
    log(`SKU图片：复制诊断失败：${error.message || String(error)}`, "bad");
  }
});

async function persistPanelSettings() {
  try {
    await chrome.storage.local.set({
      [PANEL_SETTINGS_KEY]: {
        skuImageMaxRows: skuImageMaxRows(),
        skuImageConfidence: skuImageMinConfidence()
      }
    });
  } catch {
    // The controls remain usable even when settings persistence is unavailable.
  }
}

async function restorePanelState() {
  try {
    const stored = await chrome.storage.local.get([
      "tmallAutoListingSku",
      "tmallAutoListingSkuUpload",
      PANEL_SETTINGS_KEY
    ]);
    if (stored.tmallAutoListingSku) setSku(stored.tmallAutoListingSku);
    state.skuUpload = stored.tmallAutoListingSkuUpload || null;
    const settings = stored[PANEL_SETTINGS_KEY] || {};
    if (Number.isFinite(Number(settings.skuImageMaxRows))) {
      elements.skuImageMaxRows.value = String(Math.max(1, Number(settings.skuImageMaxRows)));
    }
    if (Number.isFinite(Number(settings.skuImageConfidence))) {
      elements.skuImageConfidence.value = String(Number(settings.skuImageConfidence));
      elements.skuImageConfidenceValue.textContent = skuImageMinConfidence().toFixed(2);
    }
  } catch {
    // A fresh panel can continue without restored state.
  }
}

async function initPanel() {
  await restorePanelState();
  await Promise.all([refreshPageStatus(), refreshSkuImagePageStatus()]);
}

if (chrome.tabs?.onActivated?.addListener) {
  chrome.tabs.onActivated.addListener(() => schedulePanelStatusRefresh());
}
if (chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url) schedulePanelStatusRefresh();
  });
}
if (chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.tmallAutoListingSku) setSku(changes.tmallAutoListingSku.newValue || null);
    if (changes.tmallAutoListingSkuUpload) state.skuUpload = changes.tmallAutoListingSkuUpload.newValue || null;
  });
}

window.addEventListener("focus", () => schedulePanelStatusRefresh(0));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") schedulePanelStatusRefresh(0);
});

void initPanel();
