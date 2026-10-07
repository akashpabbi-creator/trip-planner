// Cover test: banner wins, flags/maps/portraits are rejected, nearby + Commons photos fill in, the cover picker and photo link are saved on the trip.
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

async function run(label, { banner, wikiImage, nearby = {}, commons = {}, ov = () => [], description = "", extract = "Italy is a country.", fail = false, queries = [] }) {
  console.log(label);
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/api\.openverse\.org/.test(u)) { const q = new URL(u).searchParams.get("q"); queries.push("ov:" + q); return fail ? r.abort() : json(r, { results: ov(q) }); }
    if (fail && /pageprops|geosearch|commons\.wikimedia\.org\/w\/api/.test(u)) { if (/commons\.wikimedia/.test(u)) queries.push("cm:" + decodeURIComponent(new URL(u).searchParams.get("gsrsearch") || "")); return r.abort(); }
    if (/commons\.wikimedia\.org\/w\/api\.php/.test(u)) queries.push("cm:" + decodeURIComponent(new URL(u).searchParams.get("gsrsearch") || ""));
    if (/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//.test(u)) return json(r, { type: "standard", title: "Italy", description, extract, originalimage: { source: wikiImage }, coordinates: { lat: 41.9, lon: 12.5 }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Italy" } } });
    if (/en\.wikivoyage\.org\/w\/api\.php\?action=query&prop=pageprops/.test(u)) return json(r, { query: { pages: { 1: { title: "Italy", pageprops: banner ? { wpb_banner: banner } : {} } } } });
    if (/en\.wikipedia\.org\/w\/api\.php.*geosearch/.test(u)) return json(r, { query: { pages: nearby } });
    if (/commons\.wikimedia\.org\/w\/api\.php/.test(u)) return json(r, { query: { pages: commons } });
    if (/wikivoyage/.test(u)) return json(r, { error: { code: "missingtitle" } });
    if (/\.(jpe?g|png)(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>" });
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
  ok(Array.isArray(pl.covers) && pl.covers.length === 3 && pl.covers[2] === "illus:generic", "banner, photo and the illustration: " + JSON.stringify(pl.covers));
  ok(/Special:FilePath\/Italy_banner\.jpg\?width=1600/.test(pl.covers[0]) && pl.image === pl.covers[0], "the Wikivoyage banner wins and is place.image");
  ok(pl.covers[1] === PHOTO, "the Wikipedia photo follows");
  ok((await heroCover(p)).includes("Italy_banner.jpg"), "hero shows the banner");
  ok(await p.isVisible(".cover-btn"), "cover button is shown");
  await p.click(".cover-btn");
  await p.waitForSelector("#modal[open] .cover-grid");
  ok((await p.textContent("#modal h3")) === "Choose a cover", "picker is titled Choose a cover");
  ok((await p.$$(".cover-opt")).length === 3 && await p.$eval(".cover-opt", (e) => e.classList.contains("on")), "grid shows all covers, current one outlined");
  await p.click(".cover-opt:nth-child(2)");
  await p.waitForFunction(() => window.__tripCtx.S.trip.coverIdx === 1);
  ok((await heroCover(p)).includes("Colosseum_in_Rome.jpg"), "picking a thumbnail changes the hero");
  ok((await p.evaluate(() => window.__tripCtx.S.trip.coverPick)) === PHOTO, "the pick is stored by URL (coverPick)");
  await p.click(".cover-btn");
  ok(await p.$eval(".cover-opt:nth-child(2)", (e) => e.classList.contains("on")), "the new pick is outlined");
  await p.fill("[name=coverUrl]", "https://example.org/mine.jpg");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.coverUrl === "https://example.org/mine.jpg");
  ok((await heroCover(p)).includes("example.org/mine.jpg"), "a photo link overrides the picked cover");
  await p.click("[data-action=home]");
  ok((await p.$eval(".tc-img", (e) => e.style.backgroundImage)).includes("example.org/mine.jpg"), "home trip card uses the photo link");
  await p.click(".tc-img");
  await p.waitForSelector(".hero");
  await p.click(".cover-btn");
  await p.click("[data-action=coverClear]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.coverUrl);
  ok((await heroCover(p)).includes("Colosseum_in_Rome.jpg"), "Remove clears the link and the picked cover shows again");
  await p.click("[data-action=home]");
  ok((await p.$eval(".tc-img", (e) => e.style.backgroundImage)).includes("Colosseum_in_Rome.jpg"), "home trip card uses the chosen cover");
  await ctx.close();

  ({ p, ctx } = await run("flag only", { banner: "Pagebanner default.jpg", wikiImage: FLAG }));
  pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  ok(pl.covers.length === 1 && pl.covers[0] === "illus:generic", "flag rejected and the default banner skipped: only the illustration is left");
  ok((await heroCover(p)).startsWith("url('data:image/svg+xml"), "hero shows the generated illustration");
  ok(!!(await p.$(".cover-btn")), "cover button stays so a link can be pasted");
  await p.click(".cover-btn");
  ok((await p.$$(".cover-opt")).length === 1 && !!(await p.$("[name=coverUrl]")), "picker offers the illustration and the photo link");
  await p.fill("[name=coverUrl]", "http://insecure.example/x.jpg");
  await p.click("#modalForm button[value=ok]");
  await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => window.__tripCtx.S.trip.coverUrl)), "a non-https link is refused");
  await p.keyboard.press("Escape");
  // an old trip that stored the flag as place.image: filtered at render time
  await p.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updateTrip(c.S.tripId, { place: { ...c.S.trip.place, image: "https://x.org/Flag_of_Italy.svg", covers: undefined } }); });
  await p.waitForTimeout(300);
  ok(!(await heroCover(p)), "render-time guard hides a stored flag");
  await ctx.close();

  // no banner, no listings: nearby landmarks and Commons photos fill in; maps, taluks and portraits are dropped
  const img = (w, h, src) => ({ source: src, width: w, height: h });
  const wp = (index, title, original) => ({ index, title, original });
  const nearby = {
    1: wp(1, "Manjarabad Fort", img(4000, 2500, "https://upload.wikimedia.org/wikipedia/commons/a/aa/Manjarabad_Fort.jpg")),
    2: wp(2, "Sakleshpur taluk", img(4000, 2500, "https://upload.wikimedia.org/wikipedia/commons/b/bb/Sakleshpur_taluk_map.jpg")),
    3: wp(3, "Mapusa", img(3000, 1800, "https://upload.wikimedia.org/wikipedia/commons/c/cc/Mapusa_market.jpg")),
    4: wp(4, "Portrait temple", img(1800, 3000, "https://upload.wikimedia.org/wikipedia/commons/d/dd/Temple_portrait.jpg")),
    5: wp(5, "Tiny", img(600, 400, "https://upload.wikimedia.org/wikipedia/commons/e/ee/Tiny.jpg")),
    6: wp(6, "PNG", img(3000, 1800, "https://upload.wikimedia.org/wikipedia/commons/f/ff/Thing.png")),
  };
  const ci = (index, title, w, h, mime = "image/jpeg") => ({ index, title: "File:" + title, imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/x/" + title, thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/x/" + title + "/1600px-" + title, width: w, height: h, mime }] });
  const commons = {
    1: ci(1, "Coffee_estate_Sakleshpur.jpg", 4000, 2600),
    2: ci(2, "Census_of_India_chart.jpg", 4000, 2600),
    3: ci(3, "Narrow_Sakleshpur.jpg", 1000, 600),
    4: ci(4, "Sakleshpur_portrait.jpg", 2000, 3000),
  };
  ({ p, ctx } = await run("nearby + commons only", { banner: "", wikiImage: "https://upload.wikimedia.org/wikipedia/commons/z/zz/Hassan_district_map.png", nearby, commons }));
  pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  ok(pl.covers.length === 4, "three photos and the illustration: " + JSON.stringify(pl.covers));
  ok(/1600px-Coffee_estate_Sakleshpur\.jpg$/.test(pl.covers[0]), "Commons photo (1600px thumbnail) ranks above landmarks");
  ok(/Manjarabad_Fort\.jpg$/.test(pl.covers[1]) && /Mapusa_market\.jpg$/.test(pl.covers[2]), "landmarks next, nearest first; Mapusa passes the map filter");
  ok(!pl.covers.some((u) => /taluk|district|Census|portrait|Tiny|\.png/i.test(u)), "map, taluk, census, portrait, narrow and non-JPEG images are rejected");
  ok(JSON.stringify(pl.coverCaptions) === JSON.stringify(["Coffee estate Sakleshpur", "Manjarabad Fort", "Mapusa", "Illustration"]), "captions: " + JSON.stringify(pl.coverCaptions));
  ok((await heroCover(p)).includes("Coffee_estate_Sakleshpur.jpg"), "hero shows the first photo");
  await p.click(".cover-btn");
  await p.waitForSelector(".cover-opt");
  ok((await p.$$(".cover-opt")).length === 4 && (await p.textContent(".cover-opt")).includes("Coffee estate Sakleshpur"), "picker shows thumbnails with captions");
  await p.screenshot({ path: process.env.SHOT || join(dir, "picker.png") });
  await p.keyboard.press("Escape");
  await ctx.close();

  // Openverse destination photos + inspired themes, ranking, credits, coverPick persistence
  const hit = (title, w, h, extra = {}) => ({ title, url: "https://live.staticflickr.com/" + title.replace(/\W+/g, "_") + ".jpg", width: w, height: h, creator: "Jane", license: "by", license_version: "2.0", ...extra });
  const queries = [];
  const ovData = (q) => (q === "Italy" ? [hit("Train on a bridge", 4000, 2500), hit("Italy coast", 4000, 2600), hit("Tall tower", 1800, 3000), hit("Small", 640, 400)]
    : /coffee/.test(q) ? [hit("Coffee estate in the mist", 3000, 2000)] : /Western Ghats/.test(q) ? [hit("Misty ghats at dawn", 3200, 2000)] : []);
  ({ p, ctx } = await run("openverse + inspired", { banner: "", wikiImage: "", ov: ovData, queries, description: "Town in Karnataka, India", extract: "Italy is a hill town known for its coffee estates, cardamom, a hill fort and the Western Ghats." }));
  pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  console.log("    " + JSON.stringify(pl.coverCaptions));
  ok(queries.includes("ov:Italy"), "Openverse is asked for the destination first");
  ok(queries.includes("ov:coffee plantation Karnataka"), "inspired query uses the theme and the region: " + queries.filter((x) => x.startsWith("ov:")).join(" | "));
  ok(queries.some((x) => /^ov:Western Ghats landscape/.test(x)) && queries.some((x) => /^cm:coffee plantation/.test(x)), "other themes and Commons are searched too");
  ok(pl.coverCaptions[0] === "Italy coast" && /^Inspired:/.test(pl.coverCaptions[1]) && /^Inspired:/.test(pl.coverCaptions[2]), "destination and inspired photos are interleaved best first: " + pl.coverCaptions.join(" / "));
  ok(pl.coverCaptions.includes("Inspired: Western Ghats landscape"), "second theme appears");
  ok(!pl.covers.some((u) => /Tall_tower|Small/.test(u)), "portrait and narrow Openverse results are skipped");
  ok(pl.coverCaptions[pl.coverCaptions.length - 2] === "Train on a bridge" && pl.coverCaptions.at(-1) === "Illustration", "a train caption is pushed to the end, the illustration is last");
  ok(pl.covers.at(-1) === "illus:coffee", "illustration uses the main theme");
  ok(pl.coverCredits[0] === "Jane · CC BY 2.0", "credit kept: " + pl.coverCredits[0]);
  ok((await heroCover(p)).includes("Italy_coast.jpg"), "hero shows the first ranked photo");
  await p.click(".cover-btn");
  await p.waitForSelector(".cover-opt");
  ok((await p.textContent(".cover-opt")).includes("Jane · CC BY 2.0"), "picker shows the credit line");
  await p.click(".cover-opt:nth-child(3)");
  await p.waitForFunction(() => window.__tripCtx.S.trip.coverPick);
  const picked = await p.evaluate(() => window.__tripCtx.S.trip.coverPick);
  ok(/Coffee_estate_in_the_mist/.test(picked), "picked photo stored by URL");
  await p.evaluate(async () => { const c = window.__tripCtx; const pl = c.S.trip.place; await c.S.store.updateTrip(c.S.tripId, { place: { ...pl, covers: [...pl.covers].reverse(), coverCaptions: [...pl.coverCaptions].reverse(), coverCredits: [...pl.coverCredits].reverse() } }); });
  await p.waitForTimeout(300);
  ok((await heroCover(p)).includes("Coffee_estate_in_the_mist"), "the pick survives a re-read that reorders the list");
  await p.evaluate(async () => { const c = window.__tripCtx; const pl = c.S.trip.place; await c.S.store.updateTrip(c.S.tripId, { place: { ...pl, covers: pl.covers.filter((u) => !/Coffee_estate/.test(u)), coverCaptions: pl.coverCaptions.slice(1), coverCredits: pl.coverCredits.slice(1) } }); });
  await p.waitForTimeout(300);
  ok(!(await heroCover(p)).includes("Coffee_estate_in_the_mist") && !!(await heroCover(p)), "a pick that is no longer a candidate falls back to the first one");
  await ctx.close();

  // every network source fails: the illustration still gives a cover, offline
  ({ p, ctx } = await run("all networks fail", { banner: "", wikiImage: "", fail: true, extract: "Italy is known for its coffee estates and cardamom." }));
  pl = await p.evaluate(() => window.__tripCtx.S.trip.place);
  ok(pl.covers.length === 1 && pl.covers[0] === "illus:coffee" && pl.coverCaptions[0] === "Illustration", "only the themed illustration remains: " + JSON.stringify(pl.covers));
  ok((await heroCover(p)).startsWith("url('data:image/svg+xml"), "hero renders the generated SVG");
  const bad = await p.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updateTrip(c.S.tripId, { place: { ...c.S.trip.place, covers: ["data:image/svg+xml,<svg onload=alert(1)>", "illus:../x"] } }); return 1; });
  await p.waitForTimeout(300);
  ok(!(await heroCover(p)), "arbitrary data: URLs and malformed tokens are not accepted as covers");
  await ctx.close();
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
// Critters are not scenery: wildlife close-ups never become cover options
{
  const { coverEntries } = await import(join(root, "discover.js"));
  const frog = { url: "https://upload.wikimedia.org/a/Kodaikanal_Bush_Frog.jpg", caption: "Kodaikanal_Bush_Frog_the_metallic_jewel" };
  const hills = { url: "https://upload.wikimedia.org/b/Western_Ghats_hills.jpg", caption: "Western Ghats hills at dawn" };
  const urls = coverEntries("", [], "", [], [], [{ url: "https://x.org/ovbird.jpg", caption: "Macro of a butterfly" }], [{ theme: "hills", cm: [frog, hills], ov: [{ url: "https://x.org/ovfrog.jpg", caption: "Green_Frog_close-up" }] }]).map((x) => x.url);
  ok(!urls.includes(frog.url) && !urls.includes("https://x.org/ovfrog.jpg") && !urls.includes("https://x.org/ovbird.jpg"), "wildlife close-ups (underscored titles too) are dropped from covers");
  ok(urls.includes(hills.url), "a landscape inspired photo is kept");
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll cover checks passed");
process.exit(fails ? 1 : 0);
