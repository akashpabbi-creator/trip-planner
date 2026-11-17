// Screenshots of every screen (demo mode, an Italy trip with stops, bookings and notes), phone and desktop, light and dark.
// CI uploads the folder as an artifact on every pull request so a reviewer can look at all screens without running anything.
// Run: node tests/screens.mjs [outDir]   (default ./screens-out). Fails on page errors or sideways overflow on a phone.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || "screens-out");
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "tp-screens-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git" "${dir}/screens-out"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const errors = [], overflow = [];
const b = await chromium.launch();
const VIEWS = [["phone", { width: 390, height: 844 }, true], ["desktop", { width: 1280, height: 860 }, false]];
let shots = 0;
for (const [vname, viewport, mobile] of VIEWS) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${vname}/${scheme}: ${e.message}`));
    await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (FONTS.test(r.request().url()) ? r.continue().catch(() => r.abort()) : r.fulfill({ status: 200, contentType: "text/plain", body: "" })));
    await p.goto(`http://127.0.0.1:${PORT}/`);
    await p.fill("#demoName", "Akash");
    await p.click("[data-action=signin]");
    await p.click("[data-action=newTrip]");
    await p.fill("[name=name]", "Italy");
    await p.fill("[name=destination]", "Italy");
    await p.fill("[name=numDays]", "5");
    await p.fill("[name=startDate]", "2026-12-30").catch(() => {});
    await p.click("#modalForm button[value=ok]");
    await p.waitForSelector(".tab-body");
    await p.evaluate(async () => {
      const c = window.__tripCtx, S = c.S;
      await S.store.updateTrip(S.tripId, { budget: 300000, members: [S.me.email, "sanj@example.com"], tripNotes: "Book the Vatican early. Sanj wants a cooking class.",
        place: { for: "Italy", title: "Italy", extract: "Italy is a country in Southern Europe.", lat: 41.9, lng: 12.5, covers: [] },
        bookings: [{ id: "b1", kind: "flight", title: "IndiGo 6E-123", from: "BOM", to: "FCO", start: "2026-12-30T06:30", end: "2026-12-30T11:00", ref: "QX7K2P", cost: 42000, currency: "INR" }, { id: "b2", kind: "hotel", title: "Hotel Roma", start: "2026-12-30T14:00", end: "2027-01-02T11:00", ref: "HR-889", address: "Via Veneto 1" }],
        weather: { kind: "typical", tz: "Europe/Rome", for: "x", days: Array.from({ length: 5 }, (_, i) => ({ icon: "☁️", max: 10 + (i % 3), min: i % 4, rainPct: 10 })) } });
      const d = S.trip.days;
      const add = (dayIdx, order, x) => S.store.addItem(S.tripId, { description: "", image: "", siteName: "", location: "Rome", url: "", category: "sight", durationMin: 90, cost: 0, mustDo: false, addedBy: S.me.email, addedByName: "Akash", addedAt: Date.now() - 3600e3, dayId: dayIdx == null ? null : d[dayIdx].id, order, time: "", lat: 41.9 + order / 50, lng: 12.5 + order / 50, ...x });
      await add(0, 1, { title: "St. Peter's Basilica", time: "09:00", mustDo: true, description: "The centre of the Catholic world, with Michelangelo's dome." });
      await add(0, 2, { title: "Pizzarium Bonci", category: "food", cost: 1800, veg: "good", travel: { mode: "walk", minutes: 15 } });
      await add(0, 3, { title: "Trastevere evening walk", category: "activity", travel: { mode: "taxi", minutes: 12, cost: 900 } });
      await add(1, 1, { title: "Colosseum & Roman Forum", cost: 5200, time: "08:30" });
      await add(1, 2, { title: "Campo de' Fiori market", category: "shopping", travel: { mode: "walk", minutes: 20 } });
      await add(null, 1, { title: "Trevi Fountain at night", description: "Go after 9pm to skip the crowds.", rating: 4.7, reviews: 120000 });
      await add(null, 2, { title: "Da Enzo al 29", category: "food", veg: "none" });
      c.render();
    });
    await p.waitForTimeout(500);
    const snap = async (name) => { await p.waitForTimeout(250); if (await p.evaluate(() => /<svg|<use /.test(document.body.innerText))) errors.push(`${vname}/${scheme}/${name}: icon markup shows as text`); await p.screenshot({ path: join(out, `${vname}-${scheme}-${name}.png`), fullPage: true }); shots++; };
    const tab = async (id) => { await p.evaluate((id) => { const c = window.__tripCtx; c.S.tab = id; c.S.moreOpen = false; c.render(); }, id); await p.waitForTimeout(300); };
    // Your trips first (the trip we just made is open, so go back to the list)
    await p.evaluate(() => document.getElementById("homeBtn").click());
    await p.waitForSelector(".trip-card");
    await snap("your-trips");
    await p.click(".trip-card");
    await p.waitForSelector(".tab-body");
    const tabs = ["plan", "map", "ideas", "discover", "kit", "smart", "budget", "itinerary", "changes"];
    for (const id of tabs) { await tab(id); await snap("tab-" + id); if (mobile) overflow.push(...(await p.evaluate((id) => (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? [`${id}: ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`] : []), id))); }
    await tab("plan");
    // sheets
    const sheet = async (sel, name) => {
      const el = await p.$(sel);
      if (!el || !(await el.isVisible())) return;
      await el.click().catch(() => {});
      await p.waitForTimeout(300);
      await snap("sheet-" + name);
      await p.keyboard.press("Escape");
      await p.evaluate(() => { const c = window.__tripCtx; c.S.addOpen = false; c.S.moreOpen = false; c.render(); });
      await p.waitForTimeout(200);
    };
    await sheet("[data-action=addOpen]", "add");
    await sheet("[data-action=bridgeOpen]", "connect-claude");
    await sheet("[data-action=connectorOpen]", "connector");
    await sheet("[data-action=editTrip]", "edit-trip");
    await ctx.close();
  }
}
await b.close();
srv.kill();
console.log(`${shots} screenshots in ${out}`);
if (overflow.length) console.log("sideways overflow on phone:", overflow.join(" | "));
if (errors.length) console.log("page errors:", errors.join(" | "));
process.exit(errors.length || overflow.length ? 1 : 0);
