import { createStore } from "./store.js";
import { unfurl, extractUrl, sourceOf } from "./unfurl.js";
import { analyse, locateAll, km, has, recommendMode, geocode } from "./smart.js";
import { readLink } from "./linkinfo.js";
import { loadDestination, fetchWeather } from "./discover.js";
import { topPicks, reviewPlan, testKey, extractLink } from "./ai.js";
import { DEFAULT_PROFILE, profileOf, profileText, buildSample, vegTip, chooseMode, vegOk } from "./profile.js";

/* ---------------------------------------------------------------- constants */
const CATEGORIES = {
  sight: { label: "Sightseeing", icon: "🏛️" },
  activity: { label: "Activity", icon: "🎟️" },
  food: { label: "Food & drink", icon: "🍜" },
  stay: { label: "Stay", icon: "🛏️" },
  shopping: { label: "Shopping", icon: "🛍️" },
  nature: { label: "Nature", icon: "🌿" },
  transport: { label: "Flights & tickets", icon: "🎫" },
  other: { label: "Other", icon: "📌" },
};
const MODES = {
  walk: { label: "Walk", icon: "🚶", gm: "walking" },
  transit: { label: "Public transport", icon: "🚇", gm: "transit" },
  bus: { label: "Bus", icon: "🚌", gm: "transit" },
  train: { label: "Train", icon: "🚆", gm: "transit" },
  car: { label: "Own car", icon: "🚗", gm: "driving" },
  rental: { label: "Rental / hired car", icon: "🚙", gm: "driving" },
  taxi: { label: "Taxi / ride-share", icon: "🚕", gm: "driving" },
  bike: { label: "Bike / scooter", icon: "🚲", gm: "bicycling" },
  ferry: { label: "Ferry / boat", icon: "⛴️", gm: "transit" },
  flight: { label: "Flight", icon: "✈️", gm: "" },
};
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "THB", "JPY", "AUD", "CAD", "CHF", "IDR", "LKR", "MYR", "VND"];

/* -------------------------------------------------------------------- state */
const S = {
  store: null,
  me: null,
  trips: [],
  tripId: null,
  trip: null,
  items: [],
  activity: [],
  presence: [],
  tab: localGet("tab") || "plan",
  busy: false,
  unsubs: [],
  flash: new Set(),
};
const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $form = document.getElementById("modalForm");

function localGet(k) {
  try { return localStorage.getItem("tp-" + k); } catch { return null; }
}
function localSet(k, v) {
  try { localStorage.setItem("tp-" + k, v); } catch {}
}

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const uid = () => Math.random().toString(36).slice(2, 9);
const firstName = (n) => String(n || "").split(/[\s@]/)[0];

function money(n, cur = S.trip?.currency || "INR") {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
  } catch {
    return cur + " " + v.toLocaleString();
  }
}
function ago(ms) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const stamp = (ms) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function dayDate(i) {
  if (!S.trip?.startDate) return null;
  const d = new Date(S.trip.startDate + "T00:00:00");
  d.setDate(d.getDate() + i);
  return d;
}
const fmtDay = (d) => (d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "");
const toMin = (hhmm) => (/^\d{1,2}:\d{2}$/.test(hhmm || "") ? +hhmm.split(":")[0] * 60 + +hhmm.split(":")[1] : null);
const fromMin = (m) => {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
  return `${h}:${mm}`;
};
const dur = (m) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`);
const nameOf = (email) => S.trip?.memberNames?.[email] || (email === S.me?.email ? S.me.name : firstName(email));
const who = (email) => (email === S.me?.email ? "You" : firstName(nameOf(email)));

function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), ms);
}
function stampMe() {
  return { updatedBy: S.me.email, updatedByName: S.me.name, updatedAt: Date.now() };
}
async function log(text) {
  if (!S.tripId) return;
  await S.store.log(S.tripId, { at: Date.now(), by: S.me.email, byName: S.me.name, text });
}
async function touchTrip() {
  await S.store.updateTrip(S.tripId, stampMe());
}

/* ------------------------------------------------------------ derived data */
const dayItems = (dayId) => S.items.filter((i) => i.dayId === dayId).sort((a, b) => a.order - b.order);
const ideas = () => S.items.filter((i) => !i.dayId || !S.trip.days.some((d) => d.id === i.dayId)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

// Works out a timeline for a day: fixed times win, otherwise previous end + travel time.
function schedule(dayId) {
  const day = S.trip.days.find((d) => d.id === dayId);
  let clock = toMin(day?.startTime) ?? 9 * 60;
  return dayItems(dayId).map((it, idx) => {
    const travel = idx > 0 || it.travel?.fromPrevDay ? Number(it.travel?.minutes) || 0 : 0;
    const fixed = toMin(it.time);
    const start = fixed ?? clock + travel;
    const end = start + (Number(it.durationMin) || 60);
    clock = end;
    return { it, start, end, auto: fixed == null };
  });
}
function costs() {
  const byCat = {};
  let transport = 0;
  for (const it of S.items) {
    if (!S.trip.days.some((d) => d.id === it.dayId)) continue;
    byCat[it.category || "other"] = (byCat[it.category || "other"] || 0) + (Number(it.cost) || 0);
    transport += Number(it.travel?.cost) || 0;
  }
  const extras = (S.trip.extras || []).reduce((s, e) => s + (Number(e.cost) || 0), 0);
  const total = Object.values(byCat).reduce((a, b) => a + b, 0) + transport + extras;
  return { byCat, transport, extras, total };
}
function dayCost(dayId) {
  return dayItems(dayId).reduce((s, it) => s + (Number(it.cost) || 0) + (Number(it.travel?.cost) || 0), 0);
}
function checks() {
  const out = [];
  const c = costs();
  const budget = Number(S.trip.budget) || 0;
  if (budget && c.total > budget) out.push({ level: "bad", text: `Over budget by ${money(c.total - budget)}.` });
  else if (budget && c.total > budget * 0.9) out.push({ level: "warn", text: `Within 10% of the budget (${money(budget - c.total)} left).` });
  const must = ideas().filter((i) => i.mustDo);
  for (const m of must) out.push({ level: "warn", text: `${who(m.addedBy)} marked “${m.title}” as a must-do, but it isn't on a day yet.` });
  S.trip.days.forEach((d, i) => {
    const sch = schedule(d.id);
    if (sch.length && sch[sch.length - 1].end > 22 * 60 + 30)
      out.push({ level: "warn", text: `Day ${i + 1} runs until ${fromMin(sch[sch.length - 1].end)}. Consider moving something.` });
    for (let k = 1; k < sch.length; k++) {
      if (!sch[k].auto && sch[k].start < sch[k - 1].end + (Number(sch[k].it.travel?.minutes) || 0))
        out.push({ level: "warn", text: `Day ${i + 1}: not enough time to reach “${sch[k].it.title}” by ${fromMin(sch[k].start)}.` });
      if (sch[k].it.travel == null || !sch[k].it.travel.mode)
        out.push({ level: "info", text: `Day ${i + 1}: how will you get to “${sch[k].it.title}”? Add the transport.` });
    }
  });
  return out;
}

/* ----------------------------------------------------------- subscriptions */
function stopTrip() {
  S.unsubs.forEach((u) => u && u());
  S.unsubs = [];
  clearInterval(S.hb);
  S.trip = null;
  S.items = [];
  S.activity = [];
  S.presence = [];
}
function openTrip(id) {
  stopTrip();
  S.tripId = id;
  localSet("trip", id);
  if (location.hash !== "#trip=" + id) history.replaceState(null, "", "#trip=" + id);
  let prevItems = new Map();
  S.unsubs.push(
    S.store.watchTrip(id, (t) => {
      if (!t) {
        toast("That trip was deleted or you don't have access.");
        goHome();
        return;
      }
      S.trip = { days: [], members: [], memberNames: {}, ...t };
      render();
      ensureDestination();
    }, (e) => {
      toast("No access to this trip.");
      console.error(e);
      goHome();
    }),
    S.store.watchItems(id, (items) => {
      // Flash cards the other person just changed so live edits are easy to spot.
      for (const it of items) {
        const old = prevItems.get(it.id);
        if (it.updatedBy && it.updatedBy !== S.me.email && (!old || old.updatedAt !== it.updatedAt) && Date.now() - (it.updatedAt || 0) < 15000)
          S.flash.add(it.id);
      }
      prevItems = new Map(items.map((i) => [i.id, i]));
      S.items = items;
      render();
      setTimeout(() => { S.flash.clear(); }, 2500);
    }),
    S.store.watchActivity(id, (a) => { S.activity = a; render(); }),
    S.store.watchPresence(id, (p) => { S.presence = p; renderPresence(); })
  );
  const beat = () => S.store.heartbeat(id, S.me).catch(() => {});
  beat();
  S.hb = setInterval(beat, 20000);
}
function goHome() {
  stopTrip();
  S.tripId = null;
  localSet("trip", "");
  history.replaceState(null, "", location.pathname + location.search);
  render();
}

/* ------------------------------------------------------------------ render */
// Re-rendering replaces the DOM; keep whatever the person is typing (and the cursor) intact.
function render() {
  const a = document.activeElement;
  const keep = a && a.id && $app.contains(a) ? { id: a.id, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
  const scroll = window.scrollY;
  $app.innerHTML = !S.me ? viewSignIn() : S.tripId && S.trip ? viewTrip() : S.tripId ? `<div class="loading">Opening trip…</div>` : viewHome();
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.v;
      el.focus();
      try { el.setSelectionRange(keep.s, keep.e); } catch {}
    }
  }
  window.scrollTo(0, scroll);
  renderUser();
  renderPresence();
}
function renderUser() {
  const box = document.getElementById("userBox");
  box.innerHTML = S.me
    ? `<span class="me" title="${esc(S.me.email)}">${S.me.photo ? `<img src="${esc(S.me.photo)}" alt="">` : ""}${esc(firstName(S.me.name))}</span>
       <button class="link" data-action="signout">Sign out</button>`
    : "";
}
function renderPresence() {
  const el = document.getElementById("presence");
  if (!S.trip) return (el.innerHTML = "");
  const online = S.presence.filter((p) => Date.now() - p.at < 60000);
  el.innerHTML = online
    .map((p) => `<span class="dot-user ${p.email === S.me.email ? "self" : ""}" title="${esc(p.name)} is here">${esc(firstName(p.name).slice(0, 1).toUpperCase())}</span>`)
    .join("") + (online.length > 1 ? `<span class="live">Live together</span>` : "");
}

function viewSignIn() {
  const demo = S.store.mode === "demo";
  return `<section class="welcome">
    <div class="w-art">🧭</div>
    <h1>Plan the trip together.</h1>
    <p>Save places from Instagram, Facebook or any website, drop them onto days, and see each other's changes as they happen.</p>
    ${demo
      ? `<div class="demo-note"><b>Demo mode.</b> Firebase isn't connected yet, so everything stays in this browser. Open a second tab with a different name to try editing together.</div>
         <div class="row"><input id="demoName" placeholder="Your name" autocomplete="name"><button class="primary" data-action="signin">Start</button></div>`
      : `<button class="primary big" data-action="signin">Sign in with Google</button>
         <p class="muted small">Only people you invite by email can see a trip.</p>`}
  </section>`;
}

function viewHome() {
  const trips = [...S.trips].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return `<section class="home">
    <div class="home-head"><h2>Your trips</h2><button class="primary" data-action="newTrip">+ New trip</button></div>
    ${trips.length ? "" : `<p class="empty">No trips yet. Create one, then invite your partner by email.</p>`}
    <div class="trip-cards">
      ${trips.map((t) => `<button class="trip-card" data-action="open" data-id="${t.id}">
          <div class="tc-img" ${safeUrl(t.place?.image) ? `style="background-image:url('${esc(t.place.image)}')"` : ""}></div>
          <div class="tc-body">
          <div class="tc-title">${esc(t.name)}</div>
          <div class="muted">${esc(t.destination || "")}${t.startDate ? " · " + fmtDay(new Date(t.startDate + "T00:00")) : ""} · ${(t.days || []).length} days</div>
          <div class="muted small">${t.updatedAt ? "Updated " + ago(t.updatedAt) + (t.updatedByName ? " by " + esc(firstName(t.updatedByName)) : "") : ""}</div>
          </div>
        </button>`).join("")}
    </div>
  </section>`;
}

function viewTrip() {
  const t = S.trip;
  const c = costs();
  const budget = Number(t.budget) || 0;
  const pct = budget ? Math.min(100, (c.total / budget) * 100) : 0;
  const nFix = smartList().filter((x) => x.level === "fix").length;
  const tabs = [
    ["plan", "🗓️", "Plan"],
    ["discover", "🧭", "Discover"],
    ["smart", "✨", "Smart", nFix],
    ["ideas", "💡", "Ideas", ideas().length],
    ["budget", "💰", "Budget"],
    ["itinerary", "📄", "Itinerary"],
    ["changes", "🕘", "Activity"],
  ];
  const end = dayDate(t.days.length - 1);
  const cover = safeUrl(t.place?.image);
  const w = t.weather?.days || [];
  const temps = w.length ? `${Math.min(...w.map((d) => d.min))}–${Math.max(...w.map((d) => d.max))}°C` : "";
  const avatars = t.members.map((m) => {
    const on = S.presence.some((p) => p.email === m && Date.now() - p.at < 60000);
    return `<span class="av ${on ? "on" : ""}" title="${esc(nameOf(m))}${on ? " · here now" : ""}">${esc(firstName(nameOf(m)).slice(0, 1).toUpperCase())}</span>`;
  }).join("");
  return `<section class="trip">
    <header class="hero ${cover ? "has-img" : ""}" ${cover ? `style="--cover:url('${esc(cover)}')"` : ""}>
      <div class="hero-inner">
        <div class="hero-top">
          <button class="chip ghost" data-action="home">← Trips</button>
          <div class="hero-acts">
            <button class="chip ghost" data-action="invite">${avatars}<span>Invite</span></button>
            <button class="chip ghost" data-action="editTrip" title="Edit trip">⚙️</button>
          </div>
        </div>
        <div class="hero-main">
          <div class="eyebrow">${esc(t.destination || "Somewhere wonderful")}</div>
          <h1>${esc(t.name)}</h1>
          <div class="hero-meta">
            ${t.startDate ? `<span>📅 ${fmtDay(dayDate(0))} – ${fmtDay(end)}</span>` : `<button class="link light" data-action="editTrip">📅 Set dates</button>`}
            <span>🌙 ${t.days.length} day${t.days.length === 1 ? "" : "s"}</span>
            ${temps ? `<span title="${t.weather.kind === "forecast" ? "Forecast" : "Same dates last year"}">${w[0]?.icon || "🌡️"} ${temps}${t.weather.kind === "typical" ? " typical" : ""}</span>` : ""}
            ${t.weather?.tz ? `<span>🕒 ${esc(t.weather.tz.split("/").pop().replace(/_/g, " "))} time</span>` : ""}
          </div>
        </div>
        <div class="hero-budget ${budget && c.total > budget ? "over" : ""}">
          <div class="hb-row"><span><b>${money(c.total)}</b> planned</span><span>${budget ? `${money(budget)} budget` : `<button class="link light" data-action="editTrip">Set a budget</button>`}</span></div>
          ${budget ? `<div class="bb-track"><div class="bb-fill" style="width:${pct}%"></div></div>` : ""}
        </div>
      </div>
    </header>

    ${t.place?.extract && S.tab === "plan" ? `<details class="about"><summary>About ${esc(t.place.title)}</summary><p>${esc(t.place.extract)}</p>${t.place.url ? `<a href="${esc(t.place.url)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a>` : ""}</details>` : ""}

    ${viewAddLink()}

    <nav class="tabs">${tabs.map(([k, ic, l, n]) => `<button class="${S.tab === k ? "on" : ""}" data-action="tab" data-tab="${k}"><span class="t-ic">${ic}</span><span class="t-l">${l}</span>${n ? `<span class="count ${k === "smart" ? "warnc" : ""}">${n}</span>` : ""}</button>`).join("")}</nav>
    <div class="tab-body">${({ plan: viewPlan, discover: viewDiscover, smart: viewSmart, ideas: viewIdeas, budget: viewBudget, changes: viewChanges, itinerary: viewItinerary }[S.tab] || viewPlan)()}</div>
    <p class="foot muted small">${t.updatedAt ? `Last change ${ago(t.updatedAt)} by ${esc(who(t.updatedBy))}` : ""}</p>
  </section>`;
}

function viewAddLink() {
  return `<div class="add-link">
    <span class="al-ic">🔗</span>
    <input id="linkInput" type="url" inputmode="url" placeholder="Paste a link from Instagram, Maps or any site" ${S.busy ? "disabled" : ""}>
    <button class="primary" data-action="addLink" ${S.busy ? "disabled" : ""}>${S.busy ? "Working…" : "Save"}</button>
    <button class="icon" data-action="pasteLink" title="Paste from clipboard">📋</button>
    <button class="icon" data-action="newItem" title="Add a place without a link">＋</button>
  </div>${typeof S.busy === "string" ? `<p class="muted small busy-line">⏳ ${esc(S.busy)}</p>` : ""}`;
}

function card(it, opts = {}) {
  const cat = CATEGORIES[it.category] || CATEGORIES.other;
  const img = safeUrl(it.image);
  const src = sourceOf(it.url || "");
  const badge = { instagram: "Instagram", facebook: "Facebook", maps: "Maps", youtube: "YouTube", tiktok: "TikTok" }[src] || "";
  return `<article class="card ${S.flash.has(it.id) ? "flash" : ""} ${it.mustDo ? "must" : ""}" data-id="${it.id}">
    ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="thumb ph">${cat.icon}</div>`}
    <div class="c-body">
      <div class="c-top">
        ${opts.time ? `<span class="time ${opts.auto ? "auto" : ""}" title="${opts.auto ? "Estimated from the stops before it" : "Fixed time"}">${opts.time}</span>` : ""}
        <span class="c-title">${esc(it.title || "Untitled")}</span>
        ${it.mustDo ? `<span class="tag must-tag">Must-do</span>` : ""}
        ${it.rating ? `<span class="tag star">★ ${esc(it.rating)}${it.reviews ? ` <span class="muted">(${Number(it.reviews).toLocaleString()})</span>` : ""}</span>` : ""}
      </div>
      <div class="c-meta">
        <span>${cat.icon} ${cat.label}</span>
        ${it.location ? `<a href="https://www.google.com/maps/search/?api=1&query=${mapsQ(it.location)}" target="_blank" rel="noopener">📍 ${esc(it.location)}</a>` : ""}
        ${it.durationMin ? `<span>⏱ ${dur(+it.durationMin)}</span>` : ""}
        ${Number(it.cost) ? `<span>💰 ${money(it.cost)}</span>` : ""}
        ${badge ? `<span class="tag">${badge}</span>` : ""}
      </div>
      ${it.description ? `<p class="c-desc">${esc(it.description.slice(0, 220))}${it.description.length > 220 ? "…" : ""}</p>` : ""}
      ${it.notes ? `<p class="c-notes">📝 ${esc(it.notes)}</p>` : ""}
      <div class="c-foot">
        <span class="muted small">${it.suggestedBy ? (it.suggestedBy === "ai" ? "Suggested by Gemini" : "Suggested by the travel guide") : `Added by ${esc(who(it.addedBy))}`} ${ago(it.addedAt)}${it.updatedAt && it.updatedAt !== it.addedAt ? ` · edited by ${esc(who(it.updatedBy))} ${ago(it.updatedAt)}` : ""}</span>
        <span class="c-actions">
          ${safeUrl(it.url) ? `<a class="btn-s" href="${esc(it.url)}" target="_blank" rel="noopener">Open</a>` : ""}
          ${opts.inDay ? `<button class="btn-s" data-action="up" data-id="${it.id}" title="Move earlier">↑</button><button class="btn-s" data-action="down" data-id="${it.id}" title="Move later">↓</button>` : `<button class="btn-s primary" data-action="schedule" data-id="${it.id}">Add to day</button>`}
          <button class="btn-s" data-action="editItem" data-id="${it.id}">Edit</button>
        </span>
      </div>
    </div>
  </article>`;
}

function legView(prev, it, dayIdx) {
  const t = it.travel || {};
  const m = MODES[t.mode];
  const from = prev.location || prev.title, to = it.location || it.title;
  const gm = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}${m?.gm ? "&travelmode=" + m.gm : ""}`;
  return `<div class="leg ${m ? "" : "empty"}">
    <button class="leg-btn" data-action="editLeg" data-id="${it.id}">
      ${m ? `${m.icon} <b>${m.label}</b>${t.minutes ? ` · ${dur(+t.minutes)}` : ""}${Number(t.cost) ? ` · ${money(t.cost)}` : ""}${t.notes ? ` · ${esc(t.notes)}` : ""}${t.auto ? ` <span class="muted">· estimated</span>` : ""}` : `➕ How do we get here?`}
    </button>
    <a class="leg-map" href="${gm}" target="_blank" rel="noopener" title="Directions in Google Maps">Directions ↗</a>
  </div>`;
}

function viewPlan() {
  const t = S.trip;
  const ch = checks().filter((c) => c.level !== "info").slice(0, 4);
  const nSmart = smartList().filter((x) => x.changes.length).length;
  return `
    ${ch.length ? `<div class="checks">${ch.map((c) => `<div class="check ${c.level}">${esc(c.text)}</div>`).join("")}</div>` : ""}
    ${nSmart ? `<button class="smart-banner" data-action="tab" data-tab="smart">✨ ${nSmart} smart suggestion${nSmart > 1 ? "s" : ""} to improve this plan <b>Review</b></button>` : ""}
    <div class="days">
    ${t.days.map((d, i) => {
      const sch = schedule(d.id);
      const date = dayDate(i);
      return `<section class="day" data-day="${d.id}">
        <header class="day-head">
          <div>
            <div class="day-n">Day ${i + 1}${date ? ` · ${fmtDay(date)}` : ""}${dayWeather(i)}</div>
            <div class="day-title">${esc(d.title || "")}${d.base ? ` <span class="muted">· staying in ${esc(d.base)}</span>` : ""}</div>
          </div>
          <div class="day-side"><span class="muted small">${dayCost(d.id) ? money(dayCost(d.id)) : ""}</span><button class="btn-s" data-action="editDay" data-id="${d.id}">⋯</button></div>
        </header>
        ${sch.length ? sch.map((s, k) => (k ? legView(sch[k - 1].it, s.it, i) : s.it.travel?.fromPrevDay && MODES[s.it.travel.mode] ? `<div class="leg"><span class="muted">From yesterday:</span> ${MODES[s.it.travel.mode].icon} ${MODES[s.it.travel.mode].label} · ${dur(+s.it.travel.minutes)}</div>` : "") + card(s.it, { inDay: true, time: fromMin(s.start), auto: s.auto })).join("") : `<p class="empty small">Nothing planned yet. Add something from Ideas.</p>`}
        <div class="day-foot"><button class="link" data-action="pickForDay" data-id="${d.id}">+ Add from ideas</button><button class="link" data-action="newItem" data-day="${d.id}">+ New stop</button></div>
      </section>`;
    }).join("")}
    </div>
    <div class="day-controls">
      <button data-action="addDay">+ Add a day</button>
      ${t.days.length ? `<button data-action="removeLastDay">− Remove last day</button>` : ""}
    </div>`;
}

function viewIdeas() {
  const list = ideas();
  const members = S.trip.members;
  const stats = members.map((m) => {
    const all = S.items.filter((i) => i.addedBy === m && !i.suggestedBy);
    const sched = all.filter((i) => S.trip.days.some((d) => d.id === i.dayId));
    return `<span class="stat"><b>${esc(who(m))}</b>: ${sched.length} of ${all.length} picks planned</span>`;
  });
  return `<div class="stats">${stats.join("")}</div>
    ${list.length ? `<div class="cards">${list.map((it) => card(it)).join("")}</div>` : `<p class="empty">No ideas waiting. Paste a link above, or share one to this app from your phone.</p>`}`;
}

function viewBudget() {
  const c = costs();
  const t = S.trip;
  const budget = Number(t.budget) || 0;
  const rows = Object.entries(CATEGORIES)
    .map(([k, v]) => [v.icon + " " + v.label, c.byCat[k] || 0])
    .concat([["🚕 Getting around (legs between stops)", c.transport], ["➕ Other costs", c.extras]])
    .filter(([, v]) => v);
  const perPerson = t.members.length ? c.total / t.members.length : c.total;
  return `<div class="budget">
    <div class="b-summary">
      <div><div class="muted small">Budget</div><div class="big-n">${budget ? money(budget) : "—"}</div></div>
      <div><div class="muted small">Planned</div><div class="big-n">${money(c.total)}</div></div>
      <div><div class="muted small">${budget && c.total > budget ? "Over by" : "Left"}</div><div class="big-n ${budget && c.total > budget ? "bad" : "good"}">${budget ? money(Math.abs(budget - c.total)) : "—"}</div></div>
      <div><div class="muted small">Per person</div><div class="big-n">${money(perPerson)}</div></div>
    </div>
    <h3>By category</h3>
    ${rows.length ? `<table class="b-table">${rows.map(([l, v]) => `<tr><td>${l}</td><td>${money(v)}</td><td class="pct">${c.total ? Math.round((v / c.total) * 100) : 0}%</td></tr>`).join("")}</table>` : `<p class="empty small">Add costs to stops and transport to see them here.</p>`}
    <h3>By day</h3>
    <table class="b-table">${t.days.map((d, i) => `<tr><td>Day ${i + 1}${d.title ? " · " + esc(d.title) : ""}</td><td>${money(dayCost(d.id))}</td><td></td></tr>`).join("")}</table>
    <h3>Other costs <span class="muted small">(flights home, visas, insurance…)</span></h3>
    <table class="b-table">${(t.extras || []).map((e) => `<tr><td>${esc(e.label)} <span class="muted small">· ${esc(who(e.by))}</span></td><td>${money(e.cost)}</td><td><button class="btn-s" data-action="delExtra" data-id="${e.id}">✕</button></td></tr>`).join("")}</table>
    <div class="row"><input id="extraLabel" placeholder="e.g. Return flights"><input id="extraCost" type="number" inputmode="decimal" placeholder="Cost" min="0"><button data-action="addExtra">Add</button></div>
  </div>`;
}

function viewChanges() {
  if (!S.activity.length) return `<p class="empty">Changes either of you make will show up here with the time.</p>`;
  let lastDay = "";
  return `<ol class="feed">${S.activity.map((a) => {
    const d = new Date(a.at).toDateString();
    const head = d !== lastDay ? `<li class="feed-day">${new Date(a.at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</li>` : "";
    lastDay = d;
    return `${head}<li><span class="f-time">${new Date(a.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span><span class="f-who">${esc(who(a.by))}</span> ${esc(a.text)}</li>`;
  }).join("")}</ol>`;
}

function viewItinerary() {
  const t = S.trip;
  const c = costs();
  return `<div class="itin">
    <div class="itin-actions"><button data-action="print">🖨️ Print / save as PDF</button><button data-action="copyItin">Copy as text</button></div>
    <div class="itin-doc" id="itinDoc">
      <h1>${esc(t.name)}</h1>
      <p class="muted">${esc(t.destination || "")}${t.startDate ? ` · ${fmtDay(dayDate(0))} – ${fmtDay(dayDate(t.days.length - 1))}` : ""} · ${t.days.length} days · ${t.members.map((m) => esc(nameOf(m))).join(" & ")}</p>
      <p><b>Estimated cost:</b> ${money(c.total)}${t.budget ? ` of ${money(t.budget)} budget` : ""}</p>
      ${t.days.map((d, i) => {
        const sch = schedule(d.id);
        return `<section class="itin-day">
          <h2>Day ${i + 1}${dayDate(i) ? ` · ${fmtDay(dayDate(i))}` : ""}${d.title ? ` · ${esc(d.title)}` : ""}</h2>
          ${d.base ? `<p class="muted">Staying in ${esc(d.base)}</p>` : ""}
          ${d.notes ? `<p>${esc(d.notes)}</p>` : ""}
          ${sch.length ? `<ul>${sch.map((s, k) => {
            const leg = (k || s.it.travel?.fromPrevDay) && MODES[s.it.travel?.mode] ? `<li class="itin-leg">${MODES[s.it.travel.mode].icon} ${MODES[s.it.travel.mode].label}${s.it.travel.minutes ? `, ${dur(+s.it.travel.minutes)}` : ""}${Number(s.it.travel.cost) ? `, ${money(s.it.travel.cost)}` : ""}${s.it.travel.notes ? ` (${esc(s.it.travel.notes)})` : ""}</li>` : "";
            return `${leg}<li><b>${fromMin(s.start)}–${fromMin(s.end)}</b> ${CATEGORIES[s.it.category]?.icon || ""} ${esc(s.it.title)}${s.it.location ? ` <span class="muted">· ${esc(s.it.location)}</span>` : ""}${Number(s.it.cost) ? ` · ${money(s.it.cost)}` : ""}${s.it.notes ? `<div class="muted small">${esc(s.it.notes)}</div>` : ""}</li>`;
          }).join("")}</ul>` : `<p class="muted">Free day.</p>`}
          <p class="muted small">Day total: ${money(dayCost(d.id))}</p>
        </section>`;
      }).join("")}
    </div>
  </div>`;
}

/* ----------------------------------------------------- destination + discover */
const GUIDE_MIN = { see: 90, do: 120, eat: 75, drink: 60, sleep: 60, buy: 60 };
function dayWeather(i) {
  const w = S.trip.weather?.days?.[i];
  if (!w || !Number.isFinite(w.max)) return "";
  const rain = w.rainPct != null ? (w.rainPct >= 40 ? ` · ${w.rainPct}% rain` : "") : w.rain >= 2 ? " · rainy" : "";
  return ` <span class="wx" title="${S.trip.weather.kind === "forecast" ? "Forecast" : "Same date last year"}">${w.icon} ${w.max}°/${w.min}°${rain}</span>`;
}
async function ensureDestination(force = false) {
  const t = S.trip;
  if (!t?.destination || S.destBusy) return;
  const wantW = `${t.startDate}|${t.days.length}`;
  const tripId = S.tripId;
  if (!force && t.place?.for === t.destination) {
    const stale = t.weather?.kind === "forecast" && Date.now() - (t.weather.fetchedAt || 0) > 6 * 3600e3;
    if (t.place.lat != null && (t.weather?.for !== wantW || stale) && S.weatherTried !== wantW + tripId) {
      S.destBusy = true;
      S.weatherTried = wantW + tripId;
      try {
        const w = await fetchWeather(t.place.lat, t.place.lng, t.startDate, t.days.length);
        await S.store.updateTrip(tripId, { weather: { ...w, for: wantW } });
      } catch (e) {
        console.warn(e);
      } finally {
        S.destBusy = false;
      }
    }
    return;
  }
  // If the other person is already loading it, let them.
  if (!force && t.destLoading?.for === t.destination && t.destLoading.by !== S.me.email && Date.now() - t.destLoading.at < 60000) return;
  S.destBusy = true;
  render();
  try {
    await S.store.updateTrip(tripId, { destLoading: { for: t.destination, at: Date.now(), by: S.me.email } });
    const d = await loadDestination(t);
    await S.store.updateTrip(tripId, { place: d.place, weather: d.weather ? { ...d.weather, for: wantW } : null, guide: d.guide, destLoading: null });
    if (S.tripId === tripId && !S.items.some((i) => i.suggestedBy) && d.guide.listings.length) await addStarter(tripId, d.guide.listings);
  } catch (e) {
    console.warn(e);
    await S.store.updateTrip(tripId, { destLoading: null }).catch(() => {});
  } finally {
    S.destBusy = false;
    render();
  }
}
function guideToItem(l) {
  return {
    title: l.name, description: l.content || "", image: l.image || "", siteName: "Wikivoyage",
    location: l.address || l.name, ...(l.lat ? { lat: l.lat, lng: l.lng } : {}), url: l.url || "",
    category: l.category, dayId: null, order: 0, time: "", durationMin: GUIDE_MIN[l.type] || 60, cost: 0, mustDo: false,
    notes: [l.price && "Price: " + l.price, l.hours && "Hours: " + l.hours].filter(Boolean).join(" · "),
    suggestedBy: "guide", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...stampMe(),
  };
}
function aiToItem(p) {
  return {
    title: String(p.name).slice(0, 140), description: p.why || "", image: "", siteName: "Gemini",
    location: [p.address || p.area, S.trip.destination].filter(Boolean).join(", "), url: "",
    category: CATEGORIES[p.category] ? p.category : "sight", dayId: null, order: 0, time: "",
    durationMin: Number(p.durationMin) || 90, cost: Number(p.approxCost) || 0, mustDo: false,
    rating: Number(p.rating) || null, reviews: Number(p.reviews) || null, notes: [p.priceLevel, p.area].filter(Boolean).join(" · "),
    suggestedBy: "ai", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...stampMe(),
  };
}
async function addStarter(tripId, listings) {
  await buildSampleItinerary(tripId, listings, { auto: true });
}
// Fills empty days with a sample plan built from our preferences (profile.js), and puts stays and backups in Ideas.
async function buildSampleItinerary(tripId = S.tripId, listings = S.trip.guide?.listings || [], { auto = false } = {}) {
  const t = S.trip;
  if (!listings.length) return toast("The travel guide hasn't loaded for this destination yet.");
  const empty = new Set(t.days.filter((d) => !dayItems(d.id).length).map((d) => d.id));
  if (!empty.size && !auto) return toast("Every day already has plans. Clear a day to fill it with a sample.");
  const { mode, plan } = buildSample(t, listings, profileOf(t));
  const orders = {};
  const updates = [];
  let added = 0, placed = 0;
  for (const x of plan) {
    const day = x.dayIndex != null ? t.days[x.dayIndex] : null;
    const dayId = day && empty.has(day.id) ? day.id : null;
    if (x.dayIndex != null && !dayId) continue;
    const order = dayId ? (orders[dayId] = (orders[dayId] || 0) + 1) : 0;
    const placing = { dayId, order, time: x.time || "" };
    if (x.kind === "rest") {
      await S.store.addItem(tripId, { title: "Rest & recharge", description: "", image: "", siteName: "", location: "", url: "", category: "other", durationMin: 90, cost: 0, mustDo: false, rest: true, notes: x.note, suggestedBy: "plan", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...placing, ...stampMe() });
      added++;
      continue;
    }
    const have = inTrip(x.listing.name);
    if (have) {
      if (dayId && !have.dayId) updates.push([have.id, { ...placing, notes: [x.note, have.notes].filter(Boolean).join(" · "), mustDo: have.mustDo || /(food|experience) splurge/i.test(x.note || ""), ...stampMe() }]), placed++;
      continue;
    }
    const it = guideToItem(x.listing);
    await S.store.addItem(tripId, { ...it, ...placing, notes: [x.note, it.notes].filter(Boolean).join(" · "), mustDo: /(food|experience) splurge/i.test(x.note || "") });
    added++;
  }
  if (updates.length) await S.store.batchUpdateItems(tripId, updates);
  // Your own saved links come first: put them on days too, taking over guide picks where needed.
  await new Promise((r) => setTimeout(r, 300));
  for (const it of ideas().filter((x) => !x.suggestedBy && !x.mustDo)) if ((await placeIdea(it))?.dayIndex != null) placed++;
  if (added + placed) await S.store.log(tripId, { at: Date.now(), by: S.me.email, byName: S.me.name, text: `built a sample ${mode === "slow" ? "slow-paced" : "full"} itinerary for ${t.destination || "the trip"} from our preferences (${added + placed} stops)` });
  if (!auto) toast(added + placed ? `Sample itinerary added: ${mode === "slow" ? "slow pace, 1–2 anchors a day" : "full days, 3 anchors a day"}, with a rest block each day.` : "Nothing new to add from the travel guide.");
}
const inTrip = (name) => S.items.find((i) => i.title.trim().toLowerCase() === String(name).trim().toLowerCase());
const mapsQ = (loc) => {
  const d = S.trip?.destination || "";
  return encodeURIComponent(d && !loc.toLowerCase().includes(d.split(",")[0].toLowerCase()) ? `${loc}, ${d}` : loc);
};

function discoverCard(x, src, idx) {
  const cat = CATEGORIES[x.category] || CATEGORIES.other;
  const there = inTrip(x.name);
  const img = safeUrl(x.image);
  return `<article class="dcard">
    <div class="d-img ${img ? "" : "ph"}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove()">` : ""}<span class="d-cat">${cat.icon} ${cat.label}</span></div>
    <div class="d-body">
      <div class="d-title">${esc(x.name)}</div>
      <div class="d-meta">
        ${x.rating ? `<span class="star">★ ${esc(x.rating)}${x.reviews ? ` (${Number(x.reviews).toLocaleString()})` : ""}</span>` : ""}
        ${x.priceLevel ? `<span>${esc(x.priceLevel)}</span>` : ""}
        ${x.price ? `<span>${esc(x.price)}</span>` : ""}
        ${x.area ? `<span>📍 ${esc(x.area)}</span>` : ""}
        ${x.category === "food" && x.content && !vegOk(x) ? `<span class="nonveg">Mostly meat or fish</span>` : ""}
      </div>
      <p class="d-desc">${esc((x.why || x.content || x.address || "").slice(0, 180))}</p>
      <div class="d-act">
        ${there ? `<span class="added">✓ ${there.dayId && S.trip.days.some((d) => d.id === there.dayId) ? dayLabel(there.dayId) : "In ideas"}</span>` : `<button class="btn-s primary" data-action="discAdd" data-src="${src}" data-id="${idx}">＋ Add</button>`}
        <a class="btn-s" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${mapsQ(x.address || x.area || x.name)}">Map</a>
      </div>
    </div>
  </article>`;
}
function viewDiscover() {
  const t = S.trip;
  if (!t.destination) return `<div class="empty-state"><div class="es-ic">🧭</div><p>Add a destination to see top sights, food and places to stay.</p><button class="primary" data-action="editTrip">Add destination</button></div>`;
  const loading = S.destBusy || (t.destLoading && Date.now() - t.destLoading.at < 60000);
  const f = S.discFilter || "all";
  const filters = [["all", "All"], ["sight", "🏛️ Sights"], ["activity", "🎟️ Do"], ["food", "🍜 Eat & drink"], ["stay", "🛏️ Stay"], ["nature", "🌿 Nature"], ["shopping", "🛍️ Shop"]];
  const ok = (x) => f === "all" || x.category === f;
  const picks = (t.aiPicks?.for === t.destination ? t.aiPicks.items : []).map((x, i) => [x, i]).filter(([x]) => ok(x));
  const guide = (t.guide?.for === t.destination ? t.guide.listings : []).map((x, i) => [x, i]).filter(([x]) => ok(x))
    .sort(([a], [b]) => (a.category === "food" && !vegOk(a)) - (b.category === "food" && !vegOk(b)));
  const w = t.weather?.days || [];
  return `<div class="discover">
    ${w.length ? `<div class="wx-strip">${w.map((d, i) => `<div class="wx-day"><div class="muted small">${dayDate(i) ? dayDate(i).toLocaleDateString(undefined, { weekday: "short" }) : "Day " + (i + 1)}</div><div class="wx-ic">${d.icon}</div><div><b>${d.max}°</b> <span class="muted">${d.min}°</span></div></div>`).join("")}</div>
      <p class="muted small">${t.weather.kind === "forecast" ? "Weather forecast for your dates." : "Weather on the same dates last year, as a guide. The forecast appears about two weeks before you go."}</p>` : ""}
    ${prefsCard()}
    <div class="chips">${filters.map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-action="discFilter" data-id="${k}">${l}</button>`).join("")}</div>

    <section class="d-sec">
      <div class="d-head"><h3>✨ Top rated, picked by Gemini</h3>
        ${t.ai?.key ? `<button class="btn-s" data-action="aiPicks" ${S.aiBusy ? "disabled" : ""}>${S.aiBusy === "picks" ? "Searching…" : picks.length ? "Refresh" : "Find top-rated picks"}</button>` : `<button class="btn-s primary" data-action="aiSettings">Connect Gemini (free)</button>`}</div>
      ${picks.length ? `<div class="dgrid">${picks.map(([x, i]) => discoverCard(x, "ai", i)).join("")}</div>`
        : `<p class="muted small">${t.ai?.key ? "Gemini searches Google for the best-reviewed places, with ratings." : "Connect a free Gemini key to get top-rated restaurants, sights and hotels with Google ratings."}</p>`}
    </section>

    <section class="d-sec">
      <div class="d-head"><h3>📖 Travel guide picks</h3><button class="btn-s" data-action="refreshDest" ${loading ? "disabled" : ""}>${loading ? "Loading…" : "Refresh"}</button></div>
      ${guide.length ? `<div class="dgrid">${guide.map(([x, i]) => discoverCard(x, "guide", i)).join("")}</div>`
        : `<p class="muted small">${loading ? "Loading the guide for " + esc(t.destination) + "…" : "No guide listings found for this destination. Try a city name, e.g. “Ubud” rather than “Bali”."}</p>`}
      ${t.guide?.source ? `<p class="muted small">From <a href="${esc(t.guide.source)}" target="_blank" rel="noopener">Wikivoyage</a>, the free travel guide.</p>` : ""}
    </section>
  </div>`;
}

function prefsCard() {
  const t = S.trip, p = profileOf(t);
  const mode = chooseMode(p, t);
  const tip = vegTip(t.destination);
  const anyEmpty = t.days.some((d) => !dayItems(d.id).length);
  return `<section class="d-sec prefs-card">
    <div class="d-head"><h3>💚 Planned around your preferences</h3><button class="btn-s" data-action="editProfile">Edit</button></div>
    <ul class="prefs-list small">
      <li>🥚 ${esc(p.diet)}</li>
      <li>${mode === "slow" ? "🌴 Slow pace: 1–2 anchors a day" : "🏙️ Full days: 3 anchors a day"}${p.pace === "auto" ? " (picked for this destination)" : ""}</li>
      ${p.rest ? "<li>☕ A rest block every afternoon</li>" : ""}
      ${p.splurges ? "<li>✨ One splurge each: food, stay, experience</li>" : ""}
      <li>🍜 Street food and markets, plus one notable restaurant</li>
      ${p.autoPlace !== false ? "<li>🔗 Places from your shared links go straight onto the best day</li>" : ""}
    </ul>
    ${tip ? `<p class="small veg-tip">🗣️ ${esc(tip)}</p>` : ""}
    ${anyEmpty ? `<button class="primary btn-s" data-action="buildSample" ${t.guide?.listings?.length ? "" : "disabled"}>✨ Fill empty days with a sample itinerary</button>` : ""}
  </section>`;
}
function editProfile() {
  const p = profileOf(S.trip);
  const ta = (name, label) => `<label>${label}<textarea name="${name}" rows="2">${esc(p[name])}</textarea></label>`;
  openModal(`<h3>💚 Our preferences</h3>
    <p class="muted small">Used for the sample itinerary, Gemini's picks and reviews, and the plan checks. Both of you can change these.</p>
    <label>Pace<select name="pace">${[["auto", "Pick per destination (cities full, beaches and hills slow)"], ["dense", "Full days"], ["slow", "Slow"]].map(([v, l]) => `<option value="${v}" ${p.pace === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${ta("diet", "Food we eat")}${ta("food", "Where we like to eat")}${ta("stays", "Stays")}${ta("interests", "Interests")}
    <label class="row"><input type="checkbox" name="rest" ${p.rest ? "checked" : ""}> A rest block every day</label>
    <label class="row"><input type="checkbox" name="splurges" ${p.splurges ? "checked" : ""}> One splurge each in food, stay and experience</label>
    <label class="row"><input type="checkbox" name="autoPlace" ${p.autoPlace !== false ? "checked" : ""}> Put places from shared links straight onto the best day</label>`,
    async (f) => {
      const next = { ...p, pace: f.pace, diet: f.diet.trim(), food: f.food.trim(), stays: f.stays.trim(), interests: f.interests.trim(), rest: !!f.rest, splurges: !!f.splurges, autoPlace: !!f.autoPlace };
      await S.store.txTrip(S.tripId, () => ({ profile: next, ...stampMe() }));
      await log("updated the trip preferences");
    });
}

/* ---------------------------------------------------------------------- AI */
function aiSettings() {
  const cur = S.trip.ai || {};
  openModal(`<h3>✨ Connect Gemini</h3>
    <p class="muted small">Gemini gives top-rated picks with Google ratings and an expert review of your plan. It needs a free API key. Your Gemini app subscription isn't used for this; the free key is separate and costs nothing.</p>
    <ol class="steps small">
      <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with Google.</li>
      <li>Click <b>Create API key</b> and copy it.</li>
      <li>Paste it below.</li>
    </ol>
    <label>Gemini API key<input name="key" type="password" autocomplete="off" value="${esc(cur.key || "")}" placeholder="AIza…"></label>
    <p class="muted small">The key is saved on this trip, so only people on the trip can use or see it.</p>
    ${cur.key ? `<button type="button" class="danger link" data-rmkey>Remove key</button>` : ""}`,
    async (f) => {
      const key = f.key.trim();
      if (!key) return false;
      toast("Checking the key…");
      const model = await testKey(key);
      await S.store.updateTrip(S.tripId, { ai: { key, model }, ...stampMe() });
      await log("connected Gemini");
      toast("Gemini connected.");
    });
  $form.querySelector("[data-rmkey]")?.addEventListener("click", async () => {
    $modal.close();
    await S.store.updateTrip(S.tripId, { ai: null, aiPicks: null });
    await log("disconnected Gemini");
  });
}
async function runAiPicks() {
  S.aiBusy = "picks";
  render();
  try {
    const items = await topPicks(S.trip.ai.key, S.trip, profileText(profileOf(S.trip)));
    await S.store.updateTrip(S.tripId, { aiPicks: { for: S.trip.destination, at: Date.now(), items } });
    await log(`asked Gemini for top-rated places (${items.length} found)`);
  } catch (e) {
    toast("Gemini: " + e.message, 5000);
  } finally {
    S.aiBusy = null;
    render();
  }
}
function planSnapshot() {
  const t = S.trip;
  const stop = (it) => ({
    id: it.id, title: it.title, category: it.category, location: it.location || undefined, fixedTime: it.time || undefined,
    durationMin: it.durationMin, cost: it.cost || undefined, mustDo: it.mustDo || undefined,
    addedBy: it.suggestedBy ? "suggestion" : nameOf(it.addedBy), notes: it.notes || undefined,
    travelToHere: it.travel?.mode ? { mode: it.travel.mode, minutes: it.travel.minutes } : undefined,
  });
  return {
    destination: t.destination, startDate: t.startDate || undefined, currency: t.currency, budget: t.budget || undefined,
    plannedTotal: costs().total, travellers: t.members.map(nameOf), prefs: t.prefs || {}, preferences: profileText(profileOf(t)),
    days: t.days.map((d, i) => ({
      day: i + 1, date: dayDate(i)?.toDateString(), title: d.title || undefined, stayingIn: d.base || undefined,
      weather: t.weather?.days?.[i] ? `${t.weather.days[i].max}/${t.weather.days[i].min}°C${t.weather.kind === "typical" ? " (typical)" : ""}` : undefined,
      schedule: schedule(d.id).map((s) => ({ ...stop(s.it), estStart: fromMin(s.start) })),
    })),
    ideasNotScheduled: ideas().map(stop).slice(0, 40),
  };
}
async function runAiReview() {
  S.aiBusy = "review";
  render();
  try {
    const r = await reviewPlan(S.trip.ai.key, planSnapshot(), profileText(profileOf(S.trip)));
    await S.store.updateTrip(S.tripId, { aiReview: { at: Date.now(), by: S.me.email, ...r, applied: [] } });
    await log("asked Gemini to review the plan");
  } catch (e) {
    toast("Gemini: " + e.message, 5000);
  } finally {
    S.aiBusy = null;
    render();
  }
}
function aiActionable(a) {
  if (!a) return false;
  const exists = (id) => S.items.some((i) => i.id === id);
  const day = (n) => S.trip.days[(Number(n) || 0) - 1];
  if (a.type === "move") return exists(a.itemId) && !!day(a.toDay);
  if (a.type === "add") return !!a.place?.name;
  if (a.type === "transport") return exists(a.itemId) && !!MODES[a.mode];
  if (a.type === "time") return exists(a.itemId) && /^\d{1,2}:\d{2}$/.test(a.time || "");
  return false;
}
async function applyAi(idx) {
  const rev = S.trip.aiReview;
  const sug = rev?.suggestions?.[idx];
  if (!sug || !aiActionable(sug.action)) return;
  const a = sug.action;
  const dayId = S.trip.days[(Number(a.toDay) || 0) - 1]?.id || null;
  if (a.type === "move") await S.store.updateItem(S.tripId, a.itemId, { dayId, order: nextOrder(dayId), ...stampMe() });
  if (a.type === "transport") {
    const it = S.items.find((i) => i.id === a.itemId);
    await S.store.updateItem(S.tripId, a.itemId, { travel: { ...(it.travel || {}), mode: a.mode, minutes: Number(a.minutes) || it.travel?.minutes || 0, auto: false }, ...stampMe() });
  }
  if (a.type === "time") await S.store.updateItem(S.tripId, a.itemId, { time: a.time.padStart(5, "0"), ...stampMe() });
  if (a.type === "add") {
    const p = a.place;
    await S.store.addItem(S.tripId, { ...aiToItem({ name: p.name, category: p.category, address: p.location, durationMin: p.durationMin, approxCost: p.cost, why: sug.detail }), dayId, order: dayId ? nextOrder(dayId) : 0 });
  }
  await S.store.txTrip(S.tripId, (cur) => ({ aiReview: { ...cur.aiReview, applied: [...new Set([...(cur.aiReview?.applied || []), idx])] }, ...stampMe() }));
  await log(`applied Gemini's suggestion: ${sug.title}`);
}
function viewAiReview() {
  const t = S.trip;
  const r = t.aiReview;
  const head = `<div class="d-head"><h3>🤖 Gemini review</h3>${t.ai?.key
    ? `<button class="btn-s ${r ? "" : "primary"}" data-action="aiReview" ${S.aiBusy ? "disabled" : ""}>${S.aiBusy === "review" ? "Reviewing…" : r ? "Review again" : "Review our plan"}</button>`
    : `<button class="btn-s primary" data-action="aiSettings">Connect Gemini (free)</button>`}</div>
    <p class="muted small">Using Claude? <button class="link" data-action="copyForClaude" data-id="review">Copy plan for a Claude review</button> or <button class="link" data-action="copyForClaude" data-id="drive">Copy plan to save in Google Drive</button>, then paste it in your Claude trip project.</p>`;
  if (!r) return `<section class="ai-box">${head}<p class="muted small">${t.ai?.key ? "Gemini reads the whole plan and suggests improvements: timing, opening hours, what to add, how to get around." : "Connect a free Gemini key for an expert review of your plan in plain language."}</p></section>`;
  return `<section class="ai-box">${head}
    <p class="ai-sum">${esc(r.summary)}</p>
    <p class="muted small">Reviewed ${ago(r.at)}, asked by ${esc(who(r.by))}. Changes since then aren't included.</p>
    ${r.suggestions.map((x, i) => {
      const done = (r.applied || []).includes(i);
      const can = !done && aiActionable(x.action);
      return `<article class="sug ai ${done ? "done" : ""}"><div class="sug-ic">${done ? "✅" : "💬"}</div><div class="sug-body"><div class="sug-title">${esc(x.title)}</div><div class="sug-detail">${esc(x.detail || "")}</div></div>
        <div class="sug-act">${can ? `<button class="btn-s primary" data-action="aiApply" data-id="${i}">Apply</button>` : done ? `<span class="added">Applied</span>` : ""}</div></article>`;
    }).join("")}
  </section>`;
}

/* -------------------------------------------------------------- smart plan */
function smartAll() {
  return analyse({ trip: S.trip, items: S.items, dayItems, ideas, who, money, total: costs().total, profile: profileOf(S.trip) });
}
function smartList() {
  let dismissed = new Set();
  try { dismissed = new Set(JSON.parse(localGet("dismiss-" + S.tripId) || "[]")); } catch {}
  return smartAll().filter((x) => !dismissed.has(x.id));
}
function viewSmart() {
  const p = S.trip.prefs || {};
  const list = smartList();
  const hidden = smartAll().length - list.length;
  const fixes = list.filter((x) => x.level === "fix" && x.changes.length);
  const sel = (key, opts, val) => `<select data-pref="${key}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const icon = { rest: "☕", splurge: "✨", route: "🗺️", car: "🚙", legs: "🚇", load: "⚖️", must: "⭐", fill: "📅", spread: "📍", hop: "🚆", fair: "🤝", budget: "💰", locate: "🔎", leg: "🚶" };
  return `<div class="smart">
    ${viewAiReview()}
    <h3 class="sec-h">⚙️ Quick checks</h3>
    <div class="smart-prefs">
      <label>Pace ${sel("pace", [["relaxed", "Relaxed (≈7 h a day)"], ["balanced", "Balanced (≈9 h)"], ["packed", "Packed (≈11 h)"]], p.pace || "balanced")}</label>
      <label>Getting around ${sel("travel", [["mixed", "Whatever's best"], ["transit", "Prefer public transport"], ["car", "We'll have a car"]], p.travel || "mixed")}</label>
      <label>Finish by ${sel("dayEnd", [["20:00", "8 pm"], ["21:00", "9 pm"], ["22:00", "10 pm"], ["23:30", "Late"]], p.dayEnd || "22:00")}</label>
    </div>
    <div class="smart-actions">
      <button class="primary" data-action="analyse" ${S.analysing ? "disabled" : ""}>${S.analysing ? esc(S.analysing) : "🔎 Analyse plan"}</button>
      ${fixes.length > 1 ? `<button data-action="applyAll">Apply all ${fixes.length} fixes</button>` : ""}
      ${hidden ? `<button class="link" data-action="undismiss">Show ${hidden} dismissed</button>` : ""}
    </div>
    <p class="muted small">Suggestions update as either of you edits. “Analyse plan” looks up places on the map so routes and travel times can be worked out. Times are estimates: check exact times and fares with Directions.</p>
    ${list.length ? list.map((x) => `<article class="sug ${x.level}">
        <div class="sug-ic">${icon[x.kind] || "✨"}</div>
        <div class="sug-body">
          <div class="sug-title">${esc(x.title)}</div>
          ${x.detail ? `<div class="sug-detail">${esc(x.detail).replace(/\n/g, "<br>")}</div>` : ""}
        </div>
        <div class="sug-act">
          ${x.changes.length ? `<button class="btn-s primary" data-action="applySug" data-id="${esc(x.id)}">Apply</button>` : ""}
          <button class="btn-s" data-action="dismissSug" data-id="${esc(x.id)}">Dismiss</button>
        </div>
      </article>`).join("") : `<p class="empty">✅ The plan looks good. Nothing to fix right now.</p>`}
  </div>`;
}
async function runAnalyse() {
  S.analysing = "Looking up places…";
  render();
  try {
    const found = await locateAll(S.items, S.trip.destination, (k, n, title) => {
      S.analysing = `Finding ${k}/${n}: ${title.slice(0, 24)}`;
      render();
    });
    if (found.length) await S.store.batchUpdateItems(S.tripId, found);
    const ok = found.filter(([, p]) => !p.geoFailed).length;
    toast(found.length ? `Found ${ok} of ${found.length} places on the map.` : "All places are already on the map.");
  } catch (e) {
    toast("Couldn't look up places: " + e.message);
  } finally {
    S.analysing = null;
    render();
  }
}
// Order for a new stop with a fixed time: just before the first later fixed-time stop of the day.
function orderForTime(dayId, time) {
  if (!dayId) return 0;
  const t = toMin(time);
  const list = dayItems(dayId);
  const sch = schedule(dayId);
  const k = t == null ? -1 : sch.findIndex((x) => x.start > t || (toMin(x.it.time) != null && toMin(x.it.time) > t));
  if (k < 0) return nextOrder(dayId);
  return k === 0 ? list[0].order - 1 : (list[k - 1].order + list[k].order) / 2;
}
async function applySuggestions(ids) {
  const all = smartAll().filter((x) => ids.includes(x.id) && x.changes.length);
  if (!all.length) return;
  const updates = new Map();
  const merge = (id, patch) => updates.set(id, { ...(updates.get(id) || {}), ...patch, ...stampMe() });
  for (const sug of all)
    for (const c of sug.changes) {
      if (c.type === "order") c.ids.forEach((id, k) => merge(id, { order: k + 1 }));
      else if (c.type === "add") await S.store.addItem(S.tripId, { ...c.item, order: orderForTime(c.item.dayId, c.item.time), suggestedBy: "plan", addedBy: S.me.email, addedByName: S.me.name, addedAt: Date.now(), ...stampMe() });
      else if (c.type === "item") {
        const patch = { ...c.patch };
        if (patch.order === 1e6) patch.order = nextOrder(patch.dayId) + updates.size;
        merge(c.id, patch);
      }
    }
  await S.store.batchUpdateItems(S.tripId, [...updates.entries()]);
  for (const sug of all) await log(`applied a smart suggestion: ${sug.title}`);
  // Reordering or moving stops changes which legs exist, so refresh travel estimates afterwards.
  if (all.some((x) => x.kind !== "legs")) {
    await new Promise((r) => setTimeout(r, 300));
    const legs = smartAll().filter((x) => x.kind === "legs");
    if (legs.length) await S.store.batchUpdateItems(S.tripId, legs.flatMap((x) => x.changes.map((c) => [c.id, { ...c.patch, ...stampMe() }])));
  }
  await touchTrip();
  toast(all.length > 1 ? `Applied ${all.length} suggestions.` : "Applied.");
}

/* ------------------------------------------------------------------ modals */
function openModal(html, onSubmit) {
  $form.innerHTML = html + `<div class="m-actions"><button type="button" value="cancel" data-close>Cancel</button><button class="primary" value="ok">Save</button></div>`;
  $form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => $modal.close()));
  $form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData($form).entries());
    fd._submitter = e.submitter?.value;
    try {
      if ((await onSubmit(fd, e.submitter)) !== false) $modal.close();
    } catch (err) {
      console.error(err);
      toast("Couldn't save: " + err.message);
    }
  };
  $modal.showModal();
  $form.querySelector("input,select,textarea")?.focus();
}
const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("");
const dayOpts = (sel) => `<option value="">💡 Ideas (not on a day yet)</option>` + S.trip.days.map((d, i) => `<option value="${d.id}" ${d.id === sel ? "selected" : ""}>Day ${i + 1}${dayDate(i) ? " · " + fmtDay(dayDate(i)) : ""}${d.title ? " · " + esc(d.title) : ""}</option>`).join("");

function tripForm(t = {}) {
  return `<h3>${t.id ? "Edit trip" : "New trip"}</h3>
    <label>Trip name<input name="name" required value="${esc(t.name || "")}" placeholder="e.g. Bali anniversary"></label>
    <label>Destination<input name="destination" value="${esc(t.destination || "")}" placeholder="e.g. Bali, Indonesia"></label>
    <div class="grid2">
      <label>Start date<input name="startDate" type="date" value="${esc(t.startDate || "")}"></label>
      <label>Number of days<input name="numDays" type="number" min="1" max="60" value="${(t.days || []).length || 3}"></label>
    </div>
    <div class="grid2">
      <label>Expected budget<input name="budget" type="number" min="0" inputmode="decimal" value="${esc(t.budget || "")}"></label>
      <label>Currency<select name="currency">${CURRENCIES.map((c) => `<option ${c === (t.currency || "INR") ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div>
    ${t.id ? `<button type="button" class="danger link" data-action="deleteTrip">Delete this trip</button>` : ""}`;
}

async function newTrip() {
  openModal(tripForm(), async (f) => {
    const n = Math.max(1, Math.min(60, +f.numDays || 3));
    const now = Date.now();
    const id = await S.store.createTrip({
      name: f.name.trim(),
      destination: f.destination.trim(),
      startDate: f.startDate || "",
      budget: +f.budget || 0,
      currency: f.currency,
      days: Array.from({ length: n }, () => ({ id: uid(), title: "", base: "", notes: "" })),
      extras: [],
      owner: S.me.email,
      members: [S.me.email],
      memberNames: { [S.me.email]: S.me.name },
      ai: S.trips.find((x) => x.ai?.key)?.ai || null,
      profile: S.trips.find((x) => x.profile)?.profile || { ...DEFAULT_PROFILE },
      createdAt: now,
      ...stampMe(),
    });
    S.tripId = id;
    await log(`created the trip “${f.name.trim()}”`);
    openTrip(id);
  });
}

function editTrip() {
  const t = S.trip;
  openModal(tripForm(t), async (f) => {
    const n = Math.max(1, Math.min(60, +f.numDays || t.days.length));
    const changes = [];
    await S.store.txTrip(S.tripId, (cur) => {
      let days = cur.days || [];
      if (n > days.length) days = days.concat(Array.from({ length: n - days.length }, () => ({ id: uid(), title: "", base: "", notes: "" })));
      else if (n < days.length) days = days.slice(0, n);
      return { name: f.name.trim(), destination: f.destination.trim(), startDate: f.startDate || "", budget: +f.budget || 0, currency: f.currency, days, ...stampMe() };
    });
    if (n !== t.days.length) changes.push(`changed the trip from ${t.days.length} to ${n} days`);
    if ((+f.budget || 0) !== (+t.budget || 0)) changes.push(`set the budget to ${money(+f.budget || 0, f.currency)}`);
    if ((f.startDate || "") !== (t.startDate || "")) changes.push(`moved the start date to ${f.startDate ? fmtDay(new Date(f.startDate + "T00:00")) : "unset"}`);
    if (f.name.trim() !== t.name || f.destination.trim() !== (t.destination || "")) changes.push(`renamed the trip to “${f.name.trim()}${f.destination ? " · " + f.destination.trim() : ""}”`);
    for (const c of changes) await log(c);
  });
  $form.querySelector("[data-action=deleteTrip]")?.addEventListener("click", async () => {
    if (!confirm("Delete this trip for everyone? This can't be undone.")) return;
    $modal.close();
    const id = S.tripId;
    goHome();
    await S.store.deleteTrip(id);
    toast("Trip deleted.");
  });
}

function invite() {
  const t = S.trip;
  openModal(`<h3>Who's planning this trip</h3>
    <ul class="members">${t.members.map((m) => `<li>${esc(nameOf(m))} <span class="muted">${esc(m)}</span>${m === t.owner ? ` <span class="tag">owner</span>` : ""}</li>`).join("")}</ul>
    <label>Invite by Google email${S.store.mode === "demo" ? `<input name="email" placeholder="Their name">` : `<input name="email" type="email" placeholder="partner@gmail.com" required>`}</label>
    <p class="muted small">${S.store.mode === "demo"
      ? "Demo mode: type a name, then open another tab and sign in with that same name."
      : `They sign in at <b>${esc(location.origin + location.pathname)}</b> with that Google account and the trip appears for them.`}</p>`,
    async (f) => {
      let email = (f.email || "").trim().toLowerCase();
      if (!email) return;
      if (S.store.mode === "demo" && !email.includes("@")) email = email.replace(/[^a-z0-9]+/g, ".") + "@demo";
      if (t.members.includes(email)) return toast("Already on this trip."), false;
      await S.store.txTrip(S.tripId, (cur) => ({ members: [...new Set([...(cur.members || []), email])], ...stampMe() }));
      await log(`invited ${email}`);
      toast("Invited. Send them the link to this page.");
    });
}

function itemForm(it = {}, dayId) {
  return `<h3>${it.id ? "Edit" : "New"} place</h3>
    ${safeUrl(it.image) ? `<img class="m-img" src="${esc(it.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <label>Name<input name="title" required value="${esc(it.title || "")}"></label>
    <label>Location / address<input name="location" value="${esc(it.location || "")}" placeholder="Used for maps and directions"></label>
    <div class="grid2">
      <label>Type<select name="category">${opt(CATEGORIES, it.category || "sight")}</select></label>
      <label>Day<select name="dayId">${dayOpts(it.dayId ?? dayId ?? "")}</select></label>
    </div>
    <div class="grid3">
      <label>Fixed time <span class="muted small">(optional)</span><input name="time" type="time" value="${esc(it.time || "")}"></label>
      <label>How long (min)<input name="durationMin" type="number" min="0" step="15" value="${esc(it.durationMin || 60)}"></label>
      <label>Cost<input name="cost" type="number" min="0" inputmode="decimal" value="${esc(it.cost || "")}"></label>
    </div>
    <label class="check-row"><input type="checkbox" name="mustDo" ${it.mustDo ? "checked" : ""}> Must-do for me</label>
    <label>Link<input name="url" type="url" value="${esc(it.url || "")}"></label>
    <label>Notes<textarea name="notes" rows="2">${esc(it.notes || "")}</textarea></label>
    ${it.id ? `<button type="button" class="danger link" data-del>Delete</button>` : ""}`;
}
function readItemForm(f) {
  return {
    title: f.title.trim(),
    location: f.location.trim(),
    category: f.category,
    dayId: f.dayId || null,
    time: f.time || "",
    durationMin: +f.durationMin || 0,
    cost: +f.cost || 0,
    mustDo: f.mustDo === "on",
    url: f.url.trim(),
    notes: f.notes.trim(),
  };
}
const nextOrder = (dayId) => Math.max(0, ...dayItems(dayId).map((i) => i.order || 0)) + 1;

function newItem(dayId, prefill = {}) {
  openModal(itemForm(prefill, dayId), async (f) => {
    const data = readItemForm(f);
    const now = Date.now();
    await S.store.addItem(S.tripId, {
      image: "", description: "", ...prefill, ...data,
      order: data.dayId ? nextOrder(data.dayId) : 0,
      addedBy: S.me.email, addedByName: S.me.name, addedAt: now, ...stampMe(),
    });
    await log(`added “${data.title}”${data.dayId ? " to " + dayLabel(data.dayId) : " to ideas"}`);
    await touchTrip();
  });
}
const dayLabel = (id) => {
  const i = S.trip.days.findIndex((d) => d.id === id);
  return i < 0 ? "ideas" : `Day ${i + 1}`;
};
function editItem(id) {
  const it = S.items.find((i) => i.id === id);
  if (!it) return;
  openModal(itemForm(it), async (f) => {
    const data = readItemForm(f);
    const patch = { ...data, ...stampMe() };
    if (data.location !== (it.location || "")) Object.assign(patch, { lat: null, lng: null, geoFailed: false });
    if (data.dayId !== (it.dayId || null)) patch.order = data.dayId ? nextOrder(data.dayId) : 0;
    await S.store.updateItem(S.tripId, id, patch);
    const what = [];
    if (data.dayId !== (it.dayId || null)) what.push(`moved it to ${dayLabel(data.dayId)}`);
    if (data.time !== (it.time || "")) what.push(data.time ? `set the time to ${data.time}` : "cleared the time");
    if (data.cost !== (+it.cost || 0)) what.push(`changed the cost to ${money(data.cost)}`);
    if (data.mustDo !== !!it.mustDo) what.push(data.mustDo ? "marked it must-do" : "unmarked must-do");
    await log(`edited “${data.title}”${what.length ? ": " + what.join(", ") : ""}`);
    await touchTrip();
  });
  $form.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!confirm(`Delete “${it.title}”?`)) return;
    $modal.close();
    await S.store.deleteItem(S.tripId, id);
    await log(`deleted “${it.title}”`);
    await touchTrip();
  });
}
function editLeg(id) {
  const it = S.items.find((i) => i.id === id);
  const sch = dayItems(it.dayId);
  const prev = sch[sch.findIndex((x) => x.id === id) - 1];
  const t = it.travel || {};
  const d = prev ? km(prev, it) : null;
  const rec = d != null ? recommendMode(d, S.trip.prefs, dayItems(it.dayId).some((x) => ["rental", "car"].includes(x.travel?.mode))) : null;
  openModal(`<h3>Getting there</h3>
    <p class="muted">From <b>${esc(prev?.title || "previous stop")}</b> to <b>${esc(it.title)}</b>${d != null ? ` · about ${d < 10 ? d.toFixed(1) : Math.round(d)} km` : ""}</p>
    ${rec ? `<div class="rec">✨ Suggested: <b>${MODES[rec.mode].icon} ${MODES[rec.mode].label}</b>, ~${dur(rec.minutes)} (${esc(rec.why)}) <button type="button" class="btn-s" data-userec>Use this</button></div>` : `<p class="muted small">Add locations to both stops to get a suggestion.</p>`}
    <label>How<select name="mode"><option value="">Choose…</option>${opt(MODES, t.mode)}</select></label>
    <div class="grid2">
      <label>Travel time (min)<input name="minutes" type="number" min="0" step="5" value="${esc(t.minutes || "")}"></label>
      <label>Cost<input name="cost" type="number" min="0" inputmode="decimal" value="${esc(t.cost || "")}"></label>
    </div>
    <label>Notes<input name="notes" value="${esc(t.notes || "")}" placeholder="e.g. Metro line 2, or rental pickup at airport"></label>
    <p class="muted small">Tip: tap “Directions” next to the leg to check times and fares in Google Maps.</p>`,
    async (f) => {
      const travel = { mode: f.mode, minutes: +f.minutes || 0, cost: +f.cost || 0, notes: f.notes.trim() };
      await S.store.updateItem(S.tripId, id, { travel, ...stampMe() });
      await log(`set travel to “${it.title}”: ${MODES[f.mode]?.label || "unspecified"}${travel.minutes ? ", " + dur(travel.minutes) : ""}${travel.cost ? ", " + money(travel.cost) : ""}`);
      await touchTrip();
    });
  $form.querySelector("[data-userec]")?.addEventListener("click", () => {
    $form.mode.value = rec.mode;
    $form.minutes.value = rec.minutes;
  });
}

function editDay(id) {
  const i = S.trip.days.findIndex((d) => d.id === id);
  const d = S.trip.days[i];
  openModal(`<h3>Day ${i + 1}${dayDate(i) ? " · " + fmtDay(dayDate(i)) : ""}</h3>
    <label>Theme / title<input name="title" value="${esc(d.title || "")}" placeholder="e.g. Ubud temples & rice terraces"></label>
    <div class="grid2">
      <label>Staying in<input name="base" value="${esc(d.base || "")}" placeholder="Town or hotel"></label>
      <label>Day starts at<input name="startTime" type="time" value="${esc(d.startTime || "09:00")}"></label>
    </div>
    <label>Notes<textarea name="notes" rows="2">${esc(d.notes || "")}</textarea></label>
    <div class="row">
      <button type="button" data-insert>Insert a day after</button>
      <button type="button" class="danger" data-remove>Remove this day</button>
    </div>`,
    async (f) => {
      await S.store.txTrip(S.tripId, (cur) => ({
        days: cur.days.map((x) => (x.id === id ? { ...x, title: f.title.trim(), base: f.base.trim(), notes: f.notes.trim(), startTime: f.startTime } : x)),
        ...stampMe(),
      }));
      await log(`updated Day ${i + 1}${f.title ? " (" + f.title.trim() + ")" : ""}`);
    });
  $form.querySelector("[data-insert]").onclick = async () => {
    $modal.close();
    await S.store.txTrip(S.tripId, (cur) => {
      const days = [...cur.days];
      days.splice(days.findIndex((x) => x.id === id) + 1, 0, { id: uid(), title: "", base: "", notes: "" });
      return { days, ...stampMe() };
    });
    await log(`inserted a new day after Day ${i + 1} (now ${S.trip.days.length + 1} days)`);
  };
  $form.querySelector("[data-remove]").onclick = async () => {
    const n = dayItems(id).length;
    if (n && !confirm(`Day ${i + 1} has ${n} stop(s). They'll go back to Ideas. Remove the day?`)) return;
    $modal.close();
    await removeDay(id, i);
  };
}
async function removeDay(id, i) {
  const back = dayItems(id);
  if (back.length) await S.store.batchUpdateItems(S.tripId, back.map((it) => [it.id, { dayId: null, ...stampMe() }]));
  await S.store.txTrip(S.tripId, (cur) => ({ days: cur.days.filter((x) => x.id !== id), ...stampMe() }));
  await log(`removed Day ${i + 1}${back.length ? ` (${back.length} stop(s) moved back to ideas)` : ""}, now ${S.trip.days.length - 1} days`);
}
function pickDay(itemId) {
  const it = S.items.find((i) => i.id === itemId);
  if (!S.trip.days.length) return toast("Add a day first.");
  openModal(`<h3>Add “${esc(it.title)}” to…</h3>
    <div class="pick-days">${S.trip.days.map((d, i) => `<label class="pick"><input type="radio" name="dayId" value="${d.id}" ${i === 0 ? "checked" : ""}> Day ${i + 1}${dayDate(i) ? " · " + fmtDay(dayDate(i)) : ""}${d.title ? " · " + esc(d.title) : ""} <span class="muted small">(${dayItems(d.id).length} stops)</span></label>`).join("")}</div>`,
    async (f) => {
      await S.store.updateItem(S.tripId, itemId, { dayId: f.dayId, order: nextOrder(f.dayId), ...stampMe() });
      await log(`scheduled “${it.title}” on ${dayLabel(f.dayId)}`);
      await touchTrip();
    });
}
function pickForDay(dayId) {
  const list = ideas();
  if (!list.length) return toast("No ideas waiting. Paste a link first.");
  openModal(`<h3>Add to ${dayLabel(dayId)}</h3>
    <div class="pick-days">${list.map((it) => `<label class="pick"><input type="checkbox" name="i_${it.id}"> ${CATEGORIES[it.category]?.icon || ""} ${esc(it.title)} <span class="muted small">· ${esc(who(it.addedBy))}${it.mustDo ? " · must-do" : ""}</span></label>`).join("")}</div>`,
    async (f) => {
      const ids = Object.keys(f).filter((k) => k.startsWith("i_")).map((k) => k.slice(2));
      let o = nextOrder(dayId);
      await S.store.batchUpdateItems(S.tripId, ids.map((id) => [id, { dayId, order: o++, ...stampMe() }]));
      if (ids.length) await log(`added ${ids.map((id) => "“" + S.items.find((i) => i.id === id)?.title + "”").join(", ")} to ${dayLabel(dayId)}`);
      await touchTrip();
    });
}
async function move(id, dir) {
  const it = S.items.find((i) => i.id === id);
  const list = dayItems(it.dayId);
  const k = list.findIndex((x) => x.id === id);
  const other = list[k + dir];
  if (!other) {
    // Past the edge of the day: hop to the neighbouring day.
    const di = S.trip.days.findIndex((d) => d.id === it.dayId);
    const nd = S.trip.days[di + dir];
    if (!nd) return;
    const target = dayItems(nd.id);
    const order = dir < 0 ? (target.length ? target[target.length - 1].order + 1 : 1) : (target.length ? target[0].order - 1 : 1);
    await S.store.updateItem(S.tripId, id, { dayId: nd.id, order, ...stampMe() });
    await log(`moved “${it.title}” to ${dayLabel(nd.id)}`);
    return touchTrip();
  }
  await S.store.batchUpdateItems(S.tripId, [[id, { order: other.order, ...stampMe() }], [other.id, { order: it.order }]]);
  await log(`moved “${it.title}” ${dir < 0 ? "before" : "after"} “${other.title}” on ${dayLabel(it.dayId)}`);
  await touchTrip();
}

/* --------------------------------------------------------------- add links */
async function addLink(raw) {
  const url = extractUrl(raw);
  if (!url) return toast("That doesn't look like a link.");
  if (S.items.some((i) => i.url === url)) return toast("You've already saved that link.");
  S.busy = "Reading the link…";
  render();
  try {
    const m = await unfurl(url);
    const t = S.trip;
    let places = readLink(m, t);
    let viaAi = false;
    if (t.ai?.key) {
      S.busy = "Gemini is reading the page…";
      render();
      try {
        const found = await extractLink(t.ai.key, url, m, t, profileText(profileOf(t)));
        if (found.length) {
          places = found.map((p) => ({
            title: String(p.name).slice(0, 140), category: CATEGORIES[p.category] ? p.category : "sight",
            location: [p.address, t.destination].filter(Boolean).join(", "), durationMin: Number(p.durationMin) || 90,
            cost: Number(p.approxCost) || 0, bestTime: p.bestTime || "",
            notes: [p.hours, p.category === "food" && { yes: "Vegetarian friendly", some: "Some vegetarian dishes", no: "Mostly meat or fish: check the vegetarian options" }[p.vegetarian], p.bestTime && `Best at ${p.bestTime}`].filter(Boolean).join(" · "),
            description: p.why || (found.length === 1 ? m.description || "" : ""), image: found.length === 1 ? m.image || "" : "", siteName: m.siteName || "", url,
          }));
          viaAi = true;
        }
      } catch (e) {
        console.warn("gemini link", e.message);
      }
    }
    const now = Date.now();
    const placedOn = [];
    let firstId = null;
    S.busy = places.length > 1 ? `Adding ${places.length} places to the plan…` : "Adding it to the plan…";
    render();
    for (const p of places) {
      const data = {
        title: p.title || "Saved link", description: p.description || "", image: p.image || "", siteName: p.siteName || "",
        location: p.location || "", ...(Number.isFinite(p.lat) ? { lat: p.lat, lng: p.lng } : {}),
        url: p.url || url, category: p.category || "sight", dayId: null, order: 0, time: "",
        durationMin: p.durationMin || 60, cost: p.cost || 0, mustDo: false, notes: p.notes || "", bestTime: p.bestTime || "",
        fromLink: true, addedBy: S.me.email, addedByName: S.me.name, addedAt: now, ...stampMe(),
      };
      if (!has(data) && (data.location || places.length > 1)) {
        const g = await geocode(`${data.location || data.title}${data.location.includes(t.destination) ? "" : ", " + t.destination}`).catch(() => null);
        if (g) Object.assign(data, { lat: g.lat, lng: g.lng });
      }
      const id = await S.store.addItem(S.tripId, data);
      firstId ||= id;
      const where = profileOf(t).autoPlace !== false ? await placeIdea({ ...data, id }) : null;
      placedOn.push([data.title, where]);
    }
    await log(places.length > 1 ? `saved a link with ${places.length} places: ${places.map((p) => "“" + p.title + "”").join(", ")}` : `saved a link: “${places[0].title}”`);
    await touchTrip();
    const input = document.getElementById("linkInput");
    if (input) input.value = "";
    const days = placedOn.filter(([, w]) => w?.dayIndex != null);
    const msg = days.length
      ? days.length === 1 && placedOn.length === 1
        ? `Added “${days[0][0]}” to Day ${days[0][1].dayIndex + 1}${days[0][1].why ? ` ${days[0][1].why}` : ""}.`
        : `Added ${days.length === placedOn.length ? (days.length === 2 ? "both" : "all " + days.length) : days.length + " of " + placedOn.length} places to the plan (${[...new Set(days.map(([, w]) => "Day " + (w.dayIndex + 1)))].sort().join(", ")})${days.length < placedOn.length ? ". The rest are in Ideas" : ""}.`
      : placedOn.some(([, w]) => w?.far) ? `Saved to Ideas. It looks far from ${t.destination}.` : m.ok ? "Saved to Ideas." : "Saved. Couldn't read the page, so add a name and location.";
    toast(msg + (viaAi ? " Read by Gemini." : ""), 5000);
    if (S.tab !== "ideas" && S.tab !== "plan") S.tab = days.length ? "plan" : "ideas";
    if (places.length === 1 && (!m.ok || !places[0].location) && !viaAi && !days.length) editItem(firstId);
  } finally {
    S.busy = false;
    render();
  }
}

// Puts a new stop on the best day: near what's already there, with room, at the right time of day.
// A restaurant takes over a travel-guide meal slot; on a full day a travel-guide pick goes back to Ideas.
const PACE_H = { relaxed: 7, balanced: 9, packed: 11 };
const SLOT = { sunrise: ["06:00", true], morning: ["10:00"], lunch: ["13:00"], afternoon: ["16:30"], sunset: ["17:30", true], evening: ["18:30"], night: ["21:00"] };
async function placeIdea(it) {
  const t = S.trip;
  if (!t.days.length || ["stay", "transport", "other"].includes(it.category)) return null;
  if (has(it) && has(t.place) && km(it, t.place) > 150) return { far: true };
  const maxMin = (PACE_H[t.prefs?.pace] || 9) * 60;
  const isRest = (x) => x.rest;
  const guidePick = (x) => x.suggestedBy && !x.mustDo && !x.rest && !/splurge/i.test(x.notes || "");
  const days = t.days.map((d, i) => {
    const list = dayItems(d.id).filter((x) => x.id !== it.id);
    const pts = list.filter(has);
    const c = pts.length ? { lat: pts.reduce((a, x) => a + x.lat, 0) / pts.length, lng: pts.reduce((a, x) => a + x.lng, 0) / pts.length } : null;
    const busy = list.filter((x) => !isRest(x)).reduce((a, x) => a + (Number(x.durationMin) || 60) + (Number(x.travel?.minutes) || 0), 0);
    const dist = has(it) && c ? km(it, c) : null;
    const near = has(it) ? pts.map((x) => [km(it, x), x]).sort((a, b) => a[0] - b[0])[0] : null;
    return { d, i, list, busy, dist, near };
  });
  const byDist = [...days].sort((a, b) => (a.dist ?? 5) - (b.dist ?? 5) || a.busy - b.busy);
  const nearTxt = (x) => (x.near && x.near[0] < 5 ? `near ${x.near[1].title}` : "");
  const writes = [];
  let target = null, order = null, time = "", swapped = null;

  if (it.category === "food") {
    const want = /lunch|morning|afternoon/.test(it.bestTime) ? ["13:00"] : /evening|night|sunset/.test(it.bestTime) ? ["20:00"] : ["13:00", "20:00"];
    for (const x of byDist) {
      const meal = x.list.find((y) => guidePick(y) && y.category === "food" && want.includes(y.time));
      if (meal) {
        target = x; order = meal.order; time = meal.time; swapped = meal;
        writes.push([meal.id, { dayId: null, order: 0, time: "", ...stampMe() }]);
        break;
      }
    }
  }
  if (!target) {
    const need = Number(it.durationMin) || 60;
    const room = byDist.filter((x) => maxMin - x.busy >= need);
    target = room[0] || byDist[0];
    if (!room.length) {
      const out = target.list.filter((y) => guidePick(y) && y.category !== "food" && !y.time).sort((a, b) => (b.durationMin || 60) - (a.durationMin || 60))[0];
      if (out) (swapped = out), writes.push([out.id, { dayId: null, order: 0, ...stampMe() }]);
    }
    const [slot, fixed] = SLOT[it.bestTime] || SLOT.afternoon;
    order = orderForTime(target.d.id, slot);
    time = fixed ? slot : "";
  }
  writes.push([it.id, { dayId: target.d.id, order, time, ...stampMe() }]);
  await S.store.batchUpdateItems(S.tripId, writes);
  await new Promise((r) => setTimeout(r, 120));
  const why = [nearTxt(target), swapped && `in place of ${swapped.title}`].filter(Boolean);
  return { dayIndex: target.i, why: why.length ? `(${why.join(", ")})` : "" };
}

// Links shared to the installed app from another app (Android share sheet) arrive as URL params.
function takeSharedLink() {
  const p = new URLSearchParams(location.search);
  const raw = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
  if (raw && extractUrl(raw)) {
    sessionStorage.setItem("tp-shared", extractUrl(raw));
    history.replaceState(null, "", location.pathname + location.hash);
  }
}
async function handlePendingShare() {
  const url = sessionStorage.getItem("tp-shared");
  if (!url || !S.me) return;
  if (S.tripId && S.trip) {
    sessionStorage.removeItem("tp-shared");
    return addLink(url);
  }
  if (!S.tripId && S.trips.length === 1) return openTrip(S.trips[0].id);
  if (!S.tripId && S.trips.length > 1) {
    sessionStorage.removeItem("tp-shared");
    openModal(`<h3>Save this link to which trip?</h3><p class="muted small">${esc(url)}</p>
      <div class="pick-days">${S.trips.map((t, i) => `<label class="pick"><input type="radio" name="trip" value="${t.id}" ${i === 0 ? "checked" : ""}> ${esc(t.name)}</label>`).join("")}</div>`,
      async (f) => {
        sessionStorage.setItem("tp-shared", url);
        openTrip(f.trip);
      });
  }
}

/* ------------------------------------------------------------------ events */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action, id = b.dataset.id;
  try {
    switch (a) {
      case "signin":
        await S.store.signIn(document.getElementById("demoName")?.value);
        break;
      case "signout":
        goHome();
        await S.store.signOut();
        break;
      case "newTrip": return newTrip();
      case "open": return openTrip(id);
      case "editTrip": return editTrip();
      case "invite": return invite();
      case "tab":
        S.tab = b.dataset.tab;
        localSet("tab", S.tab);
        return render();
      case "addLink": return addLink(document.getElementById("linkInput").value);
      case "pasteLink": {
        try {
          const txt = await navigator.clipboard.readText();
          if (!extractUrl(txt)) return toast("No link on the clipboard.");
          return addLink(txt);
        } catch {
          toast("Long-press the box and choose Paste.");
          document.getElementById("linkInput").focus();
        }
        return;
      }
      case "newItem": return newItem(b.dataset.day);
      case "editItem": return editItem(id);
      case "editLeg": return editLeg(id);
      case "editDay": return editDay(id);
      case "schedule": return pickDay(id);
      case "pickForDay": return pickForDay(id);
      case "up": return move(id, -1);
      case "down": return move(id, 1);
      case "addDay":
        await S.store.txTrip(S.tripId, (cur) => ({ days: [...cur.days, { id: uid(), title: "", base: "", notes: "" }], ...stampMe() }));
        return log(`added a day (now ${S.trip.days.length + 1} days)`);
      case "removeLastDay": {
        const last = S.trip.days[S.trip.days.length - 1];
        const n = dayItems(last.id).length;
        if (n && !confirm(`The last day has ${n} stop(s). They'll go back to Ideas. Remove it?`)) return;
        return removeDay(last.id, S.trip.days.length - 1);
      }
      case "addExtra": {
        const label = document.getElementById("extraLabel").value.trim();
        const cost = +document.getElementById("extraCost").value || 0;
        if (!label || !cost) return toast("Add a description and a cost.");
        await S.store.txTrip(S.tripId, (cur) => ({ extras: [...(cur.extras || []), { id: uid(), label, cost, by: S.me.email }], ...stampMe() }));
        document.getElementById("extraLabel").value = document.getElementById("extraCost").value = "";
        return log(`added a cost: ${label}, ${money(cost)}`);
      }
      case "delExtra": {
        const ex = S.trip.extras.find((x) => x.id === id);
        await S.store.txTrip(S.tripId, (cur) => ({ extras: (cur.extras || []).filter((x) => x.id !== id), ...stampMe() }));
        return log(`removed a cost: ${ex?.label}`);
      }
      case "print": return window.print();
      case "analyse": return runAnalyse();
      case "home": return goHome();
      case "discFilter":
        S.discFilter = id;
        return render();
      case "refreshDest": return ensureDestination(true);
      case "buildSample": return buildSampleItinerary();
      case "editProfile": return editProfile();
      case "discAdd": {
        const list = b.dataset.src === "ai" ? S.trip.aiPicks.items : S.trip.guide.listings;
        const x = list[+id];
        if (!x || inTrip(x.name)) return;
        await S.store.addItem(S.tripId, b.dataset.src === "ai" ? aiToItem(x) : guideToItem(x));
        await log(`added “${x.name}” to ideas from ${b.dataset.src === "ai" ? "Gemini's picks" : "the travel guide"}`);
        toast("Added to Ideas.");
        return touchTrip();
      }
      case "aiSettings": return aiSettings();
      case "aiPicks": return runAiPicks();
      case "aiReview": return runAiReview();
      case "aiApply": return applyAi(+id);
      case "copyForClaude": {
        const ask = id === "drive"
          ? `This is our final plan for ${S.trip.destination || "our trip"}. Use the Trip Sheet (travel-itinerary-planner) skill to turn it into a Trip Sheet, and file it in my Google Drive under Travel - Sanj_Akash with the usual folder naming. Keep our choices; fill in real times, legs, costs and bookings.`
          : `Please review our trip plan for ${S.trip.destination || "our trip"}. Check pacing, opening hours and best times, how we get between places (car, train, taxi, walking), must-dos, balance between what each of us wanted, budget and anything missing. Tell us exactly what to change, by day.`;
        const txt = ask + "\n\n" + JSON.stringify(planSnapshot(), null, 1);
        await navigator.clipboard.writeText(txt);
        return toast("Plan copied. Paste it into Claude.");
      }
      case "applySug": return applySuggestions([id]);
      case "applyAll": return applySuggestions(smartList().filter((x) => x.level === "fix" && x.changes.length).map((x) => x.id));
      case "dismissSug": {
        const k = "dismiss-" + S.tripId;
        const set = new Set(JSON.parse(localGet(k) || "[]"));
        set.add(id);
        localSet(k, JSON.stringify([...set]));
        return render();
      }
      case "undismiss":
        localSet("dismiss-" + S.tripId, "[]");
        return render();
      case "copyItin": {
        const txt = document.getElementById("itinDoc").innerText;
        await navigator.clipboard.writeText(txt);
        return toast("Itinerary copied.");
      }
    }
  } catch (err) {
    console.error(err);
    toast("Something went wrong: " + (err.message || err));
  }
});
document.addEventListener("change", async (e) => {
  const k = e.target.dataset.pref;
  if (!k || !S.tripId) return;
  await S.store.txTrip(S.tripId, (cur) => ({ prefs: { ...(cur.prefs || {}), [k]: e.target.value }, ...stampMe() }));
  log(`set ${{ pace: "the pace", travel: "the travel style", dayEnd: "the latest finish" }[k]} to “${e.target.selectedOptions?.[0]?.text || e.target.value}”`);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "linkInput") addLink(e.target.value);
  if (e.key === "Enter" && e.target.id === "demoName") document.querySelector("[data-action=signin]")?.click();
});
// Pasting a link straight into the box saves it immediately.
document.addEventListener("paste", (e) => {
  if (e.target.id !== "linkInput") return;
  const txt = e.clipboardData?.getData("text");
  if (extractUrl(txt)) {
    e.preventDefault();
    e.target.value = extractUrl(txt);
    addLink(txt);
  }
});
document.getElementById("homeBtn").onclick = () => S.me && goHome();
// Keep "x min ago" labels and the online dots fresh.
setInterval(() => { if (S.tripId && !$modal.open) render(); }, 60000);

/* -------------------------------------------------------------------- boot */
(async function boot() {
  takeSharedLink();
  try {
    S.store = await createStore();
  } catch (e) {
    $app.innerHTML = `<div class="loading">Couldn't load. Check your connection and config.js.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  let tripsUnsub = null;
  S.store.onUser((u) => {
    S.me = u;
    tripsUnsub?.();
    if (!u) {
      stopTrip();
      S.tripId = null;
      return render();
    }
    let first = true;
    tripsUnsub = S.store.watchTrips(u.email, (trips) => {
      S.trips = trips;
      // Record my display name on trips I've been invited to, so the other person sees a name, not an email.
      for (const t of trips)
        if (!t.memberNames?.[u.email])
          S.store.txTrip(t.id, (cur) => ({ memberNames: { ...(cur.memberNames || {}), [u.email]: u.name } })).catch(() => {});
      if (first) {
        first = false;
        const want = (location.hash.match(/trip=([\w-]+)/) || [])[1] || localGet("trip");
        if (want && trips.some((t) => t.id === want)) openTrip(want);
      }
      if (!S.tripId) render();
      handlePendingShare();
    }, (e) => {
      console.error(e);
      toast("Couldn't load trips: " + e.message);
    });
    render();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();

// After a trip opens, pick up a link that was shared into the app.
setInterval(() => {
  if (S.trip && sessionStorage.getItem("tp-shared") && !S.busy) handlePendingShare();
}, 800);
