// Map of every day: Leaflet map with numbered day pins, grey idea pins, day chips and a list toggle.
// Leaflet loads lazily the first time the Map tab opens. One persistent map element survives re-renders.
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/";
const COLORS = ["#127a6c", "#d9622b", "#3b6fd4", "#a23b8f", "#b88a1c", "#4a8f2f", "#c2415d", "#6a5acd"];
const IDEA = "#8a918c";

const CSS = `
.mp { display: grid; gap: 8px; }
.mp-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.mp-chips::-webkit-scrollbar { display: none; }
.mp-chips .chip { flex: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.mp-chips .chip i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.mp-chips .chip.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.mp-host { position: relative; isolation: isolate; height: clamp(380px, calc(100dvh - 250px), 780px); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); background: var(--accent-soft); box-shadow: var(--shadow); }
.mp-host .mp-load { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; }
.mp-canvas { position: absolute; inset: 0; }
.mp-bar { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: space-between; }
.mp-bar .muted { margin: 0; }
.mp-tog { display: flex; gap: 6px; }
.mp-tog button.on { background: var(--accent-soft); border-color: var(--accent); }
.mp-pin { width: 28px; height: 28px; border-radius: 50% 50% 50% 4px; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 13px; }
.mp-pin span { transform: rotate(45deg); }
.mp-pin.idea { width: 20px; height: 20px; border-radius: 50%; transform: none; opacity: .95; }
.mp .leaflet-popup-content-wrapper, .mp .leaflet-popup-tip { background: var(--panel); color: var(--ink); }
.mp .leaflet-popup-content { margin: 12px 14px; font-family: var(--font); font-size: 14px; line-height: 1.35; min-width: 190px; }
.mp .leaflet-popup-content b { display: block; margin-bottom: 2px; }
.mp .leaflet-popup-content .muted { margin: 0 0 8px; }
.mp-pop-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.mp-pop-more { margin-top: 8px; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.mp-pop-more button { padding: 2px 9px; font-size: 12px; }
.mp .leaflet-popup-content a.btn-s { text-decoration: none; color: var(--ink); }
.mp-list { display: grid; gap: 6px; }
.mp-list h4 { margin: 8px 0 2px; font-size: 13px; color: var(--muted); font-weight: 600; }
.mp-row { display: flex; gap: 10px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 8px 10px; text-align: left; width: 100%; }
.mp-row .n { flex: none; width: 24px; height: 24px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
.mp-row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-row .muted { flex: none; }
`;

const M = {
  L: null, loading: null, failed: false,
  map: null, el: null, layer: null, markers: new Map(),
  sel: "all", ideas: true, list: false, sig: "", fitKey: "", scrolled: false, ctx: null,
};

export function init(ctx) {
  M.ctx = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-map", textContent: CSS }));
  ctx.tab({ id: "map", icon: "🗺️", label: "Map", order: 20, view: () => view(ctx) });
  ctx.slot("dayHead", (day, i) => `<button class="btn-s" data-action="mapDay" data-id="${i}" title="Show this day on the map">Map</button>`);
  ctx.on("render", () => sync(ctx));
  ctx.on("close", () => { M.sel = "all"; M.sig = ""; M.fitKey = ""; });
  ctx.action("mapDay", (btn, id) => {
    M.sel = Number(id);
    ctx.S.tab = "map";
    try { localStorage.setItem("tp-tab", "map"); } catch {}
    ctx.render();
  });
  ctx.action("mapSel", (btn, id) => { M.sel = id === "all" ? "all" : Number(id); ctx.render(); });
  ctx.action("mapIdeas", () => { M.ideas = !M.ideas; ctx.render(); });
  ctx.action("mapList", () => { M.list = !M.list; ctx.render(); });
  ctx.action("mapFind", () => ctx.runAnalyse());
  ctx.action("mapFocus", (btn, id) => focus(id));
  ctx.action("mapAdd", async (btn, id) => {
    const { S } = ctx, it = S.items.find((x) => x.id === id), day = S.trip.days[Number(btn.dataset.day)];
    if (!it || !day) return;
    M.map?.closePopup();
    await S.store.updateItem(S.tripId, id, { dayId: day.id, order: ctx.nextOrder(day.id), userEdited: true, ...ctx.stampMe() });
    await ctx.log(`scheduled “${it.title}” on ${ctx.dayLabel(day.id)}`);
    await ctx.touchTrip();
    ctx.toast(`Added to ${ctx.dayLabel(day.id)}`);
  });
}

const has = (it) => Number.isFinite(it.lat) && Number.isFinite(it.lng);
const colorOf = (i) => COLORS[i % COLORS.length];

// What is on the map right now: per shown day its stops, plus ideas.
function data(ctx) {
  const { S } = ctx;
  const days = S.trip.days.map((d, i) => ({ d, i, stops: ctx.dayItems(d.id) }));
  const shown = M.sel === "all" ? days : days.filter((x) => x.i === M.sel);
  const ideas = M.ideas ? ctx.ideas() : [];
  const all = [...shown.flatMap((x) => x.stops), ...ideas];
  return { days, shown, ideas, unmapped: all.filter((it) => !has(it) && !it.rest) };
}

function view(ctx) {
  const { S, esc } = ctx;
  const t = S.trip;
  if (M.sel !== "all" && M.sel >= t.days.length) M.sel = "all";
  const { shown, ideas, unmapped } = data(ctx);
  const chip = (id, label, color) => `<button class="chip ${String(M.sel) === String(id) ? "on" : ""}" data-action="mapSel" data-id="${id}">${color ? `<i style="background:${color}"></i>` : ""}${label}</button>`;
  const none = shown.every((x) => !x.stops.some(has)) && !ideas.some(has);
  const canFind = unmapped.some((it) => !it.geoFailed);
  const row = (it, n, color) => `<button class="mp-row" data-action="mapFocus" data-id="${it.id}"><span class="n" style="background:${color}">${n}</span><span class="t">${esc(it.title)}</span>${has(it) ? "" : `<span class="muted small">not on map</span>`}</button>`;
  return `<div class="mp">
    <div class="mp-chips">${chip("all", "All days")}${t.days.map((d, i) => chip(i, `Day ${i + 1}`, colorOf(i))).join("")}</div>
    <div class="mp-host" id="mapHost"><div class="mp-load">${M.failed ? "Couldn't load the map. Check your connection." : "Loading map…"}</div></div>
    <div class="mp-bar">
      ${unmapped.length
        ? `<p class="muted small">${unmapped.length} place${unmapped.length > 1 ? "s aren't" : " isn't"} on the map yet. ${S.analysing ? esc(S.analysing) : canFind ? `<button class="link" data-action="mapFind">Find them</button>` : "Edit their location to fix it."}</p>`
        : none ? `<p class="muted small">${M.sel === "all" ? "Nothing to show yet. Add places and they appear here." : "Nothing on the map for this day yet."}</p>` : `<p class="muted small">Tap a pin to add it to a day or get directions.</p>`}
      <div class="mp-tog">
        <button class="btn-s ${M.ideas ? "on" : ""}" data-action="mapIdeas" aria-pressed="${M.ideas}">💡 Ideas</button>
        <button class="btn-s ${M.list ? "on" : ""}" data-action="mapList" aria-pressed="${M.list}">${M.list ? "Hide list" : "Show list"}</button>
      </div>
    </div>
    ${M.list ? `<div class="mp-list">${shown.map((x) => {
      let n = 0;
      return x.stops.length ? `<h4>Day ${x.i + 1}${x.d.title ? " · " + esc(x.d.title) : ""}</h4>${x.stops.map((it) => row(it, has(it) ? ++n : "–", colorOf(x.i))).join("")}` : "";
    }).join("")}${ideas.length ? `<h4>Ideas</h4>${ideas.map((it) => row(it, "💡", IDEA)).join("")}` : ""}</div>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------- leaflet */
function loadLeaflet() {
  if (M.L) return Promise.resolve(M.L);
  if (M.loading) return M.loading;
  M.loading = new Promise((resolve, reject) => {
    if (window.L?.map) return resolve(window.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET + "leaflet.css";
    document.head.append(css);
    const js = document.createElement("script");
    js.src = LEAFLET + "leaflet.js";
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error("no L")));
    js.onerror = () => reject(new Error("load failed"));
    document.head.append(js);
  }).then((L) => (M.L = L), (e) => { M.failed = true; M.loading = null; M.ctx.render(); throw e; });
  return M.loading;
}

function sync(ctx) {
  const { S } = ctx;
  if (S.tab !== "map" || !S.trip) { M.scrolled = false; return; }
  const host = document.getElementById("mapHost");
  if (!host) return;
  if (!M.L) { loadLeaflet().then(() => sync(ctx)).catch(() => {}); return; }
  const L = M.L;
  if (!M.el) {
    M.el = document.createElement("div");
    M.el.className = "mp-canvas";
  }
  host.append(M.el);
  if (!M.map) {
    M.map = L.map(M.el, { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(M.map);
    M.layer = L.layerGroup().addTo(M.map);
  }
  M.map.invalidateSize();
  // Opening the tab brings the day chips and the map to the top of the screen (the trip header is tall).
  if (!M.scrolled) {
    M.scrolled = true;
    window.scrollTo(0, Math.max(0, window.scrollY + host.parentElement.getBoundingClientRect().top - 62));
  }
  draw(ctx);
}

const pinIcon = (n, color) => M.L.divIcon({ className: "", html: `<div class="mp-pin" style="background:${color}"><span>${n}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
const ideaIcon = () => M.L.divIcon({ className: "", html: `<div class="mp-pin idea" style="background:${IDEA}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10] });

// Redraws pins and lines only when what they show has changed.
function draw(ctx) {
  const { S } = ctx;
  const { shown, ideas } = data(ctx);
  const pick = (it) => [it.id, it.title, it.lat, it.lng, it.dayId, it.order, it.category];
  const sig = JSON.stringify([M.sel, M.ideas, S.trip.days.map((d) => d.id), shown.map((x) => x.stops.map(pick)), ideas.map(pick)]);
  if (sig === M.sig) return;
  M.sig = sig;
  const L = M.L;
  M.layer.clearLayers();
  M.markers.clear();
  const bounds = [];
  for (const g of ideas) {
    if (!has(g)) continue;
    const m = L.marker([g.lat, g.lng], { icon: ideaIcon(), title: g.title }).bindPopup(() => popup(ctx, g, null)).addTo(M.layer);
    M.markers.set(g.id, m);
    bounds.push([g.lat, g.lng]);
  }
  for (const x of shown) {
    const color = colorOf(x.i);
    const pts = x.stops.filter(has);
    if (pts.length > 1) L.polyline(pts.map((p) => [p.lat, p.lng]), { color, weight: 4, opacity: 0.8 }).addTo(M.layer);
    pts.forEach((p, k) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(k + 1, color), title: p.title, zIndexOffset: 100 }).bindPopup(() => popup(ctx, p, x.i)).addTo(M.layer);
      M.markers.set(p.id, m);
      bounds.push([p.lat, p.lng]);
    });
  }
  const key = String(M.sel) + (M.ideas ? "i" : "") + ":" + S.tripId;
  if (bounds.length && key !== M.fitKey) {
    M.fitKey = key;
    if (bounds.length === 1) M.map.setView(bounds[0], 13);
    else M.map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
  }
}

function popup(ctx, it, dayIdx) {
  const { S, esc } = ctx;
  const cat = ctx.CATEGORIES[it.category] || ctx.CATEGORIES.other;
  const days = S.trip.days;
  const where = dayIdx == null ? "In your ideas" : `Day ${dayIdx + 1}`;
  const want = typeof M.sel === "number" ? M.sel : nearestDay(ctx, it);
  const add = dayIdx == null && days.length
    ? `<button class="btn-s primary" data-action="mapAdd" data-id="${it.id}" data-day="${want}">Add to Day ${want + 1}</button>` : "";
  const others = dayIdx == null && days.length > 1
    ? `<div class="mp-pop-more">or ${days.map((d, i) => (i === want ? "" : `<button class="btn-s" data-action="mapAdd" data-id="${it.id}" data-day="${i}">Day ${i + 1}</button>`)).join("")}</div>` : "";
  return `<b>${esc(it.title)}</b><p class="muted small">${cat.icon} ${cat.label} · ${where}</p>
    <div class="mp-pop-acts">${add}<a class="btn-s" href="${esc(ctx.directionsUrl(it))}" target="_blank" rel="noopener">Directions</a></div>${others}`;
}

// The day whose stops are closest to a place (for the suggested "Add to Day N").
function nearestDay(ctx, it) {
  let best = 0, bd = Infinity;
  ctx.S.trip.days.forEach((d, i) => {
    for (const s of ctx.dayItems(d.id).filter(has)) {
      const dd = (s.lat - it.lat) ** 2 + (s.lng - it.lng) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
  });
  return best;
}

function focus(id) {
  const m = M.markers.get(id);
  if (!m || !M.map) return;
  window.scrollTo(0, Math.max(0, window.scrollY + M.el.parentElement.getBoundingClientRect().top - 62));
  M.map.setView(m.getLatLng(), Math.max(M.map.getZoom(), 14));
  m.openPopup();
}
