// Connector card (More, Connector): shows the address, lists connected apps from the Worker, disconnects one or all.
// Run: node tests/connector.mjs   (demo mode copy of the repo; the Worker is mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const W = "https://trips-mcp.test.workers.dev";

const dir = mkdtempSync(join(tmpdir(), "tp-conn-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git" "${dir}/mcp/node_modules"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
writeFileSync(join(dir, "mcp-config.js"), `window.MCP_ORIGIN = "${W}";\n`);
const PORT = 8990 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const br = await chromium.launch();
const errors = [];
try {
  const c = await br.newContext({ viewport: { width: 420, height: 900 } });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.stack));
  p.on("dialog", (d) => d.accept());
  let grants = [{ id: "g1", client: "Claude", since: Date.UTC(2026, 9, 23) }, { id: "g2", client: "Gemini", since: Date.UTC(2026, 9, 24) }];
  const calls = [];
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== W) return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push([u.pathname, body]);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === "/connections") return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ connections: grants }) });
    const mine = body.id ? grants.filter((g) => g.id === body.id) : grants;
    grants = grants.filter((g) => !mine.includes(g));
    return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ revoked: mine.length }) });
  });
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Goa trip"); await p.fill("[name=destination]", "Goa"); await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");

  await p.evaluate(() => { const c = window.__tripCtx; c.S.aiUser = false; c.S.moreOpen = true; c.render(); });
  ok(await p.locator("[data-action=connectorOpen]").count() === 0, "no Connector entry for non-AI users");
  await p.evaluate(() => { const c = window.__tripCtx; c.S.aiUser = true; c.S.store.idToken = async () => "tok123"; c.S.moreOpen = true; c.render?.(); });
  await p.evaluate(() => window.__tripCtx.render());
  await p.locator(".more-sheet [data-action=connectorOpen]").click();
  await p.waitForSelector(".cn-row");
  ok(await p.inputValue(".cn-url input") === W + "/mcp", "shows the connector address");
  ok(await p.locator(".cn-row").count() === 2, "lists both connected apps");
  ok(calls[0][0] === "/connections" && calls[0][1].idToken === "tok123", "asks the Worker with the sign-in token");
  await p.locator(".cn-row").first().locator("button").click();
  await p.waitForFunction(() => document.querySelectorAll(".cn-row").length === 1);
  ok(calls.some(([pth, b]) => pth === "/disconnect" && b.id === "g1"), "disconnect sends that connection's id");
  ok(await p.locator(".cn-row").innerText().then((t) => /Gemini/.test(t)), "the other one stays");
  await p.locator(".cn-row button").click();
  await p.waitForSelector("text=Nothing is connected yet");
  ok(true, "empty state after the last one is cut");
} finally {
  await br.close();
  srv.kill();
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
