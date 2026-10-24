// Long-press menu on trip cards (phone-sized screen, demo mode): every option, Undo on Delete, owner vs friend.
// Run: node tests/home-menu.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-homemenu-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 8800 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const b = await chromium.launch();
const errors = [];
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: false })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
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
  // Stops: two on days, one idea, so Clear and Duplicate have something to work on.
  await p.evaluate(async () => {
    const c = window.__tripCtx, S = c.S, d = S.trip.days;
    const mk = (data) => S.store.addItem(S.tripId, { description: "", image: "", siteName: "", url: "", time: "", cost: 0, mustDo: false, notes: "", durationMin: 60, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), dayId: null, order: 0, location: "Rome", lat: 41.9, lng: 12.5, ...c.stampMe(), ...data });
    for (const x of S.items) await S.store.deleteItem(S.tripId, x.id);
    await mk({ title: "Colosseum", category: "sight", dayId: d[0].id, order: 1 });
    await mk({ title: "Pantheon", category: "sight", dayId: d[1].id, order: 1 });
    await mk({ title: "Spare idea", category: "sight" });
  });
  await p.waitForTimeout(300);
  // A trip owned by someone else, with Akash as a member, to see Leave instead of Delete.
  await p.evaluate(async () => {
    const S = window.__tripCtx.S;
    await S.store.createTrip({ name: "Goa", destination: "Goa", startDate: "", budget: 0, currency: "INR", days: [{ id: "g1", title: "", base: "", notes: "" }], extras: [], owner: "sanj@demo", members: ["sanj@demo", S.me.email], memberNames: { "sanj@demo": "Sanj", [S.me.email]: S.me.name }, createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000 });
  });
  await p.click("[data-action=home]");
  await p.waitForSelector(".trip-wrap");
  const names = () => p.$$eval(".trip-wrap .tc-title", (e) => e.map((x) => x.textContent.replace("📌", "").trim()));
  const hold = async (name, ms = 650) => {
    const box = await p.locator(".trip-wrap", { hasText: name }).first().locator(".trip-card").boundingBox();
    await p.mouse.move(box.x + 40, box.y + 40);
    await p.mouse.down();
    await p.waitForTimeout(ms);
    await p.mouse.up();
  };
  const menuItems = () => p.$$eval("#modalForm [data-hm]", (e) => e.map((x) => x.lastChild.textContent.trim()));
  const clickItem = (k) => p.click(`#modalForm [data-hm=${k}]`);
  const closeMenu = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(100); };

  console.log("long press");
  ok((await names())[0] === "Rome", "Rome is first (newest)");
  await hold("Rome", 150);
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.getElementById("modal").open) && await p.locator(".tab-body").count() === 1, "a short press just opens the trip");
  await p.click("[data-action=home]");
  await p.waitForSelector(".trip-wrap");
  await hold("Rome");
  await p.waitForSelector("#modalForm [data-hm]");
  const owner = await menuItems();
  ok(JSON.stringify(owner) === JSON.stringify(["Rename", "Change cover", "Invite", "Pin to top", "Duplicate", "Clear all days", "Delete trip"]), "owner menu: " + owner.join(", "));
  ok(!owner.includes("Open"), "no Open item");
  ok(await p.locator(".tab-body").count() === 0, "a long press does not also open the trip");
  await closeMenu();

  console.log("friend sees Leave, not Delete");
  await hold("Goa");
  await p.waitForSelector("#modalForm [data-hm]");
  const friend = await menuItems();
  ok(friend.includes("Leave trip") && !friend.includes("Delete trip"), "Goa menu: " + friend.join(", "));
  await closeMenu();

  console.log("right-click and more button");
  await p.locator(".trip-wrap", { hasText: "Rome" }).click({ button: "right" });
  await p.waitForSelector("#modalForm [data-hm]");
  ok((await menuItems()).length === 7, "right-click opens the menu");
  await closeMenu();
  await p.locator(".trip-wrap", { hasText: "Rome" }).locator(".tc-more").click({ force: true });
  await p.waitForSelector("#modalForm [data-hm]");
  ok((await menuItems()).length === 7, "the ⋯ button opens the menu");

  console.log("pin");
  await closeMenu();
  await hold("Goa");
  await clickItem("pin");
  await p.waitForTimeout(400);
  ok((await names())[0] === "Goa", "pinned Goa moves to the top: " + (await names()).join(", "));
  ok(await p.locator(".tc-pin").count() === 1, "pin badge shown");
  await hold("Goa");
  ok((await p.textContent("#modalForm [data-hm=pin]")).includes("Unpin"), "menu now offers Unpin");
  await clickItem("pin");
  await p.waitForTimeout(400);
  ok((await names())[0] === "Rome", "unpinned: back to newest first");

  console.log("rename");
  await hold("Rome");
  await clickItem("rename");
  await p.fill("#modalForm [name=name]", "Rome in autumn");
  await p.click("#modalForm button[value=ok]");
  await p.waitForTimeout(300);
  ok((await names()).includes("Rome in autumn"), "renamed on the card");

  console.log("change cover");
  await hold("Rome in autumn");
  await clickItem("cover");
  await p.fill("#modalForm [name=coverUrl]", "https://example.com/rome.jpg");
  await p.click("#modalForm button[value=ok]");
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__tripCtx.S.trips.find((t) => t.name === "Rome in autumn").coverUrl) === "https://example.com/rome.jpg", "cover link saved on the trip");

  console.log("duplicate");
  await hold("Rome in autumn");
  await clickItem("duplicate");
  await p.waitForSelector(".trip-wrap:has-text('Rome in autumn (copy)')");
  const dup = await p.evaluate(async () => {
    const S = window.__tripCtx.S, t = S.trips.find((x) => x.name === "Rome in autumn (copy)");
    const items = await new Promise((res) => { const un = S.store.watchItems(t.id, (i) => { res(i); queueMicrotask(() => un()); }); });
    return { days: t.days.length, items: items.length, members: t.members, owner: t.owner === S.me.email, join: !!t.join };
  });
  ok(dup.days === 3 && dup.items === 3 && dup.members.length === 1 && dup.owner && !dup.join, "copy has days and stops, only me on it: " + JSON.stringify(dup));

  console.log("invite");
  await hold("Rome in autumn", 650);
  await clickItem("invite");
  await p.waitForSelector("#modalForm .members");
  ok(await p.locator(".tab-body").count() === 1, "invite sheet opened over the trip");
  await closeMenu();
  await p.click("[data-action=home]");
  await p.waitForSelector(".trip-wrap");

  console.log("clear all days");
  await hold("Rome in autumn");
  await clickItem("clear");
  await p.waitForFunction(() => window.__tripCtx.S.items.every((i) => !i.dayId) && window.__tripCtx.S.items.length === 3, null, { timeout: 5000 });
  ok(true, "stops went back to Ideas");
  await p.click("#toast button.link");
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => window.__tripCtx.S.items.filter((i) => i.dayId).length) === 2, "Undo puts them back");
  await p.click("[data-action=home]");
  await p.waitForSelector(".trip-wrap");

  console.log("delete with undo");
  await hold("Rome in autumn (copy)");
  await clickItem("delete");
  await p.waitForTimeout(200);
  ok(!(await names()).includes("Rome in autumn (copy)"), "trip disappears at once");
  await p.click("#toast button.link");
  await p.waitForTimeout(300);
  ok((await names()).includes("Rome in autumn (copy)"), "Undo brings it back");
  await p.waitForTimeout(8500);
  ok((await names()).includes("Rome in autumn (copy)"), "and it is still there after 8 seconds");
  await hold("Rome in autumn (copy)");
  await clickItem("delete");
  await p.waitForTimeout(8600);
  ok(await p.evaluate(() => !window.__tripCtx.S.trips.some((t) => t.name === "Rome in autumn (copy)")), "without Undo the trip is deleted after 8 seconds");

  console.log("leave");
  await hold("Goa");
  await clickItem("leave");
  await p.waitForTimeout(500);
  ok(!(await names()).includes("Goa"), "Goa is gone from my list after leaving");
  ok(await p.evaluate(() => !window.__tripCtx.S.trips.some((t) => t.name === "Goa")), "I am no longer a member");
} finally {
  await b.close();
  srv.kill();
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
