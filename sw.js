// Minimal service worker: makes the app installable (needed for "Share to Trips" on Android)
// and keeps the app shell available offline. Data sync is handled by Firestore itself.
// Bump CACHE on every release: a changed sw.js is what makes open apps show the "New version" refresh notice.
const CACHE = "trips-shell-v26";
// Firebase SDK and fonts live on other origins; versioned URLs, so cache-first is safe. Kept across shell bumps.
const CDN = "trips-cdn-v1";
const FBJS = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map((f) => "https://www.gstatic.com/firebasejs/10.12.2/" + f);
const CDN_HOSTS = ["https://www.gstatic.com/firebasejs/", "https://fonts.googleapis.com/", "https://fonts.gstatic.com/"];
async function cdnFetch(request) {
  const c = await caches.open(CDN);
  const hit = await c.match(request);
  const net = fetch(request).then((r) => {
    if (r.ok || (r.type === "opaque" && request.url.includes("fonts."))) c.put(request, r.clone());
    return r;
  });
  // fonts.googleapis CSS: stale-while-revalidate; everything else cache-first.
  if (hit) { if (request.url.startsWith("https://fonts.googleapis.com/")) net.catch(() => {}); return hit; }
  return net;
}
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js", "unfurl.js", "smart.js", "discover.js", "ai.js", "profile.js", "linkinfo.js", "map.js", "along.js", "social.js", "capture.js", "kit.js", "changes.js", "bridge.js", "bookings.js", "paste.js", "shuffle.js", "proposal-social.js", "config.js", "manifest.webmanifest", "icons/icon.svg"];
// Android "Share" to the installed app arrives as a POST (multipart: images + title/text/url). Images wait in
// Cache "share-inbox" until the app reads them (capture.js); text and links ride along in the redirect URL.
const INBOX = "share-inbox";
async function takeShare(form, cache) {
  const images = form.getAll("images").filter((f) => f && typeof f === "object" && String(f.type).startsWith("image/")).slice(0, 8);
  for (const k of await cache.keys()) await cache.delete(k);
  let saved = 0;
  for (const f of images) await cache.put("shared-image/" + saved++, new Response(f, { headers: { "Content-Type": f.type } }));
  const q = new URLSearchParams({ shared: "1" });
  for (const k of ["url", "text", "title"]) {
    const v = form.get(k);
    if (typeof v === "string" && v.trim()) q.set(k, v.trim().slice(0, 2000));
  }
  return { url: "./?" + q, saved };
}
async function handleShare(request) {
  let url = "./";
  try {
    url = (await takeShare(await request.formData(), await caches.open(INBOX))).url;
  } catch (e) {}
  return Response.redirect(new URL(url, self.registration.scope).href, 303);
}
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
      .then(() => caches.open(CDN).then((c) => Promise.all(FBJS.map((u) => c.match(u).then((h) => h || c.add(new Request(u, { mode: "cors" })))))).catch(() => {})) // best effort
      .then(() => self.skipWaiting())
  )
);
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== CDN && k !== INBOX).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.href === new URL("./", self.registration.scope).href) return e.respondWith(handleShare(e.request));
  if (e.request.method === "GET" && CDN_HOSTS.some((h) => url.href.startsWith(h))) return e.respondWith(cdnFetch(e.request));
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network first so updates show up straight away; fall back to the cached shell when offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
