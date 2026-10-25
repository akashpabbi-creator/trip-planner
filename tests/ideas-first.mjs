// Ideas-first test: saved links never land on days unless the new linksToDays preference is on, and a post's advice
// (tips, book-ahead) is kept in notes, the Kit to-dos and the trip notes without doubling up.
// Run: node tests/ideas-first.mjs   (copies the repo to a temp dir in demo mode; Gemini and other hosts are mocked)
// SHOTS=<dir> also writes the two phone screenshots.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-ideas-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const place = (name, extra = {}) => ({ name, category: "food", address: "Via Roma 1", durationMin: 60, approxCost: 1500, bestTime: "evening", hours: "", vegetarian: "yes", why: "Loved by locals", tips: "", bookAheadDays: null, ...extra });
const ANSWER = { places: [
  place("Trattoria Verde", { tips: "Book 3 days in advance, go before 8am for the terrace", bookAheadDays: 3, hours: "Closed Mondays" }),
  place("Colosseo Cafe", { category: "sight", tips: "Cash only", bookAheadDays: 2, vegetarian: "" }),
  place("Hidden Garden", { category: "nature", tips: "x".repeat(400), bookAheadDays: 900, vegetarian: "" }),
  place("Quiet Pizza", { tips: "no need to book", vegetarian: "" }),
], tips: ["Carry small cash for village stalls", "Buses stop at 9pm", "a".repeat(400), "", "t4", "t5", "t6"] };
const ANSWER2 = { places: [place("Trattoria Verde", { tips: "Reserve by WhatsApp", bookAheadDays: 3 })], tips: ["Carry small cash for village stalls"] };
let answer = ANSWER;
const gem = [];
const b = await chromium.launch();
const errors = [];
const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
const d = await c.newPage();
d.on("pageerror", (e) => errors.push(e.stack));
await d.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const u = r.request().url();
  if (u.includes("generativelanguage.googleapis.com")) {
    gem.push(r.request().postDataJSON().contents[0].parts[0].text);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(answer) + "\n```" }] } }] }) });
  }
  if (u.includes("microlink")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", data: { title: "Rome food guide", description: "Book 3 days in advance at Trattoria Verde", publisher: "Instagram" } }) });
  if (u.includes("nominatim")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "41.9", lon: "12.49" }]) });
  return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
});

try {
  await d.goto(URL0);
  await d.fill("#demoName", "Akash");
  await d.click("[data-action=signin]");
  await d.click("[data-action=newTrip]");
  await d.fill("[name=name]", "Rome trip");
  await d.fill("[name=destination]", "Rome");
  await d.fill("[name=numDays]", "4");
  await d.fill("[name=startDate]", "2026-11-10").catch(() => {});
  await d.click("#modalForm button[value=ok]");
  await d.waitForSelector(".tab-body");
  // The old default is stored on the trip, and a Gemini key is set.
  await d.evaluate(async () => {
    const c = window.__tripCtx;
    await c.S.store.txTrip(c.S.tripId, () => ({ profile: { autoPlace: true } }));
    await c.S.store.updatePrivate(c.S.me.email, { ai: { key: "TESTKEY", model: "x" } });
  });
  await d.waitForFunction(() => window.__tripCtx.aiKey() === "TESTKEY" && window.__tripCtx.S.trip.profile?.autoPlace === true);

  console.log("ideas first");
  ok(await d.evaluate(() => window.__tripCtx.profileOf(window.__tripCtx.S.trip).linksToDays === false), "stored autoPlace: true does not turn on placing on days");
  await d.evaluate(() => { window.__tripCtx.S.tab = "plan"; window.__tripCtx.render(); });
  await d.fill("#linkInput", "https://www.instagram.com/p/AAA111/");
  await d.press("#linkInput", "Enter");
  await d.waitForFunction(() => window.__tripCtx.S.items.filter((i) => i.fromLink).length === 4, null, { timeout: 15000 });
  await d.waitForFunction(() => !window.__tripCtx.S.busy);
  await d.waitForFunction(() => (window.__tripCtx.S.trip.checklist || []).length >= 1 && (window.__tripCtx.S.trip.tripNotes || []).length >= 1);
  const s1 = await d.evaluate(() => { const S = window.__tripCtx.S; return { items: S.items.filter((i) => i.fromLink).map((i) => ({ t: i.title, dayId: i.dayId, notes: i.notes })), list: S.trip.checklist, notes: S.trip.tripNotes, tab: S.tab, toast: document.getElementById("toast").textContent }; });
  ok(s1.items.length === 4 && s1.items.every((i) => i.dayId === null), "all 4 places are in Ideas (dayId null)");
  ok(s1.tab === "ideas", "switched to the Ideas tab");
  ok(/Saved 4 places to Ideas/.test(s1.toast), "toast: " + s1.toast);
  const tv = s1.items.find((i) => i.t === "Trattoria Verde"), cc = s1.items.find((i) => i.t === "Colosseo Cafe"), hg = s1.items.find((i) => i.t === "Hidden Garden");
  ok(/^Book 3 days in advance, go before 8am/.test(tv.notes) && /Closed Mondays/.test(tv.notes), "notes carry tip + hours: " + tv.notes);
  ok(!/Book 3 days ahead.*Book 3 days in advance/.test(tv.notes), "no doubled 'book' text when the tip already says it");
  ok(/^Book 2 days ahead · Cash only/.test(cc.notes), "bookAheadDays + tip in notes: " + cc.notes);
  ok(hg.notes.length <= 300, `long tip clipped, notes ${hg.notes.length} chars`);
  const todos = (s1.list || []).filter((x) => x.group === "todo");
  ok(todos.some((x) => x.text === "Book Trattoria Verde (3 days ahead)"), "Kit to-do: " + todos.map((x) => x.text).join(" | "));
  ok(!todos.some((x) => /Quiet Pizza/.test(x.text)), "'no need to book' makes no to-do");
  ok(todos.some((x) => x.text === "Book Colosseo Cafe (2 days ahead)") && !todos.some((x) => /Hidden Garden/.test(x.text)), "out-of-range bookAheadDays (900) makes no to-do: " + todos.map((x) => x.text).join(" | "));
  ok(s1.notes.length === 1 && /^Tips from /.test(s1.notes[0].text) && /Carry small cash/.test(s1.notes[0].text), "one general tips note: " + s1.notes[0]?.text.slice(0, 90));
  ok(!s1.notes[0].text.includes("t6") && s1.notes[0].text.split(" · ").length <= 5 && s1.notes[0].text.length < 1100, "at most 5 tips, each clipped");
  ok(/places on days|1 day|3 day|ahead|JSON/.test(gem[0]) && /"tips"/.test(gem[0]) && /bookAheadDays/.test(gem[0]), "the Gemini prompt asks for tips and bookAheadDays");

  console.log("no double-up");
  answer = ANSWER2;
  await d.fill("#linkInput", "https://www.instagram.com/p/BBB222/");
  await d.press("#linkInput", "Enter");
  await d.waitForFunction(() => /already in Ideas/.test(document.getElementById("toast").textContent), null, { timeout: 15000 });
  await d.waitForFunction(() => !window.__tripCtx.S.busy);
  const dupe = await d.evaluate(() => { const S = window.__tripCtx.S; return { n: S.items.filter((i) => i.fromLink).length, tv: S.items.filter((i) => i.title === "Trattoria Verde").map((i) => i.notes) }; });
  ok(dupe.n === 4 && dupe.tv.length === 1, "the same restaurant in a second post is not added again");
  ok(/Reserve by WhatsApp/.test(dupe.tv[0]) && /Book 3 days in advance/.test(dupe.tv[0]), "its new tip is merged into the saved card: " + dupe.tv[0]);
  const s2 = await d.evaluate(() => { const S = window.__tripCtx.S; return { todos: S.trip.checklist.filter((x) => /Trattoria/.test(x.text)).length, notes: S.trip.tripNotes.length, placed: S.items.filter((i) => i.fromLink && i.dayId).length }; });
  ok(s2.todos === 1, "second save of the same restaurant: still one to-do");
  ok(s2.notes === 2, `a different tips list adds its own note (${s2.notes}), the same one would not`);
  await d.evaluate(() => window.__tripCtx.saveTips({ todos: ["Book Trattoria Verde (3 days ahead)"], tips: ["Carry small cash for village stalls"], label: "x" }));
  await d.evaluate(() => window.__tripCtx.saveTips({ tips: ["Carry small cash for village stalls"], label: "x" }));
  const s3 = await d.evaluate(() => { const t = window.__tripCtx.S.trip; return { todos: t.checklist.filter((x) => /Trattoria/.test(x.text)).length, notes: t.tripNotes.length }; });
  ok(s3.todos === 1, "saveTips twice: no duplicate to-do");
  ok(s3.notes === 3, "saveTips: the same note text twice adds only one note");
  ok(s2.placed === 0, "nothing from links is on a day");

  console.log("linksToDays on");
  await d.evaluate(async () => { const c = window.__tripCtx; await c.S.store.txTrip(c.S.tripId, () => ({ profile: { linksToDays: true } })); });
  await d.waitForFunction(() => window.__tripCtx.profileOf(window.__tripCtx.S.trip).linksToDays === true);
  answer = { places: [place("Opt In Museum", { category: "sight", vegetarian: "" })], tips: [] };
  await d.fill("#linkInput", "https://www.instagram.com/p/CCC333/");
  await d.press("#linkInput", "Enter");
  await d.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Opt In Museum"), null, { timeout: 15000 });
  await d.waitForFunction(() => !window.__tripCtx.S.busy);
  ok(await d.evaluate(() => !!window.__tripCtx.S.items.find((i) => i.title === "Opt In Museum").dayId), "with linksToDays on, the place goes onto a day");
  const pref = await d.evaluate(() => window.__tripCtx.addPlaces([{ title: "Explicit off", category: "sight", lat: 41.9, lng: 12.49 }], { autoPlace: false }).then((r) => r[0].where));
  ok(pref === null, "explicit autoPlace: false still wins");

  if (process.env.SHOTS) {
    console.log("screenshots");
    mkdirSync(process.env.SHOTS, { recursive: true });
    await d.evaluate(async () => { const c = window.__tripCtx; await c.S.store.txTrip(c.S.tripId, () => ({ profile: { linksToDays: false }, checklist: [], tripNotes: [] })); for (const i of c.S.items.filter((i) => i.fromLink)) await c.S.store.deleteItem(c.S.tripId, i.id); });
    await d.waitForFunction(() => !window.__tripCtx.S.items.some((i) => i.fromLink));
    answer = { places: [ANSWER.places[0], ANSWER.places[1], place("Giardino degli Aranci", { category: "nature", vegetarian: "", tips: "Go before 8am to avoid the crowds", hours: "Open daily", bestTime: "morning" })], tips: ["Carry small cash for village stalls", "Buses stop at 9pm, so plan a taxi back"] };
    await d.evaluate(() => { window.__tripCtx.S.tab = "plan"; window.__tripCtx.render(); });
    await d.fill("#linkInput", "https://www.instagram.com/p/AAA111/");
    await d.press("#linkInput", "Enter");
    await d.waitForFunction(() => window.__tripCtx.S.tab === "ideas" && window.__tripCtx.S.items.filter((i) => i.fromLink).length === 3 && !window.__tripCtx.S.busy);
    await d.addStyleTag({ content: "#toast{display:none!important}" });
    await d.waitForTimeout(600);
    await d.locator(".c-notes", { hasText: "Book 3 days in advance" }).first().scrollIntoViewIfNeeded();
    await d.screenshot({ path: join(process.env.SHOTS, "ideas-tab.png") });
    await d.evaluate(() => { const c = window.__tripCtx; c.S.tab = "kit"; c.render(); });
    await d.waitForTimeout(500);
    await d.locator("#kit-todo").scrollIntoViewIfNeeded();
    await d.screenshot({ path: join(process.env.SHOTS, "kit-tab.png") });
    await d.locator(".nt-row").first().scrollIntoViewIfNeeded();
    await d.screenshot({ path: join(process.env.SHOTS, "kit-tips-note.png") });
  }
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
