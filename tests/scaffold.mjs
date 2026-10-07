// Scaffold test: tabs, bottom bar + More sheet, Directions link, today scroll, sync indicator, store additions.
// Run: node tests/scaffold.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-scaffold-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8790 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
async function newPage(viewport, query = "") {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.goto(URL0 + query);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, start) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Test trip");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", start).catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
}
const tabLabels = (p, sel) => p.$$eval(sel + " .t-l", (els) => els.map((e) => e.textContent.trim()));

try {
  /* ---- desktop */
  console.log("desktop");
  const d = await newPage({ width: 1200, height: 800 });
  await makeTrip(d, "2026-11-10");
  ok(JSON.stringify(await tabLabels(d, ".tabs-desk")) === JSON.stringify(["Plan", "Map", "Ideas", "Discover", "Kit", "Smart", "Budget", "Itinerary", "Activity"]), "desktop tabs include the Map and Kit modules");
  ok(!(await d.isVisible(".tabs-bar")), "bottom bar hidden on desktop");
  ok(await d.isVisible("#sync") && /Saved/.test(await d.textContent("#sync")), "sync indicator shows Saved");
  await d.evaluate(() => {
    const c = window.__tripCtx;
    c.tab({ id: "map", icon: "🗺️", label: "Map", view: () => `<p id="mapStub">map</p>`, order: 20 });
    c.tab({ id: "kit", icon: "🧰", label: "Kit", view: () => `<p id="kitStub">kit</p>`, order: 50 });
    c.action("hello", (btn, id) => { window.__hello = id; });
    c.slot("planTop", () => `<p id="slotPlanTop">top</p>`);
    c.slot("dayHead", (day, i) => `<span class="slot-dh">h${i}</span>`);
    c.slot("dayFoot", (day, i) => `<span class="slot-df">f${i}</span>`);
    c.slot("card", (it) => `<p class="slot-card">c</p>`);
    c.slot("addBar", () => `<button class="icon" data-action="hello" data-id="x1" id="helloBtn">h</button>`);
    c.slot("budget", () => `<p id="slotBudget">b</p>`);
    c.slot("itinActions", () => `<button id="slotItin">i</button>`);
    c.slot("discoverTop", () => `<p id="slotDisc">d</p>`);
    c.slot("snapshot", (snap) => { snap.extra = 1; });
    c.costs(() => [{ label: "Test flights", amount: 500 }]);
    window.__events = [];
    for (const e of ["render", "trip", "items", "open", "close"]) c.on(e, () => window.__events.push(e));
    c.render();
  });
  ok(JSON.stringify(await tabLabels(d, ".tabs-desk")) === JSON.stringify(["Plan", "Map", "Ideas", "Discover", "Kit", "Smart", "Budget", "Itinerary", "Activity"]), "desktop order: Plan, Map, Ideas, Discover, Kit, Smart, Budget, Itinerary, Activity");
  ok((await d.textContent("#slotPlanTop")) === "top" && (await d.$$(".slot-dh")).length === 3 && (await d.$$(".slot-df")).length === 3, "planTop / dayHead / dayFoot slots render");
  await d.click("#helloBtn");
  ok((await d.evaluate(() => window.__hello)) === "x1", "addBar slot + registered action receive clicks");
  await d.click('.tabs-desk [data-tab=map]');
  ok(await d.isVisible("#mapStub"), "registered Map tab renders its view");
  await d.click('.tabs-desk [data-tab=budget]');
  ok(/Test flights/.test(await d.textContent(".budget")) && (await d.isVisible("#slotBudget")), "budget slot + ctx.costs row on Budget");
  ok((await d.evaluate(() => window.__tripCtx.costs().total)) >= 500, "ctx.costs() total includes extra rows");
  await d.click('.tabs-desk [data-tab=itinerary]');
  ok(await d.isVisible("#slotItin"), "itinActions slot");
  await d.click('.tabs-desk [data-tab=discover]');
  ok(await d.isVisible("#slotDisc"), "discoverTop slot");
  await d.click('.tabs-desk [data-tab=plan]');

  // add a place
  await d.evaluate(async () => {
    const c = window.__tripCtx;
    window.__added = await c.addPlaces([{ title: "Colosseum", location: "Piazza del Colosseo, Rome", category: "sight", lat: 41.8902, lng: 12.4922 }, { title: "Mystery cafe", location: "Somewhere, Rome", category: "food", unread: true }], { url: "https://example.com/x", source: "test", autoPlace: false });
  });
  const added = await d.evaluate(() => window.__added);
  ok(added.length === 2 && added.every((x) => x.id && x.title), "addPlaces returns [{ id, title, where }]");
  await d.click('.tabs-desk [data-tab=ideas]');
  await d.waitForSelector(".card");
  ok((await d.$$(".slot-card")).length === 2, "card slot renders in every card");
  const hrefs = await d.$$eval(".card .dir-link", (as) => as.map((a) => a.href));
  ok(hrefs.some((h) => h.includes("destination=41.8902%2C12.4922")), "Directions uses lat,lng when known: " + hrefs[0]);
  ok(hrefs.some((h) => /destination=Mystery.*Rome/.test(decodeURIComponent(h).replace(/\+/g, " ")) || /destination=Somewhere/.test(decodeURIComponent(h))), "Directions falls back to location + destination");
  const foot = await d.evaluate(() => {
    const c = window.__tripCtx, base = { id: "z", title: "T", category: "sight", addedBy: c.S.me.email, addedAt: Date.now() };
    const f = (x) => /<span class="muted small c-by">([^<]*)/.exec(c.card({ ...base, ...x }))?.[1].trim().replace(/ .*ago.*| just now/, "");
    return [f({ suggestedBy: "ai", aiSource: "Claude", siteName: "Claude" }), f({ suggestedBy: "ai", siteName: "Gemini" }), f({ via: "Claude" }), f({ suggestedBy: "guide" }), f({})];
  });
  ok(foot[0].startsWith("Suggested by Claude") && foot[1].startsWith("Suggested by Gemini") && foot[2].startsWith("Suggested by Claude") && foot[3].startsWith("Suggested by the travel guide") && foot[4].startsWith("Added by"), "card footer names the source: " + foot.join(" | "));
  const snap = await d.evaluate(() => window.__tripCtx.planSnapshot());
  ok(snap.extra === 1, "snapshot slot can mutate the snapshot");
  const ev = await d.evaluate(() => window.__events);
  ok(["render", "trip", "items"].every((e) => ev.includes(e)), "events fire: " + [...new Set(ev)].join(","));

  /* store additions (demo) */
  const st = await d.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    const id = added0();
    function added0() { return window.__added[0].id; }
    const store = S.store, tid = S.tripId;
    await store.setItemPath(tid, id, ["votes", "a.b@x.com"], "love");
    await store.setItemPath(tid, id, ["votes", "c@x.com"], "no");
    await store.setItemPath(tid, id, ["votes", "c@x.com"], undefined);
    await store.arrayAdd(tid, id, "comments", { id: "k1", text: "hi" });
    await store.arrayAdd(tid, id, "comments", { id: "k2", text: "yo" });
    await store.arrayRemove(tid, id, "comments", { id: "k1", text: "hi" });
    await store.createBridge("tok123", { tripId: tid, inbox: [] });
    await store.updateBridge("tok123", { snapshot: "{}" });
    let seen = null;
    const un = store.watchBridge("tok123", (x) => (seen = x));
    window.__demoBridgePush("tok123", { id: "e1", at: 1, json: "{}" });
    await new Promise((r) => setTimeout(r, 50));
    const seenInbox = seen?.inbox?.length;
    const inbox1 = await store.takeInbox("tok123");
    const inbox2 = await store.takeInbox("tok123");
    const it = S.items.find((x) => x.id === id);
    await new Promise((r) => setTimeout(r, 50));
    let sync = null;
    store.onSync((s) => (sync = s));
    await store.updateTrip(tid, { bridge: { token: "tok123" } });
    await store.deleteBridge("tok123");
    await new Promise((r) => setTimeout(r, 50));
    return { votes: it.votes, comments: it.comments, seenInbox, inbox1: inbox1.length, inbox2: inbox2.length, sync, gone: seen === null };
  });
  ok(st.votes["a.b@x.com"] === "love" && !("c@x.com" in st.votes), "setItemPath sets (dotted key) and deletes");
  ok(st.comments.length === 1 && st.comments[0].id === "k2", "arrayAdd / arrayRemove");
  ok(st.seenInbox === 1 && st.inbox1 === 1 && st.inbox2 === 0, "bridge push -> watch sees it -> takeInbox empties it");
  ok(st.sync === "saved" && st.gone, "demo onSync saved; deleteBridge removes doc");

  /* ---- phone */
  console.log("phone 390px");
  const ph = await newPage({ width: 390, height: 800 }, "?today=2026-11-11");
  await makeTrip(ph, "2026-11-10");
  await ph.evaluate(() => {
    const c = window.__tripCtx;
    c.tab({ id: "map", icon: "🗺️", label: "Map", view: () => `<p id="mapStub">map</p>`, order: 20 });
    c.tab({ id: "kit", icon: "🧰", label: "Kit", view: () => `<p id="kitStub">kit</p>`, order: 50 });
    c.render();
  });
  ok(!(await ph.isVisible(".tabs-desk")), "inline tabs hidden on phone");
  ok(JSON.stringify(await tabLabels(ph, ".tabs-bar")) === JSON.stringify(["Plan", "Map", "Ideas", "Kit", "More"]), "bottom bar: Plan, Map, Ideas, Kit, More");
  ok((await ph.$$(".tabs-bar button")).length === 5, "5 bottom items");
  ok(!(await ph.isVisible(".more-sheet")), "More sheet closed by default");
  await ph.click(".tabs-bar [data-action=moreToggle]");
  ok(await ph.isVisible(".more-sheet"), "More opens a sheet");
  const more = await ph.$$eval(".more-sheet .t-l", (e) => e.map((x) => x.textContent.trim()));
  ok(JSON.stringify(more) === JSON.stringify(["Discover", "Smart", "Budget", "Itinerary", "Activity", "Connect Claude"]), "More lists: " + more.join(", "));
  await ph.click(".more-sheet [data-tab=budget]");
  ok(!(await ph.isVisible(".more-sheet")) && (await ph.isVisible(".budget")), "More item switches tab and closes the sheet");
  await ph.click(".tabs-bar [data-action=moreToggle]");
  await ph.click(".more-sheet [data-action=bridgeOpen]");
  await ph.waitForSelector("#modal[open]");
  ok(/Claude/.test(await ph.textContent("#modalForm")), "Connect Claude opens the bridge sheet");
  await ph.keyboard.press("Escape");
  await ph.waitForFunction(() => !document.getElementById("modal").open);
  await ph.click(".tabs-bar [data-tab=plan]");
  await ph.waitForSelector(".day.today");
  await ph.waitForTimeout(300);
  const dayTop = await ph.$eval(".day.today", (e) => Math.round(e.getBoundingClientRect().top));
  ok(dayTop >= 0, `today's day exists and is marked (top ${dayTop}px)`);
  ok(await ph.evaluate(() => window.__tripCtx.today()) === 1, "ctx.today() = 1 with ?today=2026-11-11 and start 2026-11-10");
  await ph.screenshot({ path: join(dir, "phone.png") });
  const scrollOk = await (async () => {
    // reopen the trip: Plan should scroll to today's day
    await ph.click("#homeBtn");
    await ph.click("[data-action=open]");
    await ph.waitForSelector(".day.today");
    await ph.waitForTimeout(400);
    return ph.evaluate(() => window.scrollY > 100);
  })();
  ok(scrollOk, "Plan scrolls to today's day when reopening the trip");

  /* ---- today outside trip dates */
  const out = await ph.evaluate(() => { window.__tripCtx.S.trip.startDate = "2030-01-01"; return window.__tripCtx.today(); });
  ok(out === -1, "ctx.today() = -1 outside the trip dates");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll scaffold checks passed");
process.exit(fails ? 1 : 0);
