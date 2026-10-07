// Runs the travel guide reader, the sample planner and the link reader against the real sites
// (Wikivoyage, Wikipedia, Wikidata, a real blog) and checks the results. Run: node tests/real-data.mjs
import { loadDestination, fetchPlace, fetchOpenverse, goodCover, loadCovers, themesFor } from "../discover.js";
import { buildSample, profileOf } from "../profile.js";
import { unfurl } from "../unfurl.js";
import { readLink } from "../linkinfo.js";

// Wikimedia asks scripts to identify themselves; browsers send their own headers.
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (u, o = {}) => {
  calls++;
  const r = await realFetch(u, { ...o, headers: { "User-Agent": "trip-planner-tests/1.0 (github.com/akashpabbi-creator/trip-planner)", ...(o.headers || {}) } });
  if (!r.ok) console.log(`  ⚠️ HTTP ${r.status} ${r.headers.get("retry-after") ? "retry-after " + r.headers.get("retry-after") + " " : ""}${String(u).slice(0, 140)}`);
  return r;
};

const TRANSPORT = /\b(airport|aeroporto|airlines?|airways|wizz|ryanair|easyjet|indigo|terminal|railway|train station|stazione|termini|bus station|bus stand|metro station|ferry|car rental|car hire|taxi|shinkansen)\b/i;
const CASES = [
  { destination: "Italy", days: 7, expect: [/colosseum|colosseo/i, /vatican/i], cities: 2 },
  { destination: "Rome", days: 3, expect: [/colosseum|colosseo/i, /vatican|st\.? peter/i] },
  { destination: "Goa", days: 4, expect: [/beach/i] },
  { destination: "Kyoto", days: 4, expect: [/kiyomizu|fushimi|kinkaku|ginkaku/i] },
];
const LINKS = [{ url: "https://luggageandlife.com/where-to-eat-in-rome/", trip: { destination: "Rome", currency: "EUR" }, min: 3 }];

let fails = 0;
const fail = (msg) => { fails++; console.log("  ❌ " + msg); };
const ok = (msg) => console.log("  ✅ " + msg);

for (const c of CASES) {
  // One trip at a time, like a person using the app; Wikimedia rate-limits bursts.
  if (c !== CASES[0]) await new Promise((r) => setTimeout(r, 20000));
  console.log(`\n=== ${c.destination}, ${c.days} days`);
  const trip = { destination: c.destination, startDate: "", currency: "INR", days: Array.from({ length: c.days }, (_, i) => ({ id: "d" + i })) };
  const d = await loadDestination(trip);
  Object.assign(trip, { place: d.place, guide: d.guide });
  const L = d.guide.listings;
  const famous = [...L].filter((l) => l.type === "see").sort((a, b) => (b.fame || 0) - (a.fame || 0)).slice(0, 8);
  console.log("  best-known sights: " + famous.map((l) => `${l.name} (${l.fame || 0})`).join(", "));
  console.log(`  requests so far: ${calls}`);
  if (!L.length) { fail("the travel guide returned nothing"); continue; }
  console.log(`  guide: ${L.length} listings from ${d.guide.source}; cities: ${[...new Set(L.map((l) => l.city).filter(Boolean))].join(", ") || "-"}`);
  const bad = L.filter((l) => TRANSPORT.test(l.name));
  bad.length ? fail(`transport in guide: ${bad.map((l) => l.name).join(", ")}`) : ok("no transport listings in the guide");
  const { mode, plan, bases = [] } = buildSample(trip, L, profileOf(trip));
  console.log(`  mode: ${mode}`);
  for (let i = 0; i < c.days; i++) {
    const day = plan.filter((x) => x.dayIndex === i);
    const base = bases.find((b) => b.dayIndex === i)?.base || "";
    console.log(`  Day ${i + 1}${base ? " (" + base + ")" : ""}: ` + day.map((x) => `${x.time || "--"} ${x.kind === "rest" ? "Rest" : x.listing.name + " [" + x.listing.type + "]"}`).join(" | "));
    const anchors = day.filter((x) => x.listing && ["see", "do", "buy"].includes(x.listing.type)).length;
    if (anchors < (mode === "slow" ? 1 : 2)) fail(`day ${i + 1} has only ${anchors} sights or activities`);
    if (!day.some((x) => x.kind === "rest")) fail(`day ${i + 1} has no rest block`);
    if (!day.some((x) => x.listing?.type === "eat" || x.listing?.type === "drink")) fail(`day ${i + 1} has no meal`);
  }
  console.log("  ideas: " + plan.filter((x) => x.dayIndex == null).map((x) => x.listing.name).join(" | "));
  const names = plan.filter((x) => x.listing).map((x) => x.listing.name).join(" | ");
  const tp = plan.filter((x) => x.listing && TRANSPORT.test(x.listing.name));
  tp.length ? fail(`transport in plan: ${tp.map((x) => x.listing.name).join(", ")}`) : ok("no transport in the plan");
  for (const re of c.expect) re.test(names) ? ok(`plan has ${re}`) : fail(`plan is missing ${re}`);
  if (c.cities && new Set(bases.map((b) => b.base)).size < c.cities) fail(`expected at least ${c.cities} cities, got ${[...new Set(bases.map((b) => b.base))].join(", ") || "none"}`);
}

// Covers only (no loadDestination, to limit requests): a small hill town where Wikivoyage has no banner and Wikipedia has only maps.
{
  await new Promise((r) => setTimeout(r, 20000));
  console.log("\n=== Covers for Sakleshpur");
  const place = (await fetchPlace("Sakleshpur, Karnataka").catch(() => null)) || { title: "Sakleshpur", description: "Town in Karnataka, India", extract: "Sakleshpur is a hill station in the Western Ghats known for coffee estates, cardamom, Manjarabad Fort and Bisle Ghat.", lat: 12.94, lng: 75.78 };
  const lat = place.lat ?? 12.94, lng = place.lng ?? 75.78; // from the Wikipedia summary
  console.log("  themes: " + JSON.stringify(themesFor(place, [])));
  const direct = await fetchOpenverse("Sakleshpur").catch((e) => (console.log("  openverse failed: " + e.message), []));
  console.log(`  Openverse "Sakleshpur": ${direct.length} photo(s)`);
  const { entries: list, nearby, commons, ov, inspired } = await loadCovers({ dest: "Sakleshpur, Karnataka", place, listings: [], lat, lng, banner: "" });
  list.forEach((x, i) => console.log(`  ${i + 1}. ${x.url.slice(0, 110)}  [${x.caption || "-"}]${x.credit ? "  (" + x.credit + ")" : ""}`));
  list.length >= 3 ? ok(`${list.length} cover candidates (${nearby.length} nearby, ${commons.length} Commons, ${ov.length} Openverse, ${inspired.reduce((n, g) => n + g.ov.length + g.cm.length, 0)} inspired)`) : fail(`only ${list.length} cover candidates`);
  const bad = list.filter((x) => !goodCover(x.url));
  bad.length ? fail("candidates match the filter: " + bad.map((x) => x.url).join(", ")) : ok("no candidate matches the filter");
  list.some((x) => /^Inspired:/.test(x.caption) || x.credit) ? ok("at least one Inspired or Openverse photo") : fail("no Inspired or Openverse photo among the candidates");
  list.at(-1)?.url.startsWith("illus:") ? ok("the illustration is the last candidate") : fail("no illustration fallback");
}

for (const l of LINKS) {
  console.log(`\n=== Link ${l.url}`);
  const m = await unfurl(l.url);
  console.log(`  read: ok=${m.ok} title="${m.title}" places=${(m.places || []).length}`);
  console.log("  description: " + String(m.description || "").slice(0, 200).replace(/\n/g, " "));
  const items = readLink(m, l.trip);
  console.log("  stops: " + items.map((i) => `${i.title} [${i.category}]${i.unread ? " (unread)" : ""}`).join(" | "));
  if (/robot|challenge|connection security/i.test(items.map((i) => i.title).join(" "))) fail("saved a bot-check page as a place");
  else ok("no bot-check page saved as a place");
  const read = items.filter((i) => !i.unread).length;
  if (read >= l.min) ok(`${read} places read`);
  else if (items.every((i) => i.unread)) console.log(`  ℹ️ the site blocks free readers; saved as one unread link in Ideas (Gemini can try it)`);
  else fail(`only ${read} places read`);
}

console.log(`\n${fails ? fails + " check(s) failed" : "All checks passed"}`);
process.exit(fails ? 1 : 0);
