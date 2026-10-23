// Turns the Firebase refresh token stored with the OAuth grant into short-lived ID tokens, and re-checks aiUsers.
import { firestoreClient } from "./firestore.js";

const cache = new Map(); // refresh token -> { idToken, exp, email, aiAt }
const AI_RECHECK_MS = 5 * 60 * 1000;

export class SignInExpired extends Error {}
export class NotAiUser extends Error {}

const b64 = (s) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
export const claims = (jwt) => b64(jwt.split(".")[1]);

export async function exchange(env, refreshToken) {
  const url = (env.SECURETOKEN_URL || "https://securetoken.googleapis.com/v1/token") + "?key=" + encodeURIComponent(env.FIREBASE_API_KEY);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new SignInExpired(j?.error?.message || "refresh failed");
  const c = claims(j.id_token);
  if (!c.email || c.email_verified !== true) throw new SignInExpired("email not verified");
  return { idToken: j.id_token, exp: c.exp * 1000, email: String(c.email).toLowerCase(), name: c.name || "", refreshToken: j.refresh_token || refreshToken };
}

// Returns { fs, email, name }: a Firestore client acting as the user. Throws NotAiUser or SignInExpired.
export async function session(env, refreshToken, client = "") {
  let s = cache.get(refreshToken);
  if (!s || s.exp - Date.now() < 120000) {
    s = { ...(await exchange(env, refreshToken)), aiAt: 0 };
    cache.set(refreshToken, s);
    if (cache.size > 50) cache.delete(cache.keys().next().value);
  }
  const fs = firestoreClient(env, s.idToken);
  if (Date.now() - s.aiAt > AI_RECHECK_MS) {
    if (!(await fs.exists(`aiUsers/${s.email}`))) { cache.delete(refreshToken); throw new NotAiUser(s.email); }
    s.aiAt = Date.now();
  }
  return { fs, email: s.email, name: s.name, client: client || "AI connector" };
}
