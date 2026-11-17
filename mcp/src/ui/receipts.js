// Structured content for the overview and receipt cards. The tools' text answers are never touched; this only adds what the cards draw.
import { deepLink } from "./links.js";
import { matchTrip } from "../view.js";

const dayOf = (w) => { const m = /^Day (\d+):/.exec(w); return m ? Number(m[1]) : 0; };
const tidy = (s) => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : "Change made"; };

// Which app tab shows what a change tool touched.
const TAB = { add_booking: "kit", update_booking: "kit", remove_booking: "kit", add_todo: "kit", set_todo: "kit", remove_todo: "kit", set_trip_note: "kit", add_trip_note: "kit", add_extra: "budget", remove_extra: "budget" };

export const RECEIPT_TOOLS = Object.keys({
  update_item: 1, remove_item: 1, update_day: 1, add_day: 1, remove_day: 1, update_trip: 1,
  add_booking: 1, update_booking: 1, remove_booking: 1, add_extra: 1, remove_extra: 1, add_todo: 1, set_todo: 1, remove_todo: 1, set_trip_note: 1, add_trip_note: 1,
});

async function tripId(c, name, query) {
  const trips = await c.fs.tripsFor(c.email);
  return (trips.find((t) => t.name === name) || matchTrip(trips, query)).id;
}

const warnList = (env, id, ws) => (ws || []).map((text) => { const day = dayOf(text); return { text, day: day || undefined, appUrl: day ? deepLink(env, { trip: id, tab: "plan", day }) : undefined }; });

// A change receipt: the activity line the tool just logged (the same sentence the app's Activity feed shows), warnings, Undo.
export function receipt(tool) {
  return async (r, a, c, env) => {
    const id = await tripId(c, r.trip, a.trip);
    const changed = r.changed !== false && r.saved !== false && r.moved !== false;
    let title = "";
    if (changed && r.undoWith?.entry) title = (await c.fs.get(`trips/${id}/activity/${r.undoWith.entry}`).catch(() => null))?.text || "";
    const day = Number.isInteger(r.day) ? r.day : Number.isInteger(r.added) ? r.added : undefined;
    return {
      ...r, kind: "receipt", tripId: id, title: tidy(title), changed,
      warnings: warnList(env, id, r.warnings),
      appUrl: deepLink(env, { trip: id, tab: TAB[tool] || "plan", day }),
    };
  };
}

export async function checkPlan(r, a, c, env) {
  const id = await tripId(c, r.trip, a.trip);
  return { ...r, kind: "check", tripId: id, warnings: warnList(env, id, r.warnings), appUrl: deepLink(env, { trip: id, tab: "plan" }) };
}

export const tripCard = (r, _a, _c, env) => ({ ...r, kind: "trip", tripId: r.id, appUrl: deepLink(env, { trip: r.id, tab: "plan" }) });
export const tripList = (r, _a, _c, env) => ({
  kind: "list",
  trips: (r.items || []).map((t) => ({ ...t, appUrl: deepLink(env, { trip: t.id, tab: "plan" }) })),
  appUrl: deepLink(env, {}),
});
