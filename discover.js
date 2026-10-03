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
// Only listings in the See/Do/Eat/Drink/Sleep/Buy sections count: "Get in" and "Get around" hold
// airports, stations and airlines, which are not things to visit.
const SECTION_TYPE = { see: "see", do: "do", eat: "eat", drink: "drink", sleep: "sleep", buy: "buy", shop: "buy", "eat and drink": "eat" };
const SKIP_SECTION = /^(get in|get around|connect|stay safe|stay healthy|cope|go next|understand|talk|respect|by \w+)/i;
const NOT_A_SIGHT = /permanently closed|\b(station|festival|festa|notte bianca|white night|camping|campsite|airport|aeroporto|air ?lines?|airways|wizz|ryanair|easyjet|terminal|railway|train station|stazione|bus station|bus stop|metro station|coach|ferry terminal|car rental|car hire|rent-a-car|taxi|parking|tourist information|post office|hospital|pharmacy|police|consulate|embassy|atm)\b/i;
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
export const GUIDE_V = 3;
const WVV = "https://en.wikivoyage.org/w/api.php?action=query&prop=pageviews&redirects=1&format=json&formatversion=2&origin=*&titles=";
const WVQ = "https://en.wikivoyage.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&origin=*&titles=";
// Wikimedia answers bursts of requests with 429 and a retry-after: wait it out once.
async function getJson(url) {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(url);
    if (r.status === 429 && k < 2) {
      await new Promise((ok) => setTimeout(ok, Math.min(30, Number(r.headers.get("retry-after")) || 3) * 1000));
      continue;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
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
  if (sights(got) < 25) {
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
  const ids = [...new Set(listings.map((l) => l.wikidata).filter((x) => /^Q\d+$/.test(x || "")))].slice(0, 200);
  const fame = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join("|")}&props=sitelinks&format=json&origin=*`).catch(() => null);
    for (const [id, e] of Object.entries(j?.entities || {})) fame[id] = Object.keys(e.sitelinks || {}).length;
    await new Promise((ok) => setTimeout(ok, 800)); // Wikidata rate-limits bursts
  }
  // Listings without a Wikidata id: look them up by their English Wikipedia title instead.
  const byTitle = {};
  const names = [...new Set(listings.filter((l) => !fame[l.wikidata] && (l.type === "see" || l.type === "do")).map((l) => l.name.replace(/^the\s+/i, "")))].slice(0, 100);
  for (let i = 0; i < names.length; i += 50) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&normalize=1&titles=${encodeURIComponent(names.slice(i, i + 50).join("|"))}&props=sitelinks&format=json&origin=*`).catch(() => null);
    for (const e of Object.values(j?.entities || {})) if (e.sitelinks?.enwiki) byTitle[e.sitelinks.enwiki.title.toLowerCase()] = Object.keys(e.sitelinks).length;
    await new Promise((ok) => setTimeout(ok, 800));
  }
  for (const l of listings) l.fame = fame[l.wikidata] || byTitle[l.name.replace(/^the\s+/i, "").toLowerCase()] || 0;
}
export async function fetchGuide(dest) {
  let page = null;
  for (const q of variants(dest)) if ((page = await wvPage(q).catch(() => null))) break;
  if (!page) return { listings: [], source: "" };
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
  listings = listings.filter((l) => !seen.has(l.name) && seen.add(l.name)).sort((a, b) => score(b) - score(a));
  const per = {};
  listings = listings.filter((l) => (per[(l.city || "") + l.type] = (per[(l.city || "") + l.type] || 0) + 1) <= 15);
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
  return { place: place ? { ...place, lat, lng, for: dest } : { title: dest, lat, lng, for: dest }, weather, guide: { ...guide, for: dest, at: Date.now(), v: GUIDE_V } };
}
