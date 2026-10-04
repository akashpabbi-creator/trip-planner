// Minimal service worker: makes the app installable (needed for "Share to Trips" on Android)
// and keeps the app shell available offline. Data sync is handled by Firestore itself.
const CACHE = "trips-shell-v12";
const SHELL = ["./", "index.html", "styles.css", "app.js", "store.js", "unfurl.js", "smart.js", "discover.js", "ai.js", "profile.js", "linkinfo.js", "config.js", "manifest.webmanifest", "icons/icon.svg"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
);
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
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
