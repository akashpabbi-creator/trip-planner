// A fresh start opens on Your trips; a reload or a resume keeps the open trip. Demo mode.
// Run: node tests/coldstart.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-cold-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const where = (p) => p.waitForSelector(".home, .tab-body").then(() => p.evaluate(() => (document.querySelector(".tab-body") ? "trip" : "home")));
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
  const url = `http://127.0.0.1:${PORT}/`;
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const id = await p.evaluate(() => window.__tripCtx.S.tripId);

  await p.reload();
  ok((await where(p)) === "trip", "reload keeps the trip open");
  await p.goto(url); // same tab, no trip link: like Android bringing the app back after it was paged out
  ok((await where(p)) === "trip", "resuming in the same app session keeps the trip open");

  // A cold start: a new tab has the same localStorage but a fresh sessionStorage.
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(url);
  await q.fill("#demoName", "Akash"); // the demo keeps who's signed in per tab; Google sign-in survives a restart
  await q.click("[data-action=signin]");
  ok((await where(q)) === "home", "a fresh start opens on Your trips");
  await q.goto(url + "#trip=" + id);
  ok((await where(q)) === "trip", "a trip link still opens the trip");
  await q.click("[data-action=home]");
  await q.waitForSelector(".home");
  await q.reload();
  ok((await where(q)) === "home", "after going back to Your trips, a reload stays there");
} finally {
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await b.close();
  srv.kill();
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
