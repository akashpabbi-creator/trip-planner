// Day card: one day as a timeline (the redesign's Plan view). Tap a stop for its panel: Directions, Move to another day or Ideas,
// Remove to Ideas. Every change goes through day_card_move (move_item underneath), so it is logged and has Undo.
// Expand shows every day, stacked, with day chips that jump to a day.
export default {
  title: "Trip day",
  css: `
.dc{max-width:720px;margin:0 auto}
.dc-sub{margin:-4px 0 8px}
.dc-day{scroll-margin-top:8px;padding-top:4px}
.dc-day+.dc-day{margin-top:14px;border-top:1px solid var(--color-border-tertiary,var(--t-line));padding-top:14px}
.dc-day h3{font-size:var(--t-fs-4);margin-bottom:6px;display:flex;gap:8px;align-items:baseline}
.dc-stop{border-top:1px solid var(--color-border-tertiary,var(--t-line))}
.dc-stop:first-of-type{border-top:0}
.dc-row{all:unset;box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;width:100%;min-height:var(--t-touch);padding:10px 4px;cursor:pointer;border-radius:var(--t-r-chip)}
.dc-row:focus-visible{outline:2px solid var(--t-primary);outline-offset:-2px}
.dc-time{flex:none;width:46px;font-variant-numeric:tabular-nums;font-weight:600;font-size:var(--t-fs-3);color:var(--color-text-secondary,var(--t-muted));padding-top:2px}
.dc-ic{flex:none;width:32px;height:32px;border-radius:var(--t-r-chip);background:var(--t-primary-soft);color:var(--t-primary-soft-ink);display:grid;place-items:center}
.dc-ic.rest{background:var(--t-good-bg);color:var(--t-good)}
.dc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dc-main b{font-weight:600;overflow-wrap:anywhere}
.dc-tags{display:flex;gap:6px;flex-wrap:wrap}
.dc-travel{display:flex;align-items:center;gap:6px;margin:0 0 0 62px;padding:2px 0;color:var(--color-text-secondary,var(--t-muted));font-size:var(--t-fs-2)}
.dc-travel .i{width:16px;height:16px}
.dc-panel{margin:0 0 10px 56px;padding:10px;border-radius:var(--t-r-chip);background:var(--color-background-secondary,var(--t-surface-2));display:grid;gap:8px}
.dc-panel p{margin:0;font-size:var(--t-fs-3);overflow-wrap:anywhere}
.dc-acts{display:flex;gap:8px;flex-wrap:wrap}
.dc-lbl{font-size:var(--t-fs-2);font-weight:600;color:var(--color-text-secondary,var(--t-muted))}
.dc-busy{opacity:.6;pointer-events:none}
.dc-empty{padding:14px 4px}
.dc-nav{display:flex;gap:8px;align-items:flex-start}
.dc-nav .t-chips{flex:1;min-width:0}
`,
  script: `
let sel = null, full = false;
const TRAVEL = { walk: "walk", car: "car", drive: "car", taxi: "car", bus: "bus", train: "train", metro: "train", ferry: "ferry", boat: "ferry", bike: "bike", cycle: "bike", flight: "flight" };
const CAT = { food: "food", stay: "hotel", transport: "train", shopping: "shop", nature: "leaf", activity: "ticket", sight: "landmark" };
const hm = (m) => (m % 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : Math.floor(m / 60) + "h");
const dur = (m) => (!m ? "" : m < 60 ? m + " min" : hm(m));
const when = (s) => (s.fixedTime || s.estStart || "");

function vegBadge(s, t) {
  if (s.category !== "food" || s.rest) return "";
  if (s.veg === "yes") return '<span class="t-badge good">' + t.icon("leaf") + " Veg ok</span>";
  if (s.veg === "no") return '<span class="t-badge check">' + t.icon("alert") + " No veg options</span>";
  return '<span class="t-badge check">' + t.icon("alert") + " Check veg</span>";
}

function panel(s, dayNo, d, t) {
  const targets = d.days.filter((x) => x.day !== dayNo).map((x) => '<button class="t-chip" type="button" data-do="move" data-id="' + t.esc(s.id) + '" data-to="' + x.day + '" data-from="' + dayNo + '" aria-label="Move to day ' + x.day + '">Day ' + x.day + "</button>").join("");
  const ideas = '<button class="t-chip" type="button" data-do="move" data-id="' + t.esc(s.id) + '" data-to="ideas" data-from="' + dayNo + '" aria-label="Move to Ideas">Ideas</button>';
  return '<div class="dc-panel">'
    + (s.location ? "<p>" + t.icon("pin") + " " + t.esc(s.location) + "</p>" : "")
    + (s.vegNote ? "<p>" + t.icon("leaf") + " " + t.esc(s.vegNote) + "</p>" : "")
    + (s.notes ? "<p>" + t.esc(s.notes) + "</p>" : "")
    + '<div class="dc-acts">' + (s.directions ? '<button class="t-btn soft" type="button" data-open="' + t.esc(s.directions) + '">' + t.icon("compass") + " Directions</button>" : "")
    + '<button class="t-btn" type="button" data-do="move" data-id="' + t.esc(s.id) + '" data-to="ideas" data-from="' + dayNo + '">' + t.icon("ideas") + " Remove to Ideas</button></div>"
    + '<div class="dc-lbl">Move to</div><div class="t-chips">' + targets + ideas + "</div></div>";
}

function stops(day, d, t) {
  const list = day.schedule || [];
  if (!list.length) return '<div class="t-muted dc-empty">Nothing planned on this day yet.</div>';
  return list.map((s, k) => {
    const tr = s.travelToHere && k > 0 ? '<div class="dc-travel">' + t.icon(TRAVEL[String(s.travelToHere.mode).toLowerCase()] || "arrow-down") + " " + t.esc(s.travelToHere.minutes ? s.travelToHere.minutes + " min " : "") + t.esc(s.travelToHere.mode) + "</div>" : "";
    const open = sel === s.id;
    const meta = [s.location, dur(s.durationMin)].filter(Boolean).join(" · ");
    return tr + '<div class="dc-stop"><button class="dc-row" type="button" data-do="sel" data-id="' + t.esc(s.id) + '" aria-expanded="' + open + '">'
      + '<span class="dc-time">' + t.esc(when(s)) + "</span>"
      + '<span class="dc-ic' + (s.rest ? " rest" : "") + '">' + t.icon(s.rest ? "clock" : CAT[s.category] || "pin") + "</span>"
      + '<span class="dc-main"><b>' + t.esc(s.rest && !s.title ? "Rest & recharge" : s.title) + "</b>"
      + (meta ? '<span class="t-muted">' + t.esc(meta) + "</span>" : "")
      + '<span class="dc-tags">' + (s.mustDo ? '<span class="t-badge">' + t.icon("star") + " Must do</span>" : "") + vegBadge(s, t) + (s.rest ? '<span class="t-badge good">Rest</span>' : "") + "</span></span></button>"
      + (open ? panel(s, day.day, d, t) : "") + "</div>";
  }).join("");
}

function dayHead(day) {
  return [day.date, day.title, day.stayingIn ? "staying in " + day.stayingIn : ""].filter(Boolean).join(" · ");
}

function chips(d, t) {
  if (d.days.length < 2) return "";
  return '<div class="t-chips" role="group" aria-label="Days">' + d.days.map((x) => '<button class="t-chip" type="button" data-do="day" data-n="' + x.day + '" aria-pressed="' + (!full && x.day === d.day) + '">Day ' + x.day + "</button>").join("") + "</div>";
}

Trips.view({
  render(d, t) {
    if (d.mode === "ideas") {
      return '<div class="t-card dc"><div class="t-head">' + t.icon("ideas") + "<h2>" + d.count + (d.count === 1 ? " idea" : " ideas") + " waiting</h2></div><div class=\\"t-muted\\">Saved places not yet on a day. Ideas stay here until you place them.</div>" + t.footer(d) + "</div>";
    }
    if (d.mode === "receipt") {
      return '<div class="t-card dc"><div class="t-head">' + t.icon("check-circle") + "<h2>" + t.esc(d.receipt) + "</h2></div>" + t.undoBar(d, "Applied.") + t.warnings(d.warnings) + t.footer(d) + "</div>";
    }
    const bar = d.undoWith ? t.undoBar(d, d.receipt) : d.receipt ? '<div class="t-undo"><span>' + t.esc(d.receipt) + "</span></div>" : "";
    const body = full && d.all
      ? d.all.map((day) => '<section class="dc-day" id="dc-day-' + day.day + '"><h3>Day ' + day.day + ' <span class="t-muted">' + t.esc(dayHead(day)) + "</span></h3>" + stops(day, d, t) + "</section>").join("")
      : '<div class="dc-day"><div class="t-muted dc-sub">' + t.esc(dayHead(d)) + "</div>" + stops(d, d, t) + "</div>";
    return '<div class="t-card dc" id="dc"><div class="t-head">' + t.icon("plan") + "<h2>" + t.esc(full ? d.trip : "Day " + d.day + (d.destination ? " · " + d.destination : "")) + "</h2>"
      + '<button class="t-btn" type="button" data-do="' + (full ? "inline" : "full") + '">' + (full ? "Collapse" : "Expand") + "</button></div>"
      + chips(d, t) + body + bar + t.warnings(d.warnings) + t.footer(d) + "</div>";
  },
  onUndo(_r, t) { refresh(t, "Undone."); },
  after(root, d, t) {
    if (root.dataset.dc) return;
    root.dataset.dc = "1";
    root.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-do]");
      if (!b || b.disabled) return;
      const cur = t.data, act = b.dataset.do;
      if (act === "sel") { sel = sel === b.dataset.id ? null : b.dataset.id; t.set({ ...cur }); return; }
      if (act === "day") {
        const n = Number(b.dataset.n);
        if (full) { document.getElementById("dc-day-" + n)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        sel = null; await busy(() => t.act("day_card", { trip: cur.tripId, day: n })); return;
      }
      if (act === "full") { await t.fullscreen(); full = true; sel = null; await busy(() => t.act("day_card", { trip: cur.tripId, day: cur.day, all: true })); return; }
      if (act === "inline") { try { await t.app.requestDisplayMode({ mode: "inline" }); } catch {} full = false; sel = null; await busy(() => t.act("day_card", { trip: cur.tripId, day: cur.day })); return; }
      if (act === "move") {
        sel = null;
        await busy(() => t.act("day_card_move", { trip: cur.tripId, item: b.dataset.id, day: b.dataset.to === "ideas" ? "ideas" : Number(b.dataset.to), view: cur.day, all: full }));
      }
    });
  },
});

async function busy(fn) {
  const r = document.getElementById("dc");
  r?.classList.add("dc-busy");
  try { await fn(); } finally { document.getElementById("dc")?.classList.remove("dc-busy"); }
}
async function refresh(t, note) {
  const cur = t.data;
  try {
    const r = await t.call("day_card", { trip: cur.tripId, day: cur.day, all: full });
    if (r.structuredContent) t.set({ ...r.structuredContent, receipt: note });
  } catch (e) { t.error(e); }
}
`,
};
