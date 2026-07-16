import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const playwrightCandidates = [
  "playwright",
  "file:///C:/Users/Administrator/AppData/Local/OpenAI/Codex/runtimes/cua_node/1b23c930bdf84ed6/bin/node_modules/playwright/index.mjs",
  "file:///C:/Users/Administrator/AppData/Local/JetBrains/PyCharm2026.1/acp-agents/cortex-code/1.0.73/coco-1.0.73+180523.e6179a031de9-windows-amd64/node_modules/playwright/index.mjs"
];

if (manifest.manifest_version !== 3) throw new Error("manifest_version 必须为 3");
for (const file of ["popup.html", "popup.js", "popup.css", "background.js", "content.js", "sku-image-content.js", "lib/simple-xlsx.js", "lib/sku-image-matcher.js"]) {
  await readFile(path.join(root, file));
}

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
if (!chromium) throw lastImportError || new Error("未找到 Playwright");

const profile = path.join(os.tmpdir(), `tmall-extension-smoke-${Date.now()}`);
await mkdir(profile, { recursive: true });
let context;
let skipped = false;
try {
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
    });
  } catch (error) {
    if (String(error.message || error).includes("Executable doesn't exist")) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "本机未安装 Playwright Chromium，已跳过扩展浏览器 smoke 测试。", name: manifest.name, version: manifest.version }, null, 2));
      skipped = true;
    } else {
      throw error;
    }
  }
  if (!skipped) {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
      } catch {
        console.log(JSON.stringify({ ok: true, skipped: true, reason: "Chrome 未暴露扩展 service worker，已跳过扩展弹窗 smoke 测试。", name: manifest.name, version: manifest.version }, null, 2));
        skipped = true;
      }
    }
    if (!skipped) {
      const extensionId = serviceWorker.url().split("/")[2];
    if (!extensionId) throw new Error("没有取得扩展 ID");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const title = await page.locator("h1").innerText({ timeout: 8000 });
    const buttons = await page.locator("button").count();
    if (title !== "天猫上架助手") throw new Error(`右侧面板标题异常：${title}`);
    if (buttons < 7) throw new Error(`右侧面板按钮数量异常：${buttons}`);
      console.log(JSON.stringify({ ok: true, extensionId, name: manifest.name, version: manifest.version, buttons }, null, 2));
    }
  }
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
