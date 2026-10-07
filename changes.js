// Ask for a change: one line on the Plan tab. Gemini or Claude turns a request into a list of small changes ("ops"),
// which wait on the trip as a proposal. Nothing is applied until someone taps Apply. This module also owns the ops engine
// (applyOp / opText), shared with the Claude link (bridge.js).
import { call, parseJson, QuotaError, geminiWait } from "./ai.js";
import { geocode, has } from "./smart.js";

let ctx;
const BOOKING_KINDS = ["flight", "hotel", "train", "bus", "ferry", "car", "tickets", "other"];
const OP_TYPES = ["move", "remove", "add", "time", "transport", "day", "veg", "note", "booking", "check"];

// The change formats, written once for every prompt and for the Claude snapshot.
export const OP_FORMATS = {
  move: `{"type":"move","itemId":"<id>","toDay":2,"time":"HH:MM (optional)","why":"one sentence"}`,
  remove: `{"type":"remove","itemId":"<id>","why":"..."}  (sends the stop back to Ideas, never deletes)`,
  add: `{"type":"add","place":{"name":"","category":"sight|activity|food|stay|shopping|nature|transport|other","location":"street, area","durationMin":60,"cost":0,"why":"","veg":"yes|no (food only)","vegNote":"","url":""},"toDay":2 or null for Ideas,"time":"HH:MM (optional)","why":"..."}`,
  time: `{"type":"time","itemId":"<id>","time":"HH:MM or empty to clear","why":"..."}`,
  transport: `{"type":"transport","itemId":"<id>","mode":"walk|transit|bus|train|car|rental|taxi|bike|ferry|flight","minutes":20,"cost":0,"why":"..."}  (how to get TO that stop from the one before it)`,
  day: `{"type":"day","day":2,"title":"","base":"town staying in","notes":"","why":"..."}`,
  veg: `{"type":"veg","itemId":"<id>","veg":"yes|no|empty","note":"what vegetarians can eat, up to 12 words"}`,
  note: `{"type":"note","itemId":"<id>","notes":"replaces the stop's notes"}`,
  booking: `{"type":"booking","booking":{"kind":"flight|hotel|train|bus|ferry|car|tickets|other","title":"","ref":"confirmation code","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","from":"","to":"","address":"","cost":0,"currency":"INR","notes":""}}`,
  check: `{"type":"check","text":"Travel adapter","group":"pack|todo"}`,
};

/* --------------------------------------------------------------- cleaning */
const str = (v, n = 200) => (v == null ? "" : String(v).slice(0, n)).trim();
const num = (v) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : 0);
// "9:5" is not a time; "9:30" becomes "09:30". Returns "" for none, null for something that isn't a time.
function hhmm(v) {
  if (v == null || v === "") return "";
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return m[1].padStart(2, "0") + ":" + m[2];
}
// Keeps only the fields each change type uses, so a stray or oversized answer can't put junk on the trip.
export function cleanOp(o) {
  if (!o || typeof o !== "object") return null;
  const type = str(o.type, 20).toLowerCase();
  const out = { type };
  if (o.why) out.why = str(o.why, 240);
  const id = () => str(o.itemId ?? o.id, 80);
  if (type === "move") Object.assign(out, { itemId: id(), toDay: Math.round(num(o.toDay)), ...(o.time ? { time: str(o.time, 8) } : {}), ...(typeof o.order === "number" && Number.isFinite(o.order) ? { order: o.order } : {}) }); // order: internal (Shuffle keeps a stop's place)
  else if (type === "remove") out.itemId = id();
  else if (type === "time") Object.assign(out, { itemId: id(), time: str(o.time, 8) });
  else if (type === "transport") Object.assign(out, { itemId: id(), mode: str(o.mode, 20), minutes: Math.round(num(o.minutes)), ...(o.cost != null && o.cost !== "" ? { cost: num(o.cost) } : {}) });
  else if (type === "day") Object.assign(out, { day: Math.round(num(o.day)), ...["title", "base", "notes"].reduce((a, k) => (o[k] != null ? { ...a, [k]: str(o[k], k === "notes" ? 400 : 120) } : a), {}) });
  else if (type === "veg") Object.assign(out, { itemId: id(), veg: str(o.veg, 4).toLowerCase(), note: str(o.note ?? o.vegNote, 160) });
  else if (type === "note") Object.assign(out, { itemId: id(), notes: str(o.notes ?? o.note, 600) });
  else if (type === "check") Object.assign(out, { text: str(o.text, 140), group: str(o.group, 6) === "pack" ? "pack" : "todo" });
  else if (type === "add") {
    const p = o.place || {};
    Object.assign(out, {
      place: {
        name: str(p.name ?? p.title, 140), category: str(p.category, 12).toLowerCase(), location: str(p.location ?? p.address, 200),
        durationMin: Math.round(num(p.durationMin)) || 60, cost: num(p.cost), why: str(p.why, 240),
        ...(p.veg ? { veg: str(p.veg, 4).toLowerCase() } : {}), ...(p.vegNote ? { vegNote: str(p.vegNote, 160) } : {}), ...(p.url ? { url: str(p.url, 400) } : {}),
      },
      toDay: o.toDay == null || o.toDay === "" ? null : Math.round(num(o.toDay)),
      ...(o.time ? { time: str(o.time, 8) } : {}),
    });
  } else if (type === "booking") {
    const b = o.booking || {};
    out.booking = {
      kind: str(b.kind, 10).toLowerCase(), title: str(b.title, 140), ref: str(b.ref, 60), start: str(b.start, 16), end: str(b.end, 16),
      from: str(b.from, 120), to: str(b.to, 120), address: str(b.address, 200), cost: num(b.cost), currency: str(b.currency, 4).toUpperCase(), notes: str(b.notes, 400),
    };
  }
  return out;
}
export const cleanOps = (ops) => (Array.isArray(ops) ? ops : []).slice(0, 40).map(cleanOp).filter(Boolean);

/* ------------------------------------------------------------- ops engine */
const itemOf = (id) => ctx.S.items.find((i) => i.id === id);
const nameFor = (id) => itemOf(id)?.title || "a stop that's no longer here";
const dayId = (n) => ctx.S.trip.days[n - 1]?.id || null;
const q = (s) => `“${s}”`;

// Returns "" when the change can be applied, otherwise a plain-words reason.
export function problem(op) {
  const t = ctx.S.trip;
  const nDays = t.days.length;
  const needItem = () => (itemOf(op.itemId) ? "" : "That stop isn't in your trip any more.");
  const needDay = (n) => (Number.isInteger(n) && n >= 1 && n <= nDays ? "" : `Day ${n || "?"} doesn't exist (the trip has ${nDays} day${nDays === 1 ? "" : "s"}).`);
  switch (op.type) {
    case "move": return needItem() || needDay(op.toDay) || (op.time && hhmm(op.time) === null ? "That isn't a time." : "");
    case "remove": return needItem() || (dayId2(itemOf(op.itemId)) ? "" : "It's already in Ideas.");
    case "time": return needItem() || (hhmm(op.time) === null ? "That isn't a time." : "");
    case "transport": return needItem() || (ctx.MODES[op.mode] ? "" : "Unknown way of getting there.");
    case "day": return needDay(op.day) || (["title", "base", "notes"].some((k) => k in op) ? "" : "Nothing to change.");
    case "veg": return needItem() || (["yes", "no", ""].includes(op.veg) ? "" : "Vegetarian answer should be yes or no.");
    case "note": return needItem();
    case "check": return op.text ? "" : "Needs some text.";
    case "booking": {
      const b = op.booking || {};
      return BOOKING_KINDS.includes(b.kind) ? (b.title || b.ref ? "" : "Needs a title or a reference.") : "Unknown kind of booking.";
    }
    case "add": {
      const p = op.place || {};
      if (!p.name) return "Needs a name.";
      if (op.toDay != null && needDay(op.toDay)) return needDay(op.toDay);
      if (op.time && hhmm(op.time) === null) return "That isn't a time.";
      // Restaurants need good vegetarian options (they don't have to be pure veg).
      if (p.category === "food" && p.veg === "no") return "Few vegetarian options, so it isn't added.";
      return "";
    }
    default: return "The app doesn't know this kind of change.";
  }
}
const dayId2 = (it) => it && ctx.S.trip.days.some((d) => d.id === it.dayId);

// A change in plain words.
export function opText(op) {
  const d = (n) => `Day ${n}`;
  const at = (t) => (t && hhmm(t) ? ` at ${hhmm(t)}` : "");
  switch (op?.type) {
    case "move": return `Move ${q(nameFor(op.itemId))} to ${d(op.toDay)}${at(op.time)}`;
    case "remove": return `Take ${q(nameFor(op.itemId))} off its day (back to Ideas)`;
    case "time": return op.time ? `Set ${q(nameFor(op.itemId))} to ${hhmm(op.time) || op.time}` : `Let ${q(nameFor(op.itemId))} float (no fixed time)`;
    case "transport": return `Get to ${q(nameFor(op.itemId))} by ${ctx.MODES[op.mode]?.label.toLowerCase() || op.mode}${op.minutes ? `, about ${ctx.dur(op.minutes)}` : ""}`;
    case "day": return `${d(op.day)}: ${[op.title && `call it ${q(op.title)}`, op.base && `staying in ${op.base}`, op.notes && `note ${q(op.notes)}`].filter(Boolean).join(", ") || "no change"}`;
    case "veg": return `Mark ${q(nameFor(op.itemId))} as ${op.veg === "yes" ? "good for vegetarians" : op.veg === "no" ? "few vegetarian options" : "not checked"}${op.note ? `: ${op.note}` : ""}`;
    case "note": return `Note on ${q(nameFor(op.itemId))}: ${op.notes}`;
    case "booking": { const b = op.booking || {}; return `Save the ${b.kind || "booking"}${b.title ? ` ${q(b.title)}` : ""}${b.ref ? ` (${b.ref})` : ""}${b.start ? `, ${b.start.replace("T", " ")}` : ""}`; }
    case "check": return `Add ${q(op.text)} to the ${op.group === "pack" ? "packing list" : "to-do list"}`;
    case "add": { const p = op.place || {}; return `Add ${q(p.name)} to ${op.toDay ? d(op.toDay) + at(op.time) : "Ideas"}${p.category === "food" && p.veg === "yes" ? " (vegetarian options)" : ""}`; }
    default: return "A change the app doesn't know";
  }
}

// Applies one change. Returns { ok, note }. `source` ("Gemini" or "Claude") is only used for labels.
export async function applyOp(op, { source = "" } = {}) {
  const { S, uid } = ctx;
  op = cleanOp(op) || { type: "?" };
  const why = problem(op);
  if (why) return { ok: false, note: why };
  const store = S.store, tripId = S.tripId, me = ctx.stampMe();
  const it = itemOf(op.itemId);
  const by = source ? `${source}'s change` : "a change";
  const done = async (text) => { await ctx.log(`applied ${by}: ${text}`); return { ok: true }; };
  switch (op.type) {
    case "move": {
      const id = dayId(op.toDay), time = hhmm(op.time);
      await store.updateItem(tripId, it.id, { dayId: id, order: time ? ctx.orderForTime(id, time) : Number.isFinite(op.order) ? op.order : ctx.nextOrder(id), ...(time ? { time } : {}), userEdited: true, ...me });
      return done(`moved ${q(it.title)} to Day ${op.toDay}`);
    }
    case "remove":
      await store.updateItem(tripId, it.id, { dayId: null, order: 0, time: "", userEdited: true, ...me });
      return done(`took ${q(it.title)} off its day`);
    case "time":
      await store.updateItem(tripId, it.id, { time: hhmm(op.time), userEdited: true, ...me });
      return done(`${op.time ? "set " + q(it.title) + " to " + hhmm(op.time) : "cleared the time of " + q(it.title)}`);
    case "transport": {
      const travel = { ...(it.travel || {}), mode: op.mode, minutes: op.minutes || it.travel?.minutes || 0, ...(op.cost != null ? { cost: op.cost } : {}), auto: false };
      await store.updateItem(tripId, it.id, { travel, userEdited: true, ...me });
      return done(`travel to ${q(it.title)} by ${ctx.MODES[op.mode].label.toLowerCase()}`);
    }
    case "day": {
      const id = dayId(op.day);
      await store.txTrip(tripId, (cur) => ({ days: cur.days.map((d) => (d.id === id ? { ...d, ...["title", "base", "notes"].reduce((a, k) => (k in op ? { ...a, [k]: op[k] } : a), {}) } : d)), ...me }));
      return done(`updated Day ${op.day}`);
    }
    case "veg":
      await store.updateItem(tripId, it.id, { veg: op.veg, vegNote: op.note || "", vegSource: (source || "app").toLowerCase(), ...me });
      return done(`vegetarian check on ${q(it.title)}`);
    case "note":
      await store.updateItem(tripId, it.id, { notes: op.notes, userEdited: true, ...me });
      return done(`note on ${q(it.title)}`);
    case "check": {
      const dup = (ctx.S.trip.checklist || []).some((c) => c.group === op.group && c.text.trim().toLowerCase() === op.text.trim().toLowerCase());
      if (dup) return { ok: true, note: "Already on the list." };
      await store.txTrip(tripId, (cur) => ({ checklist: [...(cur.checklist || []), { id: uid(), text: op.text, group: op.group, who: "", done: false, doneBy: "", at: Date.now(), auto: false }], ...me }));
      return done(`added ${q(op.text)} to the ${op.group === "pack" ? "packing" : "to-do"} list`);
    }
    case "booking": {
      const b = { id: uid(), ...op.booking, by: S.me.email, at: Date.now() };
      await store.txTrip(tripId, (cur) => ({ bookings: [...(cur.bookings || []), b], ...me }));
      return done(`saved the ${b.kind} ${b.title ? q(b.title) : b.ref}`);
    }
    case "add": {
      const p = op.place, t = S.trip;
      const cat = ctx.CATEGORIES[p.category] ? p.category : "sight";
      let g = null;
      try { g = await geocode(`${p.location || p.name}${(p.location || "").includes(t.destination) ? "" : ", " + t.destination}`); } catch {}
      if (!g) try { g = await geocode(`${p.name}, ${t.destination}`); } catch {}
      if (!g) return { ok: false, note: `Couldn't find ${q(p.name)} on the map, so it isn't added.` };
      const [added] = await ctx.addPlaces([{
        title: p.name, location: p.location, category: cat, durationMin: p.durationMin, cost: p.cost, notes: p.why, url: p.url || "", lat: g.lat, lng: g.lng,
        ...(cat === "food" && p.veg ? { veg: p.veg, vegNote: p.vegNote || "", vegSource: (source || "app").toLowerCase() } : {}),
      }], { source: source || "change", autoPlace: false });
      if (op.toDay) {
        const id = dayId(op.toDay), time = hhmm(op.time);
        await new Promise((r) => setTimeout(r, 150));
        await store.updateItem(tripId, added.id, { dayId: id, order: time ? ctx.orderForTime(id, time) : ctx.nextOrder(id), ...(time ? { time } : {}), userEdited: true, ...me });
      }
      return done(`added ${q(p.name)} to ${op.toDay ? "Day " + op.toDay : "ideas"}`);
    }
  }
  return { ok: false, note: "Not something the app can do." };
}

/* -------------------------------------------------------------- proposals */
// Gemini and Claude are named only for people who have them; everyone else sees a neutral label.
const lbl = (c) => (ctx.S.aiUser || !/^(Gemini|Claude)$/.test(c.source) ? c.source : "");
// Stores a change proposal on the trip (one at a time). Called with Gemini's or Claude's answer.
export async function proposeChanges({ source, request = "", summary = "", ops }) {
  const clean = cleanOps(ops);
  if (!clean.length) throw new Error("There were no changes in the answer.");
  const { S } = ctx;
  const had = pending().length;
  await S.store.updateTrip(S.tripId, {
    changes: { at: Date.now(), by: S.me.email, byName: S.me.name, source, request: str(request, 300), summary: str(summary, 500), ops: clean, applied: [], skipped: [] },
    ...ctx.stampMe(),
  });
  if (source === "Claude" && ctx.bridgeAsk?.()) ctx.setBridgeAsk(null);
  const n = `${clean.length} change${clean.length > 1 ? "s" : ""}`;
  await ctx.log(source === "Shuffle" ? `shuffled a day: ${n} to review${request ? " (" + str(request, 80) + ")" : ""}` : `${source === "Claude" ? "Claude suggested" : "asked " + source + " for"} ${n}${request ? ": " + str(request, 80) : ""}`);
  return { count: clean.length, replaced: had > 0 };
}
// Changes still waiting: not applied, not skipped, and still possible.
function pending() {
  const c = ctx.S.trip?.changes;
  if (!c) return [];
  const gone = new Set([...(c.applied || []), ...(c.skipped || [])]);
  return c.ops.map((op, i) => ({ op, i })).filter(({ op, i }) => !gone.has(i) && !problem(op));
}
async function mark(field, idxs) {
  await ctx.S.store.txTrip(ctx.S.tripId, (cur) => {
    if (!cur.changes) return null;
    const c = { ...cur.changes, [field]: [...new Set([...(cur.changes[field] || []), ...idxs])] };
    const gone = new Set([...(c.applied || []), ...(c.skipped || [])]);
    const left = c.ops.some((op, i) => !gone.has(i) && !problem(op)); // changes that can't be applied don't keep it open
    return { changes: left ? c : null, ...ctx.stampMe() };
  });
}

/* ------------------------------------------------------ Gemini + Claude ask */
export async function changePlan(key, snapshot, request, prefs = "") {
  const prompt = changePrompt(snapshot, request, prefs, "Use Google Search for real places and opening hours.");
  const { text } = await call(key, prompt, { search: true });
  const out = parseJson(text);
  return { summary: str(out.summary, 500), ops: cleanOps(out.ops) };
}
export function changePrompt(snapshot, request, prefs, searchLine) {
  return `You help a couple change their shared trip plan. They asked: “${request}”
${prefs ? `Their preferences and hard rules:\n${prefs}\n` : ""}Rules:
- Propose the smallest set of changes that does what they asked (at most 12). The couple review each change before anything happens.
- Keep what they chose: don't remove or move their must-do stops or places they saved unless the request asks for it.
- Restaurants must serve good vegetarian dishes (they don't have to be pure vegetarian).
- Don't fill empty days unless the request asks for it.
- ${searchLine}
- Use only itemIds that appear in the plan. Days are numbered from 1.
Here is the plan as JSON:
${JSON.stringify(snapshot)}

Return ONLY a JSON object in a \`\`\`json block: {"kind":"changes","request":"${request.replace(/"/g, "'")}","summary":"one sentence on what you changed and why","ops":[...]} where each op is one of:
${OP_TYPES.map((t) => "- " + OP_FORMATS[t]).join("\n")}`;
}

let draft = "";
let busy = "";
async function askGemini() {
  const { S } = ctx, t = S.trip, request = draft.trim();
  if (!request) return ctx.toast("Type what you'd like changed first.");
  if (!ctx.aiKey()) return ctx.toast("Connect Gemini on the Discover tab, or ask Claude.");
  if (busy) return;
  busy = "Gemini is working on it…";
  ctx.render();
  try {
    const r = await changePlan(ctx.aiKey(), ctx.planSnapshot(), request, ctx.profileText(ctx.profileOf(t)));
    const res = await proposeChanges({ source: "Gemini", request, summary: r.summary, ops: r.ops });
    draft = "";
    ctx.toast(`Gemini suggests ${res.count} change${res.count > 1 ? "s" : ""}. Review them on the Plan tab.`, 5000);
    setTimeout(openChanges, 300);
  } catch (e) {
    console.warn(e);
    ctx.toast(e instanceof QuotaError ? e.message : "Gemini couldn't do that: " + e.message, e instanceof QuotaError ? 9000 : 5000);
  } finally {
    busy = "";
    ctx.render();
  }
}

// Claude: through the Claude link when it's on (the request waits in the snapshot), otherwise copy a request to paste into Claude.
// `text` is anything Claude should read besides the plan (pasted tips). The link carries a capped copy of it in the request.
let lastRequest = "";
function claudeRequest(request, { text = "", lead = "", extra = "" } = {}) {
  return (lead || `Please change our trip plan: “${request}”`) + "\n\n" + changePrompt(ctx.planSnapshot(), request, ctx.profileText(ctx.profileOf(ctx.S.trip)), "Search the web for real places and opening hours.")
    .split("\n").slice(1).join("\n") + (extra ? "\n\n" + extra : "") + (text ? `\n\nThe text to use:\n<<<\n${text}\n>>>` : "")
    + "\n\nReply with the json block only, so it can be pasted straight back into our trip planner.";
}
// Asks Claude for a `changes` block. `request` is the short line shown in the app; `onDone` runs once the request is sent or the answer is in.
export async function askClaudeFor(request, { text = "", lead = "", extra = "", onDone, retried = false } = {}) {
  const { S } = ctx, t = S.trip;
  if (ctx.bridgeToken()) {
    ctx.setBridgeAsk({ request: str(request, 300), ...(text ? { text: str(text, 8000) } : {}), at: Date.now(), by: S.me.name });
    ctx.bridgeSyncNow?.();
    onDone?.();
    ctx.render();
    if (!ctx.openClaude) ctx.toast("Saved for Claude. In Claude, say “check my trip planner”. Claude's changes will show up here to review.", 7000);
    else ctx.openClaude("Please handle our new request in the trip planner: " + str(request, 200));
    return;
  }
  // Link off: the first time, offer to connect (then this runs again with the link on); "Not now" goes on to copy/paste.
  if (!retried && ctx.openClaude?.(request, { fallback: () => askClaudeFor(request, { text, lead, extra, onDone, retried: true }), onConnected: () => askClaudeFor(request, { text, lead, extra, onDone }) })) return;
  window.open("https://claude.ai/new", "_blank", "noopener");
  lastRequest = claudeRequest(request, { text, lead, extra });
  navigator.clipboard?.writeText(lastRequest).catch(() => {});
  ctx.openModal(`<h3>🟠 Ask Claude</h3>
    <p class="small">The request is copied (with your plan${text ? " and your text" : ""}). Paste it into a new chat in the Claude app, wait for the answer, tap <b>Copy</b> under it and paste it here.</p>
    <label>Claude's answer<textarea name="answer" rows="7" placeholder="Paste Claude's whole answer here" required></textarea></label>
    <p class="muted small">You'll see each change in plain words and choose which to apply. Tip: <button type="button" class="link" data-action="bridgeOpen">connect Claude</button> to skip the copying.</p>
    <p class="small"><button type="button" class="btn-s" data-action="chgCopyAgain">Copy the request again</button></p>`, async (fd) => {
    if (!ctx.bridgeIngest) return ctx.toast("Couldn't read that yet."), false;
    await ctx.bridgeIngest(fd.answer, { fromPaste: true, request });
    onDone?.();
  });
  ctx.$form.querySelector("button[value=ok]").textContent = "Use this answer";
}
function askClaude() {
  const request = draft.trim();
  if (!request) return ctx.toast("Type what you'd like changed first.");
  return askClaudeFor(request, { onDone: () => { draft = ""; } });
}

/* ----------------------------------------------------------- review modal */
export function openChanges() {
  const { S, esc } = ctx, c = S.trip.changes;
  if (!c) return;
  ctx.openModal(`<h3>💬 ${lbl(c) ? esc(lbl(c)) + "'s suggested" : "Suggested"} changes</h3>
    <div id="chgHead"></div><div id="chgList"></div>
    <div class="row"><button type="button" class="btn-s" data-action="chgDiscard">Discard all</button></div>`, async () => {
    await applyAll();
    return false;
  });
  paintChanges();
}
function paintChanges() {
  const { S, esc } = ctx, c = S.trip.changes;
  const list = document.getElementById("chgList");
  if (!list) return;
  if (!c) { ctx.$modal.close(); return; }
  const done = new Set(c.applied || []), skip = new Set(c.skipped || []);
  const left = pending();
  document.getElementById("chgHead").innerHTML = `${c.request ? `<p class="small">${c.source === "Shuffle" ? "" : "You asked: "}<b>${esc(c.request)}</b></p>` : ""}${c.summary ? `<p>${esc(c.summary)}</p>` : ""}<p class="muted small">Suggested ${ctx.ago(c.at)}. Nothing changes until you tap Apply.</p>`;
  list.innerHTML = c.ops.map((op, i) => {
    const bad = done.has(i) || skip.has(i) ? "" : problem(op);
    const state = done.has(i) ? `<span class="muted small">✓ Applied</span>` : skip.has(i) ? `<span class="muted small">Skipped</span>`
      : bad ? `<span class="small chg-bad">Can't apply: ${esc(bad)}</span>`
      : `<span class="chg-act"><button type="button" class="btn-s primary" data-action="chgApply" data-id="${i}">Apply</button><button type="button" class="btn-s" data-action="chgSkip" data-id="${i}">Skip</button></span>`;
    return `<div class="chg-op ${bad ? "bad" : ""} ${done.has(i) || skip.has(i) ? "off" : ""}"><div class="chg-t">${esc(opText(op))}${op.why ? `<div class="muted small">${esc(op.why)}</div>` : ""}</div>${state}</div>`;
  }).join("");
  const ok = ctx.$form.querySelector("button[value=ok]");
  if (ok) { ok.textContent = left.length > 1 ? `Apply all ${left.length}` : "Apply"; ok.disabled = !left.length; }
}
async function applyOne(i) {
  const c = ctx.S.trip.changes, op = c?.ops[i];
  if (!op) return;
  const r = await applyOp(op, { source: lbl(c) });
  if (r.ok) await mark("applied", [i]);
  else { ctx.toast(r.note, 5000); await mark("skipped", [i]); }
  if (r.ok && r.note) ctx.toast(r.note);
}
async function applyAll() {
  const c = ctx.S.trip.changes;
  if (!c) return;
  let n = 0;
  const notes = [];
  const todo = pending();
  for (const [k, { op, i }] of todo.entries()) {
    const r = await applyOp(op, { source: lbl(c) });
    if (r.ok) { n++; await mark("applied", [i]); }
    else { notes.push(r.note); await mark("skipped", [i]); }
    if (k < todo.length - 1) await new Promise((r2) => setTimeout(r2, 150)); // let the stop list catch up before the next change reads it
  }
  if (document.getElementById("chgList")) ctx.$modal.close();
  ctx.toast(`${n} change${n === 1 ? "" : "s"} applied.${notes.length ? " " + notes.join(" ") : ""}`, 6000);
}

/* --------------------------------------------------------------------- UI */
const CSS = `
.chg { margin: 0 0 12px; }
.chg-in { width: 100%; border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 9px 14px; font-size: 14px; color: var(--ink); }
.chg-in:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.chg-btns { display: none; gap: 8px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
.chg.open .chg-btns, .chg:focus-within .chg-btns { display: flex; }
.chg-note { margin: 6px 4px 0; }
.chg-op { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); }
.chg-op.off .chg-t { color: var(--muted); text-decoration: line-through; }
.chg-op.bad { opacity: .75; }
.chg-bad { color: var(--warn); text-align: right; }
.chg-act { display: flex; gap: 6px; flex-shrink: 0; }
`;
function box() {
  const { S, esc } = ctx, t = S.trip;
  if (!S.aiUser) return "";
  const gem = ctx.aiKey();
  return `<div class="chg ${draft ? "open" : ""}">
    <input id="changeInput" class="chg-in" type="text" autocomplete="off" placeholder="Ask for a change… e.g. make Day 2 slower" value="${esc(draft)}" ${busy ? "disabled" : ""}>
    <div class="chg-btns">
      ${gem ? `<button type="button" class="btn-s primary" data-action="chgGemini" ${busy || geminiWait() ? "disabled" : ""}>Ask Gemini</button>` : ""}
      <button type="button" class="btn-s ${gem ? "" : "primary"}" data-action="chgClaude" ${busy ? "disabled" : ""}>Ask Claude</button>
      ${ctx.bridgeAsk() ? `<span class="muted small">Waiting for Claude: “${esc(ctx.bridgeAsk().request)}”</span>` : ""}
    </div>
    ${busy ? `<p class="muted small chg-note">⏳ ${esc(busy)}</p>` : ""}
  </div>`;
}
function banner() {
  const { S, esc } = ctx, c = S.trip.changes;
  if (!c) return "";
  const n = pending().length;
  if (!n) return "";
  return `<button class="smart-banner ${ctx.S.trip.proposal ? "quiet" : ""}" data-action="chgOpen"><span class="ar-ic">💬</span><span class="ar-t">${esc(lbl(c) || ctx.firstName(c.byName) || "Someone")} suggests ${n} change${n > 1 ? "s" : ""}${c.request ? ` for “${esc(c.request.slice(0, 60))}”` : ""}</span><b>Review</b></button>`;
}

export function init(c) {
  ctx = c;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-changes", textContent: CSS }));
  ctx.applyOp = applyOp;
  ctx.opText = opText;
  ctx.pendingChanges = () => pending().length;
  ctx.openChanges = openChanges;
  ctx.askClaudeFor = askClaudeFor;
  // Fills the "Ask for a change" line (used by Shuffle when there is nothing to swap) and puts the cursor there.
  ctx.setChangeDraft = (text) => {
    if (!ctx.S.aiUser) return; // no ask box without Gemini or Claude
    draft = text;
    ctx.render();
    const el = document.getElementById("changeInput");
    el?.focus();
    el?.setSelectionRange?.(text.length, text.length);
  };
  ctx.slot("planTop", () => banner() + box());
  ctx.action("chgGemini", askGemini);
  ctx.action("chgClaude", askClaude);
  ctx.action("chgOpen", () => openChanges());
  ctx.action("chgApply", async (b, id) => { await applyOne(+id); paintChanges(); });
  ctx.action("chgSkip", async (b, id) => { await mark("skipped", [+id]); paintChanges(); });
  ctx.action("chgDiscard", async () => {
    await ctx.S.store.updateTrip(ctx.S.tripId, { changes: null, ...ctx.stampMe() });
    ctx.$modal.close();
    ctx.toast("Changes discarded.");
  });
  ctx.action("chgCopyAgain", async () => {
    await navigator.clipboard.writeText(lastRequest);
    ctx.toast("Request copied. Paste it into Claude.");
  });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "changeInput") return;
    draft = e.target.value;
    e.target.closest(".chg")?.classList.toggle("open", !!draft);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.id !== "changeInput") return;
    e.preventDefault();
    if (!ctx.S.aiUser) return;
    return ctx.aiKey() ? askGemini() : askClaude();
  });
  // The review list stays in step when the other phone applies or skips something.
  ctx.on("trip", () => { if (document.getElementById("chgList")) paintChanges(); });
}
