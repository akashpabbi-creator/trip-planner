// MCP tools. Job 1: read-only. Every tool runs as the signed-in user, so the Firestore rules still apply.
import { matchTrip, tripSummary, tripView, dayView, stop, ideasOf, onDay, memberNameOf } from "./view.js";

const TRIP = { type: "string", description: "Trip name, destination, start date (YYYY-MM-DD) or id. Optional when there is only one trip." };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const TOOLS = [
  {
    name: "whoami",
    description: "Which account this connector is signed in as, and what it can reach. Call first to confirm the connection.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, c) {
      const trips = await c.fs.tripsFor(c.email);
      return { email: c.email, name: c.name || undefined, aiUser: true, trips: trips.length };
    },
  },
  {
    name: "list_trips",
    description: "List the trips this account is a member of (name, destination, dates, number of days). Use to find the right trip before reading or changing one.",
    inputSchema: { type: "object", properties: {} },
    async run(_a, c) {
      return (await c.fs.tripsFor(c.email)).map(tripSummary);
    },
  },
  {
    name: "get_trip",
    description: "One trip in full: dates, travellers, a one-line overview of every day, how many ideas are waiting, bookings, shared trip notes, extras, checklist. Use get_day for the stops of a day.",
    inputSchema: { type: "object", properties: { trip: TRIP } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      return tripView(trip, await c.fs.items(trip.id));
    },
  },
  {
    name: "get_day",
    description: "The stops on one day in order, with start times, categories, locations, vegetarian notes and who added each. Day 1 is the first day. Pass day 0 or \"ideas\" for the Ideas list (saved places not yet on a day).",
    inputSchema: { type: "object", properties: { trip: TRIP, day: { type: ["integer", "string"], description: "Day number from 1, or 0 / \"ideas\" for Ideas." } }, required: ["day"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const items = await c.fs.items(trip.id);
      const nameOf = memberNameOf(trip);
      if (a.day === 0 || String(a.day).toLowerCase() === "ideas" || a.day === "0") {
        return { ideas: ideasOf(trip, items).slice(0, 100).map((it) => stop(trip, it, nameOf)) };
      }
      const n = Number(a.day);
      if (!Number.isInteger(n) || n < 1 || n > trip.days.length) throw new Error(`Day must be 1 to ${trip.days.length}.`);
      return dayView(trip, items, n - 1, nameOf);
    },
  },
  {
    name: "search_items",
    description: "Find saved places and stops by words in the title, location, notes or description, optionally limited to a category (sight, activity, food, stay, shopping, nature, transport, other) or a day. Searches the days and Ideas. Use before adding something, to avoid duplicates.",
    inputSchema: { type: "object", properties: {
      trip: TRIP, query: { type: "string", description: "Words to look for. Empty lists everything that matches the other filters." },
      category: { type: "string" }, day: { type: ["integer", "string"], description: "Day number from 1, or \"ideas\"." },
    } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const nameOf = memberNameOf(trip);
      const q = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean);
      const out = [];
      for (const it of await c.fs.items(trip.id)) {
        const d = onDay(trip, it);
        if (a.category && it.category !== a.category) continue;
        if (a.day !== undefined && a.day !== "") {
          if (String(a.day).toLowerCase() === "ideas" ? d >= 0 : d !== Number(a.day) - 1) continue;
        }
        const hay = [it.title, it.location, it.notes, it.description].join(" ").toLowerCase();
        if (!q.every((w) => hay.includes(w))) continue;
        out.push({ ...stop(trip, it, nameOf), where: d >= 0 ? `day ${d + 1}` : "ideas" });
        if (out.length >= 50) break;
      }
      return out;
    },
  },
  {
    name: "recent_activity",
    description: "The trip's activity log, newest first: who added, moved or changed what, including changes made through this connector.",
    inputSchema: { type: "object", properties: { trip: TRIP, limit: { type: "integer", description: "How many entries (default 20, max 100)." } } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const rows = await c.fs.activity(trip.id, Math.min(100, Math.max(1, Number(a.limit) || 20)));
      return rows.map((r) => ({ at: new Date(r.at).toISOString(), by: r.byName || r.by, text: r.text }));
    },
  },
].map((t) => ({ annotations: readOnly, ...t }));

export const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
