// Ideas carousel data (Job 3): what the Ideas card draws, and the two app-only buttons behind it.
// New ideas still land in Ideas (never on a day); the card's one action is "Add to day", which runs move_item as the signed-in user,
// so it has the same warnings, activity entry and Undo as the same request made in chat.
import { matchTrip, onDay, ideasOf, dayDate } from "../view.js";
import { CONTROL } from "../control.js";
import { deepLink } from "./links.js";

export const MAX_CARDS = 40; // everything the card may show (inline shows 8, fullscreen the rest)
const IMAGE_HOST = "upload.wikimedia.org"; // the only photo host in the card CSP (see shell.js)

const tipsOf = (notes) => String(notes || "").split(" · ").filter((p) => /^tip:/i.test(p)).map((p) => p.replace(/^tip:\s*/i, "").trim()).filter(Boolean).slice(0, 3);
const photo = (u) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === IMAGE_HOST ? x.href : ""; } catch { return ""; } };

// One card, shaped for the view. `where` is "ideas" or "day N"; cards already on a day get no Add to day button.
export function ideaCard(trip, it, extra = {}) {
  const d = onDay(trip, it);
  return {
    id: it.id, title: it.title, category: it.category || "sight", location: it.location || "", veg: it.category === "food" ? (it.veg || "unknown") : undefined,
    vegNote: it.vegNote || undefined, tips: tipsOf(it.notes), image: photo(it.image), cost: it.cost || undefined, durationMin: it.durationMin || undefined,
    bestTime: it.bestTime || undefined, mustDo: it.mustDo || undefined, day: d >= 0 ? d + 1 : 0, ...extra,
  };
}

// The card's data: the trip's days (for the day chips), the cards to show, and anything the last action produced (receipt, warnings, Undo).
export async function ideasData({ trip, items, cards, env, extra = {} }) {
  const all = ideasOf(trip, items);
  const list = (cards || all.map((it) => ideaCard(trip, it))).slice(0, MAX_CARDS);
  return {
    tripId: trip.id, trip: trip.name, appUrl: deepLink(env, { trip: trip.id, tab: "ideas" }),
    days: (trip.days || []).map((d, i) => ({ n: i + 1, date: dayDate(trip, i), title: d.title || "" })),
    ideas: list, ideasTotal: all.length, ...extra,
  };
}

const load = async (a, c) => {
  const trip = matchTrip(await c.fs.tripsFor(c.email), a.trip);
  return { trip, items: await c.fs.items(trip.id) };
};

// structure() for the tools that show the card. `result` is the tool's own answer (unchanged text for Gemini and text-only clients).
export const structureIdeas = {
  async list_ideas(_r, a, c, env) {
    const { trip, items } = await load(a, c);
    const q = String(a.query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const cards = ideasOf(trip, items).filter((it) => (!a.category || it.category === a.category) && q.every((w) => [it.title, it.location, it.notes, it.description].join(" ").toLowerCase().includes(w))).map((it) => ideaCard(trip, it));
    return ideasData({ trip, items, cards, env, extra: { heading: a.category ? `Ideas · ${a.category}` : "Ideas" } });
  },
  async search_items(r, a, c, env) {
    const { trip, items } = await load(a, c);
    const ids = new Set((r.items || []).map((x) => x.id));
    const cards = items.filter((it) => ids.has(it.id)).map((it) => ideaCard(trip, it));
    return ideasData({ trip, items, cards, env, extra: { heading: a.query ? `Matches for “${a.query}”` : "Matches" } });
  },
  async save_ideas(r, a, c, env) {
    const { trip, items } = await load(a, c);
    const cards = [];
    for (const res of r.results || []) {
      const it = items.find((x) => (res.id && x.id === res.id) || x.title === (res.saved_as || res.title));
      if (it && !cards.some((k) => k.id === it.id)) cards.push(ideaCard(trip, it, { note: res.status === "saved to ideas" ? "New" : res.status.startsWith("already") ? "Already saved" : undefined }));
    }
    const saved = Number(r.saved) || 0;
    return ideasData({ trip, items, cards, env, extra: {
      heading: saved ? `Saved to Ideas · ${saved}` : "Already in Ideas",
      receipt: { text: saved ? `Added ${saved} to Ideas. Nothing is on a day until you pick one.` : "Nothing new to add." }, undoWith: r.undoWith,
    } });
  },
};

const moveItem = CONTROL.find((t) => t.name === "move_item");

structureIdeas.ideas_add_to_day = async (r, a, c, env) => {
  const { trip, items } = await load(a, c);
  return ideasData({ trip, items, env, extra: { receipt: { text: r.moved === false ? r.why : `Added “${r.moved}” to ${r.to}.`, warnings: r.warnings }, undoWith: r.undoWith } });
};
structureIdeas.ideas_refresh = async (_r, a, c, env) => {
  const { trip, items } = await load(a, c);
  return ideasData({ trip, items, env });
};

// App-only button actions (hidden from the model by hosts that honour _meta.ui.visibility). Their card data comes from structureIdeas above.
export const IDEAS_APP_TOOLS = [
  {
    name: "ideas_add_to_day",
    description: "Put an idea on a day of the trip (same as move_item), then return the refreshed Ideas card.",
    inputSchema: { type: "object", properties: { trip: { type: "string" }, item: { type: "string" }, day: { type: "integer" } }, required: ["item", "day"] },
    run: (a, c) => moveItem.run({ trip: a.trip, item: a.item, day: a.day }, c),
  },
  {
    name: "ideas_refresh",
    description: "Return the current Ideas card for a trip.",
    inputSchema: { type: "object", properties: { trip: { type: "string" } } },
    run: async () => ({ ok: true }),
  },
];
