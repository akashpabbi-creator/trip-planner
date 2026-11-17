// Change receipt (every change tool) and the check_plan result. A receipt says what changed, shows rule warnings in amber
// (vegetarian options, rest block, pace: never blocking) and carries the Undo button. Text answers are unchanged.
export default {
  title: "Change receipt",
  css: `
.rc .top{display:flex;gap:10px;align-items:flex-start}
.rc .ic{width:32px;height:32px;border-radius:var(--t-r-chip);display:grid;place-items:center;flex:none;background:var(--t-good-bg);color:var(--t-good)}
.rc .ic.none{background:var(--t-primary-soft);color:var(--t-primary-soft-ink)}.rc .ic.warn{background:var(--t-check-bg);color:var(--t-check)}
.rc h2{font-size:var(--t-fs-4)}.rc .grow{flex:1;min-width:0;overflow-wrap:anywhere}
.rc .w{display:flex;align-items:flex-start;gap:8px}.rc .w span{flex:1;min-width:0}.rc .w .t-btn{min-height:var(--t-touch);padding:0 10px}
.rc .none-line{margin-top:6px}
`,
  script: `
Trips.view({
  render(d, t) {
    const ws = d.warnings || [];
    if (d.kind === "check") {
      const rows = ws.map((w) => '<div class="t-warn w">' + t.icon("alert") + "<span>" + t.esc(w.text) + "</span>" + (w.appUrl ? '<button class="t-btn soft" type="button" data-open="' + t.esc(w.appUrl) + '">Show day' + (w.day ? " " + w.day : "") + "</button>" : "") + "</div>").join("");
      const facts = [d.days ? d.days + (d.days === 1 ? " day" : " days") : "", d.emptyDays?.length ? "empty: day " + d.emptyDays.join(", ") : "", d.ideas ? d.ideas + " in Ideas" : ""].filter(Boolean).join(" · ");
      return '<div class="t-card rc"><div class="top"><span class="ic ' + (ws.length ? "warn" : "") + '">' + t.icon(ws.length ? "alert" : "check-circle") + '</span><div class="grow"><h2>' + (d.ok ? "Plan looks good" : ws.length + (ws.length === 1 ? " thing" : " things") + " to check") + '</h2><div class="t-muted">' + t.esc(facts) + "</div></div></div>" + rows + t.footer(d) + "</div>";
    }
    const changed = d.changed !== false;
    const head = changed ? d.title : (d.why || "Nothing changed.");
    return '<div class="t-card rc"><div class="top"><span class="ic ' + (changed ? (ws.length ? "warn" : "") : "none") + '">' + t.icon(changed ? "check-circle" : "dot-check") + '</span><div class="grow"><h2>' + t.esc(head) + "</h2>" + (changed && d.detail ? '<div class="t-muted">' + t.esc(d.detail) + "</div>" : "") + "</div></div>"
      + ws.map((w) => '<div class="t-warn w">' + t.icon("alert") + "<span>" + t.esc(w.text) + "</span>" + (w.appUrl ? '<button class="t-btn soft" type="button" data-open="' + t.esc(w.appUrl) + '">Show day</button>' : "") + "</div>").join("")
      + (changed ? t.undoBar(d, "Applied in the app.") : "") + t.footer(d) + "</div>";
  },
});`,
};
