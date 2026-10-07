// Reactions, votes and comments: a quiet row on every card, plus the helpers the planners use (loved / vetoed names).
// Votes: item.votes = { [email]: "love" | "like" | "no" }. Comments: item.comments = [{ id, by, byName, at, text }].
let C = null; // ctx, set by init

const VOTES = [["love", "❤️", "Love it"], ["like", "👍", "Like it"], ["no", "👎", "Not for us"]];
const open = new Set(); // item ids whose comment thread is expanded
const view = { cat: "all", sort: "love" }; // Ideas tab filter and sort

/* ----------------------------------------------------------- pure helpers (also used by app.js, ai.js) */
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Same place when the names match, or one contains the other ("Colosseum" vs "The Colosseum, Rome").
export function sameName(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)));
}
const votesOf = (it) => it?.votes || {};
export const isVetoed = (it) => Object.values(votesOf(it)).includes("no");
export const loveCount = (it) => Object.values(votesOf(it)).filter((v) => v === "love").length;
// Everyone on the trip picked ❤️ (needs two or more people to mean anything).
export const bothLove = (it, members) => (members || []).length >= 2 && members.every((m) => votesOf(it)[m] === "love");
export const lovedNames = (items, members) => byLove(items.filter((i) => !isVetoed(i) && loveCount(i) > 0), members).map((i) => i.title).filter(Boolean);
export const vetoedNames = (items) => items.filter(isVetoed).map((i) => i.title).filter(Boolean);
// Most loved first (both love, then one love), keeping the given order otherwise.
export function byLove(list, members) {
  const rank = (i) => (bothLove(i, members) ? 0 : loveCount(i) ? 1 : 2);
  return list.map((x, k) => [x, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}
// Takes vetoed places out of a drafted plan ({ days: [{ items }], stays }); returns the cleaned draft and the names dropped.
export function dropVetoed(draft, items) {
  const veto = vetoedNames(items);
  const dropped = [];
  const keep = (x) => {
    if (x?.name && veto.some((v) => sameName(v, x.name))) { dropped.push(String(x.name)); return false; }
    return true;
  };
  if (!veto.length) return { draft, dropped };
  return {
    draft: { ...draft, days: (draft.days || []).map((d) => ({ ...d, items: (d.items || []).filter(keep) })), ...(draft.stays ? { stays: draft.stays.filter(keep) } : {}) },
    dropped,
  };
}

/* ------------------------------------------------------------------ card row */
const initial = (email) => C.firstName(C.nameOf(email)).slice(0, 1).toUpperCase();
function cardRow(it) {
  if (!C.S.trip || !C.S.me) return "";
  const members = C.S.trip.members;
  const votes = votesOf(it);
  const mine = votes[C.S.me.email];
  const btns = VOTES.map(([k, ic, label]) => {
    const who = members.filter((m) => votes[m] === k);
    const names = who.map((m) => C.who(m)).join(", ");
    return `<button type="button" class="rx ${mine === k ? "on" : ""} ${who.length ? "has" : ""}" data-action="vote" data-id="${it.id}" data-v="${k}" title="${C.esc(label + (names ? ": " + names : ""))}" aria-pressed="${mine === k}">${ic}${who.length ? `<span class="rx-who">${who.map((m) => C.esc(initial(m))).join("")}</span>` : ""}</button>`;
  }).join("");
  const n = (it.comments || []).length;
  return `<div class="rx-row">${btns}
    <button type="button" class="rx ${open.has(it.id) ? "on" : ""} ${n ? "has" : ""}" data-action="cmtToggle" data-id="${it.id}" title="Comments" aria-expanded="${open.has(it.id)}">💬${n ? `<span class="rx-who">${n}</span>` : ""}</button>
    ${bothLove(it, members) ? `<span class="tag rx-both">Both love it</span>` : ""}
  </div>${open.has(it.id) ? thread(it) : ""}`;
}
function thread(it) {
  const list = [...(it.comments || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
  return `<div class="rx-thread">
    ${list.map((c) => `<div class="rx-c"><span><b>${C.esc(c.by === C.S.me.email ? "You" : C.firstName(c.byName || C.nameOf(c.by)))}</b> <span class="muted small">${C.ago(c.at)}</span><br>${C.esc(c.text)}</span>${c.by === C.S.me.email ? `<button type="button" class="rx-del" data-action="cmtDel" data-id="${it.id}" data-cid="${C.esc(c.id)}" title="Delete your comment" aria-label="Delete your comment">×</button>` : ""}</div>`).join("")}
    <div class="rx-add"><input id="cmt-${it.id}" data-cmt="${it.id}" placeholder="Add a comment" maxlength="500" autocomplete="off"><button type="button" class="btn-s" data-action="cmtAdd" data-id="${it.id}">Post</button></div>
  </div>`;
}

/* ---------------------------------------------------------------- actions */
async function vote(id, v) {
  const { S } = C;
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  const next = votesOf(it)[S.me.email] === v ? undefined : v;
  await S.store.setItemPath(S.tripId, id, ["votes", S.me.email], next);
}
async function addComment(id) {
  const { S } = C;
  const input = document.getElementById("cmt-" + id);
  const text = (input?.value || "").trim().slice(0, 500);
  const it = S.items.find((x) => x.id === id);
  if (!text || !it) return;
  input.value = "";
  await S.store.arrayAdd(S.tripId, id, "comments", { id: C.uid(), by: S.me.email, byName: S.me.name, at: Date.now(), text });
  await C.log(`commented on “${it.title}”: “${text.length > 60 ? text.slice(0, 60) + "…" : text}”`);
}
async function delComment(id, cid) {
  const { S } = C;
  const c = (S.items.find((x) => x.id === id)?.comments || []).find((x) => x.id === cid);
  if (!c || c.by !== S.me.email) return;
  await S.store.arrayRemove(S.tripId, id, "comments", c);
}

/* -------------------------------------------------------------- Ideas tab */
// Filter chips (All, Both love, each category present) and a sort; hidden until there are a few ideas.
export function ideasBar(list, members, cats) {
  const present = Object.keys(cats).filter((k) => list.some((i) => (i.category || "other") === k));
  const both = list.filter((i) => bothLove(i, members)).length;
  if (view.cat !== "all" && !(view.cat === "love" ? both : present.includes(view.cat))) view.cat = "all"; // that filter has nothing left
  if (list.length < 3) return "";
  const chip = (k, label) => `<button type="button" class="chip ${view.cat === k ? "on" : ""}" data-action="ideaFilter" data-id="${k}">${label}</button>`;
  return `<div class="chips idea-chips">${chip("all", "All")}${both ? chip("love", `❤️ Both love (${both})`) : ""}${present.map((k) => chip(k, `${cats[k].icon} ${C.esc(cats[k].label)}`)).join("")}
    <select class="idea-sort" data-sort aria-label="Sort ideas"><option value="love" ${view.sort === "love" ? "selected" : ""}>Both love first</option><option value="new" ${view.sort === "new" ? "selected" : ""}>Newest first</option></select></div>`;
}
// Both-loved first, vetoed last, then newest. "Newest" keeps pure date order.
export function arrangeIdeas(list, members) {
  const cat = view.cat;
  const shown = list.filter((i) => cat === "all" || (cat === "love" ? bothLove(i, members) : (i.category || "other") === cat));
  const newest = (a, b) => (b.addedAt || 0) - (a.addedAt || 0);
  if (view.sort === "new") return shown.sort(newest);
  const rank = (i) => (bothLove(i, members) ? 0 : isVetoed(i) ? 2 : 1);
  return shown.sort((a, b) => rank(a) - rank(b) || newest(a, b));
}

/* --------------------------------------------------------------------- init */
const CSS = `
.rx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 6px; }
.rx { border: 1px solid transparent; background: transparent; color: var(--muted); border-radius: 99px; padding: 1px 8px; font-size: 13px; line-height: 1.6; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; filter: grayscale(1); opacity: 0.7; min-height: 32px; }
@media (max-width: 700px) { .rx { min-height: 36px; min-width: 36px; justify-content: center; } }
.rx:hover { opacity: 1; background: var(--accent-soft); }
.rx.has { opacity: 1; }
.rx.on { background: var(--accent-soft); border-color: var(--line); color: var(--ink); filter: none; opacity: 1; }
.rx-who { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.rx-both { background: var(--accent-soft); color: var(--accent); margin-left: 4px; }
.rx-thread { margin-top: 6px; padding: 8px 10px; border-radius: 12px; background: var(--accent-soft); display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.rx-c { display: flex; justify-content: space-between; gap: 8px; overflow-wrap: anywhere; }
.rx-del { border: 0; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
.rx-add { display: flex; gap: 6px; }
.rx-add input { flex: 1; min-width: 0; padding: 6px 10px; font-size: 14px; }
.idea-chips { align-items: center; margin: 4px 0 12px; }
.idea-chips .chip { background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 13px; padding: 4px 10px; cursor: pointer; }
.idea-chips .chip.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.idea-sort { width: auto; margin-left: auto; font-size: 13px; padding: 4px 8px; border-radius: 99px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); }
`;

export function init(ctx) {
  C = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-social", textContent: CSS }));
  ctx.slot("card", (it) => cardRow(it));
  ctx.action("vote", (btn, id) => vote(id, btn.dataset.v));
  ctx.action("cmtToggle", (btn, id) => {
    open.has(id) ? open.delete(id) : open.add(id);
    ctx.render();
    if (open.has(id)) document.getElementById("cmt-" + id)?.focus();
  });
  ctx.action("cmtAdd", (btn, id) => addComment(id));
  ctx.action("cmtDel", (btn, id) => delComment(id, btn.dataset.cid));
  ctx.action("ideaFilter", (btn, id) => { view.cat = id; ctx.render(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.cmt) { e.preventDefault(); addComment(e.target.dataset.cmt).catch((err) => ctx.toast("Couldn't post: " + err.message)); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches?.("select[data-sort]")) { view.sort = e.target.value; ctx.render(); }
  });
}
