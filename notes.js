// Trip notes: free text for the whole trip, shared live. Claude (or Gemini) can turn the open ones into plan changes.
// Notes live on the trip doc as `tripNotes`; they only leave the app through the Plan buttons and the Claude link snapshot.
import { QuotaError, geminiWait } from "./ai.js";
import { changePlan, proposeChanges } from "./changes.js";

const MAX_NOTES = 100;
const MAX_CHARS = 2000;
const SNAP_CHARS = 12000;
const REQUEST = "Plan from our trip notes";
const RULES = `Our open trip notes are in the plan JSON under "tripNotes". Turn each one into changes: real named places become \`add\` ops (on the day the note says, else toDay null for Ideas), wishes about a day become \`day\`/\`move\`/\`time\` ops, things to book or pack become \`check\` ops, booking details become \`booking\` ops. Skip a note that is already reflected in the plan or is only a remark. Don't remove anything the notes don't ask to remove. Set "request" to "${REQUEST}".`;
const PH = `Anything for the trip: a place a friend mentioned, "Day 2 should be slow", "book the train"…`;
const CSS = `
.nt-ta { width: 100%; min-height: 84px; resize: vertical; font-size: 15px; }
.nt-add { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 8px; }
.nt-list { list-style: none; margin: 12px 0 0; padding: 0; }
.nt-row { display: flex; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--line); }
.nt-row input[type=checkbox] { width: 20px; height: 20px; flex: none; margin-top: 2px; accent-color: var(--accent); }
.nt-body { flex: 1; min-width: 0; }
.nt-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.nt-meta { margin-top: 3px; }
.nt-acts { display: flex; gap: 12px; margin-top: 4px; }
.nt-row.done .nt-text { color: var(--muted); text-decoration: line-through; }
.nt-done { margin-top: 10px; }
.nt-done > summary { cursor: pointer; color: var(--muted); font-size: 14px; padding: 6px 0; }
.nt-plan { margin-top: 14px; padding: 12px 14px; background: var(--accent-soft); border-radius: 12px; }
.nt-plan .nt-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
`;

const clean = (s) => String(s || "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_CHARS);

export function init(ctx) {
  const { S, esc } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-notes", textContent: CSS }));
  let draft = ""; // typed-but-unsent note, kept across re-renders
  let doneOpen = false;
  let busy = false;

  const all = () => (Array.isArray(S.trip?.tripNotes) ? S.trip.tripNotes : []);
  const open = () => all().filter((n) => !n.done);
  const byName = (n) => ctx.firstName(n.byName || ctx.nameOf(n.by));
  const canGemini = () => !!ctx.aiKey() && !geminiWait();

  /* ---------------------------------------------------------------- writes */
  // Every write re-reads the notes inside the transaction, so two people adding at once keep both.
  async function write(fn) {
    let full = false;
    await S.store.txTrip(S.tripId, (cur) => {
      const next = fn([...(cur.tripNotes || [])]);
      if (next === "full") return (full = true), null;
      return next ? { tripNotes: next, ...ctx.stampMe() } : null;
    });
    return !full;
  }
  async function addNote(raw) {
    const text = clean(raw);
    if (!text) return false;
    const note = { id: ctx.uid(), text, by: S.me.email, byName: S.me.name, at: Date.now(), done: false };
    const added = await write((l) => (l.length >= MAX_NOTES ? "full" : [...l, note]));
    if (!added) return ctx.toast(`That's the limit of ${MAX_NOTES} notes. Delete or clear a few first.`, 5000), false;
    ctx.log("added a trip note");
    return true;
  }

  /* ------------------------------------------------------------- Kit section */
  function noteRow(n) {
    const E = esc, edited = n.editedAt ? ` · edited${n.editedByName ? " by " + E(ctx.firstName(n.editedByName)) : ""}` : "";
    return `<li class="nt-row ${n.done ? "done" : ""}" data-nid="${E(n.id)}">
      <input type="checkbox" data-action="noteTick" data-id="${E(n.id)}" ${n.done ? "checked" : ""} aria-label="Done: ${E(n.text.slice(0, 40))}">
      <div class="nt-body">
        <div class="nt-text">${E(n.text)}</div>
        <div class="muted small nt-meta">${E(byName(n))} · ${E(ctx.ago(n.at))}${edited}</div>
        <div class="nt-acts"><button class="link" data-action="noteEdit" data-id="${E(n.id)}">Edit</button><button class="link" data-action="noteDel" data-id="${E(n.id)}">Delete</button></div>
      </div>
    </li>`;
  }
  function planRow() {
    if (!S.aiUser || !open().length) return "";
    const gem = ctx.aiKey(), claudeFirst = !gem;
    return `<div class="nt-plan">
      <div class="nt-btns">
        <button class="${claudeFirst ? "btn-s primary" : "btn-s"}" data-action="notePlanClaude">🟠 Plan from notes with Claude</button>
        ${canGemini() ? `<button class="btn-s" data-action="notePlanGemini" ${busy ? "disabled" : ""}>${busy ? "Gemini is working on it…" : "Plan from notes with Gemini"}</button>` : ""}
      </div>
      <p class="muted small" style="margin:0">Claude reads your open notes and suggests changes. Nothing changes until you tap Apply.</p>
    </div>`;
  }
  function section() {
    if (!S.trip) return "";
    const list = all().slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const todo = list.filter((n) => !n.done), done = list.filter((n) => n.done);
    return `<section class="d-sec nt-sec" id="kit-notes">
      <div class="d-head"><h3>📝 Trip notes</h3>${todo.length ? `<span class="muted small">${todo.length} open</span>` : ""}</div>
      <textarea id="ntNew" class="nt-ta" maxlength="${MAX_CHARS}" placeholder="${esc(PH)}" aria-label="New trip note">${esc(draft)}</textarea>
      <div class="nt-add"><span class="muted small">Ctrl+Enter adds</span><button class="btn-s primary" data-action="noteAdd">Add note</button></div>
      ${planRow()}
      ${list.length ? `<ul class="nt-list">${todo.map(noteRow).join("")}</ul>` : `<p class="empty small">No notes yet. Jot down ideas, wishes or reminders here; both of you see them live.</p>`}
      ${done.length ? `<details class="nt-done" ${doneOpen ? "open" : ""}><summary>Done (${done.length})</summary><ul class="nt-list">${done.map(noteRow).join("")}</ul></details>` : ""}
    </section>`;
  }
  const restoreDraft = () => {
    const el = document.getElementById("ntNew");
    if (el && el.value !== draft && document.activeElement !== el) el.value = draft;
  };

  /* ---------------------------------------------------------------- actions */
  async function add() {
    const el = document.getElementById("ntNew");
    const text = clean(el?.value ?? draft);
    if (!text) return el?.focus();
    draft = ""; if (el) el.value = "";
    if (!(await addNote(text))) { draft = text; if (el) el.value = text; }
  }
  function quick() {
    if (!S.trip) return ctx.toast("Open a trip first.");
    ctx.openModal(`<h3>🗒️ Add a trip note</h3>
      <label>Note<textarea name="text" class="nt-ta" rows="5" maxlength="${MAX_CHARS}" placeholder="${esc(PH)}" required></textarea></label>
      <p class="muted small">You both see it on the Kit tab, and Claude can use it when you ask it to plan from your notes.</p>`, async (fd) => {
      if (!clean(fd.text)) return false;
      if (!(await addNote(fd.text))) return false;
      ctx.toast("Note added. It's on the Kit tab.");
    });
    ctx.$form.querySelector("button[value=ok]").textContent = "Add note";
    ctx.$form.querySelector("textarea").focus();
  }
  function edit(btn, id) {
    const n = all().find((x) => x.id === id);
    if (!n) return;
    ctx.openModal(`<h3>Edit note</h3>
      <label>Note<textarea name="text" class="nt-ta" rows="6" maxlength="${MAX_CHARS}" required>${esc(n.text)}</textarea></label>`, async (fd) => {
      const text = clean(fd.text);
      if (!text) return false;
      if (text === n.text) return;
      let found = false;
      await write((l) => l.map((x) => (x.id !== id ? x : ((found = true), { ...x, text, editedAt: Date.now(), editedByName: S.me.name }))));
      if (!found) return ctx.toast("That note was deleted."), undefined;
      ctx.log("edited a trip note");
    });
    ctx.$form.querySelector("textarea").setSelectionRange(n.text.length, n.text.length);
  }
  async function tick(btn, id) {
    await write((l) => l.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  }
  async function del(btn, id) {
    const n = all().find((x) => x.id === id);
    if (!n || !confirm("Delete this note?")) return;
    await write((l) => l.filter((x) => x.id !== id));
    ctx.log("deleted a trip note");
  }

  /* -------------------------------------------------------------- planning */
  function planClaude() {
    if (!open().length) return ctx.toast("Add a note first.");
    return ctx.askClaudeFor(REQUEST, { lead: "Please work our trip notes into our trip plan.", extra: RULES });
  }
  async function planGemini() {
    if (!open().length) return ctx.toast("Add a note first.");
    if (busy || !canGemini()) return;
    busy = true;
    ctx.render();
    try {
      const r = await changePlan(ctx.aiKey(), ctx.planSnapshot(), REQUEST, ctx.profileText(ctx.profileOf(S.trip)), RULES);
      if (!r.ops.length) return ctx.toast("Gemini didn't find anything new to change from your notes.", 5000);
      const res = await proposeChanges({ source: "Gemini", request: REQUEST, summary: r.summary, ops: r.ops });
      ctx.toast(`Gemini suggests ${res.count} change${res.count > 1 ? "s" : ""}. Review them before anything changes.`, 5000);
      // A late answer must not replace a form someone is typing in: with a window open, the banner is enough.
      if (!ctx.$modal.open) setTimeout(() => { if (!ctx.$modal.open) ctx.openChanges(); }, 300);
    } catch (e) {
      console.warn("notes", e);
      ctx.toast(e instanceof QuotaError ? e.message : "Gemini couldn't do that: " + e.message, e instanceof QuotaError ? 9000 : 5000);
    } finally {
      busy = false;
      ctx.render();
    }
  }

  /* ------------------------------------------------------------------ wiring */
  ctx.slot("kitTop", section);
  ctx.slot("addBar", () => `<button class="icon" data-action="noteQuick" title="Add a trip note" aria-label="Add a trip note" data-label="Add a trip note" data-sub="For both of you, and for Claude">🗒️</button>`);
  // Open notes only, newest last, capped in size (oldest dropped first). First names only, never emails.
  ctx.slot("snapshot", (snap) => {
    let left = SNAP_CHARS;
    const out = [];
    for (const n of open().slice().sort((a, b) => (b.at || 0) - (a.at || 0))) {
      const text = String(n.text || "").slice(0, MAX_CHARS);
      if (left - text.length < 0) break;
      left -= text.length;
      out.push({ id: n.id, by: byName(n), at: new Date(n.at || 0).toISOString(), text });
    }
    if (out.length) snap.tripNotes = out.reverse();
  });
  ctx.action("noteAdd", add);
  ctx.action("noteQuick", quick);
  ctx.action("noteEdit", edit);
  ctx.action("noteTick", tick);
  ctx.action("noteDel", del);
  ctx.action("notePlanClaude", planClaude);
  ctx.action("notePlanGemini", planGemini);
  document.addEventListener("input", (e) => { if (e.target.id === "ntNew") draft = e.target.value; });
  document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("nt-done")) doneOpen = e.target.open; }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    if (e.target.id === "ntNew") { e.preventDefault(); add(); }
    else if (e.target.classList?.contains("nt-ta") && e.target.closest("#modalForm")) { e.preventDefault(); ctx.$form.requestSubmit(ctx.$form.querySelector("button[value=ok]")); }
  });
  ctx.on("render", restoreDraft);
}
