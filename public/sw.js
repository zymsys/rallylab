/**
 * sw.js — Service Worker for RallyLab PWA.
 *
 * Cache-first strategy: cached assets are served immediately.
 * Bump CACHE_VERSION to force an update on next visit.
 */

const CACHE_VERSION = 'rallylab-v1';

const APP_SHELL = [
  './',
  'index.html',
  'operator.html',
  'registrar.html',
  'audience.html',
  'css/styles.css',
  'js/config.js',
  'js/supabase.js',
  'js/event-store.js',
  'js/state-manager.js',
  'js/track-connection.js',
  'js/sync-worker.js',
  'js/broadcast.js',
  'js/scheduler.js',
  'js/scoring.js',
  'js/pre-race/app.js',
  'js/pre-race/screens.js',
  'js/pre-race/dialogs.js',
  'js/pre-race/commands.js',
  'js/pre-race/roster-import.js',
  'js/pre-race/demo-data.js',
  'js/operator/app.js',
  'js/operator/screens.js',
  'js/operator/dialogs.js',
  'js/operator/demo-data.js',
  'js/registrar/app.js',
  'js/registrar/screens.js',
  'js/registrar/dialogs.js',
  'js/audience/app.js',
  'js/audience/screens.js',
  'manifest.json'
];

// CDN dependencies to cache
const CDN_DEPS = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      cache.addAll([...APP_SHELL, ...CDN_DEPS])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and Supabase API calls
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('supabase')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses for app shell and CDN deps
        if (response.ok && (url.origin === self.location.origin || CDN_DEPS.some(dep => event.request.url.startsWith(dep)))) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
