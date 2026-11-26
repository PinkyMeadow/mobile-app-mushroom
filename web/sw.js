// Caches the app shell so it opens with no signal. Map tiles are stored by the app itself.
const CACHE = "spore-leaf-v8";
const PHOTOS = "ed-photos";
const SHELL = ["./", "index.html", "app.js", "edibles.js", "vendor/leaflet.js", "vendor/leaflet.css", "vendor/leaflet-heat.js", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== PHOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.hostname.endsWith("tile.openstreetmap.org") || u.hostname.endsWith("open-meteo.com")) return;
  // Species photos from iNaturalist: keep a copy so they show offline once seen.
  if (u.hostname === "inaturalist-open-data.s3.amazonaws.com" || u.hostname === "static.inaturalist.org") {
    e.respondWith(caches.open(PHOTOS).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }))));
    return;
  }
  const isFont = u.hostname.endsWith("fonts.googleapis.com") || u.hostname.endsWith("fonts.gstatic.com");
  if (u.origin !== location.origin && !isFont) return;
  // Network first for the app itself so updates arrive; cache when offline.
  e.respondWith(fetch(e.request, isFont ? {} : { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
