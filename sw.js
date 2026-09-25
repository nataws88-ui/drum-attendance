/* 드럼 출석부 — 서비스 워커 (오프라인 사전 캐시, 같은 출처 cache-first) */
'use strict';

var CACHE = 'drum-attendance-v1.2.1-7ac887e040';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './css/app.css',
  './css/today.css',
  './css/kiosk.css',
  './css/timetable.css',
  './css/students.css',
  './css/stats.css',
  './css/settings.css',
  './css/print.css',
  './css/pass.css',
  './css/v12.css',
  './js/core/util.js',
  './js/core/store.js',
  './js/core/schedule.js',
  './js/core/pass.js',
  './js/core/billing.js',
  './js/core/rooms.js',
  './js/core/ops.js',
  './js/core/ask.js',
  './js/core/stats.js',
  './js/core/backup.js',
  './js/core/demo.js',
  './js/vendor/qrcode.js',
  './js/vendor/jsQR.js',
  './js/ui/icons.js',
  './js/ui/shell.js',
  './js/ui/signature.js',
  './js/ui/actions.js',
  './js/ui/charts.js',
  './js/ui/qr.js',
  './js/ui/pass-ui.js',
  './js/ui/billing-ui.js',
  './js/ui/rooms-ui.js',
  './js/ui/ops-ui.js',
  './js/ui/ask-ui.js',
  './js/ui/more.js',
  './js/ui/today.js',
  './js/ui/kiosk.js',
  './js/ui/timetable.js',
  './js/ui/students.js',
  './js/ui/stats-view.js',
  './js/ui/settings.js',
  './js/ui/print.js',
  './js/app.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    var reqs = ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); });
    return cache.addAll(reqs).catch(function () {
      // 하나라도 실패하면 하나씩(가능한 것만) 담는다
      return Promise.all(reqs.map(function (r) { return cache.add(r).catch(function () { return null; }); }));
    });
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k !== CACHE && k.indexOf('drum-attendance-') === 0;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html').then(function (idx) {
          return idx || fetch(req);
        });
      }).catch(function () {
        return fetch(req).catch(function () { return caches.match('./index.html'); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (again) {
          return again || new Response('', { status: 504, statusText: 'offline' });
        });
      });
    })
  );
});
