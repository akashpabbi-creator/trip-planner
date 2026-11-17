// Plan, one day at a time: one day shows, strip chips with status dots, All days overview, swipe, empty-day buttons, a day added to via the picker is shown.
// Run: node tests/plan-day.mjs   (demo mode in a temp copy)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-planday-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("   console:", m.text()); });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(`http://127.0.0.1:${PORT}/?today=2026-11-11`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Day trip");
  await p.fill("[name=destination]", "Goa");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.fill("[name=numDays]", "4");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const C = (fn, arg) => p.evaluate(fn, arg);
  await C(async () => {
    const c = window.__tripCtx, S = c.S;
    const mk = (id, o) => S.store.addItem(S.tripId, { title: id, category: "sight", dayId: null, order: 1, time: "", durationMin: 60, cost: 0, addedBy: S.me.email, addedAt: Date.now(), ...o });
    await mk("a1", { title: "Fort Aguada", dayId: S.trip.days[0].id, order: 1 });
    await mk("a2", { title: "Beach Shack", category: "food", veg: "no", dayId: S.trip.days[1].id, order: 1 });
    await mk("a3", { title: "Spice Farm", dayId: S.trip.days[1].id, order: 2 });
    await mk("i1", { title: "Waiting idea" });
  });
  await p.waitForTimeout(500);
  await C(() => { const c = window.__tripCtx; c.S.scrollToday = true; c.S.tab = "plan"; c.render(); });

  console.log("one day at a time");
  ok((await p.$$(".day")).length === 1, "only one day section is drawn");
  ok((await p.textContent(".day .day-n")).startsWith("Day 2"), "opens on today's day (Day 2): " + (await p.textContent(".day .day-n")));
  ok(await p.$eval(".dchip.on", (e) => e.dataset.i === "1"), "the Day 2 chip is on");
  const dots = await p.$$eval(".dchip[data-i]", (e) => e.map((x) => /st-(\w+)/.exec(x.className)[1]));
  ok(dots.join() === "planned,check,empty,empty", "status dots: planned, check (food with no veg options), empty, empty: " + dots.join());
  ok(/something to check/.test(await p.getAttribute(".dchip[data-i='1']", "aria-label")), "the dot is also in the chip's label");

  console.log("empty day");
  await p.click(".dchip[data-i='2']");
  ok(!!(await p.$(".day .day-empty .fill-btns [data-action=buildSample]")), "an empty day offers Fill empty days");
  ok((await p.$$(".fill-bar")).length === 0, "no fill bar on the Plan: the buttons live on an empty day and on the Ask screen");
  await p.click(".dchip[data-i='0']");
  ok((await p.$$(".fill-bar")).length === 0 && (await p.$$(".day .fill-btns")).length === 0, "a planned day has no fill buttons of its own");

  console.log("swipe and All days");
  const swipe = (dx) => p.evaluate((dx) => {
    const el = document.querySelector(".tab-body");
    const t = (type, x) => { const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch], changedTouches: [touch] })); };
    t("touchstart", 200); t("touchend", 200 + dx);
  }, dx);
  await swipe(-120);
  ok((await p.textContent(".day .day-n")).startsWith("Day 2"), "swipe left goes to the next day");
  await swipe(120);
  ok((await p.textContent(".day .day-n")).startsWith("Day 1"), "swipe right goes back");
  await swipe(120);
  ok((await p.textContent(".day .day-n")).startsWith("Day 1"), "swipe right on the first day stays");
  await p.click(".dchip.all");
  ok((await p.$$(".ov-row")).length === 4 && (await p.$$(".day")).length === 0, "All shows one row per day and no day section");
  ok(/Fort Aguada/.test(await p.textContent(".ov-row")), "an overview row lists its first stops");
  await p.click(".ov-row >> nth=1");
  ok((await p.textContent(".day .day-n")).startsWith("Day 2") && (await p.$$(".ov-row")).length === 0, "tapping a row opens that day");

  console.log("add to a day");
  await p.click(".dchip[data-i='0']");
  await C(() => { const c = window.__tripCtx; c.S.tab = "ideas"; c.render(); });
  await p.click(".card [data-action=schedule]");
  await p.waitForSelector("#modalForm input[name=dayId]");
  await p.click("#modalForm .pick:nth-of-type(4) input");
  await p.click("#modalForm button[value=ok]");
  await p.waitForTimeout(600);
  await C(() => { const c = window.__tripCtx; c.S.tab = "plan"; c.render(); });
  const dbg = await p.evaluate(() => { const S = window.__tripCtx.S; return document.querySelectorAll(".day").length + " days, tab " + S.tab + ", sel " + S.stripDay + ", " + S.items.filter((i) => i.dayId).map((i) => i.title + ":" + S.trip.days.findIndex((d) => d.id === i.dayId)).join(); });
  ok((await p.textContent(".day .day-n")).startsWith("Day 4") && /Waiting idea/.test(await p.textContent(".day")), "adding an idea to Day 4 shows Day 4: " + dbg);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scrolling on a phone");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  fails++;
  console.log("  FAIL " + e.message);
} finally {
  await b.close();
  srv.kill();
}
console.log(fails ? `\n${fails} plan-day check(s) failed` : "\nAll plan-day checks passed");
process.exit(fails ? 1 : 0);
