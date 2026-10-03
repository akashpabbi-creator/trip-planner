// Runs the travel guide reader, the sample planner and the link reader against the real sites
// (Wikivoyage, Wikipedia, Wikidata, a real blog) and checks the results. Run: node tests/real-data.mjs
import { loadDestination } from "../discover.js";
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
  console.log(`\n=== ${c.destination}, ${c.days} days`);
  const trip = { destination: c.destination, startDate: "", currency: "INR", days: Array.from({ length: c.days }, (_, i) => ({ id: "d" + i })) };
  const d = await loadDestination(trip);
  Object.assign(trip, { place: d.place, guide: d.guide });
  const L = d.guide.listings;
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

for (const l of LINKS) {
  console.log(`\n=== Link ${l.url}`);
  const m = await unfurl(l.url);
  console.log(`  read: ok=${m.ok} title="${m.title}" places=${(m.places || []).length}`);
  console.log("  description: " + String(m.description || "").slice(0, 200).replace(/\n/g, " "));
  const items = readLink(m, l.trip);
  console.log("  stops: " + items.map((i) => `${i.title} [${i.category}]${i.unread ? " (unread)" : ""}`).join(" | "));
  if (/robot|challenge|connection security/i.test(items.map((i) => i.title).join(" "))) fail("saved a bot-check page as a place");
  items.filter((i) => !i.unread).length >= l.min ? ok(`${items.length} places read`) : fail(`only ${items.filter((i) => !i.unread).length} places read`);
}

console.log(`\n${fails ? fails + " check(s) failed" : "All checks passed"}`);
process.exit(fails ? 1 : 0);
