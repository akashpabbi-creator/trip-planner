// Day card DOM test + screenshots. Renders the card HTML (dumped by mcp-core with CARD_DUMP_DIR) in the local MCP Apps host,
// taps through stop panel, Move, Remove to Ideas, Undo, day chips and Expand, and screenshots it light/dark at phone and desktop.
// Run: CARD_DUMP_DIR=/tmp/cards node tests/mcp-core.mjs && node tests/mcp-day-card.mjs /tmp/cards [shotsDir]
import { readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { renderCard } from "./mcp-card-host.mjs";

const [dir = "/tmp/cards", shots] = process.argv.slice(2);
const html = readFileSync(join(dir, "day.html"), "utf8");
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };

const stop = (id, title, o = {}) => ({ id, title, category: "sight", estStart: "09:00", durationMin: 60, ...o });
const day1 = { day: 1, date: "2027-02-01", title: "Fort Kochi", stayingIn: "Fort Kochi", schedule: [
  stop("a", "Chinese fishing nets", { location: "Fort Kochi beach", mustDo: true, directions: "https://www.google.com/maps/dir/?api=1&destination=9.96%2C76.24", notes: "Best at sunrise" }),
  stop("b", "Kashi Art Cafe", { category: "food", estStart: "10:30", veg: "yes", vegNote: "Veg thali and salads", location: "Burgher Street", travelToHere: { mode: "walk", minutes: 8 } }),
  stop("c", "Dutch Palace", { estStart: "12:00", durationMin: 90, travelToHere: { mode: "walk", minutes: 12 } }),
  stop("d", "Rest & recharge", { category: "other", estStart: "14:00", durationMin: 90, rest: true }),
  stop("e", "Sea View Restaurant", { category: "food", estStart: "18:30", location: "Fort Kochi", travelToHere: { mode: "car", minutes: 15 } }),
] };
const mk = (d, extra = {}) => ({ mode: "day", tripId: "T5", trip: "Kochi", destination: "Kochi", nDays: 3, ...d,
  days: [{ day: 1, stops: 5 }, { day: 2, stops: 1 }, { day: 3, stops: 0 }], ideasCount: 2, warnings: [], appUrl: "https://example.test/#trip=T5&tab=plan&day=" + d.day, ...extra });
const data = mk(day1, { warnings: ["Day 1 is full: 3 sights is plenty on a hot day."] });
const day2 = { day: 2, date: "2027-02-02", schedule: [stop("f", "Jew Town", { category: "shopping" })] };
const moved = mk({ ...day1, schedule: day1.schedule.filter((s) => s.id !== "c") }, { receipt: "Moved “Dutch Palace” to day 2.", undoWith: { tool: "undo_change", entry: "E1" } });
const all = mk(day1, { all: [day1, day2, { day: 3, schedule: [] }] });
const tools = {
  day_card_move: { content: [{ type: "text", text: "{}" }], structuredContent: moved },
  day_card: { content: [{ type: "text", text: "{}" }], structuredContent: mk(day2) },
  undo_change: { content: [{ type: "text", text: "{}" }] },
};
const text = async (f) => (await f.locator("#root").innerText());

{
  const r = await renderCard({ html, data, tools });
  const f = r.frame;
  ok((await f.locator(".dc-stop").count()) === 5 && (await text(f)).includes("Day 1"), "renders the day's five stops");
  ok((await text(f)).includes("Check veg") && (await text(f)).includes("Veg ok") && (await text(f)).includes("Must do") && (await text(f)).includes("8 min walk"), "veg badges, must-do and travel lines show");
  ok((await f.locator(".t-warn").count()) === 1, "the day's warning shows in orange");
  await f.locator('.dc-row >> nth=0').click();
  ok((await f.locator(".dc-panel").count()) === 1 && (await f.locator(".dc-panel").innerText()).includes("Best at sunrise"), "tapping a stop opens its panel");
  await f.getByRole("button", { name: "Directions" }).click();
  await r.page.waitForTimeout(150);
  ok((await r.opened()).some((u) => u.includes("maps/dir")), "Directions opens the link through the host");
  await f.locator('.dc-row >> nth=2').click();
  await f.getByRole("button", { name: "Move to day 2" }).click();
  await f.locator(".t-undo").waitFor();
  ok(r.calls.some((c) => c.name === "day_card_move" && c.args.item === "c" && c.args.day === 2 && c.args.view === 1) && (await f.locator(".dc-stop").count()) === 4, "Move to day 2 calls the helper and redraws without that stop");
  ok((await f.locator(".t-undo").innerText()).includes("Dutch Palace"), "an Undo bar names the change");
  await f.getByRole("button", { name: "Undo" }).click();
  await r.page.waitForFunction(() => true);
  await r.page.waitForTimeout(300);
  ok(r.calls.some((c) => c.name === "undo_change" && c.args.entry === "E1" && c.args.trip === "T5") && r.calls.some((c) => c.name === "day_card"), "Undo calls undo_change then reloads the day");
  await f.getByRole("button", { name: "Day 2" }).first().click();
  await r.page.waitForTimeout(300);
  ok((await text(f)).includes("Jew Town"), "a day chip loads that day");
  await f.getByRole("button", { name: "Open in app" }).click();
  await r.page.waitForTimeout(150);
  ok((await r.opened()).some((u) => u.includes("tab=plan")), "Open in app goes through the host");
  await r.close();
}
{
  const r = await renderCard({ html, data: all, tools: { day_card: { content: [{ type: "text", text: "{}" }], structuredContent: all } } });
  await r.frame.getByRole("button", { name: "Expand" }).click();
  await r.page.waitForTimeout(400);
  ok((await r.frame.locator(".dc-day").count()) === 3 && (await text(r.frame)).includes("Jew Town") && (await text(r.frame)).includes("Collapse"), "Expand shows every day, stacked");
  await r.close();
}
if (shots) {
  mkdirSync(shots, { recursive: true });
  const open = async (r) => { await r.frame.locator('.dc-row >> nth=2').click(); await r.page.waitForTimeout(250); };
  for (const [label, width, dark] of [["phone-light", 360, false], ["phone-dark", 360, true], ["desktop-light", 900, false], ["desktop-dark", 900, true]]) {
    const r = await renderCard({ html, data, width, dark, tools });
    await open(r);
    await r.page.locator("#f").screenshot({ path: join(shots, `day-card-${label}.png`) });
    await r.close();
  }
  const r = await renderCard({ html, data: all, width: 360, tools: { day_card: { content: [{ type: "text", text: "{}" }], structuredContent: all } } });
  await r.frame.getByRole("button", { name: "Expand" }).click();
  await r.page.waitForTimeout(400);
  await r.page.locator("#f").screenshot({ path: join(shots, "day-card-expanded-phone-light.png") });
  await r.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
