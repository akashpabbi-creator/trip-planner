// Reads a shared link's preview (title, caption, description) and works out what it means for the plan:
// which places it mentions, what kind of stop each is, how long it takes, what it costs and when to go.
// Works without AI; with a Gemini key, Gemini reads the page itself for better results (see ai.js).
import { vegLevel } from "./profile.js";

const CAT_RULES = [
  ["stay", /\b(hotel|resort|villa|homestay|hostel|airbnb|guest ?house|haveli|lodge|stay|retreat|booking\.com|agoda|camp(site)?)\b/i],
  ["food", /\b(restaurant|cafe|café|coffee|bakery|bar|pub|brewery|food|eat|brunch|breakfast|lunch|dinner|thali|dosa|street food|dessert|ice cream|zomato|swiggy|kitchen|bistro|eatery|dhaba|osteria|trattoria|taverna|pizzeria|pizza|gelato|gelateria|bacaro|cicchetti|tapas|brasserie|izakaya|deli|panini|food hall|patisserie|boulangerie|creperie|noodles?|dumplings?|thali|mess|canteen)\b/i],
  ["nature", /\b(beach|waterfall|falls|lake|trek|trail|hike|peak|hill|valley|forest|national park|wildlife|safari|viewpoint|sunrise point|island|river|garden|cave)\b/i],
  ["shopping", /\b(market|bazaar|shop|shopping|boutique|mall|souk|flea)\b/i],
  ["activity", /\b(tour|class|workshop|kayak|scuba|snorkel|dive|surf|paraglid|rafting|cruise|boat|show|concert|experience|activity|tasting|spa|massage|zipline|balloon)\b/i],
  ["sight", /\b(fort|palace|temple|church|mosque|museum|monument|cathedral|ruins|gallery|heritage|old town|tower|castle|shrine|stepwell|tomb)\b/i],
];
const MINUTES = { stay: 60, food: 75, nature: 150, shopping: 75, activity: 150, sight: 90, other: 60 };

export function categoryOf(text, fallback = "sight") {
  for (const [cat, re] of CAT_RULES) if (re.test(text)) return cat;
  return fallback;
}

// "₹1,200 per person", "Rs. 500", "INR 2000", "$25", "€15 pp"
export function costOf(text, currency = "INR") {
  const m = String(text).match(/(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s?(\d[\d,]*(?:\.\d+)?)(k)?\s*(pp|per person|\/person|per head|for two|for 2)?/i);
  if (!m) return null;
  const sym = m[1].toLowerCase().replace(".", "");
  const cur = { "₹": "INR", rs: "INR", inr: "INR", $: "USD", usd: "USD", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP" }[sym];
  if (cur !== currency) return null; // don't guess exchange rates
  let n = parseFloat(m[2].replace(/,/g, "")) * (m[3] ? 1000 : 1);
  if (m[4] && /pp|person|head/i.test(m[4])) n *= 2; // plans are for the two of you
  return Math.round(n);
}

export function bestTimeOf(text) {
  const t = String(text);
  if (/\bsunrise\b/i.test(t)) return "sunrise";
  if (/\bsunset\b|golden hour/i.test(t)) return "sunset";
  if (/\bnight market|nightlife|after dark|at night|night view\b/i.test(t)) return "night";
  if (/\bbreakfast|morning|early\b/i.test(t)) return "morning";
  if (/\bdinner|evening\b/i.test(t)) return "evening";
  if (/\blunch\b/i.test(t)) return "lunch";
  return "";
}

export function hoursOf(text) {
  const t = String(text);
  const open = t.match(/\b(?:open|timings?|hours)\s*[:\-]?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
  const closed = t.match(/\bclosed (?:on )?((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:days?)?)/i);
  return [open && "Open " + open[1].replace(/\s+/g, " "), closed && "Closed " + closed[1]].filter(Boolean).join(" · ");
}



// Captions like "5 cafes you must try: 1. Blue Tokai 2. Third Wave…" or "📍 Place A ... 📍 Place B".
export function listedPlaces(text) {
  const t = String(text || "");
  const lines = t.split(/\n|(?=\s\d{1,2}[.)]\s)|(?=\d️⃣)|(?=📍)/u).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const m = l.match(/^(?:\d{1,2}[.)]|\d️⃣|📍|[-•▪︎➡️👉])\s*(.+)$/u);
    if (!m) continue;
    const [name, ...rest] = m[1].split(/\s[-–—:|]\s|\s*[(:]\s*/);
    const clean = name.replace(/[#@][\w.]+/g, "").replace(/[^\p{L}\p{N}&'’. ,]/gu, "").trim();
    if (clean.length >= 3 && clean.length <= 60 && !/^(follow|save|share|like|tag|comment|link in bio)/i.test(clean)) out.push({ name: clean, detail: rest.join(" ").trim() });
  }
  const seen = new Set();
  return out.filter((x) => !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase())).slice(0, 10);
}

// From an unfurled link to one or more planned stops (without AI).
export function readLink(m, trip) {
  const all = `${m.title || ""}\n${m.description || ""}\n${m.siteName || ""}\n${m.url || ""}`;
  const base = {
    image: m.image || "", siteName: m.siteName || "", url: m.url, description: (m.description || "").slice(0, 600),
  };
  const fromPost = /instagram|facebook|youtube|tiktok/.test(m.source || "");
  const listed = fromPost || /blog|guide|best|top \d|things to do|places to/i.test(all) ? listedPlaces(m.description) : [];
  const one = (name, text, extra = {}) => {
    const category = m.source === "maps" && !extra.listed ? categoryOf(text, "sight") : categoryOf(text, extra.fallback || "sight");
    const cost = costOf(text, trip.currency || "INR");
    const when = bestTimeOf(text);
    const hours = hoursOf(text);
    const veg = category === "food" ? vegLevel({ title: text }) : "";
    return {
      ...base, title: name.slice(0, 140), category,
      durationMin: MINUTES[category] || 60, cost: cost || 0, bestTime: when,
      notes: [hours, when && `Best at ${when}`].filter(Boolean).join(" · "),
      ...(veg ? { veg } : {}),
      location: extra.location || "",
    };
  };
  if (listed.length >= 2) {
    // "Best spots in Florence", "📍 Florence": the town the list is about, so each place is found in the right city.
    const head = `${m.title || ""}\n${String(m.description || "").split("\n")[0]}`;
    const town = (head.match(/📍\s*([^\n#|•,]{3,40})/u) || head.match(/\b(?:in|around|of|across)\s+((?:[A-Z][\p{L}'’-]+)(?:\s(?:[A-Z][\p{L}'’-]+))?)/u) || [])[1]?.trim() || "";
    // Each place is judged on its own line; the list's heading ("best cafes in…") only breaks ties.
    return listed.map((x) => ({ ...one(x.name, `${x.name} ${x.detail}`, { listed: true, fallback: categoryOf(head, "sight"), location: town ? `${x.name}, ${town}` : "" }), description: x.detail, fromList: true }));
  }
  // Website titles are often "Name | Tagline" or "Name - Site": keep the name.
  const name = fromPost || m.source === "maps" ? m.title : String(m.title || "").split(/\s[|–—-]\s|\s·\s/)[0].replace(/\s+(guide|review|blog|official site|website)$/i, "").trim();
  // The rest of such a title is often where it is ("Osteria X | Cannaregio, Venice").
  const tail = fromPost || m.source === "maps" ? "" : String(m.title || "").split(/\s[|–—-]\s|\s·\s/).slice(1).join(", ").trim();
  const tailLoc = tail && tail.length < 60 && !/\b(official|home|menu|book|reserv|tripadvisor|review|blog|restaurant guide|website|instagram|facebook)\b/i.test(tail) ? tail : "";
  const item = one(name || m.title || "Saved link", all, { location: m.location || (tailLoc ? `${name}, ${tailLoc}` : "") });
  if (Number.isFinite(m.lat)) Object.assign(item, { lat: m.lat, lng: m.lng });
  return [item];
}
