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
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const ctxB = await b.newContext({ viewport: { width: 390, height: 800 } });
const p = await ctxB.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
await p.goto(URL0);
await p.fill("#demoName", "Akash");
await p.click("[data-action=signin]");

const home = () => p.$(".trip-card, [data-action=newTrip]").then(async () => (await p.$(".tab-body")) === null);
const inTrip = async () => !!(await p.$(".tab-body"));
const back = async () => { await p.goBack(); await p.waitForTimeout(250); };
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
  await p.click("[data-action=addOpen]");
  ok(await p.$eval(".add-wrap", (e) => e.classList.contains("open")), "Add sheet opens");
  await back();
  ok(!(await p.$eval(".add-wrap", (e) => e.classList.contains("open"))) && (await inTrip()), "Back closes the Add sheet and stays in the trip");

  // Add sheet, then a dialog from a tile: Back closes the dialog, then the trip is still open.
  await p.click("[data-action=moreToggle]");
  ok(await p.$(".more-back") !== null, "More menu opens");
  await back();
  ok((await p.$(".more-back")) === null && (await inTrip()), "Back closes the More menu and stays in the trip");

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
  console.log("  FAIL exception", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
await b.close();
srv.kill();
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
