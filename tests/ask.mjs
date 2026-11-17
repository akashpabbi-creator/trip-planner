// The Ask screen (ask.js): one full-page layer for change requests, planning, things to check and the review.
// Run: node tests/ask.mjs   (demo mode; copies the repo to a temp dir and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { freezeClock } from "./_clock.mjs";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-ask-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const URL0 = `http://127.0.0.1:${PORT}/`;
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = freezeClock(await chromium.launch());
const errors = [];
const AI_WORDS = /Gemini|Claude/i;
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
async function makeTrip(p) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
const text = (p) => p.evaluate(() => document.body.innerText);
const open = (p) => p.click(".thead [data-action=ask]").then(() => p.waitForSelector(".ask-screen"));
const gone = (p) => p.waitForFunction(() => !document.querySelector(".ask-screen") && document.querySelector(".tab-body"), null, { timeout: 4000 });

try {
  console.log("an AI user");
  const bc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await newPage(bc, "Akash");
  await makeTrip(p);
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days;
    const mk = (title, extra) => S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, category: "sight", location: "Rome", addedBy: S.me.email, addedByName: "Akash", addedAt: Date.now(), ...extra });
    await mk("Colosseum", { dayId: d[0].id, order: 1, lat: 41.89, lng: 12.49 });
    await mk("Trattoria", { dayId: d[0].id, order: 2, category: "food", veg: "no", lat: 41.9, lng: 12.5 });
    await S.store.updateTrip(S.tripId, { guide: { listings: [{ name: "Pantheon", category: "sight" }], at: Date.now() } });
  });
  await p.waitForTimeout(300);
  ok(!(await p.$(".ask-screen")) && (await p.$("#changeInput")) === null, "the Plan tab has no Ask box any more");
  await open(p);
  const secs = await p.$$eval(".ask-card", (e) => e.map((x) => x.id));
  ok(secs.join() === "ask-change,ask-plan,ask-checks,ask-review", "sections in order: change, plan, checks, review: " + secs);
  ok(await p.isVisible(".ask-screen #changeInput") && await p.isVisible(".ask-screen [data-action=chgClaude]"), "the change box and Ask Claude show");
  ok(await p.isVisible(".ask-screen [data-action=buildSample]:not([disabled])") && await p.isVisible(".ask-screen [data-action=claudePlan]") && !(await p.$(".ask-screen [data-action=geminiPlan]")), "Fill empty days and Plan with Claude; no Gemini button without a key");
  ok(!!(await p.$(".ask-screen [data-action=analyse]")) && !!(await p.$(".ask-screen [data-action=aiReview], .ask-screen [data-action=aiSettings]")) && !!(await p.$(".ask-screen [data-action=copyForClaude][data-id=review]")), "Analyse plan, the review and Copy plan for Claude are here");
  ok(await p.isVisible(".ask-screen .sug") && !!(await p.$(".ask-screen .sug [data-action=dismissSug]")), "Things to check lists suggestions with Dismiss");
  ok(!!(await p.$(".ask-screen [data-action=tab][data-tab=changes]")), "a link to Activity");
  ok(!(await p.$(".tabs-bar")) && (await p.textContent(".thead h1")) === "Ask", "it is a page of its own (no bottom bar)");
  // dismiss + bring back
  const n0 = (await p.$$(".ask-screen .sug")).length;
  await p.click(".ask-screen .sug [data-action=dismissSug]");
  ok((await p.$$(".ask-screen .sug")).length === n0 - 1 && !!(await p.$(".ask-screen [data-action=undismiss]")), "Dismiss hides one and offers to bring it back");
  await p.click(".ask-screen [data-action=undismiss]");
  ok((await p.$$(".ask-screen .sug")).length === n0, "Show dismissed brings it back");
  // pace pref lives here
  await p.selectOption(".ask-screen [data-pref=pace]", "relaxed");
  ok((await p.evaluate(() => window.__tripCtx.S.trip.prefs?.pace)) === "relaxed", "the pace setting saves");

  console.log("closing");
  await p.click("[data-action=askClose]");
  await gone(p);
  ok(true, "the arrow closes it");
  await open(p);
  await p.goBack();
  await gone(p);
  ok(await p.evaluate(() => !!window.__tripCtx.S.tripId), "Back closes it and stays in the trip");
  await open(p);
  await p.keyboard.press("Escape");
  await gone(p);
  ok(true, "Escape closes it");
  await open(p);
  await p.click(".ask-screen [data-action=tab][data-tab=changes]");
  await p.waitForSelector(".tab-body");
  ok(!(await p.$(".ask-screen")) && (await p.evaluate(() => window.__tripCtx.S.tab)) === "changes", "the Activity link closes Ask and opens Activity");
  await p.click(".tabs-bar [data-tab=plan]");

  console.log("entry points");
  await p.click(".tabs-bar [data-tab=trip]");
  await p.click(".hub-list [data-action=ask]");
  await p.waitForSelector(".ask-screen");
  ok(true, "the Trip hub row opens Ask");
  await p.click("[data-action=askClose]");
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "K", model: "m" } }));
  await p.waitForTimeout(300);
  await open(p);
  ok(await p.isVisible(".ask-screen [data-action=geminiPlan]") && await p.isVisible(".ask-screen [data-action=chgGemini]"), "with a Gemini key: Plan with Gemini and Ask Gemini show");
  await p.evaluate(() => { window.__tripCtx.setChangeDraft("Make Day 2 slower"); });
  ok((await p.inputValue("#changeInput")) === "Make Day 2 slower", "setChangeDraft fills the box on the Ask screen");
  await p.click("[data-action=askClose]");
  await p.evaluate(() => { window.__tripCtx.setChangeDraft("Swap a stop"); });
  await p.waitForSelector(".ask-screen #changeInput");
  ok((await p.inputValue("#changeInput")) === "Swap a stop", "setChangeDraft from the Plan opens Ask with the text");
  await p.click("[data-action=askClose]");

  console.log("friend (no AI)");
  const bcF = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const f = await newPage(bcF, "Fran", "?noai");
  await makeTrip(f);
  await open(f);
  ok(!AI_WORDS.test(await text(f)), "the Ask screen has no Gemini or Claude text for a friend");
  ok(!(await f.$("#changeInput")) && !(await f.$("#ask-review")) && !(await f.$("[data-action=claudePlan]")) && !(await f.$("[data-action=geminiPlan]")), "no change box, review or AI plan buttons");
  ok(!!(await f.$("[data-action=buildSample]")) && !!(await f.$(".ask-screen [data-action=analyse]")), "Fill empty days and Analyse plan are still there");
  await f.goBack();
  await gone(f);
  ok(true, "Back closes it");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll ask checks passed");
process.exit(fails ? 1 : 0);
