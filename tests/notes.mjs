// Trip notes (notes.js) in demo mode with a mocked Gemini: Kit composer, + sheet, drafts, edit/done/delete, snapshot, Plan buttons.
// Run: node tests/notes.mjs   (copies the repo to a temp dir in demo mode and serves it itself; SHOTS=dir saves screenshots)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-notes-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8800 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const openAdd = async (p) => { if (await p.isVisible(".add-plus") && !(await p.$(".add-wrap.open"))) await p.click("[data-action=addOpen]"); };
const kit = async (p) => { await p.evaluate(() => document.querySelector("[data-action=tab][data-tab=kit]").click()); await p.waitForSelector("#kit-notes"); };
const snapNotes = (p) => p.evaluate(() => window.__tripCtx.planSnapshot().tripNotes);
const b = await chromium.launch();
const errors = [];
let geminiPrompt = "", geminiCalls = 0, geminiReply = null;

try {
  const ctxB = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: "light" });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com") {
      geminiCalls++;
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

  console.log("empty state and order");
  await kit(p);
  ok(/No notes yet\. Jot down ideas, wishes or reminders here; both of you see them live\./.test(await p.textContent("#kit-notes")), "empty state copy");
  ok(/Trip notes/.test(await p.textContent("#kit-notes h3")), "section title");
  ok((await p.$eval(".kit", (k) => k.firstElementChild.id)) === "kit-notes", "notes come first on the Kit tab");
  ok(!(await p.$(".nt-plan")), "no Plan buttons without notes");
  ok((await snapNotes(p)) === undefined, "snapshot omits tripNotes when there are none");

  console.log("add from the Kit composer");
  await p.fill("#ntNew", "Day 2 should be slow\nbook the <b>train</b>");
  await p.click("[data-action=noteAdd]");
  await p.waitForSelector(".nt-row");
  ok((await p.inputValue("#ntNew")) === "", "composer clears");
  ok((await p.$eval(".nt-text", (e) => e.textContent)) === "Day 2 should be slow\nbook the <b>train</b>" && !(await p.$(".nt-text b")), "text kept with line break, HTML escaped");
  ok(/Akash · /.test(await p.textContent(".nt-meta")), "byline");
  await p.fill("#ntNew", "Try Trattoria Rosa");
  await p.press("#ntNew", "Control+Enter");
  await p.waitForFunction(() => document.querySelectorAll(".nt-row").length === 2);
  ok((await p.$$eval(".nt-text", (e) => e.map((x) => x.textContent)))[0] === "Try Trattoria Rosa", "Ctrl+Enter adds; newest first");

  console.log("add from the + sheet");
  await openAdd(p);
  ok(await p.isVisible("[data-action=noteQuick]") && (await p.getAttribute("[data-action=noteQuick]", "data-sub")) === "For both of you, and for Claude", "Note tile in the add sheet");
  await p.click("[data-action=noteQuick]");
  await p.waitForSelector("#modalForm textarea[name=text]");
  await p.fill("#modalForm textarea[name=text]", "Pack a rain jacket");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => document.querySelectorAll(".nt-row").length === 3);
  ok(/Note added\. It's on the Kit tab\./.test(await p.textContent("#toast")), "toast");

  console.log("draft survives a re-render");
  await p.fill("#ntNew", "half typed");
  await p.evaluate(() => window.__tripCtx.render());
  ok((await p.inputValue("#ntNew")) === "half typed", "draft kept");
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { name: "Rome 2" }));
  await p.waitForTimeout(300);
  ok((await p.inputValue("#ntNew")) === "half typed", "draft kept after a live update");

  console.log("snapshot");
  const sn = await snapNotes(p);
  ok(sn.length === 3 && sn[2].text === "Pack a rain jacket" && sn[0].text.startsWith("Day 2") && sn.every((n) => n.by === "Akash" && /^\d{4}-/.test(n.at) && n.id), "open notes, newest last, first names");
  ok(!JSON.stringify(sn).includes("@"), "no emails");

  console.log("edit, done, delete");
  const rain = ".nt-row:has-text('rain jacket')";
  await p.click(`${rain} [data-action=noteEdit]`);
  await p.fill("#modalForm textarea[name=text]", "Pack a rain jacket and an umbrella");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".nt-row:has-text('umbrella')");
  ok(/edited/.test(await p.textContent(".nt-row:has-text('umbrella') .nt-meta")), "edited marker");
  await p.click(".nt-row:has-text('umbrella') input[type=checkbox]");
  await p.waitForSelector("details.nt-done");
  ok(/Done \(1\)/.test(await p.textContent("details.nt-done summary")) && !(await p.isVisible(".nt-row:has-text('umbrella')")), "done note collapses under Done (1)");
  ok((await snapNotes(p)).length === 2 && !JSON.stringify(await snapNotes(p)).includes("umbrella"), "done note leaves the snapshot");
  await p.click("details.nt-done summary");
  await p.waitForTimeout(200);
  await p.evaluate(() => window.__tripCtx.render());
  ok(await p.isVisible(".nt-row.done"), "Done list stays open after a re-render");
  await p.click(".nt-row.done input[type=checkbox]");
  await p.waitForFunction(() => !document.querySelector("details.nt-done"));
  await p.click(`${rain} [data-action=noteDel]`);
  await p.waitForFunction(() => document.querySelectorAll(".nt-row").length === 2);
  ok(true, "delete removes the note");
  ok((await p.evaluate(() => window.__tripCtx.S.trip.tripNotes.length)) === 2, "stored list has 2 notes");

  console.log("two writers keep both");
  await p.evaluate(async () => { const c = window.__tripCtx; await Promise.all([1, 2, 3].map((i) => c.S.store.txTrip(c.S.tripId, (cur) => ({ tripNotes: [...(cur.tripNotes || []), { id: "x" + i, text: "n" + i, by: "a@b", byName: "Sanj Rao", at: Date.now(), done: false }] })))); });
  await p.waitForFunction(() => document.querySelectorAll(".nt-row").length === 5);
  ok(true, "five notes after parallel writes");
  ok((await snapNotes(p)).filter((n) => n.by === "Sanj").length === 3, "byName gives a first name in the snapshot");
  await p.evaluate(async () => { const c = window.__tripCtx; await c.S.store.txTrip(c.S.tripId, (cur) => ({ tripNotes: cur.tripNotes.filter((n) => !n.id.startsWith("x")) })); });
  await p.waitForFunction(() => document.querySelectorAll(".nt-row").length === 2);

  console.log("Plan buttons");
  ok(await p.isVisible("[data-action=notePlanClaude]") && !(await p.$("[data-action=notePlanGemini]")), "Claude button only without a Gemini key");
  ok(/primary/.test(await p.getAttribute("[data-action=notePlanClaude]", "class")), "Claude is the primary button");
  ok(/Nothing changes until you tap Apply/.test(await p.textContent(".nt-plan")), "muted line");

  console.log("Plan with Claude (link off)");
  await p.evaluate(() => { window.open = () => null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await p.click("[data-action=notePlanClaude]");
  await p.waitForSelector("#modalForm button[value=cancel]");
  await p.click("#modalForm button[value=cancel]"); // "Not now" on the connect nudge
  await p.waitForSelector("#modalForm textarea[name=answer]");
  const copied = await p.evaluate(() => window.__copied);
  ok(copied.includes('"tripNotes"') && copied.includes("Try Trattoria Rosa") && copied.includes("Plan from our trip notes") && /Our open trip notes are in the plan JSON/.test(copied), "copied request carries tripNotes and the rules");
  await p.click("#modalForm button[value=cancel]");

  console.log("Plan with Gemini (mocked)");
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "K", model: "m" } }));
  await p.waitForSelector("[data-action=notePlanGemini]");
  ok(!/primary/.test(await p.getAttribute("[data-action=notePlanClaude]", "class")), "Claude is secondary once Gemini is there");
  geminiReply = { kind: "changes", request: "Plan from our trip notes", summary: "Added the restaurant.", ops: [{ type: "add", place: { name: "Trattoria Rosa", category: "food", location: "Via Roma 1, Rome", veg: "yes", vegNote: "pasta" }, toDay: null }, { type: "check", group: "todo", text: "Book the train" }] };
  await p.click("[data-action=notePlanGemini]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.source === "Gemini", null, { timeout: 10000 });
  ok(geminiCalls === 1 && geminiPrompt.includes("Try Trattoria Rosa") && geminiPrompt.includes("Day 2 should be slow") && /Our open trip notes are in the plan JSON/.test(geminiPrompt), "prompt carries the notes and the rules");
  ok(await p.evaluate(() => window.__tripCtx.S.items.some((i) => i.title === "Trattoria Rosa") && window.__tripCtx.S.trip.checklist?.some((c) => c.text === "Book the train") && !window.__tripCtx.S.trip.changes), "the notes are worked into the plan straight away, nothing waits for review");
  ok(/Plan from our trip notes/.test(await p.evaluate(() => window.__tripCtx.S.trip.undo.request)) && await p.evaluate(() => window.__tripCtx.S.activity.some((a) => /Gemini changed the plan/.test(a.text))), "Undo record and activity entry");
  await p.evaluate(() => window.__tripCtx.undoAi());
  await p.waitForFunction(() => !window.__tripCtx.S.trip.undo && !window.__tripCtx.S.items.some((i) => i.title === "Trattoria Rosa") && !window.__tripCtx.S.trip.checklist?.length, null, { timeout: 10000 });
  ok(true, "Undo takes the new place and the to-do back out");

  console.log("dark mode, and the non-AI view");
  await ctxB.close();
  for (const scheme of ["dark", "light"]) {
    const dk = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: scheme });
    const d = await dk.newPage();
    d.on("pageerror", (e) => errors.push(e.message));
    await d.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
    await d.goto(`http://127.0.0.1:${PORT}/`);
    await d.fill("#demoName", "Akash");
    await d.click("[data-action=signin]");
    await d.click("[data-action=newTrip]");
    await d.fill("[name=name]", "Rome");
    await d.fill("[name=destination]", "Rome");
    await d.fill("[name=numDays]", "3");
    await d.click("#modalForm button[value=ok]");
    await d.waitForSelector(".tab-body");
    await d.evaluate(async () => { const c = window.__tripCtx; const now = Date.now(); await c.S.store.txTrip(c.S.tripId, () => ({ tripNotes: [
      { id: "a", text: "Day 2 should be slow: no alarms, a long lunch somewhere quiet.", by: "akash@demo", byName: "Akash", at: now - 2 * 3600e3, done: false },
      { id: "b", text: "Sanj's friend said to try Trattoria Rosa near the Pantheon", by: "sanj@demo", byName: "Sanj", at: now - 26 * 3600e3, done: false },
      { id: "c", text: "Book the Vatican tickets", by: "akash@demo", byName: "Akash", at: now - 50 * 3600e3, done: true },
    ] })); });
    await kit(d);
    await d.waitForSelector(".nt-row");
    if (scheme === "dark") {
      ok(await d.isVisible(".nt-plan"), "Plan row shows for an AI user");
      await d.evaluate(() => { window.__tripCtx.S.aiUser = false; window.__tripCtx.render(); });
      ok((await d.$$(".nt-row")).length >= 2 && !(await d.$(".nt-plan")) && !(await d.$("[data-action=notePlanClaude]")), "non-AI user sees notes but no Plan buttons");
      await openAdd(d);
      ok(await d.isVisible("[data-action=noteQuick]"), "non-AI user still gets the Note tile");
      await d.evaluate(() => { window.__tripCtx.S.addOpen = false; window.__tripCtx.S.aiUser = true; window.__tripCtx.render(); });
    }
    await d.evaluate(() => { document.querySelector("#kit-notes").scrollIntoView(); window.scrollBy(0, -70); });
    await d.waitForTimeout(300);
    if (SHOTS) await d.screenshot({ path: join(SHOTS, `kit-notes-${scheme}.png`) });
    await dk.close();
  }
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll notes checks passed");
process.exit(fails ? 1 : 0);
