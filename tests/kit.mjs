// Kit test: Today card, route link, packing/to-dos (two users live), Suggest items, spending, .ics and .kml.
// Run: node tests/kit.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
// Set SHOTS=/some/dir to keep phone screenshots.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-kit-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const SHOTS = process.env.SHOTS || dir;
mkdirSync(SHOTS, { recursive: true });
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const calls = []; // external rate lookups
const mode = { frank: "ok", er: "ok" };
async function newPage(bctx, name, query = "") {
  const p = await bctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (u.startsWith("https://api.frankfurter.app/")) {
      calls.push(u);
      const from = new URL(u).searchParams.get("from");
      if (mode.frank !== "ok") return r.fulfill({ status: 500, body: "boom" });
      const rate = { EUR: 90, GBP: 105, JPY: 0.6 }[from] || 1;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ amount: 1, base: from, rates: { INR: rate } }) });
    }
    if (u.startsWith("https://open.er-api.com/")) {
      calls.push(u);
      if (mode.er !== "ok") return r.abort();
      const from = u.split("/").pop();
      const rate = { EUR: 91, GBP: 104, JPY: 0.55 }[from] || 1;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: "success", base_code: from, rates: { INR: rate } }) });
    }
    r.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await p.goto(URL0 + query);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, start) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome trip");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", start).catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
// Seeds three days of stops with coordinates, times and transport.
async function seed(p) {
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, st = S.store, tid = S.tripId;
    const d = S.trip.days.map((x) => x.id);
    const base = { category: "sight", description: "", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), durationMin: 60, cost: 0, time: "" };
    const mk = (o) => st.addItem(tid, { ...base, ...o });
    await mk({ title: "Colosseum", location: "Piazza del Colosseo, Rome", lat: 41.8902, lng: 12.4922, dayId: d[0], order: 1, time: "09:00" });
    await mk({ title: "Roman Forum", location: "Via della Salara Vecchia, Rome", lat: 41.8925, lng: 12.4853, dayId: d[0], order: 2, travel: { mode: "walk", minutes: 15 } });
    await mk({ title: "Trevi Fountain", location: "Piazza di Trevi, Rome", lat: 41.9009, lng: 12.4833, dayId: d[0], order: 3, time: "14:00", durationMin: 90, travel: { mode: "transit", minutes: 25 }, notes: "Book ahead for the evening tour" });
    await mk({ title: "Pantheon", location: "Piazza della Rotonda", dayId: d[0], order: 4, time: "16:00" });
    await mk({ title: "Basilica di San Pietro", location: "Vatican City", lat: 41.9022, lng: 12.4539, dayId: d[1], order: 1, category: "sight", description: "Famous church" });
    await mk({ title: "Trastevere walk", location: "Trastevere, Rome", lat: 41.8896, lng: 12.4698, dayId: d[1], order: 2, travel: { mode: "walk", minutes: 20 } });
    for (let k = 0; k < 12; k++) await mk({ title: "Drive stop " + (k + 1), location: "Spot " + k, lat: 41.9 + k / 100, lng: 12.5 + k / 100, dayId: d[2], order: k + 1, travel: { mode: "car", minutes: 10 } });
    await mk({ title: "Spare idea", location: "Ostia", lat: 41.73, lng: 12.28, dayId: null, order: 0 });
    await st.updateTrip(tid, {
      place: { title: "Rome", lat: 41.9, lng: 12.5, for: "Rome" },
      weather: { kind: "forecast", tz: "Europe/Rome", fetchedAt: Date.now(), days: [{ i: 0, max: 30, min: 14, rain: 5, rainPct: 60, icon: "☀️" }, { i: 1, max: 24, min: 10, rain: 0, rainPct: 5, icon: "⛅" }, { i: 2, max: 20, min: 12, rain: 0, rainPct: 0, icon: "⛅" }] },
      bookings: [{ id: "bk1", kind: "flight", title: "Flight AI 123", ref: "XK7P2Q", start: "2026-11-10T07:30", end: "2026-11-10T10:05", from: "DEL", to: "FCO", address: "", cost: 0, currency: "INR", notes: "", by: S.me.email, at: 1 }],
    });
    await new Promise((r) => setTimeout(r, 100));
  });
}
const tabClick = (p, id) => p.click(`.tabs-desk [data-tab=${id}]`);
const readDownload = async (dl) => readFileSync(await dl.path(), "utf8");

try {
  const bctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const A = await newPage(bctx, "Akash", "?today=2026-11-10&now=11:00");
  await makeTrip(A, "2026-11-10");
  await seed(A);
  await A.evaluate(() => window.__tripCtx.slot("kit", () => `<section class="d-sec" id="otherKit"><h3>Bookings</h3></section>`));
  await A.evaluate(() => window.__tripCtx.render());

  /* ------------------------------------------------------------ Today card */
  console.log("today card");
  await A.waitForSelector("#todayCard");
  const tc = await A.textContent("#todayCard");
  ok(/Today · Day 1/.test(tc), "card says Today · Day 1");
  ok(/Now:\s*Roman Forum/.test(tc) && /Trevi Fountain/.test(tc), "now = Roman Forum, next = Trevi: " + tc.replace(/\s+/g, " ").slice(0, 160));
  ok(/Leave by 13:35/.test(tc), "Leave by 13:35 (14:00 minus 25 min)");
  ok(/Then:\s*16:00\s*·\s*Pantheon/.test(tc), "Then: Pantheon");
  ok(/30°\/14°/.test(tc) && /60% rain/.test(tc), "today's weather shown");
  ok(/Flight AI 123/.test(tc) && /XK7P2Q/.test(tc), "today's booking with ref");
  const dir = await A.$eval("#todayCard a.dir-link", (a) => a.href);
  ok(/destination=41\.9009%2C12\.4833/.test(dir) && !/origin=/.test(dir), "Directions link: destination only, " + dir);
  const B0 = await bctx.newPage();
  await B0.close();
  const out = await newPage(await b.newContext(), "Akash", "?today=2026-12-31");
  // same-browser-profile trip is not shared across contexts; check the card with a fresh trip
  await makeTrip(out, "2026-11-10");
  ok((await out.$("#todayCard")) === null, "no Today card outside the trip dates");
  const noToday = await newPage(await b.newContext(), "Akash", "");
  await makeTrip(noToday, "2026-11-10");
  ok((await noToday.$("#todayCard")) === null, "no Today card without ?today (real date is outside the trip)");

  /* ------------------------------------------------------------ route link */
  console.log("route link");
  const hrefs = await A.$$eval(".day .k-route", (as) => as.map((a) => a.href));
  ok(hrefs.length === 3, "Route link in every day header with 2+ stops");
  const u0 = new URL(hrefs[0]);
  ok(u0.searchParams.get("origin") === "41.8902,12.4922" && u0.searchParams.get("destination") === "Piazza della Rotonda, Rome", "day 1 origin = first stop, destination = last stop (name + city when no coordinates): " + u0.searchParams.get("destination"));
  ok(u0.searchParams.get("waypoints") === "41.8925,12.4853|41.9009,12.4833", "day 1 waypoints are the middle stops: " + u0.searchParams.get("waypoints"));
  ok(u0.searchParams.get("travelmode") === "transit", "any transit leg -> transit");
  const u1 = new URL(hrefs[1]);
  ok(u1.searchParams.get("travelmode") === "walking" && !u1.searchParams.get("waypoints"), "all walk legs -> walking, no waypoints with two stops");
  const u2 = new URL(hrefs[2]);
  ok(u2.searchParams.get("travelmode") === "driving" && u2.searchParams.get("waypoints").split("|").length === 9, "driving, capped at 9 waypoints of 12 stops");

  /* --------------------------------------------------- checklist, two users */
  console.log("packing and to-dos (two users)");
  await A.evaluate(() => window.__tripCtx.S.store.txTrip(window.__tripCtx.S.tripId, (cur) => ({ members: [...cur.members, "priya@demo"], memberNames: { ...cur.memberNames, "priya@demo": "Priya" } })));
  const Bp = await newPage(bctx, "Priya", "");
  await Bp.waitForSelector("[data-action=open], .tab-body");
  if (await Bp.$("[data-action=open]")) await Bp.click("[data-action=open]");
  await Bp.waitForSelector(".tab-body");
  await tabClick(A, "kit");
  await tabClick(Bp, "kit");
  await A.waitForSelector("#kit-pack");
  ok(await A.isVisible("#otherKit"), "kit slot section renders");
  const order = await A.$$eval(".kit > *", (els) => els.map((e) => e.id || e.className));
  ok(order.indexOf("otherKit") < order.indexOf("kit-pack") && order.indexOf("kit-pack") < order.indexOf("kit-todo"), "slot sections first, then Packing, then To-dos: " + order.join(","));
  ok(/Nothing to pack yet/.test(await A.textContent("#kit-pack")), "empty state explains");
  await A.fill("#kAdd-pack", "Passport");
  await A.press("#kAdd-pack", "Enter");
  await Bp.waitForSelector("#kit-pack .k-row");
  ok(/Passport/.test(await Bp.textContent("#kit-pack")), "B sees A's item live");
  await Bp.fill("#kAdd-todo", "Book airport taxi");
  await Bp.selectOption("#kWho", "akash@demo");
  await Bp.click("[data-action=kAdd][data-id=todo]");
  await A.waitForSelector("#kit-todo .k-row");
  ok(/for You/.test(await A.textContent("#kit-todo")), "to-do shows who it is for");
  ok((await A.$$("#kit-todo .k-x")).length === 0, "A has no delete button on B's item");
  await Bp.click("#kit-pack input[type=checkbox]");
  await A.waitForFunction(() => /ticked by Priya/.test(document.querySelector("#kit-pack")?.textContent || ""));
  ok(await A.isChecked("#kit-pack input[type=checkbox]"), "B ticks, A sees it checked with 'ticked by Priya'");
  await A.click("#kit-pack input[type=checkbox]");
  await Bp.waitForFunction(() => !/ticked by/.test(document.querySelector("#kit-pack")?.textContent || ""));
  ok(!(await Bp.isChecked("#kit-pack input[type=checkbox]")), "A unticks, B sees it unticked");
  await A.click("#kit-pack .k-x");
  await Bp.waitForFunction(() => !document.querySelector("#kit-pack .k-row"));
  ok((await Bp.$$("#kit-pack .k-row")).length === 0, "A deletes own item, gone for B");
  // typed text survives a re-render caused by the other person
  await A.fill("#kAdd-pack", "Sunhat draft");
  await Bp.fill("#kAdd-pack", "Charger");
  await Bp.click("[data-action=kAdd][data-id=pack]");
  await A.waitForFunction(() => /Charger/.test(document.querySelector("#kit-pack")?.textContent || ""));
  ok((await A.inputValue("#kAdd-pack")) === "Sunhat draft", "half-typed text is kept when the other person's change re-renders");
  await A.fill("#kAdd-pack", "");

  /* ------------------------------------------------------ Suggest items */
  console.log("suggest items");
  await A.click("[data-action=kSuggest]");
  await A.waitForTimeout(300);
  const texts = () => A.$$eval(".k-row .k-t", (e) => e.map((x) => x.textContent.trim()));
  const t1 = await texts();
  const want = ["Umbrella", "Rain jacket", "Sunscreen", "Hat or cap", "Warm layer", "Comfortable walking shoes".replace("Comfortable walking shoes", "Clothes covering shoulders and knees"), "Passport", "Check visa requirements", "Forex card and some local cash", "Get travel insurance", "Plug adapter", "Download tickets and booking confirmations", "Book Trevi Fountain"];
  const miss = want.filter((w) => !t1.includes(w));
  ok(!miss.length, "weather, plan, abroad, bookings and book-ahead items added" + (miss.length ? " (missing: " + miss.join(", ") + ")" : ""));
  ok(!t1.includes("Swimwear") && !t1.includes("Comfortable walking shoes"), "no swimwear / hiking items without beach or hike stops");
  const n1 = t1.length;
  await A.click("[data-action=kSuggest]");
  await A.waitForTimeout(300);
  const t2 = await texts();
  ok(t2.length === n1 && new Set(t2.map((x) => x.toLowerCase())).size === t2.length, `second run adds nothing (${n1} -> ${t2.length}), no duplicates`);
  const auto = await A.evaluate(() => window.__tripCtx.S.trip.checklist.filter((x) => x.auto).length);
  ok(auto === 13, "suggested items are marked auto: " + auto);

  /* ------------------------------------------------------------- Spending */
  console.log("spending");
  await tabClick(A, "budget");
  await A.waitForSelector("#kit-spend");
  ok(/Nothing logged yet/.test(await A.textContent("#kit-spend")), "empty state explains");
  await A.click("[data-action=kSpendForm]");
  await A.fill("#kSpAmt", "50");
  await A.selectOption("#kSpCur", "EUR");
  await A.fill("#kSpLabel", "Dinner");
  await A.selectOption("#kSpCat", "food");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForFunction(() => /Dinner/.test(document.querySelector("#kit-spend")?.textContent || ""));
  ok(calls.some((u) => /frankfurter\.app\/latest\?from=EUR&to=INR/.test(u)), "frankfurter used for EUR->INR");
  let sp = await A.textContent("#kit-spend");
  ok(/4,500/.test(sp), "50 EUR at 90 shows ≈ 4,500 in trip currency: " + sp.replace(/\s+/g, " ").slice(0, 200));
  mode.frank = "fail";
  await A.fill("#kSpAmt", "20");
  await A.selectOption("#kSpCur", "GBP");
  await A.fill("#kSpLabel", "Museum tickets");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForFunction(() => /Museum tickets/.test(document.querySelector("#kit-spend")?.textContent || ""));
  ok(calls.some((u) => /open\.er-api\.com\/v6\/latest\/GBP/.test(u)), "falls back to open.er-api.com when frankfurter fails");
  sp = await A.textContent("#kit-spend");
  ok(/2,080/.test(sp), "20 GBP at 104 -> 2,080");
  const before = calls.length;
  mode.frank = "ok";
  await A.fill("#kSpAmt", "10");
  await A.selectOption("#kSpCur", "EUR");
  await A.fill("#kSpLabel", "Coffee");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForFunction(() => /Coffee/.test(document.querySelector("#kit-spend")?.textContent || ""));
  ok(calls.length === before, "rates are cached on the trip (no new lookup for EUR within 12 h)");
  const rates = await A.evaluate(() => window.__tripCtx.S.trip.rates);
  ok(rates.base === "INR" && rates.map.EUR === 90 && rates.map.GBP === 104 && rates.at > 0, "trip.rates = { base, at, map }: " + JSON.stringify(rates));
  sp = await A.textContent("#kit-spend");
  ok(/Spent[\s\S]*7,\d{3}/.test(sp) && /Planned/.test(sp), "totals row shows Spent and Planned");
  ok(/Day 1 · /.test(sp), "list grouped by trip day");
  // Priya pays in INR
  await Bp.click(".tabs-desk [data-tab=budget]");
  await Bp.waitForSelector("#kit-spend .k-row");
  await Bp.fill("#kSpAmt", "1000");
  await Bp.selectOption("#kSpCur", "INR");
  await Bp.fill("#kSpLabel", "Gelato");
  await Bp.click("[data-action=kSpendAdd]");
  await A.waitForFunction(() => /Gelato/.test(document.querySelector("#kit-spend")?.textContent || ""));
  ok(!(await A.$(".k-owes")), "who owes whom is hidden by default");
  await A.click("#kit-spend input[data-action=kSplit]");
  await A.waitForFunction(() => /owes/.test(document.querySelector("#kit-spend")?.textContent || ""));
  const owes = await A.textContent(".k-owes");
  ok(/Priya owes You/.test(owes), "toggle on: " + owes.trim());
  const split = await A.evaluate(() => window.__tripCtx.S.trip.prefs.split);
  ok(split === true, "prefs.split saved on the trip");
  ok(/You owe Akash/.test(await Bp.textContent(".k-owes")), "B sees the same from their side");
  // offline: both rate services fail -> saved as pending, then filled when back online
  mode.frank = "fail"; mode.er = "fail";
  await A.fill("#kSpAmt", "1000");
  await A.selectOption("#kSpCur", "JPY");
  await A.fill("#kSpLabel", "Ramen");
  await A.click("[data-action=kSpendAdd]");
  await A.waitForFunction(() => /rate pending/.test(document.querySelector("#kit-spend")?.textContent || ""));
  ok(true, "spend saved with 'rate pending' when no rate can be fetched");
  await A.waitForTimeout(600);
  mode.frank = "ok"; mode.er = "ok";
  await A.evaluate(() => window.dispatchEvent(new Event("online")));
  await A.waitForFunction(() => !/rate pending/.test(document.querySelector("#kit-spend")?.textContent || ""), null, { timeout: 5000 });
    ok(/600/.test(await A.textContent("#kit-spend")), "pending spend converted once back online (1000 JPY at 0.6 = 600)");
  // delete own spend only
  ok((await Bp.$$("#kit-spend .k-x")).length === 1, "B can delete only B's own spend");

  /* -------------------------------------------------------------- exports */
  console.log("exports");
  await tabClick(A, "itinerary");
  ok(/mymaps\.google\.com/.test(await A.textContent(".k-how")), "how-to line for My Maps");
  const [dl1] = await Promise.all([A.waitForEvent("download"), A.click("[data-action=kIcs]")]);
  ok(/\.ics$/.test(dl1.suggestedFilename()), "downloads " + dl1.suggestedFilename());
  const ics = await readDownload(dl1);
  ok(/^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics) && !/[^\r]\n/.test(ics), "VCALENDAR with CRLF line endings");
  ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "lines folded at 75 octets");
  const unf = ics.replace(/\r\n /g, "");
  const nEv = (unf.match(/BEGIN:VEVENT/g) || []).length;
  ok(nEv === (unf.match(/END:VEVENT/g) || []).length && nEv === 4 + 2 + 12 + 1, `${nEv} events: 18 stops + 1 booking, begin/end balanced`);
  ok(/DTSTART;TZID=Europe\/Rome:20261110T090000/.test(unf) && /DTEND;TZID=Europe\/Rome:20261110T100000/.test(unf), "Colosseum 09:00-10:00 with TZID");
  ok(/SUMMARY:Roman Forum/.test(unf) && /DTSTART;TZID=Europe\/Rome:20261110T101500/.test(unf), "Forum starts 10:15 (after 15 min walk)");
  ok(/DTSTART;TZID=Europe\/Rome:20261110T140000/.test(unf) && /DTEND;TZID=Europe\/Rome:20261110T153000/.test(unf), "Trevi 14:00-15:30");
  ok(/DTSTART;TZID=Europe\/Rome:20261111T09\d{2}00/.test(unf), "day 2 events are on 2026-11-11");
  ok(/SUMMARY:Pantheon/.test(unf) && /LOCATION:Piazza della Rotonda\\, Rome/.test(unf), "stop without coordinates is included, location gets the city");
  ok(/SUMMARY:Flight AI 123/.test(unf) && /DTSTART;TZID=Europe\/Rome:20261110T073000/.test(unf) && /DTEND;TZID=Europe\/Rome:20261110T100500/.test(unf) && /Booking ref: XK7P2Q/.test(unf), "booking becomes an event with its ref");
  ok(/DESCRIPTION:Day 1\\nBook ahead for the evening tour/.test(unf), "notes in the description");
  ok(!/Spare idea/.test(unf), "Ideas are not in the calendar");

  const [dl2] = await Promise.all([A.waitForEvent("download"), A.click("[data-action=kKml]")]);
  ok(/\.kml$/.test(dl2.suggestedFilename()), "downloads " + dl2.suggestedFilename());
  const kml = await readDownload(dl2);
  const probe = await bctx.newPage();
  const info = await probe.evaluate((txt) => {
    const d = new DOMParser().parseFromString(txt, "application/xml");
    if (d.querySelector("parsererror")) return { error: d.querySelector("parsererror").textContent };
    const folders = [...d.querySelectorAll("Folder")].map((f) => ({ name: f.querySelector("name").textContent, pins: [...f.querySelectorAll("Placemark")].filter((p) => p.querySelector("Point")).map((p) => ({ n: p.querySelector("name").textContent, c: p.querySelector("coordinates").textContent })), lines: f.querySelectorAll("LineString").length }));
    return { ns: d.documentElement.namespaceURI, folders };
  }, kml);
  await probe.close();
  ok(!info.error && info.ns === "http://www.opengis.net/kml/2.2", "valid KML 2.2 XML" + (info.error ? ": " + info.error : ""));
  ok(info.folders.length === 4 && /^Day 1/.test(info.folders[0].name) && info.folders[3].name === "Ideas", "folder per day + Ideas: " + info.folders.map((f) => f.name).join(" | "));
  ok(info.folders[0].pins.length === 3 && info.folders[1].pins.length === 2 && info.folders[2].pins.length === 12 && info.folders[3].pins.length === 1, "every located stop is a pin (Pantheon has no coordinates and is skipped)");
  ok(info.folders[0].pins[0].c === "12.4922,41.8902,0" && info.folders[0].pins[0].n === "1. Colosseum", "coordinates are lng,lat: " + info.folders[0].pins[0].c);
  ok(info.folders[0].lines === 1, "a route line per day");
  ok(/left out of the map file/.test(await A.textContent("#toast")), "tells you a place without a location was left out");

  /* ------------------------------------------------------- phone shots */
  console.log("phone screenshots");
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const P = await pctx.newPage();
  P.on("pageerror", (e) => errors.push(e.message));
  // Reuse the demo data: copy localStorage from A's context into the phone page.
  const store = await bctx.storageState();
  const ls = store.origins[0].localStorage;
  await P.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await P.addInitScript((items) => { for (const { name, value } of items) if (!localStorage.getItem(name)) localStorage.setItem(name, value); }, ls);
  await P.goto(URL0 + "?today=2026-11-10&now=11:00");
  await P.fill("#demoName", "Akash");
  await P.click("[data-action=signin]");
  await P.waitForSelector("[data-action=open], .tab-body");
  if (await P.$("[data-action=open]")) await P.click("[data-action=open]");
  await P.click(".tabs-bar [data-tab=plan]");
  await P.waitForSelector("#todayCard");
  await P.evaluate(() => window.scrollTo(0, 0));
  await P.screenshot({ path: join(SHOTS, "today-phone.png") });
  await P.click(".tabs-bar [data-tab=kit]");
  await P.waitForSelector("#kit-pack");
  await P.screenshot({ path: join(SHOTS, "kit-phone.png"), fullPage: true });
  await P.click(".tabs-bar [data-action=moreToggle]");
  await P.click(".more-sheet [data-tab=budget]");
  await P.waitForSelector("#kit-spend");
  await P.locator("#kit-spend").scrollIntoViewIfNeeded();
  await P.screenshot({ path: join(SHOTS, "budget-phone.png"), fullPage: true });
  const noScroll = await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(noScroll, "no horizontal scroll on a 390px phone (Budget)");
  console.log("  screenshots in " + SHOTS);
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message, e.stack?.split("\n").slice(1, 4).join("\n"));
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll kit checks passed");
process.exit(fails ? 1 : 0);
