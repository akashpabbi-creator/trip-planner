// Renders the Ideas card in the local MCP Apps host (mcp-card-host.mjs) and drives its buttons. No Worker or emulator needed:
// it builds the card HTML from mcp/src (wrangler bundles the .css/.txt imports, so run `node tests/mcp-core.mjs` with CARD_DUMP_DIR to get ideas.html).
// Usage: node tests/mcp-ideas-card.mjs <ideas.html> [shotsDir]
import { readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { renderCard } from "./mcp-card-host.mjs";

const [htmlPath, shots] = process.argv.slice(2);
const html = readFileSync(htmlPath, "utf8");
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const days = [{ n: 1, date: "2026-12-20", title: "Old town" }, { n: 2, date: "2026-12-21", title: "Beaches" }, { n: 3, date: "2026-12-22", title: "" }];
const idea = (id, title, o = {}) => ({ id, title, category: "sight", location: "Panjim", tips: [], day: 0, ...o });
const data = {
  tripId: "T1", trip: "Goa", appUrl: "https://example.test/trip-planner/#trip=T1&tab=ideas", days, ideasTotal: 5, heading: "Ideas",
  ideas: [
    idea("a", "Fontainhas Latin Quarter walk", { location: "Fontainhas, Panjim", tips: ["go before 9am, it gets hot"], mustDo: true }),
    idea("b", "Ritz Classic thali", { category: "food", veg: "yes", vegNote: "full thali", tips: ["book 2 days ahead"] }),
    idea("c", "Fisherman's Wharf", { category: "food", veg: "unknown", location: "Betim" }),
    idea("d", "Spice farm tour", { category: "activity", location: "Ponda", tips: ["closed Mondays"] }),
    idea("e", "Beach shack stay", { category: "stay", location: "Palolem" }),
  ],
};
const moved = { ...data, ideas: data.ideas.filter((x) => x.id !== "d"), ideasTotal: 4, receipt: { text: "Added “Spice farm tour” to day 2 (Beaches).", warnings: ["Day 2: no rest block."] }, undoWith: { tool: "undo_change", entry: "E1" } };
const tools = { ideas_add_to_day: { content: [{ type: "text", text: "{}" }], structuredContent: moved }, ideas_refresh: { content: [{ type: "text", text: "{}" }], structuredContent: data } };

if (shots) mkdirSync(shots, { recursive: true });
for (const [label, width, dark] of [["phone-light", 360, false], ["phone-dark", 360, true], ["desktop-light", 900, false], ["desktop-dark", 900, true]]) {
  const r = await renderCard({ html, data, width, dark, tools });
  const f = r.frame;
  if (label === "phone-light") {
    ok(await f.locator(".id-card").count() === 5, "one card per idea");
    ok(await f.locator(".id-card button").count() === 5 && (await f.locator(".id-card button").first().innerText()).includes("Add to day"), "each card has exactly one button, Add to day");
    ok((await f.locator(".t-badge.check").allInnerTexts()).join().includes("Veg unchecked") && (await f.locator(".t-badge.good").allInnerTexts()).join().includes("Veg options"), "veg flags: unchecked in orange, options in green");
    ok((await f.locator(".id-tip").allInnerTexts()).join().includes("book 2 days ahead"), "the booking tip shows on the card");
    ok(await f.locator("svg.i").count() > 5 && !/[\u{1F300}-\u{1FAFF}]/u.test(await f.locator("#root").innerText()), "line icons, no emoji");
    await f.locator('[data-toggle="d"]').click();
    ok(await f.locator('[data-pick="d"]').count() === 3, "Add to day opens one chip per day");
    if (shots) await r.page.locator("#f").screenshot({ path: join(shots, "ideas-days-phone-light.png") });
    await f.locator('[data-pick="d"][data-day="2"]').click();
    await f.locator(".t-undo").waitFor();
    ok(r.calls.some((c) => c.name === "ideas_add_to_day" && c.args.item === "d" && c.args.day === 2 && c.args.trip === "T1"), "tapping a day calls ideas_add_to_day with the idea and day");
    ok(await f.locator(".id-card").count() === 4 && (await f.locator(".id-receipt").innerText()).includes("Spice farm"), "the card redraws without that idea and shows the receipt");
    ok((await f.locator(".t-warn").innerText()).includes("rest block"), "warnings from the change show in amber");
    await f.locator('[data-act="undo"]').click();
    await f.locator(".id-card").nth(4).waitFor();
    ok(r.calls.some((c) => c.name === "undo_change" && c.args.entry === "E1") && r.calls.some((c) => c.name === "ideas_refresh"), "Undo reverses it and the card shows the idea in Ideas again");
    await f.locator(".t-link").click();
    await r.page.waitForFunction(() => (window.__opened || []).length > 0);
    ok((await r.opened())[0] === data.appUrl, "Open in app goes to the Ideas tab");
  }
  if (shots) {
    await r.page.reload(); // fresh state for the screenshot
    await r.close();
    const s = await renderCard({ html, data, width, dark, tools });
    await s.page.locator("#f").screenshot({ path: join(shots, `ideas-${label}.png`) });
    await s.close();
  } else await r.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
