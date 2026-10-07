// Stops along a drive: on a long leg, suggest viewpoints, sights and vegetarian-friendly places near the route
// (OSRM demo server for the route, Overpass for places; both free). Adding inserts the stop between the two.
const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const LONG_KM = 25;       // a leg longer than this gets the link
const BASE_KM = 10;       // ... or between days with different bases, when at least this far
const NEAR_KM = 3;        // search radius around the route
const SAMPLES = 40;       // route points sent to Overpass

const CSS = `
.al { margin: 2px 0 6px; }
.al-link { font-size: 13px; padding: 2px 0; }
.al-panel { margin-top: 6px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; display: grid; gap: 8px; }
.al-panel p { margin: 0; }
.al-row { display: flex; gap: 10px; align-items: center; }
.al-row .al-ic { flex: none; font-size: 20px; }
.al-row .al-t { flex: 1; min-width: 0; }
.al-row .al-t b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.al-row .btn-s { flex: none; }
.al-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
`;

const A = { open: null, cache: new Map(), status: {}, ctx: null };
const has = (it) => Number.isFinite(it?.lat) && Number.isFinite(it?.lng);
const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function init(ctx) {
  A.ctx = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-along", textContent: CSS }));
  ctx.slot("card", (it, opts) => (opts?.inDay ? slotHtml(ctx, it) : ""));
  ctx.on("close", () => { A.open = null; });
  ctx.action("alongOpen", (btn, id) => open(ctx, id));
  ctx.action("alongClose", () => { A.open = null; ctx.render(); });
  ctx.action("alongAdd", (btn, id) => add(ctx, id, Number(btn.dataset.k)));
}

// The stop before `it`: the one above it in the day, or the last stop of the previous day when the base changes.
function legFrom(ctx, it) {
  const { S } = ctx;
  const di = S.trip.days.findIndex((d) => d.id === it.dayId);
  if (di < 0 || !has(it)) return null;
  const list = ctx.dayItems(it.dayId);
  const k = list.findIndex((x) => x.id === it.id);
  if (k > 0) return has(list[k - 1]) && km(list[k - 1], it) > LONG_KM ? { prev: list[k - 1], same: true } : null;
  if (di === 0) return null;
  const pd = S.trip.days[di - 1], d = S.trip.days[di];
  const prevList = ctx.dayItems(pd.id);
  const prev = prevList[prevList.length - 1];
  if (!has(prev)) return null;
  const dist = km(prev, it);
  const baseChange = pd.base && d.base && pd.base.trim().toLowerCase() !== d.base.trim().toLowerCase();
  return dist > LONG_KM || (baseChange && dist > BASE_KM) ? { prev, same: false } : null;
}

function slotHtml(ctx, it) {
  const leg = legFrom(ctx, it);
  if (!leg) return "";
  const dist = Math.round(km(leg.prev, it));
  const isOpen = A.open === it.id;
  return `<div class="al"><button class="link al-link" data-action="alongOpen" data-id="${it.id}" aria-expanded="${isOpen}">🧭 Stops along the way · ${dist} km</button>${isOpen ? panel(ctx, it) : ""}</div>`;
}

function panel(ctx, it) {
  const { esc } = ctx;
  const st = A.status[it.id] || { state: "load" };
  const head = `<div class="al-head"><b class="small">Along the way to ${esc(it.title)}</b><button class="btn-s" data-action="alongClose">Close</button></div>`;
  if (st.state === "load") return `<div class="al-panel">${head}<p class="muted small">⏳ Looking for places near the road…</p></div>`;
  if (st.state === "error") return `<div class="al-panel">${head}<p class="muted small">Couldn't look up places right now. <button class="link" data-action="alongOpen" data-id="${it.id}">Try again</button></p></div>`;
  const res = st.results;
  if (!res.length) return `<div class="al-panel">${head}<p class="muted small">Nothing notable found near this route.${st.straight ? " (Straight line: the route service didn't answer.)" : ""}</p></div>`;
  return `<div class="al-panel">${head}
    ${res.map((r, k) => `<div class="al-row"><span class="al-ic">${r.icon}</span><div class="al-t"><b>${esc(r.name)}</b><span class="muted small">${esc(r.kind)} · about ${r.detour} min detour${r.known ? " · well known" : ""}</span></div><button class="btn-s primary" data-action="alongAdd" data-id="${it.id}" data-k="${k}">Add to this day</button></div>`).join("")}
    <p class="muted small">From OpenStreetMap${st.straight ? " (straight line, the route service didn't answer)" : ""}. Nothing is added until you tap.</p></div>`;
}

async function open(ctx, id) {
  const it = ctx.S.items.find((x) => x.id === id);
  const leg = it && legFrom(ctx, it);
  if (!leg) return;
  const retry = A.status[id]?.state === "error";
  if (A.open === id && !retry) { A.open = null; return ctx.render(); }
  A.open = id;
  const key = `${leg.prev.lat},${leg.prev.lng};${it.lat},${it.lng}`;
  if (A.cache.has(key) && !retry) {
    const c = A.cache.get(key);
    A.status[id] = { ...c, results: c.results.filter((r) => !ctx.inTrip(r.name)) };
    return ctx.render();
  }
  A.status[id] = { state: "load" };
  ctx.render();
  try {
    const out = await suggest(leg.prev, it, ctx);
    A.cache.set(key, (A.status[id] = { state: "ok", ...out }));
  } catch (e) {
    console.warn("along", e);
    A.status[id] = { state: "error" };
  }
  ctx.render();
}

/* ------------------------------------------------------------ route + places */
async function getJson(url, opts = {}, ms = 9000) {
  const ac = new AbortController();
  const h = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(h);
  }
}
async function route(a, b) {
  try {
    const j = await getJson(`${OSRM}${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`);
    const c = j.routes?.[0]?.geometry?.coordinates;
    if (c?.length > 1) return { line: c.map(([lng, lat]) => ({ lat, lng })), straight: false };
  } catch (e) {
    console.warn("OSRM", e.message);
  }
  return { line: [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], straight: true };
}
// Up to n points spaced evenly by distance along the line.
function sample(line, n) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) { const d = km(line[i - 1], line[i]); seg.push(d); total += d; }
  const count = Math.max(2, Math.min(n, Math.ceil(total / 5) + 1));
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (i < seg.length - 1 && acc + seg[i] < target) acc += seg[i++];
    const f = seg[i] ? Math.min(1, Math.max(0, (target - acc) / seg[i])) : 0;
    out.push({ lat: line[i].lat + (line[i + 1].lat - line[i].lat) * f, lng: line[i].lng + (line[i + 1].lng - line[i].lng) * f });
  }
  return out;
}
// Shortest distance (km) from a point to the route line.
function offRoute(p, line) {
  const kx = Math.cos(rad(p.lat)) * 111.32, ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1].lng - p.lng) * kx, ay = (line[i - 1].lat - p.lat) * ky;
    const bx = (line[i].lng - p.lng) * kx, by = (line[i].lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
function query(points) {
  const around = `(around:${NEAR_KM * 1000},${points.map((p) => p.lat.toFixed(4) + "," + p.lng.toFixed(4)).join(",")})`;
  return `[out:json][timeout:25];(
nwr["tourism"~"^(viewpoint|attraction|museum)$"]${around};
nwr["historic"~"^(castle|monument|ruins|archaeological_site)$"]${around};
nwr["natural"~"^(waterfall|peak)$"]${around};
nwr["amenity"~"^(restaurant|cafe)$"]["diet:vegetarian"~"^(yes|only)$"]${around};
);out center tags 150;`;
}
const KINDS = {
  viewpoint: ["Viewpoint", "🌄", "nature"], attraction: ["Attraction", "🎡", "sight"], museum: ["Museum", "🏛️", "sight"],
  castle: ["Castle", "🏰", "sight"], monument: ["Monument", "🗿", "sight"], ruins: ["Ruins", "🏺", "sight"], archaeological_site: ["Archaeological site", "🏺", "sight"],
  waterfall: ["Waterfall", "💧", "nature"], peak: ["Peak", "⛰️", "nature"],
  restaurant: ["Restaurant with vegetarian food", "🥗", "food"], cafe: ["Café with vegetarian food", "☕", "food"],
};
function kindOf(tags) {
  const k = KINDS[tags.tourism] || KINDS[tags.historic] || KINDS[tags.natural] || KINDS[tags.amenity];
  return k ? { kind: k[0], icon: k[1], category: k[2] } : null;
}

async function suggest(prev, to, ctx) {
  const { line, straight } = await route(prev, to);
  const pts = sample(line, SAMPLES);
  const j = await getJson(OVERPASS, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query(pts)) }, 25000);
  const seen = new Set([prev.title, to.title].map((s) => String(s).trim().toLowerCase()));
  const found = [];
  for (const el of j.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    const k = kindOf(tags);
    const name = (tags.name || "").trim();
    if (!k || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || ctx.inTrip(name)) continue;
    const p = { lat, lng };
    if (km(p, prev) < 4 || km(p, to) < 4) continue; // that's the town you're leaving or arriving in
    const off = offRoute(p, line);
    if (off > NEAR_KM) continue;
    seen.add(key);
    const url = tags.website || tags["contact:website"] || "";
    found.push({
      name, ...k, lat, lng, off,
      detour: Math.round(((2 * off) / 40) * 60 + 15),
      known: !!(tags.wikidata || tags.wikipedia),
      url: /^https?:\/\//i.test(url) ? url : "",
      addr: [[tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "), tags["addr:city"]].filter(Boolean).join(", "),
    });
  }
  found.sort((a, b) => b.known - a.known || a.detour - b.detour);
  let food = 0;
  const results = found.filter((r) => (r.category !== "food" || ++food <= 3)).slice(0, 8);
  return { results, straight };
}

/* ----------------------------------------------------------------- insert */
async function add(ctx, id, k) {
  const { S } = ctx;
  const it = S.items.find((x) => x.id === id);
  const r = A.status[id]?.results?.[k];
  const leg = it && legFrom(ctx, it);
  if (!r || !leg) return;
  const from = leg.prev;
  // Between the two stops of a day, or at the start of this day when the leg comes from the day before.
  const order = leg.same ? (from.order + it.order) / 2 : it.order - 1;
  const dayId = it.dayId;
  const veg = r.category === "food" ? { veg: "yes", vegNote: "Listed with vegetarian food on OpenStreetMap" } : {};
  await S.store.addItem(S.tripId, {
    title: r.name.slice(0, 140), description: `On the way from ${from.title} to ${it.title}, about ${r.detour} min detour.`, image: "", siteName: "OpenStreetMap",
    location: r.addr || r.name, url: r.url, lat: r.lat, lng: r.lng, category: r.category, dayId, order, time: "",
    durationMin: r.category === "food" ? 60 : 45, cost: 0, mustDo: false, notes: r.kind, ...veg,
    userEdited: true, addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...ctx.stampMe(),
  });
  await ctx.log(`added “${r.name}” to ${ctx.dayLabel(dayId)}, on the way from “${from.title}” to “${it.title}”`);
  await ctx.touchTrip();
  ctx.toast(`Added “${r.name}” to ${ctx.dayLabel(dayId)}`);
  // The remaining suggestions stay open; the added one leaves the list.
  A.status[id] = { ...A.status[id], results: A.status[id].results.filter((_, i) => i !== k) };
  ctx.render();
}
