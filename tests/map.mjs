// Map + Stops along a drive test (demo mode in a temp copy; Leaflet, tiles, OSRM and Overpass mocked).
// Run: node tests/map.mjs   (screenshots: /tmp/claude-0/map-phone.png, map-desktop.png, along-desktop.png)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-map-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const LEAF = "/tmp/claude-0/fbt/node_modules/leaflet/dist/";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN48e4RAAV6ArmMu8CWAAAAAElFTkSuQmCC", "base64");
const SHOTS = "/tmp/claude-0";

const OSRM = { code: "Ok", routes: [{ geometry: { coordinates: [[12.48, 41.9], [12.0, 42.6], [11.6, 43.2], [11.26, 43.77]] } }] };
const OVER = { elements: [
  { type: "node", lat: 42.6, lon: 12.01, tags: { name: "Orvieto Lookout", tourism: "viewpoint" } },
  { type: "node", lat: 43.2, lon: 11.61, tags: { name: "Famous Abbey", historic: "castle", wikidata: "Q1" } },
  { type: "node", lat: 42.62, lon: 12.0, tags: { name: "Green Table", amenity: "restaurant", "diet:vegetarian": "yes" } },
  { type: "node", lat: 42.9, lon: 12.0, tags: { name: "Too Far Castle", historic: "castle" } },
  { type: "node", lat: 42.6, lon: 12.0, tags: { tourism: "viewpoint" } },
  { type: "node", lat: 41.91, lon: 12.47, tags: { name: "Right Next To Rome", tourism: "museum" } },
] };

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const calls = { osrm: 0, over: 0, tiles: 0, leaflet: 0 };
let osrmFails = false;
async function newPage(viewport) {
  const c = await b.newContext({ viewport });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.route("https://unpkg.com/leaflet@1.9.4/dist/**", (r) => {
    calls.leaflet++;
    const f = LEAF + new URL(r.request().url()).pathname.split("/dist/")[1];
    return existsSync(f) ? r.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : f.endsWith(".png") ? "image/png" : "application/javascript", body: readFileSync(f) }) : r.fulfill({ status: 404, body: "" });
  });
  await p.route("https://tile.openstreetmap.org/**", (r) => { calls.tiles++; r.fulfill({ status: 200, contentType: "image/png", body: PNG }); });
  await p.route("https://router.project-osrm.org/**", (r) => { calls.osrm++; osrmFails ? r.fulfill({ status: 500, body: "x" }) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OSRM) }); });
  await p.route("https://overpass-api.de/**", (r) => { calls.over++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OVER) }); });
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Test trip");
  await p.fill("[name=destination]", "Italy");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10").catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  // Seed: Day 1 Colosseum, Trevi, Duomo (230 km leg); Day 2 Pitti; idea Vatican; one place without coordinates.
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    const added = await c.addPlaces([
      { title: "Colosseum", location: "Rome", category: "sight", lat: 41.8902, lng: 12.4922 },
      { title: "Trevi Fountain", location: "Rome", category: "sight", lat: 41.9009, lng: 12.4833 },
      { title: "Florence Duomo", location: "Florence", category: "sight", lat: 43.7731, lng: 11.2559 },
      { title: "Pitti Palace", location: "Florence", category: "sight", lat: 43.7650, lng: 11.2500 },
      { title: "Vatican Museums", location: "Rome", category: "sight", lat: 41.9065, lng: 12.4536 },
      { title: "Mystery cafe", location: "Somewhere", category: "food", unread: true },
    ], { url: "https://example.com/x", source: "test", autoPlace: false });
    const d = S.trip.days, up = (n, day, order) => S.store.updateItem(S.tripId, added[n].id, { dayId: d[day].id, order });
    await up(0, 0, 1); await up(1, 0, 2); await up(2, 0, 3); await up(3, 1, 1);
    await new Promise((r) => setTimeout(r, 200));
  });
  return p;
}
const pins = (p) => p.$$eval(".mp-pin:not(.idea)", (e) => e.map((x) => x.textContent.trim()));
const stopsOf = (p, day) => p.evaluate((day) => { const c = window.__tripCtx; return c.dayItems(c.S.trip.days[day].id).map((i) => i.title); }, day);

try {
  console.log("desktop");
  const d = await newPage({ width: 1200, height: 800 });
  const tabs = await d.$$eval(".tabs-desk .t-l", (e) => e.map((x) => x.textContent.trim()));
  ok(tabs.slice(0, 3).join() === "Plan,Map,Ideas", "Map tab registered between Plan and Ideas: " + tabs.join());
  ok(calls.leaflet === 0, "Leaflet not loaded before the Map tab opens");
  ok((await d.$$(".day-head [data-action=mapDay]")).length === 3, "a Map button in every day header");

  // Day header button opens the map on that day
  await d.click(".day:nth-of-type(2) [data-action=mapDay]");
  await d.waitForSelector(".mp-pin");
  await d.waitForTimeout(300);
  const chipTop = await d.$eval(".mp-chips", (e) => Math.round(e.getBoundingClientRect().top));
  ok(chipTop >= 0 && chipTop < 120, "opening the Map tab scrolls the chips and map to the top of the screen (" + chipTop + "px)");
  ok((await d.$eval(".mp-chips .chip.on", (e) => e.textContent.trim())) === "Day 2", "day header Map button opens the map filtered to Day 2");
  ok((await pins(d)).join() === "1", "Day 2 shows its one numbered pin");
  ok(calls.leaflet >= 2 && calls.tiles > 0, "Leaflet JS+CSS loaded on first open; tiles requested");

  await d.click(".mp-chips .chip:first-child");
  await d.waitForFunction(() => document.querySelectorAll(".mp-pin:not(.idea)").length === 4);
  ok((await pins(d)).join() === "1,2,3,1", "All days: day 1 numbered 1-3, day 2 numbered 1: " + (await pins(d)).join());
  ok((await d.$$(".mp-pin.idea")).length === 1, "one grey idea pin (Vatican)");
  const lines = await d.$$eval(".leaflet-overlay-pane path", (e) => e.map((x) => x.getAttribute("stroke")));
  ok(lines.length === 1, "day 1 joined by a line (day 2 has a single stop): " + lines.join());
  const colors = await d.$$eval(".mp-pin:not(.idea)", (e) => e.map((x) => x.style.background));
  ok(colors[0] === colors[1] && colors[0] !== colors[3], "pins use the day colour, days differ");
  ok(/1 place isn't on the map yet/.test(await d.textContent(".mp-bar")) && (await d.isVisible("[data-action=mapFind]")), "unmapped notice with Find them");
  await d.evaluate(() => { window.__tripCtx.runAnalyse = () => (window.__found = 1); });
  await d.click("[data-action=mapFind]");
  ok(await d.evaluate(() => window.__found === 1), "Find them runs runAnalyse");

  // Day filter
  await d.click(".mp-chips .chip:nth-child(2)");
  await d.waitForFunction(() => document.querySelectorAll(".mp-pin:not(.idea)").length === 3);
  ok((await pins(d)).join() === "1,2,3", "Day 1 chip filters to Day 1 pins");

  // Popup + add to day from an idea pin
  await d.click(".mp-chips .chip:nth-child(3)");
  await d.waitForFunction(() => document.querySelectorAll(".mp-pin:not(.idea)").length === 1);
  await d.click(".mp-pin.idea");
  await d.waitForSelector(".leaflet-popup [data-action=mapAdd]");
  const pop = await d.textContent(".leaflet-popup-content");
  ok(/Vatican Museums/.test(pop) && /Add to Day 2/.test(pop) && /Directions/.test(pop), "idea popup: title, Add to Day 2, Directions");
  ok((await d.$eval(".leaflet-popup-content a.btn-s", (a) => a.href)).includes("destination=41.9065%2C12.4536"), "popup Directions goes to the stop");
  await d.click(".leaflet-popup [data-action=mapAdd]");
  await d.waitForFunction(() => document.querySelectorAll(".mp-pin:not(.idea)").length === 2);
  ok((await stopsOf(d, 1)).join() === "Pitti Palace,Vatican Museums", "popup 'Add to Day 2' moved the idea onto Day 2");
  ok((await d.$$(".mp-pin.idea")).length === 0, "idea pin gone after adding");
  ok(await d.evaluate(() => window.__tripCtx.S.items.some((i) => i.title === "Vatican Museums" && i.dayId)), "persisted in the store");

  // Persistence across re-render
  await d.evaluate(() => { window.__el = document.querySelector(".mp-canvas"); window.__tripCtx.render(); window.__tripCtx.render(); });
  ok(await d.evaluate(() => window.__el === document.querySelector(".mp-canvas") && document.querySelectorAll(".mp-pin").length === 2), "same map element and pins survive re-render");
  ok((await d.$eval(".mp-chips .chip.on", (e) => e.textContent.trim())) === "Day 2", "selected day survives re-render");
  await d.click(".tabs-desk [data-tab=plan]");
  await d.click(".tabs-desk [data-tab=map]");
  await d.waitForSelector(".mp-pin");
  ok(await d.evaluate(() => window.__el === document.querySelector(".mp-canvas")), "same map element after switching tabs away and back");

  // List toggle
  await d.click("[data-action=mapList]");
  ok((await d.$$(".mp-row")).length === 3 && /Pitti Palace/.test(await d.textContent(".mp-list")), "Show list lists the day's stops and the ideas under the map");
  await d.click(".mp-row");
  await d.waitForSelector(".leaflet-popup");
  ok(/Pitti Palace/.test(await d.textContent(".leaflet-popup-content")), "tapping a list row opens that pin");
  await d.click("[data-action=mapList]");
  await d.click(".mp-chips .chip:first-child");
  await d.waitForTimeout(700);
  await d.evaluate(() => window.scrollTo(0, document.querySelector(".mp-chips").getBoundingClientRect().top + scrollY - 62));
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${SHOTS}/map-desktop.png` });

  /* ---- stops along the drive */
  console.log("along the way");
  await d.click(".tabs-desk [data-tab=plan]");
  const day1 = ".day:nth-of-type(1)";
  const cards = await d.$$eval(`${day1} .card`, (e) => e.map((x) => ({ t: x.querySelector(".c-title").textContent, al: !!x.querySelector(".al-link") })));
  ok(cards.map((c) => c.t + ":" + c.al).join() === "Colosseum:false,Trevi Fountain:false,Florence Duomo:true", "link only on the long leg (>25 km): " + JSON.stringify(cards));
  ok(/\d{3} km/.test(await d.textContent(`${day1} .al-link`)), "link shows the distance");
  await d.click(`${day1} .al-link`);
  await d.waitForSelector(".al-row");
  const names = await d.$$eval(".al-row b", (e) => e.map((x) => x.textContent));
  ok(names.join() === "Famous Abbey,Orvieto Lookout,Green Table", "ranked: well-known first, then by detour; unnamed, too-far and in-town ones dropped: " + names.join());
  const rows = await d.$$eval(".al-row .muted", (e) => e.map((x) => x.textContent));
  ok(/\d+ min detour/.test(rows[0]) && /well known/.test(rows[0]) && /vegetarian/i.test(rows[2]), "detour minutes, well known and vegetarian labels: " + rows.join(" | "));
  ok(calls.osrm === 1 && calls.over === 1, "one OSRM and one Overpass request");
  await d.click(`${day1} .al-row:has-text("Orvieto Lookout") [data-action=alongAdd]`);
  await d.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Orvieto Lookout" && i.dayId));
  const order = await stopsOf(d, 0);
  ok(order.join() === "Colosseum,Trevi Fountain,Orvieto Lookout,Florence Duomo", "inserted between the two stops: " + order.join());
  ok(await d.evaluate(() => { const i = window.__tripCtx.S.items.find((x) => x.title === "Orvieto Lookout"); return Number.isFinite(i.lat) && i.order > 2 && i.order < 3; }), "new stop has coordinates and an order between the two");
  const after = await d.$$eval(`${day1} .card`, (e) => e.map((x) => x.querySelector(".c-title").textContent + ":" + !!x.querySelector(".al-link")));
  ok(after.join() === "Colosseum:false,Trevi Fountain:false,Orvieto Lookout:true,Florence Duomo:true", "both halves are long legs with their own link: " + after.join());
  ok(!(await d.$$eval(".al-row b", (e) => e.map((x) => x.textContent))).includes("Orvieto Lookout"), "added suggestion leaves the list");
  await d.screenshot({ path: `${SHOTS}/along-desktop.png` });

  // OSRM down -> straight line (Duomo opens Day 3, coming from Rome on Day 2)
  osrmFails = true;
  await d.evaluate(async () => { const c = window.__tripCtx; const t = c.S.items.find((x) => x.title === "Florence Duomo"); await c.S.store.updateItem(c.S.tripId, t.id, { dayId: c.S.trip.days[2].id, order: 1 }); });
  await d.waitForSelector(".day:nth-of-type(3) .al-link");
  // the Duomo panel was still open on Day 1: the first tap closes it, the second reopens it with a fresh (straight-line) lookup
  await d.click(".day:nth-of-type(3) .al-link");
  await d.click(".day:nth-of-type(3) .al-link");
  await d.waitForSelector(".day:nth-of-type(3) .al-panel");
  await d.waitForFunction(() => !/Looking/.test(document.querySelector(".day:nth-of-type(3) .al-panel").textContent));
  ok((await d.textContent(".day:nth-of-type(3) .al-panel")).includes("straight line"), "OSRM failure falls back to a straight line and still lists places (cross-day leg)");

  /* ---- phone */
  console.log("phone 390px");
  osrmFails = false;
  const ph = await newPage({ width: 390, height: 844 });
  await ph.click(".tabs-bar [data-tab=map]");
  await ph.waitForSelector(".mp-pin");
  await ph.waitForTimeout(700);
  const box = await ph.$eval("#mapHost", (e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top) }; });
  ok(box.h >= 380 && box.top + 200 < 844, `map is big on the phone (${box.w}x${box.h}, top ${box.top})`);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
  await ph.screenshot({ path: `${SHOTS}/map-phone.png` });
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll map checks passed");
process.exit(fails ? 1 : 0);
