// Trip hub: the "Trip" tab. Cover, people and trip settings at the top, then one row per area with a line of status text.
// Every row opens an existing page (the tabs that used to sit under More) or runs an existing action, so nothing is lost.
// view(h) gets a bag of app helpers: { S, esc, ic, money, costs, nameOf, firstName, coverOf, cssUrl, dayDate, shortDay, ago, who, wxIcon, pendingChanges, smartCount }.

// Tabs that live under the hub (they keep their own tab ids, deep links and tab memory).
export const CHILDREN = ["kit", "discover", "budget", "itinerary", "changes"];
export const isChild = (id) => CHILDREN.includes(id);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

function row(h, { icon, label, status, tab, scroll, action, warn, count }) {
  const attrs = action ? `data-action="${action}"` : `data-action="tab" data-tab="${tab}"${scroll ? ` data-scroll="${scroll}"` : ""}`;
  return `<button class="hub-row ${warn ? "warn" : ""}" ${attrs}>
    <span class="hr-ic">${h.ic(icon)}</span>
    <span class="hr-t"><b>${h.esc(label)}</b>${status ? `<small>${h.esc(status)}</small>` : ""}</span>
    ${count ? `<span class="count warnc">${count}</span>` : ""}
    <span class="hr-go">${h.ic("arrow-right")}</span>
  </button>`;
}

export function statusLines(h) {
  const t = h.S.trip;
  const c = h.costs();
  const budget = Number(t.budget) || 0;
  const bks = Array.isArray(t.bookings) ? t.bookings : [];
  const list = (g) => (t.checklist || []).filter((x) => x.group === g);
  const pack = list("pack"), todo = list("todo");
  const all = [...pack, ...todo];
  const notes = (Array.isArray(t.tripNotes) ? t.tripNotes : []).filter((n) => !n.done);
  const w = t.weather?.days || [];
  return {
    bookings: bks.length ? plural(bks.length, "booking") : "Nothing booked yet",
    packing: all.length ? `${all.filter((x) => x.done).length} of ${all.length} done` : "Nothing on the list yet",
    notes: notes.length ? plural(notes.length, "open note") : "No open notes",
    budget: budget ? `${h.money(c.total)} of ${h.money(budget)}` : c.total ? `${h.money(c.total)} planned, no budget set` : "No budget set",
    about: [t.place?.title, w.length ? `${Math.min(...w.map((d) => d.min))}–${Math.max(...w.map((d) => d.max))}°C` : ""].filter(Boolean).join(" · ") || "Place, weather and best time",
    activity: t.updatedAt ? `Last change ${h.ago(t.updatedAt)}` : "Every change, with Undo",
  };
}

export function view(h) {
  const { S, esc } = h;
  const t = S.trip;
  const st = statusLines(h);
  const cover = h.coverOf(t);
  const end = h.dayDate(t.days.length - 1);
  const c = h.costs();
  const budget = Number(t.budget) || 0;
  const pct = budget ? Math.min(100, (c.total / budget) * 100) : 0;
  const w = t.weather?.days || [];
  const bases = [...new Set(t.days.map((d) => (d.base || "").trim()).filter(Boolean))];
  const where = [t.destination || "Somewhere wonderful", ...bases.filter((b) => b.toLowerCase() !== String(t.destination || "").toLowerCase())].join(" · ");
  const avatars = t.members.map((m) => {
    const on = S.presence.some((p) => p.email === m && Date.now() - p.at < 60000);
    return `<span class="av ${on ? "on" : ""}" title="${esc(h.nameOf(m))}${on ? " · here now" : ""}">${esc(h.firstName(h.nameOf(m)).slice(0, 1).toUpperCase())}</span>`;
  }).join("");
  const names = t.members.map((m) => h.firstName(h.nameOf(m))).join(", ");
  const smartN = h.smartCount();
  const chgN = h.pendingChanges();
  return `<div class="hub">
    <section class="tcover ${cover ? "has-img" : ""}" ${cover ? `style="--cover:url('${h.cssUrl(cover)}')"` : ""}>
      <button class="chip ghost round cover-btn" data-action="coverPick" title="Change cover" aria-label="Change cover">${h.ic("image")}<span>Change cover</span></button>
      <div class="tc-main">
        <div class="eyebrow">${esc(where)}</div>
        <h2>${esc(t.name)}</h2>
        <div class="hero-meta">
          ${t.startDate ? `<span class="pill">${h.shortDay(h.dayDate(0))} – ${h.shortDay(end)}</span>` : `<button class="pill pill-btn" data-action="editTrip">Set dates</button>`}
          <span class="pill">${plural(t.days.length, "day")}</span>
          ${w.length ? `<span class="pill">${h.wxIcon(w[0]?.icon) || h.ic("sun-cloud")} ${Math.min(...w.map((d) => d.min))}–${Math.max(...w.map((d) => d.max))}°C</span>` : ""}
        </div>
      </div>
    </section>
    <section class="hub-people">
      <span class="avs">${avatars}</span>
      <span class="hp-t"><b>${esc(names)}</b><small>${budget ? `${h.money(c.total)} of ${h.money(budget)} planned` : `${h.money(c.total)} planned`}</small></span>
      <button class="btn-s" data-action="invite">${h.ic("people")} Invite</button>
      <button class="btn-s" data-action="editTrip">${h.ic("settings")} Edit trip</button>
    </section>
    ${budget ? `<div class="hub-bar ${c.total > budget ? "over" : ""}"><i style="width:${pct}%"></i></div>` : ""}
    <nav class="hub-list" aria-label="Trip">
      ${row(h, { icon: "ticket", label: "Bookings", status: st.bookings, tab: "kit", scroll: "bk-sec" })}
      ${row(h, { icon: "backpack", label: "Packing and to-dos", status: st.packing, tab: "kit", scroll: "kit-pack" })}
      ${row(h, { icon: "note", label: "Trip notes", status: st.notes, tab: "kit", scroll: "kit-notes" })}
      ${row(h, { icon: "wallet", label: "Budget", status: st.budget, tab: "budget" })}
      ${row(h, { icon: "alert", label: "Ask and things to check", status: smartN ? plural(smartN, "thing") + " to check" : "Ask for changes, plan, check", action: "ask", warn: smartN > 0, count: smartN || 0 })}
      ${row(h, { icon: "compass", label: "Discover", status: "Top food, sights and stays", tab: "discover" })}
      <details class="hub-about"><summary class="hub-row"><span class="hr-ic">${h.ic("sun-cloud")}</span><span class="hr-t"><b>About and weather</b><small>${esc(st.about)}</small></span><span class="hr-go">${h.ic("arrow-down")}</span></summary>
        <div class="ha-body">${t.place?.extract ? `<p>${esc(t.place.extract)}</p>${t.place.url ? `<a href="${esc(t.place.url)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a>` : ""}` : `<p class="muted small">No place summary yet. Set a destination in Edit trip.</p>`}
          ${w.length ? `<p class="small muted">${t.weather.kind === "forecast" ? "Forecast" : "Same dates last year"}: ${Math.min(...w.map((d) => d.min))}–${Math.max(...w.map((d) => d.max))}°C over ${plural(w.length, "day")}.</p>` : ""}</div>
      </details>
      ${row(h, { icon: "heart", label: "Preferences", status: "Pace, food, stay and interests", action: "editProfile" })}
      ${S.aiUser ? row(h, { icon: "sparkle", label: "Connect Claude", status: "Link this trip to your Claude project", action: "bridgeOpen" }) + row(h, { icon: "plug", label: "Connector", status: "Use Trips from Claude or Gemini", action: "connectorOpen" }) + row(h, { icon: "robot", label: "Gemini key", status: h.hasKey() ? "Connected" : "Free, optional", action: "aiSettings" }) : ""}
      ${row(h, { icon: "clock", label: "Activity and undo", status: chgN ? plural(chgN, "change") + " waiting" : st.activity, tab: "changes", count: chgN || 0, warn: chgN > 0 })}
      ${row(h, { icon: "note", label: "Itinerary", status: "Print, copy, calendar", tab: "itinerary" })}
      ${row(h, { icon: "folder", label: "Drive folder", status: "Where the final plan is saved", tab: "kit", scroll: "drive-folder" })}
    </nav>
  </div>`;
}
