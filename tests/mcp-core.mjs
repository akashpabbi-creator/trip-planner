// Connector core test: runs the real Worker (wrangler dev) against the Firestore + Auth emulators.
// Covers: OAuth with dynamic registration (Claude style public client + Gemini style client with a secret and its own callback),
// the Google sign-in hand-off, the aiUsers gate, the read tools and the member-only rule.
// Run: node tests/mcp-core.mjs   (needs `cd mcp && npm i`, and the emulator bench in /tmp/claude-0/fbt)
import { spawnSync, spawn } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash, randomBytes } from "crypto";
import { encodeFields } from "../mcp/src/firestore.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.MCP_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-mcp-"));
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { host: "127.0.0.1", port: 8080 }, auth: { host: "127.0.0.1", port: 9099 }, hub: { host: "127.0.0.1" }, logging: { host: "127.0.0.1" }, ui: { enabled: false } } }));
  copyFileSync(join(root, "firestore.rules"), join(dir, "firestore.rules"));
  const fb = process.env.FIREBASE_BIN || "/tmp/claude-0/fbt/node_modules/.bin/firebase";
  const r = spawnSync(fb, ["emulators:exec", "--only", "firestore,auth", "--project", "demo-trips", `MCP_CHILD=1 node ${fileURLToPath(import.meta.url)}`], { stdio: "inherit", cwd: dir });
  process.exit(r.status ?? 1);
}

const PORT = 8799, W = `http://127.0.0.1:${PORT}`, ORIGIN = "http://localhost:9999";
const FS = "http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents";
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };

/* ---- the Worker */
const persist = mkdtempSync(join(tmpdir(), "tp-wr-"));
const worker = spawn(join(root, "mcp/node_modules/.bin/wrangler"), ["dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist,
  "--var", "FIREBASE_PROJECT:demo-trips", "--var", "FIREBASE_API_KEY:x", "--var", `ALLOWED_ORIGIN:${ORIGIN}`, "--var", `CONNECT_URL:${ORIGIN}/trip-planner/connect.html`,
  "--var", "FIRESTORE_HOST:http://127.0.0.1:8080", "--var", "IDENTITY_URL:http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup", "--var", "SECURETOKEN_URL:http://127.0.0.1:9099/securetoken.googleapis.com/v1/token"],
  { cwd: join(root, "mcp"), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" } });
let wlog = "";
worker.stdout.on("data", (d) => (wlog += d)); worker.stderr.on("data", (d) => (wlog += d));
const stop = () => { try { worker.kill("SIGKILL"); } catch {} };
process.on("exit", stop);
for (let i = 0; ; i++) {
  if (await fetch(W + "/").then((r) => r.ok, () => false)) break;
  if (i > 120) { console.log(wlog); console.log("  FAIL worker did not start"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}

/* ---- helpers */
async function signIn(email) {
  const tok = JSON.stringify({ sub: email, email, email_verified: true, name: email.split("@")[0] });
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=x", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(tok)}&providerId=google.com`, requestUri: "http://localhost", returnIdpCredential: true, returnSecureToken: true }),
  });
  return await r.json();
}
const fsReq = async (method, path, body, token = "owner") => {
  const r = await fetch(FS + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const seed = (col, id, data) => fsReq("POST", `/${col}?documentId=${id}`, { fields: encodeFields(data) });
const b64u = (b) => Buffer.from(b).toString("base64url");

async function connect({ email, redirect = "https://claude.ai/api/mcp/auth_callback", secret = false, origin = ORIGIN, name = "Claude" }) {
  const who = await signIn(email);
  const reg = await (await fetch(W + "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    client_name: name, redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: secret ? "client_secret_post" : "none" }) })).json();
  const verifier = b64u(randomBytes(32)), challenge = b64u(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, state: "st-" + email, code_challenge: challenge, code_challenge_method: "S256", resource: W + "/mcp", scope: "trips" });
  const a1 = await fetch(`${W}/authorize?${q}`);
  const page = await a1.text();
  const handle = /name="handle" value="([^"]+)"/.exec(page)?.[1];
  const cookie = (a1.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const a2 = await fetch(W + "/authorize", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: W },
    body: new URLSearchParams({ handle: handle || "", decision: "approve" }) });
  const loc = a2.headers.get("Location") || "";
  const id = new URL(loc, "http://x").searchParams.get("id");
  const done = await fetch(W + "/connect/complete", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ id, refreshToken: who.refreshToken }) });
  const dj = await done.json().catch(() => ({}));
  const out = { reg, page, consentStatus: a1.status, loc, doneStatus: done.status, dj, who };
  if (dj.redirectTo) {
    const cb = new URL(dj.redirectTo);
    out.callbackOk = cb.origin + cb.pathname === redirect && cb.searchParams.get("state") === "st-" + email;
    const tok = await (await fetch(W + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
      grant_type: "authorization_code", code: cb.searchParams.get("code"), redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, ...(secret ? { client_secret: reg.client_secret } : {}) }) })).json();
    out.token = tok;
  }
  return out;
}
let rid = 0;
const mcp = async (token, method, params) => {
  const r = await fetch(W + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const tool = async (token, name, args = {}) => {
  const { j } = await mcp(token, "tools/call", { name, arguments: args });
  const t = j?.result?.content?.[0]?.text ?? "";
  let v; try { v = JSON.parse(t); } catch { v = t; }
  return { isError: !!j?.result?.isError, v };
};

/* ---- seed: alice and bob are AI users on T1; carol is a plain friend; eve owns T2; dave loses AI access before first use */
for (const e of ["alice@example.com", "bob@example.com", "eve@example.com", "dave@example.com"]) await seed("aiUsers", e, { on: true });
const days = [{ id: "d1", title: "Old town", base: "Panjim", notes: "" }, { id: "d2", title: "Beaches", base: "", notes: "" }];
await seed("trips", "T1", { name: "Goa", destination: "Goa, India", startDate: "2026-12-20", currency: "INR", budget: 80000, days, owner: "alice@example.com",
  members: ["alice@example.com", "bob@example.com"], memberNames: { "alice@example.com": "Alice", "bob@example.com": "Bob" }, extras: [], tripNotes: [{ id: "n1", text: "Try a thali place", by: "bob@example.com" }],
  driveFolder: { id: "DRV1", name: "Travel - Sanj_Akash/Goa - December 2026", url: "https://drive.google.com/drive/folders/DRV1", by: "alice@example.com" } });
await seed("trips", "T2", { name: "Secret Rome", destination: "Rome", startDate: "2027-03-01", days: [{ id: "x1" }], owner: "eve@example.com", members: ["eve@example.com"], memberNames: {} });
await seed("trips", "T3", { name: "Dave solo", destination: "Hampi", days: [{ id: "h1" }], owner: "dave@example.com", members: ["dave@example.com"], memberNames: {} });
const item = (id, o) => seed("trips/T1/items", id, { category: "sight", dayId: null, order: 0, addedBy: "alice@example.com", addedAt: 1000, ...o });
await item("i1", { title: "Fontainhas walk", location: "Fontainhas, Panjim", dayId: "d1", order: 0, durationMin: 90, time: "09:30" });
await item("i2", { title: "Ritz Classic thali", category: "food", location: "Panjim", dayId: "d1", order: 1, durationMin: 60, veg: "yes", vegNote: "full thali" });
await item("i3", { title: "Baga Beach", dayId: "d2", order: 0, location: "Baga" });
await item("i4", { title: "Spice farm", category: "activity", location: "Ponda", notes: "book ahead", addedBy: "bob@example.com", suggestedBy: "ai", aiSource: "Claude" });
await seed("trips/T1/items", "e1", { title: "Other trip", dayId: null });
await seed("trips/T1/activity", "a1", { at: 5000, by: "alice@example.com", byName: "Alice", text: "added Baga Beach" });
await seed("trips/T1/activity", "a2", { at: 6000, by: "bob@example.com", byName: "Bob", text: "added Spice farm" });

console.log("(a) discovery and sign-in gate");
const prm = await (await fetch(W + "/.well-known/oauth-protected-resource/mcp")).json().catch(() => ({}));
const same = (a, b) => new URL(a).port === new URL(b).port; // wrangler reports localhost for 127.0.0.1
ok(new URL(prm.resource || "http://x").pathname === "/mcp" && same(prm.resource, W) && same(prm.authorization_servers?.[0], W), "protected-resource metadata points at the Worker");
const asm = await (await fetch(W + "/.well-known/oauth-authorization-server")).json().catch(() => ({}));
ok(new URL(asm.registration_endpoint || "http://x").pathname === "/register" && asm.code_challenge_methods_supported?.includes("S256"), "authorization-server metadata offers dynamic registration and PKCE");
const noTok = await mcp(null, "tools/list");
ok(noTok.status === 401, "MCP without a token is refused (401)");
const wa = (await fetch(W + "/mcp", { method: "POST", body: "{}" })).headers.get("www-authenticate") || "";
ok(/resource_metadata=/.test(wa), "the 401 tells the client where the OAuth metadata is");

console.log("(b) Claude-style sign-in (public client, PKCE)");
const A = await connect({ email: "alice@example.com" });
ok(A.consentStatus === 200 && /Allow Claude/.test(A.page) && /claude\.ai/.test(A.page), "consent page names the app and where access goes");
ok(A.loc.startsWith(`${ORIGIN}/trip-planner/connect.html?`) && A.loc.includes("w=" + encodeURIComponent(W)), "approve sends the browser to connect.html on the app site");
ok(A.doneStatus === 200 && A.dj.email === "alice@example.com" && A.callbackOk, "Google sign-in hand-off completes and returns to the client's callback with its state");
ok(!!A.token?.access_token && !!A.token?.refresh_token, "client exchanges the code (PKCE) for an access and refresh token");
const T = A.token.access_token;

console.log("(c) MCP basics");
const init = await mcp(T, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
ok(init.j?.result?.serverInfo?.name === "trips" && init.j.result.protocolVersion === "2025-06-18", "initialize");
const list = await mcp(T, "tools/list");
const names = (list.j?.result?.tools || []).map((t) => t.name);
ok(["whoami", "list_trips", "get_trip", "get_day", "search_items", "recent_activity"].every((n) => names.includes(n)), "tools/list has the six read tools");
ok((list.j?.result?.tools || []).every((t) => t.inputSchema?.type === "object" && t.description), "every tool has a schema and description");

console.log("(d) read tools run as the user");
const who = await tool(T, "whoami");
ok(who.v.email === "alice@example.com" && who.v.trips === 1, "whoami: Alice, one trip");
const trips = await tool(T, "list_trips");
ok(trips.v.length === 1 && trips.v[0].id === "T1" && trips.v[0].days === 2, "list_trips returns only the member's trip (not T2/T3)");
const tv = await tool(T, "get_trip", {});
ok(tv.v.name === "Goa" && tv.v.days.length === 2 && tv.v.days[0].stops === 2 && tv.v.ideasCount === 2 && tv.v.tripNotes[0].by === "Bob", "get_trip with no name picks the only trip: days, stops, ideas, notes");
ok(tv.v.driveFolder?.id === "DRV1" && tv.v.driveFolder.name.endsWith("Goa - December 2026") && !("by" in tv.v.driveFolder), "get_trip returns the trip's Drive folder (id, name, url)");
const d1 = await tool(T, "get_day", { trip: "goa", day: 1 });
ok(d1.v.date === "2026-12-20" && d1.v.schedule.map((s) => s.title).join() === "Fontainhas walk,Ritz Classic thali" && d1.v.schedule[1].estStart === "11:00", "get_day 1: ordered stops with computed start times");
const ideas = await tool(T, "get_day", { trip: "Goa", day: "ideas" });
ok(ideas.v.ideas.length === 2 && ideas.v.ideas.some((i) => i.title === "Spice farm" && i.addedBy === "Claude"), "get_day ideas lists unscheduled places and who suggested them");
const bad = await tool(T, "get_day", { day: 9 });
ok(bad.isError && /Day must be 1 to 2/.test(bad.v), "out-of-range day is a clear tool error");
const se = await tool(T, "search_items", { query: "thali" });
ok(se.v.length === 1 && se.v[0].where === "day 1", "search_items finds by words and says where it is");
ok((await tool(T, "search_items", { category: "activity" })).v[0].where === "ideas", "search_items filters by category");
const act = await tool(T, "recent_activity", { limit: 5 });
ok(act.v[0].text === "added Spice farm" && act.v.length === 2, "recent_activity is newest first");
const other = await tool(T, "get_trip", { trip: "T2" });
ok(other.isError && /No trip matches/.test(other.v), "a trip Alice isn't a member of can't be reached, even by id");
const direct = await fsReq("GET", "/trips/T2", null, A.who.idToken);
ok(direct.s === 403, "(the rules themselves also refuse Alice reading T2)");

console.log("(e) the aiUsers gate");
const C = await connect({ email: "carol@example.com" });
ok(C.doneStatus === 403 && C.dj.error === "not_ai_user" && !C.token, "a friend without an aiUsers doc can't connect");
const D = await connect({ email: "dave@example.com" });
await fsReq("DELETE", "/aiUsers/dave@example.com");
const dv = await tool(D.token.access_token, "list_trips");
ok(D.token?.access_token && dv.isError && /isn't enabled/.test(dv.v), "AI access removed after connecting: the next call is refused");

console.log("(f) hand-off safety");
const E = await connect({ email: "bob@example.com", origin: "https://evil.example" });
ok(E.doneStatus === 403 && !E.token, "connect/complete from any other website is refused");
const pre = await fetch(W + "/connect/complete", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGIN, "CORS preflight allows only the app site");
const replay = await fetch(W + "/connect/complete", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ id: new URL(A.loc, "http://x").searchParams.get("id"), refreshToken: A.who.refreshToken }) });
ok(replay.status === 400, "a connection attempt can be completed only once");
const forged = await fetch(W + "/connect/complete", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ id: "nope", refreshToken: A.who.refreshToken }) });
ok(forged.status === 400, "an unknown attempt id is refused");

console.log("(g) Gemini-style client (own callback, client secret)");
const G = await connect({ email: "bob@example.com", redirect: "https://gemini.google.com/app/oauth/callback", secret: true, name: "Gemini" });
ok(G.doneStatus === 200 && G.callbackOk && !!G.token?.access_token, "dynamic registration with a secret and a different callback works end to end");
const gt = await tool(G.token.access_token, "list_trips");
ok(gt.v.length === 1 && gt.v[0].name === "Goa", "Bob (a second member) sees the shared trip through Gemini");
const rf = await (await fetch(W + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: G.token.refresh_token, client_id: G.reg.client_id, client_secret: G.reg.client_secret }) })).json();
ok(!!rf.access_token, "the OAuth refresh token works, so the connection stays alive");

console.log("(h) capture tools: Ideas only, named after the client, with undo");
const gc = (await tool(T, "list_trips")).v; // Alice via Claude; Bob via Gemini (G)
const GT = G.token.access_token;
ok(["save_ideas", "add_trip_note", "undo_change"].every((n) => names.includes(n)), "tools/list has the capture tools");
const sv = await tool(T, "save_ideas", { trip: "Goa", ideas: [
  { title: "Cabo de Rama Fort", category: "sight", location: "Cabo de Rama, South Goa", tips: ["go before 9am", "closed on Mondays"], source: "Instagram reel by @goa.guide", cost: 0, lat: 15.0875, lng: 73.9217 },
  { title: "Gunpowder", category: "food", location: "Assagao, Goa", veg: "yes", vegNote: "separate veg menu", tips: ["book 2 days ahead"], url: "https://example.com/gunpowder" },
  { title: "ritz  classic THALI", category: "food" },
  { title: "" },
] });
if (sv.isError) console.log("save_ideas error:", sv.v);
ok(sv.v.saved === 2 && sv.v.kitTodos === 1 && sv.v.results.map((r) => r.status).join() === "saved to ideas,saved to ideas,already saved,skipped", "two saved, the duplicate by name and the empty one are skipped: " + JSON.stringify(sv.v.results?.map((r) => r.status)));
if (!sv.v.results) { console.log("save_ideas error:", sv.v); process.exit(1); }
ok(sv.v.results[2].where === "day 1", "the duplicate says where the existing one is");
if (sv.isError) console.log("save_ideas error:", sv.v);
const ideas2 = await tool(T, "get_day", { trip: "Goa", day: "ideas" });
const cabo = ideas2.v.ideas.find((i) => i.title === "Cabo de Rama Fort");
ok(cabo && /go before 9am/.test(cabo.notes) && /Instagram reel/.test(cabo.notes) && cabo.pinned, "the idea is in Ideas with its tips, source and pin");
const raw = await fsReq("GET", "/trips/T1/items/" + sv.v.results[0].id);
const f = raw.j.fields || {};
ok(f.dayId?.nullValue === null && f.addedBy?.stringValue === "alice@example.com" && f.via?.stringValue === "Claude", "stored with no day, added by the account, via Claude (OAuth client name)");
const gp = (await fsReq("GET", "/trips/T1/items/" + sv.v.results[1].id)).j.fields;
ok(gp.veg?.stringValue === "yes" && gp.vegSource?.stringValue === "claude" && gp.fromLink?.booleanValue === true, "food keeps veg info and link flag");
const trip1 = (await fsReq("GET", "/trips/T1")).j.fields;
const todos = (trip1.checklist?.arrayValue?.values || []).map((v) => v.mapValue.fields.text.stringValue);
ok(todos.join() === "Book Gunpowder", "a booking tip adds one Kit to-do");
const act2 = await tool(T, "recent_activity", { limit: 3 });
ok(act2.v[0].by === "Claude" && /added 2 ideas/.test(act2.v[0].text) && act2.v[0].undoable === true, "the feed says Claude added them and marks it undoable");
const sv2 = await tool(GT, "save_ideas", { trip: "Goa", ideas: [{ title: "Gunpowder" }, { title: "Mapusa Friday market", category: "shopping", tips: ["go on a Friday"] }] });
ok(sv2.v.saved === 1 && sv2.v.results[0].status === "already saved", "Gemini re-sending a saved place is skipped, not doubled");
const act3 = await tool(GT, "recent_activity", { limit: 1 });
ok(act3.v[0].by === "Gemini", "Gemini's change is named Gemini in the feed");
const note = await tool(T, "add_trip_note", { trip: "Goa", text: "Sanj wants a slow morning on day 3" });
const note2 = await tool(T, "add_trip_note", { trip: "Goa", text: "sanj wants a slow morning on day 3" });
ok(note.v.saved === true && note2.v.saved === false, "a trip note is added once");
ok((await tool(T, "get_trip", { trip: "Goa" })).v.tripNotes.some((n) => /slow morning/.test(n.text)), "the note shows in get_trip");

console.log("(i) undo");
const u1 = await tool(T, "undo_change", { trip: "Goa" });
ok(/trip note/.test(u1.v.undid) && !(await tool(T, "get_trip", { trip: "Goa" })).v.tripNotes.some((n) => /slow morning/.test(n.text)), "undo with no entry reverses the newest change (the note)");
const u2 = await tool(T, "undo_change", { trip: "Goa", entry: sv.v.undoWith.entry });
const after = await tool(T, "get_day", { trip: "Goa", day: "ideas" });
const todos2 = ((await fsReq("GET", "/trips/T1")).j.fields.checklist?.arrayValue?.values || []).length;
ok(/added 2 ideas/.test(u2.v.undid) && !after.v.ideas.some((i) => i.title === "Cabo de Rama Fort" || i.title === "Gunpowder") && todos2 === 0, "undoing a save removes both ideas and the to-do it added");
ok(after.v.ideas.some((i) => i.title === "Mapusa Friday market"), "…but not Gemini's later idea");
const u3 = await tool(T, "undo_change", { trip: "Goa", entry: sv.v.undoWith.entry });
ok(u3.isError && /already undone/.test(u3.v), "the same change can't be undone twice");
const mk = await tool(T, "save_ideas", { trip: "Goa", ideas: [{ title: "Chapora Fort" }] });
await fsReq("PATCH", `/trips/T1/items/${mk.v.results[0].id}?updateMask.fieldPaths=dayId`, { fields: { dayId: { stringValue: "d2" } } });
const u4 = await tool(T, "undo_change", { trip: "Goa", entry: mk.v.undoWith.entry });
ok(u4.isError && /put on a day/.test(u4.v), "an idea the couple already put on a day is left alone by undo");
const act4 = await tool(T, "recent_activity", { trip: "Goa", limit: 30 });
ok(act4.v.some((r) => /^undid:/.test(r.text)), "undo itself is logged in the feed");
const stranger = await tool(T, "save_ideas", { trip: "T2", ideas: [{ title: "x" }] });
ok(stranger.isError, "can't save into a trip the account isn't on");
const ex = (await fsReq("GET", "/trips/T1/activity", null, A.who.idToken)).j.documents?.[0];
ok(!!ex, "(activity entries stay inside the existing `activity` collection: no rules change)");

console.log("(j) full control: plan a day, move, edit, remove, rest/veg/pace warnings, undo");
const names2 = ((await mcp(T, "tools/list")).j?.result?.tools || []).map((t) => t.name);
ok(["plan_day", "move_item", "update_item", "remove_item", "update_day", "add_day", "remove_day", "update_trip", "add_booking", "update_booking", "remove_booking", "add_extra", "remove_extra", "add_todo", "set_todo", "remove_todo", "set_trip_note", "check_plan"].every((n) => names2.includes(n)), "tools/list has the control tools");
await seed("trips", "T4", { name: "Hampi", destination: "Hampi, India", startDate: "2027-01-10", currency: "INR", days: [{ id: "h1", title: "", base: "", notes: "" }, { id: "h2", title: "", base: "", notes: "" }, { id: "h3", title: "", base: "", notes: "" }],
  owner: "alice@example.com", members: ["alice@example.com", "bob@example.com"], memberNames: { "alice@example.com": "Alice", "bob@example.com": "Bob" }, extras: [], checklist: [], tripNotes: [{ id: "n9", text: "Sunrise at Matanga", by: "bob@example.com", done: false }] });
const H = "Hampi";
const pd = await tool(T, "plan_day", { trip: H, day: 1, stops: [
  { title: "Virupaksha Temple", category: "sight", location: "Hampi Bazaar", time: "08:00", lat: 15.335, lng: 76.46 },
  { title: "Mango Tree", category: "food", location: "Hampi" },
  { title: "Vittala Temple", category: "sight" }, { title: "Hampi Bazaar", category: "sight" }, { title: "Lotus Mahal", category: "sight" }, { title: "Elephant Stables", category: "sight" },
] });
ok(!pd.isError && pd.v.onDay.length === 6, "plan_day puts six stops on day 1 directly: " + (pd.isError ? pd.v : ""));
const w = (pd.v.warnings || []).join(" | ");
ok(/Mango Tree” isn't checked for vegetarian/.test(w) && /no rest block/.test(w) && /5 sights is too many/.test(w), "warnings: unchecked veg, no rest block, too many sights");
const d1h = await tool(T, "get_day", { trip: H, day: 1 });
ok(d1h.v.schedule.map((s) => s.title).join() === "Virupaksha Temple,Mango Tree,Vittala Temple,Hampi Bazaar,Lotus Mahal,Elephant Stables" && d1h.v.schedule[0].fixedTime === "08:00" && d1h.v.schedule[0].addedBy === "Alice", "stops are on the day in order, with the fixed time");
const rawv = (await fsReq("GET", "/trips/T4/items/" + pd.v.onDay.length)).s; // (no such id; just exercising rules)
const actp = await tool(T, "recent_activity", { trip: H, limit: 3 });
ok(actp.v[0].by === "Claude" && /planned day 1/.test(actp.v[0].text) && actp.v[0].undoable, "the activity feed shows Claude planned day 1, undoable");

const fixv = await tool(T, "update_item", { trip: H, item: "Mango Tree", changes: { veg: "yes", vegNote: "veg thali" } });
const fixr = await tool(T, "plan_day", { trip: H, day: 1, stops: [{ rest: true, time: "14:00", position: 4 }] });
const dropped = await tool(T, "remove_item", { trip: H, item: "Elephant Stables" });
const w2 = (dropped.v.warnings || []).join(" | ");
ok(fixv.v.changed.includes("veg") && !/Mango/.test(w2) && !/rest block/.test(w2) && !/too many/.test(w2), "after the fixes: veg checked, rest block added, four sights: no warnings left (" + w2 + ")");
const d1b = await tool(T, "get_day", { trip: H, day: 1 });
ok(d1b.v.schedule[3].title === "Rest & recharge" && d1b.v.schedule.length === 6, "the rest block went to position 4");

const mv = await tool(T, "move_item", { trip: H, item: "Lotus Mahal", day: 2 });
const d2 = await tool(T, "get_day", { trip: H, day: 2 });
const d1c = await tool(T, "get_day", { trip: H, day: 1 });
ok(d2.v.schedule[0].title === "Lotus Mahal" && d1c.v.schedule.length === 5 && d1c.v.schedule.every((s, i) => true), "move_item moves a stop to another day");
const toIdeas = await tool(T, "move_item", { trip: H, item: "Lotus Mahal", day: "ideas" });
ok((await tool(T, "get_day", { trip: H, day: "ideas" })).v.ideas.some((i) => i.title === "Lotus Mahal"), "move_item back to Ideas");
const reb = await tool(T, "plan_day", { trip: H, day: 3, replace: true, stops: [{ item: "Lotus Mahal", time: "09:00" }, { title: "Anegundi village", category: "nature" }] });
ok(reb.v.onDay.join() === "Lotus Mahal,Anegundi village" && !(reb.v.notes || []).length, "plan_day moves an existing idea onto a day and creates a new place");
const amb = await tool(T, "move_item", { trip: H, item: "temple", day: 2 });
ok(amb.isError && /matches several/.test(amb.v), "an ambiguous place name asks for an id");

console.log("   undo of the control changes");
const un1 = await tool(T, "undo_change", { trip: H }); // the rebuild of day 3
const d3 = await tool(T, "get_day", { trip: H, day: 3 });
ok(!un1.isError && (d3.v.schedule || []).length === 0 && (await tool(T, "get_day", { trip: H, day: "ideas" })).v.ideas.some((i) => i.title === "Lotus Mahal") && !(await tool(T, "search_items", { trip: H, query: "Anegundi" })).v.length, "undoing the day rebuild removes the new place and sends Lotus Mahal back to Ideas");
const un2 = await tool(T, "undo_change", { trip: H }); // move to ideas
ok(!un2.isError && (await tool(T, "get_day", { trip: H, day: 2 })).v.schedule[0].title === "Lotus Mahal", "undoing a move puts the stop back on its day");
await tool(T, "undo_change", { trip: H }); // move to day 2
const un4 = await tool(T, "undo_change", { trip: H }); // remove Elephant Stables
ok(!un4.isError && (await tool(T, "get_day", { trip: H, day: 1 })).v.schedule.some((s) => s.title === "Elephant Stables"), "undoing a delete brings the place back");
// a hand edit after the AI change blocks undo
const e1 = await tool(T, "update_item", { trip: H, item: "Mango Tree", changes: { notes: "ask for no onion" } });
await fsReq("PATCH", `/trips/T4/items/${(await tool(T, "search_items", { trip: H, query: "Mango" })).v[0].id}?updateMask.fieldPaths=notes`, { fields: { notes: { stringValue: "edited by hand" } } });
const ue = await tool(T, "undo_change", { trip: H, entry: e1.v.undoWith.entry });
ok(ue.isError && /changed since/.test(ue.v), "undo refuses to overwrite something the couple edited by hand since");

console.log("   days, trip, bookings, extras, Kit, notes");
const ud = await tool(T, "update_day", { trip: H, day: 2, title: "Sunrise and boulders", base: "Hospet", startTime: "6:30" });
const gt2 = (await tool(T, "get_trip", { trip: H })).v;
ok(gt2.days[1].title === "Sunrise and boulders" && gt2.days[1].stayingIn === "Hospet", "update_day");
const ad = await tool(T, "add_day", { trip: H, after: 1 });
ok(ad.v.days === 4 && (await tool(T, "get_trip", { trip: H })).v.days[1].stops === 0, "add_day inserts an empty day");
await tool(T, "undo_change", { trip: H });
const rd = await tool(T, "remove_day", { trip: H, day: 1 });
const afterRd = (await tool(T, "get_trip", { trip: H })).v;
ok(afterRd.days.length === 2 && afterRd.ideasCount >= 4 && rd.v.movedToIdeas.length >= 4, "remove_day sends its stops to Ideas, nothing is deleted");
const urd = await tool(T, "undo_change", { trip: H });
const afterU = (await tool(T, "get_trip", { trip: H })).v;
ok(!urd.isError && afterU.days.length === 3 && afterU.days[0].stops >= 4, "undoing remove_day restores the day and its stops");
const ut = await tool(T, "update_trip", { trip: H, name: "Hampi long weekend", budget: 30000 });
ok((await tool(T, "get_trip", { trip: H })).v.name === "Hampi long weekend", "update_trip");
await tool(T, "undo_change", { trip: H });
ok((await tool(T, "get_trip", { trip: "Hampi" })).v.name === "Hampi", "…and undo restores the name");
const bk = await tool(T, "add_booking", { trip: H, kind: "hotel", title: "Evolve Back", ref: "EB123", start: "2027-01-10", end: "2027-01-12T11:00", cost: 18000 });
const bk2 = await tool(T, "add_booking", { trip: H, kind: "hotel", title: "Evolve Back", ref: "EB123" });
const bkb = await tool(T, "add_booking", { trip: H, kind: "train", title: "Late train", start: "2027-03-01T10:00" });
const gb = (await tool(T, "get_trip", { trip: H })).v.bookings;
ok(bk.v.saved && bk2.v.saved === false && gb.length === 2 && gb[0].start === "2027-01-10T00:00" && (bkb.v.warnings || []).length === 1, "add_booking: saved once, duplicate skipped, out-of-dates warned");
const ub = await tool(T, "update_booking", { trip: H, id: bk.v.id, ref: "EB999", cost: 19000 });
ok((await tool(T, "get_trip", { trip: H })).v.bookings[0].ref === "EB999", "update_booking");
await tool(T, "undo_change", { trip: H });
ok((await tool(T, "get_trip", { trip: H })).v.bookings[0].ref === "EB123", "…undone");
const rb = await tool(T, "remove_booking", { trip: H, id: bkb.v.id });
await tool(T, "undo_change", { trip: H });
ok((await tool(T, "get_trip", { trip: H })).v.bookings.length === 2, "remove_booking, then undo puts it back");
const exr = await tool(T, "add_extra", { trip: H, label: "Return flights", cost: 24000 });
ok((await tool(T, "get_trip", { trip: H })).v.extras.length === 1 && (await tool(T, "add_extra", { trip: H, label: "return flights", cost: 24000 })).v.saved === false, "add_extra, once");
await tool(T, "remove_extra", { trip: H, id: exr.v.id });
const todo = await tool(T, "add_todo", { trip: H, text: "Buy sunscreen", group: "pack" });
const st = await tool(T, "set_todo", { trip: H, id: todo.v.id, done: true });
const ck = (await tool(T, "get_trip", { trip: H })).v.checklist;
ok(ck.length === 1 && ck[0].done === true && ck[0].group === "pack", "add_todo and set_todo");
await tool(T, "undo_change", { trip: H });
ok((await tool(T, "get_trip", { trip: H })).v.checklist[0].done === false, "…ticking undone");
await tool(T, "remove_todo", { trip: H, id: todo.v.id });
ok((await tool(T, "get_trip", { trip: H })).v.checklist.length === 0, "remove_todo");
const sn = await tool(T, "set_trip_note", { trip: H, id: "n9", done: true });
ok((await tool(T, "get_trip", { trip: H })).v.tripNotes[0].done === true, "set_trip_note marks done");
await tool(T, "set_trip_note", { trip: H, id: "n9", remove: true });
await tool(T, "undo_change", { trip: H });
ok((await tool(T, "get_trip", { trip: H })).v.tripNotes.length === 1, "removing a note is undoable");
const cp = await tool(T, "check_plan", { trip: H });
ok(cp.v.days === 3 && Array.isArray(cp.v.warnings) && cp.v.emptyDays.includes(3), "check_plan reports empty days and warnings without changing anything");
const gtl = await tool(GT, "update_trip", { trip: "T2", name: "x" });
ok(gtl.isError, "control tools can't touch a trip the account isn't on");
const dirty = (await fsReq("GET", "/trips/T4", null, A.who.idToken)).j.fields;
ok(!JSON.stringify(dirty).includes("refreshToken") && !JSON.stringify(dirty).includes("access_token"), "no secrets land on the trip doc");

console.log("(k) disconnect endpoint (for the app's Connect card)");
const cx = (path, body, origin = ORIGIN) => fetch(W + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const B2 = await connect({ email: "bob@example.com", name: "Claude" });
const lst = await (await cx("/connections", { idToken: (await signIn("bob@example.com")).idToken })).json();
ok(lst.connections?.length >= 2 && lst.connections.some((x) => x.client === "Gemini") && lst.connections.some((x) => x.client === "Claude"), "an account lists its own connections: " + JSON.stringify(lst.connections?.map((x) => x.client)));
ok((await cx("/connections", { idToken: (await signIn("bob@example.com")).idToken }, "https://evil.example")).status === 403, "other websites can't call it");
ok((await cx("/disconnect", { idToken: "garbage" })).status === 401, "a bad sign-in is refused");
const aliceList = await (await cx("/connections", { idToken: A.who.idToken })).json();
ok(aliceList.connections.every((x) => x.client === "Claude") && aliceList.connections.length >= 1, "Alice sees only her own connections");
const one = lst.connections.find((x) => x.client === "Gemini");
const rv = await (await cx("/disconnect", { idToken: (await signIn("bob@example.com")).idToken, id: one.id })).json();
ok(rv.revoked === 1, "one connection can be revoked");
const gone = await tool(GT, "list_trips");
ok(gone.v !== undefined && !Array.isArray(gone.v), "the revoked connection stops working at once");
const live = await tool(B2.token.access_token, "list_trips");
ok(Array.isArray(live.v), "other connections keep working");
const all = await (await cx("/disconnect", { idToken: (await signIn("bob@example.com")).idToken })).json();
ok(all.revoked >= 1 && !Array.isArray((await tool(B2.token.access_token, "list_trips")).v), "disconnect with no id cuts everything for the account");
ok((await tool(T, "list_trips")).v.length >= 1, "…and never touches another account");

stop();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
