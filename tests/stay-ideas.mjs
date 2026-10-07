// Hotel suggestions from Claude (changes + picks) when the map can't find the place: they still land in Ideas; category words like "hotel" map to "stay".
// Run: node tests/stay-ideas.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-stay-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "nominatim.openstreetmap.org") {
      const miss = /Homestay|Estate/i.test(decodeURIComponent(u.searchParams.get("q") || ""));
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(miss ? [] : [{ lat: "12.95", lon: "75.78" }]) });
    }
    return r.fulfill({ status: 404, body: "" });
  });
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Sakleshpur");
  await p.fill("[name=destination]", "Sakleshpur");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");

  console.log("changes: stays the map can't find");
  await p.evaluate(async () => {
    const m = await import("./bridge.js");
    await m.ingest({ kind: "changes", summary: "Hotels", ops: [
      { type: "add", place: { name: "The Hosahalli Estate", category: "hotel", location: "Hosahalli Estate, Sakleshpur" }, toDay: null },
      { type: "add", place: { name: "Jenukallu Homestay", category: "Homestay", location: "Jenukallu Homestay, Sakleshpur" }, toDay: null },
      { type: "add", place: { name: "Misty Hills Homestay", category: "stay", location: "Misty Hills Homestay, Sakleshpur" }, toDay: 1 },
      { type: "add", place: { name: "Manjarabad Fort", category: "sight", location: "Manjarabad, Sakleshpur" }, toDay: 1 }] });
  });
  await p.waitForSelector("[data-action=chgOpen]");
  await p.click("[data-action=chgOpen]");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /changes? applied/.test(document.getElementById("toast").textContent), null, { timeout: 40000 });
  const toast = await p.textContent("#toast");
  ok(/^4 changes applied/.test(toast), "toast says 4 changes applied: " + toast);
  ok(/without a map pin/.test(toast) && /so it's in Ideas/.test(toast), "toast carries the notes");
  await p.waitForTimeout(500);
  const items = await p.evaluate(() => Object.fromEntries(window.__tripCtx.S.items.map((i) => [i.title, { cat: i.category, dayId: i.dayId, lat: i.lat }])));
  const day1 = await p.evaluate(() => window.__tripCtx.S.trip.days[0].id);
  ok(Object.keys(items).length === 4, "all 4 items exist");
  ok(["The Hosahalli Estate", "Jenukallu Homestay", "Misty Hills Homestay"].every((n) => items[n] && !items[n].dayId && items[n].cat === "stay"), "the 3 stays are in Ideas as category stay");
  ok(items["The Hosahalli Estate"]?.lat == null, "unfound stay has no map pin");
  ok(items["Manjarabad Fort"]?.dayId === day1 && items["Manjarabad Fort"].lat === 12.95, "the found sight is on day 1 with a pin");
  await p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "ideas"; c.render(); });
  await p.waitForTimeout(300);
  const ideas = await p.textContent(".tab-body");
  ok(["The Hosahalli Estate", "Jenukallu Homestay", "Misty Hills Homestay"].every((n) => ideas.includes(n)), "Ideas tab shows the hotel names");

  console.log("picks: category words");
  await p.evaluate(async () => {
    const m = await import("./bridge.js");
    await m.ingest({ kind: "picks", items: [{ name: "Hill View Hotel", category: "hotel" }, { name: "Green Homestay", category: "Homestay" }, { name: "Falls", category: "waterfall" }, { name: "Odd", category: "zzz" }] });
  });
  await p.waitForFunction(() => window.__tripCtx.S.trip.aiPicks?.items?.length === 4, null, { timeout: 10000 });
  const cats = await p.evaluate(() => Object.fromEntries(window.__tripCtx.S.trip.aiPicks.items.map((i) => [i.name, i.category])));
  ok(cats["Hill View Hotel"] === "stay" && cats["Green Homestay"] === "stay", "hotel and Homestay picks become stay");
  ok(cats["Falls"] === "nature" && cats["Odd"] === "sight", "waterfall is nature; unknown stays sight");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll stay-ideas checks passed");
process.exit(fails ? 1 : 0);
