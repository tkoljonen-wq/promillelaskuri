// Origin tkoljonen-wq.github.io on jaettu muiden sovellusten kanssa:
// poistetaan vain tämän sovelluksen omat vanhat välimuistit
const CACHE_PREFIX = 'alkolaskuri-';
const cacheName = CACHE_PREFIX + 'v5';
const assets = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg'
];

// Asennetaan ja tallennetaan tiedostot välimuistiin.
// cache: 'reload' varmistaa, ettei selaimen HTTP-välimuisti syötä vanhoja
// versioita suoraan uuteen SW-välimuistiin.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(cacheName).then(cache =>
      cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })))
    )
  );
  self.skipWaiting(); // Uusi SW aktivoituu heti ilman sivun päivitystä
});

// Poistetaan vanhat välimuistiversiot aktivoinnin yhteydessä
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheName).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network First -strategia: haetaan aina ensin verkosta, välimuisti fallbackina.
// Omille tiedostoille cache: 'no-cache' ohittaa selaimen oman HTTP-välimuistin —
// muuten GitHub Pagesin max-age=600 saisi selaimen tarjoilemaan vanhaa app.js:ää
// ~10 min julkaisun jälkeen. Ulkoisille (Tailwind CDN) käytetään normaalia
// välimuistia, jotta jokainen käynnistys ei lataa kirjastoa uudelleen.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    fetch(e.request, sameOrigin ? { cache: 'no-cache' } : undefined)
      .then(response => {
        // Tallennetaan vain onnistuneet vastaukset — virhesivu (esim. 404/500)
        // ei saa korvata toimivaa välimuistiversiota
        if (response.ok) {
          const clone = response.clone();
          caches.open(cacheName)
            .then(cache => cache.put(e.request, clone))
            .catch(() => {}); // esim. ei-tuettu scheme — ei kaadeta vastausta
        }
        return response;
      })
      .catch(() =>
        // Offline: käytetään välimuistia; navigoinnille fallback etusivuun.
        // respondWith ei saa koskaan saada undefined-arvoa.
        caches.match(e.request).then(cached =>
          cached || (e.request.mode === 'navigate'
            ? caches.match('./index.html')
            : Response.error())
        )
      )
  );
});
