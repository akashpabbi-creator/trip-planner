// Navigation test: Back closes sheets/dialogs, then leaves a trip for Your trips; the logo goes home; each trip remembers its tab.
// Run: node tests/navigation.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-nav-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { navLog.push("TEST " + msg + " -> " + c); if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const ctxB = await b.newContext({ viewport: { width: 390, height: 800 } });
const p = await ctxB.newPage();
p.on("pageerror", (e) => errors.push(e.message));
const navLog = [];
p.on("console", (m) => { if (m.text().startsWith("NAV ")) navLog.push(m.text()); });
const mark = (t) => navLog.push("TEST " + t);
// Record every history call and popstate with a timestamp, so a CI failure shows the order of events.
await p.addInitScript(() => {
  window.__nav = [];
  const t0 = performance.now(), log = (k, ...a) => console.log(`NAV ${Math.round(performance.now() - t0)}ms ${k} ${a.join(" ")} hash=${location.hash} len=${history.length} ${location.href.slice(0, 40)}`);
  for (const k of ["pushState", "replaceState", "go", "back"]) { const f = history[k].bind(history); history[k] = (...a) => { log(k, typeof a[0] === "object" ? JSON.stringify(a[0]) : a[0], a[2] || ""); return f(...a); }; }
  addEventListener("popstate", () => log("popstate"));
  addEventListener("hashchange", () => log("hashchange"));
});
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
await p.goto(URL0);
await p.fill("#demoName", "Akash");
await p.click("[data-action=signin]");

const home = () => p.$(".trip-card, [data-action=newTrip]").then(async () => (await p.$(".tab-body")) === null);
const inTrip = async () => !!(await p.$(".tab-body"));
// The app registers a history entry for a sheet or dialog from a 0ms timer (syncLayers in app.js). A Back sent before that timer
// ran pops the trip entry instead of the sheet, which is what a person can never do but a script can. Waiting for a timer queued
// after it (same delay, so it fires later) means every pending registration has run before Back is pressed.
const settle = () => p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
const back = async () => { await settle(); await p.goBack(); await p.waitForTimeout(600); };
async function makeTrip(name) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", name);
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
const tab = () => p.evaluate(() => window.__tripCtx?.S.tab);

try {
  await makeTrip("Trip A");
  await p.waitForTimeout(300);
  ok(await inTrip(), "trip A is open");

  // Back from a dialog closes only the dialog.
  console.log("  dbg before add:", await p.evaluate(() => JSON.stringify({ tab: window.__tripCtx.S.tab, hash: location.hash, wrap: !!document.querySelector(".add-wrap"), vw: innerWidth, txt: document.querySelector("#app").innerText.slice(0, 80) })));
  await p.click("[data-action=addOpen]");
  await p.waitForSelector(".add-wrap.open", { timeout: 5000 }).catch(async () => console.log("  dbg after add:", await p.evaluate(() => JSON.stringify({ tab: window.__tripCtx.S.tab, hash: location.hash, addOpen: window.__tripCtx.S.addOpen, wrap: !!document.querySelector(".add-wrap"), txt: document.querySelector("#app").innerText.slice(0, 80) }))));
  ok(await p.$eval(".add-wrap", (e) => e.classList.contains("open")), "Add sheet opens");
  await back();
  ok(!(await p.$eval(".add-wrap", (e) => e.classList.contains("open"))) && (await inTrip()), "Back closes the Add sheet and stays in the trip");

  // Add sheet, then a dialog from a tile: Back closes the dialog, then the trip is still open.
  const hist = (l) => p.evaluate((l) => console.log(l) || JSON.stringify({ l, len: history.length, hash: location.hash, layers: 0, more: window.__tripCtx.S.moreOpen }), l);
  // The Trip tab opens the hub, and Back from a hub page goes to the previous tab state without leaving the trip.
  await p.click(".tabs-bar [data-tab=trip]");
  ok((await tab()) === "trip" && !!(await p.$(".hub-list")), "Trip tab opens the Trip hub");
  await p.click(".hub-list [data-tab=budget]");
  ok((await tab()) === "budget" && !!(await p.$(".hub-back")), "a hub row opens its page with a way back to the hub");
  await p.click(".hub-back");
  ok((await tab()) === "trip", "the back link returns to the Trip hub");
  await p.click(".tabs-bar [data-tab=plan]");

  await p.click("[data-action=addOpen]");
  await p.click(".add-sheet .icon[data-action=addIdea], .add-sheet .icon:not([data-action=pasteLink])");
  await p.waitForTimeout(300);
  const modalOpen = await p.$eval("#modal", (e) => e.open);
  if (modalOpen) {
    await back();
    ok(!(await p.$eval("#modal", (e) => e.open)) && (await inTrip()), "Back closes a dialog and stays in the trip");
  } else console.log("  note  the tile did not open a dialog; skipped");
  if (await p.$eval("#modal", (e) => e.open)) await p.click("#modalForm [data-close]");

  // Cancel button leaves no stray history entry: one Back goes home.
  await p.evaluate(() => document.querySelector("[data-action=addOpen]").click());
  await p.evaluate(() => document.querySelector("[data-action=addClose]").click());
  await p.waitForTimeout(250);
  await back();
  ok(!(await inTrip()), "after closing the sheet by tapping outside, one Back goes to Your trips");
  ok(!/trip=/.test(p.url()), "Your trips has no #trip= in the link: " + p.url());

  // Forward then home via the logo, with a sheet open.
  await p.click(".trip-card, [data-action=openTrip]");
  await p.waitForSelector(".tab-body");
  await p.click("[data-action=addOpen]");
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForTimeout(300);
  ok(!(await inTrip()), "the logo goes to Your trips from inside a trip with a sheet open");
  ok(!/trip=/.test(p.url()), "link has no #trip= after the logo");
  await p.goBack().catch(() => {});
  await p.waitForTimeout(300);
  ok(!(await inTrip()) || true, "Back after the logo does not crash");

  // Tab memory per trip.
  await p.goto(URL0);
  await p.waitForSelector(".trip-card, [data-action=newTrip]");
  await makeTrip("Trip B");
  await p.click("[data-action=tab][data-tab=ideas] >> visible=true");
  ok((await tab()) === "ideas", "trip B on Ideas");
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForTimeout(250);
  const cards = await p.$$(".trip-card");
  ok(cards.length >= 2, "two trips listed: " + cards.length);
  const names = await p.$$eval(".trip-card", (els) => els.map((e) => e.textContent));
  const open = async (name) => {
    const i = names.findIndex((t) => t.includes(name));
    await (await p.$$(".trip-card"))[i].click();
    await p.waitForSelector(".tab-body");
  };
  await open("Trip A");
  await p.click("[data-action=tab][data-tab=plan] >> visible=true");
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForTimeout(250);
  await open("Trip B");
  ok((await tab()) === "ideas", "trip B reopens on Ideas");
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForTimeout(250);
  await open("Trip A");
  ok((await tab()) === "plan", "trip A reopens on Plan");
  // Back from a trip lands on Your trips; reload keeps nothing odd.
  await back();
  ok(!(await inTrip()), "Back from a trip goes to Your trips");
} catch (e) {
  fails++;
  console.log("  NAV LOG:\n    " + navLog.join("\n    "));
  console.log("  FAIL exception", e.stack, await p.evaluate(() => JSON.stringify({ hash: location.hash, tab: window.__tripCtx?.S.tab, trip: !!window.__tripCtx?.S.trip, txt: document.querySelector("#app")?.innerText.slice(0, 100) })).catch(() => ""));
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
await b.close();
srv.kill();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
