// Trips connector: a Cloudflare Worker that speaks MCP and OAuth (dynamic client registration) so Claude and Gemini can use
// the trip planner. Sign-in is Google, done on the app's own site (connect.html on GitHub Pages); this Worker then calls
// Firestore as that user, so the published firestore.rules decide what it can touch.
import { OAuthProvider, AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { handleMcp } from "./mcp.js";
import { exchange, SignInExpired } from "./session.js";
import { firestoreClient } from "./firestore.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const html = (body, status = 200, headers = new Headers()) => {
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
};
const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 20px}
h1{font-size:1.35rem}button{font:inherit;padding:.65rem 1.2rem;border-radius:10px;border:1px solid #8886;background:#0b7a75;color:#fff;cursor:pointer}
button.no{background:transparent;color:inherit}.warn{border-left:4px solid #d97706;padding:.4rem .8rem;background:#d9770622}.muted{opacity:.7;font-size:.9rem}</style></head><body>${inner}</body></html>`;

function consentPage(d, handle) {
  return page("Connect to Trips", `<h1>Allow ${esc(d.clientName)} to use your trips?</h1>
<p>${d.clientDomain ? `Published by <strong>${esc(d.clientDomain)}</strong>.` : "This app registered itself, so its name is not verified."}
It will be sent to <strong>${esc(d.redirectHost)}</strong>.</p>
<p>It will be able to read your trips and, in later steps, change them, as you. You can disconnect any time from the app (More, Connect Claude).</p>
${d.redirectIsLoopback ? `<p class="warn">This sends access to an app on your own computer. Continue only if you just started connecting from it.</p>` : ""}
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">
<button name="decision" value="approve">Continue to Google sign-in</button> <button class="no" name="decision" value="deny">Cancel</button></form>
<p class="muted">Next you sign in with Google on the trip planner site.</p>`);
}

const publicOrigin = (env, request) => new URL(env.PUBLIC_URL || request.url).origin;
const allowedOrigin = (env) => (env.ALLOWED_ORIGIN || "https://akashpabbi-creator.github.io").replace(/\/$/, "");
const connectUrl = (env) => env.CONNECT_URL || allowedOrigin(env) + "/trip-planner/connect.html";
const cors = (env) => ({
  "Access-Control-Allow-Origin": allowedOrigin(env), "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin",
});
const json = (env, body, status = 200) => Response.json(body, { status, headers: cors(env) });

const defaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (url.pathname === "/authorize" && request.method === "GET") {
        const authReq = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(authReq);
        const consent = await oauth.beginConsent(authReq);
        return html(consentPage(details, consent.handle), 200, consent.headers);
      }
      if (url.pathname === "/authorize" && request.method === "POST") {
        const form = await request.formData();
        const handle = String(form.get("handle") || "");
        if (form.get("decision") !== "approve") {
          const denied = await oauth.denyConsent(request, handle);
          denied.headers.set("Location", denied.redirectTo);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const approved = await oauth.approveConsent(request, handle);
        const id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        await env.OAUTH_KV.put("connect:" + id, JSON.stringify(approved.request), { expirationTtl: 600 });
        const to = new URL(connectUrl(env));
        to.searchParams.set("w", publicOrigin(env, request));
        to.searchParams.set("id", id);
        approved.headers.set("Location", to.toString());
        return new Response(null, { status: 302, headers: approved.headers });
      }
      if (url.pathname === "/connect/complete") return await complete(request, env, oauth);
      if (url.pathname === "/") return html(page("Trips connector", `<h1>Trips connector</h1><p>This is the MCP address for the trip planner. Add <code>${esc(url.origin)}/mcp</code> as a custom connector in Claude or Gemini.</p>`));
      return new Response("Not found", { status: 404 });
    } catch (e) {
      if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
      if (e instanceof AuthorizationError) return html(page("Can't connect", `<h1>Can't connect</h1><p>${esc(e.description)}</p>`), 400);
      if (e instanceof CimdFetchError) return html(page("Can't connect", `<h1>Can't connect</h1><p>This app could not be verified.</p>`), 400);
      throw e;
    }
  },
};

// connect.html (github.io) posts the Google sign-in here. Only that origin may call it.
async function complete(request, env, oauth) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  if (request.method !== "POST") return json(env, { error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== allowedOrigin(env)) return new Response("Forbidden", { status: 403 });
  const { id, refreshToken } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || typeof refreshToken !== "string") return json(env, { error: "bad_request", message: "Missing sign-in." }, 400);
  const key = "connect:" + id;
  const raw = await env.OAUTH_KV.get(key);
  if (!raw) return json(env, { error: "expired", message: "This connection attempt expired. Go back to Claude or Gemini and start again." }, 400);
  let who;
  try { who = await exchange(env, refreshToken); }
  catch (e) { if (e instanceof SignInExpired) return json(env, { error: "bad_sign_in", message: "Google sign-in could not be verified." }, 401); throw e; }
  if (!(await firestoreClient(env, who.idToken).exists(`aiUsers/${who.email}`))) {
    return json(env, { error: "not_ai_user", message: `${who.email} isn't enabled for Claude and Gemini in the trip planner.` }, 403);
  }
  const authReq = JSON.parse(raw);
  const { redirectTo } = await oauth.completeAuthorization({
    request: authReq, userId: who.email, metadata: { email: who.email }, scope: authReq.scope,
    props: { email: who.email, name: who.name, refreshToken: who.refreshToken },
  });
  await env.OAUTH_KV.delete(key);
  return json(env, { redirectTo, email: who.email });
}

// The OAuth metadata names the Worker's own address, which is only known per request, so build the provider per origin.
const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin)) {
    providers.set(origin, new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: { fetch: (request, env, ctx) => handleMcp(request, env, ctx.props) },
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["trips"],
      accessTokenTTL: 3600,
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: { resource: origin + "/mcp", authorization_servers: [origin], scopes_supported: ["trips"], resource_name: "Trip planner" },
    }));
  }
  return providers.get(origin);
}

export default {
  fetch(request, env, ctx) {
    return providerFor(publicOrigin(env, request)).fetch(request, env, ctx);
  },
};
