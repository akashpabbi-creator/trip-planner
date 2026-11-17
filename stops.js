// Stop sheet and travel sheet (Plan, redesign job 4).
// On the Plan a stop is a quiet row; tapping it opens the stop sheet, which holds every action the old card had
// (reactions, comments, Directions, move, edit, tips and the extras other modules add to a card). Tapping the travel line
// between two stops opens the travel sheet (mode, time, cost, Directions, Stops along the way). A press-and-hold on a stop
// row lets you drag it to a new place in the day. Moves and deletes made here show an Undo bar.
// State: S.sheet = { kind: "stop" | "leg", id }. The sheet is drawn inside the trip view (html()) so it follows every re-render.
// h is a bag of app helpers: { S, esc, ic, card, slot, schedule, dayItems, dayDate, fmtDay, fromMin, dur, money, km, MODES, CATEGORIES, directionsUrl }.

const CSS = `
.stop-row { display: flex; gap: 10px; align-items: center; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; transition: box-shadow .15s, transform .15s; }
.stop-row:focus-visible { outline: 2px solid var(--accent, #2747d4); outline-offset: 2px; }
.stop-row .c-body { flex: 1; min-width: 0; }
.stop-row .c-top { flex-wrap: wrap; }
.stop-row .c-meta { margin-top: 3px; }
.stop-row .c-body { order: 1; }
.stop-row .sr-go { order: 3; flex: none; color: var(--muted); display: grid; place-items: center; width: 24px; }
.stop-row .sr-go .i { width: 18px; height: 18px; }
.stop-row .sr-mark { display: inline-flex; align-items: center; gap: 3px; color: var(--muted); font-size: 12px; }
.stop-row .sr-mark .i { width: 13px; height: 13px; }
.stop.dragging { z-index: 30; transition: none; }
.stop.dragging .stop-row { box-shadow: 0 12px 32px rgba(0,0,0,.28); transform: scale(1.02); }
.stop.drag-shift { transition: transform .15s; }
body.stop-dragging { cursor: grabbing; }
.ssheet-back { position: fixed; inset: 0; z-index: 44; background: rgba(0,0,0,.5); }
.ssheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; max-height: 88vh; display: flex; flex-direction: column; background: var(--panel); color: var(--ink); border-radius: 28px 28px 0 0; padding: 10px 16px calc(16px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 40px rgba(0,0,0,.35); outline: none; animation: ssUp .2s ease; }
@keyframes ssUp { from { transform: translateY(40px); opacity: .6; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ssheet { animation: none; } .stop-row, .stop.drag-shift { transition: none; } }
.ssheet .grab { width: 40px; height: 4px; border-radius: 9px; background: var(--line); margin: 0 auto 8px; flex: none; }
.ss-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; }
.ss-kick { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .02em; text-transform: uppercase; }
.ss-x { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--panel-2); color: var(--ink); display: grid; place-items: center; padding: 0; }
.ss-x .i { width: 20px; height: 20px; }
.ss-body { overflow-y: auto; overscroll-behavior: contain; padding: 4px 0 8px; display: grid; gap: 10px; }
.ss-body .card { margin: 0; box-shadow: none; }
.ss-actions { display: flex; flex-wrap: wrap; gap: 8px; flex: none; padding-top: 10px; border-top: 1px solid var(--line); }
.ss-actions button { min-height: 44px; }
.ss-actions .danger { margin-left: auto; }
.ss-leg h3 { margin: 2px 0 2px; font-size: 18px; }
.ss-leg .ss-mode { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; margin: 6px 0; }
.ss-leg .ss-mode .i { width: 24px; height: 24px; }
.ss-leg dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 6px 0; font-size: 14px; }
.ss-leg dt { color: var(--muted); }
.ss-leg dd { margin: 0; }
.ss-dir { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 99px; background: var(--accent, #2747d4); color: #fff; font-weight: 600; text-decoration: none; }
.stop-undo { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(78px + env(safe-area-inset-bottom)); z-index: 60; display: flex; align-items: center; gap: 12px; max-width: min(92vw, 440px); background: var(--ink); color: var(--bg); padding: 8px 8px 8px 16px; border-radius: 99px; box-shadow: 0 8px 28px rgba(0,0,0,.3); font-size: 14px; }
.stop-undo[hidden] { display: none; }
.stop-undo span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stop-undo button { flex: none; min-height: 40px; padding: 0 16px; border-radius: 99px; border: 0; background: var(--bg); color: var(--ink); font-weight: 700; }
@media (min-width: 880px) {
  .ssheet { left: 50%; right: auto; width: 560px; transform: translateX(-50%); bottom: 24px; border-radius: 28px; max-height: 84vh; animation: none; }
  .stop-undo { bottom: 24px; }
}
`;

let C = null;           // ctx
let bar = null;         // the Undo bar element
let barTimer = 0;
let lastClick = 0;      // time a drag ended: the click that follows it must not open the sheet

const stopOf = (id) => C.S.items.find((i) => i.id === id);

// The stop sheet or travel sheet, or "" when none is open. Clears S.sheet when what it showed is gone.
export function html(h) {
  const S = h.S, sh = S.sheet;
  if (!sh) return "";
  const it = S.items?.find((i) => i.id === sh.id);
  const day = it ? S.trip.days.find((d) => d.id === it.dayId) : null;
  if (!it || (!day && !(sh.idea && sh.kind === "stop")) || (day && sh.idea)) { S.sheet = null; return ""; } // an idea that got a day closes its sheet
  if (!day) { // an idea (no day yet): the full card, with Add to day, Edit, reactions and comments
    return `<div class="ssheet-back" data-action="sheetClose"></div><section class="ssheet" role="dialog" aria-modal="true" aria-label="Idea: ${h.esc(it.title || "Untitled")}" tabindex="-1">
      <div class="grab"></div><div class="ss-head"><span class="ss-kick">Idea</span><button class="ss-x" data-action="sheetClose" aria-label="Close">${h.ic("x")}</button></div>
      <div class="ss-body">${h.card(it, { full: true })}</div>
      <div class="ss-actions">
        <button class="primary" data-action="schedule" data-id="${it.id}">Add to a day</button>
        <button class="danger" data-action="stopDelete" data-id="${it.id}">${h.ic("trash")} Delete</button>
      </div>
    </section>`;
  }
  const di = S.trip.days.indexOf(day);
  const back = `<div class="ssheet-back" data-action="sheetClose"></div>`;
  const head = (kick) => `<div class="grab"></div><div class="ss-head"><span class="ss-kick">${kick}</span><button class="ss-x" data-action="sheetClose" aria-label="Close">${h.ic("x")}</button></div>`;
  const sch = h.schedule(day.id);
  const k = sch.findIndex((s) => s.it.id === it.id);
  if (sh.kind === "leg") {
    const prev = k > 0 ? sch[k - 1].it : null;
    const t = it.travel || {};
    const m = h.MODES[t.mode];
    const from = prev ? prev.title : (t.fromPrevDay ? "yesterday's last stop" : "the previous stop");
    const gmFrom = prev ? (prev.location || prev.title) : "";
    const to = it.location || it.title;
    const gm = `https://www.google.com/maps/dir/?api=1${gmFrom ? "&origin=" + encodeURIComponent(gmFrom) : ""}&destination=${encodeURIComponent(to)}${m?.gm ? "&travelmode=" + m.gm : ""}`;
    const d = prev && h.km && Number.isFinite(prev.lat) && Number.isFinite(it.lat) ? h.km(prev, it) : null;
    return `${back}<section class="ssheet ss-leg" role="dialog" aria-modal="true" aria-label="Getting there" tabindex="-1">
      ${head(`Day ${di + 1} · Getting there`)}
      <div class="ss-body">
        <h3>${h.esc(from)} → ${h.esc(it.title)}</h3>
        ${m ? `<div class="ss-mode">${m.icon} ${h.esc(m.label)}${t.auto ? ` <span class="muted small">· estimated</span>` : ""}</div>` : `<p class="muted">No travel set for this leg yet.</p>`}
        <dl>
          ${t.minutes ? `<dt>Time</dt><dd>${h.dur(+t.minutes)}</dd>` : ""}
          ${Number(t.cost) ? `<dt>Cost</dt><dd>${h.money(t.cost)}</dd>` : ""}
          ${d != null ? `<dt>Distance</dt><dd>about ${d < 10 ? d.toFixed(1) : Math.round(d)} km</dd>` : ""}
          ${t.notes ? `<dt>Notes</dt><dd>${h.esc(t.notes)}</dd>` : ""}
        </dl>
        ${h.slot("leg", it)}
      </div>
      <div class="ss-actions">
        <a class="ss-dir" href="${gm}" target="_blank" rel="noopener">Directions ↗</a>
        <button class="primary" data-action="editLeg" data-id="${it.id}">${m ? "Edit travel" : "Set how we get here"}</button>
      </div>
    </section>`;
  }
  const time = sch[k] ? h.fromMin(sch[k].start) : "";
  const last = k === sch.length - 1 && di === S.trip.days.length - 1, first = k === 0 && di === 0;
  return `${back}<section class="ssheet" role="dialog" aria-modal="true" aria-label="Stop: ${h.esc(it.title || "Untitled")}" tabindex="-1">
    ${head(`Day ${di + 1}${time ? " · " + time : ""}`)}
    <div class="ss-body">${h.card(it, { inDay: true, full: true, time, auto: sch[k]?.auto })}</div>
    <div class="ss-actions">
      <button data-action="schedule" data-id="${it.id}">Move to another day</button>
      <button data-action="backToIdeas" data-id="${it.id}">Back to Ideas</button>
      <button class="danger" data-action="stopDelete" data-id="${it.id}">${h.ic("trash")} Delete</button>
    </div>
  </section>`;
}

// ---- Undo bar -------------------------------------------------------------------------------------------------------
export function undoBar(text, fn) {
  if (!bar) return;
  clearTimeout(barTimer);
  bar.innerHTML = `<span></span><button type="button">Undo</button>`;
  bar.firstChild.textContent = text;
  bar.lastChild.onclick = async () => {
    bar.hidden = true;
    try { await fn(); C.toast("Undone."); } catch (e) { console.error(e); C.toast("Couldn't undo that."); }
  };
  bar.hidden = false;
  barTimer = setTimeout(() => { bar.hidden = true; }, 9000);
}

// Put stops back to the day and order they had.
export const restoreOrder = (before, label) => async () => {
  const { S } = C;
  const ups = before.filter(([id]) => S.items.some((i) => i.id === id)).map(([id, p]) => [id, { ...p, ...C.stampMe() }]);
  if (!ups.length) return;
  await S.store.batchUpdateItems(S.tripId, ups);
  await C.log(`undid: ${label}`);
  await C.touchTrip();
};
// A deleted stop comes back with the same id.
export const restoreDeleted = (doc) => async () => {
  const d = { ...doc };
  const id = d.id;
  delete d.id;
  if (C.S.items.some((i) => i.id === id)) return;
  await C.S.store.restoreItem(C.S.tripId, id, d);
  await C.log(`undid: deleted “${doc.title}”`);
  await C.touchTrip();
};

// ---- Press-and-drag reorder -----------------------------------------------------------------------------------------
let drag = null;
function startDrag(p) {
  const stops = [...document.querySelectorAll(".day .tl > .stop")];
  const me = p.stop;
  const idx = stops.indexOf(me);
  if (idx < 0) return;
  drag = { ...p, stops, idx, to: idx, active: true, rects: stops.map((s) => s.getBoundingClientRect()) };
  me.classList.add("dragging");
  stops.forEach((s) => s !== me && s.classList.add("drag-shift"));
  document.body.classList.add("stop-dragging");
  navigator.vibrate?.(12);
}
function moveDrag(y) {
  const d = drag;
  const dy = y - d.y0;
  d.stop.style.transform = `translateY(${dy}px)`;
  const mid = d.rects[d.idx].top + d.rects[d.idx].height / 2 + dy;
  let to = d.idx;
  d.rects.forEach((r, k) => { if (k < d.idx && mid < r.top + r.height / 2) to = Math.min(to, k); if (k > d.idx && mid > r.top + r.height / 2) to = Math.max(to, k); });
  d.to = to;
  const h = d.rects[d.idx].height + 6;
  d.stops.forEach((s, k) => {
    if (k === d.idx) return;
    s.style.transform = d.to < d.idx && k >= d.to && k < d.idx ? `translateY(${h}px)` : d.to > d.idx && k <= d.to && k > d.idx ? `translateY(${-h}px)` : "";
  });
}
function endDrag(commit) {
  const d = drag;
  drag = null;
  if (!d) return;
  d.stops.forEach((s) => { s.style.transform = ""; s.classList.remove("dragging", "drag-shift"); });
  document.body.classList.remove("stop-dragging");
  lastClick = Date.now();
  if (commit && d.to !== d.idx) reorder(d.stop.closest(".day").dataset.day, d.idx, d.to).catch((e) => { console.error(e); C.toast("Couldn't move it."); });
}
// Move the stop at position `from` to position `to`; the day's existing order numbers are handed out again in the new sequence.
async function reorder(dayId, from, to) {
  const { S } = C;
  const list = C.dayItems(dayId);
  if (!list[from]) return;
  const seq = list.slice();
  const [m] = seq.splice(from, 1);
  seq.splice(to, 0, m);
  const orders = list.map((x) => x.order);
  const ups = [], before = [];
  seq.forEach((x, k) => { if (x.order !== orders[k]) { ups.push([x.id, { order: orders[k], ...C.stampMe() }]); before.push([x.id, { order: x.order }]); } });
  if (!ups.length) return;
  await S.store.batchUpdateItems(S.tripId, ups);
  const label = `moved “${m.title}” to position ${to + 1} on ${C.dayLabel(dayId)}`;
  await C.log(label);
  await C.touchTrip();
  undoBar(`Moved “${m.title}”`, restoreOrder(before, label));
}

// ---- actions --------------------------------------------------------------------------------------------------------
async function backToIdeas(id) {
  const { S } = C;
  const it = stopOf(id);
  if (!it) return;
  const before = [[id, { dayId: it.dayId, order: it.order }]];
  S.sheet = null;
  await S.store.updateItem(S.tripId, id, { dayId: "", order: 0, userEdited: true, ...C.stampMe() });
  await C.log(`moved “${it.title}” back to Ideas`);
  await C.touchTrip();
  C.render();
  undoBar(`“${it.title}” is back in Ideas`, restoreOrder(before, `moved “${it.title}” back to Ideas`));
}
async function stopDelete(id) {
  const { S } = C;
  const it = stopOf(id);
  if (!it) return;
  const doc = JSON.parse(JSON.stringify(it));
  S.sheet = null;
  await S.store.deleteItem(S.tripId, id);
  await C.log(`deleted “${it.title}”`);
  await C.touchTrip();
  C.render();
  undoBar(`Deleted “${it.title}”`, restoreDeleted(doc));
}

export function init(ctx) {
  C = ctx;
  const { S } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-stops", textContent: CSS }));
  bar = Object.assign(document.createElement("div"), { className: "stop-undo", hidden: true });
  bar.setAttribute("role", "status");
  document.body.append(bar);
  ctx.undoBar = undoBar;
  ctx.restoreOrder = restoreOrder;
  ctx.restoreDeleted = restoreDeleted;

  const open = (kind, id) => { const it = S.items.find((i) => i.id === id); S.sheet = { kind, id, idea: !!it && !S.trip.days.some((d) => d.id === it.dayId) }; ctx.render(); document.querySelector(".ssheet")?.focus({ preventScroll: true }); };
  ctx.action("openStop", (btn, id) => { if (Date.now() - lastClick < 350) return; open("stop", id); });
  ctx.action("openLeg", (btn, id) => open("leg", id));
  ctx.action("sheetClose", () => { S.sheet = null; ctx.render(); });
  ctx.action("backToIdeas", (btn, id) => backToIdeas(id));
  ctx.action("stopDelete", (btn, id) => stopDelete(id));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.sheet && !ctx.$modal.open) { S.sheet = null; ctx.render(); return; }
    const row = e.target.closest?.(".stop-row");
    if (row && (e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); open("stop", row.dataset.id); }
  });

  // Press and hold a stop row, then drag it up or down. Touch needs a hold (so scrolling still works); a mouse needs a short hold.
  let pend = null;
  const clear = () => { if (pend) { clearTimeout(pend.timer); pend = null; } };
  document.addEventListener("pointerdown", (e) => {
    clear();
    if (e.button > 0 || S.sheet || ctx.$modal.open) return;
    const row = e.target.closest?.(".day .stop-row");
    if (!row || e.target.closest("a, input, textarea, select")) return;
    const p = { stop: row.closest(".stop"), y0: e.clientY, x0: e.clientX, id: e.pointerId };
    p.timer = setTimeout(() => { pend = null; if (p.stop?.isConnected) startDrag(p); }, e.pointerType === "mouse" ? 260 : 420);
    pend = p;
  });
  document.addEventListener("pointermove", (e) => {
    if (drag) { e.preventDefault(); moveDrag(e.clientY); return; }
    if (pend && (Math.abs(e.clientY - pend.y0) > 9 || Math.abs(e.clientX - pend.x0) > 9)) clear(); // it is a scroll or a swipe, not a hold
  }, { passive: false });
  document.addEventListener("pointerup", () => { clear(); endDrag(true); });
  document.addEventListener("pointercancel", () => { clear(); endDrag(false); });
  document.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", (e) => { if ((drag || pend) && e.target.closest?.(".stop-row")) e.preventDefault(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag) endDrag(false); });
}
