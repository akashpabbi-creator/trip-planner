// Trip overview card (list_trips, get_trip). One trip: dates, days filled, ideas, bookings, open to-dos, "Open in app".
// Several trips: one tappable row each. The structure functions live in cards.js and only add tripId and deep links.
export default {
  title: "Trip overview",
  css: `
.ov h2{font-size:var(--t-fs-6)}.ov .sub{margin-top:2px}
.ov .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(68px,1fr));gap:8px;margin:12px 0 4px}
.ov .stat{padding:10px;border-radius:var(--t-r-chip);background:var(--color-background-secondary,var(--t-surface-2));text-align:left}
.ov .stat b{display:block;font:700 var(--t-fs-6)/1.1 var(--t-font-head)}.ov .stat span{font-size:var(--t-fs-2);color:var(--color-text-secondary,var(--t-muted))}
.ov .stat.check{background:var(--t-check-bg);color:var(--t-check)}.ov .stat.check span{color:inherit}
.ov .bar{height:6px;border-radius:3px;background:var(--t-line);margin:10px 0 0;overflow:hidden}.ov .bar i{display:block;height:100%;background:var(--t-primary)}
.ov h3{font-size:var(--t-fs-3);margin:14px 0 2px;color:var(--color-text-secondary,var(--t-muted));font-weight:600}
.ov .ic{width:32px;height:32px;border-radius:var(--t-r-chip);background:var(--t-primary-soft);color:var(--t-primary-soft-ink);display:grid;place-items:center;flex:none}
.ov .grow{flex:1;min-width:0}.ov .grow b{display:block;overflow-wrap:anywhere}
.ov .trow{width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--color-border-tertiary,var(--t-line));padding:12px 0;display:flex;gap:10px;align-items:center;cursor:pointer;min-height:var(--t-touch)}
.ov .trow:first-of-type{border-top:0}
`,
  script: `
const fmt = (s) => { const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : ""; };
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const range = (t) => { if (!t.startDate) return ""; const n = Number(t.days?.length ?? t.days) || 0; const e = new Date(t.startDate + "T00:00:00Z"); e.setUTCDate(e.getUTCDate() + Math.max(0, n - 1)); return fmt(t.startDate) + (n > 1 ? " to " + fmt(e.toISOString().slice(0, 10)) : ""); };
const KIND = { flight: "flight", hotel: "hotel", train: "train", bus: "bus", ferry: "ferry", car: "car", tickets: "ticket" };
Trips.view({
  render(d, t) {
    if (d.kind === "list") {
      const rows = (d.trips || []).map((x) => '<button class="trow" type="button" data-open="' + t.esc(x.appUrl) + '"><span class="ic">' + t.icon("trip") + '</span><span class="grow"><b>' + t.esc(x.name || x.destination || "Trip") + '</b><span class="t-muted">' + t.esc([x.destination, range(x), x.days ? plural(Number(x.days), "day") : ""].filter(Boolean).join(" · ")) + "</span></span>" + t.icon("arrow-right") + "</button>").join("");
      return '<div class="t-card ov"><div class="t-head"><h2>' + (d.trips?.length === 1 ? "Your trip" : "Your trips") + "</h2></div>" + (rows || '<div class="t-muted">No trips yet.</div>') + "</div>";
    }
    const days = d.days || [], total = days.length, filled = days.filter((x) => x.stops > 0).length;
    const todos = (d.checklist || []).filter((x) => !x.done), notes = (d.tripNotes || []).filter((x) => !x.done);
    const open = todos.length + notes.length;
    const bk = (d.bookings || []).slice().sort((a, b) => String(a.start || a.date || "").localeCompare(String(b.start || b.date || ""))).slice(0, 3);
    const stat = (n, label, cls) => '<div class="stat' + (cls ? " " + cls : "") + '"><b>' + n + "</b><span>" + label + "</span></div>";
    return '<div class="t-card ov"><h2>' + t.esc(d.name || d.destination || "Trip") + '</h2><div class="t-muted sub">' + t.esc([d.destination, range({ startDate: d.startDate, days }), (d.travellers || []).length ? (d.travellers || []).join(" and ") : ""].filter(Boolean).join(" · ")) + "</div>"
      + '<div class="stats">' + stat(filled + "/" + total, "days planned", total && filled < total ? "check" : "") + stat(d.ideasCount || 0, "in Ideas") + stat((d.bookings || []).length, "bookings") + stat(open, "to do", open ? "check" : "") + "</div>"
      + '<div class="bar" role="img" aria-label="' + filled + " of " + total + ' days planned"><i style="width:' + (total ? Math.round((filled / total) * 100) : 0) + '%"></i></div>'
      + (bk.length ? "<h3>Bookings</h3>" + bk.map((b) => '<div class="t-row"><span class="ic">' + t.icon(KIND[b.kind] || "ticket") + '</span><span class="grow"><b>' + t.esc(b.title || b.kind || "Booking") + '</b><span class="t-muted">' + t.esc([fmt(b.start || b.date), b.ref ? "Ref " + b.ref : ""].filter(Boolean).join(" · ")) + "</span></span></div>").join("") : "")
      + (open ? "<h3>Still to do</h3>" + [...todos.map((x) => x.text), ...notes.map((x) => x.text)].slice(0, 4).map((x) => '<div class="t-row"><span class="ic">' + t.icon("check-circle") + '</span><span class="grow">' + t.esc(x) + "</span></div>").join("") + (open > 4 ? '<div class="t-muted">and ' + (open - 4) + " more</div>" : "") : "")
      + t.footer(d) + "</div>";
  },
});`,
};
