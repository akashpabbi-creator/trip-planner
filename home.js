// Your trips: cards with a long-press menu (right-click or the ⋯ button on a computer).
// Rename, Change cover, Invite, Pin to top (per person), Duplicate, Clear all days, then Delete (owner, 8 s Undo) or Leave trip.
let ctx;

const HOLD_MS = 500;
const UNDO_MS = 8000;
const MOVE_PX = 10;
const CSS = `
.trip-wrap { position: relative; min-width: 0; }
.trip-wrap > .trip-card { display: block; width: 100%; height: 100%; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.trip-wrap .tc-pin { margin-left: 6px; display: inline-grid; vertical-align: -3px; color: var(--accent); }
.trip-wrap .tc-pin .i { width: 16px; height: 16px; }
.tc-more { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; border-radius: 50%; border: 0; padding: 0; display: grid; place-items: center; color: var(--muted); background: transparent; cursor: pointer; }
.tc-more:hover, .tc-more:focus-visible { background: var(--accent-soft); color: var(--accent-soft-ink); }
.trip-wrap.is-big .tc-more { color: #fff; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(6px); }
.trip-wrap.is-big .tc-more:hover, .trip-wrap.is-big .tc-more:focus-visible { background: rgba(15, 23, 42, 0.8); color: #fff; }
.tc-more .i { width: 22px; height: 22px; }
@media (hover: hover) and (pointer: fine) {
  .tc-more { width: 36px; height: 36px; opacity: 0; transition: opacity 0.15s; }
  .tc-more .i { width: 20px; height: 20px; }
  .trip-wrap:hover .tc-more, .tc-more:focus-visible { opacity: 1; }
}
.hm-list { display: grid; gap: 2px; margin: 4px 0 0; }
.hm-list button { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; padding: 10px 12px; border: 0; border-radius: 14px; background: none; color: var(--ink); font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
.hm-list button:hover, .hm-list button:focus-visible { background: var(--accent-soft); }
.hm-list button.danger { color: var(--bad); }
.hm-list .hm-ic { width: 26px; text-align: center; font-size: 20px; flex: none; }
.hm-sub { margin: 0 0 6px; }
.home-group { margin: 18px 0 0; }
.home-group > h3 { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
details.home-group > summary { cursor: pointer; list-style: none; margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
details.home-group > summary::-webkit-details-marker { display: none; }
details.home-group > summary::after { content: " ▾"; }
details.home-group[open] > summary::after { content: " ▴"; }
.trip-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.trip-cards .trip-card { background: var(--panel); color: var(--ink); border-radius: 20px; box-shadow: var(--shadow); overflow: hidden; text-align: left; padding: 0; }
.trip-cards .trip-card:hover { border-color: transparent; box-shadow: var(--shadow), 0 0 0 2px var(--accent); }
.trip-cards .trip-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tc-title { font-family: var(--display); font-weight: 700; color: var(--ink); }
.tc-status { font-size: 12px; font-weight: 700; color: var(--accent-soft-ink); }
.tc-status.past { color: var(--muted); }
.tc-foot { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tc-foot .avs { display: inline-flex; flex: none; }
.tc-foot .avs .av { width: 24px; height: 24px; font-size: 11px; margin-right: 0; margin-left: -6px; background: var(--accent-soft); color: var(--accent-soft-ink); border: 2px solid var(--panel); }
.tc-foot .avs .av:first-child { margin-left: 0; }
.tc-foot .av + span { margin-left: 0; }
.tc-new { display: inline-block; margin-left: auto; font-size: 11px; font-weight: 700; line-height: 14px; padding: 3px 9px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); white-space: nowrap; }
/* Coming up and pinned trips in the future: a cover card */
.trip-card.big { display: flex; flex-direction: column; }
.trip-card.big .tc-img { position: relative; height: 150px; flex: none; border-radius: 0; background-size: cover; background-position: center; }
.trip-card.big .tc-img::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.28), rgba(0,0,0,0) 45%); pointer-events: none; }
.trip-card.big .tc-status { position: absolute; z-index: 1; top: 12px; left: 12px; background: var(--panel); color: var(--ink); border-radius: 8px; padding: 5px 9px; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.trip-card.big .tc-body { padding: 14px 16px 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; min-width: 0; }
.trip-card.big .tc-title { font-size: 22px; line-height: 25px; margin: 0; }
.trip-card.big .tc-meta { font-size: 13px; color: var(--muted); }
.trip-card.big .tc-foot { margin-top: 8px; }
/* Planning, past and other trips: a quiet row */
.trip-card.row { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; align-items: center; padding: 10px 56px 10px 10px; border-radius: 16px; min-height: 76px; }
.trip-card.row .tc-img { width: 56px; height: 56px; min-height: 0; border-radius: 12px; background-size: cover; background-position: center; }
.trip-card.row .tc-body { padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; min-width: 0; }
.trip-card.row .tc-title { font-size: 15px; font-weight: 600; margin: 0; -webkit-line-clamp: 1; font-family: var(--t-font-body); }
.trip-card.row .tc-meta { font-size: 13px; color: var(--muted); }
.trip-card.row .tc-foot { margin-top: 2px; }
.trip-card.row .tc-foot .avs .av { width: 20px; height: 20px; font-size: 10px; }
.trip-card.row .tc-foot:not(:has(.tc-new)) { display: none; }
.home-fab { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(24px, env(safe-area-inset-bottom)); z-index: 15; height: 56px; padding: 0 22px 0 18px; border-radius: 28px; display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; background: var(--accent); color: var(--accent-ink); border: 0; box-shadow: 0 6px 16px rgba(39, 71, 212, 0.3); }
.home-fab:hover { border: 0; filter: brightness(1.08); }
.home-fab .i { width: 20px; height: 20px; stroke-width: 2.2; }
.home-hint { margin: 16px 0 0; text-align: center; }
.home-hint button { margin-left: 6px; }
`;

const mine = () => ctx.S.me?.email;
const pinned = (t) => (t.pinnedBy || []).includes(mine());
const hidden = new Set(); // trips deleted but still inside their Undo window
let suppressClick = false;

// Pinned trips first, then newest change. Trips waiting out their Undo window are not shown.
export function list(trips) {
  return trips
    .filter((t) => !hidden.has(t.id))
    .sort((a, b) => pinned(b) - pinned(a) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

const DAY = 86400000;
const startOf = (t) => (t.startDate ? new Date(t.startDate + "T00:00:00") : null);
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const nDays = (t) => (t.days || []).length;
const endOf = (t) => { const s = startOf(t); return s ? new Date(s.getTime() + (Math.max(nDays(t), 1) - 1) * DAY) : null; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// "coming" (not ended, soonest first; today's trips included), "planning" (no dates), "past" (ended).
export function groupOf(t) {
  const e = endOf(t);
  if (!e) return "planning";
  return e < todayStart() ? "past" : "coming";
}

export function status(t) {
  const s = startOf(t), e = endOf(t), now = todayStart();
  if (!s) return "No dates yet";
  const toStart = Math.round((s - now) / DAY);
  if (toStart > 0) return toStart === 1 ? "Starts tomorrow" : `In ${plural(toStart, "day")}`;
  if (e >= now) return `Day ${Math.round((now - s) / DAY) + 1} of ${nDays(t)} today`;
  const ago = Math.round((now - e) / DAY);
  return ago < 14 ? `Ended ${ago <= 1 ? "yesterday" : plural(ago, "day") + " ago"}` : ago < 60 ? `Ended ${plural(Math.round(ago / 7), "week")} ago` : `Ended ${plural(Math.round(ago / 30), "month")} ago`;
}

// "New since you looked": per device, when you last left each trip. A change by the other person after that marks the card.
const SEEN = "tp-trip-seen";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN) || "{}") || {}; } catch { return {}; } };
const writeSeen = (m) => { try { localStorage.setItem(SEEN, JSON.stringify(m)); } catch { /* private window: marks reset */ } };
export function markOpened(id) { if (!id) return; const m = readSeen(); m[id] = Date.now(); writeSeen(m); }
// A trip with no record yet starts clean, so nothing is "new" the first time this device sees it.
export function seedOpened(trips) {
  const m = readSeen();
  let dirty = false;
  for (const t of trips || []) if (m[t.id] == null) { m[t.id] = Date.now(); dirty = true; }
  if (dirty) writeSeen(m);
}
export const isNew = (t) => {
  const at = readSeen()[t.id];
  return at != null && !!t.updatedBy && t.updatedBy !== mine() && (t.updatedAt || 0) > at;
};

export function card(t, big) {
  const { esc, fmtDay, ago, firstName, coverOf, cssUrl } = ctx;
  const cover = coverOf(t);
  const days = plural(nDays(t), "day");
  const when = t.startDate ? fmtDay(new Date(t.startDate + "T00:00")) : "";
  const meta = [t.destination, when, days].filter(Boolean).join(" · ");
  const pill = `<span class="tc-status ${groupOf(t) === "past" ? "past" : ""}">${esc(status(t))}</span>`;
  const title = `<div class="tc-title">${esc(t.name)}${pinned(t) ? `<span class="tc-pin" title="Pinned" aria-label="Pinned"><svg class=i aria-hidden=true><use href=icons.svg#pushpin /></svg></span>` : ""}</div>`;
  const foot = `<div class="tc-foot"><span class="avs">${(t.members || []).slice(0, 4).map((m) => `<span class="av" title="${esc(t.memberNames?.[m] || m)}">${esc(firstName(t.memberNames?.[m] || m).slice(0, 1).toUpperCase())}</span>`).join("")}</span><span class="muted small">${t.updatedAt ? "Updated " + ago(t.updatedAt) : ""}</span>${isNew(t) ? `<span class="tc-new">New from ${esc(firstName(t.memberNames?.[t.updatedBy] || t.updatedBy))}</span>` : ""}</div>`;
  const img = `<div class="tc-img" ${cover ? `style="background-image:url('${cssUrl(cover)}')"` : ""}>${big ? pill : ""}</div>`;
  const body = big
    ? `<div class="tc-body">${title}<div class="tc-meta">${esc(meta)}</div>${foot}</div>`
    : `<div class="tc-body">${title}<div class="tc-meta">${pill} · ${esc(meta)}</div>${foot}</div>`;
  return `<div class="trip-wrap ${big ? "is-big" : ""}" data-trip="${esc(t.id)}">
    <button class="trip-card ${big ? "big" : "row"}" data-action="open" data-id="${esc(t.id)}">${img}${body}</button>
    <button type="button" class="tc-more" data-action="tripMenu" data-id="${esc(t.id)}" aria-haspopup="dialog" aria-label="More options for ${esc(t.name)}" title="More options"><svg class=i aria-hidden=true><use href=icons.svg#more /></svg></button>
  </div>`;
}

// The whole list: pinned first, then Coming up (soonest first), Planning, and Past (folded, newest first).
export function view(trips) {
  const all = list(trips);
  const pins = all.filter(pinned);
  const rest = all.filter((t) => !pinned(t));
  const by = (g) => rest.filter((t) => groupOf(t) === g);
  const cards = (a) => `<div class="trip-cards">${a.map((t) => card(t, groupOf(t) === "coming")).join("")}</div>`;
  const sec = (title, a) => (a.length ? `<section class="home-group" data-group="${title}"><h3>${title}</h3>${cards(a)}</section>` : "");
  const past = by("past").sort((a, b) => endOf(b) - endOf(a));
  const coming = by("coming").sort((a, b) => startOf(a) - startOf(b));
  const hint = all.length && !hintSeen() ? `<p class="muted small home-hint" data-home-hint>Tip: press and hold a trip for more options <button type="button" class="link" data-action="hideHomeHint">Got it</button></p>` : "";
  return sec("Pinned", pins) + sec("Coming up", coming) + sec("Planning", by("planning"))
    + (past.length ? `<details class="home-group" data-group="Past"><summary>Past (${past.length})</summary>${cards(past)}</details>` : "") + hint;
}

const hintSeen = () => { try { return localStorage.getItem("tp-homeHint") === "1"; } catch { return false; } };

const tripById = (id) => ctx.S.trips.find((t) => t.id === id);
const writeLog = (id, text) => ctx.S.store.log(id, { at: Date.now(), by: ctx.S.me.email, byName: ctx.S.me.name, text });

// The currently listed items of a trip we have not opened (Duplicate reads them once).
function itemsOf(id) {
  return new Promise((res, rej) => {
    let un, done = false;
    const t = setTimeout(() => { if (!done) { done = true; un?.(); rej(new Error("timeout")); } }, 8000);
    un = ctx.S.store.watchItems(id, (items) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      res(items);
      queueMicrotask(() => un?.());
    });
  });
}

// Opens a trip and waits until its data is in, for the options that work on the trip screen (Invite, Clear all days).
async function enter(id, withItems) {
  const { S } = ctx;
  ctx.openTrip(id);
  await ctx.waitFor(() => S.tripId === id && S.trip?.id === id, 6000);
  if (S.trip?.id !== id) return false;
  if (withItems) await ctx.waitFor(() => S.items.length > 0, 1500);
  return true;
}

function rename(t) {
  const { esc, S, toast } = ctx;
  ctx.openModal(`<h3>Rename trip</h3>
    <label>Trip name<input name="name" required value="${esc(t.name || "")}"></label>
    <label>Destination<input name="destination" value="${esc(t.destination || "")}" placeholder="e.g. Bali, Indonesia"></label>`,
    async (f) => {
      const name = f.name.trim(), destination = f.destination.trim();
      if (!name) return toast("Give it a name"), false;
      const patch = {};
      if (name !== (t.name || "")) patch.name = name;
      if (destination !== (t.destination || "")) patch.destination = destination;
      if (!Object.keys(patch).length) return;
      await S.store.updateTrip(t.id, { ...patch, ...ctx.stampMe() });
      await writeLog(t.id, `renamed the trip to “${name}${destination ? " · " + destination : ""}”`);
    });
}

function changeCover(t) {
  const { esc, S, toast } = ctx;
  const covers = ctx.coversOf(t);
  const cur = ctx.safeUrl(t.coverUrl) ? "" : ctx.coverOf(t);
  ctx.openModal(`<h3>Choose a cover</h3>
    ${covers.length ? `<div class="cover-grid">${covers.map((u, i) => `<button type="button" class="cover-opt ${u === cur ? "on" : ""}" data-hm-cover="${i}" aria-label="Use cover ${i + 1}" aria-pressed="${u === cur}"><img src="${esc(ctx.coverSrc(u))}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join("")}</div>`
      : `<p class="muted small">No photos found for this place. Paste a photo link instead.</p>`}
    <label>Use a photo link<input name="coverUrl" type="url" inputmode="url" placeholder="https://…/photo.jpg" value="${esc(ctx.safeUrl(t.coverUrl))}"></label>`,
    async (f) => {
      const u = (f.coverUrl || "").trim();
      if (u === (t.coverUrl || "")) return;
      if (u && !/^https:\/\//i.test(u)) return toast("Use an https:// photo link."), false;
      await S.store.updateTrip(t.id, { coverUrl: u, ...ctx.stampMe() });
      await writeLog(t.id, u ? "changed the cover photo" : "removed the cover photo link");
    });
  ctx.$form.querySelectorAll("[data-hm-cover]").forEach((b) => (b.onclick = async () => {
    ctx.$modal.close();
    const i = Number(b.dataset.hmCover) || 0;
    await S.store.updateTrip(t.id, { coverPick: covers[i] || "", coverIdx: i, coverUrl: "", ...ctx.stampMe() });
    await writeLog(t.id, "changed the cover photo");
  }));
}

async function togglePin(t) {
  const me = mine(), on = pinned(t);
  await ctx.S.store.txTrip(t.id, (cur) => {
    const set = new Set(cur.pinnedBy || []);
    on ? set.delete(me) : set.add(me);
    return { pinnedBy: [...set] };
  });
  ctx.toast(on ? "Unpinned." : "Pinned to the top of your trips.");
}

async function duplicate(t) {
  const { S, toast } = ctx;
  toast("Copying…", 8000);
  const items = await itemsOf(t.id);
  const me = S.me, now = Date.now();
  const copy = { ...t };
  for (const k of ["id", "join", "bridge", "undo", "lastJoin", "pinnedBy", "ai"]) delete copy[k];
  Object.assign(copy, {
    name: `${t.name} (copy)`,
    owner: me.email,
    members: [me.email],
    memberNames: { [me.email]: me.name },
    createdAt: now,
    ...ctx.stampMe(),
  });
  const id = await S.store.createTrip(copy);
  for (const it of items) {
    const d = { ...it };
    delete d.id;
    await S.store.addItem(id, d);
  }
  await writeLog(id, `copied the trip “${t.name}”`);
  toast(`Copied as “${copy.name}”.`);
}

async function clearDays(t) {
  if (!(await enter(t.id, true))) return;
  await ctx.clearAllDays();
}

async function inviteFrom(t) {
  if (!(await enter(t.id))) return;
  ctx.invite();
}

function removeTrip(t) {
  const { S, toast } = ctx;
  const id = t.id;
  const tok = S.aiUser ? S.priv?.bridges?.[id]?.token || "" : "";
  hidden.add(id);
  ctx.render();
  let undone = false;
  toast(`“${t.name}” deleted. `, UNDO_MS);
  const bar = document.getElementById("toast");
  const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Undo" });
  b.onclick = () => {
    undone = true;
    clearTimeout(timer);
    hidden.delete(id);
    bar.hidden = true;
    ctx.render();
  };
  bar.append(b);
  const timer = setTimeout(async () => {
    if (undone) return;
    try {
      await S.store.deleteTrip(id, tok);
      if (tok) await S.store.updatePrivate(S.me.email, { bridges: { [id]: null } }).catch(() => {});
    } catch (err) {
      console.error(err);
      hidden.delete(id);
      ctx.render();
      return toast(ctx.friendlyError(err).text);
    }
    hidden.delete(id); // the snapshot has dropped it by now
  }, UNDO_MS);
}

async function leave(t) {
  const { S, toast } = ctx;
  if (!confirm(`Leave “${t.name}”? You'll need a new invite to come back.`)) return;
  const me = S.me.email;
  await writeLog(t.id, "left the trip");
  await S.store.txTrip(t.id, (cur) => ({ members: (cur.members || []).filter((m) => m !== me) }));
  toast("You left the trip.");
}

let menuFor = null;
function openMenu(id) {
  const { S, esc, $form, $modal } = ctx;
  const t = tripById(id);
  if (!t || !S.me) return;
  if (menuFor === id && $modal.open) return; // long-press and the browser's context menu can both fire
  menuFor = id;
  const owner = t.owner === S.me.email;
  const items = [
    ["rename", "<svg class=i aria-hidden=true><use href=icons.svg#edit /></svg>", "Rename"],
    ["cover", "<svg class=i aria-hidden=true><use href=icons.svg#image /></svg>", "Change cover"],
    ["invite", "<svg class=i aria-hidden=true><use href=icons.svg#people /></svg>", "Invite"],
    ["pin", "<svg class=i aria-hidden=true><use href=icons.svg#pushpin /></svg>", pinned(t) ? "Unpin from top" : "Pin to top"],
    ...(S.creator === true ? [["duplicate", "<svg class=i aria-hidden=true><use href=icons.svg#note /></svg>", "Duplicate"]] : []),
    ["clear", "<svg class=i aria-hidden=true><use href=icons.svg#broom /></svg>", "Clear all days"],
    owner ? ["delete", "<svg class=i aria-hidden=true><use href=icons.svg#trash /></svg>", "Delete trip", true] : ["leave", "<svg class=i aria-hidden=true><use href=icons.svg#door /></svg>", "Leave trip", true],
  ];
  $form.onsubmit = (e) => e.preventDefault();
  $form.innerHTML = `<h3>${esc(t.name)}</h3>
    ${t.destination ? `<p class="muted small hm-sub">${esc(t.destination)}</p>` : ""}
    <div class="hm-list" role="menu">${items.map(([k, ic, label, bad]) => `<button type="button" role="menuitem" data-hm="${k}" class="${bad ? "danger" : ""}"><span class="hm-ic" aria-hidden="true">${ic}</span>${label}</button>`).join("")}</div>
    <div class="m-actions"><button type="button" data-close>Close</button></div>`;
  $form.querySelector("[data-close]").onclick = () => $modal.close();
  const run = { rename, cover: changeCover, invite: inviteFrom, pin: togglePin, duplicate, clear: clearDays, delete: removeTrip, leave };
  $form.querySelectorAll("[data-hm]").forEach((b) => (b.onclick = async () => {
    $modal.close();
    try {
      await run[b.dataset.hm](tripById(id) || t);
    } catch (err) {
      console.error(err);
      ctx.toast(ctx.friendlyError(err).text);
    }
  }));
  $modal.addEventListener("close", () => { menuFor = null; }, { once: true });
  $modal.showModal();
  $form.querySelector("[data-hm]")?.focus();
}

export function init(c) {
  ctx = c;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-home", textContent: CSS }));
  ctx.action("tripMenu", (b) => openMenu(b.dataset.id));
  ctx.action("hideHomeHint", () => {
    try { localStorage.setItem("tp-homeHint", "1"); } catch {}
    document.querySelector("[data-home-hint]")?.remove();
  });

  // Long press: hold a card for half a second (a small buzz), unless the finger moves, which is scrolling.
  let hold = null;
  const cancel = () => { clearTimeout(hold?.timer); hold = null; };
  document.addEventListener("pointerdown", (e) => {
    const w = e.target.closest?.(".trip-wrap");
    if (!w || e.target.closest(".tc-more") || (e.pointerType === "mouse" && e.button !== 0)) return;
    cancel();
    hold = {
      x: e.clientX, y: e.clientY,
      timer: setTimeout(() => {
        hold = null;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 700);
        try { navigator.vibrate?.(15); } catch {}
        openMenu(w.dataset.trip);
      }, HOLD_MS),
    };
  });
  document.addEventListener("pointermove", (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_PX) cancel();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(ev, cancel, true);
  // The release after a long press must not also open the trip.
  document.addEventListener("click", (e) => {
    if (suppressClick && e.target.closest?.(".trip-wrap")) { e.preventDefault(); e.stopPropagation(); }
    suppressClick = false;
  }, true);
  // Right-click on a computer, the menu key, and Android's own long-press event.
  document.addEventListener("contextmenu", (e) => {
    const w = e.target.closest?.(".trip-wrap");
    if (!w) return;
    e.preventDefault();
    openMenu(w.dataset.trip);
  });
}
