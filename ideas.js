// Ideas screen and the + add sheet (redesign job 6).
// Ideas: a quiet card per idea (photo, name, where it came from, tips and veg badges, one "Add to day" button; tapping the card opens
// its sheet), a "Book ahead" list with real dates, "New" marks for what the other person added since you last looked, and Top picks
// (moved here from Discover). The + sheet puts the link field first, reads the clipboard when it opens, then offers the other ways to add.
// html(h) gets { S, esc, ic, who, CATEGORIES, vegTag, safeUrl, sourceOf, suggestedFrom, dayDate, fmtDay, list, shown, bar, stats, dupBar, topPicks, dest }.

const CSS = `
.ideas { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
.ideas-head h2 { margin: 0; font-family: var(--t-font-head, inherit); font-size: 24px; line-height: 1.15; }
.ideas-head p { margin: 2px 0 0; }
.ideas .stats { margin: 0; }
.ideas .idea-find input { border-radius: 99px; min-height: 44px; }
.ideas .idea-sort { min-height: 44px; }
.ideas .idea-chips .chip { min-height: 44px; border-radius: 99px; font-weight: 600; }
.ideas-note { margin: 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
.icards { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .icards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.icard { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--panel); border-radius: 16px; box-shadow: var(--shadow); min-width: 0; }
.icard.flash { animation: flash 1.2s; }
.ic-open { flex: 1; min-width: 0; overflow: hidden; white-space: normal; display: flex; align-items: flex-start; gap: 12px; padding: 0; border: 0; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; border-radius: 12px; }
.ic-open:focus-visible, .ic-add:focus-visible, .tp-toggle:focus-visible, .bkh > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ic-thumb { position: relative; width: 72px; height: 72px; flex: none; border-radius: 12px; overflow: hidden; background: var(--panel-2); color: var(--muted); }
.ic-thumb img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; }
.ic-ph { position: absolute; inset: 0; display: grid; place-items: center; font-size: 24px; }
.ic-ph .i { width: 28px; height: 28px; }
.ic-main { min-width: 0; flex: 1; display: block; }
.ic-title { font-size: 15px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
.ic-meta { margin-top: 2px; font-size: 12px; color: var(--muted); line-height: 16px; overflow-wrap: anywhere; }
.ic-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ic-tag { font-size: 11px; font-weight: 600; line-height: 14px; padding: 3px 7px; border-radius: 6px; background: var(--panel-2); color: var(--muted); max-width: 100%; overflow-wrap: anywhere; }
.ic-tag.act { background: var(--accent-soft); color: var(--accent); }
.ic-tag.love { background: var(--accent-soft); color: var(--accent); }
.ic-tags .tag { font-size: 11px; line-height: 14px; padding: 3px 7px; border-radius: 6px; }
.ic-new { display: inline-block; vertical-align: 2px; margin-left: 6px; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; background: var(--accent); color: var(--accent-ink, #fff); }
.ic-add { flex: none; align-self: center; min-height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.ic-add:hover { filter: brightness(.97); }
.ideas-empty { display: grid; justify-items: center; gap: 10px; text-align: center; padding: 28px 16px; background: var(--panel); border-radius: 16px; }
.ideas-empty .es-ic { width: 48px; height: 48px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.ideas-empty .es-ic .i { width: 24px; height: 24px; }
.ideas-empty p { margin: 0; max-width: 34ch; }
.bkh { background: var(--panel); border-radius: 16px; box-shadow: var(--shadow); }
.bkh > summary { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 14px; cursor: pointer; list-style: none; font-size: 14px; font-weight: 600; border-radius: 16px; }
.bkh > summary::-webkit-details-marker { display: none; }
.bkh > summary .bk-n { display: grid; gap: 1px; min-width: 0; }
.bkh > summary .bk-n small { font-size: 12px; font-weight: 500; color: var(--muted); }
.bkh > summary .bk-go { margin-left: auto; flex: none; color: var(--muted); transition: transform .15s; }
.bkh[open] > summary .bk-go { transform: rotate(180deg); }
.bkh > summary .i { width: 20px; height: 20px; color: var(--accent); flex: none; }
.bkh.soon > summary .i { color: #9a3412; }
.bkh ul { list-style: none; margin: 0; padding: 0 6px 8px; display: grid; }
.bkh li button { width: 100%; min-height: 52px; padding: 8px 8px; border: 0; background: none; color: inherit; font: inherit; text-align: left; display: flex; align-items: center; gap: 10px; border-radius: 12px; cursor: pointer; }
.bkh li button:hover { background: var(--panel-2); }
.bkh .bk-t { flex: 1; min-width: 0; display: grid; gap: 1px; }
.bkh .bk-t b { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.bkh .bk-t small { font-size: 12px; color: var(--muted); }
.bkh .bk-by { flex: none; font-size: 12px; font-weight: 700; padding: 4px 9px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); white-space: nowrap; }
.bkh .bk-by.late { background: #fdebdd; color: #7c2d12; border: 1px solid #f0b48a; }
.bkh .bk-by.none { background: var(--panel-2); color: var(--muted); font-weight: 600; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bkh .bk-by.late { background: #3a2417; color: #f6c9a3; border-color: #7a4a2a; } :root:not([data-theme="light"]) .bkh.soon > summary .i { color: #f0b48a; } }
:root[data-theme="dark"] .bkh .bk-by.late { background: #3a2417; color: #f6c9a3; border-color: #7a4a2a; }
:root[data-theme="dark"] .bkh.soon > summary .i { color: #f0b48a; }
.tp-sec { margin-top: 4px; }
.tp-toggle { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 0; border-radius: 99px; background: var(--panel); color: var(--ink); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: var(--shadow); }
.tp-toggle .i { width: 18px; height: 18px; color: var(--accent); }
.tp-toggle .chev { transition: transform .15s; margin-left: 2px; color: var(--muted); }
.tp-toggle[aria-expanded="true"] .chev { transform: rotate(180deg); }
.tp-body { margin-top: 12px; }
.tp-body .chips { margin-top: 0; }
@media (prefers-reduced-motion: reduce) { .tp-toggle .chev, .icard.flash { transition: none; animation: none; } }

/* the + sheet: link field first */
.as-link { display: grid; gap: 8px; }
.as-clip { display: none; align-items: center; gap: 8px; min-height: 44px; padding: 6px 12px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 600; }
.as-clip.on { display: flex; }
.as-clip .i { width: 18px; height: 18px; flex: none; }
.as-clip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (min-width: 1100px) { .as-clip { display: none !important; } }
`;

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b || a + "s"}`;
const DAY = 86400000;

/* ---------------------------------------------------------------- tips and dates */
// "Book 3 days ahead" or "Book 3 days in advance" anywhere in a note: how many days before the visit.
export function bookDays(text) {
  const m = String(text || "").match(/\bbook(?:ing)?\b[^.·;]{0,24}?(\d{1,3})\s*days?\s*(?:ahead|in advance|before|prior)/i);
  const n = m ? +m[1] : 0;
  return n >= 1 && n <= 365 ? n : 0;
}
// Tip chips for a card: the note's parts ("Book 3 days ahead · Closed Mondays · Best at evening"), at most two, short.
export function tipTags(it, max = 2) {
  const parts = String(it.notes || "").split(/\s+·\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const act = /\b(book|reserv|ticket|closed|cash|early|before|queue|advance|only)\b/i;
  const ranked = [...parts.filter((p) => act.test(p)), ...parts.filter((p) => !act.test(p))].slice(0, max);
  return ranked.map((p) => ({ text: p.length > 38 ? p.slice(0, 37).trimEnd() + "…" : p, full: p, act: act.test(p) }));
}
// Places that say "book N days ahead" with the real date to book by when the place is on a day of a dated trip.
// Sorted: soonest date first, then the ones that wait for a day. `today` is a Date (start of the day).
export function deadlines(h, today) {
  today = today || new Date();
  const { S } = h;
  const t = S.trip;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const out = [];
  for (const it of S.items) {
    const n = bookDays(it.notes) || bookDays(it.description);
    if (!n || it.rest) continue;
    const di = t.days.findIndex((d) => d.id === it.dayId);
    const visit = di >= 0 ? h.dayDate(di) : null;
    const by = visit ? new Date(visit.getFullYear(), visit.getMonth(), visit.getDate() - n) : null;
    out.push({ it, n, di, visit, by, late: !!by && by.getTime() < t0, left: by ? Math.round((by.getTime() - t0) / DAY) : null });
  }
  return out.sort((a, b) => (a.by ? a.by.getTime() : Infinity) - (b.by ? b.by.getTime() : Infinity) || a.it.title.localeCompare(b.it.title));
}

/* ----------------------------------------------------------------- "new since you looked" */
// Per device and trip: when you last left the Ideas tab. What the other person added after that carries a New mark.
const KEY = "tp-ideas-seen";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const write = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private window: marks just reset */ } };
let base = null;      // { trip, at } while the Ideas tab is open
let inIdeas = false;
// Start of a trip's marks: a trip with no record yet starts clean (nothing is "new" the first time).
export function seed(tripId) {
  const m = read();
  if (tripId && m[tripId] == null) { m[tripId] = Date.now(); write(m); }
}
// Called after every render with whether the Ideas tab is showing.
export function visit(tripId, onIdeas) {
  if (onIdeas && tripId) {
    if (!inIdeas || base?.trip !== tripId) { inIdeas = true; base = { trip: tripId, at: read()[tripId] ?? Date.now() }; }
  } else if (inIdeas) {
    inIdeas = false;
    if (base?.trip) { const m = read(); m[base.trip] = Date.now(); write(m); }
    base = null;
  }
}
// The ideas the other person added since this device last left the Ideas tab.
export function newOnes(h, list) {
  const at = base?.trip === h.S.tripId ? base.at : read()[h.S.tripId];
  if (at == null) return [];
  return list.filter((i) => (i.addedAt || 0) > at && i.addedBy !== h.S.me?.email);
}

/* ---------------------------------------------------------------- the card */
function origin(h, it) {
  const sug = h.suggestedFrom(it);
  if (sug) return `suggested by ${sug}`;
  const me = it.addedBy === h.S.me?.email;
  const nm = me ? "your" : `${cap(h.firstName(h.who(it.addedBy)))}'s`;
  const src = h.sourceOf(it.url || "");
  const kind = { instagram: "Instagram post", facebook: "Facebook post", youtube: "video", tiktok: "TikTok", maps: "Maps pin" }[src]
    || (it.via === "screenshot" ? "screenshot" : it.via === "Claude" || it.via === "Gemini" ? "" : it.url ? "link" : "note");
  return kind ? `from ${nm} ${kind}` : `added by ${me ? "you" : cap(h.firstName(h.who(it.addedBy)))}`;
}
export function ideaCard(h, it, isNew) {
  const { esc } = h;
  const cat = h.CATEGORIES[it.category] || h.CATEGORIES.other;
  const img = h.safeUrl(it.image);
  const place = String(it.location || "").split(",")[0].trim();
  const members = h.S.trip.members;
  const loved = members.filter((m) => it.votes?.[m] === "love");
  const noVote = members.some((m) => it.votes?.[m] === "no");
  const loveTag = loved.length >= 2 && loved.length === members.length ? "Both love it"
    : loved.length ? `${loved.includes(h.S.me?.email) && loved.length === 1 ? "You love" : cap(h.firstName(h.who(loved[0]))) + " loves"} this` : "";
  const tags = [
    ...tipTags(it).map((x) => `<span class="ic-tag ${x.act ? "act" : ""}" title="${esc(x.full)}">${esc(x.text)}</span>`),
    it.mustDo ? `<span class="ic-tag act">Must-do</span>` : "",
    it.category === "food" ? h.vegTag(it.veg, it.vegNote, true) : "",
    loveTag ? `<span class="ic-tag love">${esc(loveTag)}</span>` : "",
    noVote ? `<span class="ic-tag">Not for us</span>` : "",
  ].filter(Boolean).join("");
  return `<article class="icard ${h.S.flash?.has(it.id) ? "flash" : ""}" data-id="${esc(it.id)}">
    <button type="button" class="ic-open" data-action="openStop" data-id="${esc(it.id)}" aria-label="Open ${esc(it.title || "idea")}">
      <span class="ic-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<span class="ic-ph">${cat.icon}</span></span>
      <span class="ic-main">
        <span class="ic-title">${esc(it.title || "Untitled")}${isNew ? `<span class="ic-new">New</span>` : ""}</span>
        <span class="ic-meta" style="display:block">${esc([cat.label, place, origin(h, it)].filter(Boolean).join(" · "))}</span>
        ${tags ? `<span class="ic-tags">${tags}</span>` : ""}
      </span>
    </button>
    <button type="button" class="ic-add" data-action="schedule" data-id="${esc(it.id)}">Add to day</button>
  </article>`;
}

/* --------------------------------------------------------------- Book ahead */
export function bookAheadHtml(h) {
  const { esc, ic } = h;
  const list = deadlines(h, h.now?.());
  if (!list.length) return "";
  const dated = list.filter((x) => x.by);
  const late = dated.filter((x) => x.late).length;
  const next = dated.find((x) => !x.late);
  const sum = late ? `${plural(late, "date")} passed` : next ? `next: ${h.fmtDay(next.by)}` : "dates appear once they are on a day";
  const soon = !!late || (next && next.left <= 3);
  return `<details class="bkh ${soon ? "soon" : ""}" id="book-ahead" ${S_OPEN.has(h.S.tripId) ? "open" : ""} data-bkh>
    <summary>${ic("ticket")}<span class="bk-n"><span>Book ahead</span><small>${esc(plural(list.length, "place"))} · ${esc(sum)}</small></span>${ic("arrow-down", "bk-go")}</summary>
    <ul>${list.map((x) => `<li><button type="button" data-action="openStop" data-id="${esc(x.it.id)}">
      <span class="bk-t"><b>${esc(x.it.title)}</b><small>${esc(x.n === 1 ? "Book a day ahead" : `Book ${x.n} days ahead`)}${x.visit ? ` · visit ${esc(h.fmtDay(x.visit))}` : " · not on a day yet"}</small></span>
      ${x.by ? `<span class="bk-by ${x.late ? "late" : ""}">${x.late ? "Was due " : "Book by "}${esc(h.fmtDay(x.by))}</span>` : `<span class="bk-by none">Needs a day</span>`}
    </button></li>`).join("")}</ul>
  </details>`;
}
const S_OPEN = new Set(); // trips whose Book ahead list is open (kept across re-renders)

/* ------------------------------------------------------------------- the screen */
export function html(h) {
  const { S, esc, ic } = h;
  const t = S.trip;
  const waiting = h.list.length;
  const fresh = new Set(newOnes(h, h.list).map((i) => i.id));
  const first = h.shown.filter((i) => fresh.has(i.id));
  const rest = h.shown.filter((i) => !fresh.has(i.id));
  const cards = [...first, ...rest].map((it) => ideaCard(h, it, fresh.has(it.id))).join("");
  const sub = [t.destination, waiting ? `${waiting} waiting for a day` : "nothing waiting", fresh.size ? `${fresh.size} new` : ""].filter(Boolean).join(" · ");
  const empty = waiting
    ? `<p class="ideas-note">Nothing matches that filter yet.</p>`
    : `<div class="ideas-empty"><span class="es-ic">${ic("ideas")}</span><p><b>No ideas waiting</b></p><p class="muted small">Paste a link, add a screenshot or note, or share one to this app from your phone.${/iP(hone|ad|od)/.test(navigator.userAgent) ? " On iPhone, copy it and paste it in the + sheet." : ""}</p><button class="primary" data-action="addOpen">${ic("plus")} Add an idea</button></div>`;
  const tp = h.dest ? `<section class="tp-sec" id="top-picks">
      <button type="button" class="tp-toggle" data-action="picksToggle" aria-expanded="${!!S.picksOpen}" aria-controls="tp-body">${ic("sparkle")}<span>Top picks for ${esc(h.dest)}</span>${ic("arrow-down", "chev")}</button>
      ${S.picksOpen ? `<div class="tp-body" id="tp-body">${h.topPicks()}</div>` : ""}
    </section>` : "";
  return `<div class="ideas">
    <div class="ideas-head"><h2>Ideas</h2><p class="muted small">${esc(sub)}</p></div>
    ${h.stats ? `<div class="stats">${h.stats}</div>` : ""}
    ${h.dupBar}
    ${h.bar}
    ${waiting ? `<p class="ideas-note">Links, screenshots and notes you both share land here. Move them to a day when you are ready.</p>` : ""}
    ${bookAheadHtml(h)}
    ${cards ? `<div class="icards">${cards}</div>` : empty}
    ${tp}
  </div>`;
}

/* ------------------------------------------------------------------ the + sheet */
// Reads the clipboard once the sheet is open. A link on it fills the field and shows a hint; the keyboard only opens when
// there is no link to use. Nothing is saved until Save is tapped.
export async function onAddOpen(C) {
  const box = document.getElementById("linkInput");
  if (!box || !C.S.addOpen) return;
  if (box.value) return;
  let url = "";
  try { url = C.extractUrl(await navigator.clipboard.readText()) || ""; } catch { /* no permission or no clipboard: just focus the field */ }
  const box2 = document.getElementById("linkInput");
  if (!box2 || !C.S.addOpen) return;
  if (url && !box2.value) {
    box2.value = url;
    document.querySelector(".as-clip")?.classList.add("on");
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
    const sp = document.querySelector(".as-clip span");
    if (sp) sp.textContent = `Link from your clipboard: ${host}`;
    box2.closest(".add-link")?.querySelector("[data-action=addLink]")?.removeAttribute("hidden");
    box2.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (matchMedia("(max-width: 1099px)").matches) box2.focus({ preventScroll: true });
}

export function init(ctx) {
  document.head.append(Object.assign(document.createElement("style"), { id: "css-ideas", textContent: CSS }));
  ctx.action("picksToggle", () => { ctx.S.picksOpen = !ctx.S.picksOpen; ctx.render(); });
  // The Trip hub's "Top picks" row: Ideas with the picks open, scrolled to them.
  ctx.action("topPicks", () => {
    ctx.S.picksOpen = true;
    ctx.openTab("ideas");
    setTimeout(() => document.getElementById("top-picks")?.scrollIntoView({ block: "start" }), 60);
  });
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d?.matches?.("[data-bkh]") && ctx.S.tripId) d.open ? S_OPEN.add(ctx.S.tripId) : S_OPEN.delete(ctx.S.tripId);
  }, true);
  ctx.onAddOpen = () => onAddOpen(ctx);
}
