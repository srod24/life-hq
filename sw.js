/* Life HQ service worker: caches the app shell so it opens offline.
   Your data is NOT here; it lives in IndexedDB. Bump VERSION whenever you deploy changed files. */
const VERSION = "lifehq-v1";
const SHELL = [
  "./", "index.html", "app.js", "app.css", "store.js", "manifest.webmanifest",
  "vendor/jspdf.umd.min.js",
  "fonts/fonts.css", "fonts/BricolageGrotesque-var.woff2", "fonts/IBMPlexSans-var.woff2", "fonts/IBMPlexMono-400.woff2", "fonts/IBMPlexMono-500.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];
const url = p => new URL(p, self.registration.scope).href;   // works at any subpath

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(p => new Request(url(p), { cache: "reload" })))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lifehq-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    // network first so a new deploy shows up, cached shell when offline
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); if (r.ok) caches.open(VERSION).then(c => c.put(url("index.html"), copy)); return r; })
      .catch(() => caches.match(url("index.html"), { ignoreSearch: true })));
    return;
  }
  // static files: cache first, refresh in the background
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit || Response.error());
    return hit || net;
  }));
});
