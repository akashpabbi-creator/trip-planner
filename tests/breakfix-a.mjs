// Break-test fixes, worker A: owner-only delete, blank names, shrinking a trip, stale forms, double taps, friendly errors,
// "not invited" link, double "Use the plan", bad AI times, duplicate stops, URL + text paste, long names, itinerary bookings.
// Run: node tests/breakfix-a.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-bfa-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 9100 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function route(p) {
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "" }));
}
// Pages of one browser context share localStorage (the demo database); each has its own sessionStorage (its own signed-in person).
async function newPage(bc, name, path = "", viewport) {
  const p = await bc.newPage();
  if (viewport) await p.setViewportSize(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  p.dialogs = [];
  p.autoDialog = true; // accept confirm() by default; tests flip this
  p.on("dialog", async (d) => { p.dialogs.push(d.message()); await (p.autoDialog ? d.accept() : d.dismiss()); });
  await route(p);
  await p.goto(URL0 + path);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, { name = "Goa", dest = "Goa", days = 3 } = {}) {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", name);
  await p.fill("[name=destination]", dest);
  await p.fill("[name=numDays]", String(days));
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  return p.evaluate(() => window.__tripCtx.S.tripId);
}
const toastText = (p) => p.evaluate(() => (document.getElementById("toast").hidden ? "" : document.getElementById("toast").textContent));
const modalOpen = (p) => p.evaluate(() => document.getElementById("modal").open);
const items = (p) => p.evaluate(() => window.__tripCtx.S.items.map((i) => ({ ...i })));
const trip = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__tripCtx.S.trip)));
const addStop = (p, x) => p.evaluate(async (x) => {
  const c = window.__tripCtx, S = c.S;
  return S.store.addItem(S.tripId, { title: "Stop", category: "sight", location: "", description: "", image: "", siteName: "", dayId: null, order: 0, time: "", durationMin: 60, cost: 0, mustDo: false, notes: "", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe(), ...x });
}, x);
const dayId = (p, i) => p.evaluate((i) => window.__tripCtx.S.trip.days[i].id, i);
const closeModal = async (p) => { await p.keyboard.press("Escape"); await p.waitForTimeout(150); };

try {
  const bc = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const a = await newPage(bc, "Akash");
  const tid = await makeTrip(a, { days: 3 });
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    await S.store.updateTrip(S.tripId, { members: [...S.trip.members, "bea@demo"], memberNames: { ...S.trip.memberNames, "bea@demo": "Bea" } });
  });

  /* ---- 1. only the owner can delete */
  console.log("1. delete is owner only");
  const bea = await newPage(bc, "Bea");
  await bea.waitForSelector(".tab-body, .trip-card");
  if (await bea.$(".trip-card")) await bea.click(".trip-card");
  await bea.waitForSelector(".tab-body");
  const s1 = await dayId(a, 0);
  await addStop(a, { title: "Keep me", dayId: s1, order: 1 });
  await a.waitForTimeout(200);
  await bea.click("[data-action=editTrip]");
  await bea.waitForSelector("#modalForm");
  ok((await bea.$$("[data-action=deleteTrip]")).length === 0, "a non-owner's Edit trip has no Delete button");
  await closeModal(bea);
  ok((await bea.$$("[data-action=invite]")).length === 1, "invite sheet still reachable for a non-owner");
  await bea.click("[data-action=invite]");
  await bea.waitForSelector("[data-action=leaveTrip]");
  ok(true, "non-owner still gets Leave this trip in the invite sheet");
  await closeModal(bea);
  const rejected = await bea.evaluate(async () => {
    const S = window.__tripCtx.S;
    try { await S.store.deleteTrip(S.tripId, ""); return "resolved"; } catch (e) { return e.code; }
  });
  ok(rejected === "permission-denied", "store.deleteTrip rejects for a non-owner: " + rejected);
  await a.waitForTimeout(200);
  ok((await items(a)).some((i) => i.title === "Keep me") && !!(await trip(a)).name, "stops and the trip survive a non-owner delete attempt");
  await a.click("[data-action=editTrip]");
  ok((await a.$$("[data-action=deleteTrip]")).length === 1, "the owner sees Delete this trip");
  await closeModal(a);

  /* ---- 2. blank names */
  console.log("2. whitespace names are refused");
  await a.click("[data-action=home]");
  await a.click("[data-action=newTrip]");
  await a.fill("[name=name]", "   ");
  await a.fill("[name=numDays]", "2");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(200);
  ok((await toastText(a)) === "Give it a name" && (await modalOpen(a)), "new trip with a blank name: toast and the modal stays open");
  await a.fill("[name=name]", "Real name");
  await a.fill("[name=destination]", "   ");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(200);
  ok(/destination/i.test(await toastText(a)) && (await modalOpen(a)), "a destination of only spaces is refused too: " + (await toastText(a)));
  await closeModal(a);
  ok((await a.evaluate(() => window.__tripCtx.S.trips.length)) === 1, "no trip was created from the blank forms");
  await a.click("[data-action=open]");
  await a.waitForSelector(".tab-body");
  await a.click("[data-action=editTrip]");
  await a.fill("[name=name]", "  ");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(200);
  ok((await toastText(a)) === "Give it a name" && (await modalOpen(a)) && (await trip(a)).name === "Goa", "edit trip with a blank name is refused and nothing changes");
  await closeModal(a);
  await a.click(".add-plus").catch(() => {});
  await a.evaluate(() => document.querySelector("[data-action=newItem]").click());
  await a.waitForSelector("#modalForm [name=title]");
  await a.fill("#modalForm [name=title]", "   ");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(200);
  ok((await toastText(a)) === "Give it a name" && (await modalOpen(a)), "new stop with a blank title is refused");
  await closeModal(a);
  const keepId = (await items(a)).find((i) => i.title === "Keep me").id;
  await a.evaluate((id) => window.__tripCtx.$modal.open || document.querySelector(`[data-action=editItem][data-id="${id}"]`).click(), keepId);
  await a.waitForSelector("#modalForm [name=title]");
  await a.fill("#modalForm [name=title]", "  ");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(200);
  ok((await toastText(a)) === "Give it a name" && (await modalOpen(a)) && (await items(a)).some((i) => i.title === "Keep me"), "edit stop with a blank title is refused");
  await closeModal(a);

  /* ---- 3. fewer days */
  console.log("3. shrinking the trip");
  const d = [await dayId(a, 0), await dayId(a, 1), await dayId(a, 2)];
  await a.click("[data-action=editTrip]");
  await a.fill("[name=numDays]", "5");
  await a.click("#modalForm button[value=ok]");
  await a.waitForFunction(() => window.__tripCtx.S.trip.days.length === 5);
  const d4 = await dayId(a, 3), d5 = await dayId(a, 4);
  await addStop(a, { title: "Fort", dayId: d4, order: 1, time: "10:00" });
  await addStop(a, { title: "Market", dayId: d4, order: 2, time: "13:00" });
  await addStop(a, { title: "Beach", dayId: d5, order: 1, time: "09:00" });
  await addStop(a, { title: "Rest & recharge", dayId: d5, order: 2, time: "15:00", rest: true, sample: true, suggestedBy: "plan" });
  await a.waitForTimeout(200);
  a.autoDialog = false;
  a.dialogs.length = 0;
  await a.click("[data-action=editTrip]");
  await a.fill("[name=numDays]", "3");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  ok(a.dialogs.length === 1 && a.dialogs[0] === "Days 4-5 have 3 stops. They'll go back to Ideas.", "asks first: " + a.dialogs[0]);
  ok((await trip(a)).days.length === 5 && (await modalOpen(a)), "saying no changes nothing and keeps the form open");
  a.autoDialog = true;
  await a.click("#modalForm button[value=ok]");
  await a.waitForFunction(() => window.__tripCtx.S.trip.days.length === 3);
  await a.waitForTimeout(300);
  const after = await items(a);
  const moved = after.filter((i) => ["Fort", "Market", "Beach"].includes(i.title));
  ok(moved.length === 3 && moved.every((i) => i.dayId === null && i.order === 0 && i.time === ""), "stops from dropped days are in Ideas with no day, order 0, no time");
  ok(!after.some((i) => i.rest), "the Rest & recharge block on a dropped day is deleted");
  // Remove a day by hand: same cleanup
  const d2 = await dayId(a, 2);
  await addStop(a, { title: "Late dinner", dayId: d2, order: 1, time: "20:00" });
  await addStop(a, { title: "Rest & recharge", dayId: d2, order: 2, time: "15:00", rest: true, sample: true, suggestedBy: "plan" });
  await a.waitForTimeout(200);
  await a.click("[data-action=removeLastDay]");
  await a.waitForFunction(() => window.__tripCtx.S.trip.days.length === 2);
  await a.waitForTimeout(300);
  const after2 = await items(a);
  const ld = after2.find((i) => i.title === "Late dinner");
  ok(ld && ld.dayId === null && ld.order === 0 && ld.time === "" && !after2.some((i) => i.rest), "Remove last day clears the time, sends the stop to Ideas and deletes the rest block");

  /* ---- 4. stale forms */
  console.log("4. stale edit forms keep the partner's changes");
  await a.evaluate((id) => document.querySelector(`[data-action=editItem][data-id="${id}"]`).click(), keepId);
  await a.waitForSelector("#modalForm [name=title]");
  await a.evaluate(async (id) => { const S = window.__tripCtx.S; await S.store.updateItem(S.tripId, id, { notes: "Partner note", cost: 500, updatedBy: "bea@demo", updatedAt: Date.now() }); }, keepId);
  await a.fill("#modalForm [name=title]", "Keep me (renamed)");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  const kept = (await items(a)).find((i) => i.id === keepId);
  ok(kept.title === "Keep me (renamed)" && kept.notes === "Partner note" && kept.cost === 500, "editing one field leaves the partner's notes and cost alone");
  await a.evaluate((id) => document.querySelector(`[data-action=editItem][data-id="${id}"]`).click(), keepId);
  await a.waitForSelector("#modalForm [name=title]");
  await a.evaluate(async (id) => { const S = window.__tripCtx.S; await S.store.updateItem(S.tripId, id, { updatedAt: 111 }); }, keepId);
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  ok((await items(a)).find((i) => i.id === keepId).updatedAt === 111, "saving without changes writes nothing");
  // trip form
  await a.click("[data-action=editTrip]");
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    await S.store.txTrip(S.tripId, (cur) => ({ days: [...cur.days, { id: "extra1", title: "", base: "", notes: "" }], budget: 9000, updatedBy: "bea@demo", updatedAt: Date.now() }));
  });
  await a.fill("[name=name]", "Goa 2026");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  const t4 = await trip(a);
  ok(t4.name === "Goa 2026" && t4.days.length === 3 && t4.budget === 9000, `name saved, partner's new day (${t4.days.length} days) and budget (${t4.budget}) untouched`);
  await a.click("[data-action=editTrip]");
  await a.fill("[name=numDays]", "2");
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    await S.store.txTrip(S.tripId, (cur) => ({ days: [...cur.days, { id: "extra2", title: "", base: "", notes: "" }] }));
  });
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  ok((await trip(a)).days.length === 3, "asking for one day fewer than the form showed removes one day from what is there now (4 -> 3)");

  /* ---- 5. double tap Save */
  console.log("5. double tap Save");
  await a.evaluate(() => {
    const S = window.__tripCtx.S, o = (window.__origAdd = S.store.addItem).bind(S.store);
    S.store.addItem = async (...x) => { await new Promise((r) => setTimeout(r, 500)); return o(...x); };
  });
  const before5 = (await items(a)).length;
  await a.evaluate(() => document.querySelector("[data-action=newItem]").click());
  await a.waitForSelector("#modalForm [name=title]");
  await a.fill("#modalForm [name=title]", "Dolphin trip");
  await a.evaluate(() => { const f = document.getElementById("modalForm"); f.requestSubmit(f.querySelector("button[value=ok]")); f.requestSubmit(f.querySelector("button[value=ok]")); });
  ok(await a.evaluate(() => document.querySelector("#modalForm button[value=ok]").disabled), "the Save button is disabled while saving");
  await a.waitForTimeout(1200);
  ok((await items(a)).filter((i) => i.title === "Dolphin trip").length === 1 && (await items(a)).length === before5 + 1, "two quick submits save one stop");
  await a.evaluate(() => { window.__tripCtx.S.store.addItem = window.__origAdd; });

  /* ---- 6. friendly errors */
  console.log("6. friendly errors");
  const fe = await a.evaluate(() => {
    const f = window.__tripCtx.friendlyError;
    return [f({ code: "not-found", message: "NOT_FOUND: no entity to update: app: x" }), f({ message: "7 PERMISSION_DENIED: Missing or insufficient permissions." }), f({ code: "permission-denied" }), f(new TypeError("x is undefined")), f({ code: "unavailable", message: "Failed to get document" })];
  });
  ok(fe[0].text === "That stop was deleted by someone else." && fe[0].gone && fe[1].text === "You don't have permission to change that." && fe[2].text === fe[1].text, "not-found and permission-denied are mapped");
  ok(fe[3].text === "Couldn't save. Check your connection and try again." && fe[4].text === fe[3].text && !fe[3].gone, "everything else gets the connection message");
  const dlt = (await items(a)).find((i) => i.title === "Dolphin trip").id;
  await a.click(".tabs-desk [data-tab=ideas]");
  await a.evaluate((id) => document.querySelector(`[data-action=editItem][data-id="${id}"]`).click(), dlt);
  await a.waitForSelector("#modalForm [name=title]");
  await a.evaluate(() => { const S = window.__tripCtx.S; window.__origUpd ||= S.store.updateItem; S.store.updateItem = async () => { throw Object.assign(new Error("NOT_FOUND: no entity to update: app: trips/x/items/y"), { code: "not-found" }); }; });
  await a.fill("#modalForm [name=title]", "Dolphin trip 2");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(250);
  ok((await toastText(a)) === "That stop was deleted by someone else." && !(await modalOpen(a)), "a deleted stop: friendly toast and the modal closes");
  await a.evaluate((id) => document.querySelector(`[data-action=editItem][data-id="${id}"]`).click(), dlt);
  await a.waitForSelector("#modalForm [name=title]");
  await a.evaluate(() => { const S = window.__tripCtx.S; S.store.updateItem = async () => { throw Object.assign(new Error("7 PERMISSION_DENIED: nope"), { code: "permission-denied" }); }; });
  await a.fill("#modalForm [name=title]", "Dolphin trip 3");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(250);
  ok((await toastText(a)) === "You don't have permission to change that." && (await modalOpen(a)), "permission denied: friendly toast, modal stays so nothing is lost");
  await closeModal(a);
  await a.evaluate(() => { window.__tripCtx.S.store.updateItem = window.__origUpd; });
  ok(!/NOT_FOUND|PERMISSION_DENIED|entity/.test(await toastText(a)), "no raw database wording on screen");
  await a.click(".tabs-desk [data-tab=plan]");

  /* ---- 7. #trip link you're not on */
  console.log("7. link to a trip you're not on");
  const cara = await newPage(bc, "Cara", "#trip=" + tid);
  await cara.waitForSelector(".home");
  await cara.waitForFunction(() => /invited/.test(document.getElementById("toast").textContent), null, { timeout: 6000 }).catch(() => {});
  const ct = await toastText(cara);
  ok(/haven't been invited to that trip yet/.test(ct) && /cara@demo/.test(ct), "toast names the problem and her email: " + ct);

  /* ---- 8. double tap Use this day */
  console.log("8. double tap on the drafted plan");
  await a.click("[data-action=home]");
  await makeTrip(a, { name: "Plan test", dest: "Rome", days: 2 });
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    const l = (name, lat, lng) => ({ name, category: "sight", lat, lng, content: "" });
    await S.store.updateTrip(S.tripId, { proposal: { at: Date.now(), by: S.me.email, byName: "A", source: "Gemini", summary: "s", mode: "full", bases: [], notes: [], done: [],
      plan: [{ dayIndex: 0, time: "10:00", listing: l("Colosseum", 41.89, 12.49) }, { dayIndex: 0, kind: "rest", time: "15:00", durationMin: 90, note: "cool down" }, { dayIndex: 1, kind: "rest", time: "15:00", durationMin: 90, note: "cool down" }, { dayIndex: 1, time: "11:00", listing: l("Pantheon", 41.9, 12.47) }] } });
  });
  await a.waitForSelector("[data-action=openProposal]");
  await a.click("[data-action=openProposal]");
  await a.waitForSelector("[data-action=acceptDay][data-day='0']");
  await a.evaluate(() => { const bt = document.querySelector("[data-action=acceptDay][data-day='0']"); bt.click(); bt.click(); });
  await a.waitForTimeout(2500);
  const it8 = await items(a);
  ok(it8.filter((i) => i.title === "Colosseum").length === 1, "Use this day twice adds the place once");
  ok(it8.filter((i) => i.rest).length === 1, "and one Rest & recharge block, not two");
  // A rest block that is already on the day is not doubled by a later plan
  const tripNow = await trip(a);
  await addStop(a, { title: "Rest & recharge", dayId: tripNow.days[1].id, order: 5, time: "15:30", rest: true });
  await a.waitForTimeout(200);
  await a.evaluate(() => document.querySelector("[data-action=openProposal]")?.click());
  await a.waitForSelector("[data-action=acceptDay][data-day='1']");
  await a.click("[data-action=acceptDay][data-day='1']");
  await a.waitForTimeout(2500);
  const it8b = await items(a);
  ok(it8b.filter((i) => i.rest && i.dayId === tripNow.days[1].id).length === 1, "a day that already has a rest block does not get a second one");
  ok(it8b.some((i) => i.title === "Pantheon"), "the rest of that day's plan still lands");

  /* ---- 9. AI review times */
  console.log("9. AI review time actions");
  const pick = (await items(a)).find((i) => i.title === "Pantheon").id;
  await a.evaluate(async (pick) => {
    const S = window.__tripCtx.S;
    const sg = (title, time) => ({ title, detail: "d", action: { type: "time", itemId: pick, time } });
    await S.store.updateTrip(S.tripId, { aiReview: { at: Date.now(), by: S.me.email, source: "Gemini", summary: "ok", applied: [], suggestions: [sg("t1", "99:99"), sg("t2", "24:00"), sg("t3", "12:60"), sg("t4", "9:05"), sg("t5", "23:59")] } });
  }, pick);
  await a.click(".tabs-desk [data-tab=smart]");
  await a.waitForSelector(".sug.ai");
  const applyFlags = await a.$$eval(".sug.ai", (els) => els.map((e) => !!e.querySelector("[data-action=aiApply]")));
  ok(JSON.stringify(applyFlags) === JSON.stringify([false, false, false, true, true]), "Apply only appears for real times of day: " + applyFlags);
  await a.click(".sug.ai:nth-of-type(4) [data-action=aiApply]").catch(async () => { await a.evaluate(() => document.querySelector("[data-action=aiApply][data-id='3']").click()); });
  await a.waitForTimeout(400);
  ok((await items(a)).find((i) => i.id === pick).time === "09:05", "9:05 is stored as 09:05");
  await a.click(".tabs-desk [data-tab=plan]");

  /* ---- 10. duplicate stop */
  console.log("10. adding the same place twice");
  const dd = (await trip(a)).days[1].id;
  await addStop(a, { title: "Baga Beach", dayId: dd, order: 9 });
  await a.waitForTimeout(200);
  a.autoDialog = false;
  a.dialogs.length = 0;
  const n10 = (await items(a)).length;
  await a.evaluate(() => document.querySelector("[data-action=newItem]").click());
  await a.waitForSelector("#modalForm [name=title]");
  await a.fill("#modalForm [name=title]", "  baga   BEACH ");
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(300);
  ok(a.dialogs[0] === "Baga Beach is already on Day 2. Add it again?" && (await items(a)).length === n10 && (await modalOpen(a)), "asks before adding a duplicate; No keeps the form open: " + a.dialogs[0]);
  a.autoDialog = true;
  await a.click("#modalForm button[value=ok]");
  await a.waitForTimeout(400);
  ok((await items(a)).filter((i) => /baga\s+beach/i.test(i.title)).length === 2, "Yes adds it anyway");

  /* ---- 11. link + text */
  console.log("11. a link with a lot of words around it");
  const msg = "Look at this https://example.com/goa-guide  We loved Baga Beach, Fort Aguada, Anjuna flea market and Thalassa for sunset dinner. Go early!";
  a.autoDialog = false;
  a.dialogs.length = 0;
  const before11 = (await items(a)).filter((i) => i.url === "https://example.com/goa-guide").length;
  // drive addLink through the real paste event on the link box
  await a.evaluate((m) => {
    const box = document.getElementById("linkInput");
    const dt = new DataTransfer();
    dt.setData("text", m);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, msg);
  await a.waitForTimeout(1800);
  ok(/Save just the link, or also find places in the text\?/.test(a.dialogs[0] || ""), "asks what to do: " + (a.dialogs[0] || "").split("\n")[0]);
  ok((await items(a)).filter((i) => i.url === "https://example.com/goa-guide").length === before11 + 1, "Cancel saves just the link");
  ok(!(await a.$("#pasteText")), "and does not open the paste sheet");
  a.autoDialog = true;
  const msg2 = msg.replace("goa-guide", "goa-guide-2");
  await a.evaluate((m) => {
    const box = document.getElementById("linkInput");
    const dt = new DataTransfer();
    dt.setData("text", m);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, msg2);
  await a.waitForSelector("#pasteText", { timeout: 6000 });
  ok(/Baga Beach, Fort Aguada/.test(await a.inputValue("#pasteText")), "OK saves the link and opens the paste sheet filled with the text");
  ok((await items(a)).some((i) => i.url === "https://example.com/goa-guide-2"), "the link was saved too");
  await closeModal(a);
  a.dialogs.length = 0;
  await a.evaluate(() => {
    const box = document.getElementById("linkInput");
    const dt = new DataTransfer();
    dt.setData("text", "https://example.com/short-one thanks");
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await a.waitForTimeout(1500);
  ok(a.dialogs.length === 0, "a link with a few words does not ask");
  const fr = await newPage(await b.newContext({ viewport: { width: 1200, height: 900 } }), "Fran", "?noai");
  await makeTrip(fr, { name: "Friends", dest: "Goa", days: 2 });
  fr.autoDialog = true;
  await fr.evaluate((m) => {
    const box = document.getElementById("linkInput");
    const dt = new DataTransfer();
    dt.setData("text", m);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, msg);
  await fr.waitForTimeout(1500);
  ok(fr.dialogs.length === 0 && !(await fr.$("#pasteText")), "someone without the paste sheet just gets the link saved, no question");

  /* ---- 12. long names + budget cap */
  console.log("12. long names");
  const LONG = "Supercalifragilisticexpialidocious".repeat(4);
  const ph = await newPage(await b.newContext({ viewport: { width: 390, height: 800 } }), "Lena");
  await makeTrip(ph, { name: LONG, dest: LONG, days: 2 });
  const overflow = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  let o = await overflow(ph);
  ok(o.sw <= o.iw, `phone: the hero does not overflow sideways (${o.sw} <= ${o.iw})`);
  const h1 = await ph.evaluate(() => { const e = document.querySelector(".hero h1"); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.1, r: e.getBoundingClientRect().right }; });
  ok(h1.h <= h1.lh * 2 + 4 && h1.r <= 390, `hero title stops at two lines (${Math.round(h1.h)}px)`);
  await ph.click("#homeBtn");
  await ph.waitForSelector(".trip-card");
  o = await overflow(ph);
  ok(o.sw <= o.iw, `phone: trip cards do not overflow (${o.sw} <= ${o.iw})`);
  const tc = await ph.evaluate(() => { const e = document.querySelector(".tc-title"), c = document.querySelector(".trip-card"); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 24, cr: c.getBoundingClientRect().right, tr: e.getBoundingClientRect().right }; });
  ok(tc.h <= tc.lh * 2 + 4 && tc.tr <= tc.cr + 1, `card title clamps to two lines inside the card (${Math.round(tc.h)}px)`);
  await ph.click("[data-action=newTrip]");
  ok((await ph.getAttribute("[name=budget]", "max")) === "100000000", "budget input has max=100000000");
  await closeModal(ph);
  await ph.click("[data-action=open]");
  await ph.waitForSelector(".tab-body");
  await ph.click(".tabs-bar [data-action=moreToggle]");
  await ph.click(".more-sheet [data-tab=itinerary]");
  await ph.waitForSelector(".itin-actions");
  const ia = await ph.evaluate(() => {
    const box = document.querySelector(".itin-actions").getBoundingClientRect();
    const bs = [...document.querySelectorAll(".itin-actions > button")].map((x) => x.getBoundingClientRect());
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, right: Math.max(...bs.map((r) => r.right)), maxH: Math.max(...bs.map((r) => r.height)), boxRight: box.right };
  });
  ok(ia.sw <= ia.iw && ia.right <= ia.iw && ia.maxH < 60, `phone: itinerary buttons stay on screen and don't stretch tall (tallest ${Math.round(ia.maxH)}px)`);
  await ph.screenshot({ path: join(dir, "phone-itin.png") });
  const dk = await newPage(await b.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: "dark" }), "Dan");
  await makeTrip(dk, { name: LONG, dest: LONG, days: 2 });
  o = await overflow(dk);
  ok(o.sw <= o.iw, `desktop dark: hero does not overflow (${o.sw} <= ${o.iw})`);
  await dk.click("#homeBtn");
  await dk.waitForSelector(".trip-card");
  o = await overflow(dk);
  ok(o.sw <= o.iw, `desktop dark: trip cards do not overflow (${o.sw} <= ${o.iw})`);

  /* ---- 13. itinerary bookings */
  console.log("13. bookings in the itinerary");
  await a.evaluate(() => { const m = document.getElementById("modal"); if (m.open) m.close(); });
  await a.click("[data-action=home]");
  await a.click(".trip-card:last-child, .trip-card");
  await a.waitForSelector(".tab-body");
  await a.evaluate(async () => {
    const S = window.__tripCtx.S;
    await S.store.updateTrip(S.tripId, { bookings: [
      { id: "b1", kind: "flight", title: "IndiGo 6E-123", from: "BOM", to: "FCO", start: "2026-11-10T06:30", end: "2026-11-10T11:00", ref: "QX7K2P", cost: 0, currency: "INR" },
      { id: "b2", kind: "hotel", title: "Hotel Roma", start: "2026-11-10T14:00", end: "2026-11-11T11:00", ref: "HR-889", address: "Via Veneto 1" },
      { id: "b3", kind: "train", title: "Train home", start: "2026-12-30T08:00", end: "", ref: "TRN55" },
    ] });
  });
  await a.click(".tabs-desk [data-tab=itinerary]");
  await a.waitForSelector(".itin-doc");
  const days13 = await a.$$eval(".itin-day", (els) => els.map((e) => e.innerText));
  ok(/IndiGo 6E-123/.test(days13[0]) && /QX7K2P/.test(days13[0]) && /Hotel Roma/.test(days13[0]) && /HR-889/.test(days13[0]) && /check-in 14:00/.test(days13[0]), "Day 1 lists the flight and the hotel check-in with ref numbers");
  ok(/Hotel Roma/.test(days13[1]) && /check-out/.test(days13[1]) && !/QX7K2P/.test(days13[1]), "Day 2 lists the hotel check-out only (same matching as the Plan strip)");
  ok(!/IndiGo/.test(days13[1]), "the flight is only on its own day");
  ok(/Other bookings/.test(days13[days13.length - 1]) && /TRN55/.test(days13[days13.length - 1]), "a booking outside the trip dates is still listed, under Other bookings");
  await a.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await a.click("[data-action=copyItin]");
  await a.waitForTimeout(200);
  const copied = await a.evaluate(() => window.__copied || "");
  ok(/QX7K2P/.test(copied) && /HR-889/.test(copied) && /TRN55/.test(copied), "Copy as text includes the bookings");

  /* ---- extras: budget sanity */
  console.log("budget sanity");
  await a.click(".tabs-desk [data-tab=budget]");
  await a.fill("#extraLabel", "Yacht");
  await a.fill("#extraCost", "5000000000");
  await a.click("[data-action=addExtra]");
  await a.waitForTimeout(200);
  ok(/too big/.test(await toastText(a)) && (await trip(a)).extras.length === 0, "an extra cost over 1e9 is refused");
  ok((await a.getAttribute("#extraCost", "max")) === "1000000000", "extra cost input has max");
  const neg = await a.evaluate(async () => { const c = window.__tripCtx, S = c.S; const before = c.costs().total; await S.store.addItem(S.tripId, { title: "Refund?", category: "sight", dayId: S.trip.days[0].id, order: 99, cost: -500, time: "", addedBy: S.me.email, addedAt: Date.now() }); await new Promise((r) => setTimeout(r, 300)); return [before, c.costs().total, c.dayCost(S.trip.days[0].id)]; });
  ok(neg[0] === neg[1], "a negative stop cost counts as 0 in the total");

  /* ---- 14. service worker cache bumped */
  ok(/trips-shell-v29/.test(readFileSync(join(root, "sw.js"), "utf8")), "sw.js CACHE is v29");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll breakfix-a checks passed");
process.exit(fails ? 1 : 0);
