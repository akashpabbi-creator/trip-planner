// Firestore rules test for trip creators: only creators/admins start trips, admins manage the list, non-creators can still join by link. Emulator.
// Run: node tests/creators-rules.mjs   (starts the emulators itself via the firebase CLI in /tmp/claude-0/fbt)
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.RULES_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-creators-"));
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

const A = "akash@example.com", F = "fiona@example.com", G = "gus@example.com", X = "xena@example.com";
const [akash, fiona, gus, xena] = await Promise.all([A, F, G, X].map(signIn));
await create("aiUsers", A, { on: true }, "owner");
await create("creators", F, { on: true }, "owner");
await create("trips", "T1", { name: "Goa", owner: A, members: [A], memberNames: { [A]: "Akash" } }, "owner");
await create("joins", "CODE1", { tripId: "T1", by: A, at: 1 }, "owner");
const newTrip = (id, owner, token, members = [owner]) => create("trips", id, { name: "New", owner, members }, token);

console.log("(a) who can create trips");
ok((await newTrip("N1", X, xena)).s === 403, "a signed-in non-creator can't create a trip");
ok((await newTrip("N2", F, fiona)).s === 200, "a creator can");
ok((await newTrip("N3", A, akash)).s === 200, "an admin (AI user) can, even without a creators doc");
ok((await newTrip("N4", X, fiona)).s === 403, "a creator can't create a trip owned by someone else");
ok((await newTrip("N5", F, fiona, [F, X])).s === 403, "…or with other members already on it");
ok((await create("trips", "N6", { name: "x", owner: F, members: [F] })).s === 403, "unauthenticated can't create");

console.log("(b) the creators list");
ok((await req("GET", `/creators/${F}`, { token: fiona })).s === 200, "a creator can read their own doc");
ok((await req("GET", `/creators/${X}`, { token: xena })).s === 404, "a non-creator just sees that they have none");
ok((await req("GET", `/creators/${F}`, { token: xena })).s === 403, "…and can't read someone else's");
ok((await req("GET", `/creators`, { token: fiona })).s === 403, "a creator can't list the creators");
ok((await req("GET", `/creators`, { token: akash })).s === 200, "an admin can list them");
ok((await create("creators", X, { on: true }, xena)).s === 403, "nobody can make themselves a creator");
ok((await create("creators", X, { on: true }, fiona)).s === 403, "a creator can't add creators");
ok((await create("creators", G, { on: true, by: A }, akash)).s === 200, "an admin adds a creator");
ok((await newTrip("N7", G, gus)).s === 200, "…who can create trips right away");
ok((await req("DELETE", `/creators/${G}`, { token: gus })).s === 403, "a creator can't remove creators");
ok((await req("DELETE", `/creators/${G}`, { token: akash })).s === 200, "an admin removes one");
ok((await newTrip("N8", G, gus)).s === 403, "…and they can no longer create trips");
ok((await req("GET", "/trips/N7", { token: gus })).s === 200, "but they keep access to trips they already own");

console.log("(c) non-creators still join by link");
const joinT = (token, who) => patch("trips/T1", { members: [A, who], memberNames: { [A]: "Akash", [who]: "Xena" }, lastJoin: "CODE1", updatedBy: who, updatedByName: "Xena", updatedAt: 5 }, token);
ok((await joinT(xena, X)).s === 200, "a non-creator joins an existing trip through an invite link");
ok((await req("GET", "/trips/T1", { token: xena })).s === 200, "…and reads it");
ok((await patch("trips/T1", { name: "Goa trip" }, xena)).s === 200, "…and edits it");
ok((await create("trips/T1/items", "i1", { title: "Baga" }, xena)).s === 200, "…and adds stops");
ok((await req("DELETE", "/trips/T1", { token: xena })).s === 403, "…but can't delete it");
ok((await newTrip("N9", X, xena)).s === 403, "…and still can't create a trip of their own");

console.log(fails ? `\n${fails} failure(s)` : "\nAll creators rules checks passed");
process.exit(fails ? 1 : 0);
