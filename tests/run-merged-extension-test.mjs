import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const background = await readFile(path.join(root, "background.js"), "utf8");
const popup = await readFile(path.join(root, "popup.html"), "utf8");
const popupCss = await readFile(path.join(root, "popup.css"), "utf8");
const popupJs = await readFile(path.join(root, "popup.js"), "utf8");

test("merged manifest loads auto listing and SKU image modules", () => {
  const scripts = manifest.content_scripts?.[0]?.js || [];
  assert.ok(scripts.includes("content.js"));
  assert.ok(scripts.includes("sku-image-content.js"));
  assert.ok(scripts.includes("lib/sku-image-matcher.js"));
  assert.ok(manifest.permissions.includes("debugger"));
  assert.ok(manifest.permissions.includes("clipboardWrite"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel?.default_path, "popup.html");
  assert.equal(manifest.action?.default_popup, undefined);
  assert.equal(manifest.minimum_chrome_version, "114");
  assert.ok(manifest.host_permissions.includes("file:///*"));
  assert.ok(manifest.content_scripts?.[0]?.matches?.includes("https://*.m.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.m.taobao.com/*"));
});

test("background keeps the two popup message channels separated", () => {
  assert.match(background, /TMALL_AUTO_LISTING_POPUP/);
  assert.match(background, /TMALL_SKU_IMAGE_FILL_POPUP/);
  assert.match(background, /TMALL_AUTO_LISTING_V3/);
  assert.match(background, /TMALL_SKU_IMAGE_FILL_V4/);
  assert.match(background, /mapPointToTopFrame/);
  assert.match(background, /frame-rect-not-found/);
  assert.match(background, /openPanelOnActionClick:\s*true/);
});

test("popup exposes both auto listing and SKU image controls", () => {
  assert.match(popup, /id="runPrepare"/);
  assert.match(popup, /id="skuImageFillPage"/);
  assert.match(popup, /id="skuImageOpenDialog"/);
  assert.match(popup, /按图片名尺寸填充/);
  assert.match(popupCss, /height:\s*100vh/);
  assert.doesNotMatch(popupCss, /max-width:\s*390px/);
  assert.match(popupJs, /chrome\.tabs\?\.onActivated/);
  assert.match(popupJs, /tmallAutoListingPanelSettings/);
});

test("popup renders both sections with a mocked chrome runtime", async (t) => {
  const candidates = [
    "playwright",
    "file:///C:/Users/Administrator/AppData/Local/OpenAI/Codex/runtimes/cua_node/1b23c930bdf84ed6/bin/node_modules/playwright/index.mjs",
    "file:///C:/Users/Administrator/AppData/Local/JetBrains/PyCharm2026.1/acp-agents/cortex-code/1.0.73/coco-1.0.73+180523.e6179a031de9-windows-amd64/node_modules/playwright/index.mjs"
  ];
  let chromium;
  for (const candidate of candidates) {
    try {
      ({ chromium } = await import(candidate));
      break;
    } catch {
      // Try the next bundled Playwright path.
    }
  }
  if (!chromium) {
    t.skip("未找到 Playwright，跳过弹窗渲染校验。");
    return;
  }

  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  try {
    await access(chromePath);
  } catch {
    t.skip("未找到本机 Chrome，跳过弹窗渲染校验。");
    return;
  }

  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.addInitScript(() => {
      globalThis.chrome = {
        runtime: {
          sendMessage: async (message) => {
            if (message?.type === "TMALL_SKU_IMAGE_FILL_POPUP") {
              return {
                ok: true,
                diagnostics: [{
                  ok: true,
                  mainSkuCount: 2,
                  mainFilledImageCount: 0,
                  dialogSkuCount: 0,
                  dialogImageCount: 0
                }]
              };
            }
            return {
              ok: true,
              tab: { title: "mock publish page" },
              diagnostics: [{
                ok: true,
                frameId: 0,
                fields: [{ present: true }, { present: true }]
              }]
            };
          }
        },
        storage: {
          local: {
            get: async () => ({
              tmallAutoListingSku: { ok: true, sheet: "SKU", valid_row_count: 2, row_count: 2, warning_count: 0 },
              tmallAutoListingPanelSettings: { skuImageMaxRows: 88, skuImageConfidence: 0.81 }
            }),
            set: async () => {}
          }
        }
      };
    });
    await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
    await page.waitForSelector("#skuImageFillPage");
    assert.equal(await page.locator("h1").innerText(), "天猫上架助手");
    assert.equal(await page.locator("#runPrepare").isVisible(), true);
    assert.equal(await page.locator("#skuImageFillPage").isVisible(), true);
    assert.match(await page.locator("#skuImagePagePlanStatus").innerText(), /主表SKU 2/);
    assert.equal(await page.locator("#skuImageMaxRows").inputValue(), "88");
    assert.equal(await page.locator("#skuImageConfidenceValue").textContent(), "0.81");

    for (const viewport of [
      { width: 320, height: 800 },
      { width: 390, height: 900 },
      { width: 520, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        buttonsFit: Array.from(document.querySelectorAll("button")).every((button) => button.scrollWidth <= button.clientWidth + 1)
      }));
      assert.equal(layout.scrollWidth, layout.clientWidth, `horizontal overflow at ${viewport.width}px`);
      assert.equal(layout.buttonsFit, true, `button text overflow at ${viewport.width}px`);
    }
  } finally {
    await browser.close();
  }
});
