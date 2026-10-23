// Undo for AI changes. What Gemini or Claude changes for you is applied straight away; this module watches every write
// the change makes (stops added, edited or removed, days, to-dos, bookings), keeps what was there before on the trip
// (trip.undo) and shows a bar on the Plan tab with Undo. One undo at a time: the latest AI change.
let ctx;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const STAMPS = new Set(["updatedBy", "updatedByName", "updatedAt"]);
const TRIP_KEYS = ["days", "checklist", "bookings", "tripNotes"]; // lists of {id,…} that AI changes can touch
const MAX_BYTES = 600000; // the trip doc is capped at 1 MB

// Runs `fn` (which makes the changes) while recording them. `fn` may return { count, warnings: [] }. Returns what `fn` returned.
export async function recordAi({ source, request = "", summary = "" }, fn) {
  const { S } = ctx, store = S.store;
  const rec = { items: {}, created: [], deleted: {}, before: {}, after: {} };
  const orig = {};
  const doc = (id) => S.items.find((i) => i.id === id);
  const note = (id, keys) => {
    if (rec.created.includes(id) || rec.deleted[id]) return;
    const it = doc(id);
    if (!it) return;
    const e = (rec.items[id] ||= { set: {}, del: [] });
    for (const k of keys) {
      if (STAMPS.has(k) || k in e.set || e.del.includes(k)) continue;
      if (it[k] !== undefined) e.set[k] = clone(it[k]);
      else e.del.push(k);
    }
  };
  const tripNote = (before, patch) => {
    for (const k of TRIP_KEYS) {
      if (!patch || !(k in patch)) continue;
      if (!(k in rec.before)) rec.before[k] = clone(before?.[k] || []);
      rec.after[k] = clone(patch[k] || []);
    }
  };
  const wrap = (name, make) => { orig[name] = store[name]; store[name] = make(orig[name]); };
  wrap("addItem", (f) => async (...a) => { const id = await f(...a); if (id) rec.created.push(id); return id; });
  wrap("updateItem", (f) => (t, id, patch) => { note(id, Object.keys(patch || {})); return f(t, id, patch); });
  wrap("batchUpdateItems", (f) => (t, ups) => { for (const [id, patch] of ups) note(id, Object.keys(patch || {})); return f(t, ups); });
  wrap("setItemPath", (f) => (t, id, path, v) => { note(id, [path[0]]); return f(t, id, path, v); });
  wrap("arrayAdd", (f) => (t, id, field, v) => { note(id, [field]); return f(t, id, field, v); });
  wrap("arrayRemove", (f) => (t, id, field, v) => { note(id, [field]); return f(t, id, field, v); });
  wrap("deleteItem", (f) => (t, id) => {
    const i = rec.created.indexOf(id);
    if (i >= 0) rec.created.splice(i, 1); // made and removed within the same change: nothing to bring back
    else if (doc(id) && !rec.deleted[id]) {
      // Put back as it was before this change touched it.
      const d = clone(doc(id)), e = rec.items[id];
      delete d.id;
      if (e) { Object.assign(d, e.set); for (const k of e.del) delete d[k]; }
      rec.deleted[id] = d;
      delete rec.items[id];
    }
    return f(t, id);
  });
  wrap("txTrip", (f) => (id, fn2) => f(id, (cur) => { const patch = fn2(cur); tripNote(cur, patch); return patch; }));
  wrap("updateTrip", (f) => (id, patch) => { tripNote(S.trip, patch); return f(id, patch); });
  let result;
  try {
    result = await fn();
  } finally {
    for (const [k, f] of Object.entries(orig)) store[k] = f;
  }
  // What changed in each list, by id, so Undo leaves other people's later edits alone.
  const trip = {};
  for (const k of Object.keys(rec.before)) {
    const was = rec.before[k], now = rec.after[k];
    const nowIds = new Set(now.map((x) => x.id)), wasBy = new Map(was.map((x) => [x.id, x]));
    const d = {
      added: now.filter((x) => !wasBy.has(x.id)).map((x) => x.id),
      removed: was.filter((x) => !nowIds.has(x.id)),
      changed: now.filter((x) => wasBy.has(x.id) && JSON.stringify(x) !== JSON.stringify(wasBy.get(x.id))).map((x) => wasBy.get(x.id)),
    };
    if (d.added.length || d.removed.length || d.changed.length) trip[k] = d;
  }
  const n = rec.created.length + Object.keys(rec.items).length + Object.keys(rec.deleted).length + Object.keys(trip).length;
  if (!n) return result;
  const undo = clone({
    at: Date.now(), by: S.me.email, byName: S.me.name, source, request: String(request).slice(0, 300), summary: String(summary).slice(0, 500),
    count: result?.count ?? n, warnings: (result?.warnings || []).slice(0, 8).map((w) => String(w).slice(0, 220)),
    created: rec.created, items: rec.items, deleted: rec.deleted, trip,
  });
  const tooBig = JSON.stringify(undo).length > MAX_BYTES;
  await S.store.updateTrip(S.tripId, { undo: tooBig ? { ...undo, created: [], items: {}, deleted: {}, trip: {}, noUndo: true } : undo, ...ctx.stampMe() });
  return result;
}

const lbl = (u) => (ctx.S.aiUser || !/^(Gemini|Claude)$/.test(u.source) ? u.source : "The planner");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
let undoing = false;

// Takes the change back. A transaction on the trip makes sure only one phone does it.
export async function undo() {
  const { S } = ctx, u = S.trip?.undo;
  if (!u || undoing) return;
  if (u.noUndo) return keep();
  undoing = true;
  try {
    let got = false;
    await S.store.txTrip(S.tripId, (cur) => {
      got = !!cur.undo && cur.undo.at === u.at;
      return got ? { undo: null, ...ctx.stampMe() } : null;
    });
    if (!got) return;
    const tripId = S.tripId, store = S.store, me = ctx.stampMe();
    const there = (id) => S.items.some((i) => i.id === id);
    for (const id of u.created || []) if (there(id)) await store.deleteItem(tripId, id).catch(() => {});
    for (const [id, e] of Object.entries(u.items || {})) {
      if (!there(id)) continue;
      await store.updateItem(tripId, id, { ...(e.set || {}), ...me }).catch(() => {});
      for (const k of e.del || []) await store.setItemPath(tripId, id, [k], undefined).catch(() => {});
    }
    for (const [id, d] of Object.entries(u.deleted || {})) if (!there(id)) await store.restoreItem(tripId, id, d).catch(() => {});
    if (Object.keys(u.trip || {}).length) {
      await store.txTrip(tripId, (cur) => {
        const patch = {};
        for (const [k, d] of Object.entries(u.trip)) {
          const gone = new Set(d.added), back = new Map(d.changed.map((x) => [x.id, x]));
          const list = (cur[k] || []).filter((x) => !gone.has(x.id)).map((x) => back.get(x.id) || x);
          for (const r of d.removed) if (!list.some((x) => x.id === r.id)) list.push(r);
          patch[k] = list;
        }
        return { ...patch, ...me };
      });
    }
    await ctx.log(`undid ${u.source}'s changes${u.request ? ": " + u.request.slice(0, 80) : ""}`);
    ctx.toast("Undone.");
  } catch (e) {
    console.warn("undo", e);
    ctx.toast("Couldn't undo that. Check your connection and try again.", 5000);
  } finally {
    undoing = false;
    ctx.render();
  }
}
// Dismisses the bar and keeps the changes.
async function keep() {
  const { S } = ctx, u = S.trip?.undo;
  if (!u) return;
  await S.store.txTrip(S.tripId, (cur) => (cur.undo && cur.undo.at === u.at ? { undo: null, ...ctx.stampMe() } : null));
}

const CSS = `
.undo-bar { margin: 0 0 12px; padding: 11px 14px; border-radius: 14px; background: var(--accent-soft); color: var(--ink); }
.undo-top { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.undo-t { min-width: 0; overflow-wrap: anywhere; }
.undo-act { display: flex; gap: 6px; flex-shrink: 0; }
.undo-warn { margin: 6px 0 0; padding: 7px 10px; border-radius: 10px; font-size: 13px; background: var(--warn-bg); color: var(--warn); }
`;
function bar() {
  const { S, esc } = ctx, u = S.trip?.undo;
  if (!u) return "";
  return `<div class="undo-bar" id="undoBar">
    <div class="undo-top"><div class="undo-t">✨ <b>${esc(lbl(u))}</b> changed ${plural(u.count || 0, "thing")}${u.request ? ` for “${esc(u.request.slice(0, 60))}”` : ""}${u.summary ? `<div class="muted small">${esc(u.summary)}</div>` : ""}${u.noUndo ? `<div class="muted small">That was too big to undo in one tap.</div>` : ""}</div>
    <span class="undo-act">${u.noUndo ? "" : `<button type="button" class="btn-s primary" data-action="aiUndo">Undo</button>`}<button type="button" class="btn-s" data-action="aiKeep">${u.noUndo ? "OK" : "Keep"}</button></span></div>
    ${(u.warnings || []).map((w) => `<div class="undo-warn">⚠️ ${esc(w)}</div>`).join("")}
  </div>`;
}

// A toast with an Undo button in it, for when the change was made from a tab that doesn't show the bar.
export function toastUndo(msg) {
  ctx.toast(msg + " ", 6000);
  const t = document.getElementById("toast");
  const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Undo" });
  b.onclick = () => { t.hidden = true; undo(); };
  t.append(b);
}

export function init(c) {
  ctx = c;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-undo", textContent: CSS }));
  ctx.recordAi = recordAi;
  ctx.undoAi = undo;
  ctx.toastUndo = toastUndo;
  ctx.slot("planTop", bar);
  ctx.action("aiUndo", async (b) => { b.disabled = true; await undo(); });
  ctx.action("aiKeep", async () => { await keep(); ctx.render(); });
}
