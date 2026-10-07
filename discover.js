// Destination info and starter suggestions, all from free sources that work straight from the browser:
//  - Wikipedia: photo and short description of the destination
//  - Open-Meteo: weather forecast (or last year's weather for the same dates when the trip is far off)
//  - Wikivoyage: the travel guide's own picks for sights, things to do, food, drinks and places to stay
//  - Gemini (optional, with your free API key): top-rated picks with ratings, using Google Search
import { geocode } from "./smart.js";

const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const WV = "https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&origin=*&page=";
const WV_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/";

// Wikipedia's lead image for a country is often its flag, and for regions a locator map; small places only have taluk, census
// or district maps. Never use those, nor diagrams, logos or plans, as a cover. Words must stand alone: Mapusa and Mapleton pass.
export const BAD_COVER = /Flag_of|Coat_of_arms|_location_|Locator|Map_of|Emblem|\.svg|(^|[_\s\-(.,/])(maps?|taluks?|taluka|census|hobli|panchayat|districts?|diagrams?|logos?|seals?|charts?|graphs?|plans?|flags?|emblems?|locators?)([_\s\-).,]|$)/i;
const decoded = (u) => { try { return decodeURIComponent(String(u)); } catch { return String(u); } };
// w and h are optional: when known, portrait images and ones narrower than 900px are rejected too.
export const isIllus = (u) => /^illus:[a-z]+$/.test(String(u || ""));
export const goodCover = (u, w, h) => {
  if (isIllus(u)) return true;
  if (!u || BAD_COVER.test(decoded(u).replace(/ /g, "_"))) return false;
  if (w > 0 && h > 0 && h > w * 1.05) return false;
  if (w > 0 && w < 900) return false;
  return true;
};
const WVP = "https://en.wikivoyage.org/w/api.php?action=query&prop=pageprops&redirects=1&format=json&origin=*&titles=";
// The hand-made panorama at the top of a Wikivoyage page ("Italy banner.jpg"); the generic default banner doesn't count.
export async function fetchBanner(dest) {
  for (const q of variants(dest)) {
    try {
      const r = await fetch(WVP + encodeURIComponent(q));
      if (!r.ok) continue;
      const j = await r.json();
      const f = Object.values(j.query?.pages || {}).map((p) => p.pageprops?.wpb_banner).find(Boolean);
      if (f && !/(page)?banner default/i.test(f)) {
        const u = WV_IMG + encodeURIComponent(String(f).replace(/^(File|Image):/i, "").replace(/ /g, "_")) + "?width=1600";
        if (goodCover(u)) return u;
      }
    } catch (e) { console.warn("banner", e); }
  }
  return "";
}
const WPAPI = "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggsradius=10000&ggslimit=30&prop=pageimages&piprop=original&ggscoord=";
const COMMONS = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1600&gsrsearch=";
const landscape = (w, h) => w > 0 && h > 0 && w >= 1.2 * h;
// Landmark photos from Wikipedia articles within 10 km (the API maximum), nearest first, with the article title as caption.
export async function fetchNearby(lat, lng) {
  const r = await fetch(WPAPI + encodeURIComponent(lat + "|" + lng));
  if (!r.ok) return [];
  const j = await r.json();
  return Object.values(j.query?.pages || {})
    .filter((p) => {
      const o = p.original;
      return o?.source && /\.jpe?g(\?|$)/i.test(o.source) && landscape(o.width, o.height) && o.width >= 900 && goodCover(o.source, o.width, o.height);
    })
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ url: p.original.source, caption: p.title || "" }));
}
// Photos from Wikimedia Commons for a search phrase (1600px thumbnails).
export async function commonsSearch(q) {
  if (!q) return [];
  const r = await fetch(COMMONS + encodeURIComponent(q + " filetype:bitmap"));
  if (!r.ok) return [];
  const j = await r.json();
  return Object.values(j.query?.pages || {})
    .map((p) => ({ p, i: p.imageinfo?.[0] }))
    .filter(({ p, i }) => i?.thumburl && i.mime === "image/jpeg" && landscape(i.width, i.height) && i.width >= 1200 && goodCover(p.title || i.url, i.width, i.height) && goodCover(i.url) && goodCover(i.thumburl))
    .sort((a, b) => (a.p.index || 0) - (b.p.index || 0))
    .map(({ p, i }) => ({ url: i.thumburl, caption: decoded(String(p.title || "")).replace(/^File:/i, "").replace(/\.\w+$/, "").replace(/_/g, " ").trim() }));
}
// Photos of the place itself from Wikimedia Commons.
export const fetchCommons = (dest) => commonsSearch(String(dest || "").split(",")[0].trim());

// Openverse (free, no key, CORS): CC-licensed photos from Flickr, Wikimedia and others. Landscape, 1000px or wider, with creator and licence for credit.
const OPENVERSE = "https://api.openverse.org/v1/images/?aspect_ratio=wide&size=large&mature=false&page_size=20&q=";
export async function fetchOpenverse(q) {
  if (!q) return [];
  const r = await fetch(OPENVERSE + encodeURIComponent(q));
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || [])
    .map((x) => ({ x, url: /^https:/i.test(x.url || "") ? x.url : /^https:/i.test(x.thumbnail || "") ? x.thumbnail : "" }))
    .filter(({ x, url }) => url && !(x.width > 0 && x.height > 0 && (x.height > x.width * 1.05 || x.width < 1000)) && goodCover(url, x.width, x.height) && goodCover(x.title || "x"))
    .map(({ x, url }) => ({ url, caption: String(x.title || "").replace(/\s+/g, " ").trim().slice(0, 80), credit: [x.creator, x.license ? `CC ${String(x.license).toUpperCase()}${x.license_version ? " " + x.license_version : ""}` : ""].filter(Boolean).join(" · ") }));
}

// What a place is known for, from its Wikipedia description and summary and its guide listings. Each theme has a search phrase and an illustration id.
const THEMES = [
  ["coffee", /\b(coffee|cardamom|arabica|robusta)\b/gi, "coffee plantation"],
  ["tea", /\btea (plantations?|gardens?|estates?|hills?)\b|\btea\b/gi, "tea plantation hills"],
  ["hills", /hill ?station|western ghats|\bghats?\b|\bhills?\b|mountain|misty|\bmist\b/gi, "Western Ghats landscape"],
  ["beach", /\bbeach(es)?\b|\bcoast(al)?\b|seashore|\bsurf/gi, "tropical beach"],
  ["fort", /\bforts?\b|fortress|citadel/gi, "hill fort"],
  ["temple", /\btemples?\b|shrine|\bmosque\b|cathedral|basilica/gi, "temple architecture"],
  ["backwater", /backwaters?|houseboat|lagoon/gi, "Kerala backwaters"],
  ["desert", /\bdesert\b|\bdunes?\b|\bsahara\b/gi, "desert dunes"],
  ["snow", /\bsnow(y|fall)?\b|glacier|\bski\b|himalaya/gi, "snow mountains"],
  ["lake", /\blakes?\b|\breservoir\b/gi, "lake sunrise"],
  ["waterfall", /waterfalls?|\bfalls\b|cascade/gi, "waterfall"],
  ["wildlife", /wildlife|national park|safari|sanctuary|tiger|elephant/gi, "wildlife sanctuary forest"],
  ["vineyard", /vineyards?|\bwinery|wineries|\bwine\b/gi, "vineyard"],
  ["oldtown", /old town|medieval|historic centre|historic center|heritage|palace/gi, "old town historic centre"],
  ["city", /\bmetropolis\b|skyline|capital city|\bcity\b/gi, "city skyline"],
];
// "Town in Karnataka, India" -> "Karnataka". Only when the description names a region and a country.
export function regionOf(place) {
  const parts = String(place?.description || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const m = parts[0].match(/\b(?:in|of)\s+(?:the\s+)?([A-Z][\w'’ .-]*)$/);
  return m ? m[1].trim() : "";
}
export function themesFor(place, listings = []) {
  const text = [place?.description, place?.extract, ...(listings || []).slice(0, 40).flatMap((l) => [l.name, l.content])].filter(Boolean).join(" . ");
  const region = regionOf(place);
  return THEMES.map(([id, re, q], order) => ({ id, order, n: (text.match(re) || []).length, q }))
    .filter((t) => t.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, 3)
    .map((t) => ({ id: t.id, order: t.order, q: t.id === "temple" ? `${region} ${t.q}`.trim() : t.q, region: t.id === "hills" || t.id === "backwater" ? "" : region }));
}
// Searches for the themes: Openverse then Commons, "<theme> <region>" first and the plain theme when that finds nothing.
export async function fetchInspired(themes) {
  const out = [];
  for (const t of themes || []) {
    const qs = t.region ? [`${t.q} ${t.region}`, t.q] : [t.q];
    let ov = [];
    for (const q of qs) { ov = await fetchOpenverse(q).catch(() => []); if (ov.length) break; }
    const cm = await commonsSearch(qs[0]).catch(() => []);
    out.push({ id: t.id, theme: t.q, ov, cm });
  }
  return out;
}

const BAD_WORDS = /\b(trains?|railways?|railroad|roads?|buses|bus|buildings?|offices?|hospitals?|colleges?|schools?|stations?|police|junction|highway|traffic)\b/i;
// Animal and close-up subjects: covers must be scenery. Tested on the caption with underscores turned to spaces (they defeat \b).
const CRITTER = /\b(frogs?|toads?|snakes?|lizards?|geckos?|spiders?|insects?|butterfl(y|ies)|moths?|beetles?|bees?|ants?|caterpillars?|birds?|species|macro|close-?ups?|portraits?|selfies?|flowers?)\b/i;
const critter = (x) => CRITTER.test(String(x?.caption || "").replace(/_/g, " "));
// Ordered cover candidates with captions. Wikivoyage banner, Openverse destination and inspired photos (interleaved), Commons, nearby landmarks,
// famous listings' photos, the Wikipedia photo, and last a generated illustration. Captions about trains, roads or buildings drop to the end of the photos.
export function coverEntries(banner, listings, wikiImage, nearby = [], commons = [], ov = [], inspired = [], themes = []) {
  const seen = new Set();
  const mk = (u, caption = "", credit = "") => (u && goodCover(u) && !seen.has(u) && seen.add(u) ? { url: u, caption, ...(credit ? { credit } : {}) } : null);
  const list = (arr) => arr.filter(Boolean);
  const bannerE = list([mk(banner, "")]);
  const dest = list((ov || []).filter((x) => !critter(x)).slice(0, 6).map((x) => mk(x.url, x.caption, x.credit)));
  const insp = (inspired || []).map((g) => [...list((g.ov || []).filter((x) => !critter(x)).slice(0, 3).map((x) => mk(x.url, `Inspired: ${g.theme}`, x.credit))), ...list((g.cm || []).filter((x) => !critter(x)).slice(0, 2).map((x) => mk(x.url, `Inspired: ${g.theme}`)))]);
  // Interleave: destination photos and each theme's photos take turns, best first.
  const sink = (l) => [...l.filter((x) => !BAD_WORDS.test(x.caption)), ...l.filter((x) => BAD_WORDS.test(x.caption))];
  const lanes = [sink(dest).slice(0, 3), ...insp.map((l) => l.slice(0, 2)), sink(dest).slice(3), ...insp.map((l) => l.slice(2))];
  const mixed = [];
  for (let k = 0; lanes.some((l) => l[k]); k++) for (const l of lanes) if (l[k]) mixed.push(l[k]);
  const com = list((commons || []).slice(0, 3).map((x) => mk(x.url, x.caption)));
  const near = list((nearby || []).slice(0, 3).map((x) => mk(x.url, x.caption)));
  const lst = list([...(listings || [])].filter((l) => l.image && (l.type === "see" || l.type === "do")).sort((a, b) => (b.fame || 0) - (a.fame || 0)).slice(0, 3).map((l) => mk(l.image.replace(/width=\d+/, "width=1280"), l.name || "")));
  const wiki = list([mk(wikiImage, "")]);
  const photos = [...bannerE, ...mixed, ...com, ...near, ...lst, ...wiki];
  const ranked = [...photos.filter((x) => !BAD_WORDS.test(x.caption)), ...photos.filter((x) => BAD_WORDS.test(x.caption))];
  return [...ranked.slice(0, 11), { url: "illus:" + ([...(themes || [])].sort((a, b) => a.order - b.order)[0]?.id || "generic"), caption: "Illustration" }];
}
export const coverList = (...a) => coverEntries(...a).map((x) => x.url);

// Everything a cover needs, with each source failing on its own: the cover list for a destination.
export async function loadCovers({ dest, place, listings = [], lat, lng, banner }) {
  const themes = themesFor(place, listings);
  const [nearby, commons, ov, inspired] = await Promise.all([
    lat != null ? fetchNearby(lat, lng).catch(() => []) : [],
    fetchCommons(dest).catch(() => []),
    fetchOpenverse(String(dest || "").split(",")[0].trim()).catch(() => []),
    fetchInspired(themes).catch(() => []),
  ]);
  return { entries: coverEntries(banner, listings, place?.image, nearby, commons, ov, inspired, themes), themes, nearby, commons, ov, inspired };
}

// A small illustrated cover, drawn here so it always works offline: sky, sun, layered hills and mist, with motifs by theme.
const PAL = {
  coffee: ["#2d4a3a", "#1f3a2c", "#3f6b4b", "#8fb89a", "#f3d9a0"],
  tea: ["#35563a", "#274a2e", "#4d8a4f", "#a9d19b", "#f6e3a8"],
  hills: ["#2f5249", "#254238", "#3d7a68", "#a6cdc0", "#f4d9a3"],
  beach: ["#0f6f8f", "#e9cf96", "#2bb0c9", "#bfe9ef", "#ffd98a"],
  desert: ["#c9803c", "#a8642b", "#e3a55b", "#f4cf99", "#fff0c4"],
  snow: ["#4a6a8f", "#d8e6f5", "#7fa2c6", "#e8f1fa", "#fff3c9"],
  city: ["#243b5a", "#1a2c46", "#3a5a85", "#8fb0d6", "#ffd27a"],
};
PAL.fort = PAL.hills; PAL.temple = PAL.desert; PAL.backwater = PAL.coffee; PAL.lake = PAL.hills; PAL.waterfall = PAL.tea; PAL.wildlife = PAL.coffee; PAL.vineyard = PAL.tea; PAL.oldtown = PAL.city; PAL.generic = PAL.hills;
export function illustrationSvg(id) {
  const [dark, deep, mid, sky, sun] = PAL[id] || PAL.generic;
  const W = 1600, H = 900;
  const ridge = (y, amp, seed, fill, op = 1) => {
    let d = `M0 ${H} L0 ${y}`;
    for (let x = 0; x <= W; x += 100) d += ` L${x} ${Math.round(y + Math.sin(x / 210 + seed) * amp + Math.sin(x / 90 + seed * 2) * amp * 0.35)}`;
    return `<path d="${d} L${W} ${H}Z" fill="${fill}" opacity="${op}"/>`;
  };
  const mist = (y, op) => `<rect x="0" y="${y}" width="${W}" height="90" fill="url(#m)" opacity="${op}"/>`;
  let motif = "", base = "";
  if (id === "beach") {
    base = `<rect x="0" y="560" width="${W}" height="340" fill="${mid}"/><path d="M0 620 Q400 590 800 620 T1600 620 L1600 900 L0 900Z" fill="${dark}" opacity=".35"/><path d="M0 760 Q500 700 1000 770 T1600 740 L1600 900 L0 900Z" fill="${deep}"/>`;
    motif = `<path d="M1150 760 Q1170 640 1240 560 M1240 560 q-90-30-150 20 M1240 560 q-60-70-150-50 M1240 560 q60-70 150-40 M1240 560 q90-20 130 40" stroke="#3a5a2a" stroke-width="12" fill="none" stroke-linecap="round"/>`;
  } else if (id === "desert") {
    base = ridge(600, 40, 1, mid) + ridge(700, 55, 3, dark) + ridge(790, 40, 5, deep);
  } else if (id === "snow") {
    const peak = (x, h, w) => `<path d="M${x - w} 700 L${x} ${700 - h} L${x + w} 700Z" fill="${mid}"/><path d="M${x - w * 0.28} ${700 - h * 0.72} L${x} ${700 - h} L${x + w * 0.28} ${700 - h * 0.72} L${x + w * 0.1} ${700 - h * 0.62} L${x - w * 0.05} ${700 - h * 0.7}Z" fill="#fff"/>`;
    base = peak(450, 380, 360) + peak(900, 470, 420) + peak(1300, 330, 320) + ridge(720, 30, 2, dark) + ridge(800, 25, 4, deep);
  } else if (id === "city") {
    let b = ""; for (let x = 0, k = 0; x < W; x += 70 + (k % 3) * 20, k++) { const h = 140 + ((k * 97) % 260); b += `<rect x="${x}" y="${760 - h}" width="${60 + (k % 3) * 14}" height="${h + 140}" fill="${k % 2 ? dark : deep}"/>`; for (let yy = 780 - h; yy < 740; yy += 34) b += `<rect x="${x + 10}" y="${yy}" width="8" height="12" fill="${sun}" opacity=".55"/>`; }
    base = ridge(640, 25, 1, mid, 0.6) + b;
  } else {
    base = ridge(560, 55, 1, mid, 0.55) + mist(540, 0.7) + ridge(640, 60, 2.2, mid) + mist(650, 0.6) + ridge(730, 55, 4, dark) + mist(760, 0.5) + ridge(820, 40, 6, deep);
    if (id === "coffee" || id === "tea" || id === "vineyard") {
      let rows = ""; for (let r = 0; r < 4; r++) { const y = 800 + r * 28; rows += `<path d="M0 ${y} Q400 ${y - 22} 800 ${y} T1600 ${y}" stroke="${sky}" stroke-width="9" stroke-dasharray="14 12" fill="none" opacity=".28"/>`; }
      motif = rows;
    } else if (id === "fort") {
      motif = `<g fill="${deep}"><rect x="1080" y="470" width="220" height="130"/><rect x="1065" y="440" width="50" height="160"/><rect x="1265" y="440" width="50" height="160"/><path d="M1065 440h50v-18h-12v8h-8v-8h-10v8h-8v-8h-12zM1265 440h50v-18h-12v8h-8v-8h-10v8h-8v-8h-12z"/><rect x="1150" y="520" width="80" height="80" rx="40"/></g>`;
    } else if (id === "temple") {
      motif = `<g fill="${deep}"><path d="M1100 600V420l50-70 50 70v180zM1150 350v-40M1050 600V500h200v100z"/></g>`;
    } else if (id === "waterfall") {
      motif = `<rect x="1000" y="520" width="42" height="300" fill="#fff" opacity=".7" rx="20"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="0.55" stop-color="${sky}"/><stop offset="1" stop-color="${sun}"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="1180" cy="330" r="150" fill="${sun}" opacity=".35"/><circle cx="1180" cy="330" r="82" fill="${sun}"/>${base}${motif}</svg>`;
}
export const illustrationUrl = (token) => "data:image/svg+xml;utf8," + encodeURIComponent(illustrationSvg(String(token || "").slice(6))).replace(/'/g, "%27");

const variants = (dest) => {
  const parts = String(dest || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([parts.join(", "), parts[0], parts.slice(0, 2).join(", ")].filter(Boolean))];
};

export async function fetchPlace(dest) {
  for (const q of variants(dest)) {
    try {
      const r = await fetch(WIKI + encodeURIComponent(q.replace(/ /g, "_")));
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === "disambiguation" || !j.extract) continue;
      return {
        title: j.title,
        description: j.description || "",
        extract: j.extract,
        image: j.originalimage?.source || j.thumbnail?.source || "",
        url: j.content_urls?.desktop?.page || "",
        lat: j.coordinates?.lat ?? null,
        lng: j.coordinates?.lon ?? null,
      };
    } catch (e) {
      console.warn("wiki", e);
    }
  }
  return null;
}

const WMO = (c) =>
  c == null ? "" : c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌦️" : "⛈️";
const iso = (d) => d.toISOString().slice(0, 10);

export async function fetchWeather(lat, lng, startDate, nDays) {
  const n = Math.max(1, Math.min(nDays || 1, 30));
  const start = startDate ? new Date(startDate + "T00:00:00Z") : new Date();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + n - 1);
  const daysAway = (start - Date.now()) / 864e5;
  const daily = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset";
  let url, kind, shift = 0;
  if (daysAway > -1 && daysAway + n <= 15) {
    kind = "forecast";
    url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=${daily}&timezone=auto&start_date=${iso(start)}&end_date=${iso(end)}`;
  } else {
    // Too far ahead for a forecast: show what the weather was on the same dates last year.
    kind = "typical";
    shift = Math.ceil((start - Date.now()) / (365 * 864e5)) || 1;
    const s = new Date(start), e = new Date(end);
    s.setUTCFullYear(s.getUTCFullYear() - shift);
    e.setUTCFullYear(e.getUTCFullYear() - shift);
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset&timezone=auto&start_date=${iso(s)}&end_date=${iso(e)}`;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  const d = j.daily || {};
  return {
    kind,
    tz: j.timezone || "",
    fetchedAt: Date.now(),
    days: (d.time || []).map((t, i) => ({
      i,
      max: Math.round(d.temperature_2m_max?.[i]),
      min: Math.round(d.temperature_2m_min?.[i]),
      rain: d.precipitation_sum?.[i] ?? null,
      rainPct: d.precipitation_probability_max?.[i] ?? null,
      icon: WMO(d.weather_code?.[i]),
      sunrise: String(d.sunrise?.[i] || "").slice(11, 16),
      sunset: String(d.sunset?.[i] || "").slice(11, 16),
    })),
  };
}

/* ------------------------------------------------------------ Wikivoyage */
const TYPE_CAT = { see: "sight", do: "activity", eat: "food", drink: "food", sleep: "stay", buy: "shopping" };

// Pulls {{see|name=...|...}} style listings out of a Wikivoyage article.
// Only listings in the See/Do/Eat/Drink/Sleep/Buy sections count: "Get in" and "Get around" hold
// airports, stations and airlines, which are not things to visit.
const SECTION_TYPE = { see: "see", do: "do", eat: "eat", drink: "drink", sleep: "sleep", buy: "buy", shop: "buy", "eat and drink": "eat" };
const SKIP_SECTION = /^(get in|get around|connect|stay safe|stay healthy|cope|go next|understand|talk|respect|by \w+)/i;
const NOT_A_SIGHT = /permanently closed|\b(station|festival|festa|notte bianca|white night|camping|campsite|airport|aeroporto|air ?lines?|airways|wizz|ryanair|easyjet|terminal|termini|centrale|santa lucia|hauptbahnhof|railway|train station|stazione|bus station|bus stop|metro station|coach|ferry terminal|car rental|car hire|rent-a-car|taxi|parking|tourist information|post office|hospital|pharmacy|police|consulate|embassy|atm)\b/i;
export function parseListings(wikitext) {
  const out = [];
  const heads = [...wikitext.matchAll(/^==([^=].*?)==\s*$/gm)].map((h) => ({ at: h.index, name: h[1].trim().toLowerCase() }));
  const sectionAt = (i) => heads.filter((h) => h.at < i).pop()?.name || "";
  const re = /\{\{\s*(see|do|eat|drink|sleep|buy|listing)\s*\|/gi;
  let m;
  while ((m = re.exec(wikitext))) {
    let depth = 0, i = m.index, end = -1;
    for (; i < wikitext.length - 1; i++) {
      if (wikitext[i] === "{" && wikitext[i + 1] === "{") (depth++, i++);
      else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
        depth--;
        i++;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) break;
    const body = wikitext.slice(m.index + 2, end - 2);
    // split on top-level pipes only
    const parts = [];
    let cur = "", d2 = 0;
    for (let k = 0; k < body.length; k++) {
      const c = body[k], two = body.slice(k, k + 2);
      if (two === "{{" || two === "[[") (d2++, (cur += two), k++);
      else if (two === "}}" || two === "]]") (d2--, (cur += two), k++);
      else if (c === "|" && d2 === 0) (parts.push(cur), (cur = ""));
      else cur += c;
    }
    parts.push(cur);
    const f = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) f[p.slice(0, eq).trim().toLowerCase()] = clean(p.slice(eq + 1));
    }
    const section = sectionAt(m.index);
    let type = m[1].toLowerCase();
    if (type === "listing") type = (f.type || SECTION_TYPE[section] || "").toLowerCase();
    if (!TYPE_CAT[type] || !f.name) continue;
    if (SKIP_SECTION.test(section) || NOT_A_SIGHT.test(f.name)) continue;
    out.push({
      name: f.name.slice(0, 100),
      type,
      category: TYPE_CAT[type],
      content: (f.content || f.description || "").slice(0, 400),
      address: f.address || "",
      lat: parseFloat(f.lat) || null,
      lng: parseFloat(f.long || f.lon) || null,
      url: /^https?:/.test(f.url || "") ? f.url : "",
      price: (f.price || "").slice(0, 80),
      hours: (f.hours || "").slice(0, 80),
      wikidata: f.wikidata || "",
      image: f.image ? WV_IMG + encodeURIComponent(f.image.replace(/^(File|Image):/i, "")) + "?width=480" : "",
    });
    re.lastIndex = end;
  }
  return out;
}
function clean(s) {
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
async function wvPage(title) {
  const j = await getJson(WV + encodeURIComponent(title)).catch(() => null);
  if (!j) return null;
  return j.parse ? { title: j.parse.title, text: j.parse.wikitext["*"] } : null;
}
// Bumped when the guide reader changes enough that saved guides should be read again.

// Bumped when the guide reader changes enough that saved guides should be read again.
export const GUIDE_V = 7;
const WVV = "https://en.wikivoyage.org/w/api.php?action=query&prop=pageviews&redirects=1&format=json&formatversion=2&origin=*&titles=";
const WVQ = "https://en.wikivoyage.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&origin=*&titles=";
// Wikimedia answers bursts of requests with 429 and a retry-after: wait it out once.
let netErrors = 0; // failed requests during the current guide load, to tell "no listings" from "no network"
async function getJson(url) {
  try {
    for (let k = 0; k < 3; k++) {
      const r = await fetch(url);
      if (r.status === 429 && k < 2) {
        await new Promise((ok) => setTimeout(ok, Math.min(30, Number(r.headers.get("retry-after")) || 3) * 1000));
        continue;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    }
  } catch (e) { netErrors++; throw e; }
}
// Several guide pages in one request, with how often travellers read each one (last 60 days).
async function wvPages(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    // Large pages come back a few at a time: follow the continuation until every page is in.
    let cont = "";
    for (let n = 0; n < 10; n++) {
      const j = await getJson(WVQ + encodeURIComponent(titles.slice(i, i + 20).join("|")) + cont).catch(() => null);
      for (const pg of j?.query?.pages || []) {
        const text = pg.revisions?.[0]?.slots?.main?.content;
        if (text && !out.some((o) => o.title === pg.title)) out.push({ title: pg.title, text });
      }
      if (!j?.continue) break;
      cont = "&" + new URLSearchParams(j.continue).toString();
    }
  }
  return out;
}
// How often travellers read each guide page in the last 60 days, following the API's continuation.
async function wvViews(titles) {
  const views = {};
  let cont = "";
  for (let n = 0; n < 6; n++) {
    const j = await getJson(WVV + encodeURIComponent(titles.join("|")) + cont).catch(() => null);
    if (!j) break;
    for (const pg of j.query?.pages || []) if (pg.pageviews) views[pg.title] = Object.values(pg.pageviews).reduce((a, b) => a + (b || 0), 0);
    for (const r of j.query?.redirects || []) if (views[r.to] != null) views[r.from] = views[r.to];
    if (!j.continue) break;
    cont = "&" + new URLSearchParams(j.continue).toString();
  }
  return views;
}
const linksIn = (text, re) => [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1].trim().replace(/_/g, " ")).filter((t) => re.test(t)))];
const sights = (ls) => ls.filter((l) => l.type === "see" || l.type === "do").length;
// A city's own listings, plus its district pages ("Rome/Colosseo") when the main page has few sights.
async function cityListings(page) {
  let got = parseListings(page.text);
  // Big cities (a Districts section) keep most sights on their district pages, even when the main page lists a few highlights.
  if (sights(got) < 25 || /==\s*Districts\s*==|\{\{printDistricts/i.test(page.text)) {
    const own = linksIn(page.text, new RegExp("^" + page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/"));
    // The Districts section can name separate articles too: Rome's lists Vatican City, where St. Peter's is.
    const sec = page.text.match(/==\s*Districts\s*==([\s\S]*?)\n==[^=]/i)?.[1] || "";
    const named = linksIn(sec, /^(?!(File|Image|Category|Wikipedia):)/i).filter((t) => !own.includes(t) && !/phrasebook/i.test(t));
    const ds = [...own.slice(0, 20), ...named.slice(0, 3)];
    for (const d of await wvPages(ds)) got = got.concat(parseListings(d.text));
  }
  return got;
}
// How well known each place is: the number of Wikipedia languages with an article on it (via the listing's Wikidata id).
async function addFame(listings) {
  const ids = [...new Set(listings.map((l) => l.wikidata).filter((x) => /^Q\d+$/.test(x || "")))].slice(0, 300);
  const fame = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join("|")}&props=sitelinks&format=json&origin=*`).catch(() => null);
    for (const [id, e] of Object.entries(j?.entities || {})) fame[id] = Object.keys(e.sitelinks || {}).length;
    await new Promise((ok) => setTimeout(ok, 800)); // Wikidata rate-limits bursts
  }
  // Listings without a Wikidata id: look them up by their English Wikipedia title instead.
  const byTitle = {};
  const names = [...new Set(listings.filter((l) => !fame[l.wikidata] && (l.type === "see" || l.type === "do")).map((l) => l.name.replace(/^the\s+/i, "")))].slice(0, 300);
  for (let i = 0; i < names.length; i += 50) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&normalize=1&titles=${encodeURIComponent(names.slice(i, i + 50).join("|"))}&props=sitelinks&format=json&origin=*`).catch(() => null);
    for (const e of Object.values(j?.entities || {})) if (e.sitelinks?.enwiki) byTitle[e.sitelinks.enwiki.title.toLowerCase()] = Object.keys(e.sitelinks).length;
    await new Promise((ok) => setTimeout(ok, 800));
  }
  for (const l of listings) l.fame = fame[l.wikidata] || byTitle[l.name.replace(/^the\s+/i, "").toLowerCase()] || 0;
}
export async function fetchGuide(dest) {
  netErrors = 0;
  let page = null;
  for (const q of variants(dest)) if ((page = await wvPage(q).catch(() => null))) break;
  if (!page) return { listings: [], source: "", ...(netErrors ? { failed: true } : {}) };
  let listings = [];
  const sec = page.text.match(/==\s*(?:Cities|Cities and towns|Towns)\s*==([\s\S]*?)\n==[^=]/i);
  const cityNames = sec ? linksIn(sec[1], /^(?!(File|Image|Category):)/i) : [];
  if (cityNames.length >= 2) {
    // Countries and regions: the three cities travellers read about most, each with its own listings.
    const views = await wvViews(cityNames.slice(0, 15));
    const top = cityNames.slice(0, 15).map((t, k) => [t, views[t] ?? -k]).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
    const cities = await wvPages(top);
    for (const c of cities) {
      const got = await cityListings(c);
      listings = listings.concat(got.map((l) => ({ ...l, city: c.title, address: l.address ? `${l.address}, ${c.title}` : c.title })));
    }
  }
  if (!listings.length) listings = await cityListings(page);
  await addFame(listings);
  // Best known first, then well-described listings with a location.
  const score = (l) => Math.log2(1 + (l.fame || 0)) * 3 + (l.content.length > 60 ? 2 : 0) + (l.lat ? 1 : 0) + (l.image ? 1 : 0) + (l.url ? 0.5 : 0);
  const seen = new Set();
  // The same place under two names (Rialto Bridge / Ponte di Rialto) shares a Wikidata id.
  const once = (k) => !k || (!seen.has(k) && !!seen.add(k));
  listings = listings.sort((a, b) => score(b) - score(a)).filter((l) => !seen.has(l.name.toLowerCase()) && once(l.wikidata) && seen.add(l.name.toLowerCase()));
  const per = {};
  listings = listings.filter((l) => (per[(l.city || "") + l.type] = (per[(l.city || "") + l.type] || 0) + 1) <= 15);
  return { listings, source: "https://en.wikivoyage.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")), ...(!listings.length && netErrors ? { failed: true } : {}) };
}

/* ------------------------------------------------------------- one call */
export async function loadDestination(trip) {
  const dest = trip.destination;
  const place = await fetchPlace(dest);
  let lat = place?.lat, lng = place?.lng;
  if (lat == null) {
    const g = await geocode(dest).catch(() => null);
    lat = g?.lat;
    lng = g?.lng;
  }
  const [weather, guide, banner] = await Promise.all([
    lat != null ? fetchWeather(lat, lng, trip.startDate, trip.days.length).catch(() => null) : null,
    fetchGuide(dest).catch(() => ({ listings: [], source: "", failed: true })),
    fetchBanner(dest).catch(() => ""),
  ]);
  const { entries } = await loadCovers({ dest, place, listings: guide.listings, lat, lng, banner });
  const covers = entries.map((x) => x.url);
  const base = place ? { ...place, lat, lng, for: dest } : { title: dest, lat, lng, for: dest };
  base.image = covers[0] || "";
  base.covers = covers;
  base.coverCaptions = entries.map((x) => x.caption || "");
  base.coverCredits = entries.map((x) => x.credit || "");
  return { place: base, weather, guide: { ...guide, for: dest, at: Date.now(), v: GUIDE_V } };
}
