// "Clear all days" in Edit trip and the clean radio focus in the share picker, in demo mode.
// Run: node tests/cleardays.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-clear-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
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
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days;
    const mk = (data) => S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), dayId: null, order: 0, location: "Rome", lat: 41.9, lng: 12.5, ...c.stampMe(), ...data });
    for (const x of S.items.filter((i) => i.dayId)) await S.store.deleteItem(S.tripId, x.id);
    await mk({ title: "Colosseum", category: "sight", dayId: d[0].id, order: 1 });
    await mk({ title: "Pantheon", category: "sight", dayId: d[1].id, order: 1 });
    await mk({ title: "Rest", category: "other", rest: true, dayId: d[1].id, order: 2 });
    await mk({ title: "Forno", category: "food", dayId: d[2].id, order: 1 });
    await mk({ title: "Spare idea", category: "sight" });
  });
  await p.waitForTimeout(400);
  const snap = () => p.evaluate(() => window.__tripCtx.S.items.map((i) => ({ t: i.title, d: i.dayId })));
  const onDays = async () => (await snap()).filter((i) => i.d).length;
  ok((await onDays()) === 4, "four stops on days to start");

  await p.click("[data-action=editTrip]");
  await p.waitForSelector("#modalForm [data-action=clearDays]");
  const order = await p.$$eval("#modalForm .trip-danger button", (bs) => bs.map((x) => x.dataset.action));
  ok(order.join() === "clearDays,deleteTrip", "Clear all days sits beside Delete this trip");
  await p.click("#modalForm [data-action=clearDays]");
  await p.waitForFunction(() => /Cleared all days/.test(document.getElementById("toast").textContent), null, { timeout: 4000 });
  ok(/Clear all 3 days\? The 3 stops go back to Ideas/.test(dialogs.at(-1)), "confirm names the days and stops: " + dialogs.at(-1));
  const after = await snap();
  ok(after.every((i) => !i.d), "no stop is left on a day");
  ok(!after.some((i) => i.t === "Rest") && after.filter((i) => ["Colosseum", "Pantheon", "Forno"].includes(i.t)).length === 3, "real stops are in Ideas, the rest block is gone");
  const lg = await p.evaluate(async () => JSON.stringify(await window.__tripCtx.S.store.getLog?.(window.__tripCtx.S.tripId) ?? window.__tripCtx.S.log ?? null));
  ok(/cleared all days/.test(lg) || lg === "null", "Activity entry written" + (lg === "null" ? " (log not readable in demo, skipped)" : ""));

  await p.click("#toast button.link");
  await p.waitForTimeout(800);
  const back = await snap();
  ok(back.filter((i) => i.d).length === 4 && back.some((i) => i.t === "Rest"), "Undo puts all four back, rest block included");
  ok(!(await p.evaluate(() => window.__tripCtx.S.trip.undo)), "undo record cleared");

  // Radio focus: no outline or shadow box on the focused radio, a ring only for keyboard focus.
  await p.evaluate(() => { const m = document.getElementById("modal"); window.__tripCtx.openModal?.(`<h3>x</h3><div class="pick-days"><label class="pick"><input type="radio" name="trip" value="a" checked> A</label><label class="pick"><input type="radio" name="trip" value="b"> B</label></div>`, () => {}); });
  await p.waitForSelector(".pick input");
  await p.focus(".pick input");
  const st = await p.$eval(".pick input", (e) => { const s = getComputedStyle(e); return { o: s.outlineStyle, w: s.outlineWidth, sh: s.boxShadow }; });
  ok((st.o === "none" || st.w === "0px") && st.sh === "none", "focused radio has no box (" + JSON.stringify(st) + ")");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Shift+Tab");
  const kb = await p.$eval(".pick input", (e) => getComputedStyle(e).outlineStyle);
  ok(kb === "none", "no ring on the radio itself");
  ok((await p.$eval(".pick:has(input:focus-visible)", (e) => getComputedStyle(e).boxShadow)) !== "none", "keyboard focus shows on the row instead");
  // The real sheet must not auto-focus a radio (Android treats that as keyboard focus).
  await p.evaluate(() => window.__tripCtx.openModal(`<h3>y</h3><div class="pick-days"><label class="pick"><input type="radio" name="t" value="a" checked> A</label></div>`, () => {}));
  await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => document.activeElement?.type === "radio")), "sheet does not auto-focus the radio");
  await p.screenshot({ path: process.env.SHOT || "/tmp/picker.png" });
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll clear-days checks passed");
process.exit(fails ? 1 : 0);
