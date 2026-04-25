/**
 * sw.js — Service Worker for RallyLab PWA.
 *
 * Cache-first strategy: cached assets are served immediately.
 * Bump CACHE_VERSION to force an update on next visit.
 *
 * Update flow: a freshly installed SW does NOT auto-activate. It waits in the
 * `waiting` state until the page sends a `SKIP_WAITING` message (the in-app
 * "New version available" banner is what triggers it). This avoids surprise
 * reloads mid-race.
 */

const CACHE_VERSION = 'rallylab-v8';

const APP_SHELL = [
  './',
  'registration.html',
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
  'js/sw-update.js',
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
  'js/operator/report.js',
  'js/operator/export-xlsx.js',
  'js/registrar/app.js',
  'js/registrar/screens.js',
  'js/registrar/dialogs.js',
  'js/shared/sync-indicator.js',
  'js/shared/rally-header.js',
  'js/audience/app.js',
  'js/audience/screens.js',
  'manifest.json'
];

// CDN dependencies to cache
const CDN_DEPS = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', event => {
  // Use `cache: 'reload'` so the SW pulls fresh copies past Safari's HTTP
  // cache. Without this, a SW version bump can re-cache whatever stale
  // modules the browser still has on disk, and bug fixes never reach the
  // user — exactly the iOS Safari trap we hit during dev.
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      const requests = [...APP_SHELL, ...CDN_DEPS].map(
        url => new Request(url, { cache: 'reload' })
      );
      return cache.addAll(requests);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and Supabase API calls
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('supabase')) return;
  // Cache API only supports http(s); skip chrome-extension://, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Stale-while-revalidate: serve cached immediately, fetch fresh in background
  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok && response.type !== 'opaque') {
            cache.put(event.request, response.clone()).catch(() => { /* unsupported scheme/partial response */ });
          }
          return response;
        });
        return cached || fetchPromise;
      })
    )
  );
});
