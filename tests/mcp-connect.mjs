// Browser test of the sign-in hand-off: real Chromium goes through authorize -> consent -> connect.html (Google sign-in,
// emulated) -> back to the client's callback, with the Worker running locally. Then the new token reads the trips.
// Run: node tests/mcp-connect.mjs   (needs `cd mcp && npm i` and the emulator bench in /tmp/claude-0/fbt)
import { createRequire } from "module";
import { spawnSync, spawn, execSync } from "child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash, randomBytes } from "crypto";
import { encodeFields } from "../mcp/src/firestore.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FBT = "/tmp/claude-0/fbt/node_modules";
if (!process.env.MCP_CHILD) {
  const dir = mkdtempSync(join(tmpdir(), "tp-mcpc-"));
  writeFileSync(join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8080 }, auth: { port: 9099 }, ui: { enabled: false } } }));
  copyFileSync(join(root, "firestore.rules"), join(dir, "firestore.rules"));
  const r = spawnSync(`${FBT}/.bin/firebase`, ["emulators:exec", "--only", "firestore,auth", "--project", "demo-trips", `MCP_CHILD=1 node ${fileURLToPath(import.meta.url)}`], { stdio: "inherit", cwd: dir });
  process.exit(r.status ?? 1);
}
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright");

const WP = 8797, W = `http://127.0.0.1:${WP}`, PP = 8700 + Math.floor(Math.random() * 90), PAGE = `http://127.0.0.1:${PP}`;
const FS = "http://127.0.0.1:8080/v1/projects/demo-trips/databases/(default)/documents";
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + m); };

// The site, as GitHub Pages would serve it, pointed at the emulators and at the local Worker.
const dir = mkdtempSync(join(tmpdir(), "tp-site-"));
execSync(`cp -r "${root}/." "${dir}" && rm -rf "${dir}/.git" "${dir}/mcp/node_modules"`);
writeFileSync(join(dir, "config.js"), `window.FIREBASE_CONFIG = { apiKey: "fake-key", authDomain: "demo-trips.firebaseapp.com", projectId: "demo-trips" };
window.FIREBASE_EMULATORS = true; window.TEST_GOOGLE_USER = { email: "alice@example.com", name: "Alice" };\n`);
writeFileSync(join(dir, "mcp-config.js"), `window.MCP_ORIGIN = "${W}";\n`);
const site = spawn("python3", ["-m", "http.server", String(PP), "--bind", "127.0.0.1"], { cwd: dir, stdio: "ignore" });

const persist = mkdtempSync(join(tmpdir(), "tp-wr-"));
const worker = spawn(join(root, "mcp/node_modules/.bin/wrangler"), ["dev", "--local", "--port", String(WP), "--ip", "127.0.0.1", "--persist-to", persist,
  "--var", "FIREBASE_PROJECT:demo-trips", "--var", "FIREBASE_API_KEY:x", "--var", `ALLOWED_ORIGIN:${PAGE}`, "--var", `CONNECT_URL:${PAGE}/connect.html`, "--var", `PUBLIC_URL:${W}`,
  "--var", "FIRESTORE_HOST:http://127.0.0.1:8080", "--var", "SECURETOKEN_URL:http://127.0.0.1:9099/securetoken.googleapis.com/v1/token"],
  { cwd: join(root, "mcp"), stdio: "ignore", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
const stop = () => { try { worker.kill("SIGKILL"); site.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; ; i++) {
  if (await fetch(W + "/").then((r) => r.ok, () => false)) break;
  if (i > 120) { console.log("  FAIL worker did not start"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}

const seed = (col, id, data) => fetch(`${FS}/${col}?documentId=${id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ fields: encodeFields(data) }) });
await seed("aiUsers", "alice@example.com", { on: true });
await seed("trips", "T1", { name: "Goa", destination: "Goa", days: [{ id: "d1" }], owner: "alice@example.com", members: ["alice@example.com"], memberNames: {} });

const b64u = (x) => Buffer.from(x).toString("base64url");
const redirect = "https://claude.ai/api/mcp/auth_callback";
const reg = await (await fetch(W + "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) })).json();
const verifier = b64u(randomBytes(32)), challenge = b64u(createHash("sha256").update(verifier).digest());
const authUrl = `${W}/authorize?` + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, state: "xyz", code_challenge: challenge, code_challenge_method: "S256", resource: W + "/mcp" });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  let callback = null;
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/10.12.2/"))
      return r.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(join(FBT, "firebase", u.pathname.split("/").pop())) });
    if (u.href.startsWith(redirect)) { callback = u; return r.fulfill({ status: 200, contentType: "text/html", body: "<p>claude</p>" }); }
    return r.fulfill({ status: 404, body: "" });
  });

  console.log("(a) the full browser hand-off");
  await p.goto(authUrl);
  ok(/Allow Claude to use your trips/.test(await p.textContent("h1")), "consent page asks before anything happens");
  await p.click("button[value=approve]");
  await p.waitForURL(/connect\.html/);
  ok(new URL(p.url()).origin === PAGE, "then goes to connect.html on the app's own site");
  ok(await p.waitForSelector("#go", { state: "visible", timeout: 10000 }).then(() => true, () => false), "shows a Google sign-in button");
  await p.click("#go");
  await p.waitForURL(/claude\.ai/, { timeout: 15000 }).catch(() => {});
  ok(callback && callback.searchParams.get("state") === "xyz" && !!callback.searchParams.get("code"), "sign-in finishes and returns to the client with its code and state");
  const tok = await (await fetch(W + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: callback?.searchParams.get("code") || "", redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
  const call = await (await fetch(W + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok.access_token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_trips", arguments: {} } }) })).json();
  ok(/Goa/.test(call.result?.content?.[0]?.text || ""), "the new connection lists Alice's trip");

  console.log("(b) bad links");
  const p2 = await ctx.newPage();
  await p2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "www.gstatic.com") return r.fulfill({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: readFileSync(join(FBT, "firebase", u.pathname.split("/").pop())) });
    return r.fulfill({ status: 404, body: "" });
  });
  await p2.goto(`${PAGE}/connect.html?id=abc&w=${encodeURIComponent("https://evil.example")}`);
  ok(/isn't valid/.test(await p2.textContent("h1")) && !(await p2.isVisible("#go")), "a link naming another connector address never shows sign-in (your token can't be sent elsewhere)");
  await p2.goto(`${PAGE}/connect.html`);
  ok(/isn't valid/.test(await p2.textContent("h1")), "a link with no attempt id is refused");
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await browser.close();
  stop();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
