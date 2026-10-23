// Share to Trips: a Gemini answer shared as text becomes separate ideas in the chosen trip; links and screenshots keep working.
// Run: node tests/share.mjs   (copies the repo to a temp dir in demo mode; other hosts are mocked)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };

const ANSWER = `Here are some places you could visit in Goa:

*   **Anjuna Flea Market:** A Wednesday bazaar with clothes, spices and live music.
    *   Go in the afternoon, cash only.
*   **Fontainhas** - Colourful Latin Quarter streets in Panjim.
*   **Dudhsagar Waterfalls**: Four-tier waterfall, best after the monsoon.
1. **Cafe Bodega** - Quiet cafe with good veg sandwiches.
**Food:**
*   **Vinayak Family Restaurant:** Goan thali with plenty of vegetarian dishes.

Sources: https://example.com/goa-guide
Let me know if you'd like an itinerary!`;

console.log("parseSharedList");
const { parseSharedList, guessCategory } = await import(join(root, "share.js"));
const list = parseSharedList(ANSWER);
const names = list.map((x) => x.name);
ok(names.join("|") === "Anjuna Flea Market|Fontainhas|Dudhsagar Waterfalls|Cafe Bodega|Vinayak Family Restaurant", "five places, no intro, 'Food:' title or sources: " + names.join("|"));
ok(/cash only/.test(list[0].why) && /bazaar/.test(list[0].why), "a sub-bullet is added to the entry above, markdown stripped");
ok(list[1].why.startsWith("Colourful"), "dash separator splits name and reason");
ok(parseSharedList("Try the beach at 6am, it is lovely. Also a great cafe nearby.").length === 0, "plain prose is not a list");
ok(parseSharedList("### 1. Baga Beach\nBusy.\n### 2. Calangute\nLong.").map((x) => x.name).join() === "Baga Beach,Calangute", "numbered headings count");
ok([["Hotel Fontainhas", "stay"], ["Cafe Bodega", "food"], ["Anjuna Flea Market", "shopping"], ["Dudhsagar Waterfalls", "nature"], ["Basilica of Bom Jesus", "sight"]].every(([n, c]) => guessCategory(n) === c), "category guesses");

console.log("in the app");
const dir = mkdtempSync(join(tmpdir(), "tp-share-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8990 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const br = await chromium.launch();
const errors = [];
try {
  const c = await br.newContext({ viewport: { width: 420, height: 900 } });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.stack));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.request().url().includes("nominatim")
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "15.5", lon: "73.8" }]) })
    : r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.goto(URL0);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  const mk = async (name, dest) => {
    await p.click("[data-action=newTrip]");
    await p.fill("[name=name]", name); await p.fill("[name=destination]", dest); await p.fill("[name=numDays]", "3");
    await p.click("#modalForm button[value=ok]");
    await p.waitForSelector(".tab-body");
  };
  await mk("Rome trip", "Rome");
  await p.click("#homeBtn");
  await mk("Goa trip", "Goa");
  const q = (o) => "?" + new URLSearchParams({ shared: "1", ...o });

  // Several trips: it asks which one, with the open trip ticked.
  await p.goto(URL0 + q({ text: ANSWER, title: "Goa places" }));
  await p.waitForFunction(() => /Save this to which trip/.test(document.getElementById("modalForm").textContent), null, { timeout: 8000 });
  ok(/the text you shared/.test(await p.textContent("#modalForm")), "asks which trip for shared text");
  const labels = await p.$$eval("#modalForm .pick", (e) => e.map((x) => x.textContent.trim()));
  ok(labels.length === 2, "both trips are offered: " + labels.join(", "));
  await p.evaluate(() => { for (const l of document.querySelectorAll("#modalForm .pick")) if (/Rome/.test(l.textContent)) l.querySelector("input").checked = true; });
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /You shared a list/.test(document.getElementById("modalForm").textContent), null, { timeout: 8000 });
  ok((await p.$$("#modalForm input[name=shr]")).length === 5, "the list sheet shows 5 places");
  ok(await p.evaluate(() => /Rome trip/.test(document.getElementById("modalForm").textContent)), "…for the chosen trip");
  await p.uncheck('#modalForm input[name=shr][value="4"]');
  await p.click("[data-action=shareAdd]");
  await p.waitForFunction(() => window.__tripCtx.S.items.length >= 4, null, { timeout: 15000 });
  const s = await p.evaluate(() => ({ name: window.__tripCtx.S.trip.name, items: window.__tripCtx.S.items.map((i) => ({ t: i.title, d: i.dayId, c: i.category, v: i.via })) }));
  ok(s.name === "Rome trip" && s.items.length === 4, `4 ideas saved to the chosen trip (${s.items.map((i) => i.t).join(", ")})`);
  ok(s.items.every((i) => !i.d && i.v === "shared text"), "all stay in Ideas, none on a day");
  ok(s.items.find((i) => i.t === "Anjuna Flea Market")?.c === "shopping", "category guessed");
  ok(!/shared=1|text=/.test(p.url()), "the share is cleaned out of the address bar");

  // Shared again: already saved, nothing doubles.
  await p.goto(URL0 + q({ text: ANSWER }));
  await p.waitForFunction(() => /Save this to which trip/.test(document.getElementById("modalForm").textContent));
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /You shared a list/.test(document.getElementById("modalForm").textContent));
  await p.click("[data-action=shareAdd]");
  await p.waitForFunction(() => /already saved/.test(document.getElementById("toast").textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await p.evaluate(() => window.__tripCtx.S.items.length)) === 5, "re-sharing adds only the one place left unticked before");

  // Cancel drops the share.
  await p.goto(URL0 + q({ text: ANSWER }));
  await p.waitForFunction(() => /Save this to which trip/.test(document.getElementById("modalForm").textContent));
  await p.click("#modalForm [data-close]");
  await p.waitForTimeout(1800);
  ok(!(await p.evaluate(() => document.getElementById("modalForm").textContent.includes("You shared"))) && !(await p.evaluate(() => sessionStorage.getItem("tp-shared-text"))), "Cancel drops the share");

  // A plain link still goes through the old path (one trip chosen first).
  await p.evaluate(() => window.__tripCtx.S.store.updatePrivate(window.__tripCtx.S.me.email, { ai: null }));
  await p.goto(URL0 + q({ url: "https://example.com/post", title: "A post" }));
  await p.waitForFunction(() => /Save this to which trip/.test(document.getElementById("modalForm").textContent));
  ok(/example.com\/post/.test(await p.textContent("#modalForm")), "a link still asks which trip and names the link");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.url === "https://example.com/post"), null, { timeout: 15000 });
  ok(true, "the link is saved as an idea");

  // One trip: no question. A friend (no Gemini/Claude) sharing free text gets a note in Ideas.
  await p.evaluate(() => { window.__tripCtx.S.aiUser = false; });
  await p.evaluate(() => window.__tripCtx.shareText("We should really try the sunrise boat ride near the old fort\nand carry cash"));
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.category === "other" && /sunrise boat/.test(i.notes || "")), null, { timeout: 8000 });
  ok(true, "free text without a list becomes one note in Ideas for someone without AI");

  // iPhone hint.
  const ip = await (await br.newContext({ viewport: { width: 390, height: 800 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" })).newPage();
  await ip.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await ip.goto(URL0);
  await ip.fill("#demoName", "Akash");
  await ip.click("[data-action=signin]");
  await ip.waitForSelector(".ios-tip");
  ok(/paste it in the link box/.test(await ip.textContent(".ios-tip")), "iPhone tip says to copy and paste");
} catch (e) {
  fails++;
  console.log("  FAIL exception:", e.stack || e.message);
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await br.close();
srv.kill();
console.log(fails ? `\n${fails} failure(s)` : "\nAll share checks passed");
process.exit(fails ? 1 : 0);
