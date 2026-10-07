// "Shuffle a day" (shuffle.js) in demo mode: which stops swap, what stays, a different second shuffle, nothing to swap.
// Run: node tests/shuffle.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-shuffle-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];

try {
  const ctxB = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: "light" });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const ids = await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days, ids = {};
    await S.store.txTrip(S.tripId, (cur) => ({ members: [...cur.members, "sam@demo"] }));
    const mk = async (k, data) => (ids[k] = await S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), dayId: null, order: 0, location: "Rome", lat: 41.9, lng: 12.5, ...c.stampMe(), ...data }));
    // Day 2: two swappable stops (a sight and a restaurant) and four that must stay.
    await mk("sight", { title: "Villa Borghese", category: "sight", dayId: d[1].id, order: 1 });
    await mk("must", { title: "Colosseum", category: "sight", dayId: d[1].id, order: 2, mustDo: true });
    await mk("food", { title: "Trattoria Verde", category: "food", dayId: d[1].id, order: 3, veg: "yes" });
    await mk("fixed", { title: "Pantheon", category: "sight", dayId: d[1].id, order: 4, time: "16:00" });
    await mk("both", { title: "Trevi Fountain", category: "sight", dayId: d[1].id, order: 5 });
    await mk("stay", { title: "Hotel Roma", category: "stay", dayId: d[1].id, order: 6 });
    await S.store.setItemPath(S.tripId, ids.both, ["votes", S.me.email], "love");
    await S.store.setItemPath(S.tripId, ids.both, ["votes", "sam@demo"], "love");
    // Ideas: two sights (one loved), a good restaurant, and ones that must never come in.
    await mk("i1", { title: "Castel Sant'Angelo", category: "sight" });
    await mk("i2", { title: "Appian Way", category: "sight" });
    await S.store.setItemPath(S.tripId, ids.i1, ["votes", S.me.email], "love");
    await mk("i3", { title: "Forno Veg", category: "food", veg: "yes" });
    await mk("i4", { title: "Meat Palace", category: "food", veg: "no" });
    await mk("i5", { title: "Vetoed Ruins", category: "sight" });
    await S.store.setItemPath(S.tripId, ids.i5, ["votes", S.me.email], "no");
    await mk("i6", { title: "Faraway Castle", category: "sight", lat: 48.85, lng: 2.35 });
    await mk("i7", { title: "Cooking class", category: "activity" });
    return ids;
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__tripCtx.render());
  const days = await p.$$("section.day");
  ok(days.length === 3, "three days");
  ok(!!(await days[1].$("[data-action=shuffleDay]")) && (await days[1].$eval("[data-action=shuffleDay]", (e) => e.textContent)).includes("Shuffle"), "🔀 Shuffle sits in the day footer");
  ok(!(await days[0].$("[data-action=shuffleDay]")) && !(await days[2].$("[data-action=shuffleDay]")), "no Shuffle on days with no stops");
  if (SHOTS) { await days[1].$eval(".day-foot", (e) => e.scrollIntoView({ block: "center" })); await p.waitForTimeout(200); await p.screenshot({ path: join(SHOTS, "plan-dayfoot.png") }); }

  console.log("shuffle Day 2");
  await p.click("section.day[data-day] >> nth=1 >> [data-action=shuffleDay]");
  await p.waitForSelector("#modalForm .chg-op");
  const c1 = await p.evaluate(() => window.__tripCtx.S.trip.changes);
  const idOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  const outs = c1.ops.filter((o) => o.type === "remove").map((o) => idOf[o.itemId]);
  const ins = c1.ops.filter((o) => o.type === "move").map((o) => idOf[o.itemId]);
  ok(c1.source === "Shuffle" && c1.request === "Shuffle Day 2", "proposal is from Shuffle, 'Shuffle Day 2'");
  ok(c1.ops.length === 2 && outs.length === 1 && ins.length === 1, "swaps about half of the 2 swappable stops: " + outs + " -> " + ins);
  ok(outs.every((o) => ["sight", "food"].includes(o)), "only swappable stops go out (not must-do, fixed time, both-love or stay): " + outs);
  const pair = outs[0] === "sight" ? ["i1", "i2"] : ["i3"];
  ok(ins.every((i) => pair.includes(i)), "same category comes in, never vetoed, no-veg, far away or a different kind: " + ins);
  ok(c1.ops.every((o) => o.why) && c1.ops.filter((o) => o.type === "move").every((o) => o.toDay === 2 && /^\d\d:\d\d$/.test(o.time) && /Same kind of place/.test(o.why)), "each op has a why; the new stop takes the old one's estimated time on Day 2");
  const modal = await p.textContent("#modalForm");
  ok(/Shuffle's suggested changes/.test(modal) && !/You asked/.test(modal) && /Shuffle Day 2/.test(modal) && /Nothing changes until you tap Apply/.test(modal), "review reads well for Shuffle");
  const unchanged = await p.evaluate((i) => window.__tripCtx.S.items.find((x) => x.id === i).dayId, ids[outs[0]]);
  ok(!!unchanged, "nothing moves until Apply");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "shuffle-review.png") });
  await p.click("[data-close]");
  ok(/Shuffle suggests 2 changes for “Shuffle Day 2”/.test(await p.textContent(".smart-banner[data-action=chgOpen]")), "banner: " + (await p.textContent(".smart-banner[data-action=chgOpen]")).trim());

  console.log("a second shuffle differs");
  let differs = 0;
  let prev = [outs[0], ins[0]].join(">");
  for (let k = 0; k < 4; k++) {
    await p.click("section.day[data-day] >> nth=1 >> [data-action=shuffleDay]");
    await p.waitForSelector("#modalForm .chg-op");
    const c = await p.evaluate(() => window.__tripCtx.S.trip.changes);
    const key = [idOf[c.ops.find((o) => o.type === "remove").itemId], idOf[c.ops.find((o) => o.type === "move").itemId]].join(">");
    if (key !== prev) differs++;
    prev = key;
    await p.click("[data-close]");
  }
  ok(differs === 4, "each shuffle differs from the one before it (" + differs + "/4)");
  const same = await p.evaluate((x) => ["must", "fixed", "both", "stay"].every((k) => window.__tripCtx.S.items.find((i) => i.id === x[k]).dayId === window.__tripCtx.S.trip.days[1].id), ids);
  ok(same, "must-do, fixed time, both-love and stay stay put");

  console.log("apply");
  await p.click("[data-action=chgOpen]");
  await p.click("button[value=ok]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  const state = await p.evaluate(() => { const c = window.__tripCtx; return c.S.trip.days.map((d) => c.dayItems(d.id).map((i) => i.title)); });
  ok(state[1].length === 6 && state[1].includes("Colosseum") && state[1].includes("Pantheon") && state[1].includes("Trevi Fountain"), "Day 2 still has six stops and the protected ones: " + state[1]);

  console.log("nothing to swap");
  await p.evaluate(async () => { const c = window.__tripCtx; for (const i of c.ideas()) await c.S.store.deleteItem(c.S.tripId, i.id); });
  await p.waitForTimeout(400);
  await p.click("section.day[data-day] >> nth=1 >> [data-action=shuffleDay]");
  await p.waitForFunction(() => /Nothing in Ideas to swap in for Day 2\./.test(document.getElementById("toast").textContent), null, { timeout: 4000 });
  ok(true, "toast: Nothing in Ideas to swap in for Day 2.");
  ok((await p.inputValue("#changeInput")) === "Swap a couple of Day 2 stops for new places" && (await p.evaluate(() => document.activeElement?.id)) === "changeInput", "Ask for a change box is prefilled and focused");
  ok(!(await p.evaluate(() => window.__tripCtx.S.trip.changes)), "no proposal stored");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll shuffle checks passed");
process.exit(fails ? 1 : 0);
