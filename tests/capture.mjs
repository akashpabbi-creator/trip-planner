// Screenshot import, bookings from emails, price links, share-target logic.
// Run: node tests/capture.mjs   (copies the repo to a temp dir in demo mode; Gemini and other hosts are mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import zlib from "zlib";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };

/* ------------------------------------------------------------------ unit: regex reader */
console.log("regex booking reader");
const { parseBookingText, datesIn, timesIn } = await import(join(root, "bookings.js"));
const trip = { startDate: "2026-11-10", currency: "INR", destination: "Mumbai" };
const indigo = `IndiGo
Your booking is confirmed
Booking Reference (PNR): Q7XK2L
Flight 6E 2145
Departure: Delhi (DEL)  Tue, 10 Nov 2026  06:40 hrs
Arrival: Mumbai (BOM)  Tue, 10 Nov 2026  08:50 hrs
Total fare: ₹ 8,450.00`;
let b = parseBookingText(indigo, trip);
ok(b.kind === "flight" && b.ref === "Q7XK2L", "IndiGo: kind flight, PNR " + b.ref);
ok(/6E 2145/.test(b.title) && /DEL → BOM/.test(b.title), "IndiGo: flight number and route in title: " + b.title);
ok(b.start === "2026-11-10T06:40" && b.end === "2026-11-10T08:50", `IndiGo: date and times ${b.start} → ${b.end}`);
ok(b.cost === 8450 && b.currency === "INR", "IndiGo: fare ₹8,450 INR");
ok(/Delhi/.test(b.from) && /Mumbai/.test(b.to), `IndiGo: from/to ${b.from} / ${b.to}`);
const air = `Air India e-ticket
PNR 6GH3KD
AI 805  DEL → BOM
Date: 12-Nov-2026
Dep 18:25   Arr 20:40
Amount paid: INR 10,200`;
b = parseBookingText(air, trip);
ok(b.kind === "flight" && b.ref === "6GH3KD" && /AI 805/.test(b.title), "Air India: PNR and flight number " + b.title);
ok(b.start === "2026-11-12T18:25" && b.end === "2026-11-12T20:40" && b.cost === 10200, `Air India: ${b.start} → ${b.end}, ${b.cost}`);
const night = parseBookingText("Flight: UK 995\nPNR: XY12ZZ\nDeparture 23:30 on 5 Dec 2026 from Delhi (DEL)\nArrival 01:45 on 6 Dec 2026 at Singapore (SIN)", { startDate: "2026-12-01" });
ok(night.start === "2026-12-05T23:30" && night.end === "2026-12-06T01:45", `overnight flight arrives next day: ${night.start} → ${night.end}`);
const hotel = `Booking.com confirmation
Hotel: The Orchid Residency
Confirmation number: 4821937650
Check-in: Fri, 13 Nov 2026 from 14:00
Check-out: Mon, 16 Nov 2026 until 11:00
Address: 12 MG Road, Pune, Maharashtra
Room: Deluxe King
Total price: Rs. 18,600`;
b = parseBookingText(hotel, trip);
ok(b.kind === "hotel" && b.ref === "4821937650", "Hotel: kind and confirmation number " + b.ref);
ok(b.start === "2026-11-13T14:00" && b.end === "2026-11-16T11:00", `Hotel: check-in/out ${b.start} → ${b.end}`);
ok(/Orchid/.test(b.title) && /MG Road/.test(b.address) && b.cost === 18600, `Hotel: name "${b.title}", address, cost ${b.cost}`);
const hotel2 = parseBookingText("Your stay at Casa Verde is confirmed.\nBooking ID: HB77Q91\nCheck-in 2026-12-02\nCheck-out 2026-12-04\n2 nights\nTotal: $240", { startDate: "2026-12-01", currency: "USD" });
ok(hotel2.kind === "hotel" && hotel2.title === "Casa Verde" && hotel2.start === "2026-12-02T14:00" && hotel2.end === "2026-12-04T11:00" && hotel2.cost === 240 && hotel2.currency === "USD", "Hotel 2: ISO dates, default times, $ currency");
ok(datesIn("on 3/11/2026 and 07.12.26", {}).map((d) => d.ymd).join() === "2026-11-03,2026-12-07", "dates: DD/MM/YYYY and DD.MM.YY (India order)");
ok(timesIn("6:40 PM, 0715 hrs, 9 am").map((t) => t.hm).join() === "18:40,07:15,09:00", "times: 12h and 'hrs'");
ok(parseBookingText("hello there, nothing useful", trip).got === 0, "unrelated text finds nothing (got = 0)");

/* ------------------------------------------------------------------ unit: share POST handler */
console.log("service worker share handler");
{
  const store = new Map();
  const cache = { keys: async () => [...store.keys()], delete: async (k) => store.delete(k), put: async (k, r) => void store.set(k, r) };
  const sandbox = { self: { addEventListener() {}, registration: { scope: "https://x.test/trip/" } }, caches: { open: async () => cache }, Response, URL, URLSearchParams, location: { origin: "https://x.test" }, Request, Promise };
  const sw = vm.runInNewContext(readFileSync(join(root, "sw.js"), "utf8") + "\n({ takeShare, handleShare, CACHE, SHELL })", sandbox);
  store.set("shared-image/old", new Response("old"));
  const fd = new FormData();
  fd.append("images", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  fd.append("images", new File([new Uint8Array([4, 5])], "b.png", { type: "image/png" }));
  fd.append("images", new File([new Uint8Array([9])], "doc.pdf", { type: "application/pdf" }));
  fd.append("title", "Rome ideas");
  fd.append("text", "see https://example.com/rome");
  fd.append("url", "https://example.com/rome");
  const res = await sw.takeShare(fd, cache);
  const q = new URL(res.url, "https://x.test/trip/").searchParams;
  ok(res.saved === 2 && store.size === 2 && !store.has("shared-image/old"), "2 images cached (pdf skipped, old inbox cleared)");
  ok(res.url.startsWith("./?shared=1") && q.get("url") === "https://example.com/rome" && q.get("text") === "see https://example.com/rome" && q.get("title") === "Rome ideas", "redirect keeps url, text and title: " + res.url);
  ok((await store.get("shared-image/1").blob()).size === 2 && store.get("shared-image/0").headers.get("content-type") === "image/jpeg", "cached bodies and content types");
  const only = await sw.takeShare(new FormData(), cache);
  ok(only.url === "./?shared=1" && only.saved === 0 && store.size === 0, "empty share: plain ./?shared=1 and inbox emptied");
  const fd2 = new FormData(); fd2.append("images", new File([new Uint8Array([7])], "c.jpg", { type: "image/jpeg" }));
  const resp = await sw.handleShare({ formData: async () => fd2 });
  ok(resp.status === 303 && resp.headers.get("location") === "https://x.test/trip/?shared=1" && store.size === 1, "handleShare answers 303 to the app with images cached");
  const bad = await sw.handleShare({ formData: async () => { throw new Error("nope"); } });
  ok(bad.status === 303 && bad.headers.get("location") === "https://x.test/trip/", "a broken share still redirects to the app");
  ok(sw.SHELL.includes("bookings.js") && sw.SHELL.includes("capture.js") && /^trips-shell-v(1[7-9]|[2-9]\d)/.test(sw.CACHE), "SHELL lists bookings.js; cache bumped to " + sw.CACHE);
  const mf = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8")).share_target;
  ok(mf.method === "POST" && mf.enctype === "multipart/form-data" && mf.params.files?.[0]?.name === "images" && mf.params.files[0].accept.includes("image/*"), "manifest share_target is a multipart POST with images");
}

/* ------------------------------------------------------------------ browser */
const dir = mkdtempSync(join(tmpdir(), "tp-capture-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

// A 2400x1000 PNG with a gradient, written by hand (no image libraries).
function makePng(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x + seed * 40) % 256; raw[o + 1] = (y * 2 + seed) % 256; raw[o + 2] = (x * y + seed) % 256; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const png1 = join(dir, "shot1.png"), png2 = join(dir, "shot2.png");
writeFileSync(png1, makePng(2400, 1000, 1)); writeFileSync(png2, makePng(800, 600, 2));
function jpegSize(b64) {
  const buf = Buffer.from(b64, "base64");
  for (let i = 2; i < buf.length;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); }
  return null;
}

const PLACES = { places: [
  { name: "Trevi Fountain", category: "sight", address: "Piazza di Trevi, Rome", durationMin: 45, approxCost: 0, bestTime: "evening", hours: "Open 24h", vegetarian: "", why: "Rome's most famous fountain." },
  { name: "Roscioli Salumeria", category: "food", address: "Via dei Giubbonari 21, Rome", durationMin: 75, approxCost: 3000, bestTime: "lunch", hours: "", vegetarian: "yes", why: "Famous for its carbonara and a good veg menu." },
] };
const BOOKINGS = { bookings: [
  { kind: "flight", title: "IndiGo 6E 2145 BOM to FCO", ref: "ABC123", start: "2026-11-10T06:40", end: "2026-11-10T14:05", from: "Mumbai (BOM)", to: "Rome (FCO)", address: "", cost: 42000, currency: "INR", notes: "Seat 14A" },
  { kind: "hotel", title: "Hotel Roma Centro", ref: "HRC-55821", start: "2026-11-10T14:00", end: "2026-11-13T11:00", from: "", to: "", address: "Via Roma 1, Rome", cost: 30000, currency: "INR", notes: "Double room" },
] };
const gem = [];
const br = await chromium.launch();
const errors = [];
async function newPage(viewport) {
  const c = await br.newContext({ viewport });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.stack));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (u.includes("generativelanguage.googleapis.com")) {
      const body = r.request().postDataJSON();
      const parts = body.contents[0].parts;
      gem.push({ parts, tools: body.tools });
      const out = parts.some((x) => x.inline_data) ? PLACES : /booking confirmation email/.test(parts[0].text) ? BOOKINGS : { places: [] };
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(out) + "\n```" }] } }] }) });
    }
    if (u.includes("nominatim")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "41.9", lon: "12.49" }]) });
    return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, start) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome trip");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "4");
  await p.fill("[name=startDate]", start).catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
const addKitTab = (p) => p.evaluate(() => { const c = window.__tripCtx; c.tab({ id: "kit", icon: "🧰", label: "Kit", view: () => `<div id="kitHost">${c.renderSlot("kit")}</div>`, order: 50 }); c.render(); });
const toastText = (p) => p.textContent("#toast");

try {
  const d = await newPage({ width: 1200, height: 900 });
  await makeTrip(d, "2026-11-10");
  await addKitTab(d);

  /* ---- 📷 without Gemini */
  console.log("screenshot import");
  ok(await d.isVisible('[data-action=capturePick]'), "📷 button in the link bar");
  await d.click("[data-action=capturePick]");
  ok(/needs a free Gemini key/.test(await d.textContent("#modalForm")) && (await d.isVisible("#modalForm [data-action=bridgeOpen]")), "no key: explains and offers 'Send to Claude instead'");
  ok(/never saved anywhere/.test(await d.textContent("#modalForm")), "the modal says the picture is never saved");
  await d.click("#modalForm [data-action=bridgeOpen]");
  await d.waitForFunction(() => /Link this trip to a Claude chat/.test(document.getElementById("modalForm").textContent));
  ok(await d.evaluate(() => document.getElementById("modal").open), "'Send to Claude instead' swaps the sheet for Connect Claude");
  await d.keyboard.press("Escape");
  await d.waitForFunction(() => !document.getElementById("modal").open);

  /* ---- with Gemini */
  await d.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "TESTKEY", model: "x" } }));
  await d.waitForFunction(() => window.__tripCtx.aiKey() === "TESTKEY");
  const [fc] = await Promise.all([d.waitForEvent("filechooser"), d.click("[data-action=capturePick]")]);
  ok(fc.isMultiple(), "file picker allows several images");
  await fc.setFiles([png1, png2]);
  await d.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Trevi Fountain"), null, { timeout: 15000 });
  await d.waitForTimeout(500);
  const call = gem.find((g) => g.parts.some((x) => x.inline_data));
  ok(call && call.parts.filter((x) => x.inline_data).length === 2, "Gemini got both images");
  ok(call.tools?.some((t) => t.google_search), "image call uses search");
  const sizes = call.parts.filter((x) => x.inline_data).map((x) => jpegSize(x.inline_data.data));
  ok(sizes[0] && Math.max(sizes[0].w, sizes[0].h) <= 1600 && sizes[0].w === 1600 && call.parts[1].inline_data.mime_type === "image/jpeg", `2400x1000 shrunk to ${sizes[0]?.w}x${sizes[0]?.h} JPEG; the 800x600 one kept at ${sizes[1]?.w}x${sizes[1]?.h}`);
  const items = await d.evaluate(() => window.__tripCtx.S.items.map((i) => ({ title: i.title, dayId: i.dayId, via: i.via, veg: i.veg, category: i.category, cost: i.cost })));
  const trevi = items.find((i) => i.title === "Trevi Fountain"), ros = items.find((i) => i.title === "Roscioli Salumeria");
  ok(trevi && ros && trevi.via === "screenshot", "both places added (via screenshot)");
  ok(ros.veg === "yes" && ros.category === "food" && ros.cost === 3000, "restaurant keeps its veg tag and cost");
  ok(items.every((i) => i.dayId === null || typeof i.dayId === "string"), `places landed in days/Ideas: Trevi ${trevi.dayId ? "on a day" : "in Ideas"}, Roscioli ${ros.dayId ? "on a day" : "in Ideas"}`);
  ok(/from the screenshot/.test(await toastText(d)), "toast: " + (await toastText(d)));
  // never stored
  const marker = call.parts.find((x) => x.inline_data).inline_data.data.slice(400, 480);
  const dump = await d.evaluate(async () => {
    const c = window.__tripCtx;
    let all = JSON.stringify(c.S.trip) + JSON.stringify(c.S.items) + JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage));
    const dbs = (await indexedDB.databases?.()) || [];
    return { all, dbs: dbs.length, caches: await caches.keys() };
  });
  ok(!dump.all.includes(marker) && !dump.all.includes("/9j/4AAQ"), "the image is not in the trip, items, localStorage or sessionStorage");
  ok(dump.dbs === 0 && !dump.caches.includes("share-inbox"), `no IndexedDB databases and no cached images (caches: ${dump.caches.join(",") || "none"})`);
  // dedupe: reading the same screenshot again adds nothing
  const n0 = (await d.evaluate(() => window.__tripCtx.S.items.length));
  const [fc2] = await Promise.all([d.waitForEvent("filechooser"), d.click("[data-action=capturePick]")]);
  await fc2.setFiles([png2]);
  await d.waitForFunction(() => /already saved/.test(document.getElementById("toast").textContent), null, { timeout: 8000 });
  ok((await d.evaluate(() => window.__tripCtx.S.items.length)) === n0, "same places again: 'already saved', nothing duplicated");

  /* ---- bookings with Gemini */
  console.log("bookings from an email (Gemini)");
  await d.click('.tabs-desk [data-tab=kit]');
  ok(/Paste a confirmation email/.test(await d.textContent("#bk-sec")), "empty state explains what to do");
  await d.click("[data-action=bkEmail]");
  ok(/Read with Gemini/.test(await d.textContent("#modalForm button.primary")), "email box offers 'Read with Gemini' when a key is set");
  await d.fill("#modalForm textarea", "Your IndiGo booking confirmation and Hotel Roma Centro reservation. PNR ABC123 ...  (long enough to read)");
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => document.querySelector("#modalForm [name=title]")?.value, null, { timeout: 8000 });
  const bookingCall = gem.find((g) => /booking confirmation email/.test(g.parts[0].text || ""));
  ok(bookingCall && !bookingCall.tools, "booking call has no search tools");
  ok((await d.inputValue("#modalForm [name=title]")) === "IndiGo 6E 2145 BOM to FCO" && (await d.inputValue("#modalForm [name=ref]")) === "ABC123" && (await d.inputValue("#modalForm [name=start]")) === "2026-11-10T06:40", "form 1 of 2 prefilled for checking (flight)");
  ok(/Booking 1 of 2/.test(await d.textContent("#modalForm")), "says 'Booking 1 of 2'");
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => document.querySelector("#modalForm [name=title]")?.value === "Hotel Roma Centro", null, { timeout: 5000 });
  await d.click("#modalForm button.primary");
  // hotel offer
  await d.waitForFunction(() => /Set “staying in”/.test(document.getElementById("modalForm").textContent), null, { timeout: 5000 });
  ok(/Days 1 to 3 \(3 nights\)/.test(await d.textContent("#modalForm")) && (await d.inputValue("#modalForm [name=base]")) === "Rome", "hotel: offers 'staying in' for Days 1 to 3 (3 nights), town Rome");
  await d.fill("#modalForm [name=base]", "Rome centre");
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => window.__tripCtx.S.trip.days[2].base === "Rome centre");
  const bases = await d.evaluate(() => window.__tripCtx.S.trip.days.map((x) => x.base || ""));
  ok(JSON.stringify(bases) === JSON.stringify(["Rome centre", "Rome centre", "Rome centre", ""]), "'staying in' set on the 3 nights only: " + JSON.stringify(bases));
  const list = await d.textContent("#bk-sec");
  ok(/Nov/.test(await d.textContent(".bk-date")), "list grouped by date");
  ok(/06:40 → 14:05/.test(list) && /ABC123/.test(list) && /HRC-55821/.test(list) && /Seat 14A/.test(list), "times, refs and notes show");
  ok((await d.getAttribute('#bk-sec a[href*="maps"]', "href")).includes("Via%20Roma%201%2C%20Rome"), "address links to maps");
  await d.evaluate(() => navigator.clipboard.writeText = async (t) => (window.__copied = t));
  await d.click("[data-action=bkCopy] >> nth=0");
  ok((await d.evaluate(() => window.__copied)) === "ABC123", "tapping the ref copies it");
  ok(!(await d.isVisible("[data-action=bkStay]")), "no 'staying in' button once nights are set");
  const saved = await d.evaluate(() => window.__tripCtx.S.trip.bookings);
  ok(saved.length === 2 && saved[0].id && saved[0].by && saved[0].at, "bookings saved on the trip with id, by, at");

  // Plan strip + budget
  await d.click('.tabs-desk [data-tab=plan]');
  const pills = await d.$$eval(".day-head .bk-pill", (e) => e.map((x) => x.textContent.trim()));
  ok(pills.some((t) => /06:40/.test(t)) && pills.some((t) => /14:00/.test(t)), "Plan day 1 header shows the flight and hotel: " + pills.join(" | "));
  ok(pills.some((t) => /check-out 11:00/.test(t)), "check-out shows on day 4: " + pills.join(" | "));
  await d.click('.tabs-desk [data-tab=budget]');
  const budget = await d.textContent(".budget");
  ok(/IndiGo 6E 2145/.test(budget) && /Hotel Roma Centro/.test(budget), "bookings are rows in Budget");
  ok((await d.evaluate(() => window.__tripCtx.costs().extraRows.reduce((s, r) => s + r.amount, 0))) === 72000 && (await d.evaluate(() => window.__tripCtx.costs().total)) >= 72000, "Budget total includes 72,000 of bookings");

  // other currency is flagged, not counted
  await d.click('.tabs-desk [data-tab=kit]');
  await d.click("[data-action=bkNew]");
  await d.selectOption("#modalForm [name=kind]", "tickets");
  await d.fill("#modalForm [name=title]", "Vatican Museums");
  await d.fill("#modalForm [name=start]", "2026-11-11T09:00");
  await d.fill("#modalForm [name=cost]", "60");
  await d.selectOption("#modalForm [name=currency]", "EUR");
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => /Vatican/.test(document.getElementById("bk-sec").textContent));
  ok(/Not in the budget \(different currency\)/.test(await d.textContent("#bk-sec")), "a EUR booking on an INR trip is flagged, not counted");
  ok((await d.evaluate(() => window.__tripCtx.costs().extraRows.length)) === 2, "only the 2 INR bookings are budget rows");
  // edit + delete
  await d.click("[data-action=bkEdit] >> nth=-1");
  d.once("dialog", (x) => x.accept());
  await d.click("#modalForm [data-action=bkDelete]");
  await d.waitForFunction(() => window.__tripCtx.S.trip.bookings.length === 2);
  ok(true, "delete from the edit form");

  /* ---- price links */
  console.log("price links");
  await d.click('.tabs-desk [data-tab=kit]');
  ok(!(await d.evaluate(() => document.getElementById("chk-sec").open)), "Check prices starts collapsed");
  await d.click("#chk-sec summary");
  const fl = await d.getAttribute("#chk-sec a[href*='travel/flights']", "href");
  const flq = new URL(fl).searchParams.get("q");
  ok(fl.startsWith("https://www.google.com/travel/flights?q=") && flq === "Flights to Rome on 2026-11-10 through 2026-11-13", "flights link works with no home city (no default origin): " + flq);
  await d.fill("#homeCity", "Mumbai");
  await d.dispatchEvent("#homeCity", "change");
  await d.waitForFunction(() => window.__tripCtx.S.trip.profile?.home === "Mumbai");
  ok((await d.evaluate(() => document.getElementById("chk-sec").open)), "section stays open after saving");
  const flq2 = new URL(await d.getAttribute("#chk-sec a[href*='travel/flights']", "href")).searchParams.get("q");
  ok(flq2 === "Flights from Mumbai to Rome on 2026-11-10 through 2026-11-13", "home city saved to trip.profile.home and used: " + flq2);
  const hrefs = await d.$$eval("#chk-sec a", (a) => a.map((x) => x.href));
  const gh = hrefs.filter((h) => h.includes("travel/search")).map((h) => new URL(h).searchParams.get("q"));
  const bk = hrefs.filter((h) => h.includes("booking.com")).map((h) => new URL(h));
  ok(gh.length === 2 && gh[0] === "hotels in Rome centre 2026-11-10 to 2026-11-13" && gh[1] === "hotels in Rome 2026-11-13 to 2026-11-14", "Google Hotels link per base with check-in/out: " + gh.join(" | "));
  ok(bk[0].searchParams.get("ss") === "Rome centre" && bk[0].searchParams.get("checkin") === "2026-11-10" && bk[0].searchParams.get("checkout") === "2026-11-13" && bk[0].searchParams.get("group_adults") === "2", "Booking.com link: " + bk[0].search);
  // stay card "Prices" link
  await d.evaluate(() => window.__tripCtx.addPlaces([{ title: "Hotel Artemide", category: "stay", location: "Via Nazionale 22, Rome centre", lat: 41.9, lng: 12.49 }], { source: "test", autoPlace: false }));
  await d.click('.tabs-desk [data-tab=ideas]');
  await d.waitForSelector(".bk-prices a");
  const pr = new URL(await d.getAttribute(".bk-prices a", "href")).searchParams.get("q");
  ok(pr === "hotels in Hotel Artemide Rome centre 2026-11-10 to 2026-11-13", "stay card 'Prices' link uses the matching nights: " + pr);

  /* ---- regex fallback in the UI */
  console.log("bookings from an email (no Gemini)");
  await d.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: null }));
  await d.waitForFunction(() => !window.__tripCtx.aiKey());
  await d.click('.tabs-desk [data-tab=kit]');
  await d.click("[data-action=bkEmail]");
  ok(/Read email/.test(await d.textContent("#modalForm button.primary")), "no key: button says 'Read email'");
  const geminiCalls = gem.length;
  await d.fill("#modalForm textarea", indigo);
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => document.querySelector("#modalForm [name=title]")?.value, null, { timeout: 5000 });
  const form = await d.evaluate(() => Object.fromEntries(new FormData(document.getElementById("modalForm")).entries()));
  ok(form.kind === "flight" && form.ref === "Q7XK2L" && form.start === "2026-11-10T06:40" && form.end === "2026-11-10T08:50" && form.cost === "8450" && /6E 2145/.test(form.title), "fallback prefilled the form: " + JSON.stringify({ t: form.title, r: form.ref, s: form.start, e: form.end, c: form.cost }));
  ok(gem.length === geminiCalls, "no Gemini call was made");
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => window.__tripCtx.S.trip.bookings.some((x) => x.ref === "Q7XK2L"));
  await d.click("[data-action=bkEmail]");
  await d.fill("#modalForm textarea", hotel);
  await d.click("#modalForm button.primary");
  await d.waitForFunction(() => document.querySelector("#modalForm [name=title]")?.value, null, { timeout: 5000 });
  ok((await d.inputValue("#modalForm [name=title]")) === "The Orchid Residency" && (await d.inputValue("#modalForm [name=end]")) === "2026-11-16T11:00", "fallback: hotel name and check-out");
  await d.click("#modalForm [data-close]");

  /* ---- shared images through the real service worker */
  console.log("android share target (real service worker)");
  await d.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "TESTKEY", model: "x" } }));
  await d.evaluate(async () => { await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready; });
  await d.reload();
  await d.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 });
  const shared = await d.evaluate(async () => {
    const fd = new FormData();
    for (const [n, w] of [["a.png", 40], ["b.png", 30]]) {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = w; cv.getContext("2d").fillRect(0, 0, w, w);
      fd.append("images", await new Promise((r) => cv.toBlob((bl) => r(new File([bl], n, { type: "image/png" })))));
    }
    fd.append("url", "https://example.com/post"); fd.append("title", "Rome");
    const r = await fetch("./", { method: "POST", body: fd, redirect: "manual" });
    const c = await caches.open("share-inbox");
    return { type: r.type, n: (await c.keys()).length };
  });
  ok(shared.type === "opaqueredirect" && shared.n === 2, "POST to the app answers with a redirect and parks 2 images in 'share-inbox'");
  gem.length = 0;
  await d.goto(URL0 + "?shared=1");
  await d.waitForFunction(() => /You shared 2 screenshots/.test(document.getElementById("modalForm").textContent), null, { timeout: 8000 });
  ok(gem.length === 0, "nothing is sent to Gemini until you tap 'Read them'");
  PLACES.places = [{ name: "Pantheon", category: "sight", address: "Piazza della Rotonda, Rome", durationMin: 45, vegetarian: "", why: "" }];
  await d.click("[data-action=captureShared][data-id=read]");
  await d.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Pantheon"), null, { timeout: 15000 });
  ok(gem.filter((g) => g.parts.some((x) => x.inline_data)).length === 1 && gem[0].parts.filter((x) => x.inline_data).length === 2, "shared images read once, both in one call");
  ok(!(await d.evaluate(() => caches.has("share-inbox"))), "share-inbox is emptied after reading");
  await d.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.unregister()));

  /* ---- phone screenshot */
  console.log("phone 390px");
  const ph = await newPage({ width: 390, height: 900 });
  await makeTrip(ph, "2026-11-10");
  await addKitTab(ph);
  await ph.evaluate(async () => {
    const c = window.__tripCtx;
    await c.S.store.txTrip(c.S.tripId, () => ({ bookings: [
      { id: "b1", kind: "flight", title: "IndiGo 6E 2145 · BOM → FCO", ref: "ABC123", start: "2026-11-10T06:40", end: "2026-11-10T14:05", from: "Mumbai (BOM)", to: "Rome (FCO)", address: "", cost: 42000, currency: "INR", notes: "Seat 14A", by: "x", at: 1 },
      { id: "b2", kind: "hotel", title: "Hotel Roma Centro with a rather long name", ref: "HRC-55821", start: "2026-11-10T14:00", end: "2026-11-13T11:00", from: "", to: "", address: "Via Roma 1, Rome", cost: 30000, currency: "INR", notes: "Double room", by: "x", at: 1 },
      { id: "b3", kind: "tickets", title: "Vatican Museums", ref: "", start: "2026-11-11T09:00", end: "", from: "", to: "", address: "", cost: 60, currency: "EUR", notes: "", by: "x", at: 1 },
    ] }));
  });
  await ph.waitForFunction(() => window.__tripCtx.S.trip.bookings?.length === 3);
  await ph.click(".tabs-bar [data-tab=kit]");
  await ph.click("#chk-sec summary");
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: join(dir, "kit-phone.png"), fullPage: true });
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, "no horizontal scroll on the phone Kit tab");
  await ph.click(".tabs-bar [data-tab=plan]");
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: join(dir, "plan-phone.png") });
  ok(!(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no horizontal scroll on the phone Plan tab with booking pills");
  console.log("  screenshots: " + join(dir, "kit-phone.png") + " , " + join(dir, "plan-phone.png"));
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await br.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll capture checks passed");
process.exit(fails ? 1 : 0);
