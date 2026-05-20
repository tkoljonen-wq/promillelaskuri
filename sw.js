const cacheName = 'alkolaskuri-v2';
const assets = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg'
];

// Asennetaan ja tallennetaan tiedostot välimuistiin
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(cacheName).then(cache => cache.addAll(assets))
  );
  self.skipWaiting(); // Uusi SW aktivoituu heti ilman sivun päivitystä
});

// Poistetaan vanhat välimuistiversiot aktivoinnin yhteydessä
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== cacheName).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network First -strategia: haetaan aina ensin verkosta, välimuisti fallbackina
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Tallennetaan tuore vastaus välimuistiin offline-käyttöä varten
        const clone = response.clone();
        caches.open(cacheName).then(cache => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request)) // Offline: käytetään välimuistia
  );
});
