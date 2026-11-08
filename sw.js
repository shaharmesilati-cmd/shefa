// Offline support + "share to Shefa". A new version waits until the user taps "עדכון".
const VERSION = 'shefa-2.1.1';
const RUNTIME = 'shefa-engine'; // OCR engine files, cached on first use
const INBOX = 'shefa-inbox';    // shared screenshots, deleted as soon as the app reads them
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'assets/icons.svg',
  'js/app.js', 'js/vault.js', 'js/store.js', 'js/calc.js', 'js/util.js', 'js/categorize.js', 'js/importers.js', 'js/xlsx.js',
  'js/paste.js', 'js/sanitize.js', 'js/dedupe.js', 'js/ocr.js', 'js/ocrlayout.js', 'js/payslip.js', 'js/insights.js',
  'js/views/parts.js', 'js/views/home.js', 'js/views/expenses.js', 'js/views/add.js', 'js/views/budget.js', 'js/views/more.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== RUNTIME && k !== INBOX).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Screenshots shared from the phone's gallery: keep them only until the app opens and reads them.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const c = await caches.open(INBOX);
        let i = 0;
        for (const f of form.getAll('shots')) {
          if (f && typeof f === 'object' && /^image\//.test(f.type) && f.size < 25 * 1024 * 1024 && i < 20) {
            await c.put(new Request(`inbox/${Date.now()}-${i++}`), new Response(f, { headers: { 'content-type': f.type, 'x-at': String(Date.now()) } }));
          }
        }
      } catch { }
      return Response.redirect(new URL('./#add', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;

  const isEngine = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    const c = await caches.open(isEngine ? RUNTIME : VERSION);
    const hit = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' ? await (await caches.open(VERSION)).match('index.html') : null);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (isEngine && res.ok && e.request.method === 'GET') c.put(e.request, res.clone()).catch(() => { });
    return res;
  })());
});
