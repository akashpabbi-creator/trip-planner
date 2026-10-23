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
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } } }));
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
  "--var", "FIRESTORE_HOST:http://127.0.0.1:8080", "--var", "SECURETOKEN_URL:http://127.0.0.1:9099/securetoken.googleapis.com/v1/token"],
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
  members: ["alice@example.com", "bob@example.com"], memberNames: { "alice@example.com": "Alice", "bob@example.com": "Bob" }, extras: [], tripNotes: [{ id: "n1", text: "Try a thali place", by: "bob@example.com" }] });
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

stop();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
