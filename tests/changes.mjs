// "Ask for a change" (changes.js) in demo mode with a mocked Gemini, plus the Claude link in demo mode.
// Run: node tests/changes.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-changes-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
let geminiPrompt = "", geminiReply = null;

try {
  const ctxB = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com") {
      geminiPrompt = JSON.parse(r.request().postData()).contents[0].parts[0].text;
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(geminiReply) + "\n```" }] } }] }) });
    }
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
    return ids;
  });

  console.log("the box");
  ok(await p.isVisible("#changeInput") && /Ask for a change/.test(await p.getAttribute("#changeInput", "placeholder")), "one quiet line on the Plan tab");
  ok(!(await p.isVisible("[data-action=chgClaude]")), "buttons stay hidden until you focus it");
  await p.click("#changeInput");
  ok(await p.isVisible("[data-action=chgClaude]") && !(await p.$("[data-action=chgGemini]")), "focus shows Ask Claude; no Ask Gemini without a key");
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { ai: { key: "K", model: "m" } }));
  await p.waitForTimeout(300);
  await p.fill("#changeInput", "make Day 1 slower");
  await p.evaluate(() => window.__tripCtx.render());
  ok((await p.inputValue("#changeInput")) === "make Day 1 slower" && (await p.isVisible("[data-action=chgGemini]")), "text survives a re-render and keeps the buttons showing; Ask Gemini appears with a key");

  console.log("Ask Gemini (mocked)");
  geminiReply = { kind: "changes", summary: "Moved the Pantheon to Day 2 and gave Day 1 a late start.", ops: [
    { type: "move", itemId: ids.b, toDay: 2, why: "Day 1 is packed." },
    { type: "day", day: 1, notes: "Slow start." },
    { type: "move", itemId: "ghost", toDay: 1 },
    { type: "teleport", itemId: ids.a },
    { type: "add", place: { name: "Gelato", category: "food", location: "Rome", veg: "no" }, toDay: 2 },
  ] };
  await p.click("[data-action=chgGemini]");
  await p.waitForSelector("#modalForm .chg-op");
  ok(/make Day 1 slower/.test(geminiPrompt) && /vegetarian/i.test(geminiPrompt) && /itemId/.test(geminiPrompt) && geminiPrompt.includes(ids.b), "prompt has the request, the veg rule, the op formats and the plan with ids");
  const rows = await p.$$eval(".chg-op", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(rows.length === 5 && rows[0].startsWith("Move “Pantheon” to Day 2"), "review lists the changes: " + rows[0]);
  ok(/Can't apply: That stop isn't in your trip/.test(rows[2]) && /Can't apply: The app doesn't know/.test(rows[3]) && /Can't apply: Few vegetarian/.test(rows[4]), "invalid ops are greyed with a reason");
  ok((await p.$eval("button[value=ok]", (e) => e.textContent)) === "Apply all 2", "Apply all counts only what can be applied");
  await p.click("[data-close]");
  ok(/Gemini suggests 2 changes for “make Day 1 slower”/.test(await p.textContent(".smart-banner[data-action=chgOpen]")), "Plan banner names Gemini and counts changes");
  const unchanged = await p.evaluate((id) => window.__tripCtx.S.items.find((i) => i.id === id).dayId === window.__tripCtx.S.trip.days[0].id, ids.b);
  ok(unchanged, "nothing is applied until you tap");
  await p.click("[data-action=chgOpen]");
  await p.click("button[value=ok]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes, null, { timeout: 10000 });
  const after = await p.evaluate((id) => ({ day: window.__tripCtx.S.trip.days.findIndex((d) => d.id === window.__tripCtx.S.items.find((i) => i.id === id).dayId) + 1, notes: window.__tripCtx.S.trip.days[0].notes }), ids.b);
  ok(after.day === 2 && after.notes === "Slow start.", "Apply all applied the valid changes");

  console.log("Gemini quota / failure");
  geminiReply = { summary: "nothing", ops: [] };
  await p.fill("#changeInput", "do nothing");
  await p.press("#changeInput", "Enter");
  await p.waitForFunction(() => /couldn't do that|no changes/i.test(document.getElementById("toast").textContent), null, { timeout: 5000 });
  ok(!(await p.evaluate(() => window.__tripCtx.S.trip.changes)), "an answer with no changes says so and stores nothing");

  console.log("Ask Claude without the link: copy, paste back");
  await p.evaluate(() => { window.open = () => null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await p.fill("#changeInput", "add a rest day on day 3");
  await p.click("[data-action=chgClaude]");
  await p.waitForSelector("#modalForm button[value=cancel]");
  ok(/Connect once and every Claude button opens Claude with your trip ready\./.test(await p.textContent("#modalForm")) && (await p.textContent("#modalForm button[value=cancel]")) === "Not now", "first Ask Claude with the link off offers to connect (the nudge)");
  await p.click("#modalForm button[value=cancel]");
  await p.waitForSelector("#modalForm textarea[name=answer]");
  const copied = await p.evaluate(() => window.__copied);
  ok(/add a rest day on day 3/.test(copied) && copied.includes(ids.a) && /"type":"move"/.test(copied) && /vegetarian/.test(copied), "copied request has the ask, the plan with ids and the change formats");
  await p.fill("textarea[name=answer]", "```json\n" + JSON.stringify({ kind: "changes", summary: "Day 3 is a rest day.", ops: [{ type: "day", day: 3, title: "Rest day", why: "You asked." }, { type: "check", text: "Book dinner", group: "todo" }] }) + "\n```");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes?.source === "Claude", null, { timeout: 5000 });
  ok(/Claude suggests 2 changes for “add a rest day on day 3”/.test(await p.textContent(".smart-banner[data-action=chgOpen]")), "pasted answer becomes 'Claude suggests 2 changes'");
  await p.click("[data-action=chgOpen]");
  await p.click(".chg-op:nth-child(2) [data-action=chgApply]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.checklist?.length === 1);
  ok(true, "a check op creates trip.checklist without the Kit module's help");
  await p.click("[data-action=chgDiscard]");

  console.log("Ask Claude again: no nudge, straight to copy/paste");
  await p.fill("#changeInput", "another thing");
  await p.click("[data-action=chgClaude]");
  await p.waitForSelector("#modalForm textarea[name=answer]");
  ok(true, "the nudge shows only once");
  await p.click("[data-close]");

  console.log("Connect from the nudge: Connect continues straight to Claude");
  await p.evaluate(() => { localStorage.removeItem("tp-claude-nudged"); window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { ai: null }));
  await p.setViewportSize({ width: 390, height: 800 });
  await p.fill("#changeInput", "swap two stops");
  await p.click("[data-action=chgClaude]");
  await p.waitForSelector("#modalForm button[value=cancel]");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__opened.length === 1, null, { timeout: 10000 });
  const tok = await p.evaluate(() => window.__tripCtx.S.trip.bridge.token);
  const u0 = await p.evaluate(() => window.__opened[0]);
  const q0 = decodeURIComponent(u0.split("?q=")[1] || "");
  ok(u0.startsWith("https://claude.ai/new?q=") && q0.includes("token: " + tok) && q0.includes("Request: Please handle our new request in the trip planner: swap two stops"), "Connect opens claude.ai/new?q= with the token and the request");
  ok((await p.evaluate(() => window.__copied)) === q0, "the clipboard holds the same text");
  ok(await p.evaluate(() => window.__tripCtx.S.trip.bridge.ask?.request === "swap two stops"), "the request is saved for Claude too");

  console.log("Claude link in demo mode");
  await p.waitForFunction((t) => JSON.parse(localStorage.getItem("tripplanner-demo-v1")).bridges[t]?.snapshot, tok, { timeout: 10000 });
  ok(true, "demo bridge gets a snapshot");
  await p.evaluate((t) => window.__demoBridgePush(t, { id: "d1", at: Date.now(), json: JSON.stringify({ kind: "review", summary: "Fine.", suggestions: [{ title: "Eat more pasta", detail: "Always.", action: { type: "none" } }] }) }), tok);
  await p.waitForFunction(() => window.__tripCtx.S.trip.aiReview?.source === "Claude", null, { timeout: 5000 });
  ok(/Claude sent a review/.test(await p.textContent("#toast")), "inbox entry becomes a review: " + (await p.textContent("#toast")));
  ok(await p.evaluate((t) => JSON.parse(localStorage.getItem("tripplanner-demo-v1")).bridges[t].inbox.length === 0, tok), "inbox emptied");
  await p.evaluate((t) => window.__demoBridgePush(t, { id: "d2", at: Date.now(), json: "not json" }), tok);
  await p.waitForFunction(() => /couldn't use/.test(document.getElementById("toast").textContent), null, { timeout: 5000 });
  ok(true, "garbage in the inbox gives a plain-words toast, no crash");
  const del = await p.evaluate(async (t) => { await window.__tripCtx.S.store.deleteTrip(window.__tripCtx.S.tripId); return JSON.parse(localStorage.getItem("tripplanner-demo-v1")).bridges[t]; }, tok);
  ok(del === undefined, "deleting the trip deletes its bridge doc");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll changes checks passed");
process.exit(fails ? 1 : 0);
