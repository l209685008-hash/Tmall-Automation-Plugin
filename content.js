(() => {
  "use strict";

  const CONTENT_SCRIPT_VERSION = "2026-07-04-ensure-product-title-v37";
  const CONTENT_MESSAGE_TYPE = "TMALL_AUTO_LISTING_V3";
  const SKU_ASSISTANT_COMMAND = "价格取整";

  if (window.__tmallAutoListingContentVersion === CONTENT_SCRIPT_VERSION) return;
  if (window.__tmallAutoListingMessageHandler && typeof chrome !== "undefined" && chrome.runtime?.onMessage?.removeListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__tmallAutoListingMessageHandler);
    } catch {
      // Older injected copies may not be removable in every Chrome context.
    }
  }
  window.__tmallAutoListingContentVersion = CONTENT_SCRIPT_VERSION;
  window.__tmallAutoListingContentLoaded = true;
  document.documentElement.setAttribute("data-tmall-auto-listing-version", CONTENT_SCRIPT_VERSION);

  const PLAN = {
    textFields: [
      { key: "productTitle", label: "商品标题", value: "禹尚热敏标签纸打印纸整箱装" },
      { key: "guideTitle", label: "导购标题", value: "打印清晰粘性好整箱包装性价比高" },
      { key: "sellingPoint", label: "商品卖点", value: "打印清晰，整箱批发，工厂直销粘性强不卡纸" },
      { key: "manufacturer", label: "生产企业", value: "义乌市腾望纸业有限公司" }
    ],
    dropdownFields: [
      { key: "brand", label: "品牌", mode: "single", value: "禹尚", selector: "#struct-p-20000 .next-select" },
      { key: "material", label: "材质", mode: "single", value: "热敏纸", selector: "#struct-p-20021 .next-select" },
      {
        key: "applicableBrands",
        label: "适用品牌",
        mode: "multi",
        selector: "#struct-p-28102 .next-select",
        values: ["GODEx", "启锐", "快麦", "HPRT/汉印", "佳博", "ZEBRA/斑马", "科诚", "GPRINTER", "GODEX", "Deli/得力", "brother/兄弟", "Argox/立象科技"]
      },
      {
        key: "materialFeatures",
        label: "材质特性",
        mode: "multi",
        selector: "#struct-p-217582742 .next-select",
        values: ["打印清晰", "粘性强", "防水", "防油", "防刮", "三防"]
      },
      { key: "paperType", label: "纸张版型", mode: "single", value: "方型", selector: "#struct-p-217542814 .next-select" }
    ],
    listingTime: { label: "上架时间", value: "立刻上架" },
    salesInfo: {
      onePrice: { key: "onePrice", label: "一口价" },
      quantity: { key: "quantity", label: "商品数量" },
      merchantCode: { key: "merchantCode", label: "商家编码" },
      stockReduction: { key: "stockReduction", label: "库存扣减方式", value: "付款减库存" }
    },
    logisticsInfo: {
      deliveryTime: { key: "deliveryTime", label: "发货时间", value: "48小时" },
      pickupMethod: { key: "pickupMethod", label: "提取方式", value: "邮寄" },
      locationScope: { key: "locationScope", label: "所在地", value: "大陆及港澳台" },
      province: { key: "province", label: "所在地", value: "浙江", dropdownIndex: 0 },
      city: { key: "city", label: "所在地", value: "金华", dropdownIndex: 1 },
      rebateRate: { key: "rebateRate", label: "返点比例", value: "0.1" }
    },
    finalActionsBlocked: ["提交", "发布", "保存", "保存草稿", "放入仓库", "立即上架", "确认发布", "保存并发布"]
  };

  const INTERACTIVE_SELECTOR = [
    "input:not([type=hidden]):not([disabled])",
    "textarea:not([disabled])",
    "[contenteditable=true]",
    "[role=combobox]",
    "[role=listbox]",
    "[role=button]",
    "button:not([disabled])",
    ".next-select",
    ".ant-select",
    ".semi-select",
    ".el-select",
    ".tm-select",
    ".rax-select"
  ].join(",");

  const OPTION_SELECTOR = [
    "[role=option]",
    "[role=menuitem]",
    ".next-menu-item",
    ".next-select-menu-item",
    ".next-menu-item-inner",
    ".ant-select-item-option",
    ".semi-select-option",
    ".el-select-dropdown__item",
    ".tm-select-option",
    ".rax-select-option",
    ".select-option",
    ".dropdown-item",
    ".options-item",
    "li"
  ].join(",");

  const BLOCKED_SELECTOR = "button,a,[role=button],input[type=button],input[type=submit]";
  const DROPDOWN_ROOT_SELECTOR = [
    ".next-overlay-inner",
    ".next-overlay-wrapper",
    ".sell-o-select-options",
    ".next-select-menu",
    "[role=listbox]",
    "[role=menu]",
    ".next-menu",
    ".ant-select-dropdown",
    ".semi-portal",
    ".semi-select-option-list",
    ".el-select-dropdown",
    ".tm-overlay",
    ".rax-overlay",
    ".options"
  ].join(",");
  const SELECTED_VALUE_SELECTOR = [
    ".next-tag",
    ".next-tag-body",
    ".next-select-tag",
    ".next-selected",
    ".ant-tag",
    ".ant-select-selection-item",
    ".semi-tag",
    ".el-tag",
    ".tm-tag",
    ".rax-tag",
    "[aria-selected=true]",
    "[aria-checked=true]",
    "[data-selected=true]"
  ].join(",");
  const SELECTED_CHOICE_SELECTOR = [
    ".next-checkbox-wrapper.checked",
    ".next-radio-wrapper.checked",
    ".next-checkbox.checked",
    ".next-radio.checked",
    ".is-checked",
    ".is-selected",
    ".selected",
    "[aria-checked=true]",
    "[aria-selected=true]",
    "[data-checked=true]",
    "[data-selected=true]"
  ].join(",");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function norm(text) {
    return String(text == null ? "" : text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function classNameOf(element) {
    const value = element?.className;
    return typeof value === "string" ? value : value?.baseVal || String(value || "");
  }

  function looseNorm(text) {
    return norm(text)
      .toLowerCase()
      .replace(/[／]/g, "/")
      .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
      .replace(/\s+/g, "");
  }

  function visible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function rectOverlapsViewport(rect, margin = 0) {
    return rect.width > 0 && rect.height > 0 && rect.right >= margin && rect.left <= window.innerWidth - margin && rect.bottom >= margin && rect.top <= window.innerHeight - margin;
  }

  function isAssistantPanelElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const rect = element.getBoundingClientRect();
    const meta = norm([element.id, classNameOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), textOf(element)].join(" "));
    const leftRailLimit = Math.max(300, Math.min(360, window.innerWidth * 0.2));
    const inDialog = Boolean(element.closest("[role=dialog],.ant-modal,.next-dialog,.dialog,.modal"));
    if (rect.width > 0 && rect.right <= leftRailLimit && !inDialog && !/SKU助手|请输入指令|价格取整|sendIcon|searchExpanded/.test(meta)) return true;
    return Boolean(
      element?.closest?.(
        ".sell-component-assistant-v2, .optimization-assistant, .sell-component-simply-assistant-navtab, .sell-component-assistant-error-v2-error-content, .assistant-v2-item, [class*=assistant], [class*=Assistant], [class*=preview], [class*=Preview]"
      )
    );
  }

  function textOf(element) {
    if (!element) return "";
    if ("value" in element && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return norm(element.value);
    return norm(element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "");
  }

  function fireInput(element, value, options = {}) {
    element.focus();
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) descriptor.set.call(element, value);
      else element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    if (options.blur !== false) element.blur();
  }

  function isSkuAssistantActionElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const meta = norm([
      element?.id,
      classNameOf(element),
      element?.getAttribute?.("alt"),
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      textOf(element)
    ].join(" "));
    if (/close|clear|delete|清除|关闭|wrapperClose|cancel|预览|应用示例|主图|图片|素材/i.test(meta)) return false;
    const actionRoot = element.closest?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions],.next-input-inner.next-after,.next-input-after,.next-input-suffix,.next-input-addon");
    const context = norm(textOf(actionRoot?.closest?.(".searchExpandedWrapper-PBh1DQ,.expandedContainer-ZU_GfG,.inputWithActions-uM0JCH,.sku,.sell-sku-table-wrapper-new") || element.parentElement));
    return Boolean(actionRoot && /SKU助手|请输入指令|价格取整/.test(context) && /sendIcon|searchExpandedActions|发送|执行|send|arrow/i.test(meta));
  }

  function isExplicitSkuAssistantSendElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const meta = norm([
      element.id,
      classNameOf(element),
      element.getAttribute?.("alt"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      textOf(element)
    ].join(" "));
    if (/close|clear|delete|娓呴櫎|鍏抽棴|wrapperClose|cancel|棰勮|搴旂敤绀轰緥|涓诲浘|鍥剧墖|绱犳潗/i.test(meta)) return false;
    if (/sendIcon|searchExpandedActions|鍙戦€亅鎵ц|杩愯|send|arrow/i.test(meta)) return true;
    return Array.from(element.querySelectorAll?.("img[alt=send],[class*=sendIcon],[class*=SendIcon],[class*=searchExpandedActions]") || []).some(visible);
  }

  function isSkuAssistantPointFallbackAction(element, point, inputRect) {
    if (!element || !point || !inputRect) return false;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(point.x, point.y) : [element];
    const target = stack.find((item) => isExplicitSkuAssistantSendElement(item)) || null;
    if (!target) return false;
    const meta = norm([
      target.id,
      classNameOf(target),
      target.getAttribute?.("alt"),
      target.getAttribute?.("aria-label"),
      target.getAttribute?.("title"),
      textOf(target)
    ].join(" "));
    if (/close|clear|delete|清除|关闭|wrapperClose|cancel|预览|应用示例|主图|图片|素材/i.test(meta)) return false;
    const rect = target.getBoundingClientRect();
    const centerY = inputRect.top + inputRect.height / 2;
    const sameRow = Math.abs((rect.top + rect.height / 2) - centerY) <= Math.max(24, inputRect.height);
    const nearRight = point.x >= inputRect.right - 40 && point.x <= inputRect.right + 140;
    const actionLike =
      /send|arrow|sendIcon|searchExpandedActions|发送|执行|运行/i.test(meta) ||
      target.matches?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions],.next-input-after,.next-input-inner.next-after,.next-input-suffix,.next-input-addon");
    return Boolean(sameRow && nearRight && actionLike);
  }

  function isProtectedPreviewClick(element, options = {}) {
    if (!element || options.allowPreviewClick) return false;
    if (options.allowSkuAssistant) {
      return !isSkuAssistantActionElement(element) && !isSkuAssistantPointFallbackAction(element, options.point, options.skuAssistantInputRect);
    }
    if (isSkuAssistantActionElement(element)) return false;
    const media = element.closest?.("img,picture,canvas,video,[class*=image],[class*=Image],[class*=picture],[class*=Picture],[class*=preview],[class*=Preview]");
    const target = media || element;
    const rect = target.getBoundingClientRect();
    const meta = norm([
      target.id,
      classNameOf(target),
      target.getAttribute?.("alt"),
      target.getAttribute?.("aria-label"),
      target.getAttribute?.("title"),
      textOf(target.closest?.("section,aside,div") || target)
    ].join(" "));
    const leftRailLimit = Math.max(300, Math.min(360, window.innerWidth * 0.2));
    const inDialog = Boolean(target.closest?.("[role=dialog],.ant-modal,.next-dialog,.dialog,.modal"));
    if (rect.width > 0 && rect.right <= leftRailLimit && !inDialog) return true;
    if (media && !/上传|导入|drop|upload|sendIcon|searchExpandedActions/i.test(meta)) return true;
    return /应用示例|预览效果|主图|图片|素材|image-preview|preview-modal/i.test(meta);
  }

  function clickElement(element, options = {}) {
    if (isProtectedPreviewClick(element, options)) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    element.click();
    return true;
  }

  async function trustedClickElement(element, options = {}) {
    if (!element || isProtectedPreviewClick(element, options)) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    await sleep(80);
    const rect = element.getBoundingClientRect();
    const isSelect = element.matches?.(".next-select, .next-select-trigger, .ant-select, .semi-select, .el-select, .tm-select, .rax-select");
    const point = {
      x: isSelect ? rect.right - Math.min(18, Math.max(6, rect.width / 5)) : rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_DEBUG_CLICK", point });
        if (response?.ok) return true;
      }
    } catch {
      // Test harnesses and pages without extension background fall back to DOM events.
    }
    return clickElement(element, options);
  }

  async function trustedClickPoint(point, options = {}) {
    const target = document.elementFromPoint(point.x, point.y);
    const actionTarget =
      target?.closest?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions],.next-input-after,.next-input-inner.next-after,.next-input-suffix,.next-input-addon,[class*=send],[class*=Send],[class*=arrow],[class*=Arrow]") ||
      target;
    if (options.allowSkuAssistant && !isSkuAssistantActionElement(actionTarget) && !isSkuAssistantPointFallbackAction(actionTarget, point, options.skuAssistantInputRect)) return false;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_DEBUG_CLICK", point });
        if (response?.ok) return true;
      }
    } catch {
      // Test harnesses and pages without extension background fall back to DOM events.
    }
    return clickElement(options.preferredElement || (options.forcePoint && target ? target : actionTarget), { ...options, point });
  }

  async function clickSkuAssistantSendButton(input) {
    if (!input) return { clicked: false };
    input.scrollIntoView?.({ block: "center", inline: "nearest" });
    await sleep(120);
    const rect = input.getBoundingClientRect();
    if (!rectOverlapsViewport(rect, 4)) return { clicked: false, reason: "SKU助手输入框不在可点击视口内" };
    const centerY = rect.top + rect.height / 2;
    const roots = [];
    let current = input.parentElement;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) roots.push(current);
    const targetSelector = [
      "[class*=sendIcon]",
      "[class*=SendIcon]",
      "[class*=send]",
      "[class*=Send]",
      "[class*=arrow]",
      "[class*=Arrow]",
      ".searchExpandedActions-yf2c_s",
      "[class*=searchExpandedActions]",
      ".next-input-inner.next-after",
      ".next-input-after",
      ".next-input-suffix",
      ".next-input-addon",
      "img",
      "svg",
      "i"
    ].join(",");
    const points = [];
    const addPoint = (x, y, target = "", element = null) => {
      if (x < 4 || x > window.innerWidth - 4 || y < 4 || y > window.innerHeight - 4) return;
      points.push({
        x,
        y,
        target,
        element
      });
    };
    for (const root of Array.from(new Set(roots))) {
      for (const candidate of Array.from(root.querySelectorAll(targetSelector)).filter(visible)) {
        const meta = norm([
          candidate.id,
          classNameOf(candidate),
          candidate.getAttribute("alt"),
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          textOf(candidate)
        ].join(" "));
        if (/close|clear|delete|清除|关闭|wrapperClose|cancel|预览|应用示例|主图|图片|素材/i.test(meta)) continue;
        const candidateRect = candidate.getBoundingClientRect();
        const sameRow = Math.abs(candidateRect.top + candidateRect.height / 2 - centerY) <= Math.max(20, rect.height);
        const nearRight = candidateRect.left >= rect.right - 110 && candidateRect.left <= rect.right + 120;
        const suffixContainer = candidate.matches(".next-input-inner.next-after,.next-input-after,.next-input-suffix,.next-input-addon");
        const explicitAction = /send|arrow|sendIcon|searchExpandedActions/i.test(meta);
        if (!sameRow || !nearRight || (!explicitAction && !suffixContainer)) continue;
        let icon = Array.from(candidate.querySelectorAll?.("[class*=sendIcon],[class*=SendIcon],[class*=send],[class*=Send],[class*=arrow],[class*=Arrow],img,svg,i") || [])
          .filter(visible)
          .find((element) => {
            const iconMeta = norm([element.id, classNameOf(element), element.getAttribute("alt"), element.getAttribute("aria-label"), element.getAttribute("title")].join(" "));
            return !/close|clear|delete|娓呴櫎|鍏抽棴|wrapperClose|cancel/i.test(iconMeta);
          });
        const preferredSendIcon = Array.from(candidate.querySelectorAll?.("img[alt=send],img[class*=sendIcon],img[class*=SendIcon]") || [])
          .filter(visible)
          .find((element) => !/close|clear|delete|娓呴櫎|鍏抽棴|wrapperClose|cancel/i.test(norm([classNameOf(element), element.getAttribute("alt"), element.getAttribute("title")].join(" "))));
        if (preferredSendIcon) icon = preferredSendIcon;
        if (suffixContainer && !explicitAction && !icon) continue;
        const clickRect = icon ? icon.getBoundingClientRect() : candidateRect;
        addPoint(clickRect.left + clickRect.width / 2, clickRect.top + clickRect.height / 2, elementPath(icon || candidate), icon || candidate);
      }
    }
    const offsets = [42, 36, 48, 30, 54, 24, 60, 18, 66, 12];
    for (const offset of offsets) {
      addPoint(rect.right + offset, centerY, `input-right${offset}`);
    }
    const seen = new Set();
    for (const point of points) {
      const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = document.elementFromPoint(point.x, point.y);
      const actionTarget =
        target?.closest?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions],.next-input-after,.next-input-inner.next-after,.next-input-suffix,.next-input-addon,[class*=send],[class*=Send],[class*=arrow],[class*=Arrow]") ||
        target;
      const candidateMeta = norm([classNameOf(actionTarget), actionTarget?.id, actionTarget?.getAttribute?.("alt"), point.target].join(" "));
      const inSuffixZone = point.x >= rect.right - 120 && point.x <= rect.right + 130 && Math.abs(point.y - centerY) <= Math.max(24, rect.height);
      if (!inSuffixZone && !isSkuAssistantActionElement(actionTarget)) continue;
      if (/close|clear|delete|清除|关闭|wrapperClose|cancel/i.test(candidateMeta) && !/send|arrow|searchExpandedActions/i.test(candidateMeta)) continue;
      const clicked = await trustedClickPoint(point, { allowSkuAssistant: true, forcePoint: inSuffixZone, preferredElement: point.element, skuAssistantInputRect: rect });
      if (clicked) {
        const { element: _element, ...publicPoint } = point;
        return { clicked: true, point: publicPoint, target: point.target || elementPath(actionTarget) };
      }
    }
    return { clicked: false };
  }

  async function trustedReplaceText(text) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_DEBUG_REPLACE_TEXT", text });
        return Boolean(response?.ok);
      }
    } catch {
      // Test harnesses and pages without extension background fall back to DOM input.
    }
    return false;
  }

  async function trustedPressKey(key = "Enter") {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: "TMALL_AUTO_LISTING_DEBUG_PRESS_KEY", key });
        return Boolean(response?.ok);
      }
    } catch {
      // Test harnesses and pages without extension background fall back to DOM events.
    }
    return false;
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      const cls = classNameOf(current)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      if (cls) part += `.${cls}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function isEditable(element) {
    if (!element || !visible(element)) return false;
    if (element.isContentEditable) return true;
    const tag = element.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = String(element.type || "text").toLowerCase();
      return ["text", "search", "number", "tel", "url", "email", ""].includes(type);
    }
    return false;
  }

  function isSelectLike(element) {
    if (!element || !visible(element)) return false;
    const tag = element.tagName;
    const role = element.getAttribute("role");
    const classText = String(element.className || "");
    return (
      tag === "SELECT" ||
      role === "combobox" ||
      role === "listbox" ||
      /select|dropdown|picker|combo/i.test(classText) ||
      element.getAttribute("aria-haspopup") === "listbox"
    );
  }

  function allVisibleElements() {
    return Array.from(document.querySelectorAll("body *")).filter(visible);
  }

  function labelCandidates(label) {
    const labelText = norm(label);
    const candidates = allVisibleElements()
      .map((element) => ({ element, text: textOf(element) }))
      .filter(({ text }) => text && (text === labelText || text.includes(labelText)))
      .filter(({ element }) => {
        const tag = element.tagName;
        if (tag === "OPTION" || tag === "SCRIPT" || tag === "STYLE") return false;
        return true;
      });
    const filtered = candidates.some(({ element }) => !isAssistantPanelElement(element))
      ? candidates.filter(({ element }) => !isAssistantPanelElement(element))
      : candidates;
    return filtered
      .sort((a, b) => {
        const exact = Number(b.text === labelText) - Number(a.text === labelText);
        if (exact) return exact;
        return a.text.length - b.text.length;
      });
  }

  function searchContainer(label) {
    const labels = labelCandidates(label);
    for (const candidate of labels) {
      let current = candidate.element;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        const controls = Array.from(current.querySelectorAll(INTERACTIVE_SELECTOR)).filter(visible);
        if (controls.length) {
          return {
            labelElement: candidate.element,
            container: current,
            controls,
            labelText: candidate.text,
            path: elementPath(current)
          };
        }
      }
    }
    return null;
  }

  function findTextControl(label) {
    const area = searchContainer(label);
    if (!area) return null;
    const editable = area.controls.filter(isEditable);
    if (!editable.length) return null;
    editable.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const lr = area.labelElement.getBoundingClientRect();
      const ad = Math.abs(ar.top - lr.top) + Math.max(0, ar.left - lr.left);
      const bd = Math.abs(br.top - lr.top) + Math.max(0, br.left - lr.left);
      return ad - bd;
    });
    return { ...area, control: editable[0] };
  }

  function findDropdownControl(fieldOrLabel) {
    const field = typeof fieldOrLabel === "string" ? { label: fieldOrLabel } : fieldOrLabel;
    const label = field.label;
    const explicitControl = field.selector ? document.querySelector(field.selector) : null;
    const area = searchContainer(label);
    if (explicitControl && visible(explicitControl)) {
      const container =
        explicitControl.closest(".ell-component-info-wrapper-wrap, .sell-component-info-wrapper-wrap, .form-item, .next-form-item, .ant-form-item, .semi-form-field, .el-form-item") ||
        explicitControl.parentElement ||
        explicitControl;
      return {
        ...(area || {}),
        labelElement: area?.labelElement || explicitControl,
        container: area?.container || container,
        controls: area?.controls?.length ? area.controls : [explicitControl],
        labelText: area?.labelText || label,
        path: elementPath(container),
        control: explicitControl
      };
    }
    if (!area) return null;
    const candidates = area.controls.filter((element) => isSelectLike(element) || !isEditable(element));
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const aScore = Number(isSelectLike(b)) - Number(isSelectLike(a));
      if (aScore) return aScore;
      return textOf(a).length - textOf(b).length;
    });
    const rawControl = candidates[0];
    const selectAncestor = rawControl.closest?.(".next-select, .next-select-trigger, .ant-select, .semi-select, .el-select, .tm-select, .rax-select");
    const control = selectAncestor || rawControl.closest?.("[role=combobox]") || rawControl;
    return { ...area, control };
  }

  function collectDropdownRoots() {
    const roots = [
      document.body,
      ...Array.from(document.querySelectorAll(DROPDOWN_ROOT_SELECTOR))
    ];
    return roots.filter(Boolean);
  }

  function dropdownRootForOption(element) {
    return element.closest(DROPDOWN_ROOT_SELECTOR) || element.parentElement;
  }

  function closeDropdownOverlays() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    document.body.click();
    for (const element of Array.from(document.querySelectorAll(".open"))) {
      if (element.matches?.(".select,.dropdown,.next-select,.ant-select,.semi-select,.el-select,.tm-select,.rax-select")) {
        element.classList.remove("open");
      }
    }
  }

  function nearestOpenDropdownInfo(found, value = "") {
    const target = norm(value);
    const controlRect = found.control.getBoundingClientRect();
    return Array.from(document.querySelectorAll(DROPDOWN_ROOT_SELECTOR))
      .filter(visible)
      .map((root) => {
        const rect = root.getBoundingClientRect();
        const rootOptions = collectOptions(root);
        const edgeDistance = rectDistance(rect, controlRect);
        const anchorDistance = Math.abs(rect.left - controlRect.left) + Math.min(Math.abs(rect.top - controlRect.bottom), Math.abs(rect.bottom - controlRect.top));
        const distance = edgeDistance + anchorDistance / 4;
        const widthPenalty = Math.abs(rect.width - controlRect.width) / 10;
        return {
          root,
          rect,
          distance: distance + widthPenalty,
          optionCount: rootOptions.length,
          options: rootOptions,
          optionMatch: target ? Boolean(exactOption(rootOptions, target)) : false
        };
      })
      .filter((item) => item.rect.width > 40 && item.rect.height > 20 && item.optionCount > 0)
      .sort((a, b) => Number(b.optionMatch) - Number(a.optionMatch) || a.distance - b.distance)[0];
  }

  function nearestOpenDropdownRoot(found, value = "") {
    return nearestOpenDropdownInfo(found, value)?.root;
  }

  function rectDistance(a, b) {
    const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
    const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
    return dx + dy;
  }

  function collectOptions(root) {
    const options = [];
    const roots = root ? [root] : collectDropdownRoots();
    for (const optionRoot of roots) {
      const nodes = Array.from(optionRoot.querySelectorAll(OPTION_SELECTOR)).filter(visible);
      for (const element of nodes) {
        if (isAssistantPanelElement(element)) continue;
        const text = textOf(element);
        if (!text) continue;
        if (element.classList.contains("options-item") && element.getAttribute("title")) {
          const title = norm(element.getAttribute("title"));
          if (title) {
            options.push({
              element,
              text: title,
              selected:
                element.getAttribute("aria-selected") === "true" ||
                element.getAttribute("aria-checked") === "true" ||
                /\b(selected|checked)\b/i.test(element.className?.toString() || "") ||
                Boolean(element.querySelector("input:checked"))
            });
            continue;
          }
        }
        if (text.includes("\n") && !element.matches("[role=option],[role=menuitem],li,.next-menu-item,.next-select-menu-item,.ant-select-item-option,.semi-select-option,.el-select-dropdown__item,.tm-select-option,.rax-select-option,.select-option,.dropdown-item")) continue;
        if (PLAN.finalActionsBlocked.includes(text)) continue;
        options.push({
          element,
          text,
          selected:
            element.getAttribute("aria-selected") === "true" ||
            element.getAttribute("aria-checked") === "true" ||
            /\b(selected|checked)\b/i.test(element.className?.toString() || "") ||
            Boolean(element.querySelector("input:checked"))
        });
      }
    }
    const seen = new Set();
    return options.filter((option) => {
      const key = `${option.text}|${elementPath(option.element)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function collectOptionsForField(found) {
    const localOptions = collectOptions(found.container);
    const controlRect = found.control.getBoundingClientRect();
    const labelRect = found.labelElement.getBoundingClientRect();
    const globalOptions = collectOptions()
      .map((option) => {
        const rect = option.element.getBoundingClientRect();
        const verticalOk = rect.top >= Math.min(controlRect.top, labelRect.top) - 24;
        return {
          ...option,
          fieldDistance: rectDistance(rect, controlRect),
          verticalOk
        };
      })
      .filter((option) => option.verticalOk)
      .sort((a, b) => a.fieldDistance - b.fieldDistance);
    const merged = [...localOptions, ...globalOptions];
    const seen = new Set();
    return merged.filter((option) => {
      const key = `${option.text}|${elementPath(option.element)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function exactOption(options, value) {
    const target = norm(value);
    const looseTarget = looseNorm(value);
    return (
      options.find((option) => norm(option.text) === target) ||
      options.find((option) => looseNorm(option.text) === looseTarget) ||
      options.find((option) => looseNorm(option.text).includes(looseTarget))
    );
  }

  function readSelectedText(container) {
    if (!container) return "";
    const chips = Array.from(container.querySelectorAll(SELECTED_VALUE_SELECTOR))
      .filter(visible)
      .map(textOf)
      .filter(Boolean);
    if (chips.length) return chips.join(" / ");
    const controls = Array.from(container.querySelectorAll("input:not([type=hidden]),textarea,[contenteditable=true],[role=combobox],button"))
      .filter(visible)
      .map(textOf)
      .filter(Boolean)
      .filter((text) => !PLAN.finalActionsBlocked.includes(text));
    return controls.join(" / ");
  }

  function hasSelectedText(container, value) {
    const target = norm(value);
    const selectedElements = Array.from(container.querySelectorAll(SELECTED_VALUE_SELECTOR)).filter(visible);
    if (selectedElements.some((element) => textOf(element).includes(target))) return true;
    const checkedInputs = Array.from(container.querySelectorAll("input:checked")).filter(visible);
    if (checkedInputs.some((element) => textOf(element.closest("label") || element.parentElement || element).includes(target))) return true;
    return false;
  }

  function fieldDisplaysValue(found, value) {
    const target = norm(value);
    return hasSelectedText(found.container, target) || textOf(found.control).includes(target) || readSelectedText(found.container).includes(target);
  }

  async function setTextField(field) {
    const found = findTextControl(field.label);
    if (!found) {
      return { key: field.key, label: field.label, ok: false, reason: "未找到可编辑输入框" };
    }
    fireInput(found.control, field.value);
    await sleep(120);
    const current = found.control.isContentEditable ? norm(found.control.textContent) : norm(found.control.value);
    return {
      key: field.key,
      label: field.label,
      ok: current === field.value || current.includes(field.value),
      value: current,
      path: elementPath(found.control)
    };
  }

  function findFieldContainers(label) {
    const text = norm(label);
    return labelCandidates(text)
      .flatMap((candidate) => {
        const containers = [];
        let current = candidate.element;
        for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
          containers.push({
            labelElement: candidate.element,
            container: current,
            labelText: candidate.text,
            path: elementPath(current)
          });
        }
        return containers;
      })
      .filter((item, index, list) => list.findIndex((other) => other.container === item.container) === index);
  }

  function findFieldContainer(label, pattern) {
    const containers = findFieldContainers(label);
    if (!containers.length) return null;
    const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern || ".");
    return containers
      .map((item) => {
        const text = textOf(item.container);
        const controls = Array.from(item.container.querySelectorAll(INTERACTIVE_SELECTOR)).filter(visible);
        let score = 0;
        if (matcher.test(text)) score += 8;
        if (controls.length) score += 2;
        if (/sell-field-|struct-|sell-component-info-wrapper|form-item|next-form-item|ant-form-item/.test(`${item.container.id || ""} ${item.container.className || ""}`)) score += 4;
        if (isAssistantPanelElement(item.container) || isAssistantPanelElement(item.labelElement)) score -= 30;
        score -= Math.max(0, text.length - 240) / 120;
        return { ...item, text, controls, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0] || null;
  }

  function inputLooksEmpty(element) {
    if (!element) return true;
    if (element.isContentEditable) return !norm(element.textContent);
    if ("value" in element) return !norm(element.value);
    return true;
  }

  async function fillNearestTextInput(label, value, options = {}) {
    const area = findFieldContainer(label, options.pattern || new RegExp(label));
    if (!area) return { key: options.key || label, label, ok: false, reason: "未找到字段容器" };
    const inputs = area.controls
      .filter(isEditable)
      .filter((element) => !options.emptyOnly || inputLooksEmpty(element));
    if (!inputs.length) return { key: options.key || label, label, ok: false, reason: "未找到可编辑输入框" };
    const control = inputs[options.index || 0] || inputs[0];
    fireInput(control, value);
    await sleep(120);
    const current = control.isContentEditable ? norm(control.textContent) : norm(control.value);
    return {
      key: options.key || label,
      label,
      ok: current === String(value) || current.includes(String(value)),
      value: current,
      path: elementPath(control)
    };
  }

  async function clickFieldChoice(label, value, options = {}) {
    const area = findFieldContainer(label, options.pattern || new RegExp(value));
    if (!area) return { key: options.key || label, label, ok: false, reason: "未找到字段容器" };
    const target = Array.from(area.container.querySelectorAll("label,button,[role=button],span,div,input[type=radio],input[type=checkbox]"))
      .filter(visible)
      .map((element) => {
        const text = textOf(element.closest("label") || element);
        const valueText = element.getAttribute("value") || "";
        const classText = String((element.closest("label") || element).className || "");
        let score = 0;
        if (text === value) score += 10;
        if (text.includes(value)) score += 8;
        if (valueText === value) score += 10;
        if (element.matches("input[type=radio],input[type=checkbox]")) score += 4;
        if (/disabled|next-disabled/.test(classText) || element.disabled || element.getAttribute("aria-disabled") === "true") score -= 30;
        return { element, score, text };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0]?.element;
    if (!target) return { key: options.key || label, label, ok: false, reason: `未找到选项 ${value}` };
    if (isFinalAction(target)) return { key: options.key || label, label, ok: false, reason: "命中最终按钮保护，未点击" };
    await trustedClickElement(actionableElement(target.closest("label") || target));
    await sleep(120);
    let selection = readChoiceSelection(area.container, target);
    if (!selection.ok) {
      const input = (target.closest("label") || target).querySelector?.("input[type=radio],input[type=checkbox]");
      if (input && !input.checked && !input.disabled) {
        await trustedClickElement(input);
        await sleep(160);
        selection = readChoiceSelection(area.container, target);
      }
    }
    return {
      key: options.key || label,
      label,
      ok: selection.text.includes(value),
      value,
      checked: selection.text,
      path: elementPath(target)
    };
  }

  function readChoiceSelection(container, target = null) {
    const inputText = Array.from(container.querySelectorAll("input[type=radio],input[type=checkbox]"))
      .filter((input) => input.checked || input.getAttribute("aria-checked") === "true")
      .map((input) => textOf(input.closest("label") || input) || input.getAttribute("value") || "")
      .filter(Boolean);
    const selectedText = Array.from(container.querySelectorAll(SELECTED_CHOICE_SELECTOR))
      .filter(visible)
      .map((element) => textOf(element.closest("label") || element))
      .filter(Boolean);
    const targetRoots = target
      ? [target, target.closest?.("label"), target.closest?.(".next-checkbox-wrapper,.next-radio-wrapper,[aria-checked],[aria-selected]")]
          .filter(Boolean)
      : [];
    const targetText = targetRoots
      .filter((element) => {
        const classText = String(element.className || "");
        return (
          element.checked ||
          element.getAttribute?.("aria-checked") === "true" ||
          element.getAttribute?.("aria-selected") === "true" ||
          /\b(checked|selected|is-checked|is-selected)\b/.test(classText)
        );
      })
      .map((element) => textOf(element))
      .filter(Boolean);
    const text = Array.from(new Set([...inputText, ...selectedText, ...targetText])).join(" / ");
    return { ok: Boolean(text), text };
  }

  async function selectDropdownByIndex(label, index, value, options = {}) {
    const area = findFieldContainer(label, options.pattern || new RegExp(label));
    if (!area) return { key: options.key || label, label, ok: false, reason: "未找到字段容器" };
    const controls = Array.from(
      area.container.querySelectorAll(".next-select, .next-select-trigger, .ant-select, .semi-select, .el-select, .tm-select, .rax-select,[role=combobox],button")
    )
      .filter(visible)
      .filter((element) => {
        if (isEditable(element)) return false;
        if (element.matches("input[type=radio],input[type=checkbox],label")) return false;
        const classText = String(element.className || "");
        const text = textOf(element);
        return isSelectLike(element) || /select|dropdown|picker|combo/i.test(classText) || /请选择|浙江|金华/.test(text);
      })
      .filter((element, elementIndex, list) => {
        const select = element.closest?.(".next-select, .ant-select, .semi-select, .el-select, .tm-select, .rax-select,[role=combobox]") || element;
        return list.findIndex((item) => (item.closest?.(".next-select, .ant-select, .semi-select, .el-select, .tm-select, .rax-select,[role=combobox]") || item) === select) === elementIndex;
      });
    const control = controls[index] || controls[0];
    if (!control) return { key: options.key || label, label, ok: false, reason: "未找到下拉控件" };
    const found = {
      ...area,
      control: control.closest?.(".next-select, .next-select-trigger, .ant-select, .semi-select, .el-select, .tm-select, .rax-select,[role=combobox]") || control
    };
    const beforeText = readSelectedText(found.container);
    const result = await clickDropdownValue(found, value, false);
    closeDropdownOverlays();
    await sleep(120);
    return {
      key: options.key || label,
      label,
      ok: result.ok || fieldDisplaysValue(found, value),
      selected: result.ok ? [result.text || value] : [],
      missing: result.ok ? [] : [value],
      beforeText,
      afterText: readSelectedText(found.container),
      path: elementPath(found.control)
    };
  }

  function normalizeSelectControl(element) {
    return (
      element?.closest?.(".area-select.next-select, .next-select.next-select-trigger, .next-select, .ant-select, .semi-select, .el-select, .tm-select, .rax-select") ||
      element?.closest?.("[role=combobox]") ||
      element
    );
  }

  function getLocationSelectControls(container) {
    if (!container) return [];
    const controls = Array.from(
      container.querySelectorAll(".area-select.next-select, .next-select.next-select-trigger, .next-select, .ant-select, .semi-select, .el-select, .tm-select, .rax-select,[role=combobox],button")
    )
      .map(normalizeSelectControl)
      .filter(Boolean)
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter(visible)
      .filter((element) => {
        if (element.matches("input[type=radio],input[type=checkbox],label")) return false;
        const text = textOf(element);
        const classText = String(element.className || "");
        return (
          element.tagName === "SELECT" ||
          isSelectLike(element) ||
          element.querySelector?.("[role=combobox]") ||
          /area-select|next-select|select|dropdown|picker|combo/i.test(classText) ||
          /请选择|浙江|金华/.test(text)
        );
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      });
    return controls;
  }

  function exactLabelElement(container, label) {
    const target = norm(label);
    return (
      Array.from(container.querySelectorAll(".name,label,.next-form-item-label,.sell-component-info-wrapper-component-child-name,span,div"))
        .filter(visible)
        .find((element) => norm(textOf(element)) === target) ||
      container
    );
  }

  function findLocationArea() {
    const candidates = [];
    const addCandidate = (element, labelElement, sourceScore = 0) => {
      if (!element || !visible(element)) return;
      const controls = getLocationSelectControls(element);
      if (controls.length < 2) return;
      const text = textOf(element);
      const rect = element.getBoundingClientRect();
      let score = sourceScore;
      if (/\bsell-location\b/.test(String(element.className || ""))) score += 80;
      if (/sell-component-info-wrapper-component-child/.test(String(element.className || ""))) score += 30;
      if (text.includes("所在地")) score += 30;
      if (text.includes("大陆及港澳台")) score += 16;
      if (controls.some((control) => /\barea-select\b/.test(String(control.className || "")))) score += 20;
      if (controls.length <= 4) score += 12;
      if (rect.width >= 280 && rect.width <= 1100) score += 8;
      if (rect.height >= 32 && rect.height <= 260) score += 10;
      score -= Math.max(0, controls.length - 4) * 8;
      score -= Math.max(0, text.length - 260) / 160;
      candidates.push({
        labelElement: labelElement || exactLabelElement(element, "所在地"),
        container: element,
        controls,
        labelText: "所在地",
        path: elementPath(element),
        score
      });
    };

    Array.from(document.querySelectorAll(".sell-location, .sell-component-info-wrapper-component-child, .sell-component-info-wrapper-component-child-wrap, .form-item, .next-form-item"))
      .filter(visible)
      .forEach((element) => addCandidate(element, exactLabelElement(element, "所在地"), 20));

    for (const candidate of labelCandidates("所在地")) {
      let current = candidate.element;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        addCandidate(current, candidate.element, 10 - depth);
      }
    }

    const seen = new Map();
    for (const item of candidates) {
      const previous = seen.get(item.container);
      if (!previous || item.score > previous.score) seen.set(item.container, item);
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score || a.controls.length - b.controls.length)[0] || null;
  }

  async function selectLocationDropdown(index, value, key) {
    if (index > 0) await sleep(680);
    const area = findLocationArea();
    if (!area) return { key, label: "所在地", ok: false, reason: "未找到所在地省市下拉区域" };
    const controls = getLocationSelectControls(area.container);
    const control = controls[index] || controls[0];
    if (!control) return { key, label: "所在地", ok: false, reason: "未找到所在地下拉控件" };
    const found = {
      ...area,
      controls,
      control,
      labelElement: area.labelElement || area.container,
      allowNearbyDropdown: true
    };
    const beforeText = readSelectedText(area.container);
    const result = await clickDropdownValue(found, value, false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    document.body.click();
    await sleep(220);
    const ok = result.ok || fieldDisplaysValue(found, value);
    return {
      key,
      label: "所在地",
      ok,
      selected: ok ? [result.text || value] : [],
      missing: ok ? [] : [value],
      beforeText,
      afterText: readSelectedText(area.container),
      path: elementPath(control)
    };
  }

  async function selectNative(select, values, multi) {
    const wanted = values.map(norm);
    const missing = [];
    for (const value of wanted) {
      const option = Array.from(select.options).find((item) => norm(item.text) === value || norm(item.value) === value);
      if (!option) {
        missing.push(value);
        continue;
      }
      if (!multi) {
        select.value = option.value;
      } else {
        option.selected = true;
      }
    }
    select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return {
      ok: missing.length === 0,
      selected: Array.from(select.selectedOptions || []).map((item) => norm(item.text)),
      missing,
      options: Array.from(select.options).map((item) => norm(item.text)).filter(Boolean)
    };
  }

  async function openDropdown(control, found = null, value = "") {
    const triggers = [
      control.matches?.(".next-select, .next-select-trigger, .ant-select, .semi-select, .el-select, .tm-select, .rax-select") ? control : null,
      control.querySelector?.(".next-select-trigger, .ant-select-selector, .semi-select-selection, .el-input, [role=combobox],button"),
      control
    ].filter(Boolean);
    const trigger = triggers[0];
    const searchInput = control.querySelector?.("input:not([type=hidden])");
    if (searchInput && !searchInput.readOnly && searchInput.value) fireInput(searchInput, "");
    let options = [];
    for (const item of triggers) {
      await trustedClickElement(item);
      await sleep(420);
      if (found) {
        const info = nearestOpenDropdownInfo(found, value);
        if (info?.options?.length && (info.optionMatch || found.container.contains(info.root) || (found.allowNearbyDropdown && info.distance < 120))) {
          return info.options;
        }
      } else {
        options = collectOptions();
        if (options.length) return options;
      }
    }
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    await sleep(180);
    options = collectOptions();
    return options;
  }

  async function openDropdownForField(found, value = "") {
    const existing = nearestOpenDropdownInfo(found, value);
    if (existing?.options?.length) {
      if (exactOption(existing.options, value) || (found.allowNearbyDropdown && existing.distance < 120) || (found.container.contains(existing.root) && !value)) {
        return { root: existing.root, options: existing.options };
      }
    }
    await openDropdown(found.control, found, value);
    let root = nearestOpenDropdownRoot(found, value);
    let options = root ? collectOptions(root) : collectOptionsForField(found);
    if (!options.length) {
      await sleep(260);
      root = nearestOpenDropdownRoot(found, value);
      options = root ? collectOptions(root) : collectOptionsForField(found);
    }
    return { root, options };
  }

  function findDropdownSearch(found, root) {
    const searchRoots = [found.control, root].filter(Boolean);
    return searchRoots
      .flatMap((item) => Array.from(item.querySelectorAll("input:not([type=hidden]),textarea,[contenteditable=true]")))
      .filter(visible)
      .find((element) => isEditable(element) && !element.readOnly);
  }

  async function searchOptionInDropdown(found, value) {
    let { root, options } = await openDropdownForField(found, value);
    let option = exactOption(options, value);
    if (option) return option;
    const search = findDropdownSearch(found, root);
    if (!search) return null;
    await trustedClickElement(search);
    const typed = await trustedReplaceText(value);
    if (!typed) {
      fireInput(search, "", { blur: false });
      await sleep(80);
      fireInput(search, value, { blur: false });
    }
    search.dispatchEvent(new KeyboardEvent("keydown", { key: value.slice(-1) || "Process", bubbles: true, composed: true }));
    search.dispatchEvent(new KeyboardEvent("keyup", { key: value.slice(-1) || "Process", bubbles: true, composed: true }));
    await sleep(720);
    root = nearestOpenDropdownRoot(found, value) || root;
    options = root ? collectOptions(root) : collectOptionsForField(found);
    option = exactOption(options, value);
    if (option) return option;
    await sleep(420);
    root = nearestOpenDropdownRoot(found, value) || root;
    options = root ? collectOptions(root) : collectOptionsForField(found);
    return exactOption(options, value);
  }

  async function clickDropdownValue(found, value, multi) {
    if (multi && hasSelectedText(found.container, value)) {
      return { ok: true, text: value, alreadySelected: true };
    }
    let { options } = await openDropdownForField(found, value);
    let option = exactOption(options, value);
    if (!option) option = await searchOptionInDropdown(found, value);
    if (!option) return { ok: false, missing: value };
    if (!multi || !option.selected) {
      await trustedClickElement(actionableElement(option.element));
      await sleep(420);
    }
    let ok = multi ? hasSelectedText(found.container, value) : fieldDisplaysValue(found, value);
    if (!ok) {
      await sleep(520);
      ok = multi ? hasSelectedText(found.container, value) : fieldDisplaysValue(found, value);
    }
    if (!ok && multi) {
      const root = nearestOpenDropdownRoot(found, value);
      const fresh = exactOption(root ? collectOptions(root) : collectOptionsForField(found), value);
      ok = Boolean(fresh?.selected);
    }
    if (!ok) {
      const retry = await searchOptionInDropdown(found, value);
      if (retry && (!multi || !retry.selected)) {
        await trustedClickElement(actionableElement(retry.element));
        await sleep(520);
        ok = multi ? hasSelectedText(found.container, value) : fieldDisplaysValue(found, value);
      }
    }
    return ok ? { ok: true, text: option.text } : { ok: false, missing: value, text: option.text };
  }

  async function clickConfirmIfPresent(found) {
    const roots = collectOptionsForField(found).map((option) => dropdownRootForOption(option.element)).filter(Boolean);
    const seen = new Set();
    for (const root of roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      const button = Array.from(root.querySelectorAll("button,[role=button],a"))
        .filter(visible)
        .find((element) => ["确定", "完成"].includes(norm(textOf(element))));
      if (button && !isFinalAction(button)) {
        await trustedClickElement(button);
        await sleep(180);
        return true;
      }
    }
    return false;
  }

  async function selectDropdownField(field) {
    const found = findDropdownControl(field);
    if (!found) {
      return { key: field.key, label: field.label, ok: false, reason: "未找到下拉控件" };
    }
    if (found.control.tagName === "SELECT") {
      const values = field.mode === "multi" ? field.values || [] : [field.value];
      return { key: field.key, label: field.label, ...(await selectNative(found.control, values, field.mode === "multi")) };
    }
    const beforeText = readSelectedText(found.container);
    const firstValue = field.mode === "multi" ? (field.values || [])[0] : field.value;
    const opened = await openDropdownForField(found, firstValue);
    let options = opened.options.length ? opened.options : collectOptionsForField(found);
    const optionTexts = options.map((option) => option.text);
    const selected = [];
    const missing = [];

    if (field.mode === "multi") {
      for (const value of field.values || []) {
        if (hasSelectedText(found.container, value)) {
          selected.push(value);
          continue;
        }
        const result = await clickDropdownValue(found, value, true);
        if (result.ok) {
          selected.push(result.text || value);
        } else {
          missing.push(value);
        }
      }
    } else {
      const result = await clickDropdownValue(found, field.value, false);
      if (result.ok) {
        selected.push(result.text || field.value);
      } else {
        missing.push(field.value);
      }
    }

    if (field.mode === "multi") await clickConfirmIfPresent(found);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    document.body.click();
    await sleep(120);
    const afterText = readSelectedText(found.container);
    return {
      key: field.key,
      label: field.label,
      ok: missing.length === 0 && (selected.length > 0 || beforeText !== afterText),
      selected,
      missing,
      options: optionTexts,
      beforeText,
      afterText,
      path: elementPath(found.control)
    };
  }

  async function setListingTime() {
    const field = PLAN.listingTime;
    const found = searchContainer(field.label);
    if (!found) return { key: "listingTime", label: field.label, ok: false, reason: "未找到上架时间字段" };
    const controls = found.controls.filter((element) => {
      const text = textOf(element);
      return text.includes(field.value) || element.getAttribute("value") === field.value;
    });
    const radio = controls.find((element) => element.matches("input[type=radio], input[type=checkbox]"));
    const clickable = controls.find((element) => visible(element)) || Array.from(found.container.querySelectorAll("label,span,div,button")).find((element) => visible(element) && textOf(element).includes(field.value));
    const target = radio || clickable;
    if (!target) {
      return { key: "listingTime", label: field.label, ok: false, reason: "未找到字段内的立刻上架选项" };
    }
    if (isFinalAction(target)) {
      return { key: "listingTime", label: field.label, ok: false, reason: "命中最终按钮保护，未点击" };
    }
    await trustedClickElement(target);
    await sleep(120);
    return { key: "listingTime", label: field.label, ok: true, value: field.value, path: elementPath(target) };
  }

  function isFinalAction(element) {
    if (!element) return false;
    const text = textOf(element);
    if (!PLAN.finalActionsBlocked.includes(text)) return false;
    const fieldContainer = element.closest("[data-tmall-auto-field], .form-item, .next-form-item, .ant-form-item, .semi-form-field, .el-form-item");
    const contextText = textOf(fieldContainer || element.parentElement);
    if (contextText.includes("上架时间") && text === "立即上架") return false;
    return true;
  }

  function installFinalButtonGuard() {
    if (window.__tmallAutoListingGuardInstalled) return;
    window.__tmallAutoListingGuardInstalled = true;
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target?.closest?.(BLOCKED_SELECTOR);
        if (!target || !visible(target)) return;
        if (isFinalAction(target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          target.setAttribute("data-tmall-auto-blocked", "true");
          console.warn("[天猫自动上架助手] 已阻止最终提交/发布类按钮：", textOf(target));
        }
      },
      true
    );
  }

  function diagnose() {
    installFinalButtonGuard();
    const bodyText = textOf(document.body);
    const fields = [...PLAN.textFields, ...PLAN.dropdownFields, PLAN.listingTime].map((field) => {
      const found = searchContainer(field.label);
      return {
        label: field.label,
        present: Boolean(found),
        controls: found?.controls.length || 0,
        text: found ? readSelectedText(found.container).slice(0, 120) : ""
      };
    });
    const finalButtons = Array.from(document.querySelectorAll(BLOCKED_SELECTOR))
      .filter(visible)
      .map((element) => textOf(element))
      .filter((text) => PLAN.finalActionsBlocked.includes(text));
    const skuSignals = ["SKU", "颜色分类", "销售规格", "价格", "库存", "商家编码", "批量导入", "价格取整"].filter((text) => bodyText.includes(text));
    const authSignals = ["登录", "验证码", "手机验证", "安全验证", "重新登录"].filter((text) => bodyText.includes(text));
    const fieldHits = fields.filter((field) => field.present).length;
    const score = fieldHits * 10 + skuSignals.length * 3 + Math.min(finalButtons.length, 5);
    return {
      ok: true,
      url: location.href,
      title: document.title,
      score,
      fields,
      finalButtons,
      skuSignals,
      authSignals,
      blockedGuard: true
    };
  }

  async function fillTextFields() {
    installFinalButtonGuard();
    const results = [];
    for (const field of PLAN.textFields) {
      results.push(await setTextField(field));
    }
    return { ok: results.every((item) => item.ok), results };
  }

  async function ensureProductTitle() {
    installFinalButtonGuard();
    const field = PLAN.textFields.find((item) => item.key === "productTitle");
    if (!field) return { ok: false, reason: "未配置商品标题" };
    const result = await setTextField(field);
    return {
      ...result,
      mode: "ensure-product-title"
    };
  }

  async function selectAttributes() {
    installFinalButtonGuard();
    const results = [];
    for (const field of PLAN.dropdownFields) {
      results.push(await selectDropdownField(field));
    }
    return { ok: results.every((item) => item.ok), results };
  }

  async function fillSalesInfo(payload) {
    installFinalButtonGuard();
    const rows = payload?.sku?.rows || [];
    const first = rows[0] || {};
    const price = String(first.integer_price ?? first.price ?? "");
    const stock = String(first.stock ?? "");
    const merchantCode = String(first.merchant_code || "");
    const results = [];
    if (price) {
      results.push(await fillNearestTextInput("一口价", price, { key: "onePrice", pattern: /一口价|价格|元/, emptyOnly: true }));
    }
    if (stock) {
      results.push(await fillNearestTextInput("商品数量", stock, { key: "quantity", pattern: /商品数量|库存|件/, emptyOnly: true }));
    }
    if (merchantCode) {
      results.push(await fillNearestTextInput("商家编码", merchantCode, { key: "merchantCode", pattern: /商家编码|0\/64/, emptyOnly: true }));
    }
    results.push(await clickFieldChoice("上架时间", PLAN.listingTime.value, { key: "listingTime", pattern: /立刻上架|定时上架|放入仓库/ }));
    results.push(await clickFieldChoice("库存扣减方式", PLAN.salesInfo.stockReduction.value, { key: "stockReduction", pattern: /拍下减库存|付款减库存/ }));
    return { ok: results.some((item) => item.ok) && results.every((item) => item.ok || /未找到/.test(item.reason || "")), results };
  }

  async function fillLogisticsInfo() {
    installFinalButtonGuard();
    const plan = PLAN.logisticsInfo;
    const results = [];
    results.push(await clickFieldChoice(plan.deliveryTime.label, plan.deliveryTime.value, { key: plan.deliveryTime.key, pattern: /今日发|48小时|大于48小时|固定发货时间/ }));
    results.push(await clickFieldChoice(plan.pickupMethod.label, plan.pickupMethod.value, { key: plan.pickupMethod.key, pattern: /电子交易凭证|邮寄/ }));
    results.push(await clickFieldChoice(plan.locationScope.label, plan.locationScope.value, { key: plan.locationScope.key, pattern: /大陆及港澳台|其他国家或地区/ }));
    results.push(await selectLocationDropdown(plan.province.dropdownIndex, plan.province.value, plan.province.key));
    results.push(await selectLocationDropdown(plan.city.dropdownIndex, plan.city.value, plan.city.key));
    results.push(await fillNearestTextInput(plan.rebateRate.label, plan.rebateRate.value, { key: plan.rebateRate.key, pattern: /返点比例|%/ }));
    return { ok: results.some((item) => item.ok) && results.every((item) => item.ok || /未找到/.test(item.reason || "")), results };
  }

  function skuToTsv(rows) {
    const header = ["颜色分类", "价格", "库存", "商家编码", "条形码"];
    const body = rows.map((row) => [
      row.sku_display_name || row.sku_name,
      row.integer_price ?? row.price ?? "",
      row.stock ?? "",
      row.merchant_code,
      row.barcode || ""
    ]);
    return [header, ...body].map((line) => line.map((cell) => String(cell ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
  }

  function findSkuArea() {
    const candidates = Array.from(document.querySelectorAll("section,form,fieldset,table,tbody,div"))
      .filter(visible)
      .map((element) => {
        const text = textOf(element);
        const rect = element.getBoundingClientRect();
        let score = 0;
        if (/SKU|销售规格|颜色分类/.test(text)) score += 8;
        if (/价格|客户到手价/.test(text)) score += 4;
        if (/库存|数量/.test(text)) score += 4;
        if (/商家编码|条形码/.test(text)) score += 4;
        if (/批量|导入|Excel|表格|上传/.test(text)) score += 4;
        if (/SKU助手|请输入指令|价格取整/.test(text)) score += 4;
        if (element.querySelector("table")) score += 2;
        if (element.querySelector("textarea,[contenteditable=true],input:not([type=hidden])")) score += 2;
        const area = Math.max(1, rect.width * rect.height);
        return { element, score, area };
      })
      .filter((item) => item.score >= 14)
      .sort((a, b) => b.score - a.score || a.area - b.area);
    return candidates[0]?.element || document.body;
  }

  function actionableElement(element) {
    return element?.closest?.("button,[role=button],a,label,[role=option],input,textarea,[contenteditable=true]") || element;
  }

  function editableValue(element) {
    if (!element) return "";
    return element.isContentEditable ? norm(element.textContent) : norm(element.value);
  }

  function dispatchSyntheticEnter(element) {
    const eventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    element.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  function localContextText(element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const text = textOf(current);
      if (text && text.length <= 600) parts.push(text);
      if (/sku|assistant|助手|next-input|toolbar/i.test(String(current.className || ""))) {
        const parentText = textOf(current.parentElement);
        if (parentText && parentText.length <= 600) parts.push(parentText);
      }
    }
    return norm(parts.join(" "));
  }

  function scoreSkuAssistantInput(element, area) {
    if (!element || !visible(element) || element.disabled || element.readOnly) return -Infinity;
    if (/^(hidden|file|checkbox|radio|button|submit|reset)$/i.test(element.type || "")) return -Infinity;
    const meta = norm([
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.id
    ].join(" "));
    const context = localContextText(element);
    const joined = `${meta} ${context}`;
    const rect = element.getBoundingClientRect();
    let score = 0;
    if (rectOverlapsViewport(rect, 4)) score += 16;
    else score -= 16;
    if (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < -200 || rect.top > window.innerHeight + 200) score -= 24;
    if (/请输入指令/.test(meta)) score += 24;
    if (/SKU助手/i.test(joined)) score += 28;
    if (/SKU/i.test(joined)) score += 8;
    if (/助手/.test(joined)) score += 8;
    if (/批量填写|更多批量|销售规格|价格|库存/.test(context)) score += 4;
    if (area?.contains?.(element)) score += 8;
    if (/客服|聊天|消息|咨询/.test(joined)) score -= 28;
    if (/一口价|商品数量|商家编码|库存扣减|返点比例/.test(joined)) score -= 18;
    if (/^-?\d+(\.\d+)?$/.test(editableValue(element))) score -= 18;
    return score;
  }

  function findSkuAssistantInput(area) {
    const selectors = [
      'input[placeholder*="请输入指令"]',
      'textarea[placeholder*="请输入指令"]',
      '[contenteditable=true][aria-label*="请输入指令"]',
      '[contenteditable=true][title*="请输入指令"]',
      'input[aria-label*="SKU助手"]',
      'textarea[aria-label*="SKU助手"]',
      '[contenteditable=true][aria-label*="SKU助手"]'
    ].join(",");
    const scopes = Array.from(new Set([area, area?.parentElement, document.body].filter(Boolean)));
    const candidates = [];
    for (const scope of scopes) {
      candidates.push(...Array.from(scope.querySelectorAll(selectors)));
    }
    return Array.from(new Set(candidates))
      .map((element) => ({ element, score: scoreSkuAssistantInput(element, area) }))
      .filter((item) => item.score >= 24)
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function findSkuAssistantExecute(input, area) {
    const roots = [];
    let current = input?.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      roots.push(current);
      if (area?.contains?.(current)) break;
    }
    if (area) roots.push(area);
    const inputRect = input.getBoundingClientRect();
    const buttons = [];
    const selector = [
      "button",
      "[role=button]",
      "a",
      "img[alt]",
      "svg",
      "i",
      ".next-input-after",
      ".next-input-inner.next-after",
      ".next-input-suffix",
      ".next-input-addon",
      ".searchExpandedActions-yf2c_s",
      "[class*=searchExpandedActions]",
      "[class*=send]",
      "[class*=Send]",
      "[class*=arrow]",
      "[class*=Arrow]"
    ].join(",");
    for (const root of Array.from(new Set(roots))) {
      buttons.push(...Array.from(root.querySelectorAll(selector)));
    }
    const centerY = inputRect.top + inputRect.height / 2;
    const pointTargets = [
      document.elementFromPoint(inputRect.right + 12, centerY),
      document.elementFromPoint(inputRect.right + 28, centerY),
      document.elementFromPoint(inputRect.right + 44, centerY),
      document.elementFromPoint(inputRect.right + 60, centerY),
      document.elementFromPoint(inputRect.right - 16, centerY)
    ].filter(Boolean);
    for (const target of pointTargets) {
      buttons.push(target, target.closest?.(selector));
    }
    const depthOf = (element) => {
      let depth = 0;
      for (let node = element; node; node = node.parentElement) depth += 1;
      return depth;
    };
    return Array.from(
      new Set(
        Array.from(new Set(buttons)).flatMap((element) => [
          element,
          ...Array.from(element?.querySelectorAll?.(selector) || [])
        ])
      )
    )
      .filter((element) => visible(element) && !element.disabled && !element.contains(input) && !isFinalAction(element))
      .map((element) => {
        const text = textOf(element);
        const rect = element.getBoundingClientRect();
        const meta = norm([
          text,
          element.getAttribute("alt"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("class")
        ].join(" "));
        const elementCenterY = rect.top + rect.height / 2;
        const sameRow = Math.abs(elementCenterY - centerY) <= Math.max(18, inputRect.height * 0.8);
        const nearRight = rect.left >= inputRect.right - 24 && rect.left <= inputRect.right + 110;
        const insideSuffix = rect.left >= inputRect.right - 96 && rect.right <= inputRect.right + 120;
        const iconSize = rect.width <= 72 && rect.height <= 72;
        const compactIcon = rect.width <= 40 && rect.height <= 40;
        const areaSize = Math.max(1, rect.width * rect.height);
        const actionMeta = /执行|发送|运行|开始|send|arrow|sendIcon|searchExpandedActions/i.test(meta);
        const genericSuffix = element.matches?.(".next-input-after,.next-input-inner.next-after,.next-input-suffix,.next-input-addon");
        const suffixAction = Boolean(element.closest?.(".searchExpandedActions-yf2c_s,[class*=searchExpandedActions]")) || Boolean(genericSuffix && isExplicitSkuAssistantSendElement(element));
        const badMeta = /应用示例|预览效果|主图|图片|素材|close|clear|delete|清除|关闭|wrapperClose|cancel/i.test(meta);
        const actionCandidate = !badMeta && sameRow && (nearRight || insideSuffix) && (actionMeta || suffixAction || (compactIcon && !genericSuffix));
        let score = 0;
        if (actionMeta) score += 28;
        if (suffixAction) score += 18;
        if (sameRow && nearRight) score += 18;
        if (sameRow && insideSuffix) score += 12;
        if (iconSize && sameRow) score += 6;
        if (compactIcon && sameRow) score += 8;
        if (rect.left >= inputRect.left - 12) score += 4;
        if (badMeta) score -= 80;
        score -= Math.min(12, areaSize / 2400);
        score -= Math.min(20, Math.abs(rect.top - inputRect.top) / 8 + Math.max(0, rect.left - inputRect.right) / 80);
        return { element, score, areaSize, depth: depthOf(element), actionCandidate };
      })
      .filter((item) => item.actionCandidate && item.score >= 18)
      .sort((a, b) => b.score - a.score || a.areaSize - b.areaSize || b.depth - a.depth)[0]?.element || null;
  }

  function tableColumnText(element) {
    const cell = element.closest("td,th,[role=cell],[role=gridcell],.next-table-cell");
    if (!cell) return "";
    const row = cell.parentElement;
    if (!row) return "";
    const cells = Array.from(row.children).filter((item) => visible(item));
    const index = cells.indexOf(cell);
    if (index < 0) return "";
    const table = row.closest("table,.next-table,[role=table],[role=grid]");
    const headers = table
      ? Array.from(table.querySelectorAll("thead th,[role=columnheader],.next-table-header th,.next-table-header .next-table-cell")).filter(visible)
      : [];
    return norm(textOf(headers[index] || ""));
  }

  function numericEditableValue(element) {
    const value = editableValue(element);
    return /^-?\d+(\.\d+)?$/.test(value) ? value : "";
  }

  function findSkuRowContainer(element) {
    let current = element;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const text = textOf(current);
      const className = String(current.className || "");
      const inputs = Array.from(current.querySelectorAll("input:not([type=hidden]),textarea")).filter((item) => visible(item) && !item.disabled);
      const numericCount = inputs.filter((item) => numericEditableValue(item)).length;
      const skuSignal = /SKU|销售规格|颜色分类|商家编码|是否上架|单品|去填写|查看|删除/.test(text) || /sku|sell-sku|next-table-row/i.test(className);
      if (skuSignal && numericCount >= 2 && text.length <= 3000) return current;
    }
    return null;
  }

  function isFirstNumericInputInSkuRow(element) {
    if (!numericEditableValue(element)) return false;
    const row = findSkuRowContainer(element);
    if (!row) return false;
    const rect = element.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const rowAlignedInputs = Array.from(row.querySelectorAll("input:not([type=hidden]),textarea"))
      .filter((item) => visible(item) && !item.disabled && numericEditableValue(item))
      .filter((item) => {
        const itemRect = item.getBoundingClientRect();
        const itemCenterY = itemRect.top + itemRect.height / 2;
        return Math.abs(itemCenterY - centerY) <= Math.max(20, rect.height * 1.4);
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.left - br.left || ar.top - br.top;
      });
    return rowAlignedInputs.length >= 2 && rowAlignedInputs[0] === element;
  }

  function collectVisibleSkuPriceInputs(area) {
    return Array.from((area || document.body).querySelectorAll("input:not([type=hidden]),textarea"))
      .filter((element) => visible(element) && !element.disabled)
      .filter(looksLikeSkuPriceInput);
  }

  function looksLikeSkuPriceInput(element) {
    const attrs = norm([
      element.id,
      element.name,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("class")
    ].join(" "));
    const cellText = textOf(element.closest("td,th,[role=cell],[role=gridcell],.next-table-cell") || element.parentElement);
    const columnText = tableColumnText(element);
    const rowText = textOf(element.closest("tr,[role=row],.next-table-row") || element.parentElement);
    const scopeText = textOf(element.closest("table,.next-table,.sku,[class*=sku],[class*=Sku]") || element.parentElement);
    const joined = norm([attrs, cellText, columnText, rowText, scopeText].join(" "));
    if (/返点|比例|%|运费|邮费|首费|续费|发货|所在地|库存扣减/.test(joined)) return false;
    if (/请输入指令|SKU助手|价格取整|searchExpandedInput|searchExpandedWrapper/.test(joined)) return false;
    if (/数量|库存|商家编码|条形码|编码/.test(norm([cellText, columnText, attrs].join(" ")))) return false;
    if (/price|价格|元|一口价|客户到手价/i.test(joined)) return true;
    if (isFirstNumericInputInSkuRow(element)) return true;
    return /SKU|销售规格|颜色分类/.test(scopeText) && !/数量|库存|商家编码|条形码|编码/.test(joined);
  }

  function visiblePriceValues(area) {
    let inputs = collectVisibleSkuPriceInputs(area);
    if (!inputs.length && area !== document.body) inputs = collectVisibleSkuPriceInputs(document.body);
    return inputs
      .map((element) => norm(element.value))
      .filter((value) => /^-?\d+(\.\d+)?$/.test(value));
  }

  function visiblePriceDecimals(area) {
    return visiblePriceValues(area).filter((value) => /\.\d+/.test(value));
  }

  function readSkuAssistantStatus(area) {
    const input = findSkuAssistantInput(area);
    const roots = [];
    let current = input?.parentElement || null;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      roots.push(current);
    }
    const statusPattern = /任务完成|已完成任务分析|正在执行指令|执行指令|SKU修改成功|任务失败|执行失败|修改失败|请求失败|稍后重试|SKU[^。|，,\n]*失败|价格取整/;
    const candidates = roots
      .map((root) => {
        const rect = root.getBoundingClientRect();
        return { root, rect, text: textOf(root) };
      })
      .filter((item) => item.text && statusPattern.test(item.text) && item.rect.width > 0 && item.rect.height > 0 && item.rect.height <= 420)
      .sort((a, b) => {
        const aStrong = /任务完成|已完成任务分析|正在执行指令|执行指令|SKU修改成功|任务失败|执行失败|修改失败|请求失败|稍后重试|SKU[^。|，,\n]*失败/.test(a.text) ? 0 : 1;
        const bStrong = /任务完成|已完成任务分析|正在执行指令|执行指令|SKU修改成功|任务失败|执行失败|修改失败|请求失败|稍后重试|SKU[^。|，,\n]*失败/.test(b.text) ? 0 : 1;
        return aStrong - bStrong || a.text.length - b.text.length;
      });
    const text = candidates[0]?.text || textOf(area);
    const matches = text.match(
      /(任务完成[^。|，,\n]*|已完成任务分析[^。|，,\n]*正在执行指令[^。|，,\n]*|正在执行指令|执行指令|价格取整|SKU修改成功|任务失败[^。|，,\n]*|执行失败[^。|，,\n]*|修改失败[^。|，,\n]*|请求失败[^。|，,\n]*|稍后重试[^。|，,\n]*|SKU[^。|，,\n]*失败[^。|，,\n]*)/g
    );
    return matches ? matches.slice(-6).join(" | ") : "";
  }

  async function waitForSkuAssistantRound(area, beforeDecimals, options = {}) {
    const attempts = options.attempts ?? 360;
    const delay = options.delay ?? 500;
    const acceptRunning = Boolean(options.acceptRunning);
    let runningObserved = Boolean(options.alreadyStarted);
    let lastDecimals = beforeDecimals;
    let status = readSkuAssistantStatus(area);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      lastDecimals = visiblePriceDecimals(area);
      if (/正在执行指令|执行指令/.test(status)) {
        runningObserved = true;
        if (acceptRunning) return { started: true, runningObserved, completed: false, status, remainingDecimals: lastDecimals.length };
      }
      if (/任务完成|修改成功/.test(status)) {
        return { started: runningObserved, runningObserved, completed: runningObserved, staleCompletion: !runningObserved, status, remainingDecimals: lastDecimals.length };
      }
      if (/任务失败|执行失败|修改失败|请求失败|稍后重试|SKU[^|]*失败/.test(status)) {
        return { started: runningObserved, runningObserved, completed: false, failed: true, status, remainingDecimals: lastDecimals.length };
      }
      await sleep(delay);
      status = readSkuAssistantStatus(area);
    }
    return { started: runningObserved, runningObserved, completed: false, status, remainingDecimals: lastDecimals.length };
  }

  async function fillSkuAssistantCommand(area, command = SKU_ASSISTANT_COMMAND, options = {}) {
    const input = findSkuAssistantInput(area);
    if (!input) return { ok: false, reason: "未找到 SKU助手指令输入框" };
    const forceSubmit = Boolean(options.forceSubmit);
    const beforeValues = visiblePriceValues(area);
    const beforeDecimals = visiblePriceDecimals(area);
    await trustedClickElement(input);
    await sleep(120);
    const trusted = await trustedReplaceText(command);
    await sleep(80);
    if (editableValue(input) !== command) {
      fireInput(input, command, { blur: false });
    } else {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    await sleep(120);
    if (!forceSubmit && beforeValues.length > 0 && !beforeDecimals.length) {
      return {
        ok: true,
        mode: "sku-prices-already-integer",
        command,
        submitted: false,
        completed: true,
        remainingDecimals: 0,
        detectedPrices: beforeValues.length,
        input: elementPath(input),
        trusted,
        note: "可见 SKU 价格已经是整数，未重复触发 SKU助手。"
      };
    }
    let pointClick = null;
    if (forceSubmit) {
      pointClick = await clickSkuAssistantSendButton(input);
      if (pointClick.clicked) await sleep(20);
    }
    const execute = findSkuAssistantExecute(input, area);
    if (execute) {
      const executePath = elementPath(execute);
      let clickedButton = Boolean(pointClick?.clicked);
      if (!clickedButton) {
        clickedButton = await trustedClickElement(execute, { allowSkuAssistant: true });
      }
      if (!clickedButton) {
        pointClick = await clickSkuAssistantSendButton(input);
        clickedButton = pointClick.clicked;
      }
      let verification = await waitForSkuAssistantRound(area, beforeDecimals, { attempts: 6, delay: 300, acceptRunning: true });
      if (!verification.started && !verification.completed) {
        if (!pointClick?.clicked) pointClick = await clickSkuAssistantSendButton(input);
        if (!pointClick.clicked) clickElement(execute, { allowSkuAssistant: true });
        await sleep(120);
        verification = await waitForSkuAssistantRound(area, beforeDecimals, { attempts: 6, delay: 300, acceptRunning: true });
      }
      if (verification.started && !verification.completed) {
        verification = await waitForSkuAssistantRound(area, beforeDecimals, { alreadyStarted: verification.runningObserved || verification.started });
      }
      if (verification.completed) {
        return {
          ok: true,
          mode: "sku-assistant-command",
          command,
          submitted: true,
          trigger: pointClick?.clicked ? "SendButtonPoint" : textOf(execute) || "SendButton",
          execute: executePath,
          pointClick,
          input: elementPath(input),
          trusted,
          detectedPrices: beforeValues.length,
          ...verification
        };
      }
      if (clickedButton || pointClick?.clicked) {
        return {
          ok: true,
          mode: "sku-assistant-command-unconfirmed",
          command,
          submitted: true,
          trigger: pointClick?.clicked ? "SendButtonPoint" : textOf(execute) || "SendButton",
          execute: executePath,
          pointClick,
          input: elementPath(input),
          trusted,
          detectedPrices: beforeValues.length,
          ...verification
        };
      }
      return {
        ok: false,
        mode: "sku-assistant-send-button-not-clicked",
        command,
        submitted: false,
        trigger: pointClick?.clicked ? "SendButtonPoint" : textOf(execute) || "SendButton",
        execute: executePath,
        pointClick,
        input: elementPath(input),
        trusted,
        detectedPrices: beforeValues.length,
        note: "未确认点击到 SKU助手右侧按钮，已停止，未使用回车作为成功兜底。"
      };
    }
    if (!pointClick?.clicked) pointClick = await clickSkuAssistantSendButton(input);
    if (pointClick.clicked) {
      let pointVerification = await waitForSkuAssistantRound(area, beforeDecimals, { attempts: 10, delay: 500, acceptRunning: true });
      if (pointVerification.started && !pointVerification.completed) {
        pointVerification = await waitForSkuAssistantRound(area, beforeDecimals, { alreadyStarted: pointVerification.runningObserved || pointVerification.started });
      }
      if (pointVerification.completed) {
        return {
          ok: true,
          mode: "sku-assistant-command",
          command,
          submitted: true,
          trigger: "SendButtonPoint",
          pointClick,
          input: elementPath(input),
          trusted,
          detectedPrices: beforeValues.length,
          ...pointVerification
        };
      }
      return {
        ok: true,
        mode: "sku-assistant-command-unconfirmed",
        command,
        submitted: true,
        trigger: "SendButtonPoint",
        pointClick,
        input: elementPath(input),
        trusted,
        detectedPrices: beforeValues.length,
        ...pointVerification
      };
    }
    return {
      ok: false,
      mode: "sku-assistant-send-button-not-found",
      command,
      submitted: false,
      trigger: "",
      pointClick,
      input: elementPath(input),
      trusted,
      detectedPrices: beforeValues.length,
      note: "未找到或未点击到 SKU助手右侧按钮，已停止，未使用回车作为成功兜底。"
    };
  }

  function base64ToUint8Array(base64) {
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function findSkuImportDialog() {
    const selectors = [
      "[role=dialog]",
      ".next-dialog",
      ".next-dialog-wrapper",
      ".next-overlay-wrapper",
      ".ant-modal",
      ".semi-modal",
      ".el-dialog",
      ".modal",
      ".dialog",
      ".drawer"
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .filter((element) => !isAssistantPanelElement(element))
      .map((element) => {
        const text = textOf(element);
        const rect = element.getBoundingClientRect();
        let score = 0;
        if (/批量导入|批量上传/.test(text)) score += 12;
        if (/AI识别导入|模板上传|确认识别/.test(text)) score += 8;
        if (/点击|拖动|粘贴|虚线框|上传|下载模板/.test(text)) score += 6;
        if (element.querySelector('input[type="file"]')) score += 10;
        if (element.querySelector("button,[role=button]")) score += 2;
        return { element, score, area: Math.max(1, rect.width * rect.height) };
      })
      .filter((item) => item.score >= 12)
      .sort((a, b) => b.score - a.score || a.area - b.area);
    if (candidates.length) return candidates[0].element;

    return Array.from(document.querySelectorAll("body div,body section"))
      .filter(visible)
      .filter((element) => !isAssistantPanelElement(element))
      .map((element) => {
        const text = textOf(element);
        const rect = element.getBoundingClientRect();
        let score = 0;
        if (/批量导入|AI识别导入/.test(text)) score += 8;
        if (/点击|拖动|粘贴|虚线框|上传/.test(text)) score += 8;
        if (element.querySelector('input[type="file"]')) score += 8;
        return { element, score, area: Math.max(1, rect.width * rect.height) };
      })
      .filter((item) => item.score >= 14)
      .sort((a, b) => b.score - a.score || a.area - b.area)[0]?.element || null;
  }

  function findUploadDropzone(root) {
    const candidates = Array.from((root || document).querySelectorAll("div,section,label,span,p"))
      .filter(visible)
      .map((element) => {
        const text = textOf(element);
        const meta = norm([text, element.className, element.id].join(" "));
        const rect = element.getBoundingClientRect();
        let score = 0;
        if (/点击|拖动|粘贴/.test(text)) score += 8;
        if (/文件|上传|虚线框/.test(text)) score += 6;
        if (/xls|xlsx|Excel|表格|SKU|下载模板/.test(text)) score += 5;
        if (/upload|drag|drop/i.test(String(element.className || ""))) score += 3;
        if (rect.width > 180 && rect.height > 60) score += 2;
        if (/应用示例|预览效果|主图|图片素材|商品图片|image-preview|picture|preview/i.test(meta) && !/SKU|批量|导入|Excel|表格|xls|xlsx/i.test(meta)) score -= 30;
        if (isAssistantPanelElement(element)) score -= 30;
        return { element, score, area: Math.max(1, rect.width * rect.height) };
      })
      .filter((item) => item.score >= 8)
      .sort((a, b) => b.score - a.score || b.area - a.area);
    return candidates[0]?.element || null;
  }

  function fileInputScore(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return -1;
    let score = 0;
    const text = [
      textOf(input),
      input.accept || "",
      input.name || "",
      input.id || "",
      input.placeholder || "",
      textOf(input.closest("label")),
      textOf(input.parentElement),
      textOf(input.closest("[role=dialog],.ant-modal,.next-dialog,.dialog"))
    ].join(" ");
    const accept = (input.accept || "").toLowerCase();
    const strongSkuSignal = /SKU|批量导入|AI识别导入|模板上传|Excel|表格|xls|xlsx/.test(text) || /xls|xlsx|excel|csv/.test(accept);
    if (/image|png|jpe?g|video/.test(accept) && !strongSkuSignal) return -1;
    if (/主图|商品图片|图片素材|应用示例|预览效果/.test(text) && !strongSkuSignal) return -1;
    if (/xls|xlsx|excel|csv/.test(accept)) score += 12;
    if (/image|png|jpe?g|video/.test(accept)) score -= 2;
    if (/SKU|批量|导入|AI识别|模板上传|Excel|表格/.test(text)) score += 10;
    if (visible(input)) score += 4;
    return score;
  }

  function findBestFileInput(root) {
    const inputs = Array.from((root || document).querySelectorAll('input[type="file"]'));
    if (!inputs.length) return null;
    return inputs
      .map((input) => ({ input, score: fileInputScore(input) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.input || null;
  }

  function fileFromUpload(upload) {
    const bytes = base64ToUint8Array(upload.base64);
    return new File([bytes], upload.name || "sku.xlsx", {
      type: upload.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      lastModified: upload.lastModified || Date.now()
    });
  }

  function setFilesOnInput(input, file) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    try {
      input.files = dataTransfer.files;
    } catch {
      Object.defineProperty(input, "files", { configurable: true, value: dataTransfer.files });
    }
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return dataTransfer;
  }

  function dispatchFileDrop(target, file, dataTransfer) {
    if (!target) return false;
    const transfer = dataTransfer || new DataTransfer();
    if (!transfer.files?.length) transfer.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      let event;
      try {
        event = new DragEvent(type, { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer });
      } catch {
        event = new Event(type, { bubbles: true, composed: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: transfer });
      }
      target.dispatchEvent(event);
    }
    let pasteEvent;
    try {
      pasteEvent = new ClipboardEvent("paste", { bubbles: true, composed: true, cancelable: true, clipboardData: transfer });
    } catch {
      pasteEvent = new Event("paste", { bubbles: true, composed: true, cancelable: true });
      Object.defineProperty(pasteEvent, "clipboardData", { value: transfer });
    }
    target.dispatchEvent(pasteEvent);
    return true;
  }

  function uploadVisibleInDialog(root, file, input) {
    const dialogText = textOf(root || document);
    const inputHasFile = input && Array.from(input.files || []).some((item) => item.name === file.name && item.size === file.size);
    return inputHasFile || dialogText.includes(file.name);
  }

  function findImportConfirmButton(root) {
    return Array.from((root || document).querySelectorAll("button,[role=button],a"))
      .filter(visible)
      .find((element) => {
        if (isFinalAction(element)) return false;
        if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        return /确认识别|开始识别|确认导入|确定/.test(textOf(element));
      });
  }

  async function clickImportConfirmIfReady(root, file, input) {
    if (!uploadVisibleInDialog(root, file, input)) return false;
    const button = findImportConfirmButton(root);
    if (!button) return false;
    await trustedClickElement(actionableElement(button));
    await sleep(650);
    return true;
  }

  function findSkuAddButton(root) {
    const searchRoot = root || findSkuImportDialog() || document;
    return Array.from(searchRoot.querySelectorAll("button,[role=button],a"))
      .filter(visible)
      .find((element) => {
        if (isFinalAction(element)) return false;
        if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        return /在当前规格后添加|添加到当前规格|确认添加|批量添加|添加/.test(textOf(element));
      });
  }

  function importDialogHasRecognizedSku(root) {
    const text = textOf(root || findSkuImportDialog() || document);
    return /已成功识别|销售属性|确认无误|当前规格后添加|已选择\s*\d+\s*个属性/.test(text);
  }

  async function clickSkuAddAfterRecognition(root) {
    const dialog = root || findSkuImportDialog();
    if (!dialog || !importDialogHasRecognizedSku(dialog)) return false;
    const button = findSkuAddButton(dialog);
    if (!button) return false;
    await trustedClickElement(actionableElement(button));
    await sleep(900);
    return true;
  }

  async function uploadSkuFile(upload, root) {
    if (!upload?.base64) return { ok: false, reason: "missing-upload-payload" };
    const dialog = findSkuImportDialog();
    const uploadRoot = dialog || root || document;
    let input = findBestFileInput(uploadRoot) || findBestFileInput(document);
    const dropzone = findUploadDropzone(uploadRoot);
    if (!input && dropzone) {
      clickElement(dropzone);
      await sleep(260);
      input = findBestFileInput(uploadRoot) || findBestFileInput(document);
    }
    if (!input && !dropzone) return { ok: false, reason: "file-input-or-dropzone-not-found" };

    const file = fileFromUpload(upload);
    const dataTransfer = input ? setFilesOnInput(input, file) : null;
    dispatchFileDrop(dropzone || input?.closest("label,div,section") || uploadRoot, file, dataTransfer);
    await sleep(250);
    const currentRoot = findSkuImportDialog() || uploadRoot;
    const received = uploadVisibleInDialog(currentRoot, file, input) || uploadVisibleInDialog(uploadRoot, file, input);
    const confirmed = received ? await clickImportConfirmIfReady(currentRoot, file, input) : false;
    let added = false;
    if (confirmed) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(500);
        added = await clickSkuAddAfterRecognition(findSkuImportDialog() || currentRoot || uploadRoot);
        if (added) break;
      }
    }
    return {
      ok: received,
      mode: added ? "uploaded-sku-file-confirmed-and-added" : confirmed ? "uploaded-sku-file-and-confirmed" : "uploaded-sku-file",
      fileName: file.name,
      fileSize: file.size,
      confirmed,
      added,
      dialogFound: Boolean(dialog),
      dropzoneFound: Boolean(dropzone),
      inputFound: Boolean(input),
      reason: received ? "" : "upload-target-did-not-accept-file"
    };
  }

  async function applySku(payload) {
    installFinalButtonGuard();
    const sku = payload?.sku;
    if (!sku?.rows?.length) {
      return { ok: false, reason: "尚未导入 SKU 表" };
    }
    if (await clickSkuAddAfterRecognition(findSkuImportDialog())) {
      return {
        ok: true,
        mode: "recognized-sku-added",
        row_count: sku.row_count,
        warning_count: sku.warning_count,
        added: true,
        note: "已点击在当前规格后添加。"
      };
    }
    const area = findSkuArea();
    const importRoot = area.closest?.(".sell-component-block,#sale-card,.com-struct,[class*=sale-card],[class*=SaleCard]") || area;
    const tsv = skuToTsv(sku.rows);
    const importButton = Array.from(
      new Set([importRoot, document].flatMap((root) => Array.from(root.querySelectorAll("button,[role=button],a,input[type=file]"))))
    )
      .filter(visible)
      .find((element) => {
        const text = norm([textOf(element), element.getAttribute("accept"), element.getAttribute("aria-label"), element.getAttribute("title"), element.className].join(" "));
        if (/主图|商品图片|图片素材|应用示例|预览效果/.test(text)) return false;
        return /批量导入|批量上传|AI识别导入|Excel|表格|SKU|xls|xlsx/.test(text);
      });
    let mode = "clipboard";
    if (importButton && !isFinalAction(importButton)) {
      await trustedClickElement(actionableElement(importButton));
      mode = "opened-import-entry";
      await sleep(250);
    }
    const uploadResult = await uploadSkuFile(payload?.skuUpload, area);
    if (uploadResult.ok) {
      return {
        ok: true,
        mode: uploadResult.mode,
        row_count: sku.row_count,
        warning_count: sku.warning_count,
        uploaded: {
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize
        },
        confirmed: uploadResult.confirmed,
        added: uploadResult.added,
        note: uploadResult.added
          ? `已将 ${uploadResult.fileName} 放入上传框，确认识别，并点击在当前规格后添加。`
          : uploadResult.confirmed
          ? `已将 ${uploadResult.fileName} 放入上传框并点击确认识别。`
          : `已将 ${uploadResult.fileName} 放入页面上传框。`
      };
    }
    const editableGrid = Array.from(area.querySelectorAll("textarea,[contenteditable=true],input:not([type=hidden])")).filter((element) => visible(element) && !element.disabled);
    const pasted = editableGrid.find((element) => element.tagName === "TEXTAREA" || element.isContentEditable);
    if (pasted) {
      fireInput(pasted, tsv);
      mode = "filled-visible-grid";
    }
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      // Clipboard may be blocked on some pages; the popup still reports the TSV preparation.
    }
    return {
      ok: true,
      mode,
      row_count: sku.row_count,
      warning_count: sku.warning_count,
      uploadReason: uploadResult.reason,
      note: mode === "opened-import-entry" ? "已打开导入入口，但未找到可注入的上传控件；SKU 表格已复制到剪贴板。" : "SKU 表格已准备到剪贴板。"
    };
  }

  async function applySkuAndRoundPrices(payload) {
    const applyResult = await applySku(payload);
    if (!applyResult.ok) return applyResult;
    const roundResult = await roundVisiblePrices(payload, { forceSubmit: true });
    return {
      ...applyResult,
      ok: roundResult?.ok !== false,
      mode: `${applyResult.mode}+round-prices`,
      rounded: roundResult,
      note: `${applyResult.note || "SKU 已上传。"} ${roundResult?.ok ? "已自动输入价格取整、点击右侧按钮，并确认价格已取整。" : "SKU助手价格取整未完成，请检查页面状态。"}`
    };
  }

  async function roundVisiblePrices(payload, options = {}) {
    installFinalButtonGuard();
    const area = findSkuArea();
    const skuRows = payload?.sku?.rows || [];
    const finalizeAssistantResult = (baseResult) => {
      const remainingDecimals = visiblePriceDecimals(area).length;
      const submittedBySendButton = Boolean(
        baseResult.submitted &&
          !/Enter/i.test(baseResult.trigger || "") &&
          (baseResult.pointClick?.clicked || baseResult.execute || /SendButton|SendButtonPoint/i.test(baseResult.trigger || ""))
      );
      const completedByAssistant = Boolean(submittedBySendButton && baseResult.completed && baseResult.runningObserved && /任务完成|修改成功/.test(baseResult.status || ""));
      const ok = completedByAssistant && remainingDecimals === 0;
      return {
        ...baseResult,
        ok,
        mode: ok ? "sku-assistant-command" : baseResult.mode || "sku-assistant-command-unconfirmed",
        changed: 0,
        remainingDecimals,
        preparedRows: skuRows.length,
        directRounded: false,
        note: ok
          ? "已点击 SKU助手右侧按钮，并等待到任务完成、SKU价格已取整。"
          : baseResult.submitted
          ? "已点击 SKU助手右侧按钮，但未等到“任务完成/SKU修改成功”状态，未把兜底改价当作成功。"
          : "未确认点击到 SKU助手右侧按钮，未把兜底改价当作成功。"
      };
    };
    let assistantCommand = null;
    for (let retry = 0; retry < 3; retry += 1) {
      assistantCommand = await fillSkuAssistantCommand(area, SKU_ASSISTANT_COMMAND, options);
      if (assistantCommand.ok && (assistantCommand.submitted || assistantCommand.completed)) {
        const finalized = finalizeAssistantResult(assistantCommand);
        finalized.retryCount = retry;
        if (finalized.ok || !/请求失败|稍后重试/.test(finalized.status || "") || retry >= 2) return finalized;
        await sleep(2500);
        continue;
      }
      if (assistantCommand.ok) {
        const finalized = finalizeAssistantResult({ ...assistantCommand, mode: "sku-assistant-command-unconfirmed" });
        finalized.retryCount = retry;
        if (finalized.ok || !/请求失败|稍后重试/.test(finalized.status || "") || retry >= 2) return finalized;
        await sleep(2500);
        continue;
      }
      break;
    }

    const remainingDecimals = visiblePriceDecimals(area).length;
    return {
      ok: false,
      mode: assistantCommand.mode || "sku-assistant-not-found",
      changed: 0,
      remainingDecimals,
      preparedRows: skuRows.length,
      directRounded: false,
      command: SKU_ASSISTANT_COMMAND,
      submitted: false,
      reason: assistantCommand.reason,
      note: assistantCommand.note || "未找到或未确认点击 SKU助手右侧按钮，已停止，未把兜底改价当作成功。"
    };
  }

  async function runPrepare(payload) {
    const steps = [];
    steps.push({ action: "diagnose", result: diagnose() });
    const authSignals = steps[0].result.authSignals || [];
    if (authSignals.length) {
      return { ok: false, stopped: "auth", authSignals, steps };
    }
    steps.push({ action: "fillTextFields", result: await fillTextFields() });
    steps.push({ action: "selectAttributes", result: await selectAttributes() });
    steps.push({ action: "setListingTime", result: await setListingTime() });
    if (payload?.sku?.rows?.length) {
      steps.push({ action: "applySkuAndRoundPrices", result: await applySkuAndRoundPrices(payload) });
      steps.push({ action: "fillSalesInfo", result: await fillSalesInfo(payload) });
    }
    steps.push({ action: "fillLogisticsInfo", result: await fillLogisticsInfo() });
    steps.push({ action: "ensureProductTitle", result: await ensureProductTitle() });
    return { ok: steps.every((step) => step.result?.ok !== false), steps, finalActionClicked: false };
  }

  const messageHandler = (message, _sender, sendResponse) => {
    if (!message || ![CONTENT_MESSAGE_TYPE, "TMALL_AUTO_LISTING"].includes(message.type)) return false;
    const payload = message.payload || {};
    (async () => {
      if (message.action === "diagnose") return diagnose();
      if (message.action === "fillText") return fillTextFields();
      if (message.action === "ensureProductTitle") return ensureProductTitle();
      if (message.action === "selectAttrs") return selectAttributes();
      if (message.action === "setTime") return setListingTime();
      if (message.action === "applySku") return applySkuAndRoundPrices(payload);
      if (message.action === "applySkuOnly") return applySku(payload);
      if (message.action === "roundPrices") return roundVisiblePrices(payload, { forceSubmit: true });
      if (message.action === "fillSalesInfo") return fillSalesInfo(payload);
      if (message.action === "fillLogisticsInfo") return fillLogisticsInfo(payload);
      if (message.action === "runPrepare") return runPrepare(payload);
      return { ok: false, reason: `未知动作：${message.action}` };
    })()
      .then((result) => sendResponse({ contentScriptVersion: CONTENT_SCRIPT_VERSION, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  };
  window.__tmallAutoListingMessageHandler = messageHandler;
  chrome.runtime.onMessage.addListener(messageHandler);
})();
