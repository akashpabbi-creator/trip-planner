// "Merge duplicates" in Ideas: copies of one spot (accents, case, "The …") fold into one card with Undo; a repeat from a link adds no card.
// Run: node tests/dedupe-app.mjs   (copies the repo to a temp dir in demo mode; other hosts are mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-dedupe-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const d = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
d.on("pageerror", (e) => errors.push(e.stack));
await d.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.request().url().includes("nominatim")
  ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "41.9", lon: "12.49" }]) })
  : r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
try {
  await d.goto(`http://127.0.0.1:${PORT}/`);
  await d.fill("#demoName", "Akash");
  await d.click("[data-action=signin]");
  await d.click("[data-action=newTrip]");
  await d.fill("[name=name]", "Italy");
  await d.fill("[name=destination]", "Rome");
  await d.fill("[name=numDays]", "3");
  await d.click("#modalForm button[value=ok]");
  await d.waitForSelector(".tab-body");
  const add = (p) => d.evaluate((p) => window.__tripCtx.S.store.addItem(window.__tripCtx.S.tripId, { category: "food", dayId: null, order: 0, durationMin: 60, cost: 0, notes: "", ...p, addedAt: Date.now() }), p);
  await add({ title: "100 Tiramisù", notes: "Tip: go early", addedAt: 1 });
  await add({ title: "100 tiramisu", notes: "Closed Mondays", url: "https://x.example/reel1" });
  await add({ title: "The 100 Tiramisù", description: "Famous dessert" });
  await add({ title: "Trevi Fountain", category: "sight" });
  await d.waitForFunction(() => window.__tripCtx.S.items.length === 4);
  await d.evaluate(() => { window.__tripCtx.S.tab = "ideas"; window.__tripCtx.render(); });
  ok(/2 spots are saved more than once/.test(await d.textContent(".dup-bar")), "banner counts the extra copies");
  await d.click("[data-action=mergeDups]");
  await d.waitForFunction(() => window.__tripCtx.S.items.length === 2);
  const m = await d.evaluate(() => window.__tripCtx.S.items.find((i) => /tiramis/i.test(i.title)));
  ok(/go early/.test(m.notes) && /Closed Mondays/.test(m.notes) && m.url === "https://x.example/reel1" && m.description === "Famous dessert", "kept every tip, the link and the description: " + m.notes);
  ok(await d.locator(".dup-bar").count() === 0, "banner gone");
  await d.click("#toast button.link");
  await d.waitForFunction(() => window.__tripCtx.S.items.length === 4);
  ok(true, "Undo brings the copies back");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
} catch (e) {
  fails++;
  console.log("  FAIL exception", e.stack);
} finally {
  await b.close();
  srv.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
