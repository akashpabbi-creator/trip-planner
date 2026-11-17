// Server side of the day card: builds what the card draws (structuredContent) and the app-only helper tools its buttons call.
// The text answer of get_day / plan_day / move_item is never touched; this only adds structuredContent beside it.
import { matchTrip, dayView, dayDate, memberNameOf, onDay, ideasOf } from "../view.js";
import { dayWarnings, CONTROL } from "../control.js";
import { TRIP } from "../tools.js";
import { deepLink } from "./links.js";

const MOVE = CONTROL.find((t) => t.name === "move_item");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The veg warnings are shown as badges on the stop, so the card keeps only the rest and pace notes, in short form.
export function cardWarnings(trip, items, idxs, viewIdx) {
  return [...new Set(idxs)].filter((i) => i >= 0).flatMap((i) => dayWarnings(trip, items, i)
    .filter((w) => !/vegetarian/.test(w))
    .map((w) => {
      const short = w.replace(/^Day \d+: /, "").split(/\.\s/)[0].replace(/\.$/, "");
      return (i === viewIdx ? "" : `Day ${i + 1}: `) + cap(short) + ".";
    }));
}

const directions = (it) => {
  const q = it.lat != null && it.lng != null ? `${it.lat},${it.lng}` : [it.title, it.location].filter(Boolean).join(" ");
  return q ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q) : undefined;
};

// One day in the shape the card draws: dayView's schedule (times as the app computes them) plus a Directions link per stop.
function oneDay(trip, items, i) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const v = dayView(trip, items, i, memberNameOf(trip));
  return {
    day: i + 1, date: dayDate(trip, i), title: trip.days[i].title || undefined, stayingIn: trip.days[i].base || undefined,
    schedule: (v.schedule || []).map((s) => ({ ...s, directions: directions(byId.get(s.id) || {}) })),
  };
}

// Card data for day n (1-based) of a trip. all: also every day's stops (fullscreen).
export function dayCardData(trip, items, n, env, { all = false, warnIdx = [] } = {}) {
  const i = n - 1;
  const d = oneDay(trip, items, i);
  return {
    mode: "day", tripId: trip.id, trip: trip.name, destination: trip.destination || undefined, nDays: trip.days.length, ...d,
    days: trip.days.map((_, k) => ({ day: k + 1, date: dayDate(trip, k), stops: items.filter((it) => it.dayId === trip.days[k].id).length })),
    ideasCount: ideasOf(trip, items).length,
    warnings: cardWarnings(trip, items, [i, ...warnIdx], i),
    ...(all ? { all: trip.days.map((_, k) => (k === i ? d : oneDay(trip, items, k))) } : {}),
    appUrl: deepLink(env, { trip: trip.id, tab: "plan", day: n }),
  };
}

const load = async (c, query) => {
  const trip = matchTrip(await c.fs.tripsFor(c.email), query);
  return { trip, items: await c.fs.items(trip.id) };
};
const dayNo = (trip, v, fallback = 1) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= trip.days.length ? n : fallback; };
const receiptOnly = (trip, env, receipt, r) => ({ mode: "receipt", tripId: trip.id, trip: trip.name, receipt, undoWith: r.undoWith, warnings: [], appUrl: deepLink(env, { trip: trip.id, tab: "plan" }) });

// Helpers run without the Worker env, so the Open in app link is filled in by their structure step.
const withLink = (r, env) => ({ ...r, appUrl: deepLink(env, { trip: r.tripId, tab: "plan", day: r.day }) });

// TOOL_CARDS entries: tool name -> { uri, structure }. structure runs after the tool, so it sees the plan as it now is.
const URI = "ui://trips/day";
export const DAY_TOOL_CARDS = {
  get_day: { uri: URI, async structure(r, a, c, env) {
    const { trip, items } = await load(c, a.trip);
    if (r.ideas) return { mode: "ideas", tripId: trip.id, trip: trip.name, count: r.ideas.length, appUrl: deepLink(env, { trip: trip.id, tab: "ideas" }) };
    return dayCardData(trip, items, dayNo(trip, a.day), env, {});
  } },
  plan_day: { uri: URI, async structure(r, a, c, env) {
    const { trip, items } = await load(c, a.trip);
    const n = dayNo(trip, r.day);
    const names = r.onDay || [];
    return { ...dayCardData(trip, items, n, env), receipt: `${a.replace ? "Rebuilt" : "Planned"} day ${n}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`, undoWith: r.undoWith };
  } },
  move_item: { uri: URI, async structure(r, a, c, env) {
    const { trip, items } = await load(c, a.trip);
    if (r.moved === false) return receiptOnly(trip, env, r.why || "Nothing to move.", {});
    const text = `Moved “${r.moved}” to ${r.to}.`;
    const n = Number(a.day);
    if (!Number.isInteger(n) || n < 1 || n > trip.days.length) return receiptOnly(trip, env, text, r);
    return { ...dayCardData(trip, items, n, env), receipt: text, undoWith: r.undoWith };
  } },
  // app-only helpers return the card data themselves
  day_card: { uri: URI, structure: (r, _a, _c, env) => withLink(r, env) },
  day_card_move: { uri: URI, structure: (r, _a, _c, env) => withLink(r, env) },
};

const DAY_ARG = { type: ["integer", "string"], description: "Day number from 1." };
export const DAY_APP_TOOLS = [
  {
    name: "day_card", description: "Read one day (and, with all, every day) for the day card.", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: "object", properties: { trip: TRIP, day: DAY_ARG, all: { type: "boolean" } }, required: ["day"] },
    async run(a, c) {
      const { trip, items } = await load(c, a.trip);
      return dayCardData(trip, items, dayNo(trip, a.day), {}, { all: !!a.all });
    },
  },
  {
    name: "day_card_move", description: "Move a stop to another day or to Ideas (same as move_item), then return the day being viewed.",
    inputSchema: { type: "object", properties: { trip: TRIP, item: { type: "string" }, day: { type: ["integer", "string"], description: "Target day number, or \"ideas\"." }, view: DAY_ARG, all: { type: "boolean" } }, required: ["item", "day", "view"] },
    async run(a, c) {
      const r = await MOVE.run({ trip: a.trip, item: a.item, day: a.day }, c);
      const { trip, items } = await load(c, a.trip);
      const to = Number.isInteger(Number(a.day)) ? Number(a.day) - 1 : -1;
      const data = dayCardData(trip, items, dayNo(trip, a.view), {}, { all: !!a.all, warnIdx: [to] });
      return r.moved === false ? { ...data, receipt: r.why || "Nothing to move." } : { ...data, receipt: `Moved “${r.moved}” to ${r.to}.`, undoWith: r.undoWith };
    },
  },
];
