// Votes and comments on proposals (Gemini/Claude/Shuffle changes, and a drafted plan). Advisory only: nothing here applies anything.
// Stored inside the proposal so it goes away with it: obj.votes = { [key]: { [email]: "up" | "down" } } (key: op index, "d<N>" for a day, "all"),
// obj.comments = [{ id, by, byName, at, text }]. kind is "changes" (trip.changes) or "proposal" (trip.proposal).
let C = null; // ctx, set by init

const KINDS = ["changes", "proposal"];
const VOTES = [["up", "👍", "Good idea"], ["down", "👎", "Not for us"]];
const initial = (email) => C.firstName(C.nameOf(email)).slice(0, 1).toUpperCase();
const votesOf = (obj, key) => obj?.votes?.[key] || {};

function buttons(obj, key, kind) {
  const members = C.S.trip.members, votes = votesOf(obj, key), mine = votes[C.S.me.email];
  return VOTES.map(([k, ic, label]) => {
    const who = members.filter((m) => votes[m] === k);
    const names = who.map((m) => C.who(m)).join(", ");
    return `<button type="button" class="rx ${mine === k ? "on" : ""} ${who.length ? "has" : ""}" data-action="pvote" data-kind="${kind}" data-key="${C.esc(key)}" data-v="${k}" title="${C.esc(label + (names ? ": " + names : ""))}" aria-pressed="${mine === k}">${ic}${who.length ? `<span class="rx-who">${who.map((m) => C.esc(initial(m))).join("")}</span>` : ""}</button>`;
  }).join("");
}
export function voteRow(obj, key, kind = "changes") {
  if (!C?.S.trip || !C.S.me) return "";
  return `<span class="pv" data-pkind="${kind}" data-pkey="${C.esc(String(key))}">${buttons(obj, String(key), kind)}</span>`;
}

function comments(obj, kind) {
  const list = [...(obj?.comments || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
  return list.map((c) => `<div class="rx-c"><span><b>${C.esc(c.by === C.S.me.email ? "You" : C.firstName(c.byName || C.nameOf(c.by)))}</b> <span class="muted small">${C.ago(c.at)}</span><br>${C.esc(c.text)}</span>${c.by === C.S.me.email ? `<button type="button" class="rx-del" data-action="pcmtDel" data-kind="${kind}" data-cid="${C.esc(c.id)}" title="Delete your comment" aria-label="Delete your comment">×</button>` : ""}</div>`).join("");
}
export function thread(obj, kind = "changes") {
  if (!C?.S.trip || !C.S.me) return "";
  // The list is repainted live; the input below it is never re-rendered, so a half-typed comment survives.
  return `<div class="rx-thread ps-thread" data-pthread="${kind}">
    <div class="ps-list">${comments(obj, kind)}</div>
    <div class="rx-add"><input id="pcmt-${kind}" data-pcmt="${kind}" placeholder="Add a comment" maxlength="500" autocomplete="off"><button type="button" class="btn-s" data-action="pcmtAdd" data-kind="${kind}">Post</button></div>
  </div>`;
}

// Short line for banners: partner's overall vote, how many things they voted on, and the comment count. "" when quiet.
export function summary(obj, members) {
  if (!obj || !C?.S.me) return "";
  const me = C.S.me.email, others = (members || []).filter((m) => m !== me);
  const parts = [];
  const all = votesOf(obj, "all");
  const overall = others.filter((m) => all[m]).map((m) => `${C.who(m)} ${all[m] === "up" ? "👍" : "👎"}`);
  if (overall.length) parts.push(overall.join(", "));
  const keys = Object.keys(obj.votes || {}).filter((k) => k !== "all");
  const n = keys.filter((k) => others.some((m) => obj.votes[k]?.[m])).length;
  if (n) parts.push(`${n} vote${n > 1 ? "s" : ""}`);
  const nc = (obj.comments || []).length;
  if (nc) parts.push(`${nc} comment${nc > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

// Re-renders just the vote buttons and comment lists inside `root` (a modal) from the current trip. Inputs are left alone.
export function refresh(root = document) {
  const t = C?.S.trip;
  if (!t || !C.S.me) return;
  for (const el of root.querySelectorAll(".pv")) {
    const kind = el.dataset.pkind;
    el.innerHTML = buttons(t[kind], el.dataset.pkey, kind);
  }
  for (const el of root.querySelectorAll("[data-pthread]")) {
    const kind = el.dataset.pthread, list = el.querySelector(".ps-list");
    const html = comments(t[kind], kind);
    if (list && list.innerHTML !== html) list.innerHTML = html;
  }
}

/* ---------------------------------------------------------------- actions */
async function vote(kind, key, v) {
  const { S } = C;
  if (!KINDS.includes(kind)) return;
  const me = S.me.email;
  await S.store.txTrip(S.tripId, (cur) => {
    const obj = cur[kind];
    if (!obj) return null;
    const row = { ...(obj.votes?.[key] || {}) };
    if (row[me] === v) delete row[me]; else row[me] = v;
    const votes = { ...(obj.votes || {}), [key]: row };
    if (!Object.keys(row).length) delete votes[key];
    return { [kind]: { ...obj, votes } };
  });
}
async function addComment(kind) {
  const { S } = C;
  if (!KINDS.includes(kind)) return;
  const input = document.getElementById("pcmt-" + kind);
  const text = (input?.value || "").trim().slice(0, 500);
  if (!text) return;
  input.value = "";
  const c = { id: C.uid(), by: S.me.email, byName: S.me.name, at: Date.now(), text };
  let posted = false;
  await S.store.txTrip(S.tripId, (cur) => {
    const obj = cur[kind];
    if (!obj) return null;
    posted = true;
    return { [kind]: { ...obj, comments: [...(obj.comments || []), c] } };
  });
  if (!posted) return;
  refresh();
  await C.log(`commented on ${kind === "changes" ? "the suggested changes" : "the drafted plan"}: “${text.length > 60 ? text.slice(0, 60) + "…" : text}”`);
}
async function delComment(kind, cid) {
  const { S } = C;
  if (!KINDS.includes(kind)) return;
  await S.store.txTrip(S.tripId, (cur) => {
    const obj = cur[kind];
    const c = (obj?.comments || []).find((x) => x.id === cid);
    if (!c || c.by !== S.me.email) return null;
    return { [kind]: { ...obj, comments: obj.comments.filter((x) => x.id !== cid) } };
  });
  refresh();
}

/* --------------------------------------------------------------------- init */
const CSS = `
.pv { display: inline-flex; align-items: center; gap: 0; }
.pv .rx { min-height: 30px; padding: 0 7px; }
.ps-thread { margin: 10px 0; }
.ps-thread .ps-list { display: flex; flex-direction: column; gap: 6px; }
.ps-thread .ps-list:empty { display: none; }
.pday-side { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.ps-all { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; font-size: 14px; }
.ps-all b { font-weight: 600; }
.ps-sum { color: var(--muted); font-size: 12px; font-weight: 400; display: block; }
@media (max-width: 420px) { .pv .rx { min-width: 34px; } }
`;

export function init(ctx) {
  C = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-psocial", textContent: CSS }));
  const fail = (e) => ctx.toast("Couldn't save: " + e.message);
  ctx.action("pvote", (btn) => vote(btn.dataset.kind, btn.dataset.key, btn.dataset.v).then(() => refresh()).catch(fail));
  ctx.action("pcmtAdd", (btn) => addComment(btn.dataset.kind).catch(fail));
  ctx.action("pcmtDel", (btn) => delComment(btn.dataset.kind, btn.dataset.cid).catch(fail));
  ctx.refreshProposalSocial = refresh;
  ctx.psocial = { voteRow, thread, summary, refresh };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.pcmt) { e.preventDefault(); addComment(e.target.dataset.pcmt).catch(fail); }
  });
  ctx.on("trip", () => { if (document.querySelector(".pv, [data-pthread]")) refresh(); });
}
