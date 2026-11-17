// Ask: one full screen for everything the assistants do. Opens from the header's Ask button (S.askOpen), closes with Back, Escape or the arrow.
// From the top: ask for a change, plan the days (Fill empty days, Gemini, Claude, from notes), things to check (Smart suggestions),
// Analyse plan, the Gemini review, and a link to Activity. Friends (not AI users) get Fill empty days and Things to check only.
// html(h) gets { S, esc, ic, smartList, smartAll, canFill, geminiWait, aiKey, changeBox, notesPlan, review }.

const KIND_ICON = { veg: "leaf", rest: "coffee", splurge: "sparkle", route: "map", car: "car", legs: "train", load: "scale", must: "star", fill: "plan", spread: "pin", hop: "train", fair: "handshake", budget: "wallet", locate: "search", leg: "walk" };

const sel = (key, opts, val) => `<select data-pref="${key}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("")}</select>`;

export function checksHtml(h) {
  const { S, esc, ic } = h;
  const p = S.trip.prefs || {};
  const list = h.smartList();
  const hidden = h.smartAll().length - list.length;
  const fixes = list.filter((x) => x.level === "fix" && x.changes.length);
  return `<section class="ask-card" id="ask-checks">
    <h3>${ic("alert")} Things to check${list.length ? ` <span class="count ${fixes.length ? "warnc" : ""}">${list.length}</span>` : ""}</h3>
    <p class="muted small">Suggestions update as either of you edits. Times are estimates: check exact times and fares with Directions.</p>
    <div class="smart-prefs">
      <label>Pace ${sel("pace", [["relaxed", "Relaxed (≈7 h a day)"], ["balanced", "Balanced (≈9 h)"], ["packed", "Packed (≈11 h)"]], p.pace || "balanced")}</label>
      <label>Getting around ${sel("travel", [["mixed", "Whatever's best"], ["transit", "Prefer public transport"], ["car", "We'll have a car"]], p.travel || "mixed")}</label>
      <label>Finish by ${sel("dayEnd", [["20:00", "8 pm"], ["21:00", "9 pm"], ["22:00", "10 pm"], ["23:30", "Late"]], p.dayEnd || "22:00")}</label>
    </div>
    <div class="smart-actions">
      <button class="btn-s primary" data-action="analyse" ${S.analysing ? "disabled" : ""}>${S.analysing ? esc(S.analysing) : `${ic("search")} Analyse plan`}</button>
      ${fixes.length > 1 ? `<button class="btn-s" data-action="applyAll">Apply all ${fixes.length} fixes</button>` : ""}
      ${hidden ? `<button class="link" data-action="undismiss">Show ${hidden} dismissed</button>` : ""}
    </div>
    <p class="muted small">“Analyse plan” looks up places on the map so routes and travel times can be worked out.</p>
    ${list.length ? list.map((x) => `<article class="sug ${x.level}">
        <div class="sug-ic">${ic(KIND_ICON[x.kind] || "sparkle")}</div>
        <div class="sug-body">
          <div class="sug-title">${esc(x.title)}</div>
          ${x.detail ? `<div class="sug-detail">${esc(x.detail).replace(/\n/g, "<br>")}</div>` : ""}
        </div>
        <div class="sug-act">
          ${x.changes.length ? `<button class="btn-s primary" data-action="applySug" data-id="${esc(x.id)}">Apply</button>` : ""}
          <button class="btn-s" data-action="dismissSug" data-id="${esc(x.id)}">Dismiss</button>
        </div>
      </article>`).join("") : `<p class="empty">${ic("check-circle")} The plan looks good. Nothing to fix right now.</p>`}
  </section>`;
}

export function planHtml(h) {
  const { S, esc, ic } = h;
  const t = S.trip;
  const gem = h.aiKey();
  const anyEmpty = h.canFill();
  const lim = gem && h.geminiWait() ? `<p class="muted small">Gemini's free limit is used up until ${new Date(h.geminiWait()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Until then the planner uses its own rules and the travel guide.</p>` : "";
  const why = t.proposal ? "A drafted plan is waiting for review on the Plan tab."
    : S.planning ? esc(S.planning)
    : !anyEmpty ? "Every day already has stops, so there is nothing to fill."
    : !t.guide?.listings?.length ? "The travel guide is still loading for this place."
    : "Days fill only when you ask. Nothing is filled automatically.";
  return `<section class="ask-card" id="ask-plan">
    <h3>${ic("plan")} Plan the days</h3>
    <div class="ask-btns">
      <button class="btn-s primary" data-action="buildSample" ${anyEmpty && !t.proposal && !S.planning && t.guide?.listings?.length ? "" : "disabled"}>${ic("sparkle")} Fill empty days</button>
      ${gem ? `<button class="btn-s" data-action="geminiPlan" ${h.geminiWait() || t.proposal || S.planning ? "disabled" : ""}>${ic("robot")} Plan with Gemini</button>` : ""}
      ${S.aiUser ? `<button class="btn-s" data-action="claudePlan">${ic("sparkle")} Plan with Claude</button>` : ""}
    </div>
    <p class="muted small ask-why">${why}</p>
    ${lim}
    ${h.notesPlan()}
  </section>`;
}

export function html(h) {
  const { S, esc, ic } = h;
  const t = S.trip;
  const ai = !!S.aiUser;
  return `<section class="ask-screen">
    <header class="thead">
      <button class="tb-btn tb-back" data-action="askClose" aria-label="Back" title="Back">${ic("arrow-left")}</button>
      <div class="tb-title"><h1>Ask</h1><small>${esc(t.name)}</small></div>
    </header>
    <div class="ask-body">
      ${h.undoBar()}
      ${ai ? `<section class="ask-card" id="ask-change">
        <h3>${ic("comment")} Ask for a change</h3>
        ${h.changeBox()}
        <p class="muted small">Changes are applied straight away. Undo is always one tap away, and every change is listed in Activity.</p>
      </section>` : ""}
      ${planHtml(h)}
      ${checksHtml(h)}
      ${ai ? `<section class="ask-card" id="ask-review">${h.review()}</section>` : ""}
      <button class="hub-row ask-activity" data-action="tab" data-tab="changes"><span class="hr-ic">${ic("clock")}</span><span class="hr-t"><b>Activity and undo</b><small>Every change, with Undo</small></span><span class="hr-go">${ic("arrow-right")}</span></button>
    </div>
  </section>`;
}

const CSS = `
.ask-screen { max-width: 720px; margin: 0 auto; padding-bottom: 40px; }
.ask-body { display: grid; gap: 14px; padding-top: 12px; }
.ask-card { background: var(--panel); border-radius: 16px; box-shadow: var(--shadow); padding: 14px; min-width: 0; }
.ask-card h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-family: var(--display); font-size: 18px; }
.ask-card h3 .i { width: 20px; height: 20px; }
.ask-card .chg { margin: 0; }
.ask-card .chg-btns { display: flex; }
.ask-card .ai-box { background: none; box-shadow: none; padding: 0; }
.ask-card .ai-box .d-head h3 { font-size: 18px; }
.ask-card .nt-plan { margin-top: 12px; }
.ask-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.ask-btns .btn-s, .ask-card .smart-actions .btn-s { min-height: 44px; }
.ask-why { margin: 8px 0 0; }
.ask-card .smart-prefs { margin: 10px 0; }
.ask-card .smart-actions { margin-bottom: 6px; }
.ask-activity { width: 100%; }
@media (max-width: 700px) { .ask-card .sug { flex-wrap: wrap; } .ask-card .sug-body { flex: 1 1 calc(100% - 40px); } .ask-card .sug-act { flex: 1 1 100%; justify-content: flex-start; padding-left: 34px; } }
`;

export function init(ctx) {
  document.head.append(Object.assign(document.createElement("style"), { id: "css-ask", textContent: CSS }));
}
