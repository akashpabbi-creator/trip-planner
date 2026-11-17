// Plan, one day at a time: the date strip (status dots, All days), the All days overview, the empty-day buttons and swipe between days.
// The day itself (head, stops, legs, foot) is still drawn by app.js; this module decides which day shows and draws the pieces around it.
// h is a bag of app helpers: { S, esc, ic, dayDate, fmtDay, today, schedule, dayItems, dayCost, money, checks, dayWeather }.

// "empty" (nothing on the day), "check" (a warning on the day, or a food stop with no veg options / unchecked), or "planned".
export function dayStatus(h, i) {
  const d = h.S.trip.days[i];
  if (!d) return "empty";
  const items = h.dayItems(d.id);
  if (!items.length) return "empty";
  if (h.checks().some((c) => c.day === i && c.level !== "info")) return "check";
  if (items.some((it) => it.category === "food" && it.veg !== "yes")) return "check";
  return "planned";
}
const STATUS_TXT = { empty: "nothing planned", planned: "planned", check: "something to check" };

// Which day shows. A freshly opened trip lands on the linked day, else today during the trip, else Day 1.
export function selected(h) {
  const S = h.S, n = S.trip?.days?.length || 0;
  if (!n) return 0;
  if (S.scrollToday && S.items && S.tab === "plan") {
    const l = S.linkDay != null && S.linkDay < n ? S.linkDay : h.today();
    if (l >= 0) { S.stripDay = l; S.planAll = false; }
  }
  return Math.max(0, Math.min(S.stripDay || 0, n - 1));
}

export function stripHtml(h) {
  const S = h.S, t = S.trip;
  if (!t.days.length) return "";
  const ti = h.today();
  const act = selected(h);
  const all = `<button class="dchip all ${S.planAll ? "on" : ""}" data-action="planAll" aria-pressed="${!!S.planAll}" aria-label="All days"><small>View</small><b>All</b><span>${t.days.length} day${t.days.length === 1 ? "" : "s"}</span></button>`;
  return `<nav class="dstrip" aria-label="Days">${all}${t.days.map((d, i) => {
    const dt = h.dayDate(i);
    const st = dayStatus(h, i);
    const on = !S.planAll && i === act;
    return `<button class="dchip ${on ? "on" : ""} ${i === ti ? "today" : ""} st-${st}" data-action="dayJump" data-i="${i}" aria-pressed="${on}" aria-label="Day ${i + 1}${dt ? ", " + h.fmtDay(dt) : ""}, ${STATUS_TXT[st]}"><small>${dt ? dt.toLocaleDateString(undefined, { weekday: "short" }) : "Day"}</small><b>${dt ? dt.getDate() : i + 1}</b><span>${h.esc(d.base || "")}</span><i class="sdot" aria-hidden="true"></i></button>`;
  }).join("")}</nav>`;
}

// All days: one quiet row per day. Tap a row to open that day.
export function overviewHtml(h) {
  const S = h.S, t = S.trip, ti = h.today();
  return `<div class="ov-list">${t.days.map((d, i) => {
    const sch = h.schedule(d.id);
    const dt = h.dayDate(i);
    const st = dayStatus(h, i);
    const cost = h.dayCost(d.id);
    const titles = sch.slice(0, 3).map((s) => h.esc(s.it.title || "Untitled")).join(" · ") + (sch.length > 3 ? ` · +${sch.length - 3}` : "");
    const head = d.title || d.base || "";
    return `<button class="ov-row st-${st} ${i === ti ? "today" : ""}" data-action="dayJump" data-i="${i}" aria-label="Open Day ${i + 1}, ${STATUS_TXT[st]}">
      <span class="date-tile"><small>${dt ? dt.toLocaleDateString(undefined, { month: "short" }) : "Day"}</small><b>${dt ? dt.getDate() : i + 1}</b></span>
      <span class="ov-t"><b>Day ${i + 1}${head ? ` · ${h.esc(head)}` : ""}${i === ti ? ` <span class="tag today-tag">Today</span>` : ""}</b>
        <small>${sch.length ? `${sch.length} stop${sch.length === 1 ? "" : "s"}${cost ? " · " + h.money(cost) : ""}${h.dayWeather(i) ? " ·" + h.dayWeather(i) : ""}` : "Nothing planned yet"}</small>
        ${titles ? `<small class="ov-stops">${titles}</small>` : ""}</span>
      <i class="sdot" aria-hidden="true"></i><span class="ov-go">${h.ic("arrow-right")}</span>
    </button>`;
  }).join("")}</div>`;
}

export function init(ctx) {
  const S = ctx.S;
  ctx.action("planAll", () => {
    S.planAll = !S.planAll;
    ctx.render();
    window.scrollTo(0, 0);
  });
  // Swipe left or right on a phone to go to the next or previous day.
  let t0 = null;
  const skip = "input, textarea, select, .dstrip, .leaflet-container, .mp-wrap, .modal, dialog, [draggable=true], .leg-btn, .al-panel";
  const root = document.getElementById("app") || document.body;
  root.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    t0 = e.touches.length === 1 && S.tab === "plan" && !S.planAll && S.trip && !e.target.closest?.(skip) ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  root.addEventListener("touchend", (e) => {
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y, dt = Date.now() - t0.at;
    t0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 900) return;
    const n = S.trip?.days?.length || 0;
    const to = Math.max(0, Math.min(n - 1, (S.stripDay || 0) + (dx < 0 ? 1 : -1)));
    if (to === (S.stripDay || 0)) return;
    S.stripDay = to;
    ctx.render();
    window.scrollTo(0, 0);
  }, { passive: true });
  // Left and right arrow keys do the same on a keyboard (not while typing).
  document.addEventListener("keydown", (e) => {
    if (S.tab !== "plan" || S.planAll || !S.trip || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (document.querySelector("dialog[open]") || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    const n = S.trip.days.length;
    const to = Math.max(0, Math.min(n - 1, (S.stripDay || 0) + (e.key === "ArrowRight" ? 1 : -1)));
    if (to === (S.stripDay || 0)) return;
    S.stripDay = to;
    ctx.render();
  });
}
