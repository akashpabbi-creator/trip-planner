// Your trips: cards with a long-press menu (right-click or the ⋯ button on a computer).
// Rename, Change cover, Invite, Pin to top (per person), Duplicate, Clear all days, then Delete (owner, 8 s Undo) or Leave trip.
let ctx;

const HOLD_MS = 500;
const UNDO_MS = 8000;
const MOVE_PX = 10;
const CSS = `
.trip-wrap { position: relative; min-width: 0; }
.trip-wrap > .trip-card { display: block; width: 100%; height: 100%; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.trip-wrap .tc-pin { margin-left: 6px; font-size: 14px; }
.tc-more { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; border-radius: 50%; border: 0; padding: 0; display: grid; place-items: center; font-size: 22px; line-height: 1; color: #fff; background: rgba(20, 24, 22, 0.5); backdrop-filter: blur(6px); cursor: pointer; }
.tc-more:hover, .tc-more:focus-visible { background: rgba(20, 24, 22, 0.75); }
@media (hover: hover) and (pointer: fine) {
  .tc-more { width: 32px; height: 32px; font-size: 18px; opacity: 0; transition: opacity 0.15s; }
  .trip-wrap:hover .tc-more, .tc-more:focus-visible { opacity: 1; }
}
.hm-list { display: grid; gap: 2px; margin: 4px 0 0; }
.hm-list button { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; padding: 10px 12px; border: 0; border-radius: 14px; background: none; color: var(--ink); font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
.hm-list button:hover, .hm-list button:focus-visible { background: var(--accent-soft); }
.hm-list button.danger { color: var(--bad); }
.hm-list .hm-ic { width: 26px; text-align: center; font-size: 20px; flex: none; }
.hm-sub { margin: 0 0 6px; }
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

export function card(t) {
  const { esc, fmtDay, ago, firstName, coverOf, cssUrl } = ctx;
  const cover = coverOf(t);
  return `<div class="trip-wrap" data-trip="${esc(t.id)}">
    <button class="trip-card" data-action="open" data-id="${esc(t.id)}">
      <div class="tc-img" ${cover ? `style="background-image:url('${cssUrl(cover)}')"` : ""}></div>
      <div class="tc-body">
        <div class="tc-title">${esc(t.name)}${pinned(t) ? `<span class="tc-pin" title="Pinned" aria-label="Pinned">📌</span>` : ""}</div>
        <div class="muted">${esc(t.destination || "")}${t.startDate ? " · " + fmtDay(new Date(t.startDate + "T00:00")) : ""} · ${(t.days || []).length} days</div>
        <div class="muted small">${t.updatedAt ? "Updated " + ago(t.updatedAt) + (t.updatedByName ? " by " + esc(firstName(t.updatedByName)) : "") : ""}</div>
      </div>
    </button>
    <button type="button" class="tc-more" data-action="tripMenu" data-id="${esc(t.id)}" aria-haspopup="dialog" aria-label="More options for ${esc(t.name)}" title="More options">⋯</button>
  </div>`;
}

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
    ["rename", "✏️", "Rename"],
    ["cover", "🖼️", "Change cover"],
    ["invite", "👥", "Invite"],
    ["pin", "📌", pinned(t) ? "Unpin from top" : "Pin to top"],
    ["duplicate", "📄", "Duplicate"],
    ["clear", "🧹", "Clear all days"],
    owner ? ["delete", "🗑️", "Delete trip", true] : ["leave", "🚪", "Leave trip", true],
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
