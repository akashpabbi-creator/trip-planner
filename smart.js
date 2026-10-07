// The "Smart plan" engine. Runs in the browser, free, no AI key needed.
// It looks at where each stop is (via free OpenStreetMap geocoding), how long things take and what
// you both asked for, and returns suggestions. Each suggestion carries a list of changes that the app
// applies when you tap "Apply".

/* ------------------------------------------------------------- geography */
const R = 6371;
export function km(a, b) {
  if (!has(a) || !has(b)) return null;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3; // ×1.3: roads are never straight
}
const rad = (d) => (d * Math.PI) / 180;
export const has = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

// Free geocoder (OpenStreetMap Nominatim). Its usage policy asks for at most 1 request per second.
const geoCache = new Map();
let geoGate = Promise.resolve(), geoLast = 0;
const geoSlot = () => { const w = geoGate.then(async () => { const wait = geoLast + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); geoLast = Date.now(); }); geoGate = w.catch(() => {}); return w; };
export async function geocode(query) {
  if (geoCache.has(query)) return geoCache.get(query);
  await geoSlot();
  if (geoCache.has(query)) return geoCache.get(query);
  const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(query), {
    headers: { "Accept-Language": navigator.language || "en" },
  });
  if (!r.ok) throw new Error("geocode " + r.status);
  const j = await r.json();
  const out = j[0] ? { lat: +j[0].lat, lng: +j[0].lon } : null;
  geoCache.set(query, out);
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Finds coordinates for stops that don't have them yet. Returns [itemId, {lat,lng}] pairs.
export async function locateAll(items, destination, onProgress) {
  const todo = items.filter((i) => !has(i) && (i.location || i.title) && !i.geoFailed).slice(0, 30);
  const out = [];
  for (let k = 0; k < todo.length; k++) {
    const it = todo[k];
    onProgress?.(k + 1, todo.length, it.title);
    const q = it.location || it.title;
    let p = null;
    try {
      p = await geocode(destination && !q.toLowerCase().includes(destination.toLowerCase()) ? `${q}, ${destination}` : q);
      if (!p && destination) p = await geocode(q);
    } catch (e) {
      console.warn(e);
    }
    out.push([it.id, p ? { lat: p.lat, lng: p.lng } : { geoFailed: true }]);
    if (k < todo.length - 1) await sleep(1100);
  }
  return out;
}

/* ------------------------------------------------------- transport model */
// Rough door-to-door estimates. Good enough to compare options; check exact times with Directions.
const MODEL = {
  walk: (d) => (d / 4.5) * 60,
  transit: (d) => 12 + (d / 20) * 60,
  taxi: (d) => 6 + (d / (d > 20 ? 55 : 25)) * 60,
  rental: (d) => 3 + (d / (d > 20 ? 65 : 28)) * 60,
  car: (d) => 3 + (d / (d > 20 ? 65 : 28)) * 60,
  train: (d) => 35 + (d / 80) * 60,
  flight: (d) => 180 + (d / 700) * 60,
};
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

export function recommendMode(d, prefs = {}, dayHasCar = false) {
  const style = prefs.travel || "mixed"; // transit | car | mixed
  const ownCar = style === "car" || dayHasCar;
  const carMode = dayHasCar ? "rental" : style === "car" ? "car" : "taxi";
  let mode, why;
  if (d <= 1.5) [mode, why] = ["walk", "it's a short walk"];
  else if (d <= 3 && prefs.pace !== "packed" && !ownCar) [mode, why] = ["walk", "under half an hour on foot"];
  else if (d <= 25) {
    if (ownCar) [mode, why] = [carMode, "you'll have the car"];
    else {
      const t = MODEL.transit(d), c = MODEL.taxi(d);
      if (style === "transit" || t - c < 20) [mode, why] = ["transit", t - c < 20 ? "about as quick as a taxi and much cheaper" : "you prefer public transport"];
      else [mode, why] = ["taxi", `saves about ${round5(t - c)} min over public transport`];
    }
  } else if (d <= 400) {
    if (ownCar) [mode, why] = [carMode, "you'll have the car"];
    else if (d >= 60 && style !== "car") [mode, why] = ["train", "long distance, a train is relaxed and usually cheaper (check a bus if there's no line)"];
    else [mode, why] = ["rental", "out of town, a car gives you flexibility"];
  } else [mode, why] = d > 700 ? ["flight", "too far to drive comfortably"] : ["train", "a long way; train or flight beats driving"];
  return { mode, minutes: round5(MODEL[mode === "car" ? "car" : mode](d)), why, km: d };
}

/* --------------------------------------------------------------- helpers */
const PACE_HOURS = { relaxed: 7, balanced: 9, packed: 11 };
const toMin = (t) => (/^\d{1,2}:\d{2}$/.test(t || "") ? +t.split(":")[0] * 60 + +t.split(":")[1] : null);
const hm = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const dist = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`);
const kmTxt = (d) => (d < 10 ? d.toFixed(1) : Math.round(d)) + " km";
function centroid(list) {
  const p = list.filter(has);
  if (!p.length) return null;
  return { lat: p.reduce((s, x) => s + x.lat, 0) / p.length, lng: p.reduce((s, x) => s + x.lng, 0) / p.length };
}
function routeLen(list) {
  let s = 0;
  for (let i = 1; i < list.length; i++) s += km(list[i - 1], list[i]) ?? 0;
  return s;
}
// Shortest visiting order, keeping the first stop (often the hotel or a fixed start) in place.
function bestOrder(list) {
  if (list.length < 3) return list;
  const [start, ...rest] = list;
  const route = [start];
  const left = [...rest];
  while (left.length) {
    const last = route[route.length - 1];
    left.sort((a, b) => km(last, a) - km(last, b));
    route.push(left.shift());
  }
  // 2-opt clean-up
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1; i++)
      for (let k = i + 1; k < route.length; k++) {
        const cand = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (routeLen(cand) + 0.01 < routeLen(route)) {
          route.splice(0, route.length, ...cand);
          improved = true;
        }
      }
  }
  return route;
}

/* ---------------------------------------------------------------- engine */
// ctx: { trip, items, dayItems(dayId), ideas(), who(email), money(n) }
// Returns suggestions: { id, kind, level: 'fix'|'tip'|'info', title, detail, changes: [...] }
// change: { type: 'item', id, patch } | { type: 'order', dayId, ids: [...] }
const isRest = (it) => it.rest || /\b(rest|break|free time|buffer|siesta|nap|downtime|recharge)\b/i.test(it.title || "");

export function analyse(ctx) {
  const { trip, dayItems, ideas, who, money } = ctx;
  const prefs = trip.prefs || {};
  const maxMin = (PACE_HOURS[prefs.pace || "balanced"] || 9) * 60;
  const dayEnd = toMin(prefs.dayEnd) ?? 22 * 60;
  const out = [];
  const days = trip.days.map((d, i) => ({ d, i, items: dayItems(d.id) }));
  const loadOf = (items, d) => {
    let t = 0;
    items.forEach((it, k) => (t += (isRest(it) ? 0 : Number(it.durationMin) || 60) + (k ? Number(it.travel?.minutes) || 0 : 0)));
    const start = toMin(d.startTime) ?? toMin(prefs.dayStart) ?? 9 * 60;
    return { busy: t, end: start + t };
  };

  // 0. Missing locations: nothing else works well without them.
  const unlocated = ctx.items.filter((i) => !has(i));
  if (unlocated.length)
    out.push({
      id: "locate", kind: "locate", level: "info",
      title: `${unlocated.length} place${unlocated.length > 1 ? "s" : ""} not on the map yet`,
      detail: (unlocated.some((i) => !i.geoFailed) ? "Tap “Analyse plan” to look them up. " : "") + "If a place can't be found, add a fuller address to: " + unlocated.slice(0, 5).map((i) => i.title).join(", ") + (unlocated.length > 5 ? "…" : ""),
      changes: [],
    });

  for (const { d, i, items } of days) {
    const label = `Day ${i + 1}`;
    const located = items.filter(has);

    // 1. Shorter route for the day.
    const free = items.every((it) => !toMin(it.time));
    if (free && located.length === items.length && items.length >= 3) {
      const best = bestOrder(items);
      const now = routeLen(items), then = routeLen(best);
      if (now - then > 1.5 && then < now * 0.85)
        out.push({
          id: `route-${d.id}`, kind: "route", level: "fix",
          title: `${label}: reorder stops to save ~${kmTxt(now - then)} of travel`,
          detail: "New order: " + best.map((x) => x.title).join(" → "),
          changes: [{ type: "order", dayId: d.id, ids: best.map((x) => x.id) }],
        });
    }

    // 2. Car for the day? Lots of medium/long hops are cheaper and easier with one hired car.
    let longKm = 0, longLegs = 0;
    for (let k = 1; k < items.length; k++) {
      const dd = km(items[k - 1], items[k]);
      if (dd != null && dd > 8) (longKm += dd), longLegs++;
    }
    const dayHasCar = items.some((it) => ["rental", "car"].includes(it.travel?.mode));
    if (!dayHasCar && prefs.travel !== "transit" && (longLegs >= 3 || longKm > 70))
      out.push({
        id: `car-${d.id}`, kind: "car", level: "tip",
        title: `${label}: hire a car for the day`,
        detail: `${longLegs} longer hops (~${kmTxt(longKm)} in total). One car is usually cheaper and less tiring than ${longLegs} taxis.`,
        changes: items.slice(1).map((it, k) => {
          const dd = km(items[k], it);
          return dd == null || dd <= 1.5 ? null : { type: "item", id: it.id, patch: { travel: { ...(it.travel || {}), mode: "rental", minutes: round5(MODEL.rental(dd)), auto: true } } };
        }).filter(Boolean),
      });

    // 3. Transport for each leg.
    const legChanges = [];
    const legNotes = [];
    for (let k = 1; k < items.length; k++) {
      const a = items[k - 1], b = items[k];
      const dd = km(a, b);
      if (dd == null) continue;
      const rec = recommendMode(dd, prefs, dayHasCar);
      const cur = b.travel || {};
      const mismatch = cur.mode && !cur.auto && cur.mode !== rec.mode;
      if (!cur.mode || (cur.auto && (cur.mode !== rec.mode || Math.abs((cur.minutes || 0) - rec.minutes) > 5))) {
        legChanges.push({ type: "item", id: b.id, patch: { travel: { ...cur, mode: rec.mode, minutes: rec.minutes, auto: true } } });
        legNotes.push(`${a.title} → ${b.title}: ${rec.mode === "transit" ? "public transport" : rec.mode} ~${dist(rec.minutes)} (${kmTxt(dd)})`);
      } else if (mismatch && cur.mode === "walk" && dd > 3)
        out.push({ id: `walk-${b.id}`, kind: "leg", level: "tip", title: `${label}: walking to “${b.title}” is ${kmTxt(dd)}`, detail: `That's about ${dist(round5(MODEL.walk(dd)))} on foot. ${rec.mode} would take ~${dist(rec.minutes)}: ${rec.why}.`, changes: [{ type: "item", id: b.id, patch: { travel: { ...cur, mode: rec.mode, minutes: rec.minutes } } }] });
      else if (cur.mode && !cur.minutes)
        legChanges.push({ type: "item", id: b.id, patch: { travel: { ...cur, minutes: round5(MODEL[cur.mode === "bus" || cur.mode === "ferry" ? "transit" : cur.mode === "bike" ? "taxi" : cur.mode]?.(dd) || 0) } } });
    }
    if (legChanges.length)
      out.push({
        id: `legs-${d.id}`, kind: "legs", level: "fix",
        title: `${label}: fill in how to get between ${legChanges.length} stop${legChanges.length > 1 ? "s" : ""}`,
        detail: legNotes.join("\n") || "Adds estimated travel times.",
        changes: legChanges,
      });

    // 4. Too much in one day.
    const load = loadOf(items, d);
    if (items.length && (load.busy > maxMin || load.end > dayEnd)) {
      const movable = items.filter((it) => !it.mustDo && !toMin(it.time) && it.category !== "stay");
      const victim = movable.sort((a, b) => (Number(b.durationMin) || 60) - (Number(a.durationMin) || 60))[0];
      const target = victim && bestDayFor(victim, days.filter((x) => x.d.id !== d.id), loadOf, maxMin);
      out.push({
        id: `load-${d.id}`, kind: "load", level: "fix",
        title: `${label} is overloaded (${dist(load.busy)} of activities and travel, ends ~${hm(load.end)})`,
        detail: victim && target
          ? `Move “${victim.title}” to Day ${target.i + 1}, which has more room${target.near ? " and is nearby" : ""}.`
          : `Your pace is set to “${prefs.pace || "balanced"}” (${maxMin / 60} h a day). Consider dropping something or adding a day.`,
        changes: victim && target ? [{ type: "item", id: victim.id, patch: { dayId: target.d.id, order: 1e6 } }] : [],
      });
    }

    // 5. A day that zig-zags across a big area.
    if (located.length >= 2) {
      let far = 0, pair = null;
      for (const a of located) for (const b of located) { const dd = km(a, b); if (dd > far) (far = dd), (pair = [a, b]); }
      if (far > 45 && !out.some((s) => s.id === `car-${d.id}`))
        out.push({ id: `spread-${d.id}`, kind: "spread", level: "tip", title: `${label} covers a wide area`, detail: `“${pair[0].title}” and “${pair[1].title}” are ~${kmTxt(far)} apart. Grouping nearby places on the same day saves travel.`, changes: [] });
    }

    // 6. Moving between towns from one day to the next.
    const next = days[i + 1];
    if (next && items.length && next.items.length) {
      const a = items[items.length - 1], b = next.items[0];
      const dd = km(a, b);
      if (dd > 60 && !b.travel?.fromPrevDay) {
        const rec = recommendMode(dd, prefs, false);
        out.push({ id: `hop-${d.id}`, kind: "hop", level: "info", title: `Day ${i + 1} → ${i + 2}: ${kmTxt(dd)} to cover`, detail: `From “${a.title}” to “${b.title}”. Suggested: ${rec.mode}, ~${dist(rec.minutes)} (${rec.why}). Add it as the first leg of Day ${i + 2}.`, changes: b.travel?.fromPrevDay ? [] : [{ type: "item", id: b.id, patch: { travel: { mode: rec.mode, minutes: rec.minutes, auto: true, fromPrevDay: true } } }] });
      }
    }
  }

  // 6b. Our rule: every day gets a rest or buffer block.
  if (ctx.profile?.rest !== false)
    for (const { d, i, items } of days) {
      if (items.length < 3 || items.some(isRest)) continue;
      out.push({
        id: `rest-${d.id}`, kind: "rest", level: "fix",
        title: `Day ${i + 1} has no rest block`,
        detail: "Your rule is a break every day. This adds a 90-minute rest in the late afternoon; move it if another time suits the day better.",
        changes: [{ type: "add", item: { title: "Rest & recharge", category: "other", dayId: d.id, time: "15:30", durationMin: 90, cost: 0, rest: true, mustDo: false, notes: "Rest and recharge at the hotel or a cafe.", location: "", description: "", image: "", url: "", siteName: "" } }],
      });
    }

  // 7. Must-dos that aren't on a day.
  for (const it of ideas().filter((x) => x.mustDo)) {
    const target = bestDayFor(it, days, loadOf, maxMin);
    out.push({
      id: `must-${it.id}`, kind: "must", level: "fix",
      title: `Schedule ${who(it.addedBy) === "You" ? "your" : who(it.addedBy) + "'s"} must-do “${it.title}”`,
      detail: target ? `Day ${target.i + 1} has room${target.near ? " and it's close to what's already planned there" : ""}.` : "Every day is full. Add a day or move something.",
      changes: target ? [{ type: "item", id: it.id, patch: { dayId: target.d.id, order: 1e6 } }] : [],
    });
  }

  // 8. Empty days while ideas are waiting: fill with a nearby cluster.
  const waiting = ideas().filter((x) => !x.mustDo);
  for (const { d, i, items } of days) {
    if (items.length || !waiting.length) continue;
    const seed = waiting.find(has) || waiting[0];
    const cluster = [seed, ...waiting.filter((x) => x !== seed && (km(seed, x) ?? 999) < 15)].slice(0, 4);
    out.push({
      id: `fill-${d.id}`, kind: "fill", level: "tip",
      title: `Day ${i + 1} is empty`,
      detail: `Fill it with ${cluster.map((x) => "“" + x.title + "”").join(", ")}${cluster.length > 1 && has(seed) ? " (close to each other)" : ""}.`,
      changes: cluster.map((x, k) => ({ type: "item", id: x.id, patch: { dayId: d.id, order: k + 1 } })),
    });
    waiting.splice(0, waiting.length, ...waiting.filter((x) => !cluster.includes(x)));
  }

  // 9. Fair share: make sure both people's picks make it in.
  const members = trip.members || [];
  if (members.length > 1) {
    const share = members.map((m) => {
      const all = ctx.items.filter((x) => x.addedBy === m && !x.suggestedBy);
      const on = all.filter((x) => trip.days.some((dd) => dd.id === x.dayId));
      return { m, all: all.length, on: on.length };
    });
    const low = share.filter((s) => s.all >= 3 && s.on / s.all < 0.34);
    for (const s of low)
      out.push({ id: `fair-${s.m}`, kind: "fair", level: "info", title: `Only ${s.on} of ${who(s.m) === "You" ? "your" : who(s.m) + "'s"} ${s.all} ideas are in the plan`, detail: "Check Ideas to make sure the trip has a bit of what you both wanted.", changes: [] });
  }

  // 10. Budget.
  const budget = Number(trip.budget) || 0;
  if (budget && ctx.total > budget) {
    const big = ctx.items.filter((x) => trip.days.some((dd) => dd.id === x.dayId) && !x.mustDo && Number(x.cost)).sort((a, b) => b.cost - a.cost).slice(0, 3);
    out.push({ id: "budget", kind: "budget", level: "fix", title: `Over budget by ${money(ctx.total - budget)}`, detail: big.length ? "Biggest optional costs: " + big.map((x) => `${x.title} (${money(x.cost)})`).join(", ") + "." : "Look at stays and transport, which are usually the biggest costs.", changes: [] });
  }

  // 11. Our rule: one splurge each in food, stay and experience.
  if (ctx.profile?.splurges && ctx.items.length >= 5) {
    const tagged = (re) => ctx.items.some((x) => re.test(`${x.notes || ""} ${x.title}`) && /splurge/i.test(x.notes || ""));
    const missing = [["food", /food/i], ["stay", /stay/i], ["experience", /experience/i]].filter(([, re]) => !tagged(re)).map(([k]) => k);
    if (missing.length)
      out.push({ id: "splurge", kind: "splurge", level: "info", title: `No ${missing.join(", ")} splurge picked yet`, detail: "You like one deliberate splurge each in food, stay and experience. To mark one, open a stop and write “Food splurge” (or “Stay splurge”, “Experience splurge”) in its notes.", changes: [] });
  }

  // 12. Restaurants on the plan with few vegetarian options: swap for one that has them.
  const vegIdeas = ideas().filter((x) => x.category === "food" && x.veg === "yes");
  for (const { d, i, items } of days)
    for (const it of items.filter((x) => x.category === "food" && x.veg === "no")) {
      const alt = vegIdeas.length ? [...vegIdeas].sort((a, b) => (km(a, it) ?? 99) - (km(b, it) ?? 99))[0] : null;
      if (alt) vegIdeas.splice(vegIdeas.indexOf(alt), 1);
      out.push({
        id: `veg-${it.id}`, kind: "veg", level: "fix",
        title: `Day ${i + 1}: “${it.title}” has few vegetarian options`,
        detail: (it.vegNote ? it.vegNote + ". " : "") + (alt ? `Swap it for “${alt.title}”, which has vegetarian dishes${km(alt, it) != null && km(alt, it) < 3 ? " and is close by" : ""}.` : "Move it to Ideas and pick a place with vegetarian dishes."),
        changes: [{ type: "item", id: it.id, patch: { dayId: null, order: 0, time: "" } }, ...(alt ? [{ type: "item", id: alt.id, patch: { dayId: d.id, order: it.order, time: it.time || "" } }] : [])],
      });
    }

  const order = { fix: 0, tip: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// Day with the most spare time, preferring one whose stops are near the item.
function bestDayFor(item, days, loadOf, maxMin) {
  const need = (Number(item.durationMin) || 60) + 30;
  const scored = days
    .map((x) => {
      const spare = maxMin - loadOf(x.items, x.d).busy;
      const c = centroid(x.items);
      const near = has(item) && c ? km(item, c) : null;
      return { ...x, spare, near: near != null && near < 10, score: spare - (near ?? 20) * 6 };
    })
    .filter((x) => x.spare >= need);
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}
