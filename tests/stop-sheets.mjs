// Stop sheet and travel sheet (redesign job 4): quiet stop rows open a sheet that keeps every card action,
// the travel line opens the travel sheet, press-and-drag reorders, moves and deletes show an Undo bar.
// Run: node tests/stop-sheets.mjs   (demo mode in a temp copy)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-stops-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8990 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(`http://127.0.0.1:${PORT}/?today=2026-11-10`);
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", "Sheets");
  await p.fill("[name=destination]", "Goa");
  await p.fill("[name=startDate]", "2026-11-10");
  await p.fill("[name=numDays]", "2");
  await p.click("#modalForm button[value=ok]");
  await p.waitForSelector(".tab-body");
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S;
    const mk = (o) => S.store.addItem(S.tripId, { category: "sight", dayId: null, order: 1, time: "", durationMin: 60, cost: 0, addedBy: S.me.email, addedAt: Date.now(), lat: null, lng: null, ...o });
    const d0 = S.trip.days[0].id;
    await mk({ title: "Fort Aguada", dayId: d0, order: 1, lat: 15.49, lng: 73.77, location: "Fort Aguada, Goa" });
    await mk({ title: "Beach Shack", category: "food", veg: "yes", dayId: d0, order: 2, location: "Baga Beach", travel: { mode: "walk", minutes: 15, cost: 0, notes: "along the sand" } });
    await mk({ title: "Spice Farm", dayId: d0, order: 3 });
    await mk({ title: "Waiting idea" });
  });
  await p.waitForTimeout(400);
  const titles = () => p.$$eval(".day .tl > .stop .c-title", (e) => e.map((x) => x.textContent.trim()));
  const order = () => p.evaluate(() => { const c = window.__tripCtx; return c.dayItems(c.S.trip.days[0].id).map((i) => i.title).join(); });

  console.log("quiet rows");
  ok((await titles()).join() === "Fort Aguada,Beach Shack,Spice Farm", "three stop rows on Day 1: " + (await titles()).join());
  ok((await p.$$(".day .stop-row [data-action=up], .day .stop-row .dir-link, .day .stop-row .rx-row")).length === 0, "the row itself has no buttons (they live in the sheet)");
  ok((await p.$$(".day .stop-row")).length === 3 && !(await p.$(".ssheet")), "no sheet until a stop is tapped");

  console.log("stop sheet keeps every action");
  await p.click(".stop-row:has-text('Beach Shack')");
  await p.waitForSelector(".ssheet");
  const have = async (sel) => !!(await p.$(`.ssheet ${sel}`));
  ok(await have(".c-title"), "the sheet shows the stop");
  ok((await p.$$(".ssheet [data-action=vote]")).length === 3, "three reactions");
  ok(await have("[data-action=cmtToggle]"), "comments");
  ok(await have(".dir-link"), "Directions");
  ok(await have("[data-action=up]") && await have("[data-action=down]"), "move earlier and later");
  ok(await have("[data-action=editItem]"), "edit");
  ok(await have("[data-action=schedule]") && await have("[data-action=backToIdeas]") && await have("[data-action=stopDelete]"), "move to another day, back to Ideas, delete");
  await p.click(".ssheet [data-action=vote][data-v=love]");
  ok(await p.evaluate(() => { const S = window.__tripCtx.S; return Object.values(S.items.find((i) => i.title === "Beach Shack").votes || {}).includes("love"); }), "a reaction saves from the sheet and the sheet stays open");
  ok(!!(await p.$(".ssheet")), "sheet still open after a re-render");
  await p.click(".ssheet [data-action=cmtToggle]");
  await p.fill(".ssheet input[data-cmt]", "Try the thali");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => (window.__tripCtx.S.items.find((i) => i.title === "Beach Shack").comments || []).length === 1);
  ok(true, "a comment posts from the sheet");

  console.log("move, with Undo");
  await p.click(".ssheet [data-action=up]");
  await p.waitForFunction(() => document.querySelector(".stop-undo:not([hidden])"));
  ok((await order()) === "Beach Shack,Fort Aguada,Spice Farm", "Move earlier from the sheet: " + await order());
  ok(/Moved/.test(await p.textContent(".stop-undo")), "an Undo bar appears");
  await p.click(".stop-undo button");
  await p.waitForFunction(() => document.querySelector(".stop-undo[hidden]"));
  await p.waitForTimeout(300);
  ok((await order()) === "Fort Aguada,Beach Shack,Spice Farm", "Undo puts it back: " + await order());
  await p.keyboard.press("Escape");
  ok(!(await p.$(".ssheet")), "Escape closes the sheet");

  console.log("back to Ideas, with Undo");
  await p.click(".stop-row:has-text('Spice Farm')");
  await p.click(".ssheet [data-action=backToIdeas]");
  await p.waitForFunction(() => document.querySelector(".stop-undo:not([hidden])"));
  ok(!(await p.$(".ssheet")) && (await titles()).join() === "Fort Aguada,Beach Shack", "the stop leaves the day and the sheet closes");
  await p.click(".stop-undo button");
  await p.waitForFunction(() => document.querySelectorAll(".day .stop").length === 3);
  ok((await order()) === "Fort Aguada,Beach Shack,Spice Farm", "Undo returns it to its day and place");

  console.log("delete, with Undo");
  await p.click(".stop-row:has-text('Spice Farm')");
  await p.click(".ssheet [data-action=stopDelete]");
  await p.waitForFunction(() => document.querySelector(".stop-undo:not([hidden])"));
  ok(!(await p.evaluate(() => window.__tripCtx.S.items.some((i) => i.title === "Spice Farm"))), "deleted");
  await p.click(".stop-undo button");
  await p.waitForFunction(() => window.__tripCtx.S.items.some((i) => i.title === "Spice Farm" && i.dayId));
  ok((await order()) === "Fort Aguada,Beach Shack,Spice Farm", "Undo brings the stop back: " + await order());

  console.log("edit from the sheet");
  await p.click(".stop-row:has-text('Fort Aguada')");
  await p.click(".ssheet [data-action=editItem]");
  await p.waitForSelector("#modalForm [name=title]");
  await p.fill("#modalForm [name=title]", "Aguada Fort");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => document.querySelector(".ssheet .c-title")?.textContent.includes("Aguada Fort"));
  ok(true, "editing keeps the sheet open and shows the new name");
  await p.click(".ss-x");

  console.log("travel sheet");
  ok(/Walk/.test(await p.textContent(".leg-btn[data-action=openLeg]")), "the leg line still shows mode and time");
  await p.click(".leg-btn[data-action=openLeg]");
  await p.waitForSelector(".ssheet.ss-leg");
  const leg = await p.textContent(".ssheet.ss-leg");
  ok(/15 min|15m/.test(leg) && /along the sand/.test(leg), "travel sheet shows time and notes: " + leg.replace(/\s+/g, " ").slice(0, 120));
  ok(/google\.com\/maps\/dir/.test(await p.getAttribute(".ssheet .ss-dir", "href")), "Directions link");
  await p.click(".ssheet [data-action=editLeg]");
  await p.waitForSelector("#modalForm [name=minutes]");
  await p.fill("#modalForm [name=minutes]", "25");
  await p.click("#modalForm button[value=ok]");
  await p.waitForFunction(() => /25/.test(document.querySelector(".ssheet.ss-leg")?.textContent || ""));
  ok(true, "Edit travel saves and the sheet updates");
  await p.click(".ssheet-back", { position: { x: 5, y: 5 } });
  ok(!(await p.$(".ssheet")), "tapping outside closes the sheet");

  console.log("phone Back button closes the sheet");
  await p.click(".stop-row:has-text('Beach Shack')");
  await p.waitForSelector(".ssheet");
  await p.goBack();
  await p.waitForFunction(() => !document.querySelector(".ssheet"));
  ok(!!(await p.$(".day")), "Back closed the sheet and stayed in the trip");

  console.log("press and drag");
  const box = async (t) => (await p.locator(`.stop:has-text('${t}')`).boundingBox());
  const a = await box("Aguada Fort"), c = await box("Spice Farm");
  await p.evaluate(() => { window.__d = true; });
  const dragPointer = async (from, to) => {
    // pointer events with a hold, as a finger or mouse would send
    await p.evaluate(async ([fy, ty, x]) => {
      const el = document.elementFromPoint(x, fy);
      const fire = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, button: 0 }));
      fire("pointerdown", fy);
      await new Promise((r) => setTimeout(r, 600));
      for (let k = 1; k <= 10; k++) { document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: fy + (ty - fy) * k / 10 })); await new Promise((r) => setTimeout(r, 16)); }
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: ty }));
    }, [from, to, 150]);
  };
  await dragPointer(a.y + a.height / 2, c.y + c.height / 2 + 10);
  await p.waitForFunction(() => document.querySelector(".stop-undo:not([hidden])"));
  ok((await order()) === "Beach Shack,Spice Farm,Aguada Fort", "holding the first stop and dragging it to the end reorders: " + await order());
  ok(!(await p.$(".ssheet")), "the drag did not open the sheet");
  await p.click(".stop-undo button");
  await p.waitForFunction(() => document.querySelector(".stop-undo[hidden]"));
  await p.waitForTimeout(300);
  ok((await order()) === "Aguada Fort,Beach Shack,Spice Farm", "Undo restores the order: " + await order());

  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scrolling on a phone");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  fails++;
  console.log("  FAIL " + (e.stack || e.message));
} finally {
  await b.close();
  srv.kill();
}
console.log(fails ? `\n${fails} stop-sheets check(s) failed` : "\nAll stop-sheets checks passed");
process.exit(fails ? 1 : 0);
