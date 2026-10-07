// Offline edits: the real app against the Firebase emulators; goes offline, edits (Save pop-up, txTrip), reconnects, checks the server.
// Run: node tests/offline.mjs   (starts the emulators itself; needs /tmp/claude-0/fbt for firebase-tools and the SDK files)
import { createRequire } from "module";
import { execSync, spawn, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FBT = "/tmp/claude-0/fbt/node_modules";
if (!process.env.OFFLINE_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-offline-emu-"));
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } } }));
  copyFileSync(join(root, "firestore.rules"), join(dir, "firestore.rules"));
  const r = spawnSync(`${FBT}/.bin/firebase`, ["emulators:exec", "--only", "firestore,auth", "--project", "demo-trips", `OFFLINE_CHILD=1 node ${fileURLToPath(import.meta.url)}`], { stdio: "inherit", cwd: dir });
  process.exit(r.status ?? 1);
}

const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const dir = mkdtempSync(join(tmpdir(), "tp-offline-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), `window.FIREBASE_CONFIG = { apiKey: "fake-key", authDomain: "demo-trips.firebaseapp.com", projectId: "demo-trips" };
window.FIREBASE_EMULATORS = true; window.TEST_GOOGLE_USER = { email: "akash@example.com", name: "Akash" };\n`);
const PORT = 8800 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const FS = "http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents";

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const errors = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR|offline|WebChannel|transport errored|Could not reach/i.test(m.text())) errors.push("console: " + m.text()); });
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
  const u = new URL(r.request().url());
  if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/10.12.2/"))
    return r.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(join(FBT, "firebase", u.pathname.split("/").pop())) });
  return r.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "" });
});
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const rest = async (path) => (await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } })).json();
const tripJson = async (id) => rest("trips/" + id);
const itemsJson = async (id) => (await rest(`trips/${id}/items`)).documents || [];
try {
  await p.goto(URL0);
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Offline test");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const tripId = await p.evaluate(() => window.__tripCtx.S.tripId);
  const itemId = await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    return S.store.addItem(S.tripId, { title: "Colosseum", category: "sight", location: "Rome", description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), dayId: S.trip.days[0].id, order: 1, ...c.stampMe() });
  });
  await p.waitForSelector("[data-action=editItem]");
  await p.waitForFunction(async () => (await new Promise((r) => setTimeout(r, 600)), true));
  ok((await itemsJson(tripId)).length === 1, "online: stop reached the server");

  console.log("go offline");
  await ctx.setOffline(true);
  await p.waitForFunction(() => !navigator.onLine);
  ok(true, "context offline (navigator.onLine false)");

  // (a) Save pop-up closes quickly and the change shows
  await p.click("[data-action=editItem]");
  await p.fill("#modalForm [name=title]", "Colosseum EDITED");
  const t0 = Date.now();
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => !document.getElementById("modal")?.open && !document.querySelector("dialog[open]"), null, { timeout: 2500 });
  const dt = Date.now() - t0;
  ok(dt < 1500, `Save pop-up closed offline in ${dt}ms`);
  await p.waitForFunction(() => document.body.textContent.includes("Colosseum EDITED"), null, { timeout: 3000 });
  ok(true, "edited stop title shows offline");
  const act = await p.evaluate(() => window.__tripCtx.S.activity?.length ?? null);
  console.log("  (activity entries locally: " + act + ")");

  // (b) txTrip edit offline
  const nDays = await p.evaluate(() => window.__tripCtx.S.trip.days.length);
  await p.click("[data-action=addDay]");
  await p.waitForFunction((n) => window.__tripCtx.S.trip.days.length === n + 1, nDays, { timeout: 3000 });
  ok(true, "add day (txTrip) works offline and shows");
  const sync = await p.evaluate(() => window.__tripCtx.S.sync);
  ok(sync === "offline", "sync indicator says offline: " + sync);
  const srvDays = (await tripJson(tripId)).fields.days.arrayValue.values.length;
  ok(srvDays === nDays, "server still has the old day count while offline (" + srvDays + ")");

  console.log("back online");
  await ctx.setOffline(false);
  await p.waitForFunction(() => navigator.onLine);
  await p.waitForFunction(async ([tid, n]) => {
    const j = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents/trips/${tid}`, { headers: { Authorization: "Bearer owner" } })).json();
    return j.fields?.days?.arrayValue?.values?.length === n + 1;
  }, [tripId, nDays], { timeout: 20000 });
  ok(true, "server received the offline day edit after reconnect");
  ok(await until(async () => (await itemsJson(tripId))[0].fields.title.stringValue === "Colosseum EDITED"), "server received the offline stop edit");
  ok(await until(async () => { const a = (await rest(`trips/${tripId}/activity`)).documents || []; return a.some((d) => /edited .Colosseum EDITED/.test(d.fields.text.stringValue)) && a.some((d) => /added a day/.test(d.fields.text.stringValue)); }), "activity log entries (issued offline) reached the server");

  // fresh second context sees both
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "www.gstatic.com") return r.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(join(FBT, "firebase", u.pathname.split("/").pop())) });
    return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await p2.goto(URL0);
  await p2.click("[data-action=signin]");
  await p2.waitForFunction((n) => window.__tripCtx?.S.trip?.days?.length === n + 1, nDays, { timeout: 15000 }).catch(async () => { await p2.click(".trip-card, [data-action=openTrip]").catch(() => {}); await p2.waitForFunction((n) => window.__tripCtx?.S.trip?.days?.length === n + 1, nDays, { timeout: 15000 }); });
  await p2.waitForFunction(() => document.body.textContent.includes("Colosseum EDITED"), null, { timeout: 10000 });
  ok(true, "second signed-in browser sees both changes");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll offline checks passed");
process.exit(fails ? 1 : 0);
