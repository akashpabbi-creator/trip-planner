// bookings: Kit tab sections "Bookings" (flights, hotels, tickets; from pasted emails) and "Check prices"
// (flight and hotel search links, no API). Also a strip on each Plan day, costs in Budget and a "Prices" link on stays.
import { call, parseJson, QuotaError, geminiWait } from "./ai.js";

export const KINDS = {
  flight: { icon: "✈️", label: "Flight" }, hotel: { icon: "🏨", label: "Hotel" }, train: { icon: "🚆", label: "Train" },
  bus: { icon: "🚌", label: "Bus" }, ferry: { icon: "⛴️", label: "Ferry" }, car: { icon: "🚗", label: "Car" },
  tickets: { icon: "🎟️", label: "Tickets" }, other: { icon: "📌", label: "Other" },
};
const CUR_SYM = { "₹": "INR", "rs": "INR", "inr": "INR", "$": "USD", "usd": "USD", "€": "EUR", "eur": "EUR", "£": "GBP", "gbp": "GBP", "aed": "AED", "sgd": "SGD", "thb": "THB", "jpy": "JPY", "¥": "JPY" };

/* ------------------------------------------------------------ Gemini reader */
// Reads one pasted confirmation email. No search needed: everything is in the text.
export async function readBooking(key, text, trip) {
  const prompt = `Read this booking confirmation email (flight, hotel, train, bus, ferry, car or tickets) for a trip to ${trip.destination || "a destination"}${trip.startDate ? ` starting ${trip.startDate}` : ""}. Trip currency: ${trip.currency || "INR"}.
Return ONLY a JSON object in a \`\`\`json block: {"bookings": [{"kind": "flight"|"hotel"|"train"|"bus"|"ferry"|"car"|"tickets"|"other", "title": "short, e.g. 'IndiGo 6E 2145 DEL to BOM' or the hotel name", "ref": "booking reference / PNR / confirmation number or ''", "start": "YYYY-MM-DDTHH:MM" (departure, check-in or entry; use T00:00 when no time is given), "end": "YYYY-MM-DDTHH:MM" (arrival or check-out) or "", "from": "origin or ''", "to": "destination or ''", "address": "street address (hotels, tickets) or ''", "cost": total amount paid as a number or 0, "currency": "3-letter code", "notes": "one short line, e.g. room type, seat, terminal"}]}
One entry per flight leg or hotel stay (a return trip is two entries). Never invent values that are not in the email.
Email:
"""
${String(text).slice(0, 7000)}
"""`;
  const { text: out } = await call(key, prompt, { json: true });
  const j = parseJson(out);
  const list = Array.isArray(j) ? j : Array.isArray(j.bookings) ? j.bookings : j && j.title ? [j] : [];
  return list.filter((b) => b && (b.title || b.ref)).slice(0, 6).map((b) => cleanBooking(b, trip));
}

function cleanBooking(b, trip) {
  const dt = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v || "") ? v.slice(0, 16) : /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v + "T00:00" : "");
  return {
    kind: KINDS[b.kind] ? b.kind : "other", title: String(b.title || "").slice(0, 120), ref: String(b.ref || "").slice(0, 40),
    start: dt(b.start), end: dt(b.end), from: String(b.from || "").slice(0, 80), to: String(b.to || "").slice(0, 80),
    address: String(b.address || "").slice(0, 160), cost: Number(b.cost) || 0, currency: String(b.currency || trip.currency || "INR").toUpperCase().slice(0, 3),
    notes: String(b.notes || "").slice(0, 200),
  };
}

/* ------------------------------------------------------------ regex fallback */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONRE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
const p2 = (n) => String(n).padStart(2, "0");

// Finds every date in the text, in order, as { at, ymd }. A missing year comes from the trip.
export function datesIn(text, trip = {}) {
  const found = [];
  const base = trip.startDate ? new Date(trip.startDate + "T00:00:00") : new Date();
  const fix = (d, m, y) => {
    d = Number(d); m = Number(m);
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
    if (y) y = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    else {
      y = base.getFullYear();
      if (new Date(y, m - 1, d) < new Date(base.getTime() - 120 * 86400000)) y++;
    }
    return `${y}-${p2(m)}-${p2(d)}`;
  };
  const add = (re, fn) => { for (const m of text.matchAll(re)) { const ymd = fn(m); if (ymd) found.push({ at: m.index, ymd }); } };
  add(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (m) => fix(m[3], m[2], m[1]));
  add(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-,/]+${MONRE}(?:[\\s\\-,.]+(\\d{4})(?!\\d)|-(\\d{2})(?![\\d:]))?`, "gi"), (m) => fix(m[1], MON[m[2].toLowerCase()], m[3] || m[4]));
  add(new RegExp(`\\b${MONRE}\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4})(?!\\d))?`, "gi"), (m) => fix(m[2], MON[m[1].toLowerCase()], m[3]));
  add(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g, (m) => fix(m[1], m[2], m[3]));
  return found.sort((a, b) => a.at - b.at).filter((x, i, a) => !i || x.at - a[i - 1].at > 3);
}
// Finds every clock time as { at, hm }: "06:40", "6:40 PM", "6 pm", "0640 hrs".
export function timesIn(text) {
  const found = [];
  const to24 = (h, mi, ap) => {
    h = Number(h);
    if (ap) { ap = ap.toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
    return h < 24 && Number(mi) < 60 ? `${p2(h)}:${p2(mi)}` : null;
  };
  const add = (re, fn) => { for (const m of text.matchAll(re)) { const hm = fn(m); if (hm) found.push({ at: m.index, hm }); } };
  add(/(?<![\d:.])(\d{1,2}):([0-5]\d)(?::\d\d)?\s*(am|pm)?(?![\d])/gi, (m) => to24(m[1], m[2], m[3]));
  add(/(?<![\d:.])([01]\d|2[0-3])([0-5]\d)\s*(?:hrs?|h)\b/gi, (m) => to24(m[1], m[2]));
  add(/(?<![\d:.])(\d{1,2})\s*(am|pm)\b/gi, (m) => to24(m[1], "00", m[2]));
  return found.sort((a, b) => a.at - b.at).filter((x, i, a) => !i || x.at - a[i - 1].at > 2);
}
const firstDateTime = (seg, trip) => ({ date: datesIn(seg, trip)[0]?.ymd || "", time: timesIn(seg)[0]?.hm || "" });
const plusDay = (ymd) => { const d = new Date(ymd + "T00:00:00"); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

const REF_LABEL = /(?:PNR(?:\s*(?:no\.?|number))?|booking\s*(?:ref(?:erence)?|id|no\.?|number|code)|confirmation\s*(?:no\.?|number|code|#|id)?|reservation\s*(?:no\.?|number|code|id)?|record\s*locator|itinerary\s*(?:no\.?|number)|ticket\s*(?:no\.?|number)|reference\s*(?:no\.?|number)?)/i;
function findRef(text) {
  const re = new RegExp(REF_LABEL.source + "(?:\\s*\\([^)]{1,14}\\))?\\s*(?:is|:|#|-|–)?\\s*:?\\s*([A-Za-z0-9]{5,14})\\b", "gi");
  for (const m of text.matchAll(re)) {
    const c = m[1];
    if (/^(number|details|confirmed|reference|booking|reservation|status)$/i.test(c)) continue;
    if (/\d/.test(c) || c === c.toUpperCase()) return c.toUpperCase();
  }
  return "";
}
function findCost(text, fallbackCur) {
  const cur = (s) => CUR_SYM[(s || "").toLowerCase().replace(/[.\s]/g, "")] || "";
  const money = "(₹|rs\\.?|inr|usd|eur|gbp|aed|sgd|thb|jpy|\\$|€|£|¥)?\\s*([\\d][\\d,]*(?:\\.\\d{1,2})?)\\s*(inr|usd|eur|gbp|aed|sgd|thb|jpy)?";
  for (const label of ["grand total", "total(?:\\s+(?:amount|fare|price|paid|payable|cost))?", "amount (?:paid|payable|charged)", "net (?:amount|fare)", "(?:base )?fare", "price"]) {
    const re = new RegExp(`\\b${label}\\b[^\\d₹$€£¥\\n]{0,24}?${money}`, "i");
    const m = text.match(re);
    if (m) {
      const amount = Number(m[2].replace(/,/g, ""));
      if (amount > 0) return { cost: amount, currency: cur(m[1]) || cur(m[3]) || fallbackCur };
    }
  }
  return { cost: 0, currency: fallbackCur };
}
const AIRLINES = "6E|AI|UK|SG|IX|QP|I5|G8|9W|S5|2T|AK|EK|QR|EY|SQ|BA|LH|AF|KL|TG|TK|UL|WY|GF|FZ|G9|MH|VN|CX|NH|JL|QF|VS|LX|OS|AY|SK|EI|IB|TP|AZ|LO|OD|FD|SV|KU|J9|W6|FR|U2|DL|UA|AA|AC|AM|JQ|NZ|PR|CI|BR|KE|OZ|MU|CA|CZ|HU|SC|BI|VJ|JT|ID|QZ";
function findFlightNo(text) {
  let m = text.match(/\bflight\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9]{2})[\s-]?(\d{2,4})\b/);
  if (!m || !/[A-Z]/.test(m[1])) m = text.match(new RegExp(`\\b(${AIRLINES})[\\s-]?(\\d{2,4})\\b`));
  return m ? `${m[1]} ${m[2]}` : "";
}
const WORD = "[A-Z][A-Za-z.']+(?: [A-Z][A-Za-z.']+)*";
function placeOf(seg) {
  const m = seg.match(new RegExp(`(${WORD})\\s*\\(([A-Z]{3,5})\\)`));
  return m ? { name: m[1], code: m[2], text: `${m[1]} (${m[2]})` } : null;
}

// Fills a booking from the text of a confirmation email: PNR/confirmation code, flight number, dates, times,
// check-in/out, amount. Always returns something; `got` says how many facts were found.
export function parseBookingText(text, trip = {}) {
  text = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const cur0 = trip.currency || "INR";
  const b = { kind: "other", title: "", ref: findRef(text), start: "", end: "", from: "", to: "", address: "", cost: 0, currency: cur0, notes: "" };
  Object.assign(b, findCost(text, cur0));
  const flightNo = findFlightNo(text);
  const addr = text.match(/\baddress\s*[:\-]\s*(.+)/i);
  if (addr) b.address = addr[1].trim().slice(0, 160);

  if (flightNo || /\b(boarding pass|airline|e-?ticket)\b/i.test(text)) {
    b.kind = "flight";
    const dep = text.search(/\bdepart/i), arr = text.search(/\barriv/i);
    const depSeg = dep >= 0 ? text.slice(dep, arr > dep ? arr : dep + 220) : text;
    const arrSeg = arr >= 0 ? text.slice(arr, arr + 220) : "";
    const d = firstDateTime(depSeg, trip), a = firstDateTime(arrSeg, trip);
    if (!d.date) d.date = datesIn(text, trip)[0]?.ymd || "";
    if (!d.time) d.time = timesIn(text)[0]?.hm || "";
    if (!a.time) a.time = timesIn(text)[1]?.hm || "";
    const from = placeOf(depSeg), to = placeOf(arrSeg);
    const pair = text.match(/\b([A-Z]{3})\s*(?:→|->|–|—|-|to)\s*([A-Z]{3})\b/);
    b.from = from?.text || pair?.[1] || "";
    b.to = to?.text || pair?.[2] || "";
    if (d.date) b.start = `${d.date}T${d.time || "00:00"}`;
    const adate = a.date || d.date;
    if (adate && a.time) b.end = `${adate === d.date && a.time < d.time ? plusDay(adate) : adate}T${a.time}`;
    const codes = [from?.code || pair?.[1], to?.code || pair?.[2]].filter(Boolean);
    b.title = [flightNo, codes.length === 2 ? `${codes[0]} → ${codes[1]}` : ""].filter(Boolean).join(" · ") || "Flight";
  } else if (/check[\s-]?in|check[\s-]?out|\bhotel\b|\bresort\b|\bnights?\b/i.test(text) && !/\b(train|irctc)\b/i.test(text)) {
    b.kind = "hotel";
    const ci = text.search(/check[\s-]?in/i), co = text.search(/check[\s-]?out/i);
    const ciSeg = ci >= 0 ? text.slice(ci, co > ci ? co : ci + 120) : "";
    const coSeg = co >= 0 ? text.slice(co, co > ci ? co + 120 : co + 120) : "";
    const i = firstDateTime(ciSeg, trip), o = firstDateTime(coSeg, trip);
    if (!i.date) i.date = datesIn(text, trip)[0]?.ymd || "";
    if (i.date) b.start = `${i.date}T${i.time || "14:00"}`;
    const nights = Number((text.match(/(\d+)\s*nights?/i) || [])[1]) || 0;
    let outDate = o.date;
    if (!outDate && i.date && nights) { let x = i.date; for (let n = 0; n < nights; n++) x = plusDay(x); outDate = x; }
    if (outDate) b.end = `${outDate}T${o.time || "11:00"}`;
    const name =
      (text.match(/\b(?:hotel|property|resort)\s*(?:name)?\s*[:\-]\s*(.+)/i) || [])[1] ||
      (text.match(/\b(?:your (?:stay|booking|reservation) (?:at|with)|booking at|reservation at|welcome to)\s+([^\n.!,]{3,70})/i) || [])[1] ||
      (text.split("\n").find((l) => /\b(hotel|resort|inn|suites?|villa|lodge|homestay|hostel|residency|palace)\b/i.test(l) && l.length < 80) || "");
    b.title = name.replace(/^[\s:–-]+|\s+(?:is|has been) confirmed.*$/i, "").trim().slice(0, 80) || "Hotel stay";
    if (!b.address) b.address = "";
    b.notes = [nights && `${nights} night${nights > 1 ? "s" : ""}`, (text.match(/\b(?:room type|room)\s*[:\-]\s*([^\n]{3,50})/i) || [])[1]].filter(Boolean).join(" · ");
  } else {
    const kind = /\b(train|irctc|railway)\b/i.test(text) ? "train" : /\b(bus|redbus|volvo)\b/i.test(text) ? "bus" : /\bferry\b/i.test(text) ? "ferry" : /\b(car rental|rental car|self[- ]drive|pick-?up)\b/i.test(text) ? "car" : /\b(ticket|admission|entry|museum|tour)\b/i.test(text) ? "tickets" : "other";
    b.kind = kind;
    const d = datesIn(text, trip)[0];
    const t = timesIn(text);
    if (d) b.start = `${d.ymd}T${t[0]?.hm || "00:00"}`;
    if (d && t[1]) b.end = `${t[1].hm < t[0].hm ? plusDay(d.ymd) : d.ymd}T${t[1].hm}`;
    const no = (text.match(/\btrain\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{4,5})\b/i) || [])[1];
    const from = placeOf(text.slice(text.search(/\b(from|board|depart)/i) >= 0 ? text.search(/\b(from|board|depart)/i) : 0));
    const to = placeOf(text.slice(text.search(/\b(to|arriv|destination)\b/i) >= 0 ? text.search(/\b(to|arriv|destination)\b/i) : 0));
    b.from = from?.text || ""; b.to = to && to.text !== b.from ? to.text : "";
    b.title = [KINDS[kind].label, no].filter(Boolean).join(" ") + (b.from && b.to ? ` · ${b.from} → ${b.to}` : "");
  }
  b.got = ["ref", "start", "end", "cost"].filter((k) => b[k]).length + (b.title && !/^(Flight|Hotel stay|Other)$/.test(b.title) ? 1 : 0);
  return b;
}

/* ------------------------------------------------------------ price links */
const ymdOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const gFlights = (home, dest, from, to) => `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${home} to ${dest}${from ? ` on ${from}` : ""}${to ? ` through ${to}` : ""}`)}`;
const gHotels = (place, cin, cout) => `https://www.google.com/travel/search?q=${encodeURIComponent(`hotels in ${place}${cin ? ` ${cin} to ${cout}` : ""}`)}`;
const bookingCom = (place, cin, cout) => `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(place)}${cin ? `&checkin=${cin}&checkout=${cout}` : ""}&group_adults=2`;
export const priceLinks = { gFlights, gHotels, bookingCom };

const CSS = `
.bk-date { font-size: 13px; color: var(--muted); margin: 14px 0 6px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.bk-card { background: var(--panel); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 30px 1fr auto; gap: 4px 10px; align-items: start; }
.bk-ic { font-size: 22px; grid-row: span 2; }
.bk-title { font-weight: 600; overflow-wrap: anywhere; }
.bk-meta { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 13px; color: var(--muted); align-items: center; }
.bk-meta a { color: var(--accent); }
.bk-ref { border: 1px dashed var(--line); background: var(--panel-2); border-radius: 8px; padding: 1px 8px; font-family: ui-monospace, monospace; font-size: 13px; color: var(--ink); }
.bk-acts { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.bk-empty { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bk-pill { display: inline-block; max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; font-size: 12px; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.bk-prices { font-size: 13px; margin-top: 4px; }
.bk-prices a { color: var(--accent); }
.bk-warn { font-size: 12px; color: var(--warn); }
details.bk-chk > summary { cursor: pointer; list-style: none; }
details.bk-chk > summary::-webkit-details-marker { display: none; }
details.bk-chk > summary h3 { display: inline; }
.bk-chk-body { margin-top: 10px; display: grid; gap: 8px; }
.bk-chk-body label { font-size: 13px; color: var(--muted); display: grid; gap: 4px; }
.bk-links { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.bk-links a { text-decoration: none; }
.bk-form .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
`;

export function init(ctx) {
  const { S, esc, toast, uid } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-bookings", textContent: CSS }));
  let chkOpen = false;
  let queue = [];

  const list = () => [...(S.trip?.bookings || [])].sort((a, b) => (a.start || "9").localeCompare(b.start || "9"));
  const dateOf = (b) => (b.start || "").slice(0, 10);
  const timeOf = (s) => (s && s.slice(11, 16) !== "00:00" ? s.slice(11, 16) : "");
  const cur = () => S.trip?.currency || "INR";
  const mapLink = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const dayStr = (i) => (ctx.dayDate(i) ? ymdOf(ctx.dayDate(i)) : "");
  const niceDate = (ymd) => ymd ? new Date(ymd + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "No date";

  // The cost of a booking in the trip's currency, or null when we can't convert it.
  function inTrip(b) {
    const amount = Number(b.cost) || 0;
    if (!amount) return 0;
    const c = (b.currency || cur()).toUpperCase();
    if (c === cur().toUpperCase()) return amount;
    const r = S.trip.rates;
    if (r && String(r.base).toUpperCase() === cur().toUpperCase() && Number(r.map?.[c]) > 0) return amount / Number(r.map[c]);
    return null;
  }

  /* ---- stays: nights, bases, price link */
  function nightsOf(b) {
    const s = dateOf(b), e = (b.end || "").slice(0, 10);
    if (!s || !e || e <= s) return [];
    const out = [];
    for (let i = 0; i < S.trip.days.length; i++) { const d = dayStr(i); if (d && d >= s && d < e) out.push(i); }
    return out;
  }
  // Runs of consecutive days sharing one "staying in" town, with check-in / check-out dates.
  function stayRuns() {
    const days = S.trip.days, runs = [];
    days.forEach((d, i) => {
      const base = (d.base || "").trim() || S.trip.destination || "";
      const last = runs[runs.length - 1];
      if (last && last.base.toLowerCase() === base.toLowerCase() && last.to === i - 1) last.to = i;
      else runs.push({ base, from: i, to: i });
    });
    return runs.map((r) => {
      const a = ctx.dayDate(r.from), z = ctx.dayDate(r.to);
      const out = z && new Date(z.getTime()); out && out.setDate(out.getDate() + 1);
      return { base: r.base, cin: a ? ymdOf(a) : "", cout: out ? ymdOf(out) : "", from: r.from, to: r.to };
    });
  }
  function stayDatesFor(it) {
    const where = `${it.location || ""} ${it.title || ""}`.toLowerCase();
    const run = stayRuns().find((r) => r.base && where.includes(r.base.split(",")[0].trim().toLowerCase()));
    if (run) return run;
    const all = stayRuns();
    return { base: S.trip.destination, cin: all[0]?.cin || "", cout: all[all.length - 1]?.cout || "" };
  }

  /* ---- Kit sections */
  function bookingCard(b) {
    const k = KINDS[b.kind] || KINDS.other;
    const t1 = timeOf(b.start), t2 = timeOf(b.end);
    const sameDay = (b.end || "").slice(0, 10) === dateOf(b);
    const when = [t1 && (t2 && sameDay ? `${t1} → ${t2}` : t1), !sameDay && b.end ? `until ${niceDate(b.end.slice(0, 10))}${t2 ? " " + t2 : ""}` : ""].filter(Boolean).join(" ");
    const route = b.from || b.to ? [b.from, b.to].filter(Boolean).join(" → ") : "";
    const conv = inTrip(b);
    const stayOffer = b.kind === "hotel" && nightsOf(b).length && nightsOf(b).some((i) => !S.trip.days[i].base);
    return `<article class="bk-card" data-id="${esc(b.id)}">
      <div class="bk-ic">${k.icon}</div>
      <div class="bk-title">${esc(b.title || k.label)}</div>
      <button class="btn-s" data-action="bkEdit" data-id="${esc(b.id)}" aria-label="Edit booking">⋯</button>
      <div class="bk-meta">
        ${when ? `<span>${esc(when)}</span>` : ""}${route ? `<span>${esc(route)}</span>` : ""}
        ${b.ref ? `<button class="bk-ref" data-action="bkCopy" data-id="${esc(b.id)}" title="Tap to copy">${esc(b.ref)}</button>` : ""}
        ${b.address ? `<a href="${esc(mapLink(b.address))}" target="_blank" rel="noopener">📍 ${esc(b.address)}</a>` : ""}
        ${Number(b.cost) ? `<span>${esc(b.currency || cur())} ${Number(b.cost).toLocaleString()}</span>` : ""}
        ${conv === null ? `<span class="bk-warn">Not in the budget (different currency)</span>` : ""}
        ${b.notes ? `<span>${esc(b.notes)}</span>` : ""}
      </div>
      ${stayOffer ? `<div class="bk-acts"><button class="btn-s" data-action="bkStay" data-id="${esc(b.id)}">Set “staying in” for these nights</button></div>` : ""}
    </article>`;
  }
  function bookingsSection() {
    const bs = list();
    const groups = {};
    bs.forEach((b) => (groups[dateOf(b)] ||= []).push(b));
    return `<section class="d-sec" id="bk-sec">
      <div class="d-head"><h3>🎫 Bookings</h3>
        <span class="bk-links"><button class="btn-s" data-action="bkEmail">Add from an email</button><button class="btn-s" data-action="bkNew">Add booking</button></span></div>
      ${bs.length
        ? Object.keys(groups).sort().map((d) => `<div class="bk-date">${esc(niceDate(d))}</div>${groups[d].map(bookingCard).join("")}`).join("")
        : `<p class="empty">Flights, hotels and tickets in one place. Paste a confirmation email and the details fill in for you.</p>`}
    </section>`;
  }
  function pricesSection() {
    const t = S.trip;
    const home = ctx.profileOf(t).home || "";
    const runs = stayRuns();
    const first = runs[0], last = runs[runs.length - 1];
    const dest = t.destination || "";
    const rows = runs.filter((r) => r.base);
    return `<details class="d-sec bk-chk" id="chk-sec" ${chkOpen ? "open" : ""}>
      <summary class="d-head"><h3>🔎 Check prices</h3><span class="muted small">${chkOpen ? "" : "flight and hotel searches"}</span></summary>
      <div class="bk-chk-body">
        <label>Flying from
          <input id="homeCity" value="${esc(home)}" placeholder="e.g. Mumbai" autocomplete="off"></label>
        <div class="bk-links">
          ${home && dest
            ? `<a class="btn-s" href="${esc(gFlights(home, dest, first?.cin, last?.cout ? ymdOf(new Date(new Date(last.cout + "T00:00:00").getTime() - 86400000)) : ""))}" target="_blank" rel="noopener">✈️ Flights to ${esc(dest)}</a>`
            : `<span class="muted small">Add your home city and a destination to search flights.</span>`}
        </div>
        ${(rows.length ? rows : [{ base: dest, cin: first?.cin, cout: last?.cout }]).filter((r) => r.base).map((r) => `<div class="bk-links">
          <span class="small">🏨 ${esc(r.base)}${r.cin ? ` <span class="muted">${esc(niceDate(r.cin))} to ${esc(niceDate(r.cout))}</span>` : ""}</span>
          <a class="btn-s" href="${esc(gHotels(r.base, r.cin, r.cout))}" target="_blank" rel="noopener">Google Hotels</a>
          <a class="btn-s" href="${esc(bookingCom(r.base, r.cin, r.cout))}" target="_blank" rel="noopener">Booking.com</a></div>`).join("")}
        <p class="muted small">These open a search in a new tab. Nothing is booked or sent from here.</p>
      </div>
    </details>`;
  }
  ctx.slot("kit", bookingsSection);
  ctx.slot("kit", pricesSection);
  document.addEventListener("toggle", (e) => { if (e.target?.id === "chk-sec") chkOpen = e.target.open; }, true);
  document.addEventListener("change", async (e) => {
    if (e.target.id !== "homeCity" || !S.tripId) return;
    const home = e.target.value.trim();
    // After the blur that fired this event: a render during it would remove the focused field mid-blur.
    setTimeout(() => S.store.txTrip(S.tripId, (c) => ({ profile: { ...(c.profile || {}), home }, ...ctx.stampMe() })).catch((err) => toast("Couldn't save: " + err.message)), 0);
  });

  /* ---- Plan strip, stay "Prices" link, budget */
  ctx.slot("dayHead", (day, i) => {
    const d = dayStr(i);
    if (!d || !S.trip.bookings?.length) return "";
    const pills = list().flatMap((b) => {
      const k = KINDS[b.kind] || KINDS.other;
      if (dateOf(b) === d) return [{ b, text: `${k.icon} ${timeOf(b.start) || b.title}` }];
      if (b.kind === "hotel" && (b.end || "").slice(0, 10) === d) return [{ b, text: `${k.icon} check-out${timeOf(b.end) ? " " + timeOf(b.end) : ""}` }];
      return [];
    });
    if (!pills.length) return "";
    const shown = pills.slice(0, 2).map((p) => `<span class="bk-pill" title="${esc(p.b.title + (p.b.ref ? " · " + p.b.ref : ""))}">${esc(p.text)}</span>`).join(" ");
    return `<span class="bk-strip">${shown}${pills.length > 2 ? ` <span class="bk-pill">+${pills.length - 2}</span>` : ""}</span>`;
  });
  ctx.slot("card", (it) => {
    if (it.category !== "stay" || !S.trip) return "";
    const r = stayDatesFor(it);
    const place = [it.title, r.base].filter(Boolean).join(" ");
    return `<div class="bk-prices"><a href="${esc(gHotels(place, r.cin, r.cout))}" target="_blank" rel="noopener">Prices</a></div>`;
  });
  ctx.costs(() => list().map((b) => ({ label: `${(KINDS[b.kind] || KINDS.other).icon} ${b.title || KINDS[b.kind]?.label || "Booking"}`, amount: inTrip(b) || 0 })).filter((r) => r.amount));

  /* ---- modal helper (works for the first and every later step) */
  let submitting = false;
  function modal(html, onSubmit, okLabel = "Save") {
    document.activeElement?.blur?.();
    ctx.$form.innerHTML = html + `<div class="m-actions"><button type="button" value="cancel" data-close>Cancel</button><button class="primary" value="ok">${esc(okLabel)}</button></div>`;
    ctx.$form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => ctx.$modal.close()));
    ctx.$form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(ctx.$form).entries());
      if (submitting) return;
      submitting = true;
      try {
        if ((await onSubmit(fd)) !== false) ctx.$modal.close();
      } catch (err) {
        console.error(err);
        toast("Couldn't save: " + err.message);
      } finally { submitting = false; }
    };
    if (!ctx.$modal.open) ctx.$modal.showModal();
    ctx.$form.querySelector("input,select,textarea")?.focus();
  }

  /* ---- booking form */
  function formHtml(b, note = "") {
    const k = (n) => esc(b[n] ?? "");
    return `<div class="bk-form"><h3>${b.id ? "Edit booking" : "Booking"}</h3>
      ${note ? `<p class="muted small">${note}</p>` : ""}
      <label>Type<select name="kind">${Object.entries(KINDS).map(([v, o]) => `<option value="${v}" ${b.kind === v ? "selected" : ""}>${o.icon} ${o.label}</option>`).join("")}</select></label>
      <label>Title<input name="title" required value="${k("title")}" placeholder="e.g. IndiGo 6E 2145, or the hotel name"></label>
      <label>Booking reference<input name="ref" value="${k("ref")}" placeholder="PNR or confirmation number" autocapitalize="characters"></label>
      <div class="grid2"><label>Starts<input name="start" type="datetime-local" value="${k("start")}"></label><label>Ends<input name="end" type="datetime-local" value="${k("end")}"></label></div>
      <div class="grid2"><label>From<input name="from" value="${k("from")}"></label><label>To<input name="to" value="${k("to")}"></label></div>
      <label>Address<input name="address" value="${k("address")}" placeholder="Hotels and tickets"></label>
      <div class="grid2"><label>Cost<input name="cost" type="number" min="0" step="any" value="${b.cost || ""}"></label>
        <label>Currency<select name="currency">${[...new Set([b.currency || cur(), ...ctx.CURRENCIES])].map((c) => `<option ${c === (b.currency || cur()) ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
      <label>Notes<input name="notes" value="${k("notes")}"></label>
      ${b.id ? `<button type="button" class="btn-s" data-action="bkDelete" data-id="${esc(b.id)}">Delete this booking</button>` : ""}
    </div>`;
  }
  async function saveBooking(f, id) {
    const clean = cleanBooking({ ...f, cost: f.cost }, S.trip);
    clean.title = (f.title || "").trim().slice(0, 120) || KINDS[clean.kind].label;
    let saved;
    await S.store.txTrip(S.tripId, (cur_) => {
      const all = cur_.bookings || [];
      if (id) return { bookings: all.map((x) => (x.id === id ? (saved = { ...x, ...clean }) : x)), ...ctx.stampMe() };
      saved = { id: uid(), ...clean, by: S.me.email, at: Date.now() };
      return { bookings: [...all, saved], ...ctx.stampMe() };
    });
    await ctx.log(`${id ? "updated" : "added"} the booking “${clean.title}”`);
    return saved;
  }
  // Shows each prefilled booking in turn so the couple can check it before it is saved.
  function nextFromQueue(total) {
    const b = queue.shift();
    if (!b) return;
    const n = total - queue.length;
    modal(formHtml(b, `${total > 1 ? `Booking ${n} of ${total}. ` : ""}${b.got === 0 ? "I couldn't find much in that email, so please fill in the rest." : "Check the details, then save."}`), async (f) => {
      const saved = await saveBooking(f);
      toast("Booking saved.");
      if (saved.kind === "hotel") setTimeout(() => offerStay(saved, queue.length ? () => nextFromQueue(total) : null), 80);
      else if (queue.length) setTimeout(() => nextFromQueue(total), 80);
    });
  }
  function offerStay(b, then) {
    const idx = nightsOf(b);
    if (!idx.length || idx.every((i) => (S.trip.days[i].base || "").trim().toLowerCase() === townOf(b).toLowerCase())) return then?.();
    const first = idx[0] + 1, last = idx[idx.length - 1] + 1;
    modal(`<h3>🏨 Set “staying in”?</h3>
      <p>Mark ${esc(b.title)} on ${first === last ? `Day ${first}` : `Days ${first} to ${last}`} (${idx.length} night${idx.length > 1 ? "s" : ""}) so new places land on the right days.</p>
      <label>Staying in<input name="base" required value="${esc(townOf(b))}" placeholder="Town or area"></label>`,
      async (f) => {
        const base = f.base.trim();
        await S.store.txTrip(S.tripId, (c) => ({ days: c.days.map((d, i) => (idx.includes(i) ? { ...d, base } : d)), ...ctx.stampMe() }));
        await ctx.log(`set “staying in ${base}” for ${idx.length} night${idx.length > 1 ? "s" : ""} from the booking “${b.title}”`);
        toast(`Set “staying in ${base}”.`);
        if (then) setTimeout(then, 80);
      }, "Set it");
    if (then) ctx.$form.querySelector("[data-close]").addEventListener("click", () => setTimeout(then, 80));
  }
  // A town for "staying in": the booking's city field, else the last words of the address that aren't a number or code, else the destination.
  function townOf(b) {
    if (b.to && b.kind === "hotel") return b.to.trim();
    const parts = String(b.address || "").split(",").map((s) => s.trim()).filter((s) => s && !/\d/.test(s));
    return parts.length ? parts[parts.length - 1] : S.trip.destination || "";
  }

  /* ---- actions */
  ctx.action("bkNew", () => { queue = []; modal(formHtml({ kind: "flight", currency: cur() }), async (f) => { const s = await saveBooking(f); if (s.kind === "hotel") setTimeout(() => offerStay(s), 80); }); });
  ctx.action("bkEdit", (btn, id) => {
    const b = (S.trip.bookings || []).find((x) => x.id === id);
    if (b) modal(formHtml(b), (f) => saveBooking(f, id));
  });
  ctx.action("bkDelete", async (btn, id) => {
    const b = (S.trip.bookings || []).find((x) => x.id === id);
    if (!b || !confirm(`Delete “${b.title}”?`)) return;
    await S.store.txTrip(S.tripId, (c) => ({ bookings: (c.bookings || []).filter((x) => x.id !== id), ...ctx.stampMe() }));
    await ctx.log(`deleted the booking “${b.title}”`);
    ctx.$modal.close();
  });
  ctx.action("bkCopy", async (btn, id) => {
    const b = (S.trip.bookings || []).find((x) => x.id === id);
    try { await navigator.clipboard.writeText(b.ref); toast(`Copied ${b.ref}`); } catch { toast(b.ref); }
  });
  ctx.action("bkStay", (btn, id) => { const b = (S.trip.bookings || []).find((x) => x.id === id); if (b) offerStay(b); });
  ctx.action("bkEmail", () => {
    const gem = !!S.trip.ai?.key && !geminiWait();
    modal(`<h3>🎫 Add from an email</h3>
      <p class="muted small">Paste the confirmation email (flight, hotel, train, tickets). ${gem ? "Gemini reads it" : "I read it myself"}, then you check the details before anything is saved.</p>
      <textarea name="text" rows="9" required placeholder="Paste the email text here"></textarea>`,
      async (f) => {
        const text = f.text.trim();
        if (text.length < 20) { toast("Paste the whole email first."); return false; }
        let found = [], via = "";
        if (gem) {
          try { found = await readBooking(S.trip.ai.key, text, S.trip); via = "Gemini"; } catch (e) { console.warn("gemini booking", e); if (e instanceof QuotaError) toast(e.message, 5000); }
        }
        if (!found.length) { found = [parseBookingText(text, S.trip)]; via = "rules"; }
        found.forEach((b) => (b.got ??= ["ref", "start", "end", "cost"].filter((k) => b[k]).length + (b.title ? 1 : 0)));
        queue = found;
        setTimeout(() => nextFromQueue(found.length), 0);
        return false;
      }, gem ? "Read with Gemini" : "Read email");
  });
}
