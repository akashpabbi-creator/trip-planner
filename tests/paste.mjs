// "Paste anything" (paste.js) in demo mode with a mocked Gemini: the sheet, the Gemini and Claude paths, the link-box hand-off.
// Run: node tests/paste.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-paste-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
// On phones the add bar's extra buttons live in the "Add to the trip" sheet behind the + button.
const openAdd = async (p) => { if (await p.isVisible(".add-plus") && !(await p.$(".add-wrap.open"))) await p.click("[data-action=addOpen]"); };
const b = await chromium.launch();
const errors = [];
let geminiPrompt = "", geminiCalls = 0, geminiReply = null;
const TIPS = "Day 1: sunrise at Colosseum, lunch at Trattoria Rosa (great cacio e pepe and eggplant), then Gelato Nero. Day 9: Vatican. Also try Pizzeria Meat House.";

try {
  const ctxB = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: "light" });
  const p = await ctxB.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com") {
      geminiCalls++;
      geminiPrompt = JSON.parse(r.request().postData()).contents[0].parts[0].text;
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(geminiReply) + "\n```" }] } }] }) });
    }
    if (u.hostname === "nominatim.openstreetmap.org") return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([{ lat: "41.9", lon: "12.5" }]) });
    return r.fulfill({ status: 404, body: "" });
  });
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
    const c = window.__tripCtx, S = c.S;
    await S.store.addItem(S.tripId, { title: "Colosseum", category: "sight", location: "Rome", lat: 41.89, lng: 12.49, dayId: S.trip.days[0].id, order: 1, description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe() });
  });

  console.log("the sheet");
  await openAdd(p);
  ok(await p.isVisible("[data-action=pasteOpen]") && (await p.getAttribute("[data-action=pasteOpen]", "title")) === "Paste tips or a transcript", "📝 button in the add bar");
  await openAdd(p);
  await p.click("[data-action=pasteOpen]");
  await p.waitForSelector("#pasteText");
  const sheet = await p.textContent("#modalForm");
  ok(/Find places in text/.test(sheet) && /The text goes to Gemini \(or Claude\) once and isn't saved/.test(sheet), "heading and privacy line");
  ok(/WhatsApp tips, a video transcript, a blog post or someone's itinerary/.test(await p.getAttribute("#pasteText", "placeholder")), "hint in the box");
  ok(!(await p.$("[data-action=pasteGemini]")) && (await p.isVisible("[data-action=pasteClaude]")), "no Find with Gemini without a key; Ask Claude is there");
  ok((await p.getAttribute("#pasteText", "maxlength")) === "20000", "box is capped at 20,000 characters");
  await p.click("[data-close]");

  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: { key: "K", model: "m" } }));
  await p.waitForTimeout(300);

  console.log("long text in the link box opens the sheet");
  await p.fill("#linkInput", TIPS);
  await p.click("[data-action=addLink]");
  await p.waitForSelector("#pasteText");
  ok((await p.inputValue("#pasteText")) === TIPS, "sheet is prefilled with the text");
  ok(await p.isVisible("[data-action=pasteGemini]"), "Find with Gemini shows with a key");
  ok((await p.inputValue("#linkInput", { timeout: 2000 }).catch(() => "")) === "", "the link box is emptied");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "paste-sheet.png") });

  console.log("Find with Gemini (mocked)");
  geminiReply = { kind: "changes", summary: "Found 4 places in the tips.", ops: [
    { type: "add", place: { name: "Trattoria Rosa", category: "food", location: "Via Roma 1, Rome", veg: "yes", vegNote: "cacio e pepe, eggplant", why: "Friend's favourite" }, toDay: 1 },
    { type: "add", place: { name: "Vatican Museums", category: "sight", location: "Vatican City" }, toDay: 9, why: "Day 9 doesn't exist" },
    { type: "add", place: { name: "Pizzeria Meat House", category: "food", location: "Rome", veg: "no" }, toDay: null },
    { type: "add", place: { name: "Colosseum", category: "sight", location: "Rome" }, toDay: 1 },
    { type: "move", itemId: "x", toDay: 1 },
  ] };
  await p.click("[data-action=pasteGemini]");
  await p.waitForSelector("#modalForm .chg-op");
  ok(geminiCalls === 1, "one Gemini call");
  ok(geminiPrompt.includes(TIPS) && /Colosseum/.test(geminiPrompt) && /vegetarian/i.test(geminiPrompt) && /"type":"add"/.test(geminiPrompt), "prompt carries the text, the places already saved, the veg rule and the add format");
  const rows = await p.$$eval(".chg-op", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(rows.length === 3 && rows[0].startsWith("Add “Trattoria Rosa” to Day 1") && /vegetarian options/.test(rows[0]), "review lists add ops only: " + rows.join(" | "));
  ok(/Add “Vatican Museums” to Ideas/.test(rows[1]), "a day the trip doesn't have means Ideas");
  ok(/Can't apply: Few vegetarian/.test(rows[2]), "a restaurant with little vegetarian food is blocked");
  ok(/Gemini's suggested changes/.test(await p.textContent("#modalForm h3")) && /Places from pasted text|Find places in pasted text/.test(await p.textContent("#chgHead")), "review names Gemini and the request");
  const noneYet = await p.evaluate(() => window.__tripCtx.S.items.length);
  ok(noneYet === 1, "nothing added until you tap");
  await p.click("button[value=ok]");
  await p.waitForFunction(() => !window.__tripCtx.S.trip.changes, null, { timeout: 10000 });
  await p.waitForTimeout(500);
  const got = await p.evaluate(() => { const c = window.__tripCtx; return c.S.items.map((i) => ({ t: i.title, d: c.S.trip.days.findIndex((d) => d.id === i.dayId) + 1, veg: i.veg })); });
  ok(got.length === 3 && got.some((x) => x.t === "Trattoria Rosa" && x.d === 1 && x.veg === "yes") && got.some((x) => x.t === "Vatican Museums" && x.d === 0), "applying adds the places (Day 1 and Ideas): " + JSON.stringify(got));

  console.log("Gemini finds nothing");
  geminiReply = { kind: "changes", summary: "none", ops: [] };
  await openAdd(p);
  await p.click("[data-action=pasteOpen]");
  await p.fill("#pasteText", "Just say hi to everyone from me!");
  await p.click("[data-action=pasteGemini]");
  await p.waitForFunction(() => /couldn't find any new places/.test(document.getElementById("toast").textContent), null, { timeout: 5000 });
  ok(await p.isVisible("#pasteText") && (await p.inputValue("#pasteText")).startsWith("Just say hi") && !(await p.evaluate(() => window.__tripCtx.S.trip.changes)), "says so, keeps the sheet and stores no proposal");
  await p.click("[data-close]");

  console.log("Ask Claude without the link: copy, paste back");
  await p.evaluate(() => { window.open = () => null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await openAdd(p);
  await p.click("[data-action=pasteOpen]");
  await p.fill("#pasteText", TIPS);
  await p.click("[data-action=pasteClaude]");
  await p.waitForSelector("#modalForm button[value=cancel]");
  await p.click("#modalForm button[value=cancel]"); // "Not now" on the connect nudge
  await p.waitForSelector("#modalForm textarea[name=answer]");
  const copied = await p.evaluate(() => window.__copied);
  ok(copied.includes(TIPS) && /"type":"add"/.test(copied) && /vegetarian/.test(copied) && /Find places in pasted text/.test(copied), "copied request has the pasted text, the add format and the veg rule");
  await p.fill("textarea[name=answer]", "```json\n" + JSON.stringify({ kind: "changes", request: "Find places in pasted text", summary: "Two places.", ops: [{ type: "add", place: { name: "Forno Campo", category: "food", location: "Campo de' Fiori, Rome", veg: "yes" }, toDay: null }] }) + "\n```");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.trip.changes?.source === "Claude", null, { timeout: 5000 });
  ok(/Claude suggests 1 change for “Find places in pasted text”/.test(await p.textContent(".smart-banner[data-action=chgOpen]")), "pasted answer becomes a Claude proposal");
  await p.click("[data-action=chgOpen]");
  await p.click("button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Forno Campo"), null, { timeout: 10000 });
  ok(true, "applying it adds the place");

  console.log("Ask Claude with the Claude link on");
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: null }));
  await p.click(".tabs-bar [data-action=moreToggle]");
  await p.click(".more-sheet [data-action=bridgeOpen]");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /connected/.test(document.querySelector("#modalForm h3")?.textContent || ""));
  const tok = await p.evaluate(() => window.__tripCtx.bridgeToken());
  await p.click("[data-close]");
  const LONG = "Tips: " + "x".repeat(9000) + " END";
  await openAdd(p);
  await p.click("[data-action=pasteOpen]");
  await p.fill("#pasteText", LONG);
  await p.click("[data-action=pasteClaude]");
  await p.waitForFunction(() => window.__tripCtx.bridgeAsk(), null, { timeout: 5000 });
  const ask = await p.evaluate(() => window.__tripCtx.bridgeAsk());
  ok(ask.request === "Find places in pasted text" && ask.text.length === 8000 && ask.text.startsWith("Tips: "), "the ask stays short and carries the text, capped at 8,000");
  await p.waitForFunction((t) => (JSON.parse(localStorage.getItem("tripplanner-demo-v1")).bridges[t]?.snapshot || "").includes('"requests"'), tok, { timeout: 10000 });
  const snap = await p.evaluate((t) => JSON.parse(JSON.parse(localStorage.getItem("tripplanner-demo-v1")).bridges[t].snapshot).requests[0], tok);
  ok(snap.request === "Find places in pasted text" && snap.text === ask.text, "the snapshot's requests carry the text for Claude");
  ok(/Claude opened with your trip/.test(await p.textContent("#toast")), "toast says Claude opened");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll paste checks passed");
process.exit(fails ? 1 : 0);
