// Shuffle a day: one tap swaps a few stops for places already waiting in Ideas, as a change proposal to review.
// Rule-based and offline (no AI). Same kind of place for same kind of place, loved ideas first, near the day's other stops.
import { km, has } from "./smart.js";
import { proposeChanges, openChanges } from "./changes.js";
import { isVetoed, loveCount, bothLove, sameName } from "./social.js";

const MAX_SWAPS = 3;
const FAR_KM = 25; // an idea this far from the day's other stops isn't offered
const CSS = `
.shf-btn { margin-left: auto; }
`;

const centroid = (list) => {
  const p = list.filter(has);
  return p.length ? { lat: p.reduce((a, x) => a + x.lat, 0) / p.length, lng: p.reduce((a, x) => a + x.lng, 0) / p.length } : null;
};
const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

export function init(ctx) {
  const { S, toast } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-shuffle", textContent: CSS }));
  const last = new Map(); // day id -> key of the last set of swaps proposed, so the next tap gives something different

  // Stops the shuffle may swap out on a day.
  function swappable(dayId) {
    const members = S.trip.members;
    const booked = (S.trip.bookings || []).map((b) => b.title).filter(Boolean);
    return ctx.dayItems(dayId).filter((it) => !it.mustDo && !it.time && !["stay", "transport"].includes(it.category) && !it.rest
      && !bothLove(it, members) && !booked.some((t) => sameName(t, it.title)));
  }
  function candidates() {
    return ctx.ideas().filter((it) => !isVetoed(it) && !it.time && !["stay", "transport"].includes(it.category) && !(it.category === "food" && it.veg === "no"));
  }

  // Picks swaps for a day: [{ out, in }]. `skip` is a key to avoid when another arrangement exists.
  function pick(dayId, skip) {
    const day = ctx.dayItems(dayId);
    const stops = swappable(dayId);
    const ideas = candidates();
    if (!stops.length || !ideas.length) return [];
    const members = S.trip.members;
    let best = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const take = Math.min(MAX_SWAPS, Math.max(1, Math.round(stops.length / 2)));
      const used = new Set(), out = [];
      for (const s of shuffled(stops)) {
        if (out.length >= take) break;
        const others = day.filter((x) => x.id !== s.id);
        const mid = centroid(others);
        const pool = ideas.filter((c) => !used.has(c.id) && (c.category || "other") === (s.category || "other")
          && !(mid && has(c) && km(c, mid) > FAR_KM));
        if (!pool.length) continue;
        // Loved ideas first (both love, then one love), then a random pick among the nearest few.
        const rank = (c) => (bothLove(c, members) ? 0 : loveCount(c) ? 1 : 2);
        const top = Math.min(...pool.map(rank));
        let near = pool.filter((c) => rank(c) === top);
        if (mid) near = near.sort((a, b) => (has(a) ? km(a, mid) : 1e3) - (has(b) ? km(b, mid) : 1e3)).slice(0, 4);
        const c = shuffled(near)[0];
        used.add(c.id);
        out.push({ out: s, in: c, near: !!mid && has(c) });
      }
      if (!out.length) return [];
      const key = out.map((x) => x.out.id + ">" + x.in.id).sort().join(",");
      best = out;
      if (key !== skip) break;
    }
    return best;
  }

  function shuffle(dayId) {
    const n = S.trip.days.findIndex((d) => d.id === dayId) + 1;
    if (n < 1) return;
    const swaps = pick(dayId, last.get(dayId));
    if (!swaps.length) {
      toast(`Nothing in Ideas to swap in for Day ${n}.`, 5000);
      ctx.setChangeDraft?.(`Swap a couple of Day ${n} stops for new places`);
      return;
    }
    last.set(dayId, swaps.map((x) => x.out.id + ">" + x.in.id).sort().join(","));
    const ops = swaps.flatMap((x) => {
      const why = `Same kind of place${x.near ? `, near your other Day ${n} stops` : ""}${loveCount(x.in) ? " and one you liked" : ""}`;
      return [
        { type: "remove", itemId: x.out.id, why: `Makes room on Day ${n} for “${x.in.title}”` },
        { type: "move", itemId: x.in.id, toDay: n, order: x.out.order, why: why + "." },
      ];
    });
    const summary = swaps.map((x) => `“${x.in.title}” instead of “${x.out.title}”`).join(", ");
    return proposeChanges({ source: "Shuffle", request: `Shuffle Day ${n}`, summary: `Day ${n}: ${summary}.`, ops }).then(() => openChanges());
  }

  ctx.slot("dayFoot", (d) => (ctx.dayItems(d.id).length ? `<button class="link shf-btn" data-action="shuffleDay" data-id="${d.id}" title="Swap a few stops for places from Ideas">🔀 Shuffle</button>` : ""));
  ctx.action("shuffleDay", (b, id) => shuffle(id));
}
