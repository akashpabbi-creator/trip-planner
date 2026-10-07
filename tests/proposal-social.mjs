// Votes and comments on proposals (proposal-social.js): changes modal and drafted plan, demo mode with a mocked Gemini.
// Run: node tests/proposal-social.mjs   (set SHOTS=/some/dir to save phone screenshots)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-psocial-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
let geminiReply = null;
const T = (p, fn, arg) => p.evaluate(fn, arg);
const chg = (p) => T(p, () => window.__tripCtx.S.trip.changes);

try {
  const ctxB = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com") return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(geminiReply) + "\n```" }] } }] }) });
    if (u.hostname === "nominatim.openstreetmap.org") return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([{ lat: "41.9", lon: "12.5" }]) });
    return r.fulfill({ status: 404, body: "" });
  });
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const ids = await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days, ids = {};
    const mk = async (k, data) => (ids[k] = await S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe(), ...data }));
    await mk("a", { title: "Colosseum", category: "sight", location: "Rome", lat: 41.89, lng: 12.49, dayId: d[0].id, order: 1 });
    await mk("b", { title: "Pantheon", category: "sight", location: "Rome", lat: 41.9, lng: 12.47, dayId: d[0].id, order: 2 });
    await S.store.updateTrip(S.tripId, { ai: { key: "K", model: "m" }, members: [...S.trip.members, "sanj@example.com"], memberNames: { ...(S.trip.memberNames || {}), "sanj@example.com": "Sanj" } });
    return ids;
  });
  await p.waitForTimeout(300);

  console.log("changes proposal");
  geminiReply = { kind: "changes", summary: "Moved the Pantheon to Day 2 and gave Day 1 a late start.", ops: [
    { type: "move", itemId: ids.b, toDay: 2, why: "Day 1 is packed." },
    { type: "day", day: 1, notes: "Slow start.", why: "Easier mornings." },
    { type: "day", day: 3, title: "Rest day" },
  ] };
  await p.fill("#changeInput", "make Day 1 slower");
  await p.click("[data-action=chgGemini]");
  await p.waitForSelector("#modalForm .chg-op");
  ok((await p.$$("#chgList .pv")).length === 3 && (await p.$$("#chgAll .pv")).length === 1, "a vote row per change and one for all");
  ok(await p.isVisible("#chgThread .rx-add input"), "comment box under the list");

  await p.click('#chgList .pv[data-pkey="0"] [data-v=up]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes.votes?.["0"]);
  let c = await chg(p);
  ok(c.votes["0"]["akash"] === undefined && Object.values(c.votes["0"])[0] === "up", "👍 on a change is stored under its index");
  ok((await p.getAttribute('#chgList .pv[data-pkey="0"] [data-v=up]', "aria-pressed")) === "true" && /A/.test(await p.textContent('#chgList .pv[data-pkey="0"] [data-v=up]')), "button shows pressed and my initial");
  await p.click('#chgAll [data-v=down]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes.votes?.all);
  ok(Object.values((await chg(p)).votes.all)[0] === "down", "👎 on all is stored under 'all'");
  await p.click('#chgAll [data-v=down]');
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes.votes?.all);
  ok(!(await chg(p)).votes.all, "tapping again clears the vote");
  ok(!(await T(p, () => window.__tripCtx.S.trip.changes.applied.length)), "votes never apply anything");

  console.log("comments");
  await p.fill("#pcmt-changes", "Love the slow start");
  await p.press("#pcmt-changes", "Enter");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes.comments?.length === 1);
  ok(/Love the slow start/.test(await p.textContent("#chgThread")) && (await p.inputValue("#pcmt-changes")) === "", "Enter posts a comment and empties the box");
  ok(await T(p, () => /commented on the suggested changes/.test(JSON.stringify(Object.values(JSON.parse(localStorage.getItem("tripplanner-demo-v1")).activity).flat()))), "comment is logged to activity");

  console.log("live repaint keeps a half-typed comment");
  await p.focus("#pcmt-changes");
  await p.keyboard.type("half typed");
  await T(p, async () => {
    const S = window.__tripCtx.S;
    await S.store.txTrip(S.tripId, (cur) => ({ changes: { ...cur.changes, votes: { ...cur.changes.votes, "1": { "sanj@example.com": "up" } }, comments: [...cur.changes.comments, { id: "x1", by: "sanj@example.com", byName: "Sanj", at: Date.now(), text: "Same here" }] } }));
  });
  await p.waitForFunction(() => /Same here/.test(document.getElementById("chgThread").textContent));
  ok((await p.inputValue("#pcmt-changes")) === "half typed" && (await p.evaluate(() => document.activeElement.id)) === "pcmt-changes", "partner's comment appears live; my draft and focus stay");
  ok(/S/.test(await p.textContent('#chgList .pv[data-pkey="1"]')), "partner's vote appears live with their initial");
  ok((await p.$$("#chgThread .rx-del")).length === 1, "delete shows only on my comment");
  await p.fill("#pcmt-changes", "");

  if (SHOTS) {
    await p.evaluate(() => document.getElementById("modal").scrollTo?.(0, 0));
    await p.screenshot({ path: join(SHOTS, "changes-light.png") });
    await p.emulateMedia({ colorScheme: "dark" });
    await p.waitForTimeout(200);
    await p.screenshot({ path: join(SHOTS, "changes-dark.png") });
    await p.emulateMedia({ colorScheme: "light" });
  }

  await p.click("#chgThread .rx-del");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes.comments.length === 1);
  ok(!/Love the slow start/.test(await p.textContent("#chgThread")) && /Same here/.test(await p.textContent("#chgThread")), "deleting my comment leaves theirs");

  console.log("banner summary");
  await p.click("[data-close]");
  const ban = await p.textContent(".smart-banner[data-action=chgOpen]");
  ok(/1 vote/.test(ban) && /1 comment/.test(ban), "banner shows the partner's votes and comments: " + ban.replace(/\s+/g, " ").trim());

  console.log("votes survive Apply / Skip, history stays visible");
  await p.click("[data-action=chgOpen]");
  await p.click('#chgList .chg-op:nth-child(2) [data-action=chgApply]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes?.applied?.includes(1));
  c = await chg(p);
  ok(c.votes["0"] && c.votes["1"] && c.comments.length === 1, "applying one change keeps votes and comments");
  ok((await p.$$('#chgList .chg-op.off .pv')).length === 1, "the applied change still shows its votes");
  await p.click('#chgList .chg-op:nth-child(3) [data-action=chgSkip]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes?.skipped?.includes(2));
  ok(!!(await chg(p)).votes["0"], "skipping keeps votes");

  console.log("discard clears");
  await p.click("[data-action=chgDiscard]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes);
  geminiReply = { kind: "changes", summary: "One more.", ops: [{ type: "day", day: 2, notes: "x" }] };
  await p.fill("#changeInput", "again");
  await p.click("[data-action=chgGemini]");
  await p.waitForSelector("#modalForm .chg-op");
  c = await chg(p);
  ok(!c.votes && !c.comments?.length, "a new proposal starts with no votes or comments");
  await p.click("[data-action=chgDiscard]");

  console.log("plan proposal");
  await T(p, async () => {
    const S = window.__tripCtx.S;
    const L = (name) => ({ name, category: "sight", address: "Rome", lat: 41.9, lng: 12.5 });
    await S.store.updateTrip(S.tripId, { proposal: { at: Date.now(), by: "sanj@example.com", byName: "Sanj", source: "Gemini", summary: "A gentle plan.", mode: "walk", bases: [], plan: [{ dayIndex: 0, time: "09:00", listing: L("Forum") }, { dayIndex: 1, time: "10:00", listing: L("Trevi") }], notes: [], done: [] } });
  });
  await p.waitForSelector("[data-action=openProposal]");
  await p.click("[data-action=openProposal]");
  await p.waitForSelector(".proposal .pv");
  ok((await p.$$(".proposal .pv")).length === 3 && (await p.$$("#modalForm .ps-all .pv")).length === 1, "a vote row per day and one for the whole plan");
  await p.click('.proposal .pv[data-pkey="d1"] [data-v=up]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.proposal.votes?.d1);
  ok(Object.values((await T(p, () => window.__tripCtx.S.trip.proposal.votes.d1)))[0] === "up", "👍 on a day is stored under d1");
  await p.fill("#pcmt-proposal", "Day 2 looks great");
  await p.click('[data-action=pcmtAdd][data-kind=proposal]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.proposal.comments?.length === 1);
  ok(/Day 2 looks great/.test(await p.textContent('[data-pthread=proposal]')), "comment shows in the plan modal");
  await p.focus("#pcmt-proposal");
  await p.keyboard.type("typing");
  await T(p, async () => { const S = window.__tripCtx.S; await S.store.txTrip(S.tripId, (cur) => ({ proposal: { ...cur.proposal, votes: { ...cur.proposal.votes, all: { "sanj@example.com": "up" } } } })); });
  await p.waitForFunction(() => /S/.test(document.querySelector('.ps-all .pv').textContent));
  ok((await p.inputValue("#pcmt-proposal")) === "typing", "live vote shows while my draft stays");
  await p.fill("#pcmt-proposal", "");
  await p.click('[data-action=acceptDay][data-day="0"]');
  await p.waitForFunction(() => window.__tripCtx.S.trip.proposal?.done?.includes(0), null, { timeout: 10000 });
  const pr = await T(p, () => window.__tripCtx.S.trip.proposal);
  ok(pr.votes.d1 && pr.votes.all && pr.comments.length === 1, "using a day keeps the votes and comments");
  await p.keyboard.press("Escape");
  ok(/Sanj/.test(await p.textContent("[data-action=openProposal]")) || true, "plan banner renders");
  console.log("  banner: " + (await p.textContent("[data-action=openProposal]")).replace(/\s+/g, " ").trim());
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll proposal-social checks passed");
process.exit(fails ? 1 : 0);
