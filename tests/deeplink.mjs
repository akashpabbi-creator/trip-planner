// Deep links: #trip=<id>&tab=<tab>&day=<n> opens a trip on that tab and day (cold start and while running); bad values fall back; the address settles to #trip=<id>.
// Run: node tests/deeplink.mjs   (demo mode in a temp copy)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-deeplink-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8790 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const URL0 = `http://127.0.0.1:${PORT}/`;
const b = await chromium.launch();
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Link trip");
  await p.fill("[name=destination]", "Goa");
  await p.fill("[name=numDays]", "4");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const id = await p.evaluate(() => window.__tripCtx.S.tripId);
  const state = () => p.evaluate(() => ({ tab: window.__tripCtx.S.tab, strip: window.__tripCtx.S.stripDay, hash: location.hash, trip: window.__tripCtx.S.tripId }));

  console.log("cold start");
  await p.goto(URL0 + `#trip=${id}&tab=ideas`);
  await p.reload();
  await p.waitForFunction(() => window.__tripCtx?.S?.trip, null, { timeout: 15000 }).catch(() => {});
  let s = await state();
  ok(s.trip === id && s.tab === "ideas", "tab=ideas opens Ideas (" + s.tab + ")");
  ok(s.hash === "#trip=" + id, "the address settles to #trip=<id> (" + s.hash + ")");

  console.log("while running");
  await p.evaluate((id) => { location.hash = `#trip=${id}&tab=plan&day=3`; }, id);
  await p.waitForTimeout(600);
  s = await state();
  const third = await p.evaluate(() => { const r = document.querySelectorAll(".day")[2]?.getBoundingClientRect(); return r ? { top: Math.round(r.top), vh: innerHeight } : null; });
  ok(s.tab === "plan", "tab=plan opens Plan (" + s.tab + ")");
  ok(third && third.top < third.vh && third.top > -400, "day=3 scrolls the third day into view (top " + third?.top + " of " + third?.vh + ")");
  ok(s.hash === "#trip=" + id, "address settles again");

  await p.evaluate((id) => { location.hash = `#trip=${id}&tab=kit`; }, id);
  await p.waitForFunction(() => window.__tripCtx.S.tab === "kit", null, { timeout: 5000 }).catch(() => {});
  s = await state();
  ok(s.tab === "kit", "tab=kit opens the Kit (" + s.tab + ")");

  console.log("bad values");
  await p.evaluate((id) => { location.hash = `#trip=${id}&tab=nonsense&day=99`; }, id);
  await p.waitForTimeout(500);
  s = await state();
  ok(s.tab === "nonsense" ? false : true, "an unknown tab does not become the tab (" + s.tab + ")");
  ok(await p.evaluate(() => !!document.querySelector(".tab-body")), "the trip still renders");
  await p.evaluate((id) => { location.hash = `#trip=${id}&tab=plan&day=99`; }, id);
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!document.querySelector(".dchip")), "a day outside the trip is ignored, Plan still shows");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll deep-link checks passed");
process.exit(fails ? 1 : 0);
