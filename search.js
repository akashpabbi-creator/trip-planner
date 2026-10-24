// Trip search: one box that looks through Ideas, every day's stops, Bookings, Kit to-dos and packing, and Trip notes.
// Runs on the phone from what the trip already holds (offline too, no AI). Also exports the matcher the Ideas tab filter uses.
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (q) => fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Every word of the query must appear somewhere in the given texts.
export function matchText(texts, q) {
  const ws = words(q);
  if (!ws.length) return true;
  const hay = fold(texts.filter(Boolean).join(" \n "));
  return ws.every((w) => hay.includes(w));
}
const ITEM_FIELDS = ["title", "notes", "location", "description", "vegNote", "tips", "address", "hours"];
export const itemTexts = (it, catLabel) => [...ITEM_FIELDS.map((f) => it[f]), catLabel, ...(it.comments || []).map((c) => c.text)];
export const itemMatches = (it, q, catLabel = "") => matchText(itemTexts(it, catLabel), q);

// A short piece of text around the first query word, or "" when the title already shows it.
function snippet(texts, q) {
  const ws = words(q);
  for (const t of texts) {
    const s = String(t || "");
    const f = fold(s);
    const at = ws.map((w) => f.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (at == null) continue;
    const from = Math.max(0, at - 30);
    return (from ? "…" : "") + s.slice(from, from + 90).trim() + (from + 90 < s.length ? "…" : "");
  }
  return "";
}

const CSS = `
.srch-ov { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; }
.srch-top { display: flex; gap: 8px; align-items: center; padding: 10px 14px; padding-top: max(10px, env(safe-area-inset-top)); border-bottom: 1px solid var(--line); }
.srch-top input { flex: 1; min-width: 0; font-size: 16px; padding: 10px 14px; border-radius: 99px; }
.srch-res { flex: 1; overflow-y: auto; padding: 4px 14px 24px; max-width: 760px; width: 100%; box-sizing: border-box; margin: 0 auto; }
.srch-g { margin: 16px 0 6px; font-size: 13px; font-weight: 700; color: var(--muted); letter-spacing: 0.02em; }
.srch-r { display: block; width: 100%; text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 6px; color: var(--ink); cursor: pointer; font: inherit; }
.srch-r:hover, .srch-r:focus-visible { border-color: var(--accent); }
.srch-r b { font-weight: 600; display: block; overflow-wrap: anywhere; }
.srch-r small { display: block; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.srch-r mark { background: var(--accent-soft); color: inherit; border-radius: 3px; padding: 0 1px; }
.srch-hit { animation: srchhit 2.6s ease-out; border-radius: 12px; }
@keyframes srchhit { 0%, 40% { box-shadow: 0 0 0 4px var(--accent-soft); outline: 2px solid var(--accent); } }
`;

export function init(ctx) {
  const { S, esc } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-search", textContent: CSS }));
  let ov = null;

  const dayNo = (it) => S.trip.days.findIndex((d) => d.id === it.dayId);
  const mark = (s, q) => {
    let out = esc(s);
    for (const w of words(q).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `\u0001${m}\u0002`);
    return out.replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
  };

  // The hits for a query, grouped by where they live. Pure: reads the open trip only.
  function run(q) {
    const t = S.trip;
    if (!t || !words(q).length) return [];
    const groups = [];
    const add = (label, hits) => hits.length && groups.push({ label, hits });
    const idea = ctx.ideas(), ideaIds = new Set(idea.map((i) => i.id));
    const cat = (i) => (ctx.CATEGORIES[i.category] || ctx.CATEGORIES.other);
    const itemHit = (i, sub) => {
      const c = cat(i), tx = itemTexts(i, c.label);
      return { kind: ideaIds.has(i.id) ? "idea" : "stop", id: i.id, title: i.title || "Untitled", sub: sub || snippet(tx.slice(1), q) || c.label, icon: c.icon, texts: tx };
    };
    const byDay = [...S.items].filter((i) => !ideaIds.has(i.id) && dayNo(i) >= 0).sort((a, b) => dayNo(a) - dayNo(b) || (a.order || 0) - (b.order || 0));
    add("Plan", byDay.filter((i) => itemMatches(i, q, cat(i).label)).map((i) => itemHit(i, `Day ${dayNo(i) + 1} · ${snippet(itemTexts(i).slice(1), q) || cat(i).label}`)));
    add("Ideas", idea.filter((i) => itemMatches(i, q, cat(i).label)).map((i) => itemHit(i)));
    add("Bookings", (t.bookings || []).filter((b) => matchText([b.title, b.ref, b.from, b.to, b.address, b.notes, b.kind], q))
      .map((b) => ({ kind: "booking", id: b.id, title: b.title || b.kind || "Booking", sub: snippet([b.ref, b.address, b.notes, [b.from, b.to].filter(Boolean).join(" → ")], q) || (b.start || "").slice(0, 10), icon: "🎫" })));
    add("Kit", (t.checklist || []).filter((x) => matchText([x.text], q))
      .map((x) => ({ kind: "kit", id: x.id, title: x.text, sub: x.group === "pack" ? "Packing" : "To-do", icon: x.group === "pack" ? "🎒" : "✅" })));
    add("Trip notes", (Array.isArray(t.tripNotes) ? t.tripNotes : []).filter((n) => matchText([n.text], q))
      .map((n) => ({ kind: "note", id: n.id, title: String(n.text).split("\n")[0].slice(0, 80), sub: snippet([String(n.text).split("\n").slice(1).join(" ")], q), icon: "📝" })));
    return groups;
  }

  function paint() {
    const q = ov.querySelector("input").value, box = ov.querySelector(".srch-res");
    if (!words(q).length) return void (box.innerHTML = `<p class="empty">Type to search names, notes, addresses and tips across Plan, Ideas, Bookings, Kit and Trip notes.</p>`);
    const groups = run(q);
    box.innerHTML = groups.length
      ? groups.map((g) => `<div class="srch-g">${esc(g.label)} · ${g.hits.length}</div>${g.hits.map((h) => `<button type="button" class="srch-r" data-action="searchGo" data-kind="${h.kind}" data-id="${esc(h.id)}"><b>${h.icon} ${mark(h.title, q)}</b>${h.sub ? `<small>${mark(h.sub, q)}</small>` : ""}</button>`).join("")}`).join("")
      : `<p class="empty">Nothing in this trip matches “${esc(q.trim())}”.</p>`;
  }
  function close() { ov?.remove(); ov = null; }
  function open() {
    if (ov || !S.trip) return;
    ov = document.createElement("div");
    ov.className = "srch-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Search this trip");
    ov.innerHTML = `<div class="srch-top"><input type="search" id="srchQ" placeholder="Search this trip" autocomplete="off" enterkeyhint="search" aria-label="Search this trip"><button type="button" class="link" data-action="searchClose">Close</button></div><div class="srch-res"></div>`;
    document.body.append(ov);
    ov.querySelector("input").addEventListener("input", paint);
    paint();
    ov.querySelector("input").focus();
  }

  const TAB = { idea: "ideas", stop: "plan", booking: "kit", kit: "kit", note: "kit" };
  const SEL = { idea: ".card", stop: ".card", booking: ".bk-card" };
  function go(kind, id) {
    close();
    S.tab = TAB[kind];
    S.moreOpen = false;
    if (kind === "idea") ctx.resetIdeaView?.();
    ctx.render();
    const esc2 = (window.CSS?.escape || ((s) => s))(id);
    const el = kind === "kit" ? document.querySelector(`[data-kid="${esc2}"]`) : kind === "note" ? document.querySelector(`[data-nid="${esc2}"]`) : document.querySelector(`${SEL[kind]}[data-id="${esc2}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("srch-hit");
    setTimeout(() => el.classList.remove("srch-hit"), 2700);
  }

  ctx.slot("heroActs", () => `<button class="chip ghost round" data-action="search" title="Search this trip" aria-label="Search this trip">🔍</button>`);
  ctx.action("search", open);
  ctx.action("searchClose", close);
  ctx.action("searchGo", (btn) => go(btn.dataset.kind, btn.dataset.id));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov) close(); });
  ctx.on("render", () => { if (ov && !S.trip) close(); });
}
