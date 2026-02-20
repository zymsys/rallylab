# RallyLab — Frontend Architecture

**Version:** 1.1
**Status:** Specification

---

## 1. Overview

The RallyLab frontend is a vanilla JavaScript browser application with no build step and no framework. It consists of three HTML entry points sharing a common set of JavaScript modules: a main app (`index.html`) for login and pre-race registration, a race day Operator Display (`operator.html`), and a race day Audience Display (`audience.html`).

### 1.1 Design Principles

- **No framework:** Vanilla JS, direct DOM manipulation
- **No build step:** No bundler, no transpiler, no package.json. One CDN dependency (`supabase-js`)
- **ES modules:** Native `import`/`export` via `<script type="module">`
- **Offline-first:** PWA with service worker for offline access
- **Event-driven:** UI updates flow from event store projections

---

## 2. File Structure

```
public/
├── index.html              # Main app (login, pre-race registration, navigation)
├── operator.html           # Race Day Operator Display
├── audience.html           # Race Day Audience Display
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
├── css/
│   └── styles.css          # Single stylesheet
├── js/
│   ├── supabase.js         # Supabase client init + auth helpers
│   ├── event-store.js      # IndexedDB event log (append, query, rebuild)
│   ├── state-manager.js    # Event reducer, state projections
│   ├── track-connection.js # Web Serial API communication
│   ├── sync-worker.js      # Supabase sync (upload/download events)
│   ├── broadcast.js        # BroadcastChannel send/receive
│   ├── scheduler.js        # Heat scheduling algorithm
│   ├── scoring.js          # Scoring and leaderboard computation
│   ├── pre-race/
│   │   ├── app.js          # Main app entry point (login, routing)
│   │   ├── screens.js      # Pre-race screen rendering
│   │   ├── dialogs.js      # Pre-race dialogs
│   │   ├── commands.js     # Event append, state loading, roster export
│   │   └── roster-import.js # CSV/XLSX import
│   ├── operator/
│   │   ├── app.js          # Operator Display entry point
│   │   ├── screens.js      # Race day screen rendering
│   │   └── modals.js       # Manual Rank modal, Remove Car confirmation
│   └── audience/
│       ├── app.js          # Audience Display entry point
│       └── screens.js      # Audience screen rendering
└── assets/
    ├── icon-192.png        # PWA icon
    └── icon-512.png        # PWA icon
```

---

## 3. Module Responsibilities

### 3.1 supabase.js

Initializes the Supabase client and provides auth helpers.

**Exports:**
- `supabase` — The initialized Supabase client instance
- `signIn(email)` — Send magic link email
- `getUser()` — Get current authenticated user
- `signOut()` — Sign out

```javascript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
);
```

The anon key is safe to expose in client code — RLS policies control all data access.

See `05-pre-race-data.md` for Supabase tables, RLS policies, and client usage patterns.

### 3.3 event-store.js

The IndexedDB wrapper. Owns the `rallylab-races` database.

**Exports:**
- `openStore()` — Initialize/open the database
- `appendEvent(event)` — Append an event to the log
- `getAllEvents()` — Read all events (for state rebuild)
- `getEventsAfter(cursor)` — Read events after sync cursor
- `getSyncCursor()` / `setSyncCursor(id)` — Track sync position
- `clear()` — Clear all stores (for USB restore)

**Does not** interpret events — that's the state manager's job.

### 3.4 state-manager.js

The event reducer. Replays events to derive current state.

**Exports:**
- `rebuildState(events)` — Reduce event list into current state
- `applyEvent(state, event)` — Apply a single event to state
- `getAcceptedResults(state)` — Get accepted result per heat

**State shape:**
```javascript
{
  rally_id: "uuid",
  rally_name: "Kub Kars Rally 2026",
  sections: {
    "section-uuid": {
      section_id: "uuid",
      section_name: "Cubs",
      participants: [...],
      arrived: new Set([1, 2, 3, ...]),  // car numbers checked in
      removed: new Set([7]),              // car numbers removed
      started: false,
      completed: false,
      current_heat: 1,
      results: { /* heat -> accepted result */ }
    }
  },
  active_section_id: null
}
```

### 3.5 track-connection.js

Web Serial API wrapper for Track Controller communication.

**Exports:**
- `connect()` — Request serial port, open connection
- `getInfo()` — Send `info` command, return capabilities
- `waitForRace(lastRaceId, lanes)` — Long-poll for race completion
- `waitForGate()` — Long-poll for gate reset
- `checkGate()` — Non-blocking gate status check
- `disconnect()` — Close serial connection

See `03-track-controller-protocol.md` for the protocol.

### 3.6 sync-worker.js

Background sync to Supabase via `supabase-js`.

**Exports:**
- `startSync(supabase, store, rallyId, sectionId)` — Begin periodic sync
- `stopSync()` — Stop periodic sync
- `syncOnce()` — Manual sync trigger
- `restoreFromSupabase(supabase, store, rallyId, sectionId)` — Download events for disaster recovery

Uses `supabase.from('domain_events').upsert(...)` for idempotent upload. Runs on a 5-second interval. Non-blocking — sync failures are logged but don't affect racing.

See `02-architecture.md` Section 7 for the sync pattern.

### 3.7 broadcast.js

BroadcastChannel wrapper for inter-tab communication.

**Exports (Operator side):**
- `sendWelcome(rallyName)` — Push welcome screen
- `sendStaging(heat, lanes)` — Push staging info
- `sendResults(heat, results)` — Push race results
- `sendLeaderboard(sectionName, standings)` — Push leaderboard
- `sendSectionComplete(sectionName)` — Push section complete

**Exports (Audience side):**
- `onMessage(callback)` — Listen for display updates

Channel name: `rallylab-race`

See `02-architecture.md` for the message contract.

### 3.8 scheduler.js

Heat scheduling algorithm.

**Exports:**
- `generateSchedule(participants, laneCount, results)` — Generate heat list
- `regenerateAfterRemoval(schedule, removedCar, currentHeat)` — Handle car removal

See `07-heat-scheduling.md` for the algorithm.

### 3.9 scoring.js

Scoring and leaderboard computation.

**Exports:**
- `computeLeaderboard(participants, acceptedResults, heatSchedule)` — Full ranked standings
- `sectionAverageTime(acceptedResults)` — Average time for synthetic ranking

See `08-scoring-and-leaderboard.md` for the algorithm.

---

## 4. HTML Entry Points

### 4.1 index.html (Main App)

The unified entry point for login, pre-race registration, and navigation to race day. All users (Organizers, Registrars, Operators) sign in here. The UI adapts based on the user's role(s):

- **Registrars** see only their assigned Section(s) for roster management
- **Organizers and Operators** see the full rally management UI, plus a "Race Day" link on the Rally Home screen that opens `operator.html`
- **Users with multiple roles** see the union of their capabilities

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RallyLab</title>
  <link rel="stylesheet" href="css/styles.css">
  <link rel="manifest" href="manifest.json">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="js/pre-race/app.js"></script>
</body>
</html>
```

### 4.2 operator.html (Race Day Operator Display)

The race day operator interface. This page does **not** require authentication to function — once the roster is loaded into IndexedDB, racing works fully offline. If the user has a Supabase session (from signing in on `index.html`), the sync worker uses it to upload events when online.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RallyLab — Operator</title>
  <link rel="stylesheet" href="css/styles.css">
  <link rel="manifest" href="manifest.json">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="js/operator/app.js"></script>
</body>
</html>
```

### 4.3 audience.html (Audience Display)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RallyLab — Audience</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body class="audience">
  <div id="display"></div>
  <script type="module" src="js/audience/app.js"></script>
</body>
</html>
```

---

## 5. UI Rendering Pattern

No virtual DOM. Direct DOM manipulation using a simple pattern:

```javascript
// Screen rendering function
function renderStaging(container, heat, lanes) {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = `Heat ${heat}`;
  container.appendChild(heading);

  const table = document.createElement('table');
  for (const { lane, car_number, name } of lanes) {
    const row = table.insertRow();
    row.insertCell().textContent = lane;
    row.insertCell().textContent = car_number;
    row.insertCell().textContent = name;
  }
  container.appendChild(table);
}
```

**Convention:** Each screen has a `render*` function that takes a container element and data. It clears and rebuilds the container. This is simple and sufficient for the update frequency (a few times per minute at most).

---

## 6. Event Flow: Event Store → UI

```
Track Controller → RaceCompleted event
       │
       ▼
event-store.js (appendEvent)
       │
       ▼
state-manager.js (applyEvent → new state)
       │
       ├──► operator/screens.js (render Results on Operator Display)
       │
       └──► broadcast.js (sendResults → BroadcastChannel)
                    │
                    ▼
            audience/app.js (onMessage → render Results on Audience Display)
```

The Operator Display owns the event store and state manager. The Audience Display receives rendered data via BroadcastChannel and has no access to IndexedDB or the Track Controller.

---

## 7. PWA Setup

### 7.1 Service Worker (sw.js)

Caches all static assets for offline use. Uses a **cache-first** strategy: cached assets are served immediately, with updates applied on the next visit.

```javascript
const CACHE_NAME = 'rallylab-v1';  // Bump version to force update
const ASSETS = [
  '/',
  '/index.html',
  '/operator.html',
  '/audience.html',
  '/css/styles.css',
  '/js/supabase.js',
  '/js/event-store.js',
  '/js/state-manager.js',
  '/js/track-connection.js',
  '/js/sync-worker.js',
  '/js/broadcast.js',
  '/js/scheduler.js',
  '/js/scoring.js',
  '/js/pre-race/app.js',
  '/js/pre-race/screens.js',
  '/js/pre-race/dialogs.js',
  '/js/pre-race/commands.js',
  '/js/pre-race/roster-import.js',
  '/js/operator/app.js',
  '/js/operator/screens.js',
  '/js/operator/modals.js',
  '/js/audience/app.js',
  '/js/audience/screens.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();  // Activate new SW immediately
});

self.addEventListener('activate', event => {
  // Delete old caches when a new version is deployed
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();  // Take control of open tabs
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
```

#### Update Strategy

When `CACHE_NAME` is bumped (e.g., `rallylab-v2`), the browser detects the changed `sw.js` and installs the new service worker. With `skipWaiting()` and `clients.claim()`, the new version takes effect immediately.

To avoid disrupting an active race, the app should detect updates and handle them gracefully:

```javascript
// In operator/app.js — detect SW updates
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          // Show "Update applied" banner — no reload needed for cache-first.
          // Next navigation or manual reload will load the new assets.
          showUpdateBanner();
        }
      });
    });
  });
}
```

**Race day safety:** The new SW caches new assets and deletes the old cache, but already-loaded pages continue running their current JS. The update takes full effect on the next page load. During an active race, no reload occurs — the Operator sees a subtle notification and can reload between Sections when convenient.

### 7.2 manifest.json

```json
{
  "name": "RallyLab Race Controller",
  "short_name": "RallyLab",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a1a2e",
  "icons": [
    { "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 8. CSS Approach

Single stylesheet (`css/styles.css`) using CSS custom properties for theming:

```css
:root {
  --color-bg: #ffffff;
  --color-text: #1a1a2e;
  --color-accent: #e94560;
  --color-success: #0f9b58;
  --color-surface: #f5f5f5;
  --font-main: system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', 'Cascadia Code', monospace;
}

/* Audience Display: large type, high contrast for projector */
.audience {
  --color-bg: #0a0a1a;
  --color-text: #ffffff;
  font-size: 2rem;
}
```

Key CSS considerations:
- **Audience Display:** Large font sizes, high contrast for projector visibility
- **Operator Display:** Standard sizing, functional layout
- **No CSS preprocessor.** Plain CSS with custom properties.

---

## 9. References

- `02-architecture.md` — System architecture, BroadcastChannel message contract, Supabase sync
- `03-track-controller-protocol.md` — Track Controller serial protocol
- `04-domain-events.md` — Event types and schemas
- `05-pre-race-data.md` — Supabase tables, RLS policies, client usage
- `06-race-day-state-machine.md` — State transitions
- `07-heat-scheduling.md` — Scheduling algorithm
- `08-scoring-and-leaderboard.md` — Scoring algorithm
- `09-operator-ui-ux.md` — UI/UX specification

---

**End of Frontend Architecture v1.1**
