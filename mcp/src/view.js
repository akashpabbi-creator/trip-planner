// Read-only views of a trip, shaped like the app's own plan snapshot (app.js planSnapshot) so Claude sees what the couple see.
const toMin = (h) => (/^\d{1,2}:\d{2}$/.test(h || "") ? +h.split(":")[0] * 60 + +h.split(":")[1] : null);
const fromMin = (m) => { m = ((m % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false));

export const dayDate = (trip, i) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate || "")) return undefined;
  const d = new Date(trip.startDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
export const onDay = (trip, it) => (trip.days || []).findIndex((d) => d.id === it.dayId);
export const ideasOf = (trip, items) => items.filter((it) => onDay(trip, it) < 0).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

export function stop(trip, it, nameOf) {
  return clean({
    id: it.id, title: it.title, category: it.category, location: it.location, fixedTime: it.time, durationMin: it.durationMin,
    cost: it.cost, mustDo: it.mustDo, veg: it.veg, vegNote: it.vegNote, notes: it.notes, description: it.description, url: it.url,
    rating: it.rating, rest: it.rest,
    addedBy: it.suggestedBy ? (it.aiSource || it.siteName || "suggestion") : nameOf(it.addedBy),
    travelToHere: it.travel?.mode ? { mode: it.travel.mode, minutes: it.travel.minutes } : undefined,
    pinned: it.lat != null && it.lng != null ? true : undefined,
  });
}

// Same timeline rule as the app: a fixed time wins, otherwise previous end plus travel.
export function dayView(trip, items, i, nameOf) {
  const day = trip.days[i];
  let clock = toMin(day.startTime) ?? 9 * 60;
  const list = items.filter((it) => it.dayId === day.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  return clean({
    day: i + 1, date: dayDate(trip, i), title: day.title, stayingIn: day.base, notes: day.notes,
    schedule: list.map((it, idx) => {
      const travel = idx > 0 || it.travel?.fromPrevDay ? Number(it.travel?.minutes) || 0 : 0;
      const start = toMin(it.time) ?? clock + travel;
      clock = start + (Number(it.durationMin) || 60);
      return { ...stop(trip, it, nameOf), estStart: fromMin(start) };
    }),
  });
}

export const memberNameOf = (trip) => (email) => trip.memberNames?.[email] || (email || "").split("@")[0];

export function tripSummary(trip) {
  return clean({
    id: trip.id, name: trip.name, destination: trip.destination, startDate: trip.startDate, days: (trip.days || []).length,
    currency: trip.currency, budget: trip.budget, travellers: Object.values(trip.memberNames || {}).length ? Object.values(trip.memberNames) : trip.members,
    owner: trip.owner, updatedAt: trip.updatedAt,
  });
}

export function tripView(trip, items) {
  const nameOf = memberNameOf(trip);
  return {
    ...tripSummary(trip),
    days: (trip.days || []).map((d, i) => clean({
      day: i + 1, date: dayDate(trip, i), title: d.title, stayingIn: d.base,
      stops: items.filter((it) => it.dayId === d.id).length,
    })),
    // The trip's Google Drive folder (set in the app). File the Trip Sheet PDF and notes here.
    driveFolder: trip.driveFolder?.id ? clean({ id: trip.driveFolder.id, name: trip.driveFolder.name, url: trip.driveFolder.url }) : undefined,
    ideasCount: ideasOf(trip, items).length,
    bookings: (trip.bookings || []).map((b) => clean({ id: b.id, kind: b.kind, title: b.title, ref: b.ref, from: b.from, to: b.to, date: b.date, start: b.start, end: b.end })),
    tripNotes: (trip.tripNotes || []).map((n) => clean({ id: n.id, text: n.text, by: nameOf(n.by), done: n.done })),
    extras: trip.extras || [],
    checklist: trip.checklist,
    prefs: trip.prefs,
  };
}

export function matchTrip(trips, query) {
  if (!trips.length) throw new Error("No trips found for this account.");
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    if (trips.length === 1) return trips[0];
    throw new Error("Which trip? " + trips.map((t) => `${t.name} (${t.destination || "no destination"}, id ${t.id})`).join("; "));
  }
  const exact = trips.find((t) => t.id === query);
  if (exact) return exact;
  const hits = trips.filter((t) => [t.name, t.destination, t.startDate].some((f) => String(f || "").toLowerCase().includes(q)));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No trip matches "${query}". Trips: ` + trips.map((t) => `${t.name} (id ${t.id})`).join("; "));
  throw new Error(`"${query}" matches several trips, ask which one: ` + hits.map((t) => `${t.name} (${t.destination || ""}, ${t.startDate || "no date"}, id ${t.id})`).join("; "));
}
