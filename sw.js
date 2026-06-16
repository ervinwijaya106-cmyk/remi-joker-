/* ═══════════════════════════════════════════════════════════════
   SCORE CEKIH — sw.js — Sadewa Corp
   Service Worker · PWA Offline Support
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'score-cekih-v7';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  // Images
  'images/background.png',
  'images/joker.png',
  'images/joker.ico',
  'images/border_1.png',
  'images/border_2.png',
  'images/border_3.png',
  'images/border_4.png',
  'images/animal_1.png',
  'images/animal_2.png',
  'images/animal_3.png',
  'images/animal_4.png',
  // Audio
  'audio/casino_bg.mp3',
  'audio/mulai_dari_0_ya_bapak.wav',
  'audio/kok_minus_terus_sih_gamau_menang.wav',
  'audio/klik.wav',
  // Video
  'video/dragon.mp4',
  'video/tiger.mp4',
  'video/eagle.mp4',
  'video/cobra.mp4',
  // External Chart.js (cached on first load)
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

/* INSTALL */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache files individually so one failure doesn't break all
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err);
          })
        )
      );
    })
  );
});

/* ACTIVATE */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* FETCH — Cache First, Network Fallback */
self.addEventListener('fetch', event => {
  // Skip non-GET requests and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
