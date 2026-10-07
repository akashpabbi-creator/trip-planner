// Claude link: a private doc (named by a secret token) that a Claude desktop/Cowork session reads and writes.
// The app keeps a snapshot of the plan in it; Claude drops proposals into its inbox; the app turns each one into a
// proposal the couple review. Nothing Claude sends is applied without a tap.
import { parseJson } from "./ai.js";
import { OP_FORMATS, proposeChanges } from "./changes.js";

let ctx;
let watching = "";      // token currently watched
let unwatch = null;
let remote = null;      // last bridge doc seen
let remoteReady = false;
let lastWritten = "";   // last snapshot JSON this phone wrote
let snapTimer = null;
let taking = false;
const seen = new Set();

const SNAP_DELAY = 3000;
const SKILL_NAME = "trip-planner";

/* ---------------------------------------------------------------- snapshot */
export const PAYLOADS = {
  plan: `{"kind":"plan","draft":{"summary":"2 sentences","days":[{"day":1,"base":"city","theme":"3-5 words","items":[{"name":"","category":"sight|activity|food|shopping|nature","time":"HH:MM","durationMin":90,"address":"","approxCost":0,"why":"","closedDays":"","bookAhead":false,"veg":"yes|no (food only)","vegNote":"","splurge":"food|experience|","market":false}]}],"stays":[{"name":"","base":"","address":"","approxCost":0,"why":"","splurge":false}]}}`,
  changes: `{"kind":"changes","request":"what they asked","summary":"one sentence","ops":[ ...ops... ]}`,
  picks: `{"kind":"picks","items":[{"name":"","category":"sight|activity|food|stay|nature","rating":4.6,"reviews":1200,"priceLevel":"$$","approxCost":0,"area":"","why":"","durationMin":90,"address":"","veg":"yes (food only)","vegNote":""}]}`,
  review: `{"kind":"review","summary":"2-3 sentences","suggestions":[{"title":"short imperative","detail":"1-2 sentences","action":{"type":"move|add|transport|time|none","itemId":"","toDay":1,"mode":"","minutes":0,"time":"HH:MM","place":{"name":"","category":"","location":"","durationMin":60,"cost":0}}}]}`,
};

// What Claude is allowed to see. Never the Gemini key or anyone's email.
function buildSnapshot() {
  const { S } = ctx, t = S.trip;
  const snap = ctx.planSnapshot();
  const name = (email) => ctx.nameOf(email);
  const nameKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([e, v]) => [name(e), v]));
  const reactions = {};
  for (const it of S.items) {
    const votes = nameKeys(it.votes), comments = (it.comments || []).map((c) => ({ by: c.byName || name(c.by), at: c.at, text: c.text }));
    if (Object.keys(votes).length || comments.length) reactions[it.id] = { title: it.title, ...(Object.keys(votes).length ? { votes } : {}), ...(comments.length ? { comments } : {}) };
  }
  if (Object.keys(reactions).length) snap.reactions ??= reactions;
  if (t.bookings?.length) snap.bookings ??= t.bookings.map(({ by, ...b }) => b);
  if (t.checklist?.length) snap.checklist ??= t.checklist.map((c) => ({ text: c.text, group: c.group, who: c.who ? name(c.who) : "", done: !!c.done }));
  const spends = t.spends || [];
  if (spends.length) {
    const byCat = {};
    for (const s of spends) byCat[s.category || "other"] = (byCat[s.category || "other"] || 0) + (Number(s.inTrip) || 0);
    snap.spent ??= { total: Math.round(spends.reduce((a, s) => a + (Number(s.inTrip) || 0), 0)), count: spends.length, byCategory: byCat };
  }
  const listings = (t.guide?.for === t.destination ? t.guide.listings : []) || [];
  if (listings.length) snap.guidePlaces ??= listings.slice(0, 120).map((l) => [l.name, l.category, l.city].filter(Boolean).join(" | "));
  if (t.weather?.days?.length) snap.weatherByDay ??= t.weather.days.map((w, i) => ({ day: i + 1, max: w.max, min: w.min, rainPct: w.rainPct, sunset: w.sunset }));
  const pend = {};
  if (t.changes) pend.changes = { source: t.changes.source, request: t.changes.request, count: t.changes.ops.length, summary: t.changes.summary };
  if (t.proposal) pend.plan = { source: t.proposal.source, summary: t.proposal.summary };
  if (t.aiReview) pend.review = { source: t.aiReview.source || "Gemini", summary: t.aiReview.summary };
  if (t.aiPicks?.items?.length) pend.picks = { source: t.aiPicks.source || "Gemini", count: t.aiPicks.items.length };
  snap.pendingProposals = pend;
  if (t.profile?.home) snap.homeCity = t.profile.home;
  if (t.bridge?.ask) snap.requests = [{ request: t.bridge.ask.request, ...(t.bridge.ask.text ? { text: t.bridge.ask.text } : {}), from: t.bridge.ask.by, asked: new Date(t.bridge.ask.at).toISOString() }];
  snap.howToSend = {
    note: "Everything you send is a proposal the couple review in the app; nothing is applied until they tap. Send by appending {id, at, json} to the bridge inbox (see the trip-planner skill).",
    payloadKinds: PAYLOADS,
    ops: OP_FORMATS,
    rules: [
      "Restaurants must serve good vegetarian dishes (they do not need to be pure vegetarian).",
      "Days fill only when asked: do not add stops to empty days unless the request says so.",
      "Keep what the couple chose: do not remove or move their saved or must-do stops unless asked.",
      "Use only itemIds that appear in this snapshot. Days are numbered from 1.",
    ],
  };
  return snap;
}
function snapshotJson() {
  const snap = buildSnapshot();
  let json = JSON.stringify(snap);
  // The doc is capped at 1 MB: trim the long lists first.
  if (json.length > 800000) { delete snap.guidePlaces; delete snap.reactions; json = JSON.stringify(snap); }
  if (json.length > 800000) { snap.ideasNotScheduled = snap.ideasNotScheduled.slice(0, 10); json = JSON.stringify(snap); }
  return json;
}
async function writeSnapshot() {
  const tok = ctx.S.trip?.bridge?.token;
  if (!tok || !remoteReady || !remote || !ctx.S.items) return;
  const json = snapshotJson();
  if (json === lastWritten || json === remote.snapshot) return;
  lastWritten = json;
  try { await ctx.S.store.updateBridge(tok, { snapshot: json, snapshotAt: Date.now() }); }
  catch (e) { lastWritten = ""; console.warn("claude link snapshot", e.message); }
}
function scheduleSnapshot(delay = SNAP_DELAY) {
  clearTimeout(snapTimer);
  if (!ctx.S.trip?.bridge?.token) return;
  snapTimer = setTimeout(writeSnapshot, delay);
}

/* ------------------------------------------------------------ the doc watch */
function ensureWatch() {
  const tok = ctx.S.trip?.bridge?.token || "";
  if (tok === watching) return;
  stopWatch();
  watching = tok;
  if (!tok) return;
  unwatch = ctx.S.store.watchBridge(tok, (b) => onBridge(tok, b), (e) => console.warn("claude link", e.message));
}
function stopWatch() {
  unwatch?.();
  unwatch = null;
  watching = "";
  remote = null;
  remoteReady = false;
  lastWritten = "";
  clearTimeout(snapTimer);
}
async function onBridge(tok, b) {
  if (tok !== watching) return;
  remoteReady = true;
  remote = b;
  if (!b) {
    // The link is on for the trip but its doc is missing (never made, or lost): make it again. Wait a moment first, so
    // a phone that is turning the link off isn't undone by the other phone seeing the doc go.
    remoteReady = false;
    setTimeout(async () => {
      const { S } = ctx;
      if (watching !== tok || remote || S.trip?.bridge?.token !== tok) return;
      try { await S.store.createBridge(tok, newDoc(tok)); } catch (e) { console.warn("claude link", e.message); }
    }, 2500);
    return;
  }
  if (b.inbox?.length) takeAndProcess(tok);
  scheduleSnapshot(b.snapshot ? SNAP_DELAY : 300);
}
const newDoc = (tok) => ({ tripId: ctx.S.tripId, by: ctx.firstName(ctx.S.me.name), at: Date.now(), on: true, snapshot: "", snapshotAt: 0, inbox: [] });

/* ------------------------------------------------------------------- inbox */
async function takeAndProcess(tok) {
  if (taking) return;
  taking = true;
  try {
    const entries = await ctx.S.store.takeInbox(tok);
    for (const e of entries) {
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      try { await ingest(e.json, { fromLink: true }); }
      catch (err) { console.warn(err); ctx.toast("Claude sent something the app couldn't use: " + err.message, 7000); }
    }
  } catch (e) {
    console.warn("claude inbox", e.message);
  } finally {
    taking = false;
  }
}

// Turns what Claude sent (a payload object, or text pasted from Claude) into the right proposal.
export async function ingest(input, { fromLink = false, fromPaste = false, request = "" } = {}) {
  const { S } = ctx;
  if (!S.tripId || !S.trip) throw new Error("Open the trip first.");
  let p = input;
  if (typeof p === "string") {
    if (p.length > 600000) throw new Error("That's too big.");
    try { p = parseJson(p); } catch { throw new Error("That doesn't look like something from Claude. Paste the whole json block."); }
  }
  if (Array.isArray(p)) p = { kind: "picks", items: p };
  if (!p || typeof p !== "object") throw new Error("Nothing to use in that.");
  let kind = String(p.kind || "").toLowerCase();
  if (!kind) kind = Array.isArray(p.days) ? "plan" : Array.isArray(p.ops) ? "changes" : Array.isArray(p.suggestions) ? "review" : Array.isArray(p.items) ? "picks" : "";
  const quiet = !fromPaste;
  const T = S.trip;
  const nice = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (kind === "plan") {
    const draft = p.draft || p;
    if (!Array.isArray(draft.days) || !draft.days.length) throw new Error("The plan has no days in it.");
    S.planning = "Checking Claude's plan…";
    ctx.render();
    try { await ctx.finishDraft(S.tripId, draft, "Claude", { quiet }); }
    finally { S.planning = false; ctx.render(); }
    if (quiet) ctx.toast("Claude sent a plan for your days. Review it on the Plan tab.", 6000);
    return "plan";
  }
  if (kind === "changes") {
    const res = await proposeChanges({ source: "Claude", request: p.request || request, summary: p.summary, ops: p.ops });
    ctx.toast(`Claude sent ${nice(res.count, "change")} to review${res.replaced ? " (replacing the earlier ones)" : ""}. See the Plan tab.`, 6000);
    return "changes";
  }
  if (kind === "picks") {
    const cats = ctx.CATEGORIES;
    const all = (Array.isArray(p.items) ? p.items : []).filter((x) => x && (x.name || x.title));
    const items = all.map((x) => ({
      name: String(x.name || x.title).slice(0, 140), category: cats[x.category] ? x.category : "sight",
      rating: Number(x.rating) || null, reviews: Number(x.reviews) || null, priceLevel: String(x.priceLevel || "").slice(0, 6) || null,
      approxCost: Number(x.approxCost) || null, area: String(x.area || "").slice(0, 80), why: String(x.why || "").slice(0, 240),
      durationMin: Number(x.durationMin) || 90, address: String(x.address || "").slice(0, 200),
      ...(["yes", "no"].includes(x.veg) ? { veg: x.veg } : {}), ...(x.vegNote ? { vegNote: String(x.vegNote).slice(0, 160) } : {}),
    })).filter((x) => !(x.category === "food" && x.veg === "no")).slice(0, 40); // restaurants need good vegetarian options
    if (!items.length) throw new Error("There were no places in the picks.");
    await S.store.updateTrip(S.tripId, { aiPicks: { for: T.destination, at: Date.now(), by: S.me.email, source: "Claude", items }, ...ctx.stampMe() });
    await ctx.log(`received Claude's top picks (${items.length} places)`);
    ctx.toast(`Claude sent ${nice(items.length, "top pick")}. See Discover.`, 6000);
    return "picks";
  }
  if (kind === "review") {
    const suggestions = (Array.isArray(p.suggestions) ? p.suggestions : []).filter((x) => x && x.title).slice(0, 30).map((x) => ({
      title: String(x.title).slice(0, 140), detail: String(x.detail || "").slice(0, 400),
      action: x.action && typeof x.action === "object" ? x.action : { type: "none" },
    }));
    if (!suggestions.length && !p.summary) throw new Error("There was no review in that.");
    await S.store.updateTrip(S.tripId, { aiReview: { at: Date.now(), by: S.me.email, source: "Claude", summary: String(p.summary || "").slice(0, 600), suggestions, applied: [] }, ...ctx.stampMe() });
    await ctx.log("received Claude's review of the plan");
    ctx.toast("Claude sent a review. See Smart.", 6000);
    return "review";
  }
  throw new Error("Not sure what that is. It should be a plan, changes, picks or a review.");
}

/* -------------------------------------------------------------------- modal */
const tokenOf = () => ctx.S.trip?.bridge?.token || "";
function newToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return [...a].map((n) => abc[n % 64]).join("");
}
function claudeMessage() {
  const { S } = ctx, t = S.trip, cfg = window.FIREBASE_CONFIG || {};
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return [
    `Please use your "${SKILL_NAME}" skill to help with my trip "${t.name}"${t.destination ? ` (${t.destination})` : ""}. First read the plan, then send me proposals (never edit the plan directly).`,
    ``,
    `project: ${cfg.projectId || ""}`,
    `apiKey: ${cfg.apiKey || ""}`,
    `token: ${t.bridge.token}`,
    `app: ${location.origin + location.pathname}`,
    ...(window.FIREBASE_EMULATORS ? [`host: http://127.0.0.1:8080`] : []),
    ``,
    `If you don't have the skill, read it here: ${base}docs/claude-skill.md`,
  ].join("\n");
}
async function turnOn() {
  const { S } = ctx, token = newToken();
  await S.store.createBridge(token, newDoc(token));
  await S.store.updateTrip(S.tripId, { bridge: { token, by: S.me.email, at: Date.now() }, ...ctx.stampMe() });
  await ctx.log("connected Claude to the plan");
}
async function turnOff() {
  const { S } = ctx, tok = tokenOf();
  if (!tok) return;
  stopWatch();
  await S.store.deleteBridge(tok).catch((e) => console.warn(e.message));
  await S.store.updateTrip(S.tripId, { bridge: null, ...ctx.stampMe() });
  await ctx.log("disconnected Claude from the plan");
}
function openBridge() {
  const { S, esc } = ctx;
  if (!S.tripId || !S.trip) return ctx.toast("Open a trip first.");
  const tok = tokenOf();
  if (!tok) {
    ctx.openModal(`<h3>🟠 Connect Claude</h3>
      <p class="small">Link this trip to a Claude chat (the Claude desktop app or Cowork) so Claude can plan, answer change requests, suggest top places, check restaurants for vegetarian food and read links, screenshots and booking emails. All of it is free with your Claude account.</p>
      <ul class="small">
        <li>Claude reads a copy of your plan (never your Gemini key or anyone's email).</li>
        <li>Everything Claude sends arrives as a proposal. Nothing changes until you tap Apply.</li>
        <li>Turn it off any time and the link stops working.</li>
      </ul>`, async () => { await turnOn(); setTimeout(openBridge, 400); });
    ctx.$form.querySelector("button[value=ok]").textContent = "Connect Claude";
    return;
  }
  const at = remote?.snapshotAt;
  ctx.openModal(`<h3>🟠 Claude is connected</h3>
    <p class="small">${at ? `Claude can see your plan as of ${esc(ctx.ago(at))}.` : "Your plan is being copied for Claude…"} Anything Claude sends shows up for you to review.</p>
    <ol class="small">
      <li>Tap <b>Copy for Claude</b>.</li>
      <li>Paste it into a chat in the Claude desktop app (or Cowork) that has the “${SKILL_NAME}” skill.</li>
      <li>Ask for what you want: “plan my days”, “make Day 2 slower”, “find top vegetarian restaurants”.</li>
    </ol>
    <div class="row"><button type="button" class="btn-s primary" data-action="bridgeCopy">Copy for Claude</button></div>
    <details class="about"><summary>Claude has no internet? Paste its answer here</summary>
      <label>Paste from Claude<textarea name="paste" rows="5" placeholder="Paste the json block Claude gave you (a plan, changes, picks or a review)"></textarea></label>
    </details>
    <div class="row"><button type="button" class="link" data-action="bridgeNew">Make a new link</button><button type="button" class="danger link" data-action="bridgeOff">Turn off</button></div>`,
    async (fd) => {
      if (!(fd.paste || "").trim()) return;
      await ingest(fd.paste, { fromPaste: true });
    });
  ctx.$form.querySelector("button[value=ok]").textContent = "Done";
}

/* --------------------------------------------------------------------- init */
export function init(c) {
  ctx = c;
  ctx.bridgeIngest = ingest;
  ctx.bridgeSyncNow = () => scheduleSnapshot(300);
  ctx.action("bridgeOpen", () => openBridge());
  ctx.action("bridgeCopy", async () => {
    await navigator.clipboard.writeText(claudeMessage());
    ctx.toast("Copied. Paste it into Claude.");
  });
  ctx.action("bridgeOff", async () => {
    if (!confirm("Turn off the Claude link? Claude will no longer see or change anything.")) return;
    ctx.$modal.close();
    await turnOff();
    ctx.toast("Claude is disconnected.");
  });
  ctx.action("bridgeNew", async () => {
    if (!confirm("Make a new link? The old one stops working, so give Claude the new details.")) return;
    ctx.$modal.close();
    await turnOff();
    await turnOn();
    ctx.toast("New link made. Copy it for Claude again.");
    setTimeout(openBridge, 500);
  });
  ctx.on("trip", () => { ensureWatch(); scheduleSnapshot(); });
  ctx.on("items", () => scheduleSnapshot());
  ctx.on("close", () => stopWatch());
}
