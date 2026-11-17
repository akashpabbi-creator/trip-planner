// Ideas carousel card (list_ideas, search_items, save_ideas). Redesign Ideas card look: photo or category tile, title, category,
// veg flag (orange when unchecked), tip such as "book 2 days ahead". One button per card: Add to day (day chips). Ideas stay in Ideas until tapped.
export default {
  title: "Trip ideas",
  css: `
.id-list{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.id-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--color-border-tertiary,var(--t-line));border-radius:var(--t-r-card);background:var(--color-background-primary,var(--t-surface))}
.id-top{display:flex;gap:10px;align-items:flex-start}
.id-pic{width:56px;height:56px;flex:none;border-radius:var(--t-r-chip);background:var(--t-primary-soft);color:var(--t-primary-soft-ink);display:grid;place-items:center;overflow:hidden}
.id-pic img{width:100%;height:100%;object-fit:cover;display:block}
.id-pic .i{width:26px;height:26px}
.id-main{min-width:0;flex:1}
.id-main b{font-family:var(--t-font-head);font-size:var(--t-fs-4);line-height:1.25;display:block;overflow-wrap:anywhere}
.id-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center}
.id-tip{display:flex;gap:6px;align-items:flex-start;font-size:var(--t-fs-3);color:var(--color-text-secondary,var(--t-muted))}
.id-tip .i{width:16px;height:16px;margin-top:2px;color:var(--t-primary)}
.id-actions{display:flex;justify-content:flex-end;margin-top:auto}
.id-days{display:flex;flex-direction:column;gap:6px;padding-top:4px}
.id-days .t-chips{flex-wrap:wrap;overflow:visible}
.id-sub{font-size:var(--t-fs-3);color:var(--color-text-secondary,var(--t-muted))}
.id-more{display:flex;gap:8px;justify-content:center;margin-top:10px}
.id-empty{padding:18px 8px;text-align:center}
.id-receipt{display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:var(--t-fs-3)}
.id-receipt .i{color:var(--t-good)}
`,
  script: `
const ICON = { food: "food", stay: "hotel", transport: "train", activity: "ticket", shopping: "shop", nature: "mountain", sight: "landmark", other: "pin" };
const LABEL = { food: "Food", stay: "Stay", transport: "Transport", activity: "Activity", shopping: "Shopping", nature: "Nature", sight: "Sight", other: "Other" };
const INLINE = 8;
let openId = "", busy = false, expanded = false;
const dayLabel = (d) => "Day " + d.n + (d.date ? " · " + new Date(d.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");

function vegBadge(c, t) {
  if (c.category !== "food") return "";
  if (c.veg === "yes" || c.veg === "some") return '<span class="t-badge good">' + t.icon("leaf") + " Veg options</span>";
  if (c.veg === "no") return '<span class="t-badge check">' + t.icon("alert") + " No veg options</span>";
  return '<span class="t-badge check">' + t.icon("alert") + " Veg unchecked</span>";
}

function card(c, d, t) {
  const pic = c.image ? '<img src="' + t.esc(c.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : t.icon(ICON[c.category] || "pin");
  const meta = [LABEL[c.category] || "Sight", c.location].filter(Boolean).join(" · ");
  const badges = (c.day ? '<span class="t-badge">' + t.icon("plan") + " Day " + c.day + "</span>" : "") + vegBadge(c, t)
    + (c.mustDo ? '<span class="t-badge">' + t.icon("star") + " Must do</span>" : "") + (c.note ? '<span class="t-badge good">' + t.esc(c.note) + "</span>" : "");
  const tips = (c.tips || []).slice(0, 2).map((x) => '<div class="id-tip">' + t.icon("sparkle") + "<span>" + t.esc(x) + "</span></div>").join("");
  const open = openId === c.id;
  const chips = open ? '<div class="id-days"><div class="id-sub">Which day?</div><div class="t-chips">' + d.days.map((x) => '<button class="t-chip" type="button" data-pick="' + c.id + '" data-day="' + x.n + '">' + t.esc(dayLabel(x)) + "</button>").join("") + "</div></div>" : "";
  const action = c.day ? "" : '<div class="id-actions"><button class="t-btn ' + (open ? "" : "soft") + '" type="button" data-toggle="' + c.id + '" aria-expanded="' + open + '">' + (open ? "Cancel" : t.icon("plus") + " Add to day") + "</button></div>";
  return '<article class="id-card"><div class="id-top"><div class="id-pic">' + pic + '</div><div class="id-main"><b>' + t.esc(c.title) + '</b><div class="id-sub">' + t.esc(meta) + '</div>'
    + (badges ? '<div class="id-meta">' + badges + "</div>" : "") + "</div></div>" + tips + chips + action + "</article>";
}

Trips.view({
  render(d, t) {
    const all = d.ideas || [];
    const shown = expanded ? all : all.slice(0, INLINE);
    const r = d.receipt ? '<div class="id-receipt">' + t.icon("check-circle") + "<span>" + t.esc(d.receipt.text) + "</span></div>" + t.warnings(d.receipt.warnings) : "";
    const body = shown.length ? '<div class="id-list">' + shown.map((c) => card(c, d, t)).join("") + "</div>" : '<div class="id-empty t-muted">' + t.icon("ideas") + "<div>Nothing here yet.</div></div>";
    const more = all.length > shown.length ? '<div class="id-more"><button class="t-btn" type="button" data-all="1">Show all ' + all.length + "</button></div>" : "";
    const total = d.ideasTotal > all.length && !d.receipt ? '<div class="t-muted" style="margin-top:8px">' + d.ideasTotal + " ideas in total, open the app to see them all.</div>" : "";
    return '<div class="t-card"><div class="t-head">' + t.icon("ideas") + "<h2>" + t.esc(d.heading || "Ideas") + '</h2><span class="t-muted">' + t.esc(d.trip || "") + "</span></div>"
      + r + body + more + total + t.undoBar(d, d.receipt?.text ? "Done." : "Change made.") + t.footer(d) + "</div>";
  },
  after(root, d, t) {
    root.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => { openId = openId === b.dataset.toggle ? "" : b.dataset.toggle; t.set({ ...t.data }); }));
    root.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
      if (busy) return;
      busy = true; root.querySelectorAll("button").forEach((x) => (x.disabled = true));
      const id = b.dataset.pick; openId = "";
      const r = await t.act("ideas_add_to_day", { trip: d.tripId, item: id, day: Number(b.dataset.day) });
      busy = false;
      if (!r) t.set({ ...t.data });
    }));
    root.querySelector("[data-all]")?.addEventListener("click", async () => { expanded = true; t.set({ ...t.data }); await t.fullscreen(); });
  },
  // Undo puts the idea back in Ideas: redraw the list from the server.
  async onUndo(_r, t) { openId = ""; await t.act("ideas_refresh", { trip: t.data?.tripId }); },
});`,
};
