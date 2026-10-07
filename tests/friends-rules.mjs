// Firestore rules test for friends mode: AI users only, private docs, members leaving/removal, join links. Emulator.
// Run: node tests/friends-rules.mjs   (starts the emulators itself via the firebase CLI in /tmp/claude-0/fbt)
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

const A = "akash@example.com", F = "fiona@example.com", G = "gus@example.com", J = "jo@example.com", X = "xena@example.com";
const [akash, fiona, gus, jo, xena] = await Promise.all([A, F, G, J, X].map(signIn));
// The emulator's "owner" token bypasses the rules: use it to seed what only the console can write (aiUsers) and trips.
await create("aiUsers", A, { on: true }, "owner");
await create("trips", "T1", { name: "Goa", owner: A, members: [A, F, G], memberNames: { [A]: "Akash" }, join: { code: "CODE1", at: 1 } }, "owner");
await create("trips", "T2", { name: "Other", owner: X, members: [X] }, "owner");
await create("joins", "CODE1", { tripId: "T1", by: A, at: 1 }, "owner");
await create("joins", "CODE2", { tripId: "T2", by: X, at: 1 }, "owner");
const members = (list) => ({ members: list });

console.log("(a) aiUsers and private");
ok((await req("GET", `/aiUsers/${A}`, { token: akash })).s === 200, "an account can read its own aiUsers doc");
ok((await req("GET", `/aiUsers/${F}`, { token: fiona })).s === 404, "a non-AI account just sees that it has none");
ok((await req("GET", `/aiUsers/${A}`, { token: fiona })).s === 403, "…and cannot read someone else's");
ok((await req("GET", `/aiUsers`, { token: akash })).s === 403, "aiUsers cannot be listed");
ok((await create("aiUsers", F, { on: true }, fiona)).s === 403, "nobody can make themselves an AI user");
ok((await create("private", A, { ai: { key: "AIza-secret" }, bridges: { T1: { token: "t", at: 1 } } }, akash)).s === 200, "AI user creates their private doc");
ok((await patch(`private/${A}`, { ai: { key: "AIza-2" } }, akash)).s === 200, "AI user updates it");
ok((await req("GET", `/private/${A}`, { token: akash })).j.fields?.ai?.mapValue?.fields?.key?.stringValue === "AIza-2", "AI user reads it back");
ok((await req("GET", `/private/${A}`, { token: fiona })).s === 403, "a friend on the same trip can't read Akash's private doc");
ok((await req("GET", `/private/${A}`)).s === 403, "unauthenticated can't read it either");
ok((await patch(`private/${A}`, { ai: { key: "evil" } }, fiona)).s === 403, "a friend can't write it");
ok((await create("private", F, { ai: { key: "x" } }, fiona)).s === 403, "a non-AI user can't create their own private doc");
ok((await req("GET", `/private/${F}`, { token: fiona })).s === 403, "a non-AI user can't read their own private doc");

console.log("(b) members can add, leave, but not remove others");
ok((await patch("trips/T1", members([A, F, G, J]), fiona)).s === 200, "a member invites someone (adds an email)");
ok((await patch("trips/T1", members([A, F, J]), fiona)).s === 403, "a member can't remove another member");
ok((await patch("trips/T1", members([A, G, J]), fiona)).s === 200, "a member can leave (removes only themselves)");
ok((await req("GET", "/trips/T1", { token: fiona })).s === 403, "…and can no longer read the trip");
ok((await patch("trips/T1", members([A]), gus)).s === 403, "leaving can't also drop someone else");
ok((await patch("trips/T1", members([A, J]), gus)).s === 200, "another member can leave");
ok((await patch("trips/T1", members([J]), jo)).s === 403, "a member can't drop the owner");
await patch("trips/T1", members([A, F, G, J]), akash);
ok((await patch("trips/T1", members([A, F, J]), akash)).s === 200, "the owner can remove a member");
ok((await patch("trips/T1", members([F, J]), akash)).s === 403, "the owner can't remove themselves");
ok((await patch("trips/T1", { owner: F }, jo)).s === 403, "owner can't be changed");
ok((await patch("trips/T1", { join: { code: "HACK", at: 2 } }, jo)).s === 403, "a non-owner member can't change the invite link");
ok((await patch("trips/T1", { join: { code: "CODE3", at: 2 } }, akash)).s === 200, "the owner can change it");
await patch("trips/T1", { join: { code: "CODE1", at: 1 } }, akash);

console.log("(c) join links");
await patch("trips/T1", members([A, G, J]), akash);
const joinWrite = (extra = {}, token = fiona, list = [A, G, J, F]) => patch("trips/T1", { ...members(list), memberNames: { [A]: "Akash", [F]: "Fiona" }, lastJoin: "CODE1", updatedBy: F, updatedByName: "Fiona", updatedAt: 5, ...extra }, token);
ok((await req("GET", "/joins/CODE1", { token: fiona })).s === 200, "a signed-in person can read a join doc by its code");
ok((await req("GET", "/joins/CODE1")).s === 403, "unauthenticated can't");
ok((await req("GET", "/joins", { token: fiona })).s === 403, "join docs can't be listed");
ok((await joinWrite({ lastJoin: "WRONG" })).s === 403, "a wrong code fails");
ok((await joinWrite({ lastJoin: "CODE2" })).s === 403, "a code for another trip fails");
ok((await joinWrite({ name: "Mine now" })).s === 403, "a joiner can't change other fields");
ok((await joinWrite({}, fiona, [A, G, J, F, X])).s === 403, "a joiner can't add anyone else");
ok((await joinWrite({}, fiona, [A, G, J])).s === 403, "a joiner must add themselves");
ok((await joinWrite({ owner: F })).s === 403, "a joiner can't take over the trip");
ok((await joinWrite({ join: { code: "x", at: 1 } })).s === 403, "a joiner can't touch the invite link");
ok((await joinWrite()).s === 200, "a joiner with a valid code joins");
ok((await req("GET", "/trips/T1", { token: fiona })).s === 200, "…and can read the trip");
ok((await create("trips/T1/items", "i1", { title: "Beach" }, fiona)).s === 200, "…and add stops");

console.log("(d) creating and deleting join links");
ok((await create("joins", "NEW1", { tripId: "T1", by: A, at: 2 }, akash)).s === 200, "the owner creates a join for their trip");
ok((await create("joins", "NEW2", { tripId: "T1", by: J, at: 2 }, jo)).s === 403, "a non-owner member can't");
ok((await create("joins", "NEW3", { tripId: "T1", by: X, at: 2 }, xena)).s === 403, "a stranger can't");
ok((await create("joins", "NEW4", { tripId: "T2", by: A, at: 2 }, akash)).s === 403, "the owner of one trip can't make a join for another");
ok((await req("DELETE", "/joins/NEW1", { token: jo })).s === 403, "a non-owner can't delete one");
ok((await req("DELETE", "/joins/NEW1", { token: akash })).s === 200, "the owner can");

console.log("(e) Claude link needs an AI user");
const doc = { tripId: "T1", by: "Akash", at: 1, on: true, snapshot: "", snapshotAt: 0, inbox: [] };
ok((await create("bridges", "tok_jo_" + "j".repeat(21), doc, jo)).s === 403, "a non-AI member can't create a bridge");
ok((await create("bridges", "tok_ak_" + "a".repeat(21), doc, akash)).s === 200, "the AI user can");
ok((await patch(`bridges/tok_ak_${"a".repeat(21)}`, { snapshot: "{}" }, jo)).s === 403, "a non-AI member can't update it");
ok((await req("DELETE", `/bridges/tok_ak_${"a".repeat(21)}`, { token: jo })).s === 403, "…or delete it");
ok((await commit([{ transform: { document: `${DOC}/bridges/tok_ak_${"a".repeat(21)}`, fieldTransforms: [
  { fieldPath: "inbox", appendMissingElements: { values: [val({ id: "e1", at: 1, json: "{}" })] } }, { fieldPath: "inboxAt", setToServerValue: "REQUEST_TIME" }] }, currentDocument: { exists: true } }])).s === 200, "Claude's unauthenticated inbox append still works");
ok((await req("DELETE", `/bridges/tok_ak_${"a".repeat(21)}`, { token: akash })).s === 200, "the AI user deletes it");

console.log(fails ? `\n${fails} failure(s)` : "\nAll friends rules checks passed");
process.exit(fails ? 1 : 0);
