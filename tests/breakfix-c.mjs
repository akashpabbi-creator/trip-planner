// Break-fix C: spend double tap, booking currencies, sanity checks, ics DTEND, Discover network error, Smart rest blocks.
// Run: node tests/breakfix-c.mjs   (demo mode in a temp copy, all external hosts mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-bfc-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 9090 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const rate = { mode: "ok", delay: 0, calls: 0 };
const guide = { mode: "fail" }; // wikivoyage: fail (network down) or empty (200, no such page)

async function newPage(bctx, query = "") {
  const p = await bctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (u.startsWith("https://api.frankfurter.app/")) {
      rate.calls++;
      if (rate.delay) await new Promise((ok) => setTimeout(ok, rate.delay));
      if (rate.mode !== "ok") return r.fulfill({ status: 500, body: "boom" });
      const from = new URL(u).searchParams.get("from");
      const v = { EUR: 90, GBP: 105 }[from] || 1;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ amount: 1, base: from, rates: { INR: v } }) });
    }
    if (u.startsWith("https://open.er-api.com/")) return r.abort();
    if (u.includes("wikivoyage.org")) {
      if (guide.mode === "fail") return r.abort();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: { code: "missingtitle" } }) });
    }
    r.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await p.goto(URL0 + query);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, dest = "Rome") {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Break trip");
  await p.fill("[name=destination]", dest);
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10").catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
const tabClick = (p, id) => p.click(`.tabs-desk [data-tab=${id}]`);
const toasts = (p) => p.evaluate(() => document.querySelector("#toast")?.textContent || "");

try {
  const bctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const A = await newPage(bctx);
  await makeTrip(A);
  await A.waitForTimeout(500);

  /* ---- 1. spend double tap */
  console.log("spend double tap");
  await tabClick(A, "budget");
  await A.waitForSelector("#kit-spend");
  await A.click("[data-action=kSpendForm]");
  await A.fill("#kSpAmt", "50");
  await A.selectOption("#kSpCur", "EUR");
  await A.fill("#kSpLabel", "Dinner");
  rate.delay = 700;
  await A.evaluate(() => { const b = document.querySelector("[data-action=kSpendAdd]"); b.click(); b.click(); });
  await A.waitForTimeout(1800);
  rate.delay = 0;
  let n = await A.evaluate(() => window.__tripCtx.S.trip.spends.length);
  ok(n === 1, "double tap with a foreign currency saves one spend (got " + n + ")");
  ok((await A.inputValue("#kSpAmt")) === "", "amount field cleared");

  /* ---- 3. sanity: spends */
  console.log("sanity checks");
  await A.fill("#kSpAmt", "0.001");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForTimeout(200);
  n = await A.evaluate(() => window.__tripCtx.S.trip.spends.length);
  ok(n === 1 && /too small/.test(await toasts(A)), "spend below 0.01 refused with a toast");
  await A.fill("#kSpAmt", "2000000000");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForTimeout(200);
  n = await A.evaluate(() => window.__tripCtx.S.trip.spends.length);
  ok(n === 1 && /too big/.test(await toasts(A)), "spend above 1e9 refused with a toast");

  /* ---- bookings: validation */
  await tabClick(A, "kit");
  await A.waitForSelector("#bk-sec");
  await A.click("[data-action=bkNew]");
  await A.waitForSelector(".bk-form");
  await A.fill("[name=title]", "Backwards flight");
  await A.fill("[name=start]", "2026-11-10T10:00");
  await A.fill("[name=end]", "2026-11-10T08:00");
  await A.click("#modalForm button[value=ok]");
  await A.waitForTimeout(300);
  ok((await A.isVisible(".bk-form")) && /end is before the start/i.test(await toasts(A)), "booking end before start refused, form stays open");
  await A.fill("[name=end]", "2026-11-10T12:00");
  await A.evaluate(() => { const i = document.querySelector("[name=cost]"); i.removeAttribute("max"); });
  await A.fill("[name=cost]", "5000000000");
  await A.click("#modalForm button[value=ok]");
  await A.waitForTimeout(300);
  ok((await A.isVisible(".bk-form")) && /too big/.test(await toasts(A)), "booking cost above 1e9 refused");
  ok((await A.evaluate(() => (window.__tripCtx.S.trip.bookings || []).length)) === 0, "nothing saved from the refused forms");

  /* ---- 2. booking in a foreign currency */
  console.log("booking currencies");
  rate.mode = "fail";
  await A.fill("[name=cost]", "100");
  await A.selectOption("[name=currency]", "GBP");
  await A.click("#modalForm button[value=ok]");
  await A.waitForFunction(() => (window.__tripCtx.S.trip.bookings || []).length === 1);
  await tabClick(A, "budget");
  await A.waitForSelector("#bkNotCounted");
  const note = (await A.textContent("#bkNotCounted")).trim();
  ok(/1 booking in other currencies isn't counted yet/.test(note), "Budget says 1 booking in another currency isn't counted: " + note);
  rate.mode = "ok";
  await A.evaluate(() => window.dispatchEvent(new Event("online")));
  await A.waitForFunction(() => !document.querySelector("#bkNotCounted"), null, { timeout: 6000 });
  const tot = await A.evaluate(() => window.__tripCtx.costs().total);
  ok(tot === 10500, "once the rate arrives the booking counts: 100 GBP x 105 = 10,500 (got " + tot + ")");

  /* ---- 3b. ics never ends before it starts */
  await A.evaluate(async () => {
    const S = window.__tripCtx.S;
    const base = { ref: "", from: "", to: "", address: "", cost: 0, currency: "INR", notes: "", by: S.me.email, at: 1 };
    await S.store.txTrip(S.tripId, (c) => ({ bookings: [...c.bookings, { ...base, id: "bad1", kind: "train", title: "Odd train", start: "2026-11-11T10:00", end: "2026-11-11T08:00" }, { ...base, id: "bad2", kind: "hotel", title: "Odd hotel", start: "2026-11-12", end: "2026-11-11" }] }));
  });
  await tabClick(A, "itinerary");
  const [dl] = await Promise.all([A.waitForEvent("download"), A.click("[data-action=kIcs]")]);
  const ics = readFileSync(await dl.path(), "utf8").replace(/\r\n /g, "");
  const evs = ics.split("BEGIN:VEVENT").slice(1);
  let bad = 0;
  for (const e of evs) {
    const s = /DTSTART[^:\n]*:(\d{8}(?:T\d{6})?)/.exec(e)?.[1], en = /DTEND[^:\n]*:(\d{8}(?:T\d{6})?)/.exec(e)?.[1];
    if (s && en && en < s) bad++;
  }
  ok(evs.length >= 3 && bad === 0, `no event has DTEND before DTSTART (${evs.length} events, ${bad} bad)`);

  /* ---- 5. Smart does not count rest blocks */
  console.log("smart rest blocks");
  await A.evaluate(async () => {
    const S = window.__tripCtx.S;
    const base = { category: "other", description: "", dayId: S.trip.days[0].id, durationMin: 60, cost: 0, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now() };
    await S.store.addItem(S.tripId, { ...base, title: "Rest & recharge", rest: true, order: 1, time: "15:00" });
    await S.store.addItem(S.tripId, { ...base, title: "Mystery cafe", category: "food", order: 2, time: "", geoFailed: true });
  });
  await tabClick(A, "smart");
  await A.waitForFunction(() => /not on the map yet/.test(document.body.textContent));
  const smart = await A.evaluate(() => document.body.textContent.match(/(\d+) places? not on the map yet/)?.[0]);
  ok(smart === "1 place not on the map yet", "Smart counts only the real place, not Rest & recharge: " + smart);

  /* ---- 4. Discover: network error vs no listings */
  console.log("discover guide");
  await tabClick(A, "discover");
  await A.waitForSelector(".d-sec");
  const g = await A.evaluate(() => window.__tripCtx.S.trip.guide);
  ok(g && g.failed === true && !g.listings.length, "guide marked failed when the network was down: " + JSON.stringify(g || null).slice(0, 80));
  ok(/Couldn't reach the travel guide\. Check your connection and tap Refresh\./.test(await A.textContent(".tab-body")), "Discover says it couldn't reach the guide");
  ok(!/No guide listings found/.test(await A.textContent(".tab-body")), "and not 'No guide listings found'");
  guide.mode = "empty";
  await A.click("[data-action=refreshDest]");
  await A.waitForFunction(() => /No guide listings found/.test(document.querySelector(".tab-body")?.textContent || ""), null, { timeout: 15000 });
  ok(true, "with a working network and no page, the old 'No guide listings found' message stays");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message, e.stack?.split("\n").slice(1, 4).join("\n"));
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll breakfix-c checks passed");
process.exit(fails ? 1 : 0);
