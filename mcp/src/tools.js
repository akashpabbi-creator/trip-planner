// MCP tools. Every tool runs as the signed-in user, so the Firestore rules still apply.
// Job 1: read tools. Job 2: capture tools (Ideas only, plus Kit to-dos and trip notes) and undo.
import { matchTrip, tripSummary, tripView, dayView, stop, ideasOf, onDay, memberNameOf } from "./view.js";
import { newId, record, stamp, undo } from "./undo.js";

const TRIP = { type: "string", description: "Trip name, destination, start date (YYYY-MM-DD) or id. Optional when there is only one trip." };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const CATEGORIES = ["sight", "activity", "food", "stay", "shopping", "nature", "transport", "other"];
const sameTitle = (a, b) => { const n = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); return !!n(a) && n(a) === n(b); };
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== "" && v !== null ? Number(v) : 0);
const BOOK = /\bbook(ing)?\b|reserv|tickets?\b|pre-?book/i;

// One Ideas card in the same shape the app writes for a saved link, so it behaves like one the couple saved themselves.
function ideaDoc(p, c) {
  const title = str(p.title, 140);
  if (!title) throw new Error("Each idea needs a title.");
  const url = /^https?:\/\//i.test(str(p.url, 2000)) ? str(p.url, 2000) : "";
  const tips = (Array.isArray(p.tips) ? p.tips : []).map((t) => str(t, 200)).filter(Boolean).slice(0, 6);
  const notes = [str(p.notes, 600), ...tips.map((t) => "Tip: " + t), p.source ? "Source: " + str(p.source, 120) : ""].filter(Boolean).join(" · ").slice(0, 1200);
  const category = CATEGORIES.includes(p.category) ? p.category : "sight";
  const veg = category === "food" ? ({ yes: "yes", some: "yes", no: "no" })[String(p.veg || "").toLowerCase()] : undefined;
  const hasPin = Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null && p.lat !== "" && p.lng !== "";
  return {
    tips,
    data: {
      title, description: str(p.description, 600), image: "", siteName: "", location: str(p.location, 200),
      ...(hasPin ? { lat: Number(p.lat), lng: Number(p.lng) } : {}),
      url, category, dayId: null, order: 0, time: "", durationMin: Math.min(600, num(p.durationMin) || 60), cost: num(p.cost),
      mustDo: false, notes, bestTime: str(p.bestTime, 40),
      ...(veg ? { veg, vegSource: c.client.toLowerCase() } : {}), ...(veg && p.vegNote ? { vegNote: str(p.vegNote, 120) } : {}),
      via: c.client, fromLink: !!url, addedBy: c.email, addedByName: c.name || c.email.split("@")[0], addedAt: Date.now(), ...stamp(c),
    },
  };
}

const IDEA_PROPS = {
  title: { type: "string", description: "Name of the place or thing, as people would search for it." },
  category: { type: "string", enum: CATEGORIES },
  location: { type: "string", description: "Address, area or town. Include the town so it can be found on the map." },
  description: { type: "string", description: "One or two sentences on what it is and why it is worth going." },
  notes: { type: "string", description: "Practical details: opening hours, price, how to get there." },
  tips: { type: "array", items: { type: "string" }, description: "Actionable tips from the source, one each: \"book 2 days ahead\", \"go before 9am\", \"closed Mondays\". A booking tip also adds a to-do to the trip's Kit." },
  url: { type: "string", description: "Link to the post, page or map the idea came from." },
  source: { type: "string", description: "Where this came from, e.g. \"Instagram reel by @foodie\" or \"screenshot from the user\"." },
  cost: { type: "number", description: "Rough cost for the two of them in the trip's currency; omit if unknown." },
  durationMin: { type: "integer" },
  bestTime: { type: "string", description: "morning, lunch, afternoon, sunset, evening ..." },
  veg: { type: "string", enum: ["yes", "some", "no", "unknown"], description: "Food only: does it have vegetarian, vegan or egg options? Say unknown if you haven't checked." },
  vegNote: { type: "string", description: "Short evidence, e.g. \"separate veg menu\"." },
  lat: { type: "number" }, lng: { type: "number" },
};

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
    description: "The trip's activity log, newest first: who added, moved or changed what, including changes made through this connector. Entries with undoable true can be reversed with undo_change.",
    inputSchema: { type: "object", properties: { trip: TRIP, limit: { type: "integer", description: "How many entries (default 20, max 100)." } } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const rows = await c.fs.activity(trip.id, Math.min(100, Math.max(1, Number(a.limit) || 20)));
      return rows.map((r) => ({ id: r.id, at: new Date(r.at).toISOString(), by: r.byName || r.by, text: r.text, ...(r.undo && !r.undone ? { undoable: true } : {}) }));
    },
  },
].map((t) => ({ annotations: readOnly, ...t }));

const WRITE_TOOLS = [
  {
    name: "save_ideas",
    description: "Save places or things the user shared (a screenshot, an Instagram or Maps link, a reel, a chat, a list of tips) to the trip's IDEAS. Ideas are never put on a day; the user moves them there. Read the shared material yourself, pull out each real place with its details, and pass them here (up to 20 at once). Check search_items first if the place may already be saved; duplicates by name are skipped. Put each actionable tip in `tips`.",
    inputSchema: { type: "object", properties: { trip: TRIP, ideas: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: IDEA_PROPS, required: ["title"] } } }, required: ["ideas"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const list = Array.isArray(a.ideas) ? a.ideas.slice(0, 20) : [];
      if (!list.length) throw new Error("Pass at least one idea.");
      const have = await c.fs.items(trip.id);
      const results = [], made = [], ops = [], todos = [];
      for (const p of list) {
        let d;
        try { d = ideaDoc(p, c); } catch (e) { results.push({ title: str(p?.title, 80), status: "skipped", why: e.message }); continue; }
        const dup = [...have, ...made].find((x) => sameTitle(x.title, d.data.title));
        if (dup) {
          const day = onDay(trip, dup);
          results.push({ title: d.data.title, status: "already saved", where: day >= 0 ? `day ${day + 1}` : "ideas" });
          continue;
        }
        const id = newId();
        await c.fs.create(`trips/${trip.id}/items`, id, d.data);
        made.push({ id, title: d.data.title });
        ops.push({ op: "deleteItem", id });
        results.push({ title: d.data.title, status: "saved to ideas", id });
        if (d.tips.some((t) => BOOK.test(t)) || BOOK.test(d.data.notes)) todos.push(`Book ${d.data.title}`);
      }
      let kit = 0;
      if (todos.length) {
        const ids = [];
        await c.fs.txTrip(trip.id, (cur) => {
          const l = [...(cur.checklist || [])];
          const seen = new Set(l.map((x) => x.group + "|" + x.text.trim().toLowerCase()));
          ids.length = 0;
          for (const t of todos) {
            if (seen.has("todo|" + t.toLowerCase())) continue;
            seen.add("todo|" + t.toLowerCase());
            const id = newId();
            ids.push(id);
            l.push({ id, text: t, group: "todo", who: "", done: false, doneBy: "", at: Date.now(), auto: true, by: c.email });
          }
          return ids.length ? { checklist: l, ...stamp(c) } : null;
        });
        kit = ids.length;
        if (kit) ops.push({ op: "removeListed", field: "checklist", ids });
      }
      if (made.length) {
        const text = made.length === 1 ? `added “${made[0].title}” to ideas` : `added ${made.length} ideas (${made.slice(0, 3).map((m) => "“" + m.title + "”").join(", ")}${made.length > 3 ? ", …" : ""})`;
        const entry = await record(c, trip.id, text + (kit ? ` and ${kit} booking to-do${kit > 1 ? "s" : ""}` : ""), ops);
        await c.fs.patch(`trips/${trip.id}`, stamp(c));
        return { trip: trip.name, saved: made.length, kitTodos: kit, results, undoWith: { tool: "undo_change", entry } };
      }
      return { trip: trip.name, saved: 0, results };
    },
  },
  {
    name: "add_trip_note",
    description: "Add a note to the trip's shared Trip notes (Kit tab): a wish, a reminder or a remark from the user that is not a specific place, e.g. \"Sanj wants a slow morning on day 3\". Use save_ideas for places.",
    inputSchema: { type: "object", properties: { trip: TRIP, text: { type: "string", description: "The note, one or two sentences." } }, required: ["text"] },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      const text = str(a.text, 1000);
      if (!text) throw new Error("The note is empty.");
      const id = newId();
      let added = false;
      await c.fs.txTrip(trip.id, (cur) => {
        const notes = [...(cur.tripNotes || [])];
        added = false;
        if (notes.length >= 100 || notes.some((n) => n.text.trim().toLowerCase() === text.toLowerCase())) return null;
        notes.push({ id, text, by: c.email, byName: c.client, at: Date.now(), done: false });
        added = true;
        return { tripNotes: notes, ...stamp(c) };
      });
      if (!added) return { trip: trip.name, saved: false, why: "The same note is already there (or the list is full)." };
      const entry = await record(c, trip.id, `added a trip note: ${text.slice(0, 80)}`, [{ op: "removeListed", field: "tripNotes", ids: [id] }]);
      return { trip: trip.name, saved: true, undoWith: { tool: "undo_change", entry } };
    },
  },
  {
    name: "undo_change",
    description: "Undo a change made through this connector. With no entry it reverses the newest change that can still be undone; pass an entry id from recent_activity or from a tool's undoWith to pick one. Say what you are undoing before you call it.",
    inputSchema: { type: "object", properties: { trip: TRIP, entry: { type: "string", description: "Activity entry id. Optional." } } },
    async run(a, c) {
      const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
      return undo(c, trip, a.entry ? String(a.entry) : "");
    },
  },
].map((t) => ({ annotations: writes, ...t }));

TOOLS.push(...WRITE_TOOLS);

export const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
