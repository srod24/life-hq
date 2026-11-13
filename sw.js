/* Life HQ service worker: caches the app so it opens offline.
   Your data is NOT here; it lives in IndexedDB ("lifehq") and is never touched by updates.
   Bump VERSION on every deploy. */
const VERSION = "lifehq-v3";
const SHELL = [
  "./", "index.html", "app-v2.js", "app-v2.css", "store.js", "manifest.webmanifest",
  "vendor/jspdf.umd.min.js", "vendor/supabase.umd.js", "fonts/fonts.css", "fonts/BricolageGrotesque-var.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];
const url = p => new URL(p, self.registration.scope).href;   // works at any subpath

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(p => new Request(url(p), { cache: "reload" })))).then(() => self.skipWaiting()));
});
// remove caches from older versions (also re-run on each launch, in case the old worker wrote one last file on its way out)
const cleanup = () => caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lifehq-") && k !== VERSION).map(k => caches.delete(k))));
self.addEventListener("activate", e => { e.waitUntil(cleanup().then(() => self.clients.claim())); });
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

// Code (page, JS, CSS, manifest): network first so a deploy never mixes old and new files; cache when offline.
// Fonts, icons, jsPDF: cache first.
const isCode = (req, u) => req.mode === "navigate" || /\.(js|css|webmanifest|html)$/.test(u.pathname) || u.pathname.endsWith("/");
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (isCode(req, u)) {
    const key = req.mode === "navigate" ? url("index.html") : req;
    if (req.mode === "navigate") e.waitUntil(new Promise(r => setTimeout(r, 3000)).then(cleanup));
    e.respondWith(timeout(fetch(req), 4000).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(key, copy)); } return r; })
      .catch(() => caches.open(VERSION).then(c => c.match(key, { ignoreSearch: true })).then(hit => hit || caches.match(key, { ignoreSearch: true })).then(hit => hit || Response.error())));
    return;
  }
  e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })));
});
