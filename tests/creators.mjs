// Trip creators in demo mode: non-creators see no New trip / Duplicate and a calm empty state; admins manage the list.
// Run: node tests/creators.mjs   (copies the repo to a temp dir in demo mode and serves it itself)
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tp-creators-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git"`);
writeFileSync(join(dir, "config.js"), "window.FIREBASE_CONFIG = null;\n");
const PORT = 9100 + Math.floor(Math.random() * 90);
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL0 = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
import { freezeClock } from "./_clock.mjs";
const b = freezeClock(await chromium.launch());
const errors = [];
async function page(bc, name, path = "", viewport = { width: 390, height: 800 }, scheme = "light") {
  const p = await bc.newPage({ colorScheme: scheme });
  await p.setViewportSize(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 404, body: "" }));
  await p.goto(URL0 + path);
  await p.fill("#demoName", name);
  await p.click("[data-action=signin]");
  await p.waitForSelector(".home");
  return p;
}
try {
  console.log("non-creator");
  const bc = await b.newContext();
  const n = await page(bc, "Xena", "?nocreate&noai");
  await n.waitForFunction(() => window.__tripCtx.S.creator === false);
  ok(await n.isHidden("[data-action=newTrip]"), "no New trip button");
  ok(/private app.*invite link/i.test(await n.innerText(".home")), "calm empty state asks for an invite link");
  ok(await n.evaluate(() => window.__tripCtx.S.aiUser === false), "not an admin");
  if (SHOTS) await n.screenshot({ path: `${SHOTS}/home-non-creator-phone-light.png` });
  const nd = await page(await b.newContext(), "Xena", "?nocreate&noai", { width: 390, height: 800 }, "dark");
  if (SHOTS) await nd.screenshot({ path: `${SHOTS}/home-non-creator-phone-dark.png` });
  await n.evaluate(() => window.__tripCtx.S.store.createTrip({ name: "Shared", destination: "Goa", days: [{ id: "d1", title: "", base: "", notes: "" }], extras: [], owner: "someone@demo", members: [window.__tripCtx.S.me.email], memberNames: {}, createdAt: 1 }));
  await n.waitForSelector(".trip-card");
  ok(await n.isVisible(".trip-card") && await n.isHidden("[data-action=newTrip]"), "a trip they were invited to shows; still no New trip");
  await n.click("[data-action=tripMenu]");
  const menu = await n.innerText("#modalForm");
  ok(/Rename/.test(menu) && !/Duplicate/.test(menu), "trip menu has no Duplicate");
  await n.keyboard.press("Escape");

  console.log("creator and admin");
  const c = await page(await b.newContext(), "Fran", "?noai");
  ok(await c.isVisible("[data-action=newTrip]"), "a creator sees New trip");
  const a = await page(await b.newContext(), "Akash");
  ok(await a.isVisible("[data-action=newTrip]"), "an admin sees New trip");
  await a.click("[data-action=newTrip]");
  await a.fill("[name=name]", "Hub trip"); await a.fill("[name=destination]", "Goa");
  await a.click("#modalForm button[value=ok]");
  await a.waitForSelector(".tab-body");
  await a.evaluate(() => document.querySelector("[data-action=tab][data-tab=trip]")?.click());
  await a.waitForSelector("[data-action=creators]");
  await a.click("[data-action=creators]");
  await a.waitForSelector("[data-creators] li");
  ok(/akash/i.test(await a.innerText("[data-creators]")) || /you/i.test(await a.innerText("[data-creators]")), "admin's own entry is on the list (bootstrap)");
  await a.fill("[data-cr-email]", "Wife@Example.com");
  await a.click("[data-cr-add]");
  await a.waitForFunction(() => /wife@example.com/.test(document.querySelector("[data-creators]").innerText));
  ok(true, "adds an email (lower-cased)");
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/creators-list-phone-light.png` });
  await a.click("[data-rm='wife@example.com']");
  await a.waitForFunction(() => !/wife@example.com/.test(document.querySelector("[data-creators]").innerText));
  ok(true, "removes an email");
  await a.fill("[data-cr-email]", "nope");
  await a.click("[data-cr-add]");
  ok(!/nope/.test(await a.innerText("[data-creators]")), "a bad address is not added");

  const nonAdmin = await page(await b.newContext(), "Fran", "?noai");
  ok(await nonAdmin.evaluate(() => !window.__tripCtx.S.aiUser) && await nonAdmin.locator("[data-action=creators]").count() === 0, "non-admins have no creators row");
} finally {
  await b.close();
  srv.kill();
}
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(fails ? `\n${fails} failure(s)` : "\nAll creators UI checks passed");
process.exit(fails ? 1 : 0);
