// Connection status card (whoami). Small on purpose: it proves the shell, and is a safe first card to see in Claude.
export default {
  title: "Trips connection",
  css: `.st{display:flex;gap:12px;align-items:center}.st .ic{width:40px;height:40px;border-radius:var(--t-r-chip);background:var(--t-primary-soft);color:var(--t-primary-soft-ink);display:grid;place-items:center}.st b{font-family:var(--t-font-head)}`,
  script: `
Trips.view({
  render(d, t) {
    return '<div class="t-card"><div class="st"><div class="ic">' + t.icon("trip") + '</div><div><b>Connected to Trips</b><div class="t-muted">' + t.esc(d.name || d.email) + " · " + Number(d.trips || 0) + (d.trips === 1 ? " trip" : " trips") + "</div></div></div>" + t.footer(d) + "</div>";
  },
});`,
};
