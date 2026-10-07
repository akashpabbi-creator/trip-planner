// kit: Exports (day route link, .ics, .kml), Today card, Packing + To-dos, Spending log.
// Other modules add their sections to the Kit tab through the "kit" slot (shown first).
let ctx, S;
const q = new URLSearchParams(location.search);
const NOW_OVERRIDE = (q.get("now") || "").match(/^\d{1,2}:\d{2}$/)?.[0] || ""; // test override: ?now=HH:MM
const TRANSIT = new Set(["transit", "bus", "train", "ferry"]);
const drafts = {}; // typed-but-unsent input values, kept across re-renders
const ui = { spendForm: false };
let lastCur = "";

const CSS = `
.today-card { background: var(--accent-soft); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; margin: 0 0 14px; }
.today-card .tc-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.today-card .tc-next { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.today-card .tc-t { font-size: 18px; font-weight: 600; }
.today-card .tc-line { margin-top: 4px; font-size: 14px; }
.k-sec .k-list { list-style: none; margin: 0; padding: 0; }
.k-row { display: flex; align-items: center; gap: 8px; padding: 8px 2px; border-bottom: 1px solid var(--line); }
.k-row label { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; cursor: pointer; }
.k-row input[type=checkbox] { width: 20px; height: 20px; flex: none; accent-color: var(--accent); }
.k-row.done .k-t { text-decoration: line-through; color: var(--muted); }
.k-row .k-meta { margin-left: auto; white-space: nowrap; }
.k-row .k-x { border: 0; background: none; color: var(--muted); padding: 2px 8px; }
.k-add { margin-top: 10px; }
.k-add select { flex: 0 1 130px; }
.k-suggest { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 0; }
.k-sum { display: flex; gap: 6px 18px; flex-wrap: wrap; margin: 4px 0 10px; font-size: 14px; }
.k-sum b { font-size: 17px; }
.k-spend-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; }
.k-spend-form .wide { grid-column: 1 / -1; }
.k-spend-form input, .k-spend-form select { width: 100%; min-width: 0; }
.k-day-h { margin: 12px 0 2px; font-size: 13px; color: var(--muted); font-weight: 600; }
.k-amt { margin-left: auto; text-align: right; white-space: nowrap; }
.k-owes { margin: 10px 0 0; font-size: 14px; }
.k-how { flex-basis: 100%; margin: 2px 0 0; }
.k-route { text-decoration: none; color: var(--accent); }
`;

export function init(c) {
  ctx = c;
  S = c.S;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-kit", textContent: CSS }));

  ctx.tab({ id: "kit", icon: "🎒", label: "Kit", order: 50, view: viewKit });
  ctx.slot("planTop", todayCard);
  ctx.slot("dayHead", routeLink);
  ctx.slot("itinActions", exportButtons);
  ctx.slot("budget", spendSection);

  ctx.action("kAdd", addItem);
  ctx.action("kTick", tickItem);
  ctx.action("kDel", delItem);
  ctx.action("kSuggest", suggestItems);
  ctx.action("kIcs", () => download(slug() + ".ics", "text/calendar;charset=utf-8", buildIcs()));
  ctx.action("kKml", () => download(slug() + ".kml", "application/vnd.google-earth.kml+xml", buildKml()));
  ctx.action("kSpendForm", () => { ui.spendForm = !ui.spendForm; ctx.render(); });
  ctx.action("kSpendAdd", addSpend);
  ctx.action("kSpendDel", delSpend);
  ctx.action("kSplit", async (btn) => {
    const on = !!btn.checked;
    await S.store.txTrip(S.tripId, (cur) => ({ prefs: { ...(cur.prefs || {}), split: on }, ...ctx.stampMe() }));
  });

  document.addEventListener("input", (e) => { if (e.target.dataset?.kd) drafts[e.target.id] = e.target.value; });
  document.addEventListener("keydown", (e) => {
    const m = /^kAdd-(pack|todo)$/.exec(e.target.id || "");
    if (m && e.key === "Enter") { e.preventDefault(); addItem(null, m[1]); }
  });
  ctx.on("render", restoreDrafts);
  ctx.on("trip", () => fixPending());
  window.addEventListener("online", () => fixPending(true));
}

/* ------------------------------------------------------------------ helpers */
const trip = () => S.trip;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nowMin = () => {
  if (NOW_OVERRIDE) return ctx.toMin(NOW_OVERRIDE);
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const slug = () => (trip().name || "trip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
const members = () => trip().members || [];
function restoreDrafts() {
  for (const [id, v] of Object.entries(drafts)) {
    const el = document.getElementById(id);
    if (el && el.value !== v && document.activeElement !== el) el.value = v;
  }
}
const clearDrafts = (...ids) => ids.forEach((id) => { delete drafts[id]; const el = document.getElementById(id); if (el) el.value = ""; });
function download(name, mime, text) {
  if (text == null) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ------------------------------------------------------------ day route link */
function pointOf(it) {
  if (Number.isFinite(it.lat) && Number.isFinite(it.lng)) return `${it.lat},${it.lng}`;
  return decodeURIComponent(ctx.mapsQ(it.location || it.title || ""));
}
function routeMode(stops) {
  const modes = stops.slice(1).map((s) => s.travel?.mode).filter(Boolean);
  if (modes.length && modes.every((m) => m === "walk")) return "walking";
  if (modes.some((m) => TRANSIT.has(m))) return "transit";
  return "driving";
}
export function routeUrl(stops) {
  if (stops.length < 2) return "";
  let mids = stops.slice(1, -1);
  if (mids.length > 9) mids = Array.from({ length: 9 }, (_, k) => mids[Math.round((k * (mids.length - 1)) / 8)]);
  const e = encodeURIComponent;
  let u = `https://www.google.com/maps/dir/?api=1&origin=${e(pointOf(stops[0]))}&destination=${e(pointOf(stops[stops.length - 1]))}`;
  if (mids.length) u += `&waypoints=${mids.map((s) => e(pointOf(s))).join("%7C")}`;
  return u + `&travelmode=${routeMode(stops)}`;
}
function routeLink(day) {
  const stops = ctx.schedule(day.id).map((s) => s.it);
  if (stops.length < 2) return "";
  return `<a class="btn-s k-route" href="${ctx.esc(routeUrl(stops))}" target="_blank" rel="noopener" title="The whole day as one route in Google Maps">Route</a>`;
}

/* ---------------------------------------------------------------- Today card */
function todayCard() {
  const i = ctx.today();
  if (i < 0) return "";
  const t = trip(), day = t.days[i], date = ctx.dayDate(i);
  const sch = ctx.schedule(day.id);
  const now = nowMin();
  const E = ctx.esc;
  const nextK = sch.findIndex((s) => s.start > now);
  const cur = sch.find((s) => s.start <= now && s.end > now);
  const next = nextK >= 0 ? sch[nextK] : null;
  const then = nextK >= 0 ? sch[nextK + 1] : null;
  const w = t.weather?.days?.[i];
  const wx = w && Number.isFinite(w.max) ? `<span class="small">${w.icon || ""} ${w.max}°/${w.min}°${w.rainPct >= 40 ? ` · ${w.rainPct}% rain` : ""}</span>` : "";
  const day8 = date ? ymd(date) : "";
  const books = (t.bookings || []).filter((b) => day8 && String(b.start || "").slice(0, 10) === day8);
  let leg = 0;
  if (next) leg = nextK > 0 || next.it.travel?.fromPrevDay ? Number(next.it.travel?.minutes) || 0 : 0;
  const m = next && ctx.MODES[next.it.travel?.mode];
  return `<section class="today-card" id="todayCard">
    <div class="tc-head"><b>Today · Day ${i + 1}</b><span class="muted small">${E(ctx.fmtDay(date))}</span>${wx}</div>
    ${cur ? `<div class="tc-line">Now: <b>${E(cur.it.title)}</b> <span class="muted">until ${ctx.fromMin(cur.end)}</span></div>` : ""}
    ${next
      ? `<div class="tc-next"><div><div class="tc-t">${ctx.fromMin(next.start)} · ${E(next.it.title)}</div>
          ${leg ? `<div class="tc-line">Leave by <b>${ctx.fromMin(next.start - leg)}</b> <span class="muted">· ${m ? m.icon + " " : ""}${ctx.dur(leg)}</span></div>` : ""}</div>
          <a class="btn-s dir-link" href="${ctx.directionsUrl(next.it)}" target="_blank" rel="noopener">Directions</a></div>`
      : `<div class="tc-line">${sch.length ? "That's everything planned for today." : "Nothing is planned for today yet."}</div>`}
    ${then ? `<div class="tc-line muted">Then: ${ctx.fromMin(then.start)} · ${E(then.it.title)}</div>` : ""}
    ${books.map((b) => `<div class="tc-line">🎫 ${E(b.title)}${b.start.length > 10 ? ` · ${E(b.start.slice(11, 16))}` : ""}${b.ref ? ` · <b>${E(b.ref)}</b>` : ""}</div>`).join("")}
  </section>`;
}

/* ----------------------------------------------------------------- Kit tab */
function viewKit() {
  return `<div class="kit">
    ${ctx.renderSlot("kit")}
    <div class="k-suggest"><button class="btn-s" data-action="kSuggest">Suggest items</button><span class="muted small">Ideas for packing and to-dos from the weather, your plan and where you're going.</span></div>
    ${checklistSection("pack", "Packing", "Nothing to pack yet. Add things yourself, or tap Suggest items.", "Add something to pack")}
    ${checklistSection("todo", "To-dos", "No to-dos yet. Visas, tickets and things to book before you go can live here.", "Add a to-do")}
  </div>`;
}
const list = (group) => (trip().checklist || []).filter((x) => x.group === group);
function checklistSection(group, title, empty, ph) {
  const E = ctx.esc, items = list(group), done = items.filter((x) => x.done).length;
  const me = S.me.email;
  return `<section class="d-sec k-sec" id="kit-${group}">
    <div class="d-head"><h3>${title}</h3>${items.length ? `<span class="muted small">${done} of ${items.length} done</span>` : ""}</div>
    ${items.length ? `<ul class="k-list">${items.map((x) => `<li class="k-row ${x.done ? "done" : ""}" data-kid="${x.id}">
      <label><input type="checkbox" data-action="kTick" data-id="${x.id}" ${x.done ? "checked" : ""}><span class="k-t">${E(x.text)}</span></label>
      <span class="muted small k-meta">${[x.who ? "for " + E(ctx.who(x.who)) : "", x.done && x.doneBy ? "ticked by " + E(ctx.who(x.doneBy)) : ""].filter(Boolean).join(" · ")}</span>
      ${!x.by || x.by === me || x.auto ? `<button class="k-x" data-action="kDel" data-id="${x.id}" title="Delete" aria-label="Delete ${E(x.text)}">✕</button>` : ""}
    </li>`).join("")}</ul>` : `<p class="empty small">${empty}</p>`}
    <div class="row k-add"><input id="kAdd-${group}" data-kd="1" placeholder="${ph}" autocomplete="off">
      ${group === "todo" ? `<select id="kWho" data-kd="1" aria-label="Who"><option value="">Anyone</option>${members().map((m) => `<option value="${E(m)}">${E(ctx.who(m))}</option>`).join("")}</select>` : ""}
      <button class="btn-s" data-action="kAdd" data-id="${group}">Add</button></div>
  </section>`;
}
async function mutateList(fn) {
  await S.store.txTrip(S.tripId, (cur) => ({ checklist: fn([...(cur.checklist || [])]), ...ctx.stampMe() }));
}
async function addItem(btn, group) {
  group = group || btn.dataset.id;
  const el = document.getElementById("kAdd-" + group);
  const text = (el?.value || "").trim();
  if (!text) return el?.focus();
  const who = group === "todo" ? document.getElementById("kWho")?.value || "" : "";
  const item = { id: ctx.uid(), text, group, who, done: false, doneBy: "", at: Date.now(), auto: false, by: S.me.email };
  clearDrafts("kAdd-" + group, "kWho");
  await mutateList((l) => [...l, item]);
  ctx.log(`added “${text}” to ${group === "pack" ? "Packing" : "To-dos"}`);
}
async function tickItem(btn, id) {
  await mutateList((l) => l.map((x) => (x.id !== id ? x : x.done ? { ...x, done: false, doneBy: "", at: Date.now() } : { ...x, done: true, doneBy: S.me.email, at: Date.now() })));
}
async function delItem(btn, id) {
  const it = (trip().checklist || []).find((x) => x.id === id);
  await mutateList((l) => l.filter((x) => x.id !== id));
  if (it) ctx.log(`removed “${it.text}” from ${it.group === "pack" ? "Packing" : "To-dos"}`);
}

/* ---- rule-based suggestions */
const INDIA = { lat: [6, 36], lng: [68, 98] };
function isAbroad(t) {
  if (/india/i.test(t.destination || "")) return false;
  const p = t.place;
  if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (p.lat >= INDIA.lat[0] && p.lat <= INDIA.lat[1] && p.lng >= INDIA.lng[0] && p.lng <= INDIA.lng[1]) return (t.currency || "INR") !== "INR";
    else return true;
  return (t.currency || "INR") !== "INR";
}
export function suggestions(t, items) {
  const out = [];
  const add = (group, text) => out.push({ group, text });
  const days = t.weather?.days || [];
  if (days.some((d) => d.rainPct >= 40 || (d.rainPct == null && d.rain >= 2))) { add("pack", "Umbrella"); add("pack", "Rain jacket"); }
  if (days.some((d) => d.max >= 28)) { add("pack", "Sunscreen"); add("pack", "Hat or cap"); }
  if (days.some((d) => d.min <= 12)) add("pack", "Warm layer");
  const placed = items.filter((i) => (t.days || []).some((d) => d.id === i.dayId));
  const blob = placed.map((i) => `${i.title} ${i.notes || ""} ${i.description || ""} ${i.category === "nature" ? "nature" : ""}`).join(" ");
  if (/hike|hiking|trek|trail|nature|waterfall|mountain|volcano|national park/i.test(blob)) add("pack", "Comfortable walking shoes");
  if (/temple|church|cathedral|basilica|mosque|monastery|gurdwara|shrine|mandir|duomo|vatican/i.test(blob)) add("pack", "Clothes covering shoulders and knees");
  if (/beach|snorkel|swim|lagoon/i.test(blob)) add("pack", "Swimwear");
  if (isAbroad(t)) {
    add("pack", "Passport"); add("todo", "Check visa requirements"); add("pack", "Forex card and some local cash");
    add("todo", "Get travel insurance"); add("pack", "Plug adapter");
  }
  if ((t.bookings || []).some((b) => ["flight", "train", "bus", "ferry", "tickets"].includes(b.kind))) add("todo", "Download tickets and booking confirmations");
  for (const i of placed) if (/book(ing)?\s+(ahead|in advance)|advance booking/i.test(`${i.notes || ""}`)) add("todo", `Book ${i.title}`);
  return out;
}
async function suggestItems() {
  const t = trip();
  const have = new Set((t.checklist || []).map((x) => x.group + "|" + x.text.trim().toLowerCase()));
  const fresh = [];
  for (const s of suggestions(t, S.items)) {
    const k = s.group + "|" + s.text.toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    fresh.push({ id: ctx.uid(), text: s.text, group: s.group, who: "", done: false, doneBy: "", at: Date.now(), auto: true, by: S.me.email });
  }
  if (!fresh.length) return ctx.toast("Nothing new to suggest right now.");
  // Re-check inside the transaction so two people tapping at once don't double up.
  await S.store.txTrip(S.tripId, (cur) => {
    const exist = new Set((cur.checklist || []).map((x) => x.group + "|" + x.text.trim().toLowerCase()));
    return { checklist: [...(cur.checklist || []), ...fresh.filter((f) => !exist.has(f.group + "|" + f.text.toLowerCase()))], ...ctx.stampMe() };
  });
  const np = fresh.filter((f) => f.group === "pack").length;
  ctx.toast(`Added ${fresh.length} suggestion${fresh.length > 1 ? "s" : ""}: ${np} to pack, ${fresh.length - np} to do.`);
  ctx.log(`added ${fresh.length} suggested items to the Kit`);
}

/* ------------------------------------------------------------ Spending log */
const HOURS12 = 12 * 3600e3;
async function getJson(url) {
  const ac = new AbortController();
  const h = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error("rate " + r.status);
    return await r.json();
  } finally { clearTimeout(h); }
}
async function fetchRate(from, to) {
  const tries = [
    async () => (await getJson(`https://api.frankfurter.app/latest?from=${from}&to=${to}`))?.rates?.[to],
    async () => (await getJson(`https://open.er-api.com/v6/latest/${from}`))?.rates?.[to],
  ];
  for (const t of tries) {
    try { const v = Number(await t()); if (v > 0) return v; } catch {}
  }
  return 0;
}
// 1 unit of `from` in trip currency. Cached on the trip for 12 h; a stale rate beats none when offline.
async function rateFor(from) {
  const base = trip().currency || "INR";
  if (from === base) return 1;
  const r = trip().rates;
  const fresh = r && r.base === base && Date.now() - (r.at || 0) < HOURS12;
  if (fresh && r.map?.[from]) return r.map[from];
  const v = await fetchRate(from, base);
  if (v) {
    await S.store.txTrip(S.tripId, (cur) => {
      const c = cur.rates, keep = c && c.base === base && Date.now() - (c.at || 0) < HOURS12;
      return { rates: { base, at: keep ? c.at : Date.now(), map: { ...(keep ? c.map : {}), [from]: v } } };
    });
    return v;
  }
  return (r && r.base === base && r.map?.[from]) || 0;
}
let fixing = false, fixedAt = 0;
async function fixPending(force) {
  const t = trip();
  if (fixing || !t || !S.tripId || (!force && Date.now() - fixedAt < 30000)) return;
  const pend = (t.spends || []).filter((s) => s.inTrip == null);
  if (!pend.length || navigator.onLine === false) return;
  fixing = true; fixedAt = Date.now();
  try {
    const rates = {};
    for (const cur of new Set(pend.map((s) => s.currency))) rates[cur] = await rateFor(cur);
    if (Object.values(rates).some(Boolean))
      await S.store.txTrip(S.tripId, (cur) => ({ spends: (cur.spends || []).map((s) => (s.inTrip == null && rates[s.currency] ? { ...s, inTrip: Math.round(s.amount * rates[s.currency] * 100) / 100 } : s)) }));
  } finally { fixing = false; }
}
async function addSpend() {
  const t = trip(), val = (id) => document.getElementById(id)?.value || "";
  const amount = Number(val("kSpAmt"));
  if (!(amount > 0)) { document.getElementById("kSpAmt")?.focus(); return ctx.toast("Enter the amount first."); }
  const currency = val("kSpCur") || t.currency || "INR";
  const category = val("kSpCat") || "other";
  const label = val("kSpLabel").trim() || ctx.CATEGORIES[category]?.label || "Spend";
  const date = val("kSpDate") || ymd(new Date());
  const paidBy = val("kSpBy") || S.me.email;
  const rate = await rateFor(currency);
  const spend = { id: ctx.uid(), label, amount, currency, inTrip: rate ? Math.round(amount * rate * 100) / 100 : null, category, paidBy, date, by: S.me.email, at: Date.now() };
  lastCur = currency;
  clearDrafts("kSpAmt", "kSpLabel");
  await S.store.txTrip(S.tripId, (cur) => ({ spends: [...(cur.spends || []), spend], ...ctx.stampMe() }));
  ctx.log(`logged a spend: ${label}, ${ctx.money(amount, currency)}`);
  if (!rate) ctx.toast("Saved. The exchange rate will be added when you're back online.", 5000);
}
async function delSpend(btn, id) {
  const s = (trip().spends || []).find((x) => x.id === id);
  await S.store.txTrip(S.tripId, (cur) => ({ spends: (cur.spends || []).filter((x) => x.id !== id), ...ctx.stampMe() }));
  if (s) ctx.log(`removed the spend “${s.label}”`);
}
// Who pays whom so everyone has paid an equal share (greedy settle-up).
export function owes(spends, people) {
  const paid = {};
  people.forEach((p) => (paid[p] = 0));
  let total = 0;
  for (const s of spends) if (s.inTrip != null) { paid[s.paidBy] = (paid[s.paidBy] || 0) + s.inTrip; total += s.inTrip; }
  const names = Object.keys(paid), share = total / (names.length || 1);
  const debt = names.map((n) => ({ n, v: share - paid[n] })).filter((x) => x.v > 0.5).sort((a, b) => b.v - a.v);
  const cred = names.map((n) => ({ n, v: paid[n] - share })).filter((x) => x.v > 0.5).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].n, to: cred[j].n, amount: x });
    debt[i].v -= x; cred[j].v -= x;
    if (debt[i].v < 0.5) i++;
    if (cred[j].v < 0.5) j++;
  }
  return out;
}
function spendSection() {
  const t = trip(), E = ctx.esc, cur = t.currency || "INR", me = S.me.email;
  const spends = [...(t.spends || [])].sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.at - b.at);
  const spent = spends.reduce((s, x) => s + (x.inTrip || 0), 0);
  const pending = spends.filter((x) => x.inTrip == null).length;
  const planned = ctx.costs().total, budget = Number(t.budget) || 0;
  const dayOf = (d) => { const k = t.days.findIndex((_, i) => ctx.dayDate(i) && ymd(ctx.dayDate(i)) === d); return k >= 0 ? `Day ${k + 1} · ${ctx.fmtDay(ctx.dayDate(k))}` : d ? ctx.fmtDay(new Date(d + "T00:00:00")) : "No date"; };
  let last = null;
  const rows = spends.map((s) => {
    const head = s.date !== last ? `<div class="k-day-h">${E(dayOf(s.date))}</div>` : "";
    last = s.date;
    const ic = ctx.CATEGORIES[s.category]?.icon || "📌";
    return `${head}<div class="k-row"><span>${ic}</span><span class="k-t">${E(s.label)} <span class="muted small">· ${E(ctx.who(s.paidBy))} paid</span></span>
      <span class="k-amt">${ctx.money(s.amount, s.currency)}${s.currency !== cur ? `<div class="muted small">${s.inTrip == null ? "rate pending" : "≈ " + ctx.money(s.inTrip, cur)}</div>` : ""}</span>
      ${s.by === me ? `<button class="k-x" data-action="kSpendDel" data-id="${s.id}" title="Delete" aria-label="Delete ${E(s.label)}">✕</button>` : ""}</div>`;
  }).join("");
  const today = ctx.today(), defDate = ymd(today >= 0 ? ctx.dayDate(today) : new Date());
  const form = ui.spendForm || spends.length ? `<div class="k-spend-form">
      <input id="kSpAmt" data-kd="1" type="number" inputmode="decimal" min="0" step="any" placeholder="Amount">
      <select id="kSpCur" data-kd="1" aria-label="Currency">${[...new Set([lastCur || cur, cur, ...ctx.CURRENCIES])].map((c) => `<option ${c === (drafts.kSpCur || lastCur || cur) ? "selected" : ""}>${c}</option>`).join("")}</select>
      <input id="kSpLabel" data-kd="1" class="wide" placeholder="What was it? e.g. Dinner">
      <select id="kSpCat" data-kd="1" aria-label="Category">${Object.entries(ctx.CATEGORIES).map(([k, v]) => `<option value="${k}" ${k === (drafts.kSpCat || "food") ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}</select>
      <select id="kSpBy" data-kd="1" aria-label="Paid by">${members().map((m) => `<option value="${E(m)}" ${m === (drafts.kSpBy || me) ? "selected" : ""}>${E(ctx.who(m))} paid</option>`).join("")}</select>
      <input id="kSpDate" data-kd="1" class="wide" type="date" value="${E(drafts.kSpDate || defDate)}" aria-label="Date">
      <button class="primary wide" data-action="kSpendAdd">Add spend</button></div>` : "";
  const owe = t.prefs?.split ? owes(spends, members()) : null;
  return `<section class="d-sec k-sec" id="kit-spend">
    <div class="d-head"><h3>Spent so far</h3>${spends.length ? "" : `<button class="btn-s" data-action="kSpendForm">${ui.spendForm ? "Close" : "Add a spend"}</button>`}</div>
    ${spends.length ? `<div class="k-sum"><span><span class="muted small">Spent</span><br><b>${ctx.money(spent, cur)}</b></span><span><span class="muted small">Planned</span><br><b>${ctx.money(planned, cur)}</b></span>${budget ? `<span><span class="muted small">${spent > budget ? "Over budget by" : "Left of budget"}</span><br><b class="${spent > budget ? "bad" : "good"}">${ctx.money(Math.abs(budget - spent), cur)}</b></span>` : ""}</div>${pending ? `<p class="muted small">${pending} spend${pending > 1 ? "s" : ""} waiting for an exchange rate, not in the total yet.</p>` : ""}` : `<p class="empty small">Nothing logged yet. Add what you pay as you go, in any currency, and it's converted to ${E(cur)}.</p>`}
    ${form}${rows}
    <label class="row small" style="margin-top:10px"><input type="checkbox" data-action="kSplit" ${t.prefs?.split ? "checked" : ""}> Show who owes whom</label>
    ${owe ? `<p class="k-owes">${owe.length ? owe.map((o) => `<b>${E(ctx.who(o.from))}</b> ${o.from === me ? "owe" : "owes"} <b>${E(ctx.who(o.to))}</b> ${ctx.money(Math.round(o.amount), cur)}`).join("<br>") : "Everyone has paid an equal share."}</p>` : ""}
  </section>`;
}

/* ----------------------------------------------------------------- Exports */
function exportButtons() {
  return `<button data-action="kIcs">📅 Add to calendar</button><button data-action="kKml">🗺️ Google My Maps file</button>
    <span class="muted small k-how">Calendar: open the .ics file to add every stop and booking. My Maps: create a new map at mymaps.google.com, choose Import and pick the .kml file.</span>`;
}
const pad = (n) => String(n).padStart(2, "0");
// "YYYYMMDDTHHMMSS" for a day offset plus minutes (works past midnight, no time zone maths).
function stamp(dateStr, minutes) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}00`;
}
const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  const enc = new TextEncoder();
  let out = "", cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out ? 74 : 75)) { out += (out ? "\r\n " : "") + cur; cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  return out ? out + "\r\n " + cur : cur;
}
export function buildIcs() {
  const t = trip();
  if (!t.startDate) { ctx.toast("Set a start date for the trip first (Edit trip)."); return null; }
  const tz = t.weather?.tz || "";
  const dt = (key, s) => (tz ? `${key};TZID=${tz}:${s}` : `${key}:${s}`);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trip planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(t.name || "Trip")}`];
  const dest = (t.destination || "").split(",")[0].toLowerCase();
  t.days.forEach((d, i) => {
    const date = ymd(ctx.dayDate(i));
    for (const s of ctx.schedule(d.id)) {
      const it = s.it, loc = it.location ? (dest && !it.location.toLowerCase().includes(dest) ? `${it.location}, ${t.destination}` : it.location) : "";
      const desc = [`Day ${i + 1}`, it.notes, ctx.safeUrl(it.url)].filter(Boolean).join("\n");
      L.push("BEGIN:VEVENT", `UID:${it.id}@trip-planner`, `DTSTAMP:${now}`, dt("DTSTART", stamp(date, s.start)), dt("DTEND", stamp(date, s.end)), `SUMMARY:${icsText(it.title)}`);
      if (loc) L.push(`LOCATION:${icsText(loc)}`);
      L.push(`DESCRIPTION:${icsText(desc)}`, "END:VEVENT");
    }
  });
  for (const b of t.bookings || []) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(b.start || "")) continue;
    const loc = b.address || b.to || b.from || "";
    const desc = [b.ref && `Booking ref: ${b.ref}`, b.from && b.to && `${b.from} to ${b.to}`, b.notes].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", `UID:${b.id}@trip-planner`, `DTSTAMP:${now}`);
    if (b.start.length >= 16) {
      const sm = ctx.toMin(b.start.slice(11, 16)), em = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b.end || "") ? b.end : "";
      const ed = em ? em.slice(0, 10) : b.start.slice(0, 10);
      L.push(dt("DTSTART", stamp(b.start.slice(0, 10), sm)), dt("DTEND", em ? stamp(ed, ctx.toMin(em.slice(11, 16))) : stamp(b.start.slice(0, 10), sm + 60)));
    } else {
      const next = stamp(b.start.slice(0, 10), 1440).slice(0, 8);
      L.push(`DTSTART;VALUE=DATE:${b.start.slice(0, 10).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next}`);
    }
    L.push(`SUMMARY:${icsText(b.title || b.kind || "Booking")}`);
    if (loc) L.push(`LOCATION:${icsText(loc)}`);
    if (desc) L.push(`DESCRIPTION:${icsText(desc)}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
const xml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
export function buildKml() {
  const t = trip();
  let missing = 0;
  const has = (it) => Number.isFinite(it.lat) && Number.isFinite(it.lng);
  const mark = (it, name, extra = "") => {
    if (!has(it)) { missing++; return ""; }
    const desc = [ctx.CATEGORIES[it.category]?.label, extra, it.location, it.notes, ctx.safeUrl(it.url)].filter(Boolean).join("\n");
    return `<Placemark><name>${xml(name)}</name><description>${xml(desc)}</description><Point><coordinates>${it.lng},${it.lat},0</coordinates></Point></Placemark>`;
  };
  const folders = t.days.map((d, i) => {
    const sch = ctx.schedule(d.id);
    const date = ctx.dayDate(i);
    const pts = sch.map((s, k) => mark(s.it, `${k + 1}. ${s.it.title}`, `Day ${i + 1}, ${ctx.fromMin(s.start)}`)).join("");
    const co = sch.filter((s) => has(s.it)).map((s) => `${s.it.lng},${s.it.lat},0`);
    const line = co.length > 1 ? `<Placemark><name>${xml(`Day ${i + 1} route`)}</name><LineString><tessellate>1</tessellate><coordinates>${co.join(" ")}</coordinates></LineString></Placemark>` : "";
    return `<Folder><name>${xml(`Day ${i + 1}${date ? " · " + ctx.fmtDay(date) : ""}${d.title ? " · " + d.title : ""}`)}</name>${pts}${line}</Folder>`;
  });
  const idea = ctx.ideas().map((it) => mark(it, it.title)).join("");
  if (idea) folders.push(`<Folder><name>Ideas</name>${idea}</Folder>`);
  if (missing) ctx.toast(`${missing} place${missing > 1 ? "s" : ""} without a location ${missing > 1 ? "were" : "was"} left out of the map file.`, 5000);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(t.name || "Trip")}</name>${folders.join("")}</Document></kml>\n`;
}
