// Firestore rules test for the Claude link (bridges) and the existing trip rules, against the emulator.
// Run: node tests/bridge-rules.mjs   (starts the emulators itself via the firebase CLI in /tmp/claude-0/fbt)
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.RULES_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-rules-"));
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } } }));
  copyFileSync(join(root, "firestore.rules"), join(dir, "firestore.rules"));
  const fb = process.env.FIREBASE_BIN || "/tmp/claude-0/fbt/node_modules/.bin/firebase";
  const r = spawnSync(fb, ["emulators:exec", "--only", "firestore,auth", "--project", "demo-trips", `RULES_CHILD=1 node ${fileURLToPath(import.meta.url)}`], { stdio: "inherit", cwd: dir });
  process.exit(r.status ?? 1);
}

const FS = "http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents";
const DOC = "projects/demo-trips/databases/(default)/documents";
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };

const val = (v) => v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? { integerValue: String(v) } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
async function signIn(email) {
  const tok = JSON.stringify({ sub: email, email, email_verified: true, name: email });
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=x", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(tok)}&providerId=google.com`, requestUri: "http://localhost", returnIdpCredential: true, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}
async function req(method, path, { token, body } = {}) {
  const r = await fetch(FS + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
}
const create = (col, id, data, token) => req("POST", `/${col}?documentId=${id}`, { token, body: { fields: fields(data) } });
const patch = (path, data, token) => req("PATCH", `/${path}?${Object.keys(data).map((k) => "updateMask.fieldPaths=" + k).join("&")}`, { token, body: { fields: fields(data) } });
const commit = (writes, token) => fetch(`http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents:commit`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ writes }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const append = (tok, entries, extra = []) => commit([{ transform: { document: `${DOC}/bridges/${tok}`, fieldTransforms: [
  { fieldPath: "inbox", appendMissingElements: { values: entries.map((e) => val(e)) } }, { fieldPath: "inboxAt", setToServerValue: "REQUEST_TIME" }, ...extra] }, currentDocument: { exists: true } }]);

const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com"), eve = await signIn("eve@example.com");
await create("trips", "T1", { name: "Rome", owner: "alice@example.com", members: ["alice@example.com"] }, alice);
await patch("trips/T1", { members: ["alice@example.com", "bob@example.com"] }, alice);
await create("trips", "T2", { name: "Other", owner: "eve@example.com", members: ["eve@example.com"] }, eve);
const TOK = "tok_" + "a".repeat(28);
const doc = { tripId: "T1", by: "Alice", at: 1, on: true, snapshot: "", snapshotAt: 0, inbox: [] };

console.log("(a) members manage a bridge");
ok((await create("bridges", TOK, doc, alice)).s === 200, "member (owner) creates a bridge for their trip");
ok((await create("bridges", "tok_bob_" + "b".repeat(20), { ...doc }, bob)).s === 200, "second member can also create one");
ok((await patch(`bridges/${TOK}`, { snapshot: "{\"x\":1}", snapshotAt: 5 }, bob)).s === 200, "member updates snapshot");
ok((await patch(`bridges/${TOK}`, { inbox: [] }, alice)).s === 200, "member clears the inbox (takeInbox)");
ok((await patch(`bridges/${TOK}`, { tripId: "T2" }, alice)).s === 403, "member cannot repoint the bridge at another trip");
ok((await req("DELETE", `/bridges/tok_bob_${"b".repeat(20)}`, { token: bob })).s === 200, "member deletes a bridge");

console.log("(b) the token is the secret: get works, list does not");
const g = await req("GET", `/bridges/${TOK}`);
ok(g.s === 200 && g.j.fields?.snapshot?.stringValue === '{"x":1}', "unauthenticated GET by token returns the doc");
ok((await req("GET", `/bridges`)).s === 403, "unauthenticated list of bridges is denied");
ok((await req("GET", `/bridges`, { token: alice })).s === 403, "even a signed-in member cannot list bridges");
ok((await req("GET", `/bridges/nope_${"z".repeat(20)}`)).s === 404, "unknown token is just a 404");

console.log("(c) Claude (no sign-in) may only add to the inbox");
const entry = { id: "e1", at: 1700000000000, json: JSON.stringify({ kind: "picks", items: [] }) };
const a1 = await append(TOK, [entry]);
ok(a1.s === 200, "unauthenticated REST :commit transform appends to inbox");
const after = await req("GET", `/bridges/${TOK}`);
ok(after.j.fields.inbox.arrayValue.values?.length === 1 && after.j.fields.inbox.arrayValue.values[0].mapValue.fields.json && after.j.fields.inboxAt?.timestampValue, "inbox has the entry and inboxAt is a server timestamp");
ok((await append(TOK, [{ ...entry, id: "e2" }])).s === 200 && (await req("GET", `/bridges/${TOK}`)).j.fields.inbox.arrayValue.values.length === 2, "a second entry appends after the first");
ok((await append(TOK, Array.from({ length: 31 }, (_, i) => ({ id: "x" + i, at: 1, json: "{}" })))).s === 403, "more than 30 inbox entries is denied");
ok((await commit([{ transform: { document: `${DOC}/bridges/${TOK}`, fieldTransforms: [{ fieldPath: "snapshot", appendMissingElements: { values: [val("x")] } }] }, currentDocument: { exists: true } }])).s === 403, "unauthenticated transform on snapshot is denied");
ok((await patch(`bridges/${TOK}`, { snapshot: "evil" })).s === 403, "unauthenticated write to snapshot is denied");
ok((await patch(`bridges/${TOK}`, { tripId: "T2" })).s === 403, "unauthenticated write to tripId is denied");
ok((await patch(`bridges/${TOK}`, { inbox: [entry], tripId: "T2" })).s === 403, "inbox write that also touches tripId is denied");
ok((await append(TOK, [entry], [{ fieldPath: "snapshotAt", setToServerValue: "REQUEST_TIME" }])).s === 403, "inbox append that also stamps snapshotAt is denied");
ok((await req("DELETE", `/bridges/${TOK}`)).s === 403, "unauthenticated delete is denied");
ok((await create("bridges", "tok_anon_" + "c".repeat(19), doc)).s === 403, "unauthenticated create is denied");
ok((await commit([{ transform: { document: `${DOC}/bridges/nope_${"z".repeat(20)}`, fieldTransforms: [{ fieldPath: "inbox", appendMissingElements: { values: [val("x")] } }] } }])).s !== 200, "transform on a doc that doesn't exist can't create it");
ok((await req("GET", `/bridges/${TOK}`)).j.fields.snapshot.stringValue === '{"x":1}', "snapshot is untouched after all the denied writes");

console.log("(d) a non-member can't use someone else's trip");
ok((await create("bridges", "tok_eve_" + "d".repeat(20), { ...doc, tripId: "T1" }, eve)).s === 403, "non-member cannot create a bridge for another trip");
ok((await patch(`bridges/${TOK}`, { snapshot: "eve" }, eve)).s === 403, "non-member cannot update another trip's bridge");
ok((await req("DELETE", `/bridges/${TOK}`, { token: eve })).s === 403, "non-member cannot delete another trip's bridge");
ok((await create("bridges", "tok_eve2_" + "e".repeat(19), { ...doc, tripId: "T2" }, eve)).s === 200, "…but can make one for their own trip");

console.log("(e) existing trip rules still hold");
ok((await req("GET", `/trips/T1`)).s === 403, "unauthenticated trip read denied");
ok((await req("GET", `/trips/T1`, { token: bob })).s === 200, "member reads the trip");
ok((await req("GET", `/trips/T1`, { token: eve })).s === 403, "non-member trip read denied");
ok((await patch(`trips/T1`, { bridge: { token: TOK, by: "alice@example.com", at: 1 } }, bob)).s === 200, "member writes trip.bridge");
ok((await patch(`trips/T1`, { owner: "bob@example.com" }, bob)).s === 403, "owner can't be changed");
ok((await create("trips", "T3", { name: "x", owner: "bob@example.com", members: ["bob@example.com", "alice@example.com"] }, bob)).s === 403, "can't create a trip with someone else as a member");
ok((await create("trips/T1/items", "i1", { title: "Colosseum" }, bob)).s === 200, "member adds an item");
ok((await create("trips/T1/items", "i2", { title: "Nope" }, eve)).s === 403, "non-member can't add an item");
ok((await req("GET", `/trips/T1/items/i1`)).s === 403, "unauthenticated item read denied");
ok((await req("GET", `/trips/T1/secrets/x`, { token: alice })).s === 403, "other subcollections are denied");
ok((await req("DELETE", `/trips/T1`, { token: bob })).s === 403, "only the owner deletes a trip");
ok((await req("DELETE", `/trips/T1`, { token: alice })).s === 200, "owner deletes the trip");

console.log(fails ? `\n${fails} failure(s)` : "\nAll rules checks passed");
process.exit(fails ? 1 : 0);
