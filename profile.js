// Our travel preferences (from Akash's Trip Sheet skill) and the sample itinerary built from them.
// Saved on each trip as `profile`, so both of you see and edit the same preferences.

export const DEFAULT_PROFILE = {
  home: "", // home city; empty until you add it (used for flight price links)
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
    `Travellers: ${p.travellers} adults (a couple)${p.home ? ` from ${p.home}` : ""}.`,
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

/* ------------------------------------------------------ daylight and heat */
// The rest block follows the local day instead of a fixed 3pm: a midday break when it's hot,
// back at the hotel at dusk when days are short (sights are done by sunset), a short coffee stop otherwise.
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
export function dayShape(w, mode = "dense") {
  const max = Number.isFinite(w?.max) ? w.max : null;
  const sunset = mins(w?.sunset);
  const hot = max != null && max >= 28, cool = max != null && max < 22;
  // Cool weather leaves room for one more sight in a city day.
  const sights = mode === "slow" ? (cool ? 3 : 2) : hot ? 3 : cool ? 4 : 3;
  if (hot) return { sights, rest: { time: "14:00", min: 120, note: `Midday heat (around ${max}°): rest at the hotel or a cool cafe, then head out again at 16:00.` }, sunset };
  if (sunset != null && sunset <= 18 * 60 + 30) {
    const at = Math.max(16 * 60, Math.round((sunset - 15) / 30) * 30);
    return { sights, rest: { time: hm(at), min: 90, note: `Sunset is at ${w.sunset}: sights first, then back to the hotel to rest before dinner.` }, sunset, dusk: true };
  }
  return { sights, rest: { time: "15:30", min: 60, note: mode === "slow" ? "Unscheduled afternoon. Pool, nap or a long coffee." : "Coffee break and recharge before the late-afternoon sights." }, sunset };
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
const SNACK = /\b(gelat\w*|ice cream|bakery|pasticceria|patisserie|sweets?|desserts?)\b/i;
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

// How big the destination is: a whole country, a region, or a city/town. Decides how far apart places can be.
export function placeScale(place) {
  // Wikipedia's short description is the clearest signal ("City in Kansai, Japan", "State of India").
  if (/^(city|town|capital|municipality|village|commune|metropolis|ward)\b/i.test(place?.description || "")) return "city";
  const t = `${place?.description || ""} ${(place?.extract || "").slice(0, 220)}`;
  if (/\b(country|nation|sovereign state|kingdom|republic) (in|of|located)|\bis an? (\w+ ){0,4}(country|nation)\b|island country|archipelag/i.test(t)) return "country";
  if (/\b(region|state|province|county|prefecture|territory|island|coast|peninsula|district) (of|in)\b|\bis an? (\w+ ){0,4}(region|state|province|island)\b/i.test(t)) return "region";
  return "city";
}

export function chooseMode(p, trip) {
  if (p.pace === "dense" || p.pace === "slow") return p.pace;
  const desc = `${trip.destination || ""} ${trip.place?.description || ""} ${trip.place?.extract || ""}`;
  const scale = trip.place ? placeScale(trip.place) : "city";
  // A country is a string of cities; a region like Goa is slow if it's known for beaches or hills, whatever its largest city.
  if (scale === "country") return "dense";
  if (SLOW_PLACE.test(desc) && (scale === "region" || !CITY_PLACE.test(desc))) return "slow";
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
// Multi-city trips (a country or region): give each city a block of consecutive days and plan each block
// from that city's own listings, so a day never mixes Rome and Florence. At most one city per two days.
export function buildSample(trip, listings, p = profileOf(trip)) {
  // Places either of us voted down (p.vetoed, set by the app) stay out of the sample.
  const veto = (p.vetoed || []).map((v) => String(v).toLowerCase().trim()).filter(Boolean);
  if (veto.length) listings = listings.filter((l) => { const n = String(l.name || "").toLowerCase().trim(); return !veto.some((v) => v === n || (Math.min(v.length, n.length) >= 5 && (n.includes(v) || v.includes(n)))); });
  const n = trip.days.length;
  const cities = [...new Set(listings.map((l) => l.city).filter(Boolean))].slice(0, Math.max(1, Math.floor(n / 2)));
  if (cities.length < 2) return buildCity(trip, listings.filter((l) => !l.city || l.city === cities[0]), p);
  const weight = cities.map((c) => listings.filter((l) => l.city === c && (l.type === "see" || l.type === "do")).length || 1);
  const total = weight.reduce((a, b) => a + b, 0);
  const share = weight.map((w) => Math.max(1, Math.round((w / total) * n)));
  while (share.reduce((a, b) => a + b, 0) > n) share[share.indexOf(Math.max(...share))]--;
  while (share.reduce((a, b) => a + b, 0) < n) share[share.indexOf(Math.min(...share))]++;
  let start = 0, mode = "dense";
  const used = new Set();
  const plan = [], bases = [];
  cities.forEach((c, k) => {
    const days = trip.days.slice(start, start + share[k]);
    // Splurges once per trip: food and experience in the first city, stay wherever the best property is (first city).
    const r = buildCity({ ...trip, days, base: c, dayOffset: start }, listings.filter((l) => l.city === c), { ...p, splurges: p.splurges && k === 0, used, moreEats: listings.filter((l) => l.city !== c && l.type === "eat") });
    mode = k === 0 ? r.mode : mode;
    r.plan.forEach((x) => plan.push({ ...x, dayIndex: x.dayIndex == null ? null : x.dayIndex + start }));
    days.forEach((_, i) => bases.push({ dayIndex: start + i, base: c }));
    start += share[k];
  });
  return { mode, plan, bases };
}

function buildCity(trip, listings, p) {
  const mode = chooseMode(p, trip);
  const n = trip.days.length;
  const shapes = trip.days.map((_, i) => dayShape(trip.weather?.days?.[(trip.dayOffset || 0) + i], mode));
  const used = p.used || new Set(); // shared across a multi-city trip, so no place appears twice
  const take = (l) => (l && !used.has(l.name) ? (used.add(l.name), l) : null);
  const of = (...types) => listings.filter((l) => types.includes(l.type) && !used.has(l.name));
  const out = [];
  const put = (listing, dayIndex, time, note, extra = {}) => listing && out.push({ listing, dayIndex, time, note, ...extra });

  // Splurges first, so they are reserved.
  // Places with clear vegetarian dishes first, then places with no signal; meat-only places are left out.
  // Gelato, cafes and bakeries are snacks, not lunch or dinner. Other towns' places are a last resort.
  const eats = of("eat").filter((l) => vegOk(l) && !SNACK.test(l.name)).sort((a, b) => (vegLevel(b) === "yes") - (vegLevel(a) === "yes"));
  const moreEats = (p.moreEats || []).filter((l) => vegOk(l) && !SNACK.test(l.name));
  // This town's places first; another town's only once this one has run out.
  const meal = (c, list) => take(near(c, list.filter((l) => !used.has(l.name)))) || take(near(c, moreEats.filter((l) => !used.has(l.name))));
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
  const need = Math.max(0, shapes.reduce((a, s) => a + s.sights, 0) - (market ? 1 : 0) - (expSplurge ? 1 : 0));
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
    // Beach and hill towns have few listed sights: an unhurried half-day outdoors is the plan.
    if (!g.length && mode === "slow") out.push({ listing: { name: `Beach and outdoor time in ${trip.base || trip.destination}`, type: "do", category: "nature", content: "Free time on the nearest beach or trail. Swap in anything you've saved.", address: trip.base || trip.destination }, dayIndex: i, time: "10:00", note: "Slow morning" });
    const sh = shapes[i];
    const restItem = { listing: null, kind: "rest", dayIndex: i, time: sh.rest.time, durationMin: sh.rest.min, note: sh.rest.note };
    morning.forEach((l) => put(l, i, "", l === expSplurge ? "Experience splurge" : l === market ? "Market visit" : ""));
    put(meal(c, streetFood), i, "13:00", "Lunch: local and good value");
    // Short days: the afternoon sights come before the dusk rest. Long or hot days: rest first, then the afternoon.
    if (p.rest && !sh.dusk) out.push(restItem);
    afternoon.forEach((l) => put(l, i, "", l === expSplurge ? "Experience splurge" : l === market ? "Market visit" : ""));
    if (p.rest && sh.dusk) out.push(restItem);
    if (i === splurgeDay && foodSplurge) put(foodSplurge, i, "20:00", "Food splurge. Book ahead and ask for the vegetarian menu.");
    else put(meal(c, i % 2 ? otherFood : streetFood), i, "20:00", "Dinner");
  }
  if (foodSplurge && !out.some((x) => x.listing === foodSplurge)) put(foodSplurge, null, "", "Food splurge. Book ahead and ask for the vegetarian menu.");

  // Stays go to Ideas: the splurge plus a well-located default.
  put(staySplurge, null, "", "Stay splurge: one special property or night");
  of("sleep").slice(0, 2).map(take).forEach((l) => put(l, null, "", "Stay option"));
  // A few backups in Ideas for weather or timing changes.
  of("see", "do").slice(0, 3).map(take).forEach((l) => put(l, null, "", "Backup option"));
  return { mode, plan: out };
}

/* ------------------------------------------------------- Gemini's draft */
const TRANSPORT = /\b(airport|aeroporto|airlines?|airways|wizz|ryanair|easyjet|terminal|termini|centrale|santa lucia|s\.? ?m\.? ?n\.?|hauptbahnhof|gare|railway|train station|stazione|station|bus station|bus stand|metro station|ferry terminal|car rental|car hire|taxi)\b/i;
const TYPE_OF = { food: "eat", sight: "see", activity: "do", shopping: "buy", nature: "see", stay: "sleep" };
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
// Checks Gemini's plan against our rules and turns it into the same shape as buildSample, with a note for each fix.
// dates: weekday names per day ("Monday"), when the trip has a start date.
export function checkDraft(draft, trip, p = profileOf(trip), dates = [], listings = []) {
  const mode = chooseMode(p, trip);
  const plan = [], bases = [], notes = [], seen = new Set();
  let total = 0;
  const splurge = { food: 0, experience: 0, stay: 0 };
  let market = false;
  const drafted = new Set((Array.isArray(draft.days) ? draft.days : []).flatMap((d) => (Array.isArray(d?.items) ? d.items : []).map((x) => String(x?.name || "").trim().toLowerCase())));
  const listing = (x, cat) => ({
    name: String(x.name).trim().slice(0, 120), content: String(x.why || "").slice(0, 240), address: String(x.address || "").slice(0, 200), category: cat, type: TYPE_OF[cat] || "see",
    price: x.approxCost ? String(x.approxCost) : "", hours: x.closedDays ? `Closed ${String(x.closedDays).slice(0, 80)}` : "", ai: true,
    durationMin: Number(x.durationMin) || 0, cost: Number(x.approxCost) || 0, ...(cat === "food" && x.veg ? { veg: x.veg === "no" ? "no" : "yes" } : {}),
    vegNote: String(x.vegNote || "").slice(0, 160), bookAhead: !!x.bookAhead,
  });
  (Array.isArray(draft.days) ? draft.days : []).filter((d) => d && typeof d === "object").slice(0, trip.days.length).forEach((d, k) => {
    const i = Number.isInteger(d.day) && d.day >= 1 && d.day <= trip.days.length ? d.day - 1 : k;
    if (d.base) bases.push({ dayIndex: i, base: String(d.base).slice(0, 60) });
    let anchors = 0;
    const from = plan.length;
    const items = (Array.isArray(d.items) ? d.items : []).filter((x) => x && typeof x === "object" && x.name).sort((a, b) => (toMin(a.time) ?? 600) - (toMin(b.time) ?? 600));
    for (const x of items) {
      const cat = TYPE_OF[x.category] ? x.category : "sight";
      const key = String(x.name).trim().toLowerCase();
      if (seen.has(key)) continue;
      if (TRANSPORT.test(x.name)) { notes.push(`Left out “${x.name}” on day ${i + 1}: it's a transport hub, not a stop.`); continue; }
      const l = listing(x, cat);
      if (cat === "food" && vegLevel(l) === "no") { notes.push(`Left out “${x.name}” on day ${i + 1}: few vegetarian options.`); continue; }
      const day = dates[i];
      if (day && x.closedDays && new RegExp(day.slice(0, 3), "i").test(x.closedDays)) { notes.push(`“${x.name}” is closed on ${day}s, so it went to Ideas.`); plan.push({ listing: l, dayIndex: null, time: "", note: `Closed ${x.closedDays}` }); seen.add(key); continue; }
      const t = toMin(x.time);
      // The day's rest block stays free: anything inside it moves to just after.
      const sh = dayShape(trip.weather?.days?.[i], mode), r0 = toMin(sh.rest.time), r1 = r0 + sh.rest.min;
      const time = p.rest && t != null && t >= r0 && t < r1 && x.category !== "food" ? hm(r1) : x.time && t != null ? x.time.slice(0, 5).padStart(5, "0") : "";
      if (cat !== "food") {
        if (anchors >= dayShape(trip.weather?.days?.[i], mode).sights + 1) { notes.push(`Day ${i + 1} was too full, so “${x.name}” went to Ideas.`); plan.push({ listing: l, dayIndex: null, time: "", note: "Backup option" }); seen.add(key); continue; }
        anchors++;
      }
      seen.add(key);
      if (x.splurge === "food" || x.splurge === "experience") splurge[x.splurge]++;
      if (x.market || MARKET.test(`${x.name} ${x.why || ""}`)) market = true;
      total += l.cost;
      const note = [x.splurge === "food" ? "Food splurge. Book ahead and ask for the vegetarian menu." : x.splurge === "experience" ? "Experience splurge" : x.market ? "Market visit" : "", x.bookAhead && x.splurge !== "food" ? "Book ahead" : "", x.vegNote && cat === "food" ? `Veg: ${x.vegNote}` : ""].filter(Boolean).join(" · ");
      plan.push({ listing: l, dayIndex: i, time, note });
    }
    const shp = dayShape(trip.weather?.days?.[i], mode);
    if (p.rest) plan.push({ listing: null, kind: "rest", dayIndex: i, time: shp.rest.time, durationMin: shp.rest.min, note: shp.rest.note });
    // Keep the day in time order, so the rest block sits between lunch and the afternoon.
    const mine = plan.splice(from).sort((a, b) => (a.dayIndex == null) - (b.dayIndex == null) || (toMin(a.time) ?? 600) - (toMin(b.time) ?? 600));
    plan.push(...mine);
    // A missing lunch or dinner comes from the travel guide's places with vegetarian options in that town.
    const meals = mine.filter((x) => x.dayIndex === i && x.listing?.category === "food").map((x) => toMin(x.time) ?? 0);
    const base = bases.find((b) => b.dayIndex === i)?.base || "";
    const pick = () => {
      const pool = listings.filter((l) => l.type === "eat" && vegOk(l) && !seen.has(l.name.toLowerCase()) && !drafted.has(l.name.toLowerCase()) && (!l.city || !base || l.city.toLowerCase() === base.toLowerCase()));
      const l = pool.sort((a, b) => (vegLevel(b) === "yes") - (vegLevel(a) === "yes"))[0];
      if (l) seen.add(l.name.toLowerCase());
      return l;
    };
    const fill = [];
    for (const [has, time, label] of [[meals.some((m) => m >= 690 && m < 900), "13:00", "Lunch"], [meals.some((m) => m >= 1080), "20:00", "Dinner"]]) {
      if (has) continue;
      const l = pick();
      if (l) fill.push({ listing: l, dayIndex: i, time, note: `${label} from the travel guide` });
      else notes.push(`Day ${i + 1} has no ${label.toLowerCase()} yet.`);
    }
    if (fill.length) {
      plan.splice(from, plan.length - from, ...[...plan.slice(from), ...fill].sort((a, b) => (a.dayIndex == null) - (b.dayIndex == null) || (toMin(a.time) ?? 600) - (toMin(b.time) ?? 600)));
    }
    // A light day is topped up with the guide's best-known sights in that town, nearest the day's other stops first.
    if (anchors < shp.sights) {
      const here = plan.slice(from).filter((x) => x.dayIndex === i && Number.isFinite(x.listing?.lat));
      const c = here.length ? { lat: here.reduce((a, x) => a + x.listing.lat, 0) / here.length, lng: here.reduce((a, x) => a + x.listing.lng, 0) / here.length } : null;
      const far = (l) => (c && Number.isFinite(l.lat) ? Math.hypot(l.lat - c.lat, l.lng - c.lng) : 0);
      const pool = listings.filter((l) => (l.type === "see" || l.type === "do") && !TRANSPORT.test(l.name) && !seen.has(l.name.toLowerCase()) && !drafted.has(l.name.toLowerCase()) && (!l.city || !base || l.city.toLowerCase() === base.toLowerCase()));
      const top = pool.slice(0, 12).sort((a, b) => far(a) - far(b)).slice(0, shp.sights - anchors);
      // Each extra gets a free slot: clear of the other stops and the rest block, and before sunset.
      const taken = plan.slice(from).filter((x) => x.dayIndex === i && toMin(x.time) != null).map((x) => [toMin(x.time), toMin(x.time) + (x.kind === "rest" ? x.durationMin || 60 : x.listing?.durationMin || (x.listing?.type === "eat" ? 75 : 90))]);
      const last = shp.dusk ? toMin(shp.rest.time) : shp.sunset ? Math.max(shp.sunset, 1080) : 1140;
      const free = [600, 690, 870, 960, 1050, 1110].filter((t) => t + 60 <= last).filter((t) => !taken.some(([a, b]) => t < b && t + 75 > a));
      const add = top.slice(0, free.length).map((l, k) => { seen.add(l.name.toLowerCase()); return { listing: l, dayIndex: i, time: hm(free[k]), note: "Added from the travel guide" }; });
      if (add.length) {
        anchors += add.length;
        notes.push(`Day ${i + 1} had room, so it got ${add.map((x) => "“" + x.listing.name + "”").join(", ")} from the travel guide.`);
        const day = [...plan.splice(from), ...add].sort((a, b) => (a.dayIndex == null) - (b.dayIndex == null) || (toMin(a.time) ?? 600) - (toMin(b.time) ?? 600));
        plan.push(...day);
      }
      if (anchors < Math.max(2, shp.sights - 1)) notes.push(`Day ${i + 1} is light (${anchors} stop${anchors === 1 ? "" : "s"}), which leaves room for your own finds.`);
    }
  });
  for (const s of draft.stays || []) {
    if (!s?.name || seen.has(s.name.toLowerCase())) continue;
    seen.add(s.name.toLowerCase());
    if (s.splurge) splurge.stay++;
    plan.push({ listing: listing({ ...s, why: [s.why, s.base && `In ${s.base}`].filter(Boolean).join(" · ") }, "stay"), dayIndex: null, time: "", note: s.splurge ? "Stay splurge: one special property or night" : "Stay option" });
  }
  if (p.splurges) for (const [k, v] of Object.entries(splurge)) if (!v) notes.push(`No ${k} splurge in this draft.`);
  if (!market) notes.push("No market visit in this draft.");
  const budget = Number(trip.budget) || 0;
  if (budget && total > budget) notes.push(`The stops alone come to about ${total} ${trip.currency || ""}, over the ${budget} budget.`);
  return { mode, plan, bases, notes, total };
}
