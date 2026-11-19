// Kitaplığım service worker: uygulama kabuğunu önbelleğe alır, veriyi her zaman ağdan çeker.
const SURUM = 'kitapligim-v1';
const KABUK = ['/', '/index.html', '/manifest.json', '/ikon-192.png', '/ikon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SURUM).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // Supabase, API, kapak ve ses dosyaları: hiç karışma, doğrudan ağa gitsin.
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  // Sayfa: önce ağ (yeni sürüm hemen gelsin), internet yoksa önbellek.
  if (r.mode === 'navigate') {
    e.respondWith(
      fetch(r)
        .then(res => { const k = res.clone(); caches.open(SURUM).then(c => c.put('/index.html', k)); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Diğer site dosyaları (ikonlar, manifest): önce önbellek.
  e.respondWith(
    caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res.ok) { const k = res.clone(); caches.open(SURUM).then(c => c.put(r, k)); }
      return res;
    }))
  );
});
