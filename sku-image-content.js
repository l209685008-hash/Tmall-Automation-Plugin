/* global chrome, SkuImageMatcher */
(() => {
  "use strict";

  const VERSION = "2026-07-14-verified-sequential-fill-v20";
  window.__tmallSkuImageFillVersion = VERSION;

  const MESSAGE_TYPE = "TMALL_SKU_IMAGE_FILL_V4";
  if (window.__tmallSkuImageFillListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__tmallSkuImageFillListener);
    } catch {
      // Best effort cleanup for reinjection while the Tmall page stays open.
    }
  }
  if (window.__tmallSkuImageFinalGuardHandler) {
    try {
      document.removeEventListener("click", window.__tmallSkuImageFinalGuardHandler, true);
    } catch {
      // Older injected pages may not expose the handler; a page refresh clears those.
    }
    window.__tmallSkuImageFinalGuardHandler = null;
  }
  window.__tmallSkuImageFinalGuardInstalled = false;

  const BLOCKED_ACTIONS = ["保存并发布", "确认发布", "立即上架", "正式发布", "放入仓库", "提交", "发布", "保存"];
  const LOCAL_UPLOAD_RE = /本地上传|上传图片|上传文件|从本地|从电脑|电脑上传|点击上传|upload/i;
  const SKU_TEXT_RE = /【[^】]+】|\d{1,4}\s*[*x×]\s*\d{1,4}/;
  const SKU_WORD_RE = /张|卷|箱|试用|三防|热敏|不干胶|面单|折叠|横版|竖版|方形|方型|白底|蓝底/;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function norm(value) {
    return String(value == null ? "" : value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function textOf(element) {
    if (!element) return "";
    if ("value" in element && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return norm(element.value);
    return norm([
      element.innerText,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("alt")
    ].filter(Boolean).join(" "));
  }

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 7) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      const classes = String(current.className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      if (classes) part += `.${classes}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function queryVisible(root, selector) {
    return Array.from((root || document).querySelectorAll(selector)).filter(visible);
  }

  function isFinalAction(element) {
    const text = textOf(element);
    return BLOCKED_ACTIONS.some((action) => text.includes(action));
  }

  function clickableAncestor(element) {
    return element?.closest?.("button,a,label,[role=button],input[type=button],input[type=submit],input[type=file]") || element;
  }

  function localFileInputFor(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.matches?.("input[type='file']")) return element;
    const label = element.closest?.("label");
    if (label) {
      const direct = label.querySelector?.("input[type='file']");
      if (direct) return direct;
      const id = label.getAttribute("for");
      if (id) {
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
        const byFor = document.querySelector(`input[type='file']#${escaped}`);
        if (byFor) return byFor;
      }
    }
    return element.querySelector?.("input[type='file']") || null;
  }

  function isUnsafeClickTarget(element) {
    return Boolean(localFileInputFor(element));
  }

  function isLocalUploadAction(element) {
    const target = clickableAncestor(element);
    if (!target || target === document.body || target === document.documentElement) return false;
    return LOCAL_UPLOAD_RE.test(textOf(target));
  }

  function safeClick(element) {
    if (!element) return { ok: false, reason: "click-target-missing" };
    const target = clickableAncestor(element);
    if (isFinalAction(target) || isFinalAction(element)) return { ok: false, reason: "blocked-final-action" };
    if (isUnsafeClickTarget(target) || isUnsafeClickTarget(element)) return { ok: false, reason: "blocked-local-file-upload" };
    if (isLocalUploadAction(target) || isLocalUploadAction(element)) return { ok: false, reason: "blocked-local-upload-action" };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    target.click();
    return { ok: true, reason: "", targetPath: elementPath(target) };
  }

  async function trustedClick(element, options = {}) {
    if (!element) return { ok: false, reason: "click-target-missing" };
    const target = clickableAncestor(element);
    if (isFinalAction(target) || isFinalAction(element)) return { ok: false, reason: "blocked-final-action" };
    if (isUnsafeClickTarget(target) || isUnsafeClickTarget(element)) return { ok: false, reason: "blocked-local-file-upload" };
    if (isLocalUploadAction(target) || isLocalUploadAction(element)) return { ok: false, reason: "blocked-local-upload-action" };
    target.scrollIntoView({ block: "center", inline: "center" });
    await sleep(80);
    const rect = target.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    const hasExtensionRuntime = Boolean(typeof chrome !== "undefined" && chrome.runtime?.id);
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_DEBUG_CLICK", point });
        if (response?.ok) return { ok: true, reason: "", targetPath: elementPath(target), trusted: true, point };
        if (hasExtensionRuntime && options.allowSyntheticFallback) {
          const fallback = safeClick(target);
          return {
            ...fallback,
            trusted: false,
            fallback: true,
            trustedFailure: response?.error || response?.reason || "trusted-click-failed",
            point
          };
        }
        if (hasExtensionRuntime) {
          return {
            ok: false,
            reason: response?.error || response?.reason || "trusted-click-failed",
            targetPath: elementPath(target),
            trusted: false,
            point
          };
        }
      }
    } catch (error) {
      if (hasExtensionRuntime && options.allowSyntheticFallback) {
        const fallback = safeClick(target);
        return {
          ...fallback,
          trusted: false,
          fallback: true,
          trustedFailure: error.message || String(error),
          point
        };
      }
      if (hasExtensionRuntime) {
        return { ok: false, reason: error.message || String(error), targetPath: elementPath(target), trusted: false, point };
      }
    }
    return { ...safeClick(target), trusted: false, point };
  }

  function installFinalButtonGuard() {
    if (window.__tmallSkuImageFinalGuardInstalled) return;
    window.__tmallSkuImageFinalGuardInstalled = true;
    window.__tmallSkuImageFinalGuardHandler = (event) => {
      const target = event.target?.closest?.("button,a,[role=button],input[type=button],input[type=submit]");
      if (target && isFinalAction(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", window.__tmallSkuImageFinalGuardHandler, true);
  }

  function clickElement(element) {
    return safeClick(element).ok;
  }

  function isConfirmText(text) {
    const compacted = norm(text).replace(/\s+/g, "");
    return /^(确定)+$/.test(compacted);
  }

  function looksLikeSkuText(text) {
    return SKU_TEXT_RE.test(text) && SKU_WORD_RE.test(text);
  }

  function fileNamesFromText(value) {
    const text = ` ${String(value == null ? "" : value)} `;
    return [...new Set([...text.matchAll(/(?:^|[\s/\\])([^/\\\s]+?\.(?:jpe?g|png|webp|gif|bmp))\b/gi)].map((match) => match[1]))];
  }

  function sizesOverlap(left = [], right = []) {
    const rightSet = new Set(right);
    return left.some((size) => rightSet.has(size));
  }

  function sameSkuName(left, right) {
    return norm(left) === norm(right);
  }

  function sameSizeMatch(skuName, image) {
    const skuSizes = SkuImageMatcher.extractSizes(skuName || "");
    const imageSizes = SkuImageMatcher.describeImage(image || {}).sizes || [];
    return Boolean(skuSizes.length && imageSizes.length && sizesOverlap(skuSizes, imageSizes));
  }

  function imageIdentity(image) {
    const name = norm(image?.name || image?.cardText || "");
    const src = norm(image?.src || "");
    const sizes = (image?.sizes || []).join(",");
    return src || `${name}|${sizes}`;
  }

  function findSkuRowByIdentity(rows, index, skuName) {
    const targetName = norm(skuName);
    return rows.find((item) => Number.isFinite(index) && item.index === index && (!targetName || sameSkuName(item.sku_name, targetName))) ||
      rows.find((item) => targetName && sameSkuName(item.sku_name, targetName));
  }

  function findImageByIdentityAndSize(images, wantedImage, skuName) {
    const expectedSizes = SkuImageMatcher.extractSizes(skuName || "");
    const candidates = [
      images.find((card) => wantedImage?.src && card.src === wantedImage.src),
      images.find((card) => {
        const wantedName = wantedImage?.name || wantedImage?.cardText;
        return wantedName && (card.name === wantedName || card.cardText === wantedName);
      })
    ].filter(Boolean);
    return candidates.find((card) => !card.ambiguousSizes && (!expectedSizes.length || sizesOverlap(expectedSizes, card.sizes || [])));
  }

  function canScroll(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || !visible(element)) return false;
    const style = getComputedStyle(element);
    const scrollableY = /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`) && element.scrollHeight > element.clientHeight + 40;
    return scrollableY && element.clientHeight >= 80;
  }

  function scrollContainers(root, scope = "any") {
    const base = root && root !== document.body ? root : document.scrollingElement || document.documentElement;
    const elements = [base, ...Array.from((root || document).querySelectorAll("div,section,main,aside,ul,ol,table,tbody"))]
      .filter((element, index, list) => element && list.indexOf(element) === index && canScroll(element));
    return elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = textOf(element);
        let score = Math.min(30, element.scrollHeight / 80) + Math.min(20, (rect.width * rect.height) / 40000);
        if (scope === "images" && queryVisible(element, "img").length >= 2) score += 30;
        if (scope === "skus" && looksLikeSkuText(text)) score += 30;
        if (scope === "skus" && /选择SKU图填充|SKU搜索主图|小箱/i.test(text)) score += 20;
        if (scope === "images" && /全部素材|图片空间|素材|小箱|主图/i.test(text)) score += 20;
        return { element, score };
      })
      .filter((item) => item.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.element);
  }

  function mergeByKey(target, items, keyFn) {
    let added = 0;
    for (const item of items || []) {
      const key = keyFn(item);
      if (!key || target.has(key)) continue;
      target.set(key, item);
      added += 1;
    }
    return added;
  }

  async function scanWithScroll(root, scope, collect, options = {}) {
    const maxSteps = Math.max(2, Math.min(80, Number(options.maxScrollSteps || 30)));
    const settleMs = Math.max(40, Math.min(400, Number(options.settleMs || 120)));
    const containers = scrollContainers(root || document.body, scope);
    const seen = new Map();
    const keyFn = scope === "skus"
      ? (item) => norm(item.sku_name || item.rowText)
      : (item) => imageIdentity(item);

    mergeByKey(seen, collect(), keyFn);
    for (const container of containers) {
      const originalTop = container.scrollTop;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const stepSize = Math.max(120, Math.floor(container.clientHeight * 0.82));
      let stableTurns = 0;
      container.scrollTop = 0;
      await sleep(settleMs);
      mergeByKey(seen, collect(), keyFn);
      for (let step = 0; step < maxSteps && container.scrollTop < maxTop - 4; step += 1) {
        const before = seen.size;
        container.scrollTop = Math.min(maxTop, container.scrollTop + stepSize);
        await sleep(settleMs);
        mergeByKey(seen, collect(), keyFn);
        stableTurns = seen.size === before ? stableTurns + 1 : 0;
        if (stableTurns >= 3 && container.scrollTop >= maxTop - stepSize) break;
      }
      container.scrollTop = Math.min(originalTop, Math.max(0, container.scrollHeight - container.clientHeight));
      await sleep(20);
    }
    return [...seen.values()];
  }

  async function findWithScroll(root, scope, collect, predicate, options = {}) {
    const maxSteps = Math.max(2, Math.min(80, Number(options.maxScrollSteps || 36)));
    const settleMs = Math.max(40, Math.min(400, Number(options.settleMs || 120)));
    const scanCurrent = () => (collect() || []).find(predicate) || null;
    const initial = scanCurrent();
    if (initial) return initial;
    for (const container of scrollContainers(root || document.body, scope)) {
      const originalTop = container.scrollTop;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const stepSize = Math.max(120, Math.floor(container.clientHeight * 0.82));
      container.scrollTop = 0;
      await sleep(settleMs);
      let found = scanCurrent();
      if (found) return found;
      let stableTurns = 0;
      let lastTop = container.scrollTop;
      for (let step = 0; step < maxSteps && container.scrollTop < maxTop - 4; step += 1) {
        container.scrollTop = Math.min(maxTop, container.scrollTop + stepSize);
        await sleep(settleMs);
        found = scanCurrent();
        if (found) return found;
        stableTurns = container.scrollTop === lastTop ? stableTurns + 1 : 0;
        lastTop = container.scrollTop;
        if (stableTurns >= 2) break;
      }
      container.scrollTop = Math.min(originalTop, Math.max(0, container.scrollHeight - container.clientHeight));
      await sleep(20);
    }
    return null;
  }

  function isMediaSelectorFrame() {
    return mediaSelectorScore(collectFrameImages()).score >= 30;
  }

  function mediaSelectorScore(imageCards = []) {
    const text = textOf(document.body);
    const href = location.href;
    const reasons = [];
    let score = 0;
    if (/sucai|material|media|crs-qn|qn\.taobao|wangpu/i.test(href)) {
      score += 35;
      reasons.push("素材URL");
    }
    if (/请输入文件夹名称|图片空间|全部素材|选择SKU图填充|666SKU|小箱|主图|彩色热敏|彩色铜版|折叠|智能背景图/.test(text)) {
      score += 30;
      reasons.push("素材文案");
    }
    const namedImages = imageCards.filter((image) => /\.(jpe?g|png|webp|gif|bmp)\b/i.test(`${image.name || ""} ${image.cardText || ""}`));
    if (namedImages.length >= 3) {
      score += 25;
      reasons.push("图片文件名");
    }
    const sizedImages = imageCards.filter((image) => image.sizes?.length);
    if (sizedImages.length >= 3) {
      score += 20;
      reasons.push("尺寸文件名");
    }
    if (imageCards.length >= 6) {
      score += 10;
      reasons.push("图片数量");
    }
    return { score, reasons };
  }

  function findMainSkuTable() {
    return Array.from(document.querySelectorAll("table"))
      .filter(visible)
      .map((table) => {
        const text = textOf(table);
        let score = 0;
        if (text.includes("SKU搜索主图")) score += 30;
        if (text.includes("颜色分类")) score += 15;
        if (text.includes("商家编码")) score += 10;
        if (queryVisible(table, "button,[role=button]").some((button) => textOf(button) === "去填写")) score += 5;
        const rows = queryVisible(table, "tr").filter((row) => looksLikeSkuText(textOf(row)));
        if (rows.length >= 3 && queryVisible(table, "img").length) score += 18;
        if (rows.length >= 3 && queryVisible(table, "button,[role=button],a").some((button) => /去填写|查看|删除/.test(textOf(button)))) score += 18;
        return { table, score };
      })
      .filter((item) => item.score > 15)
      .sort((a, b) => b.score - a.score)[0]?.table || null;
  }

  function findImageCellClickTarget(cell) {
    const candidates = queryVisible(cell, "button,[role=button],label,img,svg,div,span")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        let score = 0;
        const text = textOf(element);
        const classText = String(element.className || "");
        if (isUnsafeClickTarget(element)) score -= 100;
        if (/empty-container|skuImagesHocContainer|main-content|material-item|material|upload-trigger/i.test(classText)) score += 18;
        if (/图片|主图|搜索主图|image|pic|photo/i.test(`${text} ${classText}`)) score += 8;
        if (element.tagName === "IMG") score += 6;
        if (rect.width >= 20 && rect.width <= 80 && rect.height >= 20 && rect.height <= 80) score += 12;
        if (rect.left < cell.getBoundingClientRect().left + 80) score += 2;
        return { element, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.element || cell;
  }

  function collectMainSkuRows() {
    const table = findMainSkuTable();
    if (!table) return [];
    return queryVisible(table, "tr")
      .map((row, index) => {
        const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
        if (cells.length < 2) return null;
        const skuCell = cells[1];
        const imageCell = cells[0];
        const skuName = textOf(skuCell);
        if (!looksLikeSkuText(skuName)) return null;
        const images = queryVisible(imageCell, "img").filter((img) => (img.currentSrc || img.src || "").startsWith("http"));
        const filled = images.length > 0;
        const target = findImageCellClickTarget(imageCell);
        return {
          index,
          element: row,
          imageCell,
          target,
          filled,
          imageSrc: images[0]?.currentSrc || images[0]?.src || "",
          sku_name: skuName,
          rowText: textOf(row),
          rect: rectOf(row),
          targetPath: elementPath(target)
        };
      })
      .filter(Boolean);
  }

  function dialogScore(element) {
    const text = textOf(element);
    let score = 0;
    if (text.includes("批量填充SKU搜索主图")) score += 60;
    if (text.includes("选择SKU图填充")) score += 35;
    if (text.includes("选中右侧SKU后")) score += 30;
    if (text.includes("SKU搜索主图")) score += 20;
    if (text.includes("小箱sku") || text.includes("小箱SKU")) score += 15;
    if (text.includes("全部素材") || text.includes("图片空间") || text.includes("素材")) score += 8;
    if (queryVisible(element, "img").length) score += 5;
    return score;
  }

  function findGenericSkuImageDialog() {
    return queryVisible(document, "div,section,main")
      .filter((element) => element !== document.body && element !== document.documentElement)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = textOf(element);
        const score = dialogScore(element);
        const hasConfirm = queryVisible(element, "button,[role=button],a,input[type=button],input[type=submit]").some((button) => isConfirmText(textOf(button)));
        const looksLikeDialog = text.includes("批量填充SKU搜索主图") && text.includes("选择SKU图填充") && hasConfirm;
        return { element, score: looksLikeDialog ? score + 50 : score, area: rect.width * rect.height, rect };
      })
      .filter((item) => item.score >= 90 && item.area >= 160000 && item.rect.width >= 520 && item.rect.height >= 260)
      .sort((a, b) => b.score - a.score || b.area - a.area)[0]?.element || null;
  }

  function findSkuImageDialog() {
    const selectors = [
      "[role=dialog]",
      ".next-dialog",
      ".next-dialog-wrapper",
      ".next-overlay-wrapper",
      ".ant-modal",
      ".semi-modal",
      ".el-dialog",
      ".next-dialog-container",
      ".next-dialog-body",
      ".next-overlay-inner",
      ".modal",
      ".dialog",
      ".drawer"
    ].join(",");
    const candidates = queryVisible(document, selectors)
      .map((element) => ({ element, score: dialogScore(element), area: element.getBoundingClientRect().width * element.getBoundingClientRect().height }))
      .filter((item) => item.score >= 25)
      .sort((a, b) => b.score - a.score || b.area - a.area);
    if (candidates[0]) return candidates[0].element;
    const generic = findGenericSkuImageDialog();
    if (generic) return generic;
    const bodyText = textOf(document.body);
    return /批量填充SKU搜索主图/.test(bodyText) && /选择SKU图填充/.test(bodyText) && dialogScore(document.body) >= 115 ? document.body : null;
  }

  function closestCard(img, dialog) {
    const imgRect = img.getBoundingClientRect();
    let fallback = img.parentElement || img;
    let current = img.parentElement || img;
    for (let depth = 0; current && current !== dialog && depth < 7; depth += 1, current = current.parentElement) {
      const rect = current.getBoundingClientRect();
      const imgCount = queryVisible(current, "img").length;
      const fileCount = fileNamesFromText(textOf(current)).length;
      if (imgCount <= 1 && fileCount <= 1 && rect.width >= imgRect.width && rect.height >= imgRect.height) {
        fallback = current;
        if (/\.(jpe?g|png|webp|gif|bmp)\b/i.test(textOf(current))) return current;
        if (rect.width > imgRect.width + 8 || rect.height > imgRect.height + 20) return current;
      }
    }
    return fallback;
  }

  function collectDialogImages(dialog) {
    if (!dialog) return [];
    const dialogRect = dialog.getBoundingClientRect();
    const leftLimit = dialog === document.body ? window.innerWidth * 0.68 : dialogRect.left + dialogRect.width * 0.72;
    const seen = new Set();
    return queryVisible(dialog, "img")
      .map((img) => {
        const rect = img.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) return null;
        if (rect.left > leftLimit) return null;
        const card = closestCard(img, dialog);
        const key = img.currentSrc || img.src || elementPath(card);
        if (seen.has(key)) return null;
        seen.add(key);
        const cardText = textOf(card);
        const image = SkuImageMatcher.describeImage({
          name: norm(img.getAttribute("alt") || img.getAttribute("title") || cardText),
          alt: img.getAttribute("alt") || "",
          title: img.getAttribute("title") || "",
          cardText,
          src: img.currentSrc || img.src || "",
          path: elementPath(card)
        });
        return {
          element: card,
          img,
          rect: rectOf(img),
          ...image
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  }

  function imageNameFromCard(card, img) {
    const attributeTexts = [
      img?.getAttribute?.("alt"),
      img?.getAttribute?.("title"),
    ].filter(Boolean).map(norm);
    const attributeFile = attributeTexts
      .map((text) => fileNamesFromText(text)[0])
      .find(Boolean);
    if (attributeFile) return attributeFile;

    const titleFile = fileNamesFromText(card?.getAttribute?.("title") || "")[0];
    if (titleFile) return titleFile;

    const cardFiles = fileNamesFromText(textOf(card));
    if (cardFiles.length === 1) return cardFiles[0];
    return attributeTexts.find(Boolean) || "";
  }

  function backgroundUrlOf(element) {
    const value = getComputedStyle(element).backgroundImage || "";
    const match = value.match(/url\((["']?)(.*?)\1\)/i);
    return match?.[2] || "";
  }

  function sourceForImageElement(element) {
    if (element.tagName === "IMG") return element.currentSrc || element.src || "";
    return backgroundUrlOf(element);
  }

  function collectFrameImages() {
    const seen = new Set();
    const cards = queryVisible(document, "img,[style*='background'],[class*='image'],[class*='img'],[class*='pic'],[class*='photo'],[class*='material']")
      .map((imageElement) => {
        const rect = imageElement.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) return null;
        const src = sourceForImageElement(imageElement);
        if (imageElement.tagName !== "IMG" && !src) return null;
        const card = closestCard(imageElement, document.body);
        const name = imageNameFromCard(card, imageElement);
        const key = src || `${name}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
        if (!key || seen.has(key)) return null;
        seen.add(key);
        const image = SkuImageMatcher.describeImage({
          name,
          alt: imageElement.getAttribute("alt") || "",
          title: imageElement.getAttribute("title") || card.getAttribute?.("title") || "",
          cardText: textOf(card),
          src,
          path: elementPath(card)
        });
        return {
          element: card,
          img: imageElement.tagName === "IMG" ? imageElement : null,
          target: card,
          rect: rectOf(imageElement),
          ...image
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    return cards;
  }

  function rightPanelStart(dialog) {
    const dialogRect = dialog.getBoundingClientRect();
    const marker = queryVisible(dialog, "div,section,aside,span")
      .map((element) => ({ element, text: textOf(element), rect: element.getBoundingClientRect() }))
      .filter((item) => item.text.includes("选择SKU图填充") && item.rect.width > 120)
      .sort((a, b) => a.rect.left - b.rect.left)[0];
    if (marker) return Math.max(dialogRect.left, marker.rect.left - 24);
    return dialog === document.body ? window.innerWidth * 0.68 : dialogRect.left + dialogRect.width * 0.70;
  }

  function rowContainerFor(element, dialog, rightStart) {
    let current = element;
    for (let depth = 0; current && current !== dialog && depth < 8; depth += 1, current = current.parentElement) {
      const rect = current.getBoundingClientRect();
      if (rect.left >= rightStart - 40 && rect.width >= 140 && rect.height >= 34 && rect.height <= 160) return current;
    }
    return element;
  }

  function cleanSkuName(text) {
    const matches = norm(text).match(/【[^】]+】[^【]+?(?=(?:【[^】]+】|$))/g);
    const candidate = matches?.find((item) => looksLikeSkuText(item)) || text;
    return norm(candidate)
      .replace(/选择SKU图填充\s*\d+\s*\/\s*\d+/g, " ")
      .replace(/已填充|未填充|删除|替换|查看/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findDialogSkuClickTarget(row) {
    const rowRect = row.getBoundingClientRect();
    const candidates = queryVisible(row, "img,button,[role=button],label,div,span")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = textOf(element);
        const classText = String(element.className || "");
        let score = 0;
        if (isUnsafeClickTarget(element)) score -= 100;
        if (/图片|主图|替换|image|pic|photo/i.test(`${text} ${classText}`)) score += 8;
        if (rect.left >= rowRect.right - 90 && rect.width >= 20 && rect.width <= 70 && rect.height >= 20 && rect.height <= 70) score += 12;
        if (element.tagName === "IMG") score += 5;
        return { element, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.element || row;
  }

  function dialogSkuVisualState(row) {
    const container = row?.querySelector?.(".sku-image-container") ||
      row?.querySelector?.("[class*=sku-image-container],[class*=skuImageContainer]") || null;
    const image = container?.querySelector?.("img") || null;
    const thumbnail = norm(image?.currentSrc || image?.src || "");
    const classText = String(container?.className || "");
    const selected = Boolean(container && (
      container.classList?.contains("selected") ||
      container.getAttribute?.("aria-selected") === "true" ||
      container.getAttribute?.("aria-checked") === "true" ||
      container.getAttribute?.("data-selected") === "true" ||
      /\b(is-selected|is-checked)\b/i.test(classText)
    ));
    return {
      filled: Boolean(thumbnail),
      selected,
      thumbnail
    };
  }

  function collectDialogSkuRows(dialog) {
    if (!dialog) return [];
    const directRows = queryVisible(dialog, ".sku-list .sku-item");
    if (directRows.length) {
      return directRows
        .map((row) => {
          const rowText = textOf(row);
          const skuName = cleanSkuName(rowText);
          if (!looksLikeSkuText(skuName)) return null;
          const target = findDialogSkuClickTarget(row);
          const visualState = dialogSkuVisualState(row);
          return {
            element: row,
            target,
            rowText,
            sku_name: skuName,
            merchant_code: "",
            rect: rectOf(row),
            targetPath: elementPath(target),
            filled: visualState.filled,
            selected: visualState.selected,
            thumbnail: visualState.thumbnail
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
        .map((row, index) => ({ ...row, index, ...SkuImageMatcher.describeSku({ ...row, index }) }));
    }
    const start = rightPanelStart(dialog);
    const seen = new Set();
    return queryVisible(dialog, "div,li,tr,section,p,span")
      .map((element) => {
        const text = textOf(element);
        if (!looksLikeSkuText(text)) return null;
        const rect = element.getBoundingClientRect();
        if (rect.left < start - 40) return null;
        const row = rowContainerFor(element, dialog, start);
        const rowText = textOf(row) || text;
        if (!looksLikeSkuText(rowText)) return null;
        const rowRect = row.getBoundingClientRect();
        const key = `${Math.round(rowRect.top)}|${rowText.slice(0, 80)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const skuName = cleanSkuName(rowText);
        const target = findDialogSkuClickTarget(row);
        const visualState = dialogSkuVisualState(row);
        return {
          element: row,
          target,
          rowText,
          sku_name: skuName,
          merchant_code: "",
          rect: rectOf(row),
          targetPath: elementPath(target),
          filled: visualState.filled,
          selected: visualState.selected,
          thumbnail: visualState.thumbnail
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
      .map((row, index) => ({ ...row, index, ...SkuImageMatcher.describeSku({ ...row, index }) }));
  }

  async function scanDialog(options = {}) {
    const dialog = findSkuImageDialog();
    const useScroll = options.scroll !== false;
    const skuRows = useScroll && dialog
      ? await scanWithScroll(dialog, "skus", () => collectDialogSkuRows(dialog), { maxScrollSteps: options.maxScrollSteps, settleMs: options.settleMs })
      : collectDialogSkuRows(dialog);
    const imageCards = useScroll && dialog
      ? await scanWithScroll(dialog, "images", () => collectDialogImages(dialog), { maxScrollSteps: options.maxScrollSteps, settleMs: options.settleMs })
      : collectDialogImages(dialog);
    const plan = SkuImageMatcher.buildMatchPlan(skuRows, imageCards, { minConfidence: options.minConfidence || 0.78 });
    return { dialog, skuRows, imageCards, plan };
  }

  async function scanFrameImages(options = {}) {
    const imageCards = options.scroll === false
      ? collectFrameImages()
      : await scanWithScroll(document.body, "images", collectFrameImages, { maxScrollSteps: options.maxScrollSteps, settleMs: options.settleMs });
    const media = mediaSelectorScore(imageCards);
    return {
      ok: true,
      contentVersion: VERSION,
      isMediaFrame: media.score >= 30,
      mediaScore: media.score,
      mediaReasons: media.reasons,
      imageCards,
      image_count: imageCards.length,
      imagePreview: imageCards.slice(0, 80).map((image, index) => ({
        index,
        name: image.name || image.cardText || image.src,
        cardText: image.cardText,
        src: image.src,
        path: image.path,
        rect: image.rect,
        sizes: image.sizes,
        colors: image.colors,
        packages: image.packages,
        ambiguousSizes: image.ambiguousSizes
      }))
    };
  }

  function frameImageMatchesPayload(card, payload, expectedSizes) {
    if (card.ambiguousSizes) return false;
    if (expectedSizes.length && !sizesOverlap(expectedSizes, card.sizes || [])) return false;
    if (payload.src) return card.src === payload.src;
    if (payload.name && (card.name === payload.name || card.cardText === payload.name)) return true;
    return false;
  }

  async function clickFrameImage(payload = {}) {
    const expectedSizes = Array.isArray(payload.expectedSizes) ? payload.expectedSizes : [];
    const target = await findWithScroll(
      document.body,
      "images",
      collectFrameImages,
      (card) => frameImageMatchesPayload(card, payload, expectedSizes),
      { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
    );
    if (!target) return { ok: false, reason: "未在素材 iframe 中找到尺寸一致的目标图片。" };
    const clicked = await trustedClick(target.target || target.img || target.element, { allowSyntheticFallback: true });
    return { ok: clicked.ok, reason: clicked.reason, image: { name: target.name || target.cardText || target.src, src: target.src, path: target.path } };
  }

  async function clickDialogSku(payload = {}) {
    const dialog = findSkuImageDialog();
    const index = Number(payload.index);
    const targetName = norm(payload.sku_name);
    const row = await findWithScroll(
      dialog,
      "skus",
      () => collectDialogSkuRows(dialog),
      (item) => (!Number.isFinite(index) || item.index === index || targetName) && (!targetName || sameSkuName(item.sku_name, targetName)),
      { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
    );
    if (!row) return { ok: false, reason: "未在右侧找到名称一致的目标 SKU 行。" };
    const clicked = await trustedClick(row.target || row.element, { allowSyntheticFallback: true });
    return { ok: clicked.ok, reason: clicked.reason, row: { index: row.index, sku_name: row.sku_name, targetPath: row.targetPath } };
  }

  function dialogSkuMatchesPayload(item, payload = {}) {
    const index = Number(payload.index);
    const targetName = norm(payload.sku_name);
    if (targetName) return sameSkuName(item.sku_name, targetName);
    return Number.isFinite(index) && item.index === index;
  }

  async function findDialogSkuRow(payload = {}) {
    const dialog = findSkuImageDialog();
    if (!dialog) return { dialog: null, row: null };
    const row = await findWithScroll(
      dialog,
      "skus",
      () => collectDialogSkuRows(dialog),
      (item) => dialogSkuMatchesPayload(item, payload),
      { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
    );
    return { dialog, row };
  }

  function publicDialogSkuState(row) {
    if (!row) return null;
    return {
      index: row.index,
      sku_name: row.sku_name,
      filled: Boolean(row.filled),
      selected: Boolean(row.selected),
      thumbnail: row.thumbnail || "",
      targetPath: row.targetPath
    };
  }

  async function getDialogSkuState(payload = {}) {
    const { dialog, row } = await findDialogSkuRow(payload);
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    if (!row) return { ok: false, reason: "未在右侧找到名称一致的目标 SKU 行。" };
    return { ok: true, state: publicDialogSkuState(row) };
  }

  async function getDialogSkuStates(payload = {}) {
    const dialog = findSkuImageDialog();
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。", results: [] };
    const requests = Array.isArray(payload.items) ? payload.items : [];
    const rows = await scanWithScroll(
      dialog,
      "skus",
      () => collectDialogSkuRows(dialog),
      { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
    );
    const results = requests.map((request) => {
      const row = rows.find((item) => dialogSkuMatchesPayload(item, request));
      return row
        ? { ok: true, state: publicDialogSkuState(row) }
        : { ok: false, reason: "未在右侧找到名称一致的目标 SKU 行。", state: null };
    });
    return {
      ok: results.every((result) => result.ok),
      reason: results.every((result) => result.ok) ? "" : "部分目标 SKU 行未找到。",
      results
    };
  }

  async function clearDialogSkuSelection(payload = {}) {
    const { dialog, row } = await findDialogSkuRow(payload);
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    if (!row) return { ok: false, reason: "未在右侧找到名称一致的目标 SKU 行。" };
    if (!row.selected) return { ok: true, alreadyClear: true, state: publicDialogSkuState(row) };
    const clicked = await trustedClick(row.target || row.element, { allowSyntheticFallback: true });
    if (!clicked.ok) return { ok: false, reason: clicked.reason, state: publicDialogSkuState(row) };
    await sleep(180);
    const refreshed = await findDialogSkuRow(payload);
    return {
      ok: Boolean(refreshed.row && !refreshed.row.selected),
      reason: refreshed.row?.selected ? "目标 SKU 仍处于选中状态。" : "",
      state: publicDialogSkuState(refreshed.row)
    };
  }

  async function clearDialogSkuSelectionsExcept(payload = {}) {
    const dialog = findSkuImageDialog();
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    const keepSelectedNames = new Set(
      (Array.isArray(payload.keepSelectedSkus) ? payload.keepSelectedSkus : []).map(norm).filter(Boolean)
    );
    const maxClearCount = Math.max(1, Math.min(120, Number(payload.maxClearCount || 100)));
    let clearedCount = 0;
    while (clearedCount < maxClearCount) {
      const selectedRow = await findWithScroll(
        dialog,
        "skus",
        () => collectDialogSkuRows(dialog),
        (item) => item.selected && !keepSelectedNames.has(norm(item.sku_name)),
        { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
      );
      if (!selectedRow) {
        return { ok: true, cleared_selection_count: clearedCount };
      }
      const selectedName = selectedRow.sku_name;
      const clicked = await trustedClick(selectedRow.target || selectedRow.element, { allowSyntheticFallback: true });
      if (!clicked.ok) {
        return { ok: false, reason: `无法清理 SKU 的残留选中状态：${selectedName}`, cleared_selection_count: clearedCount };
      }
      await sleep(160);
      const refreshed = await findDialogSkuRow({
        sku_name: selectedName,
        maxScrollSteps: payload.maxScrollSteps,
        settleMs: payload.settleMs
      });
      if (refreshed.row?.selected) {
        return { ok: false, reason: `SKU 仍处于选中状态：${selectedName}`, cleared_selection_count: clearedCount };
      }
      clearedCount += 1;
    }
    return { ok: false, reason: "残留选中 SKU 数量超过安全清理上限。", cleared_selection_count: clearedCount };
  }

  async function prepareDialogSku(payload = {}) {
    const first = await findDialogSkuRow(payload);
    if (!first.dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    if (!first.row) return { ok: false, reason: "未在右侧找到名称一致的目标 SKU 行。" };

    const targetName = norm(first.row.sku_name);
    const keepSelectedNames = new Set([
      targetName,
      ...(Array.isArray(payload.keepSelectedSkus) ? payload.keepSelectedSkus.map(norm) : [])
    ].filter(Boolean));
    const straySelections = collectDialogSkuRows(first.dialog)
      .filter((item) => item.selected && !keepSelectedNames.has(norm(item.sku_name)));
    for (const selectedRow of straySelections) {
      const cleared = await trustedClick(selectedRow.target || selectedRow.element, { allowSyntheticFallback: true });
      if (!cleared.ok) {
        return {
          ok: false,
          reason: `无法清理其他 SKU 的残留选中状态：${selectedRow.sku_name}`,
          state: publicDialogSkuState(first.row)
        };
      }
      await sleep(120);
    }

    let current = await findDialogSkuRow(payload);
    if (!current.row) return { ok: false, reason: "清理选中状态后目标 SKU 行已不可用。" };
    if (current.row.filled && payload.replaceFilled !== true) {
      return { ok: true, alreadyFilled: true, state: publicDialogSkuState(current.row), cleared_selection_count: straySelections.length };
    }
    if (!current.row.selected) {
      const clicked = await trustedClick(current.row.target || current.row.element, { allowSyntheticFallback: true });
      if (!clicked.ok) return { ok: false, reason: clicked.reason, state: publicDialogSkuState(current.row) };
      await sleep(220);
      current = await findDialogSkuRow(payload);
    }
    if (!current.row?.selected) {
      return { ok: false, reason: "目标 SKU 行未进入选中状态。", state: publicDialogSkuState(current.row) };
    }
    return { ok: true, state: publicDialogSkuState(current.row), cleared_selection_count: straySelections.length };
  }

  async function getDialogFillSummary(payload = {}) {
    const dialog = findSkuImageDialog();
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    const rows = await scanWithScroll(
      dialog,
      "skus",
      () => collectDialogSkuRows(dialog),
      { maxScrollSteps: payload.maxScrollSteps, settleMs: payload.settleMs }
    );
    const missing = rows.filter((row) => !row.filled);
    const selected = rows.filter((row) => row.selected);
    return {
      ok: true,
      total_count: rows.length,
      filled_count: rows.length - missing.length,
      missing_count: missing.length,
      selected_count: selected.length,
      missing_skus: missing.map((row) => row.sku_name),
      selected_skus: selected.map((row) => row.sku_name)
    };
  }

  function findDialogConfirmButton(dialog) {
    if (!dialog) return null;
    return queryVisible(dialog, "button,[role=button],a,input[type=button],input[type=submit]")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        let score = 0;
        if (isConfirmText(textOf(element))) score += 80;
        if (rect.left > dialog.getBoundingClientRect().left + dialog.getBoundingClientRect().width * 0.70) score += 10;
        if (rect.top > dialog.getBoundingClientRect().top + dialog.getBoundingClientRect().height * 0.70) score += 10;
        if (/primary|confirm|ok|sure/i.test(String(element.className || ""))) score += 5;
        return { element, score };
      })
      .filter((item) => item.score >= 80)
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  async function confirmDialog() {
    let dialog = findSkuImageDialog();
    if (!dialog) return { ok: false, reason: "未找到 SKU 图片填充弹窗。" };
    if (dialog === document.body) dialog = findGenericSkuImageDialog() || document.body;
    if (!dialog) return { ok: false, reason: "未找到独立的 SKU 图片填充弹窗，已拒绝全页查找确定按钮。" };
    const button = findDialogConfirmButton(dialog);
    if (!button) return { ok: false, reason: "未找到弹窗右下角“确定”按钮。" };
    const clicked = await trustedClick(button);
    await sleep(500);
    return { ok: clicked.ok, reason: clicked.reason, targetPath: elementPath(button), dialogStillOpen: Boolean(findSkuImageDialog()) };
  }

  function publicPlan(plan) {
    return {
      ok: plan.ok,
      sku_count: plan.sku_count,
      image_count: plan.image_count,
      logical_image_count: plan.logical_image_count,
      duplicate_image_count: plan.duplicate_image_count,
      auto_count: plan.auto_count,
      review_count: plan.review_count,
      ambiguous_count: plan.ambiguous_count,
      missing_count: plan.missing_count,
      items: plan.items.slice(0, 80).map((item) => ({
        index: item.index,
        row: item.row,
        sku_name: item.sku_name,
        status: item.status,
        confidence: item.confidence,
        reason: item.reason,
        flags: item.flags,
        image: item.image ? {
          index: item.image.index,
          name: item.image.name || item.image.cardText || item.image.src,
          cardText: item.image.cardText,
          src: item.image.src,
          path: item.image.path,
          sizes: item.image.sizes,
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
            cardText: candidate.image.cardText,
            src: candidate.image.src,
            sizes: candidate.image.sizes,
            colors: candidate.image.colors,
            packages: candidate.image.packages
          } : null
        }))
      }))
    };
  }

  function publicRows(rows, limit = 30) {
    return rows.slice(0, limit).map((row) => ({
      index: row.index,
      sku_name: row.sku_name,
      filled: row.filled,
      selected: row.selected,
      thumbnail: row.thumbnail || "",
      rect: row.rect,
      targetPath: row.targetPath
    }));
  }

  function diagnose() {
    installFinalButtonGuard();
    const dialog = findSkuImageDialog();
    const dialogRows = collectDialogSkuRows(dialog);
    const dialogImages = collectDialogImages(dialog);
    const mainRows = collectMainSkuRows();
    const text = textOf(document.body);
    const authSignals = ["验证码", "手机验证", "安全验证", "登录"].filter((signal) => text.includes(signal));
    const score = (dialog ? 40 : 0) + (dialogRows.length ? 30 : 0) + (dialogImages.length ? 20 : 0) + (mainRows.length ? 10 : 0);
    return {
      ok: true,
      contentVersion: VERSION,
      score,
      title: document.title,
      url: location.href,
      dialogFound: Boolean(dialog),
      dialogSkuCount: dialogRows.length,
      dialogImageCount: dialogImages.length,
      mainSkuCount: mainRows.length,
      mainFilledImageCount: mainRows.filter((row) => row.filled).length,
      mainEmptyImageCount: mainRows.filter((row) => !row.filled).length,
      dialogSkuPreview: publicRows(dialogRows),
      imagePreview: dialogImages.slice(0, 30).map((image, index) => ({
        index,
        name: image.name || image.cardText || image.src,
        cardText: image.cardText,
        rect: image.rect,
        sizes: image.sizes
      })),
      mainSkuPreview: publicRows(mainRows),
      frameImageCount: isMediaSelectorFrame() ? collectFrameImages().length : 0,
      authSignals
    };
  }

  async function openFirstEmptyImageDialog(payload = {}) {
    installFinalButtonGuard();
    const before = await scanDialog({ scroll: false });
    if (before.dialog && before.dialog !== document.body && before.skuRows.length) {
      return { ok: true, alreadyOpen: true, plan: publicPlan(before.plan) };
    }
    const rows = collectMainSkuRows();
    const targetRow = payload.preferFirst ? rows[0] : (rows.find((row) => !row.filled) || rows[0]);
    if (!targetRow) return { ok: false, reason: "未识别到当前页 SKU 搜索主图列。" };
    let openedFrom = targetRow;
    const clicked = await trustedClick(targetRow.target || targetRow.imageCell);
    if (!clicked.ok) return { ok: false, reason: `点击 SKU 图片位被安全拦截：${clicked.reason}`, openedFrom: { index: targetRow.index, sku_name: targetRow.sku_name, targetPath: targetRow.targetPath } };
    await sleep(900);
    let after = await scanDialog({ scroll: false });
    if (!after.dialog && payload.preferFirst && targetRow.filled) {
      const fallbackRow = rows.find((row) => !row.filled && row !== targetRow);
      if (fallbackRow) {
        const fallbackClick = await trustedClick(fallbackRow.target || fallbackRow.imageCell);
        if (fallbackClick.ok) {
          openedFrom = fallbackRow;
          await sleep(900);
          after = await scanDialog({ scroll: false });
        }
      }
    }
    return {
      ok: Boolean(after.dialog),
      openedFrom: { index: openedFrom.index, sku_name: openedFrom.sku_name, targetPath: openedFrom.targetPath },
      plan: publicPlan(after.plan),
      reason: after.dialog ? "" : "已点击当前页 SKU 图片位，但未识别到批量填充弹窗。"
    };
  }

  async function fillByPlan(payload = {}) {
    installFinalButtonGuard();
    const minConfidence = Number(payload.minConfidence || 0.78);
    const allowReview = Boolean(payload.allowReview);
    const maxRows = Number(payload.maxRows || 999);
    const openResult = await openFirstEmptyImageDialog({ preferFirst: true });
    if (!openResult.ok && !openResult.alreadyOpen) {
      return { ok: false, reason: openResult.reason || "未能先点击主表第一行 SKU 搜索主图。", openResult };
    }
    const initial = await scanDialog({ minConfidence });
    const actions = [];
    if (!initial.dialog || !initial.skuRows.length || !initial.imageCards.length) {
      return { ok: false, reason: "未识别到已打开的 SKU 图片填充弹窗、右侧 SKU 行或左侧图片。", plan: publicPlan(initial.plan) };
    }
    for (const item of initial.plan.items.slice(0, maxRows)) {
      if (!item.image) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: "missing" });
        continue;
      }
      if (item.status !== "auto" && !allowReview) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: item.status });
        continue;
      }
      if (!sameSizeMatch(item.sku_name, item.image)) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: "size-mismatch-guard" });
        continue;
      }
      const current = await scanDialog({ minConfidence, scroll: false });
      const row = findSkuRowByIdentity(current.skuRows, item.index, item.sku_name);
      const image = findImageByIdentityAndSize(current.imageCards, item.image, item.sku_name);
      if (!row || !image) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: "element-not-found" });
        continue;
      }
      const rowClick = await trustedClick(row.target || row.element);
      if (!rowClick.ok) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: rowClick.reason });
        continue;
      }
      await sleep(220);
      const imageClick = await trustedClick(image.target || image.img || image.element);
      if (!imageClick.ok) {
        actions.push({ index: item.index, sku_name: item.sku_name, skipped: true, reason: imageClick.reason });
        continue;
      }
      await sleep(450);
      actions.push({
        index: item.index,
        sku_name: item.sku_name,
        filled: true,
        image: image.name || image.cardText || image.src,
        confidence: item.confidence,
        reason: item.reason
      });
    }
    const finalScan = await scanDialog({ minConfidence });
    const filledCount = actions.filter((item) => item.filled).length;
    const shouldConfirm = payload.confirmAfterFill !== false && (filledCount > 0 || payload.confirmAfterFill === true);
    const confirmResult = shouldConfirm
      ? await confirmDialog()
      : { ok: false, skipped: true, reason: filledCount === 0 ? "没有成功填充的 SKU，未点击确定。" : "已按参数跳过点击确定。" };
    return {
      ok: true,
      filled_count: filledCount,
      skipped_count: actions.filter((item) => item.skipped).length,
      actions,
      openResult,
      plan: publicPlan(finalScan.plan),
      confirmResult,
      finalActionClicked: confirmResult.ok
    };
  }

  async function fillByVisibleOrder(payload = {}) {
    return { ok: false, reason: "按当前可见顺序填充已禁用，请使用“按网页图片名尺寸填充”。" };
  }

  const messageListener = (message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPE) return false;
    (async () => {
      if (message.action === "diagnose") return diagnose();
      if (message.action === "openFirstEmptyImageDialog") return openFirstEmptyImageDialog(message.payload || {});
      if (message.action === "scanDialog") {
        const { skuRows, imageCards, plan } = await scanDialog(message.payload || {});
        return { ok: true, skuRows: publicRows(skuRows, 200), imageCards: imageCards.map((image, index) => ({ index, name: image.name || image.cardText || image.src, cardText: image.cardText, src: image.src, path: image.path, rect: image.rect, sizes: image.sizes, colors: image.colors, packages: image.packages, ambiguousSizes: image.ambiguousSizes })), plan: publicPlan(plan), diagnostics: diagnose() };
      }
      if (message.action === "scanFrameImages") return scanFrameImages(message.payload || {});
      if (message.action === "clickFrameImage") return clickFrameImage(message.payload || {});
      if (message.action === "clickDialogSku") return clickDialogSku(message.payload || {});
      if (message.action === "getDialogSkuState") return getDialogSkuState(message.payload || {});
      if (message.action === "getDialogSkuStates") return getDialogSkuStates(message.payload || {});
      if (message.action === "prepareDialogSku") return prepareDialogSku(message.payload || {});
      if (message.action === "clearDialogSkuSelection") return clearDialogSkuSelection(message.payload || {});
      if (message.action === "clearDialogSkuSelectionsExcept") return clearDialogSkuSelectionsExcept(message.payload || {});
      if (message.action === "getDialogFillSummary") return getDialogFillSummary(message.payload || {});
      if (message.action === "confirmDialog") return confirmDialog(message.payload || {});
      if (message.action === "fillByPlan") return fillByPlan(message.payload || {});
      if (message.action === "fillByVisibleOrder") return fillByVisibleOrder(message.payload || {});
      return { ok: false, reason: `未知动作: ${message.action}` };
    })()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  };
  window.__tmallSkuImageFillListener = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);
})();
