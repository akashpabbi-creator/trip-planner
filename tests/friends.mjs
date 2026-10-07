// Friends mode in demo mode: no Gemini or Claude anywhere for people without AI, the private doc and migration for AI users,
// the invite link (join, remove, leave, reset) and the iPhone tip.
// Run: node tests/friends.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-friends-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8900 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const AI_WORDS = /Gemini|Claude/i;
async function route(p) {
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "generativelanguage.googleapis.com")
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }) });
    return r.fulfill({ status: 404, body: "" });
  });
}
// Pages of one browser context share localStorage (the demo database); each has its own sessionStorage (its own signed-in person).
async function newPage(bc, name, path = "", viewport) {
  const p = await bc.newPage();
  if (viewport) await p.setViewportSize(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  await route(p);
  await p.goto(URL0 + path);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  return p;
}
async function makeTrip(p, name = "Goa", dest = "Goa") {
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", name);
  await p.fill("[name=destination]", dest);
  await p.fill("[name=numDays]", "3");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  return p.evaluate(() => window.__tripCtx.S.tripId);
}
const text = (p) => p.evaluate(() => document.body.innerText);
const demoState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("tripplanner-demo-v1")));

try {
  /* ------------------------------------------------ someone without AI */
  console.log("no AI: nothing about Gemini or Claude");
  const bcN = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const f = await newPage(bcN, "Fran", "?noai");
  ok(await f.evaluate(() => window.__tripCtx.S.aiUser === false), "?noai: not an AI user");
  const tid = await makeTrip(f);
  ok(!AI_WORDS.test(await text(f)), "Plan tab (empty days) has no Gemini or Claude text");
  ok(await f.isVisible("[data-action=buildSample]"), "Fill empty days is still there");
  // Things an AI user would have left on the trip, and a key sitting in the private doc: friends never see or use them.
  await f.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    const id = await S.store.addItem(S.tripId, { title: "Baga beach", category: "nature", location: "Baga, Goa", dayId: S.trip.days[0].id, order: 1, description: "", image: "", siteName: "Gemini", suggestedBy: "ai", aiSource: "Gemini", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe() });
    await S.store.addItem(S.tripId, { title: "Fort Aguada", category: "sight", location: "Candolim, Goa", dayId: null, order: 0, description: "", image: "", siteName: "", suggestedBy: "ai", aiSource: "Claude", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...c.stampMe() });
    await S.store.updatePrivate(S.me.email, { ai: { key: "SHOULDNOTWORK", model: "m" } });
    await S.store.updateTrip(S.tripId, {
      proposal: { at: Date.now(), by: "x@demo", byName: "X", source: "Gemini", summary: "A relaxed plan", mode: "slow", bases: [], plan: [{ dayIndex: 1, time: "10:00", listing: { name: "Dudhsagar Falls", category: "nature" } }], notes: [], done: [] },
      changes: { at: Date.now(), by: "x@demo", byName: "Xavier", source: "Claude", request: "slower day 1", summary: "One swap", ops: [{ type: "remove", itemId: id, why: "Too much" }], applied: [], skipped: [] },
      aiPicks: { for: "Goa", at: Date.now(), by: "x@demo", source: "Gemini", items: [{ name: "Palolem", category: "nature", rating: 4.6, reviews: 100, why: "Calm bay" }] },
      aiReview: { at: Date.now(), by: "x@demo", source: "Gemini", summary: "Looks good", suggestions: [{ title: "Start earlier", detail: "Beat the heat", action: { type: "none" } }], applied: [] },
    });
  });
  await f.waitForSelector(".smart-banner[data-action=openProposal]");
  ok(await f.evaluate(() => window.__tripCtx.aiKey() === "" && window.__tripCtx.bridgeToken() === ""), "aiKey() and bridgeToken() are empty for a non-AI user, even with a private doc");
  const tabs = await f.$$eval(".tabs-desk button[data-tab]", (els) => els.map((e) => e.dataset.tab));
  for (const t of tabs) {
    if (t === "map") continue; // needs map tiles from the network
    await f.click(`.tabs-desk [data-tab=${t}]`);
    await f.waitForTimeout(150);
    const txt = await text(f);
    ok(!AI_WORDS.test(txt), `${t} tab: no Gemini or Claude text${AI_WORDS.test(txt) ? " (" + (txt.match(/.{0,40}(Gemini|Claude).{0,40}/i) || [""])[0].replace(/\n/g, " ") + ")" : ""}`);
  }
  await f.click(".tabs-desk [data-tab=plan]");
  for (const sel of ["[data-action=bridgeOpen]", "[data-action=geminiPlan]", "[data-action=claudePlan]", "[data-action=aiSettings]", "[data-action=aiPicks]", "[data-action=aiReview]", "[data-action=capturePick]", "[data-action=pasteOpen]", "#changeInput", "[data-action=chgClaude]", "[data-action=chgGemini]", "[data-action=copyForClaude]"])
    ok((await f.$$(sel)).length === 0, `no ${sel} anywhere`);
  ok(/A plan was drafted for your days/.test(await f.textContent(".smart-banner[data-action=openProposal]")), "an existing draft shows a neutral banner");
  ok(/Xavier suggests 1 change/.test(await f.textContent(".smart-banner[data-action=chgOpen]")), "an existing change list names who asked, not Gemini or Claude");
  await f.click("[data-action=openProposal]");
  await f.waitForSelector("#modalForm .proposal");
  const prop = await f.textContent("#modalForm");
  ok(!AI_WORDS.test(prop) && !(await f.$("[data-action=regenPlan]")) && !!(await f.$("[data-action=dropPlan]")), "the draft sheet is neutral, has no Try again, and can be discarded");
  await f.keyboard.press("Escape");
  await f.click("[data-action=chgOpen]");
  await f.waitForSelector("#chgList .chg-op");
  ok(!AI_WORDS.test(await f.textContent("#modalForm")), "the change list sheet is neutral");
  await f.keyboard.press("Escape");

  // Phone: More sheet and add sheet
  const fp = await newPage(bcN, "Fran", "?noai", { width: 390, height: 800 });
  await fp.waitForSelector(".tab-body"); // reopens the last trip
  await fp.click(".tabs-bar [data-action=moreToggle]");
  const more = await fp.textContent(".more-sheet");
  ok(!AI_WORDS.test(more) && /Discover/.test(more), "More sheet: no Connect Claude, no Gemini or Claude text");
  await fp.keyboard.press("Escape");
  const addSheet = await fp.textContent(".add-sheet");
  ok(!AI_WORDS.test(addSheet) && !/screenshot/i.test(addSheet), "add sheet: no screenshot or paste-tips tiles, no Gemini or Claude text: " + addSheet.trim().replace(/\s+/g, " ").slice(0, 120));
  ok((await fp.$$(".add-sheet .icon")).length === 2, "add sheet keeps paste-from-clipboard and new stop");
  // Rule-based link saving still works (offline here, so it falls back to the local parser).
  await fp.fill("#linkInput", "https://example.com/some-place-in-goa");
  await fp.click("[data-action=addLink]");
  await fp.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.url === "https://example.com/some-place-in-goa"), null, { timeout: 15000 });
  ok(!AI_WORDS.test(await fp.evaluate(() => document.getElementById("toast").textContent)), "saving a link works and its message doesn't mention Gemini or Claude");

  /* ------------------------------------------------------ AI user */
  console.log("AI user: key and Claude link live in the private doc");
  const bcA = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const a = await newPage(bcA, "Akash");
  ok(await a.evaluate(() => window.__tripCtx.S.aiUser === true), "demo: everyone is an AI user by default");
  const aid = await makeTrip(a, "Rome", "Rome");
  ok(await a.isVisible(".tabs-desk [data-action=bridgeOpen]"), "Connect Claude is there");
  await a.click(".tabs-desk [data-tab=discover]");
  ok(/Gemini/.test(await text(a)) && (await a.isVisible("[data-action=aiSettings]")), "Discover offers Connect Gemini");
  await a.click("[data-action=aiSettings]");
  await a.fill("#modalForm [name=key]", "AIzaTESTKEY");
  await a.click("#modalForm button[value=ok]");
  await a.waitForFunction(() => window.__tripCtx.aiKey() === "AIzaTESTKEY", null, { timeout: 10000 });
  let st = await demoState(a);
  const email = await a.evaluate(() => window.__tripCtx.S.me.email);
  ok(st.private[email]?.ai?.key === "AIzaTESTKEY", "the key is saved in the private doc");
  ok(!st.trips[aid].ai, "the trip doc has no ai");
  ok(await a.isVisible("[data-action=aiPicks]"), "Find top-rated picks appears once the key is set");
  await a.click(".tabs-desk [data-tab=plan]");
  const trip2 = await makeTripFromHome(a);
  st = await demoState(a);
  ok(!st.trips[trip2].ai, "a new trip doesn't copy ai onto the trip");

  console.log("migration moves an old trip-level key and Claude link");
  await a.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updatePrivate(c.S.me.email, { ai: null }); });
  await a.evaluate(async () => {
    const c = window.__tripCtx;
    await c.S.store.updateTrip(c.S.tripId, { ai: { key: "OLDKEY", model: "m" }, bridge: { token: "oldtok", at: 5, by: c.S.me.email, ask: { request: "swap lunch", at: 6, by: "Akash" } } });
  });
  await a.waitForFunction(() => { const t = window.__tripCtx.S.trip; return !t.ai && !t.bridge; }, null, { timeout: 10000 });
  ok(await a.evaluate(() => window.__tripCtx.aiKey() === "OLDKEY" && window.__tripCtx.bridgeToken() === "oldtok" && window.__tripCtx.bridgeAsk()?.request === "swap lunch"), "key, Claude token and waiting request are now read from the private doc");
  st = await demoState(a);
  ok(!("ai" in st.trips[trip2]) || st.trips[trip2].ai === null, "the trip no longer holds the key");
  ok(!st.trips[trip2].bridge, "the trip no longer holds the Claude token");
  ok(st.private[email].bridges[trip2].token === "oldtok" && st.private[email].ai.key === "OLDKEY", "the private doc holds both, keyed by trip");
  await a.evaluate(async () => { const c = window.__tripCtx; await c.S.store.updatePrivate(c.S.me.email, { ai: { key: "KEEPME" } }); await c.S.store.updateTrip(c.S.tripId, { ai: { key: "OTHER", model: "m" } }); });
  await a.waitForFunction(() => !window.__tripCtx.S.trip.ai, null, { timeout: 10000 });
  ok(await a.evaluate(() => window.__tripCtx.aiKey() === "KEEPME"), "migration doesn't overwrite a key the private doc already has");

  /* ------------------------------------------------------ invite link */
  console.log("invite link: join, remove, leave, reset");
  const bcJ = await b.newContext({ viewport: { width: 390, height: 800 } });
  const o = await newPage(bcJ, "Olive", "?noai");
  await makeTrip(o, "Lisbon", "Lisbon");
  await o.click("[data-action=invite]");
  await o.waitForSelector("[data-action=joinMake]");
  ok(!(await o.$("[data-action=leaveTrip]")) && !(await o.$("[data-action=removeMember]")), "owner alone: no Leave, nobody to remove");
  await o.click("[data-action=joinMake]");
  await o.waitForSelector("input.join-url");
  const url = await o.inputValue("input.join-url");
  ok(/#join=[A-Za-z0-9]{20,}$/.test(url), "invite link looks like <page>#join=<code>: " + url);
  const code = url.split("#join=")[1];
  st = await demoState(o);
  const lisbon = Object.values(st.trips).find((t) => t.name === "Lisbon");
  ok(st.joins[code]?.tripId === lisbon.id && lisbon.join?.code === code, "joins/{code} points at the trip and trip.join holds the code");
  ok(!!(await o.$("[data-action=joinShare]")) && !!(await o.$("[data-action=joinCopy]")) && !!(await o.$("[data-action=joinReset]")), "Share, Copy and Reset are offered");
  await o.evaluate(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push(d); }; });
  await o.click("[data-action=joinShare]");
  ok(await o.evaluate((u) => window.__shared[0]?.text === "Join our trip Lisbon: " + u, url), "Share sends “Join our trip Lisbon: <url>”");
  await o.evaluate(() => { delete navigator.share; });
  await o.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await o.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await o.click("[data-action=joinCopy]");
  ok(await o.evaluate((u) => window.__copied === u, url), "Copy puts the link on the clipboard");
  await o.keyboard.press("Escape");

  // A friend opens the link: signs in, joins, lands in the trip.
  const fr = await bcJ.newPage();
  fr.on("pageerror", (e) => errors.push(e.message));
  await route(fr);
  await fr.goto(url);
  await fr.waitForSelector("#demoName");
  ok(/invited to a trip/.test(await fr.textContent(".welcome")), "the sign-in page says you've been invited");
  await fr.fill("#demoName", "Finn");
  await fr.click("[data-action=signin]");
  await fr.waitForSelector(".tab-body", { timeout: 10000 });
  ok(/You've joined Lisbon/.test(await fr.evaluate(() => document.getElementById("toast").textContent)), "toast: You've joined Lisbon");
  ok(!/join=/.test(await fr.evaluate(() => location.hash)), "the join code is gone from the address");
  st = await demoState(fr);
  const finn = await fr.evaluate(() => window.__tripCtx.S.me.email);
  const l2 = st.trips[lisbon.id];
  ok(l2.members.includes(finn) && l2.memberNames[finn] === "Finn" && l2.lastJoin === code, "Finn is a member, with his name, and lastJoin is set");
  await fr.click("[data-action=invite]");
  await fr.waitForSelector("[data-action=leaveTrip]");
  ok(!(await fr.$("[data-action=joinMake]")) && !(await fr.$("input.join-url")) && !(await fr.$("[data-action=removeMember]")), "a non-owner sees Leave this trip, no invite link and no Remove");
  await fr.keyboard.press("Escape");

  // Owner removes Finn.
  await o.click("[data-action=invite]");
  await o.waitForSelector("[data-action=removeMember]");
  ok((await o.$$("[data-action=removeMember]")).length === 1, "owner sees Remove for Finn only");
  o.once("dialog", (d) => d.accept());
  await o.click("[data-action=removeMember]");
  await o.waitForFunction((id) => !window.__tripCtx.S.trips.length || !window.__tripCtx.S.trips.find((t) => t.id === id).members.some((m) => /finn/.test(m)), lisbon.id, { timeout: 5000 });
  await fr.waitForSelector(".trip-cards, .empty", { timeout: 10000 });
  ok(await fr.evaluate(() => !window.__tripCtx.S.tripId && window.__tripCtx.S.trips.length === 0), "Finn is sent home and no longer has the trip");
  await o.waitForFunction(() => document.querySelectorAll("#modalForm .members li").length === 1, null, { timeout: 5000 }); // the sheet reopens without him
  await o.keyboard.press("Escape");

  // Old code after Reset link no longer works.
  await o.click("[data-action=invite]");
  await o.waitForSelector("[data-action=joinReset]");
  o.once("dialog", (d) => d.accept());
  await o.click("[data-action=joinReset]");
  await o.waitForFunction((c) => document.querySelector("input.join-url") && !document.querySelector("input.join-url").value.endsWith(c), code, { timeout: 5000 });
  const url2 = await o.inputValue("input.join-url");
  st = await demoState(o);
  ok(!st.joins[code] && !!st.joins[url2.split("#join=")[1]], "Reset deletes the old joins doc and makes a new one");
  await o.keyboard.press("Escape");
  const fr2 = await bcJ.newPage();
  fr2.on("pageerror", (e) => errors.push(e.message));
  await route(fr2);
  await fr2.goto(url);
  await fr2.fill("#demoName", "Finn");
  await fr2.click("[data-action=signin]");
  await fr2.waitForFunction(() => /expired/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });
  ok(/This invite link has expired. Ask for a new one./.test(await fr2.textContent("#toast")), "an old link: “This invite link has expired. Ask for a new one.”");
  ok(await fr2.evaluate(() => window.__tripCtx.S.trips.length === 0), "…and doesn't add him");
  // Join with the new one, then leave on his own.
  const fr3 = await bcJ.newPage();
  fr3.on("pageerror", (e) => errors.push(e.message));
  await route(fr3);
  await fr3.goto(url2);
  await fr3.fill("#demoName", "Finn");
  await fr3.click("[data-action=signin]");
  await fr3.waitForSelector(".tab-body", { timeout: 10000 });
  await fr3.click("[data-action=invite]");
  fr3.once("dialog", (d) => d.accept());
  await fr3.click("[data-action=leaveTrip]");
  await fr3.waitForFunction(() => !window.__tripCtx.S.tripId, null, { timeout: 5000 });
  await fr3.waitForFunction(() => window.__tripCtx.S.trips.length === 0, null, { timeout: 5000 });
  ok(true, "Leave this trip: confirms, goes back to the trips list, and the trip is gone for him");
  st = await demoState(fr3);
  ok(st.trips[lisbon.id].members.length === 1 && st.trips[lisbon.id].members[0] === lisbon.owner, "only the owner is left on the trip");

  /* ------------------------------------------------------ iPhone tip */
  console.log("iPhone tip");
  const bcI = await b.newContext({ viewport: { width: 390, height: 800 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
  const ip = await newPage(bcI, "Ivy", "?noai");
  ok(/Add Trips to your Home Screen: tap Share, then Add to Home Screen. Sign in here in Safari first./.test(await ip.textContent(".ios-tip")), "iOS Safari, not installed: the tip shows after sign-in");
  await ip.click("[data-action=iosTipClose]");
  ok(!(await ip.$(".ios-tip")), "dismissing hides it");
  await ip.reload();
  await ip.waitForSelector(".home");
  ok(!(await ip.$(".ios-tip")), "…and it stays dismissed after a reload");
  ok(!(await f.$(".ios-tip")), "no tip on a desktop browser");
  const bcS = await b.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
  await bcS.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  const sp = await newPage(bcS, "Sid", "?noai");
  ok(!(await sp.$(".ios-tip")), "no tip when already on the Home Screen (standalone)");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll friends checks passed");
process.exit(fails ? 1 : 0);

async function makeTripFromHome(p) {
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForSelector("[data-action=newTrip]");
  return makeTrip(p, "Paris", "Paris");
}
