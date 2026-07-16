/* global chrome, importScripts, SimpleXlsx, SkuImageMatcher */
"use strict";

try {
  importScripts("lib/simple-xlsx.js");
} catch (error) {
  console.warn("SimpleXlsx 加载失败", error);
}

try {
  importScripts("lib/sku-image-matcher.js");
} catch (error) {
  console.warn("SkuImageMatcher 加载失败", error);
}

const DEFAULT_SKU_FILE = "file:///C:/Users/Administrator/Desktop/%E5%A4%A9%E7%8C%AB%E9%A1%B9%E7%9B%AE/%E5%A4%A7%E7%AE%B1%E4%BB%B7%E6%A0%BC.xlsx";
const ALLOWED_HOST = /(^|\.)((tmall|taobao|alibaba)\.com)$/i;
const DEFAULT_SKU_NAME = "大箱价格.xlsx";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CONTENT_MESSAGE_TYPE = "TMALL_AUTO_LISTING_V3";
const SKU_IMAGE_CONTENT_FILES = ["lib/sku-image-matcher.js", "sku-image-content.js"];
const SKU_IMAGE_CONTENT_MESSAGE_TYPE = "TMALL_SKU_IMAGE_FILL_V4";
const SKU_IMAGE_POPUP_MESSAGE_TYPE = "TMALL_SKU_IMAGE_FILL_POPUP";
const SKU_IMAGE_VERIFY_TIMEOUT_MS = 3200;
const SKU_IMAGE_VERIFY_POLL_MS = 200;
const SKU_IMAGE_MAX_RETRIES = 2;

async function configureSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("右侧面板打开行为配置失败", error);
  }
}

if (chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(configureSidePanelBehavior);
}
if (chrome.runtime?.onStartup?.addListener) {
  chrome.runtime.onStartup.addListener(configureSidePanelBehavior);
}
void configureSidePanelBehavior();

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" || ALLOWED_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendDebuggerCommand(tabId, method, params = {}) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (error) {
    if (!String(error.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }
  try {
    return await chrome.debugger.sendCommand(target, method, params);
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The tab may have navigated or the debugger may already be detached.
      }
    }
  }
}

function normalizeClickPoint(point) {
  return {
    x: Math.max(0, Number(point?.x || 0)),
    y: Math.max(0, Number(point?.y || 0))
  };
}

async function findChildFrameRect(tabId, parentFrameId, childFrameId) {
  const token = `tmall-frame-map-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let parentResultPromise;
  try {
    parentResultPromise = chrome.scripting.executeScript({
      target: { tabId, frameIds: [parentFrameId] },
      args: [token],
      func: (requestToken) => new Promise((resolve) => {
        const messageType = `__TMALL_FRAME_MAP__${requestToken}`;
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          resolve(value);
        };
        const onMessage = (event) => {
          if (event.data?.type !== messageType) return;
          const element = Array.from(document.querySelectorAll("iframe,frame"))
            .find((candidate) => candidate.contentWindow === event.source);
          if (!element) return;
          const rect = element.getBoundingClientRect();
          const offsetWidth = Math.max(1, Number(element.offsetWidth || rect.width || 1));
          const offsetHeight = Math.max(1, Number(element.offsetHeight || rect.height || 1));
          finish({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            clientLeft: Number(element.clientLeft || 0),
            clientTop: Number(element.clientTop || 0),
            scaleX: rect.width / offsetWidth,
            scaleY: rect.height / offsetHeight
          });
        };
        window.addEventListener("message", onMessage);
        setTimeout(() => finish(null), 1200);
      })
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [childFrameId] },
      args: [token],
      func: (requestToken) => {
        window.parent.postMessage({ type: `__TMALL_FRAME_MAP__${requestToken}` }, "*");
        return true;
      }
    });
    const [result] = await parentResultPromise;
    return result?.result || null;
  } catch {
    if (parentResultPromise) {
      try {
        await parentResultPromise;
      } catch {
        // The parent frame may have navigated while the child announced itself.
      }
    }
    return null;
  }
}

async function mapPointToTopFrame(tabId, frameId, point) {
  const mapped = normalizeClickPoint(point);
  if (!frameId) return { ok: true, mapped: false, point: mapped };

  const frames = await getFrames(tabId);
  let currentFrameId = frameId;
  for (let depth = 0; depth < 8 && currentFrameId; depth += 1) {
    const frame = frames.find((item) => item.frameId === currentFrameId);
    if (!frame || frame.parentFrameId == null || frame.parentFrameId < 0) {
      return { ok: false, reason: "frame-coordinate-unknown", point: mapped, frameId: currentFrameId };
    }
    const rect = await findChildFrameRect(tabId, frame.parentFrameId, currentFrameId);
    if (!rect) {
      return { ok: false, reason: "frame-rect-not-found", point: mapped, frameId: currentFrameId, frameUrl: frame.url };
    }
    mapped.x = Number(rect.left || 0) + (Number(rect.clientLeft || 0) + mapped.x) * Number(rect.scaleX || 1);
    mapped.y = Number(rect.top || 0) + (Number(rect.clientTop || 0) + mapped.y) * Number(rect.scaleY || 1);
    currentFrameId = frame.parentFrameId;
  }
  return { ok: true, mapped: true, point: normalizeClickPoint(mapped) };
}

async function trustedClick(tabId, point) {
  const { x, y } = normalizeClickPoint(point);
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (error) {
    if (!String(error.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The tab may have navigated or the debugger may already be detached.
      }
    }
  }
}

async function trustedReplaceText(tabId, text) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (error) {
    if (!String(error.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      modifiers: 2
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8
    });
    if (text) {
      await chrome.debugger.sendCommand(target, "Input.insertText", { text: String(text) });
    }
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The tab may have navigated or the debugger may already be detached.
      }
    }
  }
}

async function trustedPressKey(tabId, key) {
  const normalized = String(key || "Enter");
  const keyInfo = normalized === "Enter"
    ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }
    : { key: normalized, code: normalized, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
  } catch (error) {
    if (!String(error.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      ...keyInfo
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyInfo.nativeVirtualKeyCode
    });
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The tab may have navigated or the debugger may already be detached.
      }
    }
  }
}

async function ensureInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });
}

async function getFrames(tabId) {
  try {
    return await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return [{ frameId: 0, url: "" }];
  }
}

async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

async function collectFrameDiagnostics(tabId) {
  await ensureInjected(tabId);
  const frames = await getFrames(tabId);
  const diagnostics = [];
  for (const frame of frames) {
    if (frame.errorOccurred) continue;
    try {
      const result = await sendToFrame(tabId, frame.frameId, { type: "TMALL_AUTO_LISTING", action: "diagnose" });
      if (result) diagnostics.push({ frameId: frame.frameId, frameUrl: frame.url, ...result });
    } catch (error) {
      diagnostics.push({ frameId: frame.frameId, frameUrl: frame.url, ok: false, score: 0, error: error.message });
    }
  }
  diagnostics.sort((a, b) => (b.score || 0) - (a.score || 0));
  return diagnostics;
}

async function runOnBestFrame(tabId, action, payload = {}) {
  await ensureInjected(tabId);
  const diagnostics = await collectFrameDiagnostics(tabId);
  const best = diagnostics.find((item) => item.ok && (item.score || 0) > 0) || diagnostics[0];
  if (!best) {
    throw new Error("未找到可执行脚本的页面框架。");
  }
  const result = await sendToFrame(tabId, best.frameId, {
    type: CONTENT_MESSAGE_TYPE,
    action,
    payload,
    selectedFrame: best
  });
  return { selectedFrame: best, diagnostics, result };
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

async function readDefaultSku() {
  if (typeof SimpleXlsx === "undefined") throw new Error("Excel 解析器未加载。");
  const response = await fetch(DEFAULT_SKU_FILE);
  if (!response.ok) {
    throw new Error("无法读取默认 SKU 表，请确认 Chrome 已允许扩展访问 file:// 地址。");
  }
  const buffer = await response.arrayBuffer();
  const workbook = await SimpleXlsx.readWorkbook(buffer, DEFAULT_SKU_NAME);
  const first = workbook.sheets[0];
  const validation = SimpleXlsx.normalizeSkuRows(first.rows, first.name);
  const uploadBuffer = SimpleXlsx.createSkuUploadWorkbook(validation.rows);
  const upload = {
    name: DEFAULT_SKU_NAME,
    type: XLSX_MIME,
    lastModified: Date.now(),
    base64: arrayBufferToBase64(uploadBuffer)
  };
  await chrome.storage.local.set({
    tmallAutoListingSku: validation,
    tmallAutoListingSkuUpload: upload
  });
  return { sku: validation, skuUpload: upload };
}

function skuImageSameSizeMatch(skuName, image) {
  if (typeof SkuImageMatcher === "undefined") throw new Error("SKU 图片匹配器未加载。");
  const skuSizes = SkuImageMatcher.extractSizes(skuName || "");
  const imageSizes = SkuImageMatcher.describeImage(image || {}).sizes || [];
  if (!skuSizes.length || !imageSizes.length) return false;
  return skuSizes.some((size) => imageSizes.includes(size));
}

function skuImageAssetKey(url) {
  const text = String(url || "");
  const match = text.match(/\/([^/?#]+?\.(?:jpe?g|png|webp|gif|bmp))(?:[_?#]|$)/i);
  return (match?.[1] || "").toLowerCase();
}

function normalizeDialogSkuState(result) {
  if (!result?.ok) return null;
  return result.state || result;
}

function skuImageExpectedAssetKeys(image) {
  return [...new Set([image?.src, ...(image?.equivalentSources || [])]
    .map(skuImageAssetKey)
    .filter(Boolean))];
}

function dialogSkuHasExpectedImage(state, image) {
  if (!state?.filled) return false;
  const expectedKeys = skuImageExpectedAssetKeys(image);
  const actualKey = skuImageAssetKey(state.thumbnail);
  return Boolean(actualKey && expectedKeys.includes(actualKey));
}

function skuImageLogicalKey(image) {
  if (image?.logicalKey) return image.logicalKey;
  if (typeof SkuImageMatcher?.imageLogicalKey === "function") {
    return SkuImageMatcher.imageLogicalKey(image || {});
  }
  const name = String(image?.name || image?.cardText || "").toLowerCase();
  return `${name}|${(image?.sizes || []).join(",")}`;
}

function groupSkuImagePlanItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = skuImageLogicalKey(item.image);
    if (!groups.has(key)) groups.set(key, { key, image: item.image, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

async function waitForDialogSkuGroupFilled(tabId, frameId, items, payload = {}) {
  const timeoutMs = Math.max(1, Number(payload.verifyTimeoutMs || SKU_IMAGE_VERIFY_TIMEOUT_MS));
  const pollMs = Math.max(1, Number(payload.verifyPollMs || SKU_IMAGE_VERIFY_POLL_MS));
  const pollCount = Math.max(1, Math.ceil(timeoutMs / pollMs));
  let latest = [];
  for (let poll = 0; poll < pollCount; poll += 1) {
    const requests = (items || []).map((item) => ({ index: item.index, sku_name: item.sku_name }));
    const batchResponse = await sendToSkuImageFrame(tabId, frameId, "getDialogSkuStates", { items: requests });
    if (Array.isArray(batchResponse?.results)) {
      latest = (items || []).map((item, index) => {
        const response = batchResponse.results[index] || {};
        const state = normalizeDialogSkuState(response);
        return { item, state, ok: dialogSkuHasExpectedImage(state, item.image), reason: response?.reason || batchResponse.reason || "" };
      });
    } else {
      latest = [];
      for (const item of items || []) {
        const response = await sendToSkuImageFrame(tabId, frameId, "getDialogSkuState", {
          index: item.index,
          sku_name: item.sku_name
        });
        const state = normalizeDialogSkuState(response);
        latest.push({ item, state, ok: dialogSkuHasExpectedImage(state, item.image), reason: response?.reason || "" });
      }
    }
    if (latest.every((result) => result.ok)) {
      return { ok: true, results: latest, poll_count: poll + 1 };
    }
    if (poll + 1 < pollCount) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  return {
    ok: false,
    results: latest,
    poll_count: pollCount,
    reason: "图片点击已发出，但部分目标 SKU 缩略图未落地。"
  };
}

async function waitForDialogSkuFilled(tabId, frameId, item, payload = {}) {
  const timeoutMs = Math.max(1, Number(payload.verifyTimeoutMs || SKU_IMAGE_VERIFY_TIMEOUT_MS));
  const pollMs = Math.max(1, Number(payload.verifyPollMs || SKU_IMAGE_VERIFY_POLL_MS));
  const pollCount = Math.max(1, Math.ceil(timeoutMs / pollMs));
  let latestState = null;
  let latestReason = "";
  for (let poll = 0; poll < pollCount; poll += 1) {
    const response = await sendToSkuImageFrame(tabId, frameId, "getDialogSkuState", {
      index: item.index,
      sku_name: item.sku_name
    });
    latestState = normalizeDialogSkuState(response);
    latestReason = response?.reason || "";
    if (dialogSkuHasExpectedImage(latestState, item.image)) {
      return { ok: true, state: latestState, poll_count: poll + 1, reason: "" };
    }
    if (poll + 1 < pollCount) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  return {
    ok: false,
    state: latestState,
    poll_count: pollCount,
    reason: latestReason || "图片点击已发出，但目标 SKU 缩略图未落地。"
  };
}

function isAllowedSkuImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function ensureSkuImageInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: SKU_IMAGE_CONTENT_FILES
  });
}

async function sendToSkuImageFrame(tabId, frameId, action, payload) {
  return chrome.tabs.sendMessage(tabId, {
    type: SKU_IMAGE_CONTENT_MESSAGE_TYPE,
    action,
    payload
  }, { frameId });
}

async function collectSkuImageDiagnostics(tabId) {
  await ensureSkuImageInjected(tabId);
  const frames = await getFrames(tabId);
  const diagnostics = [];
  for (const frame of frames) {
    if (frame.errorOccurred) continue;
    try {
      const result = await sendToSkuImageFrame(tabId, frame.frameId, "diagnose", {});
      diagnostics.push({ frameId: frame.frameId, frameUrl: frame.url, ...result });
    } catch (error) {
      diagnostics.push({ frameId: frame.frameId, frameUrl: frame.url, ok: false, score: 0, error: error.message });
    }
  }
  diagnostics.sort((a, b) => (b.score || 0) - (a.score || 0));
  return diagnostics;
}

async function runSkuImageOnBestFrame(tabId, action, payload = {}) {
  const diagnostics = await collectSkuImageDiagnostics(tabId);
  const best = diagnostics.find((item) => item.ok && (item.score || 0) > 0) || diagnostics[0];
  if (!best) throw new Error("未找到可执行页面框架。");
  const result = await sendToSkuImageFrame(tabId, best.frameId, action, payload);
  return { selectedFrame: best, diagnostics, result };
}

function pickSkuImageDialogFrame(diagnostics) {
  return diagnostics.find((item) => item.ok && item.dialogFound && item.dialogSkuCount > 0) ||
    diagnostics.find((item) => item.ok && item.mainSkuCount > 0) ||
    diagnostics.find((item) => item.ok && (item.score || 0) > 0);
}

function pickOpenSkuImageDialogFrame(diagnostics) {
  return diagnostics.find((item) => item.ok && item.dialogFound && item.dialogSkuCount > 0);
}

function pickMainSkuImageFrame(diagnostics) {
  return diagnostics.find((item) => item.ok && item.mainSkuCount > 0);
}

async function ensureSkuImageDialogOpen(tabId, diagnostics, payload = {}) {
  const openFrame = pickOpenSkuImageDialogFrame(diagnostics);
  if (openFrame) return { diagnostics, dialogFrame: openFrame, openResult: { ok: true, alreadyOpen: true } };

  if (payload.openDialogFirst === false) {
    return { diagnostics, dialogFrame: null, openResult: { ok: false, skipped: true, reason: "已按参数跳过自动打开弹窗。" } };
  }

  const mainFrame = pickMainSkuImageFrame(diagnostics);
  if (!mainFrame) {
    return { diagnostics, dialogFrame: null, openResult: { ok: false, reason: "未识别到主表 SKU 搜索主图列，无法先点击第一张主图。" } };
  }

  const openResult = await sendToSkuImageFrame(tabId, mainFrame.frameId, "openFirstEmptyImageDialog", { preferFirst: true });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const nextDiagnostics = await collectSkuImageDiagnostics(tabId);
  return {
    diagnostics: nextDiagnostics,
    dialogFrame: pickOpenSkuImageDialogFrame(nextDiagnostics),
    openResult: {
      ...openResult,
      frameId: mainFrame.frameId,
      frameUrl: mainFrame.frameUrl
    }
  };
}

async function scanAllSkuImageFrames(tabId) {
  const frames = await getFrames(tabId);
  const results = [];
  for (const frame of frames) {
    if (frame.errorOccurred) continue;
    try {
      const result = await sendToSkuImageFrame(tabId, frame.frameId, "scanFrameImages", {});
      if (result?.image_count) results.push({ frameId: frame.frameId, frameUrl: frame.url, ...result });
    } catch {
      // Some frames are not injectable; the material frame that answers is enough.
    }
  }
  results.sort((a, b) => (b.mediaScore || 0) - (a.mediaScore || 0) ||
    (b.isMediaFrame === true) - (a.isMediaFrame === true) ||
    (b.image_count || 0) - (a.image_count || 0));
  return results;
}

function pickBestSkuImageFrame(imageFrames, dialogFrame) {
  return imageFrames.find((item) => item.isMediaFrame && (item.mediaScore || 0) >= 30) ||
    imageFrames.find((item) => item.frameId === dialogFrame.frameId && (item.mediaScore || 0) >= 30 && (item.image_count || 0) > 0) ||
    null;
}

function imageLooksLikeNamedMaterial(image) {
  const text = [
    image?.name,
    image?.cardText,
    image?.src,
    image?.path
  ].filter(Boolean).join(" ");
  return /\.(?:jpe?g|png|webp|gif|bmp)\b/i.test(text) && Array.isArray(image?.sizes) && image.sizes.length > 0 && !image.ambiguousSizes;
}

function imageListLooksLikeMaterial(images) {
  const list = Array.isArray(images) ? images : [];
  if (list.length < 3) return false;
  return list.filter(imageLooksLikeNamedMaterial).length >= 3;
}

async function scanSkuImageDialogWithFrameImages(tabId, payload = {}) {
  if (typeof SkuImageMatcher === "undefined") throw new Error("SKU 图片匹配器未加载。");
  let diagnostics = await collectSkuImageDiagnostics(tabId);
  const opened = await ensureSkuImageDialogOpen(tabId, diagnostics, payload);
  diagnostics = opened.diagnostics;
  const dialogFrame = opened.dialogFrame || pickSkuImageDialogFrame(diagnostics);
  if (!dialogFrame || !opened.dialogFrame) {
    const reason = opened.openResult?.reason || "未找到 SKU 搜索主图弹窗或发布页。";
    throw new Error(reason);
  }
  const dialogResult = await sendToSkuImageFrame(tabId, dialogFrame.frameId, "scanDialog", payload);
  const imageFrames = await scanAllSkuImageFrames(tabId);
  const dialogImages = dialogResult.imageCards || [];
  const dialogLooksLikeMaterial = Boolean(dialogResult.diagnostics?.dialogFound) && imageListLooksLikeMaterial(dialogImages);
  const selectedFrame = dialogLooksLikeMaterial
    ? { frameId: dialogFrame.frameId, frameUrl: dialogFrame.frameUrl, image_count: dialogImages.length, isMediaFrame: true, mediaScore: 100, source: "dialog" }
    : pickBestSkuImageFrame(imageFrames, dialogFrame);
  const frameImages = dialogLooksLikeMaterial ? dialogImages : (selectedFrame?.imageCards || selectedFrame?.imagePreview || []);
  const skuRows = dialogResult.skuRows || dialogResult.diagnostics?.dialogSkuPreview || [];
  const mergedPlan = SkuImageMatcher.buildMatchPlan(skuRows, frameImages, { minConfidence: payload.minConfidence || 0.78 });
  return {
    selectedFrame: dialogFrame,
    openResult: opened.openResult,
    selectedImageFrame: selectedFrame ? {
      frameId: selectedFrame.frameId,
      frameUrl: selectedFrame.frameUrl,
      image_count: selectedFrame.image_count,
      isMediaFrame: selectedFrame.isMediaFrame,
      mediaScore: selectedFrame.mediaScore,
      mediaReasons: selectedFrame.mediaReasons,
      source: selectedFrame.source || "frame"
    } : null,
    diagnostics,
    imageFrames: imageFrames.map((item) => ({
      frameId: item.frameId,
      frameUrl: item.frameUrl,
      image_count: item.image_count,
      isMediaFrame: item.isMediaFrame,
      mediaScore: item.mediaScore,
      mediaReasons: item.mediaReasons,
      preview_count: item.imagePreview?.length || 0,
      full_count: item.imageCards?.length || 0
    })),
    result: {
      ...dialogResult,
      plan: mergedPlan,
      frameImages,
      frameImageCount: frameImages.length,
      matchPreview: mergedPlan.items.slice(0, 120).map((item) => ({
        index: item.index,
        sku_name: item.sku_name,
        status: item.status,
        confidence: item.confidence,
        reason: item.reason,
        flags: item.flags,
        image: item.image ? {
          name: item.image.name || item.image.cardText || item.image.src,
          src: item.image.src,
          sizes: item.image.sizes,
          colors: item.image.colors,
          packages: item.image.packages,
          logicalKey: item.image.logicalKey,
          duplicateCount: item.image.duplicateCount,
          equivalentSources: item.image.equivalentSources
        } : null,
        candidates: (item.candidates || []).slice(0, 3).map((candidate) => ({
          confidence: candidate.confidence,
          reason: candidate.reason,
          directSizeMatch: candidate.directSizeMatch,
          flags: candidate.flags,
          image: candidate.image ? {
            name: candidate.image.name || candidate.image.cardText || candidate.image.src,
            src: candidate.image.src,
            sizes: candidate.image.sizes,
            colors: candidate.image.colors,
            packages: candidate.image.packages
          } : null
        }))
      }))
    }
  };
}

async function fillSkuImagesByFilenamePlan(tabId, payload = {}) {
  const scan = await scanSkuImageDialogWithFrameImages(tabId, payload);
  const imageFrame = scan.selectedImageFrame;
  if (!imageFrame) throw new Error("未识别到左侧素材图片 iframe，请先打开素材文件夹并等待图片加载。");
  const plan = scan.result.plan;
  if (!plan.items.length) throw new Error("未识别到右侧 SKU 行。");

  const maxRows = Math.max(1, Number(payload.maxRows || 999));
  const maxRetries = Math.max(1, Math.min(4, Number(payload.maxRetries || SKU_IMAGE_MAX_RETRIES)));
  const actions = [];
  const eligibleItems = [];
  for (const item of plan.items.slice(0, maxRows)) {
    if (item.status !== "auto" || !item.image) {
      actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: item.status || "missing" });
      continue;
    }
    if (!skuImageSameSizeMatch(item.sku_name, item.image)) {
      actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: "size-mismatch-guard" });
      continue;
    }
    eligibleItems.push(item);
  }

  const imageGroups = groupSkuImagePlanItems(eligibleItems);
  let imageClickCount = 0;
  let sequentialFallbackCount = 0;
  const sequentialMode = payload.groupMode !== true;
  if (sequentialMode) {
    const groupSizes = new Map(imageGroups.map((group) => [group.key, group.items.length]));
    sequentialFallbackCount = imageGroups.filter((group) => group.items.length > 1).length;
    for (const item of eligibleItems) {
      const rowPayload = { index: item.index, sku_name: item.sku_name };
      const beforeResponse = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogSkuState", rowPayload);
      const beforeState = normalizeDialogSkuState(beforeResponse);
      const groupSize = groupSizes.get(skuImageLogicalKey(item.image)) || 1;
      if (!beforeState) {
        actions.push({ index: item.index, sku_name: item.sku_name, failed: true, skipped: true, reason: beforeResponse?.reason || "sku-row-state-unavailable" });
        continue;
      }
      if (dialogSkuHasExpectedImage(beforeState, item.image)) {
        actions.push({
          index: item.index,
          sku_name: item.sku_name,
          skipped: true,
          alreadyFilled: true,
          idempotent: true,
          image: item.image.name || item.image.cardText || item.image.src,
          thumbnail: beforeState.thumbnail,
          group_size: groupSize,
          reason: "already-filled"
        });
        continue;
      }

      const sourceCandidates = [...new Set([item.image.src, ...(item.image.equivalentSources || [])].filter(Boolean))];
      let verifiedState = null;
      let failureReason = "fill-not-verified";
      let clickAttempts = 0;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const prepared = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "prepareDialogSku", {
          index: item.index,
          sku_name: item.sku_name,
          replaceFilled: Boolean(beforeState.filled),
          keepSelectedSkus: [item.sku_name]
        });
        if (!prepared?.ok) {
          failureReason = prepared?.reason || "sku-row-not-selected";
          continue;
        }
        const selectedResponse = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogSkuState", rowPayload);
        if (!normalizeDialogSkuState(selectedResponse)?.selected) {
          failureReason = selectedResponse?.reason || "sku-selection-lost-before-image-click";
          continue;
        }
        const imageClick = await sendToSkuImageFrame(tabId, imageFrame.frameId, "clickFrameImage", {
          src: sourceCandidates[(attempt - 1) % Math.max(1, sourceCandidates.length)] || item.image.src,
          name: item.image.name || item.image.cardText,
          path: item.image.path,
          expectedSizes: item.image.sizes || SkuImageMatcher.extractSizes(item.sku_name || "")
        });
        imageClickCount += 1;
        clickAttempts = attempt;
        if (!imageClick?.ok) {
          failureReason = imageClick?.reason || "image-not-found";
          await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelection", rowPayload);
          continue;
        }
        const verification = await waitForDialogSkuFilled(tabId, scan.selectedFrame.frameId, item, payload);
        if (verification.ok) {
          verifiedState = verification.state;
          failureReason = "";
          break;
        }
        failureReason = verification.reason || "fill-not-verified";
        await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelection", rowPayload);
      }

      if (verifiedState) {
        actions.push({
          index: item.index,
          sku_name: item.sku_name,
          filled: true,
          verified: true,
          image: item.image.name || item.image.cardText || item.image.src,
          thumbnail: verifiedState.thumbnail || "",
          click_attempts: clickAttempts,
          group_size: groupSize,
          shared_image: groupSize > 1,
          confidence: item.confidence,
          reason: item.reason
        });
      } else {
        await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelection", rowPayload);
        actions.push({
          index: item.index,
          sku_name: item.sku_name,
          failed: true,
          skipped: true,
          verified: false,
          click_attempts: clickAttempts,
          group_size: groupSize,
          shared_image: groupSize > 1,
          reason: failureReason
        });
      }
    }
  }

  if (!sequentialMode) {
  for (const group of imageGroups) {
    const pending = [];
    for (const item of group.items) {
      const rowPayload = { index: item.index, sku_name: item.sku_name };
      const beforeResponse = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogSkuState", rowPayload);
      const beforeState = normalizeDialogSkuState(beforeResponse);
      if (!beforeState) {
        actions.push({ index: item.index, sku_name: item.sku_name, failed: true, skipped: true, reason: beforeResponse?.reason || "sku-row-state-unavailable" });
        continue;
      }
      if (dialogSkuHasExpectedImage(beforeState, item.image)) {
        actions.push({
          index: item.index,
          sku_name: item.sku_name,
          skipped: true,
          alreadyFilled: true,
          idempotent: true,
          image: item.image.name || item.image.cardText || item.image.src,
          thumbnail: beforeState.thumbnail,
          group_size: group.items.length,
          reason: "already-filled"
        });
        continue;
      }
      pending.push({ item, beforeState });
    }
    if (!pending.length) continue;

    const verifiedStates = new Map();
    const failureReasons = new Map();
    let clickAttempts = 0;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const unresolved = pending.filter(({ item }) => !verifiedStates.has(item));
      if (!unresolved.length) break;
      const clearedSelections = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelectionsExcept", {
        keepSelectedSkus: []
      });
      if (!clearedSelections?.ok) {
        for (const entry of unresolved) {
          failureReasons.set(entry.item, clearedSelections?.reason || "sku-selection-reset-failed");
        }
        break;
      }
      const keepSelectedSkus = unresolved.map(({ item }) => item.sku_name);
      let prepared = [];
      for (const entry of unresolved) {
        const preparedResult = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "prepareDialogSku", {
          index: entry.item.index,
          sku_name: entry.item.sku_name,
          replaceFilled: Boolean(entry.beforeState.filled),
          keepSelectedSkus
        });
        if (preparedResult?.ok) {
          prepared.push(entry);
        } else {
          failureReasons.set(entry.item, preparedResult?.reason || "sku-row-not-selected");
        }
      }

      const batchCandidates = prepared.slice();
      if (batchCandidates.length) {
        const selectionCheck = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogSkuStates", {
          items: batchCandidates.map(({ item }) => ({ index: item.index, sku_name: item.sku_name }))
        });
        prepared = batchCandidates.filter((entry, index) => {
          const selected = Boolean(selectionCheck?.results?.[index]?.state?.selected);
          if (!selected) failureReasons.set(entry.item, selectionCheck?.results?.[index]?.reason || "sku-selection-lost-before-image-click");
          return selected;
        });
      }

      const sourceCandidates = [...new Set([group.image.src, ...(group.image.equivalentSources || [])].filter(Boolean))];
      const batchSelectionPreserved = batchCandidates.length === unresolved.length && prepared.length === batchCandidates.length;
      if (batchSelectionPreserved && prepared.length) {
        const imageClick = await sendToSkuImageFrame(tabId, imageFrame.frameId, "clickFrameImage", {
          src: sourceCandidates[(attempt - 1) % Math.max(1, sourceCandidates.length)] || group.image.src,
          name: group.image.name || group.image.cardText,
          path: group.image.path,
          expectedSizes: group.image.sizes || SkuImageMatcher.extractSizes(prepared[0].item.sku_name || "")
        });
        imageClickCount += 1;
        clickAttempts = attempt;
        if (imageClick?.ok) {
          const verification = await waitForDialogSkuGroupFilled(
            tabId,
            scan.selectedFrame.frameId,
            prepared.map(({ item }) => item),
            payload
          );
          for (const result of verification.results || []) {
            if (result.ok) {
              verifiedStates.set(result.item, result.state);
              failureReasons.delete(result.item);
            } else {
              failureReasons.set(result.item, verification.reason || result.reason || "fill-not-verified");
            }
          }
        } else {
          for (const entry of prepared) {
            failureReasons.set(entry.item, imageClick?.reason || "image-not-found");
          }
        }
      } else {
        sequentialFallbackCount += 1;
        for (let position = 0; position < unresolved.length; position += 1) {
          const entry = unresolved[position];
          const reset = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelectionsExcept", {
            keepSelectedSkus: []
          });
          if (!reset?.ok) {
            failureReasons.set(entry.item, reset?.reason || "sku-selection-reset-failed");
            continue;
          }
          const singlePrepared = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "prepareDialogSku", {
            index: entry.item.index,
            sku_name: entry.item.sku_name,
            replaceFilled: Boolean(entry.beforeState.filled),
            keepSelectedSkus: [entry.item.sku_name]
          });
          if (!singlePrepared?.ok) {
            failureReasons.set(entry.item, singlePrepared?.reason || "sku-row-not-selected");
            continue;
          }
          const singleSelection = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogSkuState", {
            index: entry.item.index,
            sku_name: entry.item.sku_name
          });
          if (!normalizeDialogSkuState(singleSelection)?.selected) {
            failureReasons.set(entry.item, singleSelection?.reason || "sku-selection-lost-before-image-click");
            continue;
          }
          const imageClick = await sendToSkuImageFrame(tabId, imageFrame.frameId, "clickFrameImage", {
            src: sourceCandidates[(attempt + position - 1) % Math.max(1, sourceCandidates.length)] || group.image.src,
            name: group.image.name || group.image.cardText,
            path: group.image.path,
            expectedSizes: group.image.sizes || SkuImageMatcher.extractSizes(entry.item.sku_name || "")
          });
          imageClickCount += 1;
          clickAttempts = attempt;
          if (!imageClick?.ok) {
            failureReasons.set(entry.item, imageClick?.reason || "image-not-found");
            continue;
          }
          const verification = await waitForDialogSkuGroupFilled(
            tabId,
            scan.selectedFrame.frameId,
            [entry.item],
            payload
          );
          const result = verification.results?.[0];
          if (result?.ok) {
            verifiedStates.set(entry.item, result.state);
            failureReasons.delete(entry.item);
          } else {
            failureReasons.set(entry.item, verification.reason || result?.reason || "fill-not-verified");
          }
        }
      }

      for (const entry of unresolved.filter(({ item }) => !verifiedStates.has(item))) {
        await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelection", {
          index: entry.item.index,
          sku_name: entry.item.sku_name
        });
      }
    }

    for (const entry of pending) {
      const state = verifiedStates.get(entry.item);
      if (state) {
        actions.push({
          index: entry.item.index,
          sku_name: entry.item.sku_name,
          filled: true,
          verified: true,
          image: entry.item.image.name || entry.item.image.cardText || entry.item.image.src,
          thumbnail: state.thumbnail || "",
          click_attempts: clickAttempts,
          group_size: group.items.length,
          shared_image: group.items.length > 1,
          confidence: entry.item.confidence,
          reason: entry.item.reason
        });
      } else {
        await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "clearDialogSkuSelection", {
          index: entry.item.index,
          sku_name: entry.item.sku_name
        });
        actions.push({
          index: entry.item.index,
          sku_name: entry.item.sku_name,
          failed: true,
          skipped: true,
          verified: false,
          click_attempts: clickAttempts,
          group_size: group.items.length,
          shared_image: group.items.length > 1,
          reason: failureReasons.get(entry.item) || "fill-not-verified"
        });
      }
    }
  }

  }

  const filledCount = actions.filter((item) => item.filled).length;
  const failedSkus = actions.filter((item) => item.failed).map((item) => item.sku_name);
  const verification_failed_count = failedSkus.length;
  const fillSummaryResponse = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "getDialogFillSummary", {});
  const fillSummary = fillSummaryResponse?.ok ? fillSummaryResponse : {
    ok: false,
    total_count: plan.items.length,
    filled_count: 0,
    missing_count: plan.items.length,
    selected_count: 0,
    reason: fillSummaryResponse?.reason || "无法读取最终 SKU 图片状态。"
  };
  const canConfirm =
    verification_failed_count === 0 &&
    fillSummary.missing_count === 0 &&
    fillSummary.selected_count === 0;
  let confirmResult = {
    ok: false,
    skipped: true,
    reason: canConfirm ? "已按参数跳过点击确定。" : `仍有 ${fillSummary.missing_count || 0} 个 SKU 未填图，已保留弹窗供检查。`
  };
  if (payload.confirmAfterFill !== false && canConfirm) {
    confirmResult = await sendToSkuImageFrame(tabId, scan.selectedFrame.frameId, "confirmDialog", {});
  }
  let after = scan;
  if (!confirmResult.ok) {
    try {
      after = await scanSkuImageDialogWithFrameImages(tabId, payload);
    } catch {
      // Keep the pre-confirm scan when the dialog becomes unavailable.
    }
  }
  return {
    ...scan,
    result: {
      ...after.result,
      ok: canConfirm && (payload.confirmAfterFill === false || confirmResult.ok),
      complete: canConfirm,
      filled_count: filledCount,
      skipped_count: actions.filter((item) => item.skipped).length,
      verification_failed_count,
      failed_skus: failedSkus,
      fill_summary: fillSummary,
      image_group_count: imageGroups.length,
      image_click_count: imageClickCount,
      sequential_fallback_count: sequentialFallbackCount,
      sequential_mode: sequentialMode,
      actions,
      confirmResult,
      finalActionClicked: confirmResult.ok
    }
  };
}

async function fillSkuImagesByVisibleOrder() {
  throw new Error("按当前可见顺序填充已禁用，请使用“按网页图片名尺寸填充”。");
}

async function handleSkuImagePopupMessage(message) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error("未找到当前 Chrome 标签页。");
  if (!isAllowedSkuImageUrl(tab.url || "")) {
    throw new Error("请先切换到已登录的天猫/淘宝商品发布页或素材选择弹窗。");
  }

  if (message.action === "pageStatus") {
    const diagnostics = await collectSkuImageDiagnostics(tab.id);
    return { ok: true, tab: { id: tab.id, title: tab.title, url: tab.url }, diagnostics };
  }

  let run;
  if (message.action === "scanDialog") {
    run = await scanSkuImageDialogWithFrameImages(tab.id, message.payload || {});
  } else if (message.action === "fillByPlan") {
    run = await fillSkuImagesByFilenamePlan(tab.id, message.payload || {});
  } else if (message.action === "fillByVisibleOrder") {
    run = await fillSkuImagesByVisibleOrder(tab.id, message.payload || {});
  } else {
    run = await runSkuImageOnBestFrame(tab.id, message.action, message.payload || {});
  }
  return { ok: true, ...run };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === SKU_IMAGE_POPUP_MESSAGE_TYPE) {
    handleSkuImagePopupMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "TMALL_AUTO_LISTING_DEBUG_CLICK") {
    (async () => {
      const tabId = _sender.tab?.id;
      if (!tabId) throw new Error("未找到当前标签页，无法执行可信点击。");
      const frameId = Number.isFinite(_sender.frameId) ? _sender.frameId : 0;
      const mapped = await mapPointToTopFrame(tabId, frameId, message.point);
      if (!mapped.ok) return { ok: false, error: mapped.reason, frameId, point: mapped.point };
      await trustedClick(tabId, mapped.point);
      return { ok: true, frameId, mapped: mapped.mapped, point: mapped.point };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "TMALL_AUTO_LISTING_DEBUG_REPLACE_TEXT") {
    (async () => {
      const tabId = _sender.tab?.id;
      if (!tabId) throw new Error("未找到当前标签页，无法执行可信输入。");
      await trustedReplaceText(tabId, message.text || "");
      return { ok: true };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "TMALL_AUTO_LISTING_DEBUG_PRESS_KEY") {
    (async () => {
      const tabId = _sender.tab?.id;
      if (!tabId) throw new Error("未找到当前标签页，无法执行可信按键。");
      await trustedPressKey(tabId, message.key || "Enter");
      return { ok: true };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (!message || message.type !== "TMALL_AUTO_LISTING_POPUP") return false;

  (async () => {
    if (message.action === "readDefaultSku") {
      return { ok: true, ...(await readDefaultSku()) };
    }

    if (message.action === "storeSku") {
      const storePayload = message.payload || {};
      await chrome.storage.local.set({
        tmallAutoListingSku: storePayload.sku || null,
        tmallAutoListingSkuUpload: storePayload.skuUpload || null
      });
      return { ok: true };
    }

    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("未找到当前 Chrome 标签页。");
    if (!isAllowedUrl(tab.url || "")) {
      throw new Error("请先切换到已登录的天猫/淘宝商品发布页面，再运行此扩展。");
    }

    if (message.action === "pageStatus") {
      const diagnostics = await collectFrameDiagnostics(tab.id);
      return { ok: true, tab: { id: tab.id, title: tab.title, url: tab.url }, diagnostics };
    }

    const stored = await chrome.storage.local.get(["tmallAutoListingSku", "tmallAutoListingSkuUpload"]);
    const payload = {
      ...(message.payload || {}),
      sku: message.payload?.sku || stored.tmallAutoListingSku || null,
      skuUpload: message.payload?.skuUpload || stored.tmallAutoListingSkuUpload || null
    };
    const run = await runOnBestFrame(tab.id, message.action, payload);
    if (run.result?.ok === false) {
      return {
        ok: false,
        ...run,
        error: run.result.error || run.result.note || run.result.reason || "执行未完成"
      };
    }
    return { ok: true, ...run };
  })()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
