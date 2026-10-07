// Layout checks: itinerary action pills stay compact, the compact hero shows off the Plan tab, and the desktop shell (opaque top bar, sidebar, no overflow).
// Run: node tests/layout.mjs   (demo mode in a temp copy)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-layout-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8790 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
async function open(width, height, mobile) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: "dark" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Sakleshpur road trip");
  await p.fill("[name=destination]", "Sakleshpur");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  await p.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updateTrip(c.S.tripId, { place: { for: "Sakleshpur", title: "Sakleshpur", extract: "x", covers: [], lat: 12.9, lng: 75.7 }, guide: { for: "Sakleshpur", v: 99, listings: [], at: Date.now() }, weather: { kind: "typical", for: `${c.S.trip.startDate}|3`, days: [] } }); });
  await p.waitForTimeout(300);
  return { p, ctx };
}
const goTab = async (p, id, mobile) => {
  if (!mobile) return p.click(`.tabs-desk [data-tab=${id}]`);
  if (["plan", "map", "ideas", "kit"].includes(id)) return p.click(`.tabs-bar [data-tab=${id}]`);
  await p.click("[data-action=moreToggle]");
  await p.click(`.more-sheet [data-tab=${id}]`);
};
try {
  for (const w of [360, 412]) {
    console.log("phone " + w);
    const { p, ctx } = await open(w, 800, true);
    ok(!(await p.$(".hero.compact")), "full hero on Plan");
    await goTab(p, "itinerary", true);
    await p.waitForSelector(".itin-actions");
    const m = await p.evaluate(() => ({
      btns: [...document.querySelectorAll(".itin-actions button")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 18), h: Math.round(r.height), right: Math.round(r.right) }; }),
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      title: getComputedStyle(document.querySelector(".itin-doc h1")).display,
    }));
    ok(m.btns.length >= 3, "Print, Copy and the calendar buttons are there: " + m.btns.map((x) => x.t).join(" | "));
    ok(m.btns.every((x) => x.h < 60), "action buttons are compact pills: heights " + m.btns.map((x) => x.h).join(","));
    ok(m.btns.every((x) => x.right <= m.cw), "no action button runs off the right edge");
    ok(m.sw <= m.cw, "no horizontal overflow on the Itinerary tab");
    ok(m.title === "none", "itinerary title card is hidden on screen (the hero has it)");
    ok(!!(await p.$(".hero.compact")), "compact hero on a non-Plan tab");
    const hh = await p.$eval(".hero", (e) => Math.round(e.getBoundingClientRect().height));
    ok(hh <= 140, "compact hero is short: " + hh + "px");
    ok(await p.$eval(".hero.compact", (e) => ["pill", "hero-budget", "eyebrow"].every((c) => [...e.querySelectorAll("." + c)].every((x) => !x.offsetParent))), "compact hero hides pills, budget and eyebrow");
    ok(await p.evaluate(() => ["invite", "editTrip", "home"].every((a) => !!document.querySelector(`.hero [data-action=${a}]`))), "back, invite and gear stay in the compact hero");
    // other tabs: no giant buttons, no overflow
    for (const id of ["budget", "changes", "kit", "smart", "discover", "ideas", "map"]) {
      await goTab(p, id, true);
      await p.waitForTimeout(150);
      const o = await p.evaluate(() => ({
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        tall: [...document.querySelectorAll(".tab-body button")].filter((e) => e.getBoundingClientRect().height > 90 && e.offsetParent).map((e) => e.textContent.trim().slice(0, 20)),
      }));
      ok(o.sw <= o.cw && !o.tall.length, `${id}: no overflow, no giant buttons${o.tall.length ? " (" + o.tall.join(", ") + ")" : ""}`);
      if (id === "discover") {
      const pa = await p.$$eval(".prefs-acts > button", (els) => els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), p: e.classList.contains("primary") })));
      ok(pa.length >= 2 && new Set(pa.map((x) => x.w)).size === 1 && pa.filter((x) => x.p).length === 1, "preferences card: one full-width action per row, one primary: " + JSON.stringify(pa));
      }
    }
    await ctx.close();
  }

  console.log("desktop 1725");
  let { p, ctx } = await open(1725, 887, false);
  let d = await p.evaluate(() => {
    const bg = getComputedStyle(document.querySelector(".topbar")).backgroundColor;
    const a = bg.match(/\/\s*([\d.]+)\)/);
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, alpha: a ? +a[1] : 1, right: Math.round(document.querySelector("#userBox").getBoundingClientRect().right) };
  });
  ok(d.sw <= d.cw, "no horizontal overflow at 1725");
  ok(d.alpha >= 0.9, "top bar is opaque (alpha " + d.alpha + ")");
  ok(d.right <= d.cw, "top bar content is not clipped on the right");
  ok(!!(await p.$(".trip.has-side .side .asst")) && !!(await p.$(".side .side-idea, .side-card")), "Plan shows the right-hand panel with the assistant");
  await ctx.close();

  console.log("desktop 1440");
  ({ p, ctx } = await open(1440, 900, false));
  d = await p.evaluate(() => { const r = document.querySelector(".tabs-desk").getBoundingClientRect(); return { vis: r.width > 150 && r.width < 260 && r.left < 200, dir: getComputedStyle(document.querySelector(".tabs-desk")).flexDirection, labels: [...document.querySelectorAll(".tabs-desk .t-l")].map((e) => e.textContent) }; });
  ok(d.vis && d.dir === "column", "sidebar nav is visible at 1440");
  ok(d.labels[0] === "Plan" && d.labels.at(-1) === "Connect Claude", "sidebar keeps the tab order: " + d.labels.join(","));
  const pills = await p.$$eval(".as-grid button", (e) => e.map((x) => getComputedStyle(x, "::after").content));
  ok(pills.join(",").includes("Clipboard") && pills.join(",").includes("New stop"), "add bar pills are labelled: " + pills.join(","));
  await ctx.close();
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll layout checks passed");
process.exit(fails ? 1 : 0);
