/* sw.js — offline cache for the minyan board. VERSION is stamped by build.js. */
var VERSION = 'minyan-shell-f1659cf23796';
var FONTS = 'minyan-fonts';
var SHELL = ['./index.html', './admin.html', './style.css', './cal.js', './engine.js', './template.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './config.json'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('minyan-shell-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin === location.origin) {
    if (/\/config\.json$/.test(url.pathname)) {
      /* the schedule: network first, cached copy when offline */
      e.respondWith(fetch(e.request).then(function (r) {
        if (r.ok) { var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put('./config.json', copy); }); }
        return r;
      }).catch(function () { return caches.match('./config.json'); }));
      return;
    }
    if (e.request.mode === 'navigate') {
      e.respondWith(caches.match('./index.html').then(function (cached) {
        var net = fetch(e.request).then(function (r) { if (r.ok) caches.open(VERSION).then(function (c) { c.put('./index.html', r.clone()); }); return r; });
        return cached || net.catch(function () { return cached; });
      }));
      return;
    }
    /* app shell: cached copy first, refreshed in the background */
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (cached) {
      var net = fetch(e.request).then(function (r) { if (r.ok) caches.open(VERSION).then(function (c) { c.put(e.request, r.clone()); }); return r; }).catch(function () { return cached; });
      return cached || net;
    }));
    return;
  }
  if (/(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(e.request).then(function (cached) {
        var net = fetch(e.request).then(function (r) { c.put(e.request, r.clone()); return r; }).catch(function () { return cached; });
        return cached || net;
      });
    }));
  }
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cascade Zmanim', { body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: d.tag || 'minyan', dir: 'rtl', lang: 'he', renotify: true }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    if (list.length) return list[0].focus();
    return self.clients.openWindow('./index.html');
  }));
});
