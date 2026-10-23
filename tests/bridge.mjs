// Claude link end to end: the real app in a browser against the Firebase emulators (rules from firestore.rules),
// with the Python script from docs/claude-skill.md playing Claude.
// Run: node tests/bridge.mjs   (starts the emulators itself; needs /tmp/claude-0/fbt for firebase-tools and the SDK files)
import { createRequire } from "module";
import { execSync, spawn, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FBT = "/tmp/claude-0/fbt/node_modules";
if (!process.env.BRIDGE_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-bridge-emu-"));
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } } }));
  copyFileSync(join(root, "firestore.rules"), join(dir, "firestore.rules"));
  const r = spawnSync(`${FBT}/.bin/firebase`, ["emulators:exec", "--only", "firestore,auth", "--project", "demo-trips", `BRIDGE_CHILD=1 node ${fileURLToPath(import.meta.url)}`], { stdio: "inherit", cwd: dir });
  process.exit(r.status ?? 1);
}

const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const dir = mkdtempSync(join(tmpdir(), "tp-bridge-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), `window.FIREBASE_CONFIG = { apiKey: "fake-key", authDomain: "demo-trips.firebaseapp.com", projectId: "demo-trips" };
window.FIREBASE_EMULATORS = true; window.TEST_GOOGLE_USER = { email: "akash@example.com", name: "Akash" };\n`);
// The Python script, extracted from the skill doc exactly as a Claude session would save it.
const md = readFileSync(join(root, "docs/claude-skill.md"), "utf8");
const py = md.match(/```python\n([\s\S]*?)\n```/)[1];
const tools = mkdtempSync(join(tmpdir(), "tp-bridge-py-"));
writeFileSync(join(tools, "trip_planner.py"), py);

const PORT = 8800 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const FS = "http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents";
// Claude links are for AI users: seed akash's aiUsers doc (the emulator's "owner" token bypasses the rules, like the console).
await fetch(`${FS}/aiUsers?documentId=akash@example.com`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ fields: { on: { booleanValue: true } } }) });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const geoFail = /nowhere/i;
async function newPage(viewport = { width: 390, height: 800 }) {
  const ctxB = await b.newContext({ viewport });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/10.12.2/"))
      return r.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(join(FBT, "firebase", u.pathname.split("/").pop())) });
    if (u.hostname === "nominatim.openstreetmap.org") {
      const qs = u.searchParams.get("q") || "";
      const n = [...qs].reduce((a, c) => a + c.charCodeAt(0), 0);
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(geoFail.test(qs) ? [] : [{ lat: String(41.85 + (n % 100) / 1000), lon: String(12.45 + (n % 70) / 1000) }]) });
    }
    if (/wikivoyage|wikipedia|open-meteo|archive-api|wikidata/.test(u.hostname)) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  await p.goto(URL0);
  await p.click("[data-action=signin]");
  return p;
}
const ctxEval = (p, fn, arg) => p.evaluate(fn, arg);
const getDoc = async (path) => (await fetch(`${FS}/${path}`)).json();
const py3 = (args, env, input) => spawnSync("python3", [join(tools, "trip_planner.py"), ...args], { cwd: tools, input, encoding: "utf8", env: { ...process.env, ...env } });

try {
  console.log("set up a trip");
  const p = await newPage();
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome test");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const seed = await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    const ids = {};
    const mk = async (key, data) => (ids[key] = await S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe(), ...data }));
    const d = S.trip.days;
    await mk("colo", { title: "Colosseum", category: "sight", location: "Piazza del Colosseo, Rome", lat: 41.89, lng: 12.49, dayId: d[0].id, order: 1, mustDo: true });
    await mk("pant", { title: "Pantheon", category: "sight", location: "Piazza della Rotonda, Rome", lat: 41.899, lng: 12.477, dayId: d[0].id, order: 2 });
    await mk("trat", { title: "Trattoria Monti", category: "food", location: "Via di San Vito 13, Rome", lat: 41.895, lng: 12.5, dayId: d[1].id, order: 1, time: "13:00", veg: "yes" });
    await mk("trevi", { title: "Trevi Fountain", category: "sight", location: "Piazza di Trevi, Rome", lat: 41.901, lng: 12.483, dayId: null, order: 0 });
    await mk("grill", { title: "Meat Grill House", category: "food", location: "Via Roma 1, Rome", lat: 41.9, lng: 12.5, dayId: null, order: 0, vegSource: "gemini" });
    await S.store.setItemPath(S.tripId, ids.colo, ["votes", "partner@example.com"], "love");
    await S.store.updatePrivate(S.me.email, { ai: { key: "SECRETGEMINIKEY123", model: "x" } });
    await S.store.updateTrip(S.tripId, { memberNames: { "akash@example.com": "Akash", "partner@example.com": "Sanj" }, members: [S.me.email, "partner@example.com"] });
    return ids;
  });
  await p.waitForTimeout(500);

  console.log("connect Claude (phone: More sheet)");
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-action=bridgeOpen]");
  ok(/Connect Claude/.test(await p.textContent("#modalForm h3")) && /never your Gemini key/.test(await p.textContent("#modalForm")), "modal explains it, before connecting");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /Claude is connected/.test(document.querySelector("#modalForm h3")?.textContent || ""), null, { timeout: 15000 });
  ok(true, "Connect turns it on and shows the connected modal");
  const tok = await p.evaluate(() => window.__tripCtx.bridgeToken());
  ok(/^[A-Za-z0-9_-]{32}$/.test(tok || ""), "token is 32 url-safe chars: " + tok);
  await p.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await p.click("[data-action=bridgeCopy]");
  const copied = await p.evaluate(() => window.__copied);
  ok(/project: demo-trips/.test(copied) && /apiKey: fake-key/.test(copied) && copied.includes("token: " + tok) && /trip-planner/.test(copied) && /app: http/.test(copied), "Copy for Claude has skill, project, apiKey, token, app");
  let bridge = await getDoc("bridges/" + tok);
  ok(bridge.fields?.on?.booleanValue === true && !JSON.stringify(bridge).includes("@"), "bridge doc exists (on) and holds no email");
  await p.waitForFunction(async (u) => { const j = await (await fetch(u)).json(); return !!j.fields?.snapshot?.stringValue; }, `${FS}/bridges/${tok}`, { timeout: 15000 });
  bridge = await getDoc("bridges/" + tok);
  const snapRaw = bridge.fields.snapshot.stringValue;
  const snap = JSON.parse(snapRaw);
  ok(!/SECRETGEMINIKEY|@/.test(snapRaw), "snapshot has no Gemini key and no email addresses");
  ok(snap.days[0].schedule.some((s) => s.id === seed.colo && s.title === "Colosseum") && snap.ideasNotScheduled.some((s) => s.id === seed.trevi), "snapshot has the days, stop ids and ideas");
  ok(snap.reactions?.[seed.colo]?.votes?.Sanj === "love", "snapshot has votes keyed by first name");
  ok(snap.howToSend?.ops?.move && snap.howToSend?.payloadKinds?.changes && snap.preferences, "snapshot carries the op/payload formats and preferences");

  console.log("one-tap buttons in the connected modal");
  await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  const btns = await p.$$eval("#modalForm .bq", (els) => els.map((e) => e.textContent.trim()));
  ok(btns.join("|") === "Review our plan|Plan our empty days|Top places & vegetarian restaurants", "quick buttons: " + btns.join(" | ") + " (no Handle our requests without an ask)");
  ok(/Copy instead/.test(await p.textContent("#modalForm")) && /Make it permanent/.test(await p.textContent("#modalForm")), "Copy instead and the permanent tip are there");
  await p.screenshot({ path: "/mnt/project-files/trip-planner-build/shots/claude-one-tap.png" });
  const lastOpen = async (n) => { await p.waitForFunction((k) => window.__opened.length === k, n, { timeout: 5000 }); return p.evaluate(() => ({ url: window.__opened.at(-1), copied: window.__copied })); };
  await p.click("#modalForm .bq >> text=Review our plan");
  let o = await lastOpen(1);
  let q = decodeURIComponent(o.url.split("?q=")[1] || "");
  ok(o.url.startsWith("https://claude.ai/new?q=") && q.includes("token: " + tok) && q.endsWith("Request: Review our plan") && o.copied === q, "Review our plan opens Claude with the token and request; the clipboard has the same text");
  await p.click("#modalForm .bq >> text=Top places");
  o = await lastOpen(2);
  ok(/vegetarian restaurants/.test(decodeURIComponent(o.url)), "Top places button sends its request");
  await p.fill("#bridgeFree", "make day 2 slower");
  await p.press("#bridgeFree", "Enter");
  o = await lastOpen(3);
  ok(decodeURIComponent(o.url).endsWith("Request: make day 2 slower") && await p.isVisible("#modalForm"), "free-text Enter opens Claude and leaves the sheet open");
  ok(/Claude opened with your trip\. Tap send/.test(await p.textContent("#toast")), "toast says Claude opened");
  await p.click("details.about summary >> text=Make it permanent");
  await p.click("[data-action=bridgeCopyProject]");
  ok(/^For our trip planner, always use these details/.test(await p.evaluate(() => window.__copied)) && (await p.evaluate(() => window.__copied)).includes("token: " + tok), "Copy for a Claude project copies standing instructions with the token");
  await p.click("[data-close]");

  console.log("the Python script (from the skill doc) reads and sends");
  const env = { TRIP_PROJECT: "demo-trips", TRIP_API_KEY: "fake-key", TRIP_TOKEN: tok, TRIP_HOST: "http://127.0.0.1:8080" };
  const rd = py3(["read"], env);
  ok(rd.status === 0 && JSON.parse(rd.stdout).destination === "Rome", "read prints the snapshot");
  const sendKind = (obj) => py3(["send", "-"], env, JSON.stringify(obj));
  const bad = sendKind({ kind: "changes", ops: [{ type: "add", place: { name: "Meat Palace", category: "food", location: "x", veg: "no" }, toDay: null }] });
  ok(bad.status === 0 && /no vegetarian, vegan or egg/.test(bad.stderr), "script warns, not refuses, a restaurant without veg options");
  // the warned restaurant is applied straight away now; take it back so the rest of the run starts clean
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.count === 1, null, { timeout: 30000 });
  ok(await p.evaluate(() => /Meat Palace/.test(window.__tripCtx.S.trip.undo.warnings.join(" "))), "the restaurant with no veg options is kept and warned about, not blocked");
  await p.evaluate(() => window.__tripCtx.undoAi());
  await p.waitForFunction(() => !window.__tripCtx.S.trip.undo && !window.__tripCtx.S.items.some((i) => i.title === "Meat Palace"), null, { timeout: 15000 });
  const bad2 = sendKind({ kind: "changes", ops: [{ type: "move", itemId: "nope", toDay: 2 }] });
  ok(bad2.status !== 0 && /isn't in the snapshot/.test(bad2.stderr), "script refuses an id that isn't in the snapshot");

  // 1. changes with every op type
  const ops = [
    { type: "move", itemId: seed.trevi, toDay: 3, time: "10:00", why: "Quiet early." },
    { type: "remove", itemId: seed.pant, why: "Too much on Day 1." },
    { type: "time", itemId: seed.colo, time: "08:30" },
    { type: "transport", itemId: seed.pant, mode: "walk", minutes: 12 },
    { type: "day", day: 2, title: "Slow Rome", base: "Trastevere", notes: "Start late." },
    { type: "veg", itemId: seed.grill, veg: "no", note: "Mostly meat" },
    { type: "note", itemId: seed.trat, notes: "Book ahead." },
    { type: "add", place: { name: "Roscioli", category: "food", location: "Via dei Giubbonari 21, Rome", durationMin: 90, cost: 3000, why: "Real vegetarian menu.", veg: "yes", vegNote: "Burrata, cacio e pepe" }, toDay: 2, time: "20:00" },
    { type: "add", place: { name: "Villa Borghese", category: "nature", location: "Piazzale Napoleone I, Rome" }, toDay: null },
    { type: "add", place: { name: "Nowhere Land Cafe", category: "food", location: "Nowhere", veg: "yes" }, toDay: null },
    { type: "booking", booking: { kind: "hotel", title: "Hotel Roma", ref: "BK1", start: "2026-11-10T14:00", end: "2026-11-13T11:00", address: "Via X 1", cost: 54000, currency: "INR" } },
    { type: "check", text: "Travel adapter", group: "pack" },
  ];
  const pre = await p.evaluate((seed) => { const S = window.__tripCtx.S, it = (id) => S.items.find((i) => i.id === id); return { trevi: it(seed.trevi).dayId, pant: it(seed.pant).dayId, colo: it(seed.colo).time || "" }; }, seed);
  const s1 = sendKind({ kind: "changes", request: "make Day 2 slower", summary: "Slower Day 2, one extra lunch.", ops });
  ok(s1.status === 0, "send changes: " + (s1.stdout || s1.stderr).trim().slice(0, 90));
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.source === "Claude", null, { timeout: 30000 });
  await p.waitForFunction(() => /Claude made 12 changes/.test(document.getElementById("toast").textContent), null, { timeout: 15000 }).catch(() => {});
  ok(/Claude made 12 changes/.test(await p.textContent("#toast")), "toast: Claude made 12 changes (applied straight away)");
  const inboxAfter = await getDoc("bridges/" + tok);
  ok(!inboxAfter.fields.inbox.arrayValue.values?.length, "the app took the entry out of the inbox (takeInbox)");
  ok(await p.evaluate(() => window.__tripCtx.S.trip.undo.request) === "make Day 2 slower" && !(await p.evaluate(() => window.__tripCtx.S.trip.changes)), "applied at once: undo record with the request, nothing waiting for review");
  await p.click(".tabs-bar [data-tab=plan]");
  ok(/Claude changed 12 things for “make Day 2 slower”/.test((await p.textContent("#undoBar")).replace(/\s+/g, " ")) && await p.isVisible("#undoBar [data-action=aiUndo]"), "Plan tab shows the Undo bar");
  await p.waitForTimeout(800);
  const st = await p.evaluate(() => {
    const { S } = window.__tripCtx, it = (t) => S.items.find((i) => i.title === t), dayN = (i) => S.trip.days.findIndex((d) => d.id === i.dayId) + 1;
    return {
      trevi: [dayN(it("Trevi Fountain")), it("Trevi Fountain").time], pant: [it("Pantheon").dayId, it("Pantheon").travel?.mode, it("Pantheon").travel?.minutes], colo: it("Colosseum").time,
      day2: S.trip.days[1], grill: [it("Meat Grill House").veg, it("Meat Grill House").vegNote], trat: it("Trattoria Monti").notes,
      ros: it("Roscioli") && [dayN(it("Roscioli")), it("Roscioli").time, it("Roscioli").veg, Number.isFinite(it("Roscioli").lat)], borg: it("Villa Borghese") && [it("Villa Borghese").dayId, Number.isFinite(it("Villa Borghese").lat)], nowhere: it("Nowhere Land Cafe") && [!!it("Nowhere Land Cafe"), Number.isFinite(it("Nowhere Land Cafe").lat)],
      bookings: S.trip.bookings, check: S.trip.checklist, log: S.activity.map((a) => a.text),
    };
  });
  ok(st.trevi[0] === 3 && st.trevi[1] === "10:00", "move with time applied");
  ok(st.pant[0] == null && st.pant[1] === "walk" && st.pant[2] === 12, "remove sent Pantheon to Ideas, transport saved");
  ok(st.colo === "08:30", "time op applied");
  ok(st.day2.title === "Slow Rome" && st.day2.base === "Trastevere" && st.day2.notes === "Start late.", "day op applied");
  ok(st.grill[0] === "no" && st.grill[1] === "Mostly meat" && st.trat === "Book ahead.", "veg op and note op applied");
  ok(st.ros && st.ros[0] === 2 && st.ros[1] === "20:00" && st.ros[2] === "yes" && st.ros[3], "add to Day 2 at 20:00 geocoded, veg kept");
  ok(st.borg && st.borg[0] == null && st.borg[1], "add to Ideas geocoded");
  ok(st.nowhere && st.nowhere[0] && !st.nowhere[1], "add that can't be found on the map is kept in Ideas without a pin");
  ok(st.bookings?.length === 1 && st.bookings[0].ref === "BK1" && st.bookings[0].kind === "hotel" && st.bookings[0].id && st.bookings[0].by && st.bookings[0].at, "booking op wrote trip.bookings with the spec's shape");
  ok(st.check?.length === 1 && st.check[0].text === "Travel adapter" && st.check[0].group === "pack" && st.check[0].done === false && st.check[0].auto === false && "who" in st.check[0] && st.check[0].at, "check op wrote trip.checklist with the spec's shape");
  ok(st.log.some((t) => /applied Claude's change: moved “Trevi Fountain” to Day 3/.test(t)), "applied changes are logged in Activity");
  ok(st.log.some((t) => /Claude changed the plan \(12 changes\)/.test(t)), "and one summary entry says how many");

  console.log("undo the 12 changes");
  await p.click("[data-action=aiUndo]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.undo, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const un = await p.evaluate(({ seed }) => { const { S } = window.__tripCtx, it = (id) => S.items.find((i) => i.id === id); return { trevi: it(seed.trevi).dayId, pant: it(seed.pant).dayId, colo: it(seed.colo).time || "", ros: !!S.items.find((i) => i.title === "Roscioli"), nowhere: !!S.items.find((i) => i.title === "Nowhere Land Cafe"), day2: S.trip.days[1].title || "", bookings: S.trip.bookings?.length || 0, check: S.trip.checklist?.length || 0, grill: S.items.find((i) => i.title === "Meat Grill House").veg, undid: S.activity.some((a) => /undid Claude's changes/.test(a.text)) }; }, { seed });
  ok(un.trevi === pre.trevi && un.pant === pre.pant && un.colo === pre.colo, "Undo puts the moved, removed and re-timed stops back");
  ok(!un.ros && !un.nowhere && !un.day2 && !un.bookings && !un.check && un.grill !== "no", "and removes the added places, booking and to-do and restores the day and the veg answer");
  ok(un.undid, "and says so in Activity");
  ok(sendKind({ kind: "changes", request: "make Day 2 slower", summary: "Again.", ops }).status === 0, "send the same changes again");
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.source === "Claude", null, { timeout: 30000 });
  await p.waitForTimeout(1000);

  // 2. picks
  const picks = { kind: "picks", items: [
    { name: "Palatine Hill", category: "sight", rating: 4.7, reviews: 52000, priceLevel: "$$", approxCost: 2000, area: "Ancient Rome", why: "Quiet views.", durationMin: 120, address: "Via di San Gregorio 30" },
    { name: "Veg Haven", category: "food", rating: 4.5, reviews: 800, why: "Good veg.", veg: "yes", vegNote: "Lasagne" },
    { name: "Steak Only", category: "food", veg: "no" } ] };
  const sent = sendKind(picks);
  ok(sent.status === 0 && /no vegetarian, vegan or egg/.test(sent.stderr), "send picks: script warns on a pick with no veg options but keeps it");
  await p.waitForFunction(() => window.__tripCtx.S.trip.aiPicks?.source === "Claude", null, { timeout: 15000 });
  const pk = await p.evaluate(() => window.__tripCtx.S.trip.aiPicks);
  ok(pk.items.length === 3 && pk.for === "Rome", "picks stored on trip.aiPicks with source Claude");
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-tab=discover]");
  ok(/picked by Claude/.test(await p.textContent(".discover")) && /Palatine Hill/.test(await p.textContent(".discover")), "Discover heading says Claude and lists the picks");

  // 3. review
  const rev = { kind: "review", summary: "Day 1 is tight.", suggestions: [
    { title: "Move Trevi to Day 1", detail: "It's close.", action: { type: "move", itemId: seed.trevi, toDay: 1 } },
    { title: "Book the Colosseum ahead", detail: "Timed tickets.", action: { type: "none" } } ] };
  ok(sendKind(rev).status === 0, "send review");
  await p.waitForFunction(() => window.__tripCtx.S.trip.aiReview?.source === "Claude", null, { timeout: 15000 });
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-tab=smart]");
  ok(/Claude review/.test(await p.textContent(".ai-box h3")) && /Sent by Claude/.test(await p.textContent(".ai-box")), "Smart shows 'Claude review' and 'Sent by Claude'");
  await p.click(".sug.ai [data-action=aiApply]");
  await p.waitForFunction((id) => window.__tripCtx.S.items.find((i) => i.id === id)?.dayId === window.__tripCtx.S.trip.days[0].id, seed.trevi);
  ok(true, "Apply on a Claude review suggestion works");

  // 4. plan
  const plan = { kind: "plan", draft: { summary: "Three easy Rome days.", days: [1, 2, 3].map((n) => ({ day: n, base: "Rome", theme: "Day " + n, items: [
    { name: `Sight ${n}`, category: "sight", time: "10:00", durationMin: 90, address: `Via ${n}, Rome`, approxCost: 0, why: "Nice.", veg: "", vegNote: "", splurge: "", market: false },
    { name: `Lunch ${n}`, category: "food", time: "13:00", durationMin: 75, address: `Via Pranzo ${n}, Rome`, approxCost: 1500, why: "Veg friendly.", veg: "yes", vegNote: "Pasta", splurge: "", market: false },
    { name: `Dinner ${n}`, category: "food", time: "20:00", durationMin: 90, address: `Via Cena ${n}, Rome`, approxCost: 2500, why: "Veg friendly.", veg: "yes", vegNote: "Risotto", splurge: n === 2 ? "food" : "", market: n === 3 } ] })), stays: [] } };
  const sp = sendKind(plan);
  ok(sp.status === 0, "send plan: " + (sp.stdout || sp.stderr).trim().slice(0, 80));
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.source === "Claude" && window.__tripCtx.S.trip.undo.request === "Plan the days", null, { timeout: 90000 });
  await p.click(".tabs-bar [data-tab=plan]");
  ok(/Claude changed \d+ things? for “Plan the days”/.test((await p.textContent("#undoBar")).replace(/\s+/g, " ")), "Plan tab: Claude filled the days, with Undo");
  ok(!(await p.evaluate(() => window.__tripCtx.S.trip.proposal)) && await p.evaluate(() => window.__tripCtx.S.items.some((i) => /^Sight \d$/.test(i.title) && i.dayId)), "the plan is on the days, not stored as a proposal");
  await p.click("[data-action=aiKeep]");

  // 5. paste fallback (a fenced answer, and an old-style plan answer)
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-action=bridgeOpen]");
  await p.click("details.about summary >> text=Claude has no internet");
  await p.fill("[name=paste]", "Here you go:\n```json\n" + JSON.stringify({ kind: "changes", request: "pasted", summary: "s", ops: [{ type: "check", text: "Sunscreen", group: "pack" }, { type: "move", itemId: "ghost", toDay: 1 }] }) + "\n```");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.request === "pasted", null, { timeout: 10000 });
  ok(true, "pasted fenced json is applied");
  await p.click(".tabs-bar [data-tab=plan]");
  ok(/Claude changed 1 thing for “pasted”/.test((await p.textContent("#undoBar")).replace(/\s+/g, " ")), "the bar counts only changes that were applied");
  ok(/Skipped/.test(await p.textContent("#undoBar")) && /isn't in your trip any more/.test(await p.textContent("#undoBar")), "an op with a bad id is listed as skipped with the reason, nothing blocked");
  await p.click("[data-action=aiUndo]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.undo && !window.__tripCtx.S.trip.checklist?.some((c) => c.text === "Sunscreen"), null, { timeout: 10000 });
  ok(true, "Undo removes the to-do");

  // 6. two phones: each entry is taken once
  console.log("two phones, one inbox");
  const p2 = await newPage();
  await p2.waitForSelector("[data-action=open]");
  await p2.click("[data-action=open]");
  await p2.waitForSelector(".tab-body");
  await p2.waitForTimeout(1500);
  const before = (await p.evaluate(() => window.__tripCtx.S.activity.length));
  ok(sendKind({ kind: "changes", request: "two phones", summary: "x", ops: [{ type: "check", text: "Hat", group: "pack" }] }).status === 0, "send while both phones are open");
  await p.waitForFunction(() => window.__tripCtx.S.trip.undo?.request === "two phones", null, { timeout: 15000 });
  await p.waitForTimeout(2500);
  const sugLogs = await p.evaluate(() => window.__tripCtx.S.activity.filter((a) => /Claude changed the plan \(1 change\): two phones/.test(a.text)).length);
  ok(sugLogs === 1, "exactly one phone applied it (logged " + sugLogs + "x)");
  ok(await p.evaluate(() => window.__tripCtx.S.trip.checklist.filter((c) => c.text === "Hat").length === 1), "and the to-do exists once");
  await p2.context().close();

  // 7. ask for a change with the link on
  const n0 = await p.evaluate(() => window.__opened.length);
  await p.click(".tabs-bar [data-tab=plan]");
  await p.evaluate(() => { const x = document.createElement("button"); x.dataset.action = "claudePlan"; document.body.append(x); x.click(); x.remove(); }); // the days are full by now, so the button itself is gone
  o = await lastOpen(n0 + 1);
  ok(decodeURIComponent(o.url).endsWith("Request: Plan our empty days") && !(await p.$("#modalForm textarea[name=answer]")), "Plan with Claude with the link on skips the paste modal");
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-tab=smart]");
  await p.waitForSelector("[data-action=copyForClaude][data-id=review]", { state: "attached" });
  await p.evaluate(() => document.querySelector("[data-action=copyForClaude][data-id=review]").click());
  o = await lastOpen(n0 + 2);
  ok(decodeURIComponent(o.url).endsWith("Request: Review our plan"), "Smart tab's plan review button opens Claude");
  await p.click(".tabs-bar [data-tab=plan]");
  await p.click("#changeInput");
  await p.fill("#changeInput", "swap lunch and dinner on day 2");
  ok(await p.isVisible("[data-action=chgClaude]") && await p.isVisible("[data-action=chgGemini]"), "typing in the box shows Ask Gemini (key set) and Ask Claude");
  await p.evaluate(() => { navigator.clipboard.writeText = async () => {}; });
  await p.click("[data-action=chgClaude]");
  await p.waitForFunction(() => window.__tripCtx.bridgeAsk()?.request === "swap lunch and dinner on day 2");
  await p.waitForFunction(async (u) => { const j = await (await fetch(u)).json(); return /swap lunch and dinner/.test(j.fields?.snapshot?.stringValue || "") && /requests/.test(j.fields.snapshot.stringValue); }, `${FS}/bridges/${tok}`, { timeout: 15000 });
  ok(true, "Ask Claude with the link on saves the request, and it reaches the snapshot as `requests`");
  const n7 = await p.evaluate(() => window.__opened.length);
  ok(n7 >= 1 && decodeURIComponent(await p.evaluate(() => window.__opened.at(-1))).includes("Request: Please handle our new request in the trip planner: swap lunch and dinner on day 2"), "...and opens Claude with that request");
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-action=bridgeOpen]");
  ok(/Handle our requests/.test(await p.textContent("#modalForm")) && /Waiting for Claude: “swap lunch and dinner on day 2”/.test(await p.textContent("#modalForm")), "'Handle our requests' shows with the waiting request");
  await p.click("[data-close]");

  // 8. turn off
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-action=bridgeOpen]");
  p.once("dialog", (d) => d.accept());
  await p.click("[data-action=bridgeOff]");
  await p.waitForFunction(() => !window.__tripCtx.bridgeToken(), null, { timeout: 10000 });
  await p.waitForTimeout(500);
  ok((await fetch(`${FS}/bridges/${tok}`)).status === 404, "Turn off deletes the bridge doc");
  const gone = py3(["read"], env);
  ok(gone.status !== 0 && /404/.test(gone.stderr), "the script now gets a clear 404");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll Claude link checks passed");
process.exit(fails ? 1 : 0);
