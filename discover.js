// Destination info and starter suggestions, all from free sources that work straight from the browser:
//  - Wikipedia: photo and short description of the destination
//  - Open-Meteo: weather forecast (or last year's weather for the same dates when the trip is far off)
//  - Wikivoyage: the travel guide's own picks for sights, things to do, food, drinks and places to stay
//  - Gemini (optional, with your free API key): top-rated picks with ratings, using Google Search
import { geocode } from "./smart.js";

const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const WV = "https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&origin=*&page=";
const WV_IMG = "https://commons.wikimedia.org/wiki/Special:FilePath/";

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
  const daily = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max";
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
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${iso(s)}&end_date=${iso(e)}`;
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
    })),
  };
}

/* ------------------------------------------------------------ Wikivoyage */
const TYPE_CAT = { see: "sight", do: "activity", eat: "food", drink: "food", sleep: "stay", buy: "shopping" };

// Pulls {{see|name=...|...}} style listings out of a Wikivoyage article.
export function parseListings(wikitext) {
  const out = [];
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
    let type = m[1].toLowerCase();
    if (type === "listing") type = (f.type || "see").toLowerCase();
    if (!TYPE_CAT[type] || !f.name) continue;
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
  const r = await fetch(WV + encodeURIComponent(title));
  if (!r.ok) return null;
  const j = await r.json();
  return j.parse ? { title: j.parse.title, text: j.parse.wikitext["*"] } : null;
}
export async function fetchGuide(dest) {
  let page = null;
  for (const q of variants(dest)) if ((page = await wvPage(q).catch(() => null))) break;
  if (!page) return { listings: [], source: "" };
  let listings = parseListings(page.text);
  // Big cities keep their listings on district pages: read a few of those too.
  if (listings.length < 15) {
    const districts = [...page.text.matchAll(/\[\[([^\]|#]+\/[^\]|#]+)/g)].map((x) => x[1].trim()).filter((t) => t.startsWith(page.title + "/"));
    for (const t of [...new Set(districts)].slice(0, 4)) {
      const p = await wvPage(t).catch(() => null);
      if (p) listings = listings.concat(parseListings(p.text));
    }
  }
  // Prefer well-described listings with a location.
  const score = (l) => (l.content.length > 60 ? 2 : 0) + (l.lat ? 1 : 0) + (l.image ? 1 : 0) + (l.url ? 0.5 : 0);
  const seen = new Set();
  listings = listings.filter((l) => !seen.has(l.name) && seen.add(l.name)).sort((a, b) => score(b) - score(a));
  const per = {};
  listings = listings.filter((l) => (per[l.type] = (per[l.type] || 0) + 1) <= 12);
  return { listings, source: "https://en.wikivoyage.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")) };
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
  const [weather, guide] = await Promise.all([
    lat != null ? fetchWeather(lat, lng, trip.startDate, trip.days.length).catch(() => null) : null,
    fetchGuide(dest).catch(() => ({ listings: [], source: "" })),
  ]);
  return { place: place ? { ...place, lat, lng, for: dest } : { title: dest, lat, lng, for: dest }, weather, guide: { ...guide, for: dest, at: Date.now() } };
}
