// Break-fix D: friends never see Gemini or Claude in Activity, invite links work while the app is open, long emails fit the invite sheet.
// Run: node tests/breakfix-d.mjs
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-breakfix-d-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
async function newPage(bc, name, path = "", viewport) {
  const p = await bc.newPage();
  if (viewport) await p.setViewportSize(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
  await p.goto(URL0 + path);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, name) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", name);
  await p.fill("[name=destination]", name);
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  return p.evaluate(() => window.__tripCtx.S.tripId);
}
const demoState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("tripplanner-demo-v1")));

try {
  console.log("Activity feed wording");
  const bc = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const f = await newPage(bc, "Fran", "?noai");
  await makeTrip(f, "Goa");
  const lines = ["connected Gemini", "disconnected Gemini", "asked Claude for 2 changes", "used Gemini's plan for Day 1", "asked Gemini for top-rated places (5 found)", "applied Claude\u2019s suggestion: Start earlier", "added a stop"];
  await f.evaluate(async (ls) => {
    const S = window.__tripCtx.S;
    for (const text of ls) await S.store.log(S.tripId, { at: Date.now(), by: S.me.email, byName: S.me.name, text });
  }, lines);
  await f.click(".tabs-desk [data-tab=changes]");
  await f.waitForFunction(() => document.querySelectorAll(".feed li:not(.feed-day)").length >= 7);
  const feed = await f.textContent(".feed");
  ok(!/Gemini|Claude/i.test(feed), "a friend's Activity feed has no Gemini or Claude");
  ok(/changed the planner settings/.test(feed) && !/connected the planner/.test(feed), "connect and disconnect lines become 'changed the planner settings'");
  ok(/asked the planner for 2 changes/.test(feed) && /used the planner's plan for Day 1/.test(feed), "other lines read as 'the planner'");
  ok(/added a stop/.test(feed), "ordinary lines are untouched");

  const a = await newPage(await b.newContext({ viewport: { width: 1200, height: 900 } }), "Akash");
  await makeTrip(a, "Rome");
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    for (const text of ["connected Gemini", "used Gemini's plan for Day 1"]) await S.store.log(S.tripId, { at: Date.now(), by: S.me.email, byName: S.me.name, text });
  });
  await a.click(".tabs-desk [data-tab=changes]");
  await a.waitForFunction(() => document.querySelectorAll(".feed li:not(.feed-day)").length >= 2);
  const af = await a.textContent(".feed");
  ok(/connected Gemini/.test(af) && /used Gemini's plan for Day 1/.test(af), "an AI user's feed is unchanged");

  console.log("invite link opened while the app is already open");
  const bcJ = await b.newContext({ viewport: { width: 390, height: 800 } });
  const o = await newPage(bcJ, "Olive", "?noai");
  const lisbonId = await makeTrip(o, "Lisbon");
  await o.click("[data-action=invite]");
  await o.click("[data-action=joinMake]");
  await o.waitForSelector("input.join-url");
  const url = await o.inputValue("input.join-url");
  const code = url.split("#join=")[1];
  await o.keyboard.press("Escape");

  const fr = await newPage(bcJ, "Finn", "?noai");
  await fr.waitForSelector("[data-action=newTrip]");
  await fr.evaluate((c) => { location.hash = "#join=" + c; }, code);
  await fr.waitForFunction((id) => window.__tripCtx.S.tripId === id, lisbonId, { timeout: 10000 });
  ok(true, "pasting #join=code into an open, signed-in app opens the trip");
  ok(/You've joined Lisbon/.test(await fr.evaluate(() => document.getElementById("toast").textContent)), "toast says You've joined Lisbon");
  ok(!/join=/.test(await fr.evaluate(() => location.hash)), "the code is removed from the address");
  const st = await demoState(fr);
  ok(st.trips[lisbonId].members.length === 2, "Finn is now a member");

  console.log("#trip=<id> while open");
  await fr.evaluate(() => document.getElementById("homeBtn").click());
  await fr.waitForSelector("[data-action=newTrip]");
  await fr.evaluate((id) => { location.hash = "#trip=" + id; }, lisbonId);
  await fr.waitForFunction((id) => window.__tripCtx.S.tripId === id, lisbonId, { timeout: 5000 });
  ok(true, "#trip=<id> for one of my trips opens it");
  await fr.evaluate(() => document.getElementById("homeBtn").click());
  await fr.waitForSelector("[data-action=newTrip]");
  await fr.evaluate(() => { location.hash = "#trip=nosuchtrip123"; });
  await fr.waitForFunction(() => /haven't been invited/.test(document.getElementById("toast").textContent), null, { timeout: 5000 });
  ok(true, "#trip=<id> for a trip I'm not on says so");

  console.log("long email in the invite sheet");
  const long = "a".repeat(150) + "@example.com";
  await o.evaluate(async (e) => {
    const S = window.__tripCtx.S;
    await S.store.txTrip(S.tripId, (cur) => ({ members: [...cur.members, e] }));
  }, long);
  for (const [label, vp] of [["phone 390px", { width: 390, height: 800 }], ["desktop", { width: 1200, height: 900 }]]) {
    await o.setViewportSize(vp);
    await o.click("[data-action=invite]");
    await o.waitForSelector(".members li");
    await o.waitForFunction((e) => document.querySelector(".members").textContent.includes(e), long);
    const r = await o.evaluate(() => {
      const d = document.querySelector("dialog[open]"), li = [...document.querySelectorAll(".members li")].pop();
      const save = d.querySelector("button[value=ok]"), sb = save.getBoundingClientRect(), db = d.getBoundingClientRect();
      return { liOver: li.scrollWidth > li.clientWidth + 1, dlgOver: d.scrollWidth > d.clientWidth + 1, pageOver: document.documentElement.scrollWidth > innerWidth, saveIn: sb.width > 0 && sb.left >= 0 && sb.right <= innerWidth + 1 && sb.left >= db.left - 1 && sb.right <= db.right + 1 };
    });
    ok(!r.liOver && !r.dlgOver && !r.pageOver, `${label}: the long email wraps, nothing overflows`);
    ok(r.saveIn, `${label}: the Save button stays visible`);
    await o.keyboard.press("Escape");
  }
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll breakfix-d checks passed");
process.exit(fails ? 1 : 0);
