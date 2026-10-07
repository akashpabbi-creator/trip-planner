// Cover test: Wikivoyage banner wins, flags/maps are rejected, "Change cover" cycles and is saved on the trip.
// Run: node tests/cover.mjs   (demo mode in a temp copy; Wikimedia hosts mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-cover-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];

async function run(label, { banner, wikiImage }) {
  console.log(label);
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//.test(u)) return json(r, { type: "standard", title: "Italy", extract: "Italy is a country.", originalimage: { source: wikiImage }, coordinates: { lat: 41.9, lon: 12.5 }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Italy" } } });
    if (/en\.wikivoyage\.org\/w\/api\.php\?action=query&prop=pageprops/.test(u)) return json(r, { query: { pages: { 1: { title: "Italy", pageprops: banner ? { wpb_banner: banner } : {} } } } });
    if (/wikivoyage/.test(u)) return json(r, { error: { code: "missingtitle" } });
    if (/\.(jpg|png)(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>" });
    return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Italy");
  await p.fill("[name=destination]", "Italy");
  await p.fill("[name=numDays]", "3");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  await p.waitForFunction(() => window.__tripCtx.S.trip.place?.for === "Italy", null, { timeout: 15000 });
  return { p, ctx };
}
const heroCover = (p) => p.$eval(".hero", (e) => e.style.getPropertyValue("--cover"));

try {
  const FLAG = "https://upload.wikimedia.org/wikipedia/commons/0/03/Flag_of_Italy.svg";
  const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/a/a1/Colosseum_in_Rome.jpg";
  let { p, ctx } = await run("banner + photo", { banner: "Italy banner.jpg", wikiImage: PHOTO });
  let pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  ok(Array.isArray(pl.covers) && pl.covers.length === 2, "two cover candidates: " + JSON.stringify(pl.covers));
  ok(/Special:FilePath\/Italy_banner\.jpg\?width=1600/.test(pl.covers[0]) && pl.image === pl.covers[0], "the Wikivoyage banner wins and is place.image");
  ok(pl.covers[1] === PHOTO, "the Wikipedia photo follows");
  ok((await heroCover(p)).includes("Italy_banner.jpg"), "hero shows the banner");
  ok(await p.isVisible(".cover-btn"), "Change cover button is shown when there are several covers");
  await p.click(".cover-btn");
  await p.waitForFunction(() => window.__tripCtx.S.trip.coverIdx === 1);
  ok((await heroCover(p)).includes("Colosseum_in_Rome.jpg"), "Change cover moves to the next cover and saves coverIdx");
  await p.click(".cover-btn");
  await p.waitForFunction(() => window.__tripCtx.S.trip.coverIdx === 0);
  ok((await heroCover(p)).includes("Italy_banner.jpg"), "and cycles back to the first");
  await p.click("[data-action=home]");
  ok((await p.$eval(".tc-img", (e) => e.style.backgroundImage)).includes("Italy_banner.jpg"), "home trip card uses the chosen cover");
  await ctx.close();

  ({ p, ctx } = await run("flag only", { banner: "Pagebanner default.jpg", wikiImage: FLAG }));
  pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  ok(pl.covers.length === 0 && !pl.image, "flag rejected and the default banner skipped: no cover");
  ok(!(await p.$(".cover-btn")) && !(await heroCover(p)), "hero falls back to the gradient, no Change cover button");
  // an old trip that stored the flag as place.image: filtered at render time
  await p.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updateTrip(c.S.tripId, { place: { ...c.S.trip.place, image: "https://x.org/Flag_of_Italy.svg", covers: undefined } }); });
  await p.waitForTimeout(300);
  ok(!(await heroCover(p)), "render-time guard hides a stored flag");
  await ctx.close();
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll cover checks passed");
process.exit(fails ? 1 : 0);
