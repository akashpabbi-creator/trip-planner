// Local MCP Apps host for the connector cards: renders a card's HTML (from `resources/read`) in a sandboxed iframe, speaks the
// host side of the protocol (ui/initialize, tool-result, size changes, tools/call) and screenshots it light and dark at 360px and desktop.
// Usage: node tests/mcp-card-host.mjs <card.html> <structuredContent.json> <outDir> [name]
//   Env: CARD_ORIGIN (default http://127.0.0.1:8799, the origin baked into the HTML), CARD_TOOLS (JSON file: { toolName: result }) for button taps.
// Also exported: renderCard(...) so a card test can drive taps and assert on the DOM.
import { readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, "../mcp/src/ui/vendor/ext-apps-1.7.5.txt"), "utf8");
const { chromium } = createRequire(import.meta.url)("playwright");

const HOST_PAGE = `<!doctype html><html><body style="margin:0;background:Canvas;color-scheme:light dark"><iframe id="f" sandbox="allow-scripts" style="border:0;width:100%;height:80px;display:block"></iframe></body></html>`;

export async function renderCard({ html, data, width = 360, height = 780, dark = false, origin = "http://127.0.0.1:8799", tools = {}, fullscreen = false }) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 })).newPage();
  const calls = [];
  await page.route(origin + "/ui/app.js", (r) => r.fulfill({ contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: bundle }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("http://host.test/", (r) => r.fulfill({ contentType: "text/html", body: HOST_PAGE }));
  await page.goto("http://host.test/");
  // The host side runs in the page: it answers the card's requests and records tool calls.
  await page.exposeFunction("__tool", (name, args) => { calls.push({ name, args }); return tools[name] ?? { content: [{ type: "text", text: "{}" }] }; });
  await page.evaluate(({ html, data, dark }) => {
    const f = document.getElementById("f");
    window.addEventListener("message", async (ev) => {
      if (ev.source !== f.contentWindow) return;
      const m = ev.data || {};
      const reply = (result) => f.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, result }, "*");
      if (m.method === "ui/initialize") {
        reply({ protocolVersion: m.params.protocolVersion, hostInfo: { name: "harness", version: "1" }, hostCapabilities: { serverTools: {}, openLinks: {}, displayMode: {} },
          hostContext: { theme: dark ? "dark" : "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"], safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } } });
      } else if (m.method === "ui/notifications/initialized") {
        f.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "{}" }], structuredContent: data } }, "*");
      } else if (m.method === "ui/notifications/size-changed") {
        if (m.params?.height) f.style.height = Math.ceil(m.params.height) + "px";
      } else if (m.method === "tools/call") {
        reply(await window.__tool(m.params.name, m.params.arguments));
      } else if (m.method === "ui/open-link") { window.__opened = (window.__opened || []).concat(m.params.url); reply({}); }
      else if (m.method === "ui/request-display-mode") reply({ mode: m.params.mode });
      else if (m.id !== undefined) reply({});
    });
    f.srcdoc = html;
  }, { html, data, dark });
  const frame = page.frameLocator("#f");
  await frame.locator("#root > *:not(.t-skel)").first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  return { page, frame, calls, opened: () => page.evaluate(() => window.__opened || []), close: () => browser.close() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [htmlPath, dataPath, outDir, name = "card"] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const html = readFileSync(htmlPath, "utf8"), data = JSON.parse(readFileSync(dataPath, "utf8"));
  const tools = process.env.CARD_TOOLS ? JSON.parse(readFileSync(process.env.CARD_TOOLS, "utf8")) : {};
  for (const [label, width, dark] of [["phone-light", 360, false], ["phone-dark", 360, true], ["desktop-light", 900, false], ["desktop-dark", 900, true]]) {
    const r = await renderCard({ html, data, width, dark, tools, origin: process.env.CARD_ORIGIN });
    await r.page.locator("#f").screenshot({ path: join(outDir, `${name}-${label}.png`) });
    console.log("wrote", `${name}-${label}.png`);
    await r.close();
  }
}
