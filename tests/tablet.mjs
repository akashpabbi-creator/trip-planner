// Tablet test (Galaxy Tab S9+ sizes): upright and sideways, and a split-screen width. Demo mode, served from a temp copy.
// Upright and split screen use the bottom bar and the + sheet; sideways uses the side menu. No sideways scroll, touch targets are big enough.
// Run: node tests/tablet.mjs
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-tablet-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const SIZES = [["upright 876x1400", 876, 1400, "bar"], ["split screen 600x876", 600, 876, "bar"], ["upright 800x1280", 800, 1280, "bar"], ["sideways 1400x876", 1400, 876, "side"], ["sideways 1280x800", 1280, 800, "side"]];
for (const scheme of ["light", "dark"]) for (const [name, w, h, nav] of SIZES) {
  console.log(`${name} ${scheme}`);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, colorScheme: scheme });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Italy");
  await p.fill("[name=destination]", "Italy");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const vis = (sel) => p.$eval(sel, (e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed").catch(() => false);
  const barShown = await p.evaluate(() => getComputedStyle(document.querySelector(".tabs-bar")).display !== "none");
  const deskShown = await p.evaluate(() => getComputedStyle(document.querySelector(".tabs-desk")).display !== "none");
  ok(nav === "bar" ? barShown && !deskShown : deskShown && !barShown, `${nav === "bar" ? "bottom bar" : "side menu"} is the navigation`);
  const noScroll = async (label) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `no sideways scroll: ${label}`);
  const noClip = async (label) => ok(await p.evaluate(() => { const bar = document.querySelector(".tabs-bar"); if (getComputedStyle(bar).display === "none") return true; const r = bar.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && [...bar.querySelectorAll("button")].every((x) => { const q = x.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth && q.width >= 44 && q.height >= 44; }); }), `bar buttons fit and are 44px or more: ${label}`);
  await noScroll("plan");
  if (nav === "bar") {
    await noClip("plan");
    ok(await p.evaluate(() => { const bar = document.querySelector(".tabs-bar").getBoundingClientRect(), m = document.querySelector("main"); const last = [...m.children].filter((e) => e.getBoundingClientRect().height).pop().getBoundingClientRect(); return parseFloat(getComputedStyle(m).paddingBottom) >= bar.height - 8 && last.bottom <= bar.top + 600; }), "content has room above the bar");
    // + opens the sheet, centred on screen; Escape/back-drop close it
    await p.click(".bar-plus");
    await p.waitForTimeout(400);
    const sh = await p.$eval(".add-sheet", (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vis: getComputedStyle(e).visibility, w: innerWidth, h: innerHeight }; });
    ok(sh.vis === "visible" && Math.abs((sh.l + sh.r) / 2 - sh.w / 2) < 2 && sh.l >= 0 && sh.r <= sh.w + 1 && Math.abs(sh.b - sh.h) < 2, "+ sheet is a centred bottom sheet");
    ok(await p.evaluate(() => document.activeElement?.id === "linkInput"), "link field is ready");
    await p.click(".sheet-back", { position: { x: 5, y: 5 } });
    await p.waitForTimeout(400);
    ok(await p.$eval(".add-sheet", (e) => getComputedStyle(e).visibility === "hidden"), "sheet closes");
    // Trip hub and a child tab with a Back link
    await p.click(".tabs-bar [data-tab=trip]");
    await p.waitForTimeout(300);
    await noScroll("trip hub");
    await p.click(".hub-row");
    await p.waitForTimeout(300);
    ok(await vis(".hub-back"), "Back to Trip link shows on a Trip page");
  } else {
    ok(!(await vis(".bar-plus")) || !barShown, "no bottom bar");
    ok(await vis(".tabs-desk [data-tab=map]"), "side menu lists Map");
  }
  for (const t of ["ideas", "map", "kit", "budget", "changes"]) { await p.evaluate((t) => { const c = window.__tripCtx; c.S.tab = t; c.render(); }, t); await p.waitForTimeout(250); await noScroll(t); }
  // touch targets on the plan
  await p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "plan"; c.render(); });
  await p.waitForTimeout(250);
  const small = await p.evaluate(() => [...document.querySelectorAll(".btn-s, .rx, .chip")].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 36 || e.getBoundingClientRect().width < 36)).map((e) => e.className + ":" + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)).slice(0, 5));
  ok(small.length === 0, "buttons are at least 36px: " + small.join(" "));
  // turning the tablet changes the navigation without a reload
  if (scheme === "light" && name.startsWith("upright 876")) {
    await p.setViewportSize({ width: 1400, height: 876 });
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".tabs-desk")).display !== "none" && getComputedStyle(document.querySelector(".tabs-bar")).display === "none"), "turned sideways: side menu replaces the bar");
    await noScroll("after turning");
    await p.setViewportSize({ width: 876, height: 1400 });
    await p.waitForTimeout(400);
    await noClip("turned back upright");
  }
  await ctx.close();
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} check(s) failed` : "\nAll tablet checks passed");
process.exit(fails ? 1 : 0);
