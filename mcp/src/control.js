// Job 3: full control of a trip. Every tool applies directly, writes one activity entry named after the client
// (Claude / Gemini) with an undo recipe (see undo.js), and answers with `warnings` for the days it touched so the
// assistant can tell the user about vegetarian, rest and pace problems instead of hiding them.
import { matchTrip, dayDate, onDay, stop, memberNameOf } from "./view.js";
import { newId, record, stamp } from "./undo.js";
import { TRIP, writes, CATEGORIES, IDEA_PROPS, ideaDoc, str, num, sameTitle } from "./tools.js";

const DAY = { type: ["integer", "string"], description: "Day number from 1, or 0 / \"ideas\" for the Ideas list." };
const ITEM = { type: "string", description: "The place: its id (from get_day / search_items) or its exact or distinctive title." };
const nrm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const hhmm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v).padStart(5, "0") : "");
const SIGHTY = new Set(["sight", "nature", "activity"]);
const MAX_STOPS = 12;

/* ---------------------------------------------------------------- lookups */
function dayIndex(trip, v, allowIdeas = false) {
  if (v === 0 || v === "0" || String(v).toLowerCase() === "ideas") {
    if (allowIdeas) return -1;
    throw new Error("Pick a day of the trip (1 to " + trip.days.length + ").");
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > trip.days.length) throw new Error(`Day must be 1 to ${trip.days.length}${allowIdeas ? ", or \"ideas\"" : ""}.`);
  return n - 1;
}
function findItem(items, ref, trip) {
  const q = nrm(ref);
  if (!q) throw new Error("Which place? Pass its id or title.");
  const byId = items.find((i) => i.id === String(ref));
  if (byId) return byId;
  const exact = items.filter((i) => nrm(i.title) === q);
  if (exact.length === 1) return exact[0];
  const hits = exact.length ? exact : items.filter((i) => nrm(i.title).includes(q));
  if (hits.length === 1) return hits[0];
  const where = (i) => { const d = onDay(trip, i); return d >= 0 ? `day ${d + 1}` : "ideas"; };
  if (!hits.length) throw new Error(`No place matches "${ref}". Use search_items to find it.`);
  throw new Error(`"${ref}" matches several places, use an id: ` + hits.slice(0, 8).map((i) => `${i.title} (${where(i)}, id ${i.id})`).join("; "));
}
const dayItemsOf = (items, dayId) => items.filter((i) => i.dayId === dayId).sort((a, b) => (a.order || 0) - (b.order || 0));

/* ---------------------------------------------------------------- warnings */
// The couple's rules, checked on the server so the assistant can't miss them: vegetarian options, a rest block, pace.
export function dayWarnings(trip, items, i) {
  const day = trip.days[i];
  const list = dayItemsOf(items, day.id);
  const out = [];
  if (!list.length) return out;
  const label = `Day ${i + 1}`;
  for (const it of list) {
    if (it.category !== "food" || it.rest) continue;
    if (it.veg === "no") out.push(`${label}: “${it.title}” has no vegetarian, vegan or egg options. Tell Akash and offer a swap.`);
    else if (!it.veg || it.veg === "unknown") out.push(`${label}: “${it.title}” isn't checked for vegetarian, vegan or egg options yet. Check it, or flag it to Akash.`);
  }
  if (list.length >= 3 && !list.some((it) => it.rest)) out.push(`${label}: no rest block. They want one every day (about 14:00 on hot days, before dinner when sunset is early, otherwise mid-afternoon).`);
  const sights = list.filter((it) => !it.rest && SIGHTY.has(it.category)).length;
  if (sights > 4) out.push(`${label}: ${sights} sights is too many. They keep to 3, or 4 on cool days.`);
  return out;
}
export function tripWarnings(trip, items) {
  const out = trip.days.flatMap((_, i) => dayWarnings(trip, items, i));
  if (trip.days.length >= 3 && items.some((it) => onDay(trip, it) >= 0) && !items.some((it) => onDay(trip, it) >= 0 && /\b(market|bazaar|souk)\b/i.test(`${it.title} ${it.description || ""}`))) {
    out.push("No market visit on any day yet. They like one per trip.");
  }
  return out;
}
const warnFor = (trip, items, idxs) => [...new Set(idxs)].filter((i) => i >= 0).flatMap((i) => dayWarnings(trip, items, i));

/* ---------------------------------------------------------------- write helpers */
// Puts `ids` on a day (dayId null = Ideas) in that order, patching only what changed. Keeps `items` current.
function setOrder(b, c, trip, items, dayId, ids, ops) {
  ids.forEach((id, k) => {
    const it = items.find((x) => x.id === id);
    const order = dayId ? k : 0;
    if ((it.dayId || null) === dayId && (it.order || 0) === order) return;
    const before = { dayId: it.dayId || null, order: it.order || 0 };
    const after = { dayId, order };
    b.patch(`trips/${trip.id}/items/${id}`, { ...after, ...stamp(c) });
    ops.push({ op: "patchItem", id, before, after });
    Object.assign(it, after);
  });
}
function patchItem(b, c, trip, it, changes, ops) {
  const before = {}, after = {};
  for (const [k, v] of Object.entries(changes)) {
    if (JSON.stringify(it[k] ?? null) === JSON.stringify(v ?? null)) continue;
    before[k] = it[k] ?? null; after[k] = v ?? null;
  }
  if (!Object.keys(after).length) return false;
  b.patch(`trips/${trip.id}/items/${it.id}`, { ...after, ...stamp(c) });
  ops.push({ op: "patchItem", id: it.id, before, after });
  Object.assign(it, after);
  return true;
}
async function finish(b, c, trip, text, ops, extra = {}) {
  await b.commit();
  const entry = await record(c, trip.id, text, ops);
  await c.fs.patch(`trips/${trip.id}`, stamp(c));
  return { trip: trip.name, ...extra, undoWith: { tool: "undo_change", entry } };
}
const load = async (a, c) => {
  const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
  return { trip, items: await c.fs.items(trip.id) };
};
const dayTag = (trip, i) => (i < 0 ? "Ideas" : `day ${i + 1}${trip.days[i].title ? ` (${trip.days[i].title})` : ""}`);
const withWarn = (r, w) => (w.length ? { ...r, warnings: w } : r);

// Trip-level list helper (bookings, extras, checklist, tripNotes): fn mutates a copy and returns what to log and undo.
async function editList(c, trip, field, fn) {
  let res;
  await c.fs.txTrip(trip.id, (cur) => {
    const list = Array.isArray(cur[field]) ? JSON.parse(JSON.stringify(cur[field])) : [];
    res = fn(list);
    return res ? { [field]: list, ...stamp(c) } : null;
  });
  return res;
}
async function editFields(c, trip, patchFn) {
  let res;
  await c.fs.txTrip(trip.id, (cur) => {
    res = patchFn(cur);
    return res ? res.patch : null;
  });
  return res;
}

/* ---------------------------------------------------------------- bookings */
const BOOKING_KINDS = ["flight", "hotel", "train", "bus", "ferry", "car", "tickets", "other"];
const dt = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v || "") ? v.slice(0, 16) : /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v + "T00:00" : "");
const BOOKING_PROPS = {
  kind: { type: "string", enum: BOOKING_KINDS },
  title: { type: "string", description: "Short, e.g. \"IndiGo 6E 2145 DEL to BOM\" or the hotel name." },
  ref: { type: "string", description: "Booking reference, PNR or confirmation number." },
  start: { type: "string", description: "Departure, check-in or entry: YYYY-MM-DDTHH:MM (or YYYY-MM-DD)." },
  end: { type: "string", description: "Arrival or check-out, same format." },
  from: { type: "string" }, to: { type: "string" }, address: { type: "string" },
  cost: { type: "number" }, currency: { type: "string", description: "3-letter code; defaults to the trip's." }, notes: { type: "string" },
};
function cleanBooking(b, trip, base = {}) {
  const has = (k) => b[k] !== undefined;
  const out = { ...base };
  if (has("kind")) out.kind = BOOKING_KINDS.includes(b.kind) ? b.kind : "other";
  if (has("title")) out.title = str(b.title, 120);
  if (has("ref")) out.ref = str(b.ref, 40);
  if (has("start")) out.start = dt(b.start);
  if (has("end")) out.end = dt(b.end);
  for (const k of ["from", "to"]) if (has(k)) out[k] = str(b[k], 80);
  if (has("address")) out.address = str(b.address, 160);
  if (has("cost")) out.cost = num(b.cost);
  if (has("currency")) out.currency = str(b.currency, 3).toUpperCase() || trip.currency || "INR";
  if (has("notes")) out.notes = str(b.notes, 200);
  return out;
}

/* ---------------------------------------------------------------- tools */
const STOP_PROPS = {
  item: { type: "string", description: "A place already in the trip (Ideas or another day): its id or exact title. It is moved here. Leave out to create a new place." },
  ...IDEA_PROPS,
  time: { type: "string", description: "Fixed start time HH:MM. Leave out to let it follow the previous stop." },
  position: { type: "integer", description: "1-based place in the day. Default: after the existing stops." },
  rest: { type: "boolean", description: "True for a rest or buffer block (title defaults to \"Rest & recharge\")." },
};

export const CONTROL = [
  {
    name: "plan_day",
    description: "Put stops on a day. Each stop is either a place already saved (Ideas or another day; it is moved) or a new place (created). Use it to fill a day, add one stop, or rebuild a day with replace true (the old stops go back to Ideas, nothing is deleted). It applies at once and is logged with Undo. Follow the rules: every restaurant needs vegetarian, vegan or egg options (set veg yes/some/no, or unknown if unchecked), 3 sights a day (4 on cool days), one rest block (rest true) at 14:00 on hot days, before dinner when sunset is early, else mid-afternoon. The answer lists `warnings` for the day; tell the user about every one. Only fill days the user asked you to fill.",
    inputSchema: { type: "object", properties: { trip: TRIP, day: { type: ["integer", "string"], description: "Day number from 1." }, replace: { type: "boolean" },
      stops: { type: "array", minItems: 1, maxItems: MAX_STOPS, items: { type: "object", properties: STOP_PROPS } } }, required: ["day", "stops"] },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const di = dayIndex(trip, a.day);
      const day = trip.days[di];
      const stops = (Array.isArray(a.stops) ? a.stops : []).slice(0, MAX_STOPS);
      if (!stops.length) throw new Error("Pass at least one stop.");
      const b = c.fs.batch(), ops = [], notes = [], touched = [di];
      let list = dayItemsOf(items, day.id).map((i) => i.id);
      if (a.replace) {
        setOrder(b, c, trip, items, null, list, ops);
        list = [];
      }
      const names = [];
      for (const s of stops) {
        let it;
        const ref = s.item || (s.rest ? "" : s.title);
        const pool = items.filter((x) => !ref ? false : x.id === String(ref) || sameTitle(x.title, ref));
        if (s.item && !pool.length) throw new Error(`No place matches "${s.item}" to move. Use search_items, or leave item out to create it.`);
        if (pool.length) {
          it = pool[0];
          const from = onDay(trip, it);
          if (list.includes(it.id)) notes.push(`“${it.title}” was already on this day.`);
          else if (from >= 0 && from !== di) { touched.push(from); notes.push(`moved “${it.title}” from day ${from + 1}.`); }
          list = list.filter((x) => x !== it.id);
        } else {
          const p = s.rest ? { title: "Rest & recharge", category: "other", durationMin: 90, ...s } : s;
          const d = ideaDoc(p, c);
          d.data.dayId = day.id; d.data.order = list.length;
          if (s.rest) d.data.rest = true;
          if (hhmm(s.time)) d.data.time = hhmm(s.time);
          const id = newId();
          b.create(`trips/${trip.id}/items/${id}`, d.data);
          ops.push({ op: "deleteItem", id, force: true });
          it = { id, ...d.data };
          items.push(it);
        }
        const pos = Number.isInteger(s.position) ? Math.min(Math.max(1, s.position), list.length + 1) - 1 : list.length;
        list.splice(pos, 0, it.id);
        if (it.time !== undefined || hhmm(s.time)) {
          if (hhmm(s.time) && it.time !== hhmm(s.time)) patchItem(b, c, trip, it, { time: hhmm(s.time) }, ops);
        }
        names.push(it.title);
      }
      setOrder(b, c, trip, items, day.id, list, ops);
      if (a.replace) { /* earlier stops already sent to Ideas above */ }
      const text = `${a.replace ? "rebuilt" : "planned"} ${dayTag(trip, di)}: ${names.slice(0, 4).map((n) => "“" + n + "”").join(", ")}${names.length > 4 ? ", …" : ""}`;
      const r = await finish(b, c, trip, text, ops, { day: di + 1, onDay: names, ...(notes.length ? { notes } : {}) });
      return withWarn(r, warnFor(trip, items, touched));
    },
  },
  {
    name: "move_item",
    description: "Move a saved place to another day, back to Ideas (day \"ideas\"), or to a different spot in its day. Applies at once with Undo. The answer lists warnings for the days involved.",
    inputSchema: { type: "object", properties: { trip: TRIP, item: ITEM, day: DAY, position: { type: "integer", description: "1-based place in the day. Default: the end." }, time: { type: "string", description: "Fixed start time HH:MM; \"\" clears it." } }, required: ["item", "day"] },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const it = findItem(items, a.item, trip);
      const from = onDay(trip, it), to = dayIndex(trip, a.day, true);
      const b = c.fs.batch(), ops = [];
      const dayId = to >= 0 ? trip.days[to].id : null;
      let list = dayId ? dayItemsOf(items, dayId).map((i) => i.id).filter((x) => x !== it.id) : [];
      const pos = Number.isInteger(a.position) ? Math.min(Math.max(1, a.position), list.length + 1) - 1 : list.length;
      list.splice(pos, 0, it.id);
      if (!dayId) list = [it.id];
      if (a.time !== undefined) patchItem(b, c, trip, it, { time: a.time === "" ? "" : hhmm(a.time) }, ops);
      setOrder(b, c, trip, items, dayId, list, ops);
      if (from >= 0 && from !== to) { // close the gap it leaves
        setOrder(b, c, trip, items, trip.days[from].id, dayItemsOf(items, trip.days[from].id).map((i) => i.id), ops);
      }
      if (!ops.length) return { trip: trip.name, moved: false, why: "It is already there." };
      const r = await finish(b, c, trip, `moved “${it.title}” to ${dayTag(trip, to)}`, ops, { moved: it.title, to: dayTag(trip, to) });
      return withWarn(r, warnFor(trip, items, [from, to]));
    },
  },
  {
    name: "update_item",
    description: "Edit a saved place or stop: title, location, notes, description, start time, duration, cost, category, must-do, vegetarian info, link or pin. Only the fields you pass change. Applies at once with Undo. For food, set veg when you have checked the menu.",
    inputSchema: { type: "object", properties: { trip: TRIP, item: ITEM, changes: { type: "object", properties: {
      title: { type: "string" }, location: { type: "string" }, description: { type: "string" }, notes: { type: "string" }, url: { type: "string" },
      category: { type: "string", enum: CATEGORIES }, time: { type: "string", description: "HH:MM, or \"\" to clear." }, durationMin: { type: "integer" }, cost: { type: "number" },
      mustDo: { type: "boolean" }, veg: { type: "string", enum: ["yes", "some", "no", "unknown"] }, vegNote: { type: "string" }, lat: { type: "number" }, lng: { type: "number" },
    } } }, required: ["item", "changes"] },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const it = findItem(items, a.item, trip);
      const x = a.changes || {}, ch = {};
      if (x.title !== undefined) { ch.title = str(x.title, 140); if (!ch.title) throw new Error("The title can't be empty."); }
      for (const [k, max] of [["location", 200], ["description", 600], ["notes", 1200], ["vegNote", 120]]) if (x[k] !== undefined) ch[k] = str(x[k], max);
      if (x.url !== undefined) ch.url = /^https?:\/\//i.test(str(x.url, 2000)) ? str(x.url, 2000) : "";
      if (x.category !== undefined) { if (!CATEGORIES.includes(x.category)) throw new Error("Unknown category."); ch.category = x.category; }
      if (x.time !== undefined) ch.time = x.time === "" ? "" : hhmm(x.time);
      if (x.durationMin !== undefined) ch.durationMin = Math.min(900, Math.max(5, Math.round(num(x.durationMin)) || 60));
      if (x.cost !== undefined) ch.cost = num(x.cost);
      if (x.mustDo !== undefined) ch.mustDo = !!x.mustDo;
      if (x.veg !== undefined) { const v = ({ yes: "yes", some: "yes", no: "no" })[String(x.veg).toLowerCase()] || ""; ch.veg = v; ch.vegSource = v ? c.client.toLowerCase() : ""; }
      if (Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) && x.lat !== null && x.lng !== null && x.lat !== "" && x.lng !== "") { ch.lat = Number(x.lat); ch.lng = Number(x.lng); }
      const b = c.fs.batch(), ops = [];
      if (!patchItem(b, c, trip, it, ch, ops)) return { trip: trip.name, changed: false, why: "Nothing to change." };
      const r = await finish(b, c, trip, `edited “${it.title}” (${Object.keys(ch).join(", ")})`, ops, { changed: Object.keys(ch) });
      return withWarn(r, it.dayId ? warnFor(trip, items, [onDay(trip, it)]) : []);
    },
  },
  {
    name: "remove_item",
    description: "Delete a saved place or stop from the trip. It is gone from the plan (Undo puts it back). Prefer move_item to \"ideas\" when the user may want it later; delete only when asked.",
    inputSchema: { type: "object", properties: { trip: TRIP, item: ITEM }, required: ["item"] },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const it = findItem(items, a.item, trip);
      const { id, ...data } = it;
      const day = onDay(trip, it);
      const b = c.fs.batch(), ops = [{ op: "restoreItem", id, data }];
      b.remove(`trips/${trip.id}/items/${id}`);
      const rest = dayItemsOf(items, it.dayId || "∅").filter((x) => x.id !== id);
      items.splice(items.indexOf(it), 1);
      if (day >= 0) setOrder(b, c, trip, items, trip.days[day].id, rest.map((x) => x.id), ops);
      const r = await finish(b, c, trip, `removed “${it.title}” from ${dayTag(trip, day)}`, ops, { removed: it.title });
      return withWarn(r, warnFor(trip, items, [day]));
    },
  },
  {
    name: "update_day",
    description: "Edit a day's title, the town they stay in that night (base), start time or notes. Only the fields you pass change. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, day: { type: ["integer", "string"], description: "Day number from 1." }, title: { type: "string" }, base: { type: "string", description: "Where they sleep / base for the day." }, startTime: { type: "string", description: "HH:MM the day starts." }, notes: { type: "string" } }, required: ["day"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const di = dayIndex(trip, a.day);
      const res = await editFields(c, trip, (cur) => {
        const days = JSON.parse(JSON.stringify(cur.days || []));
        const d = days[di];
        if (!d) throw new Error("That day no longer exists.");
        const before = JSON.parse(JSON.stringify(cur.days));
        if (a.title !== undefined) d.title = str(a.title, 80);
        if (a.base !== undefined) d.base = str(a.base, 80);
        if (a.startTime !== undefined) d.startTime = a.startTime === "" ? "" : hhmm(a.startTime);
        if (a.notes !== undefined) d.notes = str(a.notes, 600);
        if (JSON.stringify(before) === JSON.stringify(days)) return null;
        return { patch: { days, ...stamp(c) }, before, after: days };
      });
      if (!res) return { trip: trip.name, changed: false, why: "Nothing to change." };
      return finish(c.fs.batch(), c, trip, `edited ${dayTag(trip, di)} details`, [{ op: "restoreFields", before: { days: res.before }, after: { days: res.after } }], { day: di + 1 });
    },
  },
  {
    name: "add_day",
    description: "Add an empty day to the trip, at the end or after a given day. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, after: { type: "integer", description: "Insert after this day number. Default: at the end." } } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const res = await editFields(c, trip, (cur) => {
        const before = JSON.parse(JSON.stringify(cur.days || []));
        if (before.length >= 60) throw new Error("A trip can have at most 60 days.");
        const days = JSON.parse(JSON.stringify(before));
        const at = Number.isInteger(a.after) ? Math.min(Math.max(0, a.after), days.length) : days.length;
        days.splice(at, 0, { id: newId(), title: "", base: "", notes: "" });
        return { patch: { days, ...stamp(c) }, before, after: days, at };
      });
      return finish(c.fs.batch(), c, trip, `added day ${res.at + 1}`, [{ op: "restoreFields", before: { days: res.before }, after: { days: res.after } }], { added: res.at + 1, days: res.after.length });
    },
  },
  {
    name: "remove_day",
    description: "Remove a day from the trip. Its stops are NOT deleted: they go back to Ideas. Applies at once with Undo. Say which day you are removing first.",
    inputSchema: { type: "object", properties: { trip: TRIP, day: { type: ["integer", "string"], description: "Day number from 1." } }, required: ["day"] },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const di = dayIndex(trip, a.day);
      if (trip.days.length <= 1) throw new Error("A trip needs at least one day.");
      const day = trip.days[di];
      const b = c.fs.batch(), ops = [];
      const mine = dayItemsOf(items, day.id);
      setOrder(b, c, trip, items, null, mine.map((i) => i.id), ops);
      const days = trip.days.filter((d) => d.id !== day.id);
      await editFields(c, trip, (cur) => {
        if (JSON.stringify(cur.days) !== JSON.stringify(trip.days)) throw new Error("The days changed while this ran. Try again.");
        return { patch: { days, ...stamp(c) } };
      });
      ops.push({ op: "restoreFields", before: { days: trip.days }, after: { days } });
      return finish(b, c, trip, `removed day ${di + 1}${mine.length ? ` (${mine.length} stop${mine.length > 1 ? "s" : ""} moved to ideas)` : ""}`, ops, { removedDay: di + 1, movedToIdeas: mine.map((i) => i.title) });
    },
  },
  {
    name: "update_trip",
    description: "Change the trip's name, destination, start date (YYYY-MM-DD), currency or total budget. Applies at once with Undo. Travellers and sharing can't be changed here.",
    inputSchema: { type: "object", properties: { trip: TRIP, name: { type: "string" }, destination: { type: "string" }, startDate: { type: "string" }, currency: { type: "string" }, budget: { type: "number" } } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const want = {};
      if (a.name !== undefined) { want.name = str(a.name, 80); if (!want.name) throw new Error("The trip name can't be empty."); }
      if (a.destination !== undefined) want.destination = str(a.destination, 120);
      if (a.startDate !== undefined) { if (a.startDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(a.startDate)) throw new Error("startDate must be YYYY-MM-DD."); want.startDate = a.startDate; }
      if (a.currency !== undefined) want.currency = str(a.currency, 3).toUpperCase() || "INR";
      if (a.budget !== undefined) want.budget = num(a.budget);
      const res = await editFields(c, trip, (cur) => {
        const before = {}, after = {};
        for (const [k, v] of Object.entries(want)) if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v)) { before[k] = cur[k] ?? null; after[k] = v; }
        return Object.keys(after).length ? { patch: { ...after, ...stamp(c) }, before, after } : null;
      });
      if (!res) return { trip: trip.name, changed: false, why: "Nothing to change." };
      return finish(c.fs.batch(), c, trip, `changed the trip's ${Object.keys(res.after).join(", ")}`, [{ op: "restoreFields", before: res.before, after: res.after }], { changed: res.after });
    },
  },
  {
    name: "add_booking",
    description: "Record a booking (flight leg, hotel stay, train, bus, ferry, car, tickets) from a confirmation the user shared. One call per flight leg or hotel stay. Never invent values that aren't in the confirmation. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, ...BOOKING_PROPS }, required: ["kind", "title"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const id = newId();
      const b = { id, kind: "other", title: "", ref: "", start: "", end: "", from: "", to: "", address: "", cost: 0, currency: trip.currency || "INR", notes: "", ...cleanBooking(a, trip), by: c.email, at: Date.now() };
      if (!b.title && !b.ref) throw new Error("A booking needs a title or a reference.");
      const dup = await editList(c, trip, "bookings", (l) => {
        const d = l.find((x) => (b.ref && x.ref === b.ref && x.kind === b.kind) || (x.title === b.title && x.start === b.start));
        if (d) return { dup: d };
        l.push(b);
        return { ok: true };
      });
      if (dup.dup) return { trip: trip.name, saved: false, why: `Already recorded: “${dup.dup.title}”.`, id: dup.dup.id };
      const out = await finish(c.fs.batch(), c, trip, `added booking: ${b.title || b.ref}`, [{ op: "removeListed", field: "bookings", ids: [id] }], { saved: true, id });
      const days = trip.days.length;
      return b.start && trip.startDate && (b.start.slice(0, 10) < trip.startDate || (dayDate(trip, days - 1) && b.start.slice(0, 10) > dayDate(trip, days - 1)))
        ? { ...out, warnings: ["This booking falls outside the trip's dates. Check the dates with the user."] } : out;
    },
  },
  {
    name: "update_booking",
    description: "Change fields of a recorded booking (see get_trip for ids). Only the fields you pass change. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string", description: "Booking id from get_trip." }, ...BOOKING_PROPS }, required: ["id"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const { id, trip: _t, ...fields } = a;
      const res = await editList(c, trip, "bookings", (l) => {
        const cur = l.find((x) => x.id === id);
        if (!cur) throw new Error("No booking with that id. Use get_trip to see them.");
        const next = cleanBooking(fields, trip, cur);
        const before = {}, after = {};
        for (const k of Object.keys(next)) if (JSON.stringify(next[k] ?? null) !== JSON.stringify(cur[k] ?? null)) { before[k] = cur[k] ?? null; after[k] = next[k]; }
        if (!Object.keys(after).length) return { none: true };
        Object.assign(cur, after);
        return { before, after, title: cur.title };
      });
      if (res.none) return { trip: trip.name, changed: false, why: "Nothing to change." };
      return finish(c.fs.batch(), c, trip, `edited booking: ${res.title}`, [{ op: "patchListed", field: "bookings", id, before: res.before, after: res.after }], { changed: Object.keys(res.after) });
    },
  },
  {
    name: "remove_booking",
    description: "Delete a recorded booking (Undo puts it back).",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string" } }, required: ["id"] },
    async run(a, c) { return removeListed(a, c, "bookings", "booking", (x) => x.title || x.ref); },
  },
  {
    name: "add_extra",
    description: "Add a budget extra that isn't a place, e.g. \"Return flights\" 24000. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, label: { type: "string" }, cost: { type: "number" } }, required: ["label", "cost"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const label = str(a.label, 80);
      if (!label) throw new Error("The extra needs a label.");
      const id = newId();
      const cost = num(a.cost);
      const dup = await editList(c, trip, "extras", (l) => {
        if (l.some((x) => nrm(x.label) === nrm(label) && Number(x.cost) === cost)) return { dup: true };
        l.push({ id, label, cost, by: c.email });
        return { ok: true };
      });
      if (dup.dup) return { trip: trip.name, saved: false, why: "The same extra is already there." };
      return finish(c.fs.batch(), c, trip, `added budget extra: ${label} (${cost})`, [{ op: "removeListed", field: "extras", ids: [id] }], { saved: true, id });
    },
  },
  {
    name: "remove_extra",
    description: "Delete a budget extra (ids are in get_trip). Undo puts it back.",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string" } }, required: ["id"] },
    async run(a, c) { return removeListed(a, c, "extras", "budget extra", (x) => x.label); },
  },
  {
    name: "add_todo",
    description: "Add a to-do or packing item to the trip's Kit tab. group is \"todo\" (default) or \"pack\". Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, text: { type: "string" }, group: { type: "string", enum: ["todo", "pack"] }, who: { type: "string", description: "Optional: whose job it is (a first name)." } }, required: ["text"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const text = str(a.text, 200), group = a.group === "pack" ? "pack" : "todo";
      if (!text) throw new Error("The item is empty.");
      const id = newId();
      const res = await editList(c, trip, "checklist", (l) => {
        if (l.length >= 300) throw new Error("The Kit list is full.");
        if (l.some((x) => x.group === group && nrm(x.text) === nrm(text))) return { dup: true };
        l.push({ id, text, group, who: str(a.who, 40), done: false, doneBy: "", at: Date.now(), by: c.email });
        return { ok: true };
      });
      if (res.dup) return { trip: trip.name, saved: false, why: "That is already on the list." };
      return finish(c.fs.batch(), c, trip, `added to ${group === "pack" ? "packing" : "to-dos"}: ${text}`, [{ op: "removeListed", field: "checklist", ids: [id] }], { saved: true, id });
    },
  },
  {
    name: "set_todo",
    description: "Tick or untick a Kit item, or reword it (ids are in get_trip's checklist). Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string" }, done: { type: "boolean" }, text: { type: "string" } }, required: ["id"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const res = await editList(c, trip, "checklist", (l) => {
        const cur = l.find((x) => x.id === a.id);
        if (!cur) throw new Error("No Kit item with that id.");
        const next = {};
        if (a.done !== undefined) { next.done = !!a.done; next.doneBy = a.done ? c.email : ""; }
        if (a.text !== undefined && str(a.text, 200)) next.text = str(a.text, 200);
        const before = {}, after = {};
        for (const k of Object.keys(next)) if (cur[k] !== next[k]) { before[k] = cur[k] ?? null; after[k] = next[k]; }
        if (!Object.keys(after).length) return { none: true };
        Object.assign(cur, after);
        return { before, after, text: cur.text };
      });
      if (res.none) return { trip: trip.name, changed: false, why: "Nothing to change." };
      return finish(c.fs.batch(), c, trip, `${res.after.done === true ? "ticked" : res.after.done === false ? "unticked" : "edited"} “${res.text}”`, [{ op: "patchListed", field: "checklist", id: a.id, before: res.before, after: res.after }], { changed: res.after });
    },
  },
  {
    name: "remove_todo",
    description: "Delete a Kit to-do or packing item. Undo puts it back.",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string" } }, required: ["id"] },
    async run(a, c) { return removeListed(a, c, "checklist", "Kit item", (x) => x.text); },
  },
  {
    name: "set_trip_note",
    description: "Mark a shared trip note done or not done, or delete it (remove true). Ids are in get_trip's tripNotes. Applies at once with Undo.",
    inputSchema: { type: "object", properties: { trip: TRIP, id: { type: "string" }, done: { type: "boolean" }, remove: { type: "boolean" } }, required: ["id"] },
    async run(a, c) {
      if (a.remove) return removeListed(a, c, "tripNotes", "trip note", (x) => x.text);
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const res = await editList(c, trip, "tripNotes", (l) => {
        const cur = l.find((x) => x.id === a.id);
        if (!cur) throw new Error("No trip note with that id.");
        if (a.done === undefined || !!cur.done === !!a.done) return { none: true };
        const before = { done: !!cur.done }, after = { done: !!a.done };
        cur.done = !!a.done;
        return { before, after, text: cur.text };
      });
      if (res.none) return { trip: trip.name, changed: false, why: "Nothing to change." };
      return finish(c.fs.batch(), c, trip, `${a.done ? "ticked off" : "reopened"} the note: ${String(res.text).slice(0, 60)}`, [{ op: "patchListed", field: "tripNotes", id: a.id, before: res.before, after: res.after }], { changed: res.after });
    },
  },
  {
    name: "check_plan",
    description: "Check the whole trip against their rules without changing anything: vegetarian, vegan or egg options for every restaurant, a rest block each day, no more than 3 to 4 sights a day, a market visit, empty days. Run it after you change a plan and tell the user about each warning.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: "object", properties: { trip: TRIP } },
    async run(a, c) {
      const { trip, items } = await load(a, c);
      const empty = trip.days.map((d, i) => (items.some((x) => x.dayId === d.id) ? 0 : i + 1)).filter(Boolean);
      const warnings = tripWarnings(trip, items);
      return { trip: trip.name, days: trip.days.length, emptyDays: empty, ideas: items.filter((i) => onDay(trip, i) < 0).length, warnings, ok: !warnings.length };
    },
  },
].map((t) => ({ annotations: writes, ...t }));

async function removeListed(a, c, field, what, label) {
  const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
  const res = await editList(c, trip, field, (l) => {
    const at = l.findIndex((x) => x.id === a.id);
    if (at < 0) throw new Error(`No ${what} with that id.`);
    const [item] = l.splice(at, 1);
    return { at, item };
  });
  return finish(c.fs.batch(), c, trip, `removed ${what}: ${String(label(res.item)).slice(0, 80)}`, [{ op: "reinsertListed", field, entries: [{ at: res.at, item: res.item }] }], { removed: label(res.item) });
}
