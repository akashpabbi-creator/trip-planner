// Social test: votes, comments, both-love badge, Ideas filter/sort, planning hooks. Two demo users in one browser context.
// Run: node tests/social.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-social-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8890 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
const bc = await b.newContext({ viewport: { width: 390, height: 844 } });
const route = (p) => p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
  if (/nominatim\.openstreetmap\.org/.test(r.request().url())) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "41.9", lon: "12.5" }]) });
  return r.fulfill({ status: 200, contentType: "text/plain", body: "" });
});
async function page(name) {
  const p = await bc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await route(p);
  await p.goto(URL0);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  return p;
}
const titles = (p) => p.$$eval(".tab-body .card .c-title", (e) => e.map((x) => x.textContent.trim()));
const wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true).catch(() => false);
const cardOf = (t) => `[...document.querySelectorAll(".card")].find((c) => /${t}/.test(c.textContent))`;

try {
  const a = await page("Akash");
  await a.click("[data-action=newTrip]");
  await a.fill("[name=name]", "Test trip");
  await a.fill("[name=destination]", "Rome");
  await a.fill("[name=numDays]", "3");
  await a.click("#modalForm button[value=ok]");
  await a.waitForSelector(".tab-body");
  await a.evaluate(async () => {
    const c = window.__tripCtx;
    const mk = (title, category) => ({ title, location: title + ", Rome", category, lat: 41.9, lng: 12.5 });
    await c.addPlaces([mk("Colosseum", "sight"), mk("Trattoria Verde", "food"), mk("Villa Borghese", "nature"), mk("Tourist Trap Pizza", "food")], { url: "https://example.com/x", source: "test", autoPlace: false });
    await c.S.store.txTrip(c.S.tripId, (cur) => ({ members: [...cur.members, "sam@demo"] }));
  });
  const s = await page("Sam");
  await s.waitForSelector("[data-action=open], .tab-body");
  if (await s.$("[data-action=open]")) await s.click("[data-action=open]");
  await s.waitForSelector(".tab-body");
  for (const p of [a, s]) await p.click(".tabs-bar [data-tab=ideas]");
  await a.waitForSelector(".card .rx-row");
  ok((await a.$$(".card .rx-row")).length === 4 && (await s.$$(".card .rx-row")).length === 4, "every card has the quiet reaction row on both phones");
  ok((await a.$$(".idea-chips")).length === 1, "filter chips show with 4 ideas");

  const card = (p, t) => p.locator(".card", { hasText: t });
  const vote = (p, t, v) => card(p, t).locator(`[data-action=vote][data-v=${v}]`).click();

  // votes sync live both ways
  await vote(a, "Colosseum", "love");
  ok(await wait(s, `(${cardOf("Colosseum")}).querySelector("[data-v=love] .rx-who")?.textContent === "A"`), "Sam sees Akash's ❤️ on Colosseum (initial A)");
  ok(!(await card(s, "Colosseum").locator(".rx-both").count()), "no badge while only one person loves it");
  await vote(s, "Colosseum", "love");
  ok(await wait(a, () => !!document.querySelector(".card .rx-both")) && (await card(a, "Colosseum").locator(".rx-both").textContent()) === "Both love it", "badge “Both love it” when both picked ❤️ (live on Akash's phone)");
  ok((await card(a, "Colosseum").locator("[data-v=love]").getAttribute("aria-pressed")) === "true", "my own choice is marked pressed");
  await vote(a, "Villa Borghese", "love");
  await vote(a, "Trattoria Verde", "like");
  await vote(s, "Tourist Trap Pizza", "no");
  await vote(a, "Trattoria Verde", "no");
  ok(await wait(a, `!(${cardOf("Trattoria")}).querySelector("[data-v=like] .rx-who") && !!(${cardOf("Trattoria")}).querySelector("[data-v=no] .rx-who")`), "choosing another reaction replaces mine (one choice per person)");
  await vote(a, "Trattoria Verde", "no");
  ok(await wait(a, `!(${cardOf("Trattoria")}).querySelector("[data-v=no] .rx-who")`), "tapping the same reaction again clears it");

  // sort and filter
  const order = await titles(a);
  ok(order[0] === "Colosseum" && order[order.length - 1] === "Tourist Trap Pizza", "sort: both-loved first, vetoed last: " + order.join(" | "));
  await a.evaluate(async () => { const c = window.__tripCtx; const it = c.S.items.find((i) => i.title === "Tourist Trap Pizza"); await c.S.store.batchUpdateItems(c.S.tripId, [[it.id, { addedAt: Date.now() + 5000 }]]); });
  await a.selectOption(".idea-sort", "new");
  const newest = await titles(a);
  ok(newest[0] === "Tourist Trap Pizza", "sort Newest first: " + newest.join(" | "));
  await a.selectOption(".idea-sort", "love");
  await a.click("[data-action=ideaFilter][data-id=love]");
  ok(JSON.stringify(await titles(a)) === JSON.stringify(["Colosseum"]), "chip “Both love” shows only both-loved");
  await a.click("[data-action=ideaFilter][data-id=food]");
  const food = await titles(a);
  ok(food.length === 2 && food.every((t) => /Trattoria|Pizza/.test(t)), "category chip filters to food");
  await a.click("[data-action=ideaFilter][data-id=all]");
  ok((await titles(a)).length === 4, "All chip resets");

  // comments
  await card(a, "Colosseum").locator("[data-action=cmtToggle]").click();
  ok(await card(a, "Colosseum").locator(".rx-thread").isVisible(), "💬 expands the thread inline");
  await card(a, "Colosseum").locator("input[data-cmt]").fill("Let's go at sunrise");
  await card(a, "Colosseum").locator("input[data-cmt]").press("Enter");
  ok(await wait(s, `(${cardOf("Colosseum")}).querySelector("[data-action=cmtToggle] .rx-who")?.textContent === "1"`), "Sam sees “💬 1” collapsed");
  ok(!(await card(s, "Colosseum").locator(".rx-thread").count()), "thread is collapsed by default");
  await card(s, "Colosseum").locator("[data-action=cmtToggle]").click();
  ok(/Let's go at sunrise/.test(await card(s, "Colosseum").locator(".rx-thread").textContent()), "Sam reads Akash's comment");
  ok(!(await card(s, "Colosseum").locator(".rx-del").count()), "no delete button on someone else's comment");
  await card(s, "Colosseum").locator("input[data-cmt]").fill("Yes! Book tickets");
  await card(s, "Colosseum").locator("[data-action=cmtAdd]").click();
  ok(await wait(a, () => /Yes! Book tickets/.test(document.body.textContent)), "Akash sees Sam's reply live (thread stays open)");
  await a.click(".tabs-bar [data-action=moreToggle]");
  await a.click(".more-sheet [data-tab=changes]");
  const act = await a.textContent(".tab-body");
  ok(/commented on “Colosseum”/.test(act) && !/voted|loved/.test(act), "comments appear in Activity, votes do not");
  await a.click(".tabs-bar [data-tab=ideas]");
  await card(a, "Colosseum").locator(".rx-del").click();
  ok(await wait(s, () => !/Let's go at sunrise/.test(document.body.textContent)), "deleting my own comment removes it for Sam too");
  ok(/Yes! Book tickets/.test(await s.textContent("body")), "other comment stays");

  // phone screenshot of the Ideas tab (collapsed comments)
  await card(s, "Colosseum").locator("[data-action=cmtToggle]").click();
  await s.evaluate(() => window.scrollTo(0, 0));
  await s.screenshot({ path: join(dir, "ideas-phone.png") });
  console.log("  screenshot:", join(dir, "ideas-phone.png"));
  await card(s, "Colosseum").locator("[data-action=cmtToggle]").click();
  await s.screenshot({ path: join(dir, "ideas-phone-collapsed.png") });
  console.log("  screenshot:", join(dir, "ideas-phone-collapsed.png"));

  /* ---- planning hooks (Akash's page): loved + vetoed */
  await a.evaluate(async () => {
    const c = window.__tripCtx;
    const veto = c.S.items.find((i) => i.title === "Tourist Trap Pizza").id;
    await c.S.store.setItemPath(c.S.tripId, veto, ["votes", "akash@demo"], "no");
  });
  const inp = await a.evaluate(() => { const c = window.__tripCtx; const { opts } = c.planInputs(c.S.trip); return { loved: opts.loved, vetoed: opts.vetoed, saved: opts.saved }; });
  ok(inp.loved.includes("Colosseum") && inp.loved.includes("Villa Borghese") && !inp.loved.includes("Tourist Trap Pizza"), "planInputs.loved: " + inp.loved.join(", "));
  ok(inp.loved[0] === "Colosseum", "loved: both-loved first");
  ok(inp.vetoed.length === 1 && inp.vetoed[0] === "Tourist Trap Pizza", "planInputs.vetoed: " + inp.vetoed.join(", "));
  ok(!inp.saved.includes("Tourist Trap Pizza") && inp.saved[0] === "Colosseum", "saved list skips vetoed and starts with loved");
  const prompt = await a.evaluate(async () => { const { planPrompt } = await import("./ai.js"); const c = window.__tripCtx; const { p, opts } = c.planInputs(c.S.trip); return planPrompt(c.S.trip, c.profileText(p), opts); });
  ok(/both marked these as loved[^\n]*Colosseum[^\n]*Villa Borghese/.test(prompt), "planPrompt names loved places");
  ok(/voted these down[^\n]*Tourist Trap Pizza/.test(prompt), "planPrompt names vetoed places");

  // finishDraft drops a vetoed name from a fake draft (geocode mocked), then accepting places loved ideas and skips the vetoed one
  const res = await a.evaluate(async () => {
    const c = window.__tripCtx;
    const day = (n, items) => ({ day: n, base: "Rome", theme: "x", items });
    const it = (name, category, time) => ({ name, category, time, durationMin: 60, address: name + ", Rome", approxCost: 10, why: "nice", veg: category === "food" ? "yes" : "", vegNote: "pasta" });
    const draft = { summary: "test", days: [day(1, [it("Pantheon", "sight", "10:00"), it("Tourist Trap Pizza", "food", "13:00"), it("Trastevere Walk", "sight", "16:00")]), day(2, [it("Trevi Fountain", "sight", "10:00")]), day(3, [it("Capitoline Museums", "sight", "10:00")])], stays: [] };
    await c.finishDraft(c.S.tripId, draft, "Gemini", { quiet: true });
    await new Promise((r) => setTimeout(r, 300));
    const pr = c.S.trip.proposal;
    return { names: pr.plan.filter((x) => x.listing).map((x) => x.listing.name), notes: pr.notes };
  });
  ok(res.names.includes("Pantheon") && !res.names.some((n) => /Tourist Trap/i.test(n)), "finishDraft: vetoed name dropped, others kept: " + res.names.join(", "));
  ok(res.notes.some((n) => /Tourist Trap Pizza/.test(n) && /👎/.test(n)), "finishDraft: note explains: " + res.notes.join(" / "));
  await a.click(".tabs-bar [data-tab=plan]");
  await a.evaluate(() => document.querySelector("[data-action=openProposal]")?.click());
  const opened = await a.waitForSelector("#modalForm button[value=ok]", { timeout: 3000 }).then(() => true).catch(() => false);
  if (opened) {
    await a.click("#modalForm button[value=ok]");
    await a.waitForTimeout(2500);
    const where = await a.evaluate(() => Object.fromEntries(window.__tripCtx.S.items.filter((i) => ["Colosseum", "Villa Borghese", "Tourist Trap Pizza"].includes(i.title)).map((i) => [i.title, !!i.dayId])));
    ok(where["Colosseum"] && where["Villa Borghese"], "accepting a plan places your loved ideas on days");
    ok(where["Tourist Trap Pizza"] === false, "the vetoed idea is not placed");
  } else ok(false, "proposal modal opened");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await b.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll social checks passed");
process.exit(fails ? 1 : 0);
