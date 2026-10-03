// Our travel preferences (from Akash's Trip Sheet skill) and the sample itinerary built from them.
// Saved on each trip as `profile`, so both of you see and edit the same preferences.

export const DEFAULT_PROFILE = {
  home: "Bengaluru (BLR)",
  travellers: 2,
  pace: "auto", // auto | dense | slow
  diet: "Vegetarian, eats eggs. No meat or fish.",
  food: "Both ends: street food, markets and local joints, plus one or two notable chef-driven restaurants. Skip mid-range tourist restaurants.",
  stays: "Boutique or design stays with character, a well-located 4-star as the default, a resort when the property is the point. At most 2 hotels per trip unless it's multi-city.",
  interests: "Food, markets, cafes and bars; local life and shopping; history, architecture and museums; nature, hikes and scenic drives.",
  rest: true, // a rest or buffer block every day
  splurges: true, // one splurge each in food, stay and experience
  autoPlace: true, // places from shared links go straight onto the best day
  earlyStarts: "Happy to start very early when the hour transforms the experience (sunrise, markets, empty temples). At most two early starts a trip.",
  flights: "Avoid red-eye and very early flights unless they save more than 10%.",
};
export const profileOf = (trip) => ({ ...DEFAULT_PROFILE, ...(trip?.profile || {}) });

export function profileText(p) {
  return [
    `Travellers: ${p.travellers} adults (a couple) from ${p.home}.`,
    `Diet: ${p.diet} Restaurants don't need to be pure vegetarian, but must serve good vegetarian dishes. Watch for hidden fish sauce, dashi, shrimp paste, lard, gelatin and meat stock.`,
    `Food style: ${p.food}`,
    `Stays: ${p.stays}`,
    `Interests: ${p.interests}`,
    `Pace: ${p.pace === "dense" ? "dense, 3-5 anchors a day" : p.pace === "slow" ? "slow, 1-2 anchors a day with long meals" : "dense for big first-visit cities, slow for beaches, mountains and nature"}.`,
    p.rest ? "Hard rule: every day has a rest or buffer block (usually mid-afternoon). Never a fully back-to-back day." : "",
    p.splurges ? "Every trip has exactly one deliberate splurge in each of food (a named restaurant that can do a serious vegetarian menu), stay and experience (a guide, tour, ticket or activity worth paying for). Everything else value-optimised, avoiding tourist markup." : "",
    p.earlyStarts,
    p.flights,
  ].filter(Boolean).join("\n");
}

/* --------------------------------------------------------- choosing places */
// Vegetarian check: a place only has to offer good vegetarian food, it doesn't have to be pure veg.
// "yes": vegetarian dishes are clearly on offer. "no": the place is built around meat or fish
// (steakhouse, seafood shack, BBQ, kebab house...). "": no signal either way, which is most places.
const VEG = /\b(vegetarian|vegan|veg\b|veg options|veggie|plant[- ]based|pure veg|jain|dosa|idli|thali|paneer|dal\b|chaat|falafel|hummus|tofu|udupi|pizza|pasta|risotto|salad|south indian|north indian|gujarati|rajasthani|punjabi|meze|mezze)/i;
const MEAT_ONLY = /\b(steak ?house|steaks?|seafood|fish market|crab shack|oyster bar|bbq|barbe?cue|smokehouse|butcher|kebab house|kebabs?|fried chicken|rotisserie|churrascaria|rodizio|grill house|shawarma|biryani house|meat ?house|carvery|yakiniku|korean bbq|izakaya|ramen|pho\b|crab|lobster|oysters?)\b/i;
export function vegLevel(l) {
  if (l.veg) return l.veg; // already checked (e.g. by Gemini)
  const t = text(l);
  if (/\b(no vegetarian|not (?:suitable|good) for vegetarians|meat lovers?)\b/i.test(t)) return "no";
  if (VEG.test(t)) return "yes";
  if (MEAT_ONLY.test(t)) return "no";
  return "";
}
const POSH = /\b(fine dining|tasting menu|michelin|chef|degustation|upscale|gourmet|award)/i;
const STREET = /\b(street food|market|hawker|stall|food court|night market|local|cheap|budget|canteen|warung|dhaba)/i;
const BOUTIQUE = /\b(boutique|design|heritage|historic|villa|resort|luxury|palace|ryokan|lodge)/i;
const EXPERIENCE = /\b(tour|guide|guided|cruise|boat|safari|tasting|class|workshop|cooking|balloon|trek|dive|snorkel|kayak|show|performance|permit)/i;
const MARKET = /\b(market|bazaar|souk|night market)/i;
const NATURE = /\b(park|garden|beach|lake|waterfall|hill|mountain|trail|viewpoint|forest|river|valley|island)/i;
const SLOW_PLACE = /\b(beach|island|hill station|mountain|national park|valley|lake|resort town|coast|backwaters|vineyard|wine region|countryside|village)/i;
const CITY_PLACE = /\b(capital|largest city|metropol|megacity|city of|most populous|financial centre|financial center)/i;

const text = (l) => `${l.name || l.title || ""} ${l.content || l.description || ""} ${l.price || ""}`;
const priceNum = (l) => {
  const n = String(l.price || "").replace(/[, ]/g, "").match(/\d+(\.\d+)?/g);
  return n ? Math.max(...n.map(Number)) : null;
};
export const vegOk = (l) => vegLevel(l) !== "no";

// Destinations where vegetarian food needs a phrase because fish/meat stock is structural.
const VEG_TIPS = [
  [/japan|tokyo|kyoto|osaka/i, "Dashi (fish stock) is in most Japanese food. Say: “Niku, sakana, dashi nashi de onegaishimasu” (no meat, fish or dashi, please)."],
  [/thailand|bangkok|phuket|chiang mai|krabi|samui/i, "Fish sauce is in most Thai dishes. Say: “Gin jay” (vegan food) or “Mai sai nam pla” (no fish sauce)."],
  [/vietnam|hanoi|ho chi minh|saigon|da nang|hoi an/i, "Fish sauce (nước mắm) is everywhere. Say: “Tôi ăn chay, không nước mắm” (I'm vegetarian, no fish sauce). Look for “quán chay” (vegetarian restaurants)."],
  [/indonesia|bali|jakarta|ubud|lombok/i, "Shrimp paste (terasi) is in many sambals. Say: “Saya vegetarian, tanpa terasi” (I'm vegetarian, no shrimp paste)."],
  [/malaysia|singapore|kuala lumpur|penang/i, "Belacan (shrimp paste) is common in sambal. Ask for “no belacan”; Indian and Chinese Buddhist vegetarian places are easy wins."],
  [/korea|seoul|busan/i, "Kimchi and broths often contain fish or anchovy stock. Temple food restaurants are reliably vegetarian."],
  [/china|beijing|shanghai|hong kong|taiwan|taipei/i, "Meat stock and lard are common. Buddhist vegetarian (sù shí) restaurants are the safe choice."],
];
export const vegTip = (dest) => VEG_TIPS.find(([re]) => re.test(dest || ""))?.[1] || "";

export function chooseMode(p, trip) {
  if (p.pace === "dense" || p.pace === "slow") return p.pace;
  const desc = `${trip.destination || ""} ${trip.place?.description || ""} ${trip.place?.extract || ""}`;
  if (SLOW_PLACE.test(desc) && !CITY_PLACE.test(desc)) return "slow";
  return "dense";
}

// Cluster listings into n groups by location so each day stays in one area.
function cluster(list, n) {
  const loc = list.filter((l) => l.lat != null), rest = list.filter((l) => l.lat == null);
  if (loc.length < n * 2) return Array.from({ length: n }, (_, i) => list.filter((_, k) => k % n === i));
  // Sort along the longer axis, then cut into n contiguous chunks.
  const span = (k) => Math.max(...loc.map((l) => l[k])) - Math.min(...loc.map((l) => l[k]));
  const axis = span("lat") > span("lng") ? "lat" : "lng";
  loc.sort((a, b) => a[axis] - b[axis]);
  const groups = Array.from({ length: n }, (_, i) => loc.slice(Math.floor((i * loc.length) / n), Math.floor(((i + 1) * loc.length) / n)));
  rest.forEach((l, k) => groups[k % n].push(l));
  return groups;
}
const centre = (g) => {
  const p = g.filter((l) => l.lat != null);
  return p.length ? { lat: p.reduce((s, l) => s + l.lat, 0) / p.length, lng: p.reduce((s, l) => s + l.lng, 0) / p.length } : null;
};
const near = (c, list) => {
  if (!c || !list.length) return list[0];
  const d = (l) => (l.lat == null ? 1e9 : (l.lat - c.lat) ** 2 + (l.lng - c.lng) ** 2);
  return [...list].sort((a, b) => d(a) - d(b))[0];
};

// Builds the sample plan. Returns [{listing | null, kind, dayIndex | null, time, title?, note}].
export function buildSample(trip, listings, p = profileOf(trip)) {
  const mode = chooseMode(p, trip);
  const n = trip.days.length;
  const per = mode === "dense" ? 3 : 2;
  const used = new Set();
  const take = (l) => (l && !used.has(l.name) ? (used.add(l.name), l) : null);
  const of = (...types) => listings.filter((l) => types.includes(l.type) && !used.has(l.name));
  const out = [];
  const put = (listing, dayIndex, time, note, extra = {}) => listing && out.push({ listing, dayIndex, time, note, ...extra });

  // Splurges first, so they are reserved.
  // Places with clear vegetarian dishes first, then places with no signal; meat-only places are left out.
  const eats = of("eat").filter(vegOk).sort((a, b) => (vegLevel(b) === "yes") - (vegLevel(a) === "yes"));
  let foodSplurge = null, staySplurge = null, expSplurge = null;
  if (p.splurges) {
    foodSplurge = take([...eats].sort((a, b) => (POSH.test(text(b)) - POSH.test(text(a))) || ((priceNum(b) || 0) - (priceNum(a) || 0)))[0]);
    expSplurge = take(of("do").find((l) => EXPERIENCE.test(text(l))) || of("do")[0]);
    staySplurge = take(of("sleep").sort((a, b) => (BOUTIQUE.test(text(b)) - BOUTIQUE.test(text(a))) || ((priceNum(b) || 0) - (priceNum(a) || 0)))[0]);
  }

  // Anchors: sights, things to do, nature and a market, spread over the days by area.
  const market = take(of("buy", "see", "do").find((l) => MARKET.test(text(l))));
  const anchorPool = of("see", "do");
  const natureFirst = mode === "slow" ? [...anchorPool].sort((a, b) => NATURE.test(text(b)) - NATURE.test(text(a))) : anchorPool;
  const need = Math.max(0, n * per - (market ? 1 : 0) - (expSplurge ? 1 : 0));
  const anchors = natureFirst.slice(0, need).map(take).filter(Boolean);
  const groups = cluster(anchors, n);
  // Market and experience go on the lightest days, not the same one.
  const lightest = (skip) => groups.map((g, k) => [g.length, k]).filter(([, k]) => k !== skip || n === 1).sort((x, y) => x[0] - y[0])[0][1];
  const expDay = expSplurge ? lightest(-1) : -1;
  if (expSplurge) groups[expDay].push(expSplurge);
  if (market) groups[lightest(expDay)].push(market);

  const streetFood = eats.filter((l) => !used.has(l.name)).sort((a, b) => STREET.test(text(b)) - STREET.test(text(a)) || (priceNum(a) ?? 1e9) - (priceNum(b) ?? 1e9));
  const otherFood = eats.filter((l) => !used.has(l.name)).sort((a, b) => POSH.test(text(b)) - POSH.test(text(a)));
  const splurgeDay = n > 2 ? n - 2 : n - 1;

  for (let i = 0; i < n; i++) {
    const g = groups[i] || [];
    const c = centre(g);
    const morning = g.slice(0, Math.ceil(g.length / 2)), afternoon = g.slice(Math.ceil(g.length / 2));
    morning.forEach((l) => put(l, i, "", l === expSplurge ? "Experience splurge" : l === market ? "Market visit" : ""));
    put(take(near(c, streetFood.filter((l) => !used.has(l.name)))), i, "13:00", "Lunch: local and good value");
    if (p.rest) out.push({ listing: null, kind: "rest", dayIndex: i, time: "15:00", note: mode === "slow" ? "Unscheduled afternoon. Pool, nap or a long coffee." : "Rest and recharge at the hotel or a cafe. The hottest, busiest part of the day." });
    afternoon.forEach((l) => put(l, i, "", l === expSplurge ? "Experience splurge" : l === market ? "Market visit" : ""));
    if (i === splurgeDay && foodSplurge) put(foodSplurge, i, "20:00", "Food splurge. Book ahead and ask for the vegetarian menu.");
    else put(take(near(c, (i % 2 ? otherFood : streetFood).filter((l) => !used.has(l.name)))), i, "20:00", "Dinner");
  }
  if (foodSplurge && !out.some((x) => x.listing === foodSplurge)) put(foodSplurge, null, "", "Food splurge. Book ahead and ask for the vegetarian menu.");

  // Stays go to Ideas: the splurge plus a well-located default.
  put(staySplurge, null, "", "Stay splurge: one special property or night");
  of("sleep").slice(0, 2).map(take).forEach((l) => put(l, null, "", "Stay option"));
  // A few backups in Ideas for weather or timing changes.
  of("see", "do").slice(0, 3).map(take).forEach((l) => put(l, null, "", "Backup option"));
  return { mode, plan: out };
}
