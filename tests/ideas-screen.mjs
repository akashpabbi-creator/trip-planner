// Ideas screen and + add sheet (redesign job 6): one Add to day button per card, tips and veg badges, New marks, Book ahead with real
// dates, Top picks inside Ideas, the + sheet with the link field first (reads the clipboard), and the New mark on Your trips.
// Run: node tests/ideas-screen.mjs   (demo mode in a temp copy; external hosts mocked)   SHOTS=<dir> writes screenshots.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-ideasscr-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8990 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const errors = [];
const b = await chromium.launch();
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

async function open(viewport, mobile, scheme = "light") {
  const c = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, permissions: ["clipboard-read", "clipboard-write"] });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.stack));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (FONTS.test(r.request().url()) ? r.continue().catch(() => r.abort()) : r.fulfill({ status: 200, contentType: "text/plain", body: "" })));
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Italy");
  await p.fill("[name=destination]", "Italy");
  await p.fill("[name=numDays]", "4");
  await p.fill("[name=startDate]", "2026-12-30").catch(() => {});
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  // the destination guide loads in the background (mocked empty here): let it settle so it cannot overwrite the seeded one
  await p.waitForFunction(() => !window.__tripCtx.S.destBusy && !window.__tripCtx.S.trip.destLoading, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(600);
  return { c, p };
}
const seedItems = (p) => p.evaluate(async () => {
  const c = window.__tripCtx, S = c.S, d = S.trip.days;
  await S.store.updateTrip(S.tripId, {
    members: [S.me.email, "sanj@example.com"],
    place: { for: "Italy", title: "Italy", extract: "Italy is a country.", lat: 41.9, lng: 12.5, covers: [] },
    guide: { v: 99, for: "Italy", listings: [{ name: "Pantheon", category: "sight", why: "Ancient temple" }, { name: "Trattoria Nonna", category: "food", why: "Home cooking", vegetarian: "yes" }], source: "" },
  });
  const now = Date.now();
  const add = (x) => S.store.addItem(S.tripId, { description: "", image: "", siteName: "", location: "Rome, Italy", url: "", category: "sight", durationMin: 90, cost: 0, mustDo: false, addedBy: "sanj@example.com", addedByName: "Sanj", addedAt: now + 1, dayId: null, order: 0, time: "", lat: 41.9, lng: 12.5, ...x });
  await add({ title: "Roscioli Salumeria", category: "food", veg: "yes", notes: "Book 3 days ahead · Closed Mondays · Best at evening", url: "https://www.instagram.com/p/AAA/", votes: { "sanj@example.com": "love" } });
  await add({ title: "Borghese Gallery", notes: "Book 5 days in advance · Timed tickets only" });
  await add({ title: "Trattoria Da Enzo", category: "food", notes: "" });
  await add({ title: "Hotel near Santa Croce", category: "stay", notes: "", addedBy: S.me.email, addedByName: "Akash", url: "https://example.com/hotel" });
  // a planned stop that also says to book ahead (Day 3 = 2027-01-01, so book by 2026-12-29 with 3 days; here 2 days: 2026-12-30)
  await add({ title: "Vatican Museums", notes: "Book 2 days ahead", dayId: d[2].id, order: 1, addedBy: S.me.email, addedByName: "Akash" });
  c.render();
});

try {
  console.log("phone: Ideas screen");
  const { c, p } = await open({ width: 390, height: 844 }, true);
  await seedItems(p);
  await p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "plan"; c.render(); });
  // Ideas badge counts what the other person added since this device last looked (nothing was seen before)
  ok(/^\d+$/.test(await p.textContent(".tabs-bar [data-tab=ideas] .count")) && (await p.getAttribute(".tabs-bar [data-tab=ideas] .count", "aria-label")) === "3 new", "Ideas badge says 3 new (Sanj's three)");
  await p.click(".tabs-bar [data-tab=ideas]");
  await p.waitForSelector(".icard");
  ok((await p.$$(".icard")).length === 4, "four idea cards (the planned stop is not one)");
  ok((await p.$$(".icard [data-action=schedule]")).length === 4, "exactly one Add to day button per card");
  ok((await p.$$(".icard .ic-new")).length === 3, "three cards carry a New mark (Sanj's), not your own");
  const first = await p.textContent(".icard:first-child");
  ok(/Roscioli|Borghese|Trattoria Da Enzo/.test(first) && /New/.test(first), "New ideas come first");
  const ros = await p.textContent(".icard:has-text('Roscioli')");
  ok(/Book 3 days ahead/.test(ros) && /Closed Mondays/.test(ros), "tip chips show booking advice and closed days: " + ros.replace(/\s+/g, " ").slice(0, 120));
  ok(/Veg options/.test(ros) && /Sanj loves this/.test(ros), "veg badge and who loves it");
  ok(/from Sanj's Instagram post/.test(ros), "says where it came from");
  ok(/Veg options unchecked/.test(await p.textContent(".icard:has-text('Da Enzo')")), "an unchecked restaurant is flagged");
  ok(/Hotel near Santa Croce/.test(await p.textContent(".icard:has-text('Santa Croce')")) && /from your link/.test(await p.textContent(".icard:has-text('Santa Croce')")), "your own link reads 'from your link'");
  ok(await p.evaluate(() => [...document.querySelectorAll(".icard button")].every((x) => x.getBoundingClientRect().height >= 44)), "touch targets are at least 44px");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= 391), "no sideways overflow");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "ideas-phone-light.png"), fullPage: true });

  console.log("Book ahead with real dates");
  const ba = await p.textContent("#book-ahead summary");
  ok(/Book ahead/.test(ba) && /3 places/.test(ba), "Book ahead list counts 3 places: " + ba.replace(/\s+/g, " "));
  await p.click("#book-ahead summary");
  const rows = await p.$$eval("#book-ahead li", (a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  ok(rows.length === 3, "three rows");
  ok(rows[0].startsWith("Vatican Museums") && /Book by .*30/.test(rows[0]) && /Dec/.test(rows[0]), "the planned stop gets a real date (Day 3 is 1 Jan, 2 days ahead, so 30 Dec): " + rows[0]);
  ok(rows.slice(1).every((r) => /Needs a day/.test(r)), "ideas without a day say 'Needs a day'");
  const dl = await p.evaluate(async () => {
    const m = await import("./ideas.js");
    const c = window.__tripCtx;
    const h = { S: c.S, dayDate: c.dayDate };
    const a = m.deadlines(h, new Date(2026, 11, 28)).find((x) => x.it.title === "Vatican Museums");
    const z = m.deadlines(h, new Date(2026, 11, 31)).find((x) => x.it.title === "Vatican Museums");
    return { a: [a.late, a.left], z: [z.late, z.left], n: [m.bookDays("Book 3 days ahead"), m.bookDays("book 10 days in advance, go early"), m.bookDays("no need to book"), m.bookDays("Booking 400 days ahead")] };
  });
  ok(dl.a[0] === false && dl.a[1] === 2, "two days before the date it is not late: " + JSON.stringify(dl.a));
  ok(dl.z[0] === true && dl.z[1] === -1, "the day after the date it is marked late: " + JSON.stringify(dl.z));
  ok(JSON.stringify(dl.n) === "[3,10,0,0]", "bookDays reads 'book N days ahead' and ignores the rest: " + JSON.stringify(dl.n));
  await p.click("#book-ahead summary"); // close again

  console.log("tap a card: the idea sheet");
  await p.click(".icard:has-text('Roscioli') .ic-open");
  await p.waitForSelector(".ssheet");
  ok(/Idea/.test(await p.textContent(".ss-kick")) && /Roscioli/.test(await p.textContent(".ssheet")), "opens a sheet for the idea");
  ok(await p.isVisible(".ssheet [data-action=vote]") && await p.isVisible(".ssheet [data-action=cmtToggle]") && await p.isVisible(".ssheet [data-action=editItem]"), "reactions, comments and Edit are in the sheet");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "idea-sheet-phone-light.png") });
  await p.keyboard.press("Escape");
  ok(!(await p.$(".ssheet")), "Escape closes it");
  await p.click(".icard:has-text('Borghese') .ic-add");
  await p.waitForSelector("#modal[open] .pick-days, dialog[open] .pick-days");
  ok(true, "Add to day opens the day picker");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(150);

  console.log("New marks clear after you look");
  await p.click(".tabs-bar [data-tab=plan]");
  await p.click(".tabs-bar [data-tab=ideas]");
  await p.waitForSelector(".icard");
  ok((await p.$$(".icard .ic-new")).length === 0, "after leaving and coming back nothing is marked new");
  ok(!(await p.getAttribute(".tabs-bar [data-tab=ideas] .count", "aria-label")), "the badge shows the waiting count again");

  console.log("Top picks live in Ideas");
  ok(!(await p.$(".tp-body")), "Top picks start folded");
  await p.click("[data-action=picksToggle]");
  await p.waitForTimeout(500);
  await p.waitForSelector(".tp-body .dcard");
  ok((await p.$$(".tp-body .dcard")).length === 2, "the guide picks show inside Ideas");
  const before = (await p.$$(".icard")).length;
  await p.click(".tp-body .dcard:has-text('Pantheon') [data-action=discAdd]");
  await p.waitForFunction((n) => document.querySelectorAll(".icard").length === n + 1, before);
  ok(true, "Add on a pick puts it in Ideas");
  await p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "discover"; c.render(); });
  ok(!(await p.$(".dcard")) && await p.isVisible("[data-action=topPicks]"), "Discover no longer lists the picks, it points to Ideas");
  await p.click("[data-action=topPicks]");
  await p.waitForSelector(".tp-body .dcard");
  ok((await p.evaluate(() => window.__tripCtx.S.tab)) === "ideas", "that button opens Ideas with the picks open");
  await p.click("[data-action=picksToggle]");

  console.log("+ sheet");
  await p.click(".bar-plus");
  await p.waitForSelector(".add-wrap.open .add-sheet");
  ok(await p.isVisible("#linkInput"), "the link field is in the sheet");
  ok(await p.waitForFunction(() => document.activeElement?.id === "linkInput", null, { timeout: 3000 }).then(() => true, () => false), "with nothing on the clipboard the field is focused, ready to type");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "add-sheet-empty-phone-light.png") });
  await p.keyboard.press("Escape");
  await p.evaluate(() => navigator.clipboard.writeText("https://www.example.com/rome-eats"));
  await p.click(".bar-plus");
  await p.waitForFunction(() => document.getElementById("linkInput")?.value.includes("example.com"));
  ok(await p.isVisible(".as-clip.on") && /example\.com/.test(await p.textContent(".as-clip")), "a link on the clipboard fills the field and says so");
  ok(!(await p.evaluate(() => (window.__tripCtx.S.items || []).some((i) => /rome-eats/.test(i.url || "")))), "nothing is saved until you tap Save");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "add-sheet-clipboard-phone-light.png") });
  await p.click(".add-sheet [data-action=addLink]");
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => /rome-eats/.test(i.url || "")), null, { timeout: 15000 });
  ok(!(await p.$(".add-wrap.open")), "Save closes the sheet and the link lands in Ideas");
  await p.waitForFunction(() => !window.__tripCtx.S.busy);
  if (await p.evaluate(() => document.getElementById("modal").open)) await p.keyboard.press("Escape"); // an unreadable page opens the Edit place form
  await p.waitForTimeout(200);
  await p.evaluate(() => navigator.clipboard.writeText("just some words"));
  await p.click(".bar-plus");
  await p.waitForTimeout(300);
  ok(!(await p.isVisible(".as-clip.on")), "words that are not a link do not fill the field");
  await p.keyboard.press("Escape");

  console.log("Your trips: New mark");
  const tid = await p.evaluate(() => window.__tripCtx.S.tripId);
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForSelector(".trip-card");
  ok(!(await p.$(".tc-new")), "no mark right after you leave the trip");
  // Sanj changes the trip while it is closed on this device
  await p.evaluate(async (id) => { await window.__tripCtx.S.store.updateTrip(id, { updatedBy: "sanj@example.com", updatedAt: Date.now() }); }, tid);
  await p.waitForSelector(".tc-new");
  ok(/New from sanj/i.test(await p.textContent(".tc-new").catch(() => "")), "the card says there is something new from Sanj");
  if (SHOTS) await p.screenshot({ path: join(SHOTS, "home-new-phone-light.png") });
  await p.click(".trip-card");
  await p.waitForSelector(".tab-body");
  await p.evaluate(() => document.getElementById("homeBtn").click());
  await p.waitForSelector(".trip-card");
  ok(!(await p.$(".tc-new")), "after you open the trip the mark is gone");
  await c.close();

  console.log("desktop");
  const d = await open({ width: 1280, height: 860 }, false, "dark");
  await seedItems(d.p);
  await d.p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "ideas"; c.render(); });
  await d.p.waitForSelector(".icard");
  ok(await d.p.isVisible("#linkInput"), "on a computer the link field sits inline, no sheet needed");
  ok(await d.p.isVisible("[data-action=pasteLink]") && await d.p.isVisible("[data-action=newItem]"), "the other ways to add sit beside it");
  ok(!(await d.p.isVisible(".bar-plus")), "no + button on a computer");
  ok(await d.p.evaluate(() => [...document.querySelectorAll(".icard")].every((x) => x.scrollWidth <= x.clientWidth + 1)), "cards do not overflow");
  if (SHOTS) await d.p.screenshot({ path: join(SHOTS, "ideas-desktop-dark.png"), fullPage: true });
  await d.c.close();

  console.log("empty Ideas");
  const e = await open({ width: 390, height: 844 }, true);
  await e.p.evaluate(() => { const c = window.__tripCtx; c.S.tab = "ideas"; c.render(); });
  ok(await e.p.isVisible(".ideas-empty") && await e.p.isVisible(".ideas-empty [data-action=addOpen]"), "an empty Ideas screen offers to add one");
  await e.p.click(".ideas-empty [data-action=addOpen]");
  await e.p.waitForSelector(".add-wrap.open .add-sheet");
  ok(true, "and that opens the + sheet");
  await e.c.close();
} catch (e) {
  fails++;
  console.log("  FAIL exception: " + (e.stack || e));
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll Ideas screen checks passed");
process.exit(fails ? 1 : 0);
