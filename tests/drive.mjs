// Trip folder in Google Drive (drive.js) in demo mode: folder name, picker flow, screenshot filing, idea link, gating.
// Run: node tests/drive.mjs   (copies the repo to a temp dir in demo mode; Gemini, Nominatim, Google Drive and the Google picker are mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-drive-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const { folderName } = await import(join(root, "drive.js"));

function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const png = join(dir, "shot.png");
writeFileSync(png, makePng(200, 120));

console.log("folder name");
ok(folderName({ destination: "Goa, India", name: "x", startDate: "2026-12-20" }) === "Goa, India - December 2026", "destination - Month Year from the start date");
ok(folderName({ name: "Rome trip" }, new Date(2026, 9, 5)) === "Rome trip - October 2026", "falls back to the trip name and this month");
ok(!/[\\/]/.test(folderName({ destination: "A/B", startDate: "2026-01-02" })), "no slashes in the name");

const PLACES = { places: [{ name: "Trevi Fountain", category: "sight", address: "Piazza di Trevi, Rome", durationMin: 45, approxCost: 0, bestTime: "evening", vegetarian: "", why: "Famous fountain." }] };
const drive = { folders: [], uploads: [], fail: false };
const b = await chromium.launch();
const errors = [];
try {
  const c = await b.newContext({ viewport: { width: 390, height: 800 } });
  await c.addInitScript(() => {
    window.__pickResult = { action: "picked", docs: [{ id: "PARENT1", name: "Travel - Sanj_Akash", url: "https://drive.google.com/drive/folders/PARENT1" }] };
    window.google = { picker: {
      ViewId: { FOLDERS: "FOLDERS" }, Action: { PICKED: "picked", CANCEL: "cancel" },
      DocsView: class { setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } setMimeTypes() { return this; } },
      PickerBuilder: class {
        addView() { return this; } setOAuthToken(t) { window.__pickToken = t; return this; } setDeveloperKey() { return this; } setAppId() { return this; } setTitle(t) { window.__pickTitle = t; return this; }
        setCallback(cb) { this.cb = cb; return this; }
        build() { return { setVisible: () => setTimeout(() => this.cb(window.__pickResult), 20) }; }
      },
    } };
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = req.url();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    if (u.includes("generativelanguage.googleapis.com")) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(PLACES) + "\n```" }] } }] }) });
    if (u.includes("nominatim")) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify([{ lat: "41.9", lon: "12.49" }]) });
    if (u.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      drive.uploads.push({ auth: req.headers().authorization, ct: req.headers()["content-type"], size: req.postDataBuffer()?.length || 0, text: req.postDataBuffer()?.toString("latin1").slice(0, 400) });
      if (drive.fail) return r.fulfill({ status: 403, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { message: "storage full" } }) });
      return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ id: "FILE" + drive.uploads.length, name: "n.jpg", webViewLink: "https://drive.google.com/file/d/FILE" + drive.uploads.length + "/view" }) });
    }
    if (u.startsWith("https://www.googleapis.com/drive/v3/files")) {
      const body = JSON.parse(req.postData());
      drive.folders.push({ auth: req.headers().authorization, ...body });
      return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ id: "TRIPFOLDER", name: body.name, webViewLink: "https://drive.google.com/drive/folders/TRIPFOLDER" }) });
    }
    return r.fulfill({ status: 200, contentType: "text/plain", headers: cors, body: "" });
  });
  await p.goto(`http://127.0.0.1:${PORT}/`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Rome trip");
  await p.fill("[name=destination]", "Rome");
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  const kit = async () => { await p.evaluate(() => document.querySelector("[data-action=tab][data-tab=kit]").click()); await p.waitForSelector("#drive-folder"); };
  const tripFolder = () => p.evaluate(() => window.__tripCtx.S.trip.driveFolder || null);

  console.log("gating");
  await p.evaluate(() => { window.__tripCtx.S.aiUser = false; window.__tripCtx.render(); });
  await p.evaluate(() => document.querySelector("[data-action=tab][data-tab=kit]").click());
  await p.waitForSelector(".kit");
  ok(!(await p.$("#drive-folder")), "a friend (not an AI user) sees no folder card when none is set");
  await p.evaluate(() => { window.__tripCtx.S.aiUser = true; window.__tripCtx.render(); });
  await kit();
  ok(/Choose a Drive folder/.test(await p.textContent("#drive-folder")), "AI user sees 'Choose a Drive folder'");

  console.log("create the trip folder inside a picked folder");
  await p.click("#drive-folder [data-action=driveSetup]");
  ok(/Rome - November 2026/.test(await p.textContent("#modalForm")), "sheet names the default folder: Rome - November 2026");
  await p.click("#modalForm [data-action=driveMake]");
  await p.waitForFunction(() => !!window.__tripCtx.S.trip.driveFolder, null, { timeout: 8000 });
  const f = await tripFolder();
  ok(f.id === "TRIPFOLDER" && f.name === "Travel - Sanj_Akash/Rome - November 2026" && /TRIPFOLDER/.test(f.url) && f.by, "driveFolder saved on the trip: " + JSON.stringify(f));
  ok(drive.folders.length === 1 && drive.folders[0].name === "Rome - November 2026" && drive.folders[0].parents[0] === "PARENT1" && drive.folders[0].mimeType === "application/vnd.google-apps.folder" && drive.folders[0].auth === "Bearer demo-drive-token", "Drive got one folder create inside the picked parent");
  ok(await p.evaluate(() => window.__pickToken) === "demo-drive-token", "the picker was given the Drive token");
  ok(/Travel - Sanj_Akash\/Rome - November 2026/.test(await p.textContent("#drive-folder a")), "card shows the folder link");
  ok(await p.evaluate(() => window.__tripCtx.S.activity?.some?.((a) => /Google Drive folder/.test(a.text || a.what || "")) ?? true), "activity entry written");

  console.log("pick an existing folder instead, then remove");
  await p.evaluate(() => { window.__pickResult = { action: "picked", docs: [{ id: "OWN", name: "Rome 2026", url: "https://drive.google.com/drive/folders/OWN" }] }; });
  await p.click("#drive-folder [data-action=driveSetup]");
  await p.click("#modalForm [data-action=drivePick]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.driveFolder?.id === "OWN", null, { timeout: 8000 });
  ok(drive.folders.length === 1, "no extra folder created when one is picked");
  await p.evaluate(() => { window.__pickResult = { action: "cancel" }; });
  await p.click("#drive-folder [data-action=driveSetup]");
  await p.click("#modalForm [data-action=drivePick]");
  await p.waitForTimeout(400);
  ok((await tripFolder()).id === "OWN", "cancelling the picker changes nothing");
  await p.click("#drive-folder [data-action=driveClear]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.driveFolder, null, { timeout: 5000 });
  ok(true, "Remove clears the folder");

  console.log("shared screenshot is filed in the folder");
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { driveFolder: { id: "TRIPFOLDER", name: "Rome - November 2026", url: "https://drive.google.com/drive/folders/TRIPFOLDER" } }));
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "TESTKEY", model: "x" } }));
  await p.waitForFunction(() => window.__tripCtx.aiKey() === "TESTKEY" && window.__tripCtx.drive.ready());
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.querySelector("[data-action=capturePick]").click())]);
  await fc.setFiles([png]);
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Trevi Fountain" && i.driveFiles?.length), null, { timeout: 15000 });
  await p.waitForFunction(() => !window.__tripCtx.S.busy);
  ok(drive.uploads.length === 1 && drive.uploads[0].auth === "Bearer demo-drive-token" && /multipart\/related/.test(drive.uploads[0].ct), "one upload to Drive, multipart, with the token");
  ok(/"parents":\["TRIPFOLDER"\]/.test(drive.uploads[0].text) && /Rome trip screenshot \d{4}-\d{2}-\d{2} \d{4}\.png/.test(drive.uploads[0].text) && drive.uploads[0].size > 200, "saved into the trip folder as the original PNG with a dated name");
  const it = await p.evaluate(() => window.__tripCtx.S.items.find((i) => i.title === "Trevi Fountain"));
  ok(it.driveFiles[0].id === "FILE1" && /FILE1/.test(it.driveFiles[0].url) && it.via === "screenshot", "the idea keeps a link to its picture");
  await p.evaluate(() => document.querySelector("[data-action=tab][data-tab=ideas]").click());
  await p.waitForSelector("article.card");
  ok(/📎 Screenshot/.test(await p.textContent("article.card")) && (await p.getAttribute("article.card a:has-text('Screenshot')", "href")).includes("FILE1"), "idea card shows 📎 Screenshot linking to Drive");

  console.log("Drive failing never loses the places");
  drive.fail = true;
  const [fc2] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.querySelector("[data-action=capturePick]").click())]);
  PLACES.places[0] = { name: "Pantheon", category: "sight", address: "Piazza della Rotonda, Rome", durationMin: 45, approxCost: 0, bestTime: "morning", vegetarian: "", why: "Ancient temple." };
  await fc2.setFiles([png]);
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Pantheon"), null, { timeout: 15000 });
  const pan = await p.evaluate(() => window.__tripCtx.S.items.find((i) => i.title === "Pantheon"));
  ok(!pan.driveFiles, "no picture link when the upload failed, place still added");

  console.log("no folder: nothing is uploaded");
  drive.fail = false;
  await p.evaluate(() => window.__tripCtx.S.store.updateTrip(window.__tripCtx.S.tripId, { driveFolder: null }));
  const n = drive.uploads.length;
  PLACES.places[0] = { name: "Colosseum", category: "sight", address: "Piazza del Colosseo, Rome", durationMin: 90, approxCost: 0, bestTime: "morning", vegetarian: "", why: "Arena." };
  const [fc3] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.querySelector("[data-action=capturePick]").click())]);
  await fc3.setFiles([png]);
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Colosseum"), null, { timeout: 15000 });
  ok(drive.uploads.length === n, "no Drive call without a trip folder");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll drive checks passed");
process.exit(fails ? 1 : 0);
