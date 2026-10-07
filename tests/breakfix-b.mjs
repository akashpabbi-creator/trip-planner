// Break-test fixes, worker B: changes (apply once, late answers, repaint), paste, shuffle confirm, JSON reading, clamps.
// Run: node tests/breakfix-b.mjs   (copies the repo to a temp dir in demo mode; every external host is mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-breakfix-b-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
let geminiReply = null, geminiDelay = 0, geminiRaw = null;
const dialogs = [];
let dialogAnswer = true;

const CORS = { "access-control-allow-origin": "*" };
async function open(ctxB, viewport) {
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com") {
      if (geminiDelay) await new Promise((x) => setTimeout(x, geminiDelay));
      const text = geminiRaw ?? "```json\n" + JSON.stringify(geminiReply) + "\n```";
      return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
    }
    if (u.hostname === "nominatim.openstreetmap.org") return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify([{ lat: "41.9", lon: "12.5" }]) });
    return r.fulfill({ status: 404, body: "" });
  });
  return p;
}
const toast = (p) => p.evaluate(() => document.getElementById("toast").textContent);

try {
  /* ---------------------------------------------------------------- reading AI answers (no browser needed) */
  console.log("parseJson");
  const { parseJson, cleanPlace, cleanAction } = await import(join(root, "ai.js"));
  const bad = (t) => { try { parseJson(t); return null; } catch (e) { return e.message; } };
  ok(JSON.stringify(parseJson('Here you go: {"a":"x}y","b":[1,2]} Hope that helps!')) === '{"a":"x}y","b":[1,2]}', "prose around unfenced JSON is skipped, braces inside strings are fine");
  ok(JSON.stringify(parseJson('Sure!\n```json\n{"a":1}\n```\nLet me know.')) === '{"a":1}', "fenced JSON with prose");
  ok(JSON.stringify(parseJson('Here is the list: [1,2] done')) === "[1,2]", "an array in prose");
  for (const t of ["no json here", "null", '```json\n{"a":\n```', '{"a":1', ""]) ok(bad(t) === "The answer wasn't readable. Try again.", `friendly error for ${JSON.stringify(t).slice(0, 30)}`);
  const pl = cleanPlace({ name: "n".repeat(500), address: "a".repeat(500), hours: "h".repeat(900), why: "w".repeat(900) });
  ok(pl.name.length === 120 && pl.address.length === 200 && pl.hours.length === 300 && pl.why.length === 240, "link/screenshot places are clamped (120 / 200 / 300 / 240)");
  const act = cleanAction({ type: "time", time: "99:99", place: { name: "p".repeat(400), location: "l".repeat(400), why: "w".repeat(400) } });
  ok(act.time === "" && act.place.name.length === 120 && act.place.location.length === 200 && act.place.why.length === 240, "review action: bad time dropped, place clamped");
  ok(cleanAction({ type: "time", time: "9:05" }).time === "09:05" && cleanAction({ type: "time", time: "7:75" }).time === "", "review action time is HH:MM within range");

  /* ---------------------------------------------------------------- the app */
  const ctxB = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await open(ctxB);
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
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "K", model: "m" } }));
  await p.waitForFunction(() => window.__tripCtx.aiKey() === "K");
  const ids = await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days, ids = {};
    const mk = async (k, data) => (ids[k] = await S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe(), ...data }));
    await mk("a", { title: "Colosseum", category: "sight", location: "Rome", lat: 41.89, lng: 12.49, dayId: d[0].id, order: 1 });
    await mk("b", { title: "Pantheon", category: "sight", location: "Rome", lat: 41.9, lng: 12.47, dayId: d[0].id, order: 2 });
    await mk("i1", { title: "Trastevere walk", category: "sight", location: "Rome", lat: 41.88, lng: 12.47, dayId: null, order: 0 });
    await mk("i2", { title: "Villa Borghese", category: "sight", location: "Rome", lat: 41.91, lng: 12.49, dayId: null, order: 0 });
    return ids;
  });
  const addOps = (names) => names.map((n) => ({ type: "add", place: { name: n, category: "sight", location: "Rome" }, toDay: 2 }));
  const propose = (ops, request = "test") => p.evaluate(({ ops, request }) => window.__tripCtx.bridgeIngest({ kind: "changes", request, summary: "s", ops }), { ops, request });
  const countTitle = (t) => p.evaluate((t) => window.__tripCtx.S.items.filter((i) => i.title === t).length, t);
  const closeModal = async () => { await p.evaluate(() => { const m = window.__tripCtx.$modal; if (m.open) m.close(); }); };

  /* ---- 1. apply once */
  console.log("Apply is not re-entrant");
  await propose(addOps(["Gelato Bar", "Caffe Sant Eustachio"]));
  await p.evaluate(() => window.__tripCtx.openChanges());
  await p.waitForSelector("#chgList .chg-op");
  // Apply, Apply all and Apply again, all in the same instant.
  await p.evaluate(() => {
    const first = document.querySelector("[data-action=chgApply][data-id='0']");
    first.click(); first.click();
    document.querySelector("#modalForm button[value=ok]").click();
    document.querySelector("#modalForm button[value=ok]").click();
  });
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes, null, { timeout: 15000 });
  await p.waitForTimeout(600);
  ok((await countTitle("Gelato Bar")) === 1 && (await countTitle("Caffe Sant Eustachio")) === 1, "Apply twice + Apply all twice adds each stop once");
  const ap = await p.evaluate(() => window.__tripCtx.S.activity?.filter((a) => /Gelato Bar/.test(a.text || a.what || "")).length ?? 0);
  ok(ap <= 1, "and logs it at most once");

  // an add for a place that is already in the trip is marked done, not added again
  await propose(addOps(["Pantheon"]));
  await p.evaluate(() => window.__tripCtx.openChanges());
  await p.waitForSelector("#chgList .chg-op");
  await p.click("[data-action=chgApply][data-id='0']");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes, null, { timeout: 8000 });
  ok((await countTitle("Pantheon")) === 1, "adding a place that's already in the trip adds nothing");
  await closeModal();

  // two phones tapping Apply on the same change
  const p2 = await open(ctxB);
  await p2.goto(`http://127.0.0.1:${PORT}/`);
  await p2.fill("#demoName", "Akash");
  await p2.click("[data-action=signin]");
  await p2.waitForFunction(() => window.__tripCtx?.S?.items?.length >= 4, null, { timeout: 10000 });
  await propose(addOps(["Piazza Navona"]));
  await Promise.all([p, p2].map((pg) => pg.waitForFunction(() => window.__tripCtx.S.trip.changes, null, { timeout: 8000 })));
  await Promise.all([p, p2].map((pg) => pg.evaluate(() => window.__tripCtx.openChanges())));
  await Promise.all([p, p2].map((pg) => pg.waitForSelector("[data-action=chgApply]")));
  // the second phone taps a moment after the first, before its screen has caught up (the demo store has no true transactions)
  await Promise.all([p.click("[data-action=chgApply][data-id='0']"), p2.evaluate(() => new Promise((r) => setTimeout(r, 120))).then(() => p2.evaluate(() => document.querySelector("[data-action=chgApply][data-id='0']")?.click()))]);
  await p.waitForTimeout(2500);
  const nav = await countTitle("Piazza Navona");
  ok(nav === 1, "both phones tapping Apply adds the stop once (found " + nav + ")");
  await p2.close();
  await closeModal();
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes || true);

  /* ---- 9. wording and layout of the review */
  console.log("review rows");
  await propose([{ type: "add", place: { name: "Supercalifragilisticexpialidocious".repeat(3), category: "sight", location: "Rome" }, toDay: 1 }, { type: "move", itemId: ids.a, toDay: "x" }]);
  await p.evaluate(() => window.__tripCtx.openChanges());
  await p.waitForSelector("#chgList .chg-op");
  const css = await p.$eval(".chg-t", (e) => ({ ow: getComputedStyle(e).overflowWrap, mw: getComputedStyle(e).minWidth }));
  ok(css.ow === "anywhere" && css.mw === "0px", "long unbroken names wrap instead of pushing Apply away");
  ok(await p.evaluate(() => document.getElementById("modal").scrollWidth <= document.getElementById("modal").clientWidth + 1), "no sideways scroll in the review on a phone");
  const rows = await p.$$eval(".chg-op", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ")));
  ok(rows.some((r) => /Day \?/.test(r)) && !rows.some((r) => /Day 0/.test(r)), "a day that isn't a number reads 'Day ?'");
  ok(/Supercalifragilisticexpialidocious/.test(rows[0]) && !/Supercalifragilisticexpialidocious{4}/.test(rows[0]) && (await p.evaluate(() => window.__tripCtx.S.trip.changes.ops[0].place.name.length)) <= 120, "place name clamped to 120");

  // 5. repainted when a stop disappears on the other phone
  await p.evaluate((id) => window.__tripCtx.S.store.deleteItem(window.__tripCtx.S.tripId, id), ids.a);
  await p.waitForFunction(() => /Can't apply/.test(document.getElementById("chgList")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const rows2 = await p.$$eval(".chg-op", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ")));
  ok(rows2.length === 2 && /Can't apply/.test(rows2[1]) , "the review repaints when a stop is deleted: " + rows2[1].slice(0, 60));
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));
  await closeModal();

  // nothing applicable
  let msg = "";
  try { await propose([{ type: "move", itemId: "ghost", toDay: 1 }, { type: "teleport" }]); } catch (e) { msg = e.message; }
  ok(/None of those changes could be applied/.test(msg) && !(await p.evaluate(() => window.__tripCtx.S.trip.changes)), "all-unusable answer: says nothing could be applied, stores nothing: " + msg.slice(0, 80));

  /* ---- 2. a late Gemini answer never replaces an open form */
  console.log("late answers");
  geminiDelay = 1200;
  geminiReply = { kind: "changes", summary: "x", ops: [{ type: "day", day: 1, notes: "Slow start." }] };
  await p.fill("#changeInput", "make Day 1 slower");
  await p.click("[data-action=chgGemini]");
  await p.evaluate(() => {
    const c = window.__tripCtx;
    c.openModal(`<h3>Edit stop</h3><label>Title<input name="title" id="halfTyped"></label>`, () => {});
  });
  await p.fill("#halfTyped", "half typed note");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes, null, { timeout: 8000 });
  await p.waitForTimeout(800);
  ok((await p.inputValue("#halfTyped").catch(() => null)) === "half typed note", "Ask Gemini answer arrives while a form is open: the form is left alone");
  ok(/Gemini suggests 1 change/.test(await toast(p)), "and a toast says where the changes are");
  await closeModal();
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));
  // with no modal open the review still opens
  await p.waitForSelector("#changeInput");
  await p.fill("#changeInput", "make Day 1 slower");
  await p.click("[data-action=chgGemini]");
  await p.waitForSelector("#chgList .chg-op", { timeout: 8000 });
  ok(true, "with no form open, the review opens by itself");
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));
  await closeModal();

  // paste sheet
  geminiDelay = 1500;
  geminiReply = { kind: "changes", request: "Find places in pasted text", summary: "Found two.", ops: addOps(["Da Enzo al 29"]) };
  await p.evaluate(() => window.__tripCtx.openPaste("Try Da Enzo al 29 in Trastevere, it is great."));
  await p.waitForSelector("#pasteText");
  await p.click("[data-action=pasteGemini]");
  await p.waitForTimeout(150);
  // close the sheet, open another form, late answer lands
  await p.evaluate(() => { const c = window.__tripCtx; c.$modal.close(); c.openModal(`<h3>Edit stop</h3><input id="halfTyped2" name="t">`, () => {}); });
  await p.fill("#halfTyped2", "keep me");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes, null, { timeout: 8000 });
  await p.waitForTimeout(700);
  ok((await p.inputValue("#halfTyped2").catch(() => null)) === "keep me", "Find with Gemini answer arrives while another form is open: the form is left alone");
  await closeModal();
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));

  // 3. reopening the sheet while a request runs
  geminiDelay = 2500;
  await p.evaluate(() => window.__tripCtx.openPaste("Try Da Enzo al 29 in Trastevere, it is great."));
  await p.waitForSelector("#pasteText");
  await p.click("[data-action=pasteGemini]");
  await p.waitForTimeout(200);
  await closeModal();
  await p.evaluate(() => window.__tripCtx.openPaste("Another long tip about Rome that goes on a bit, Roscioli is lovely."));
  await p.waitForSelector("#pasteText");
  ok(await p.isDisabled("[data-action=pasteGemini]") && await p.isDisabled("[data-action=pasteClaude]") && /Still reading/.test(await p.textContent("#pasteBusy")) && await p.isVisible("#pasteBusy"), "reopened while busy: buttons are disabled and a busy line shows");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes, null, { timeout: 10000 });
  await p.waitForTimeout(500);
  ok(await p.isVisible("#pasteText") && await p.isEnabled("[data-action=pasteGemini]"), "the reopened sheet is left open and its buttons come back");
  await closeModal();
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));
  geminiDelay = 0;

  // 7. cut text notice for Claude
  await p.evaluate(() => window.__tripCtx.openPaste(""));
  await p.waitForSelector("#pasteText");
  ok(await p.isHidden("#pasteCut"), "no cut note for short text");
  await p.fill("#pasteText", "y".repeat(20001));
  ok(/first 20,000 characters/.test(await p.textContent("#pasteCut")), "20,000 note shows");
  await closeModal();

  /* ---- 6. answers that aren't JSON */
  console.log("unreadable answers");
  geminiRaw = "Sorry, I can't help with that.";
  await p.fill("#changeInput", "do a thing");
  await p.click("[data-action=chgGemini]");
  await p.waitForFunction(() => /Try again/.test(document.getElementById("toast").textContent), null, { timeout: 5000 });
  ok(!/Unexpected|JSON|null/.test(await toast(p)), "plain-words error: " + (await toast(p)));
  geminiRaw = 'Here you go: ' + JSON.stringify({ kind: "changes", summary: "ok", ops: [{ type: "day", day: 2, notes: "Easy day." }] }) + " Hope that helps!";
  await p.fill("#changeInput", "do a thing");
  await p.click("[data-action=chgGemini]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes, null, { timeout: 8000 });
  ok(true, "an answer with chatter around the JSON still works");
  geminiRaw = null;
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { changes: null }));
  await closeModal();
  const draftOk = await p.evaluate(async () => {
    const { checkDraft } = await import("./profile.js");
    const c = window.__tripCtx;
    try {
      checkDraft({ days: [null, 5, { items: null }, { day: 1, items: [null, 7, { name: "Forum" }] }], stays: [null] }, c.S.trip, c.profileOf(c.S.trip));
      return "fine";
    } catch (e) { return e.message; }
  });
  ok(draftOk === "fine", "checkDraft copes with null days and items: " + draftOk);

  /* ---- 4. shuffle asks before replacing a proposal */
  console.log("shuffle");
  await propose(addOps(["Waiting Cafe"]), "waiting");
  dialogs.length = 0;
  dialogAnswer = false;
  await p.click("section.day[data-day] >> nth=0 >> [data-action=shuffleDay]");
  await p.waitForTimeout(500);
  ok(dialogs.length === 1 && /Replace the 1 change waiting for review\?/.test(dialogs[0]), "shuffle with a proposal waiting asks first: " + dialogs[0]);
  ok((await p.evaluate(() => window.__tripCtx.S.trip.changes.request)) === "waiting", "Cancel keeps the waiting proposal");
  dialogAnswer = true;
  await p.click("section.day[data-day] >> nth=0 >> [data-action=shuffleDay]");
  await p.waitForFunction(() => /Shuffle/.test(window.__tripCtx.S.trip.changes?.request || ""), null, { timeout: 5000 });
  ok(true, "OK replaces it with the shuffle");
  await closeModal();
  dialogs.length = 0;
  await p.click("section.day[data-day] >> nth=0 >> [data-action=shuffleDay]");
  await p.waitForTimeout(500);
  ok(dialogs.length === 1, "a second shuffle replaces the first one only after asking");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  fails++;
  console.log("  FAIL exception: " + e.stack);
} finally {
  await b.close();
  srv.kill();
}
console.log(fails ? `\n${fails} failure(s)` : "\nAll breakfix-b checks passed");
process.exit(fails ? 1 : 0);
