// Search test: trip-wide search (stops, ideas, bookings, Kit, notes) with jump + highlight, and the pinned Ideas chips with counts and search box.
// Run: node tests/search.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-search-"));
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
const bc = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await bc.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  if (/nominatim\.openstreetmap\.org/.test(r.request().url())) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "41.9", lon: "12.5" }]) });
  return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
});
const T = (s) => p.evaluate(s);
const hits = () => p.$$eval(".srch-r", (e) => e.map((x) => x.textContent.trim()));
const find = async (q) => { await p.fill("#srchQ", q); await p.waitForTimeout(50); return hits(); };

try {
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Test trip");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  await T(async () => {
    const c = window.__tripCtx;
    const mk = (title, category, extra = {}) => ({ title, location: title + ", Rome", category, lat: 41.9, lng: 12.5, ...extra });
    await c.addPlaces([
      mk("Colosseum", "sight", { notes: "Book the underground tour a week ahead" }),
      mk("Trattoria Verde", "food", { notes: "Great pizza margherita, closed Mondays" }),
      mk("Villa Borghese", "nature"),
      mk("Tourist Trap Pizza", "food"),
      mk("Pasta Corner", "food", { notes: "Cash only" }),
      mk("Café Èclair", "food"),
    ], { url: "https://example.com/x", source: "test", autoPlace: false });
    const S = c.S, hit = S.items.find((i) => i.title === "Colosseum");
    await S.store.updateItem(S.tripId, hit.id, { dayId: S.trip.days[1].id, order: 1 });
    await S.store.txTrip(S.tripId, (cur) => ({
      bookings: [{ id: "bk1", kind: "hotel", title: "Hotel Quirinale", ref: "ZX81QP", start: "2026-11-10T14:00", end: "2026-11-13T11:00", address: "Via Nazionale 7", notes: "", cost: 0, currency: "INR" }],
      checklist: [{ id: "ck1", group: "todo", text: "Buy Vatican tickets", done: false }, { id: "ck2", group: "pack", text: "Rain jacket", done: false }],
      tripNotes: [{ id: "nt1", text: "Ask about a gelato class\nmaybe on day 3", by: "akash@demo", byName: "Akash", at: Date.now(), done: false }],
    }));
  });
  await p.waitForFunction(() => window.__tripCtx.S.items.length === 6 && window.__tripCtx.S.trip.bookings?.length === 1 && window.__tripCtx.S.items.some((i) => i.dayId));

  // ---- trip-wide search
  ok(!!(await p.$("[data-action=search]")), "the trip header has a search button");
  await p.click("[data-action=search]");
  ok(await p.isVisible("#srchQ") && await p.evaluate(() => document.activeElement.id === "srchQ"), "search opens with the box focused");
  const shot = (n) => process.env.SHOTS && p.screenshot({ path: `${process.env.SHOTS}/search-${n}.png` });
  let r = await find("underground tour");
  await shot("results");
  ok(r.length === 1 && /Colosseum/.test(r[0]) && /Plan/.test(await p.textContent(".srch-res")) && /Day 2/.test(r[0]), "a stop is found by its note, under Plan, with its day");
  await p.click(".srch-r");
  ok(await p.evaluate(() => window.__tripCtx.S.tab === "plan" && !document.querySelector(".srch-ov")), "tapping it closes search and opens the Plan tab");
  ok(await p.evaluate(() => { const e = document.querySelector(".card.srch-hit"); return !!e && /Colosseum/.test(e.textContent); }), "the stop is highlighted");

  await p.click("[data-action=search]");
  r = await find("quirinale");
  ok(r.length === 1 && /Hotel Quirinale/.test(r[0]) && /Bookings/.test(await p.textContent(".srch-res")), "a booking is found by its name");
  await p.click(".srch-r");
  ok(await p.evaluate(() => window.__tripCtx.S.tab === "kit" && /Quirinale/.test(document.querySelector(".bk-card.srch-hit")?.textContent || "")), "it jumps to the Kit tab and highlights the booking");
  await p.click("[data-action=search]");
  r = await find("zx81");
  ok(r.length === 1 && /Hotel Quirinale/.test(r[0]), "a booking is found by its reference");
  await p.keyboard.press("Escape");
  ok(!(await p.$(".srch-ov")), "Escape closes search");

  await p.click("[data-action=search]");
  r = await find("closed mondays");
  ok(r.length === 1 && /Trattoria Verde/.test(r[0]) && /Ideas/.test(await p.textContent(".srch-res")), "an idea is found by a tip in its notes, under Ideas");
  await p.click(".srch-r");
  ok(await p.evaluate(() => window.__tripCtx.S.tab === "ideas" && /Trattoria/.test(document.querySelector(".card.srch-hit")?.textContent || "")), "it jumps to the Ideas tab and highlights the idea");

  await p.click("[data-action=search]");
  r = await find("vatican");
  ok(r.length === 1 && /To-do/.test(r[0]), "a Kit to-do is found");
  await p.click(".srch-r");
  ok(await p.evaluate(() => /Vatican/.test(document.querySelector(".k-row.srch-hit")?.textContent || "")), "it is highlighted in the Kit");
  await p.click("[data-action=search]");
  r = await find("gelato");
  ok(r.length === 1 && /Trip notes/.test(await p.textContent(".srch-res")), "a trip note is found");
  await p.click(".srch-r");
  ok(await p.evaluate(() => /gelato/.test(document.querySelector(".nt-row.srch-hit")?.textContent || "")), "it is highlighted in the Kit notes");
  await p.click("[data-action=search]");
  ok((await find("cafe eclair")).length === 1 && (await find("CAFÉ")).length === 1, "accents and capitals don't matter");
  ok((await find("pizza")).length === 2, "several words/ideas match (Trattoria note + Tourist Trap Pizza)");
  ok((await find("pizza closed")).length === 1, "all words must match");
  ok((await find("zzzz")).length === 0 && /Nothing in this trip matches/.test(await p.textContent(".srch-res")), "no match says so");
  ok(await p.evaluate(() => document.querySelector(".srch-res").textContent.length > 0), "results render");
  await p.click("[data-action=searchClose]");

  // ---- Ideas chips and search box
  await p.click(".tabs-bar [data-tab=ideas]");
  await shot("ideas");
  const chips = () => p.$$eval(".idea-chips .chip", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  let c = await chips();
  ok(c[0] === "All 5" && c.some((x) => /Food & drink 4/.test(x)) && c.some((x) => /Nature 1/.test(x)), "chips show counts: " + c.join(" | "));
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".idea-bar")).position === "sticky"), "the filter bar is sticky");
  await p.evaluate(() => window.scrollTo(0, 400));
  ok(await p.evaluate(() => { const r = document.querySelector(".idea-bar").getBoundingClientRect(); return r.top >= 0 && r.top < 120; }), "the bar stays near the top when scrolled");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click("[data-action=ideaFilter][data-id=food]");
  const shown = () => p.$$eval(".tab-body .card .c-title", (e) => e.map((x) => x.textContent.trim()));
  ok((await shown()).length === 4, "Food chip shows the 4 food ideas");
  await p.fill("#ideaQ", "pizza");
  await p.waitForFunction(() => document.querySelectorAll(".tab-body .card").length === 2);
  ok((await shown()).sort().join() === "Tourist Trap Pizza,Trattoria Verde", "Food + “pizza” combines");
  c = await chips();
  ok(c[0] === "All 2" && c.some((x) => /Food & drink 2/.test(x)) && c.some((x) => /Nature 0/.test(x)), "counts follow the search box: " + c.join(" | "));
  ok(await p.evaluate(() => document.activeElement.id === "ideaQ"), "typing keeps focus in the box");
  await p.fill("#ideaQ", "zzzz");
  ok(/Nothing matches/.test(await p.textContent(".tab-body")), "no match message");
  await p.fill("#ideaQ", "");
  await p.click("[data-action=ideaFilter][data-id=all]");
  ok((await shown()).length === 5, "clearing both brings all 5 back");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll search checks passed");
process.exit(fails ? 1 : 0);
