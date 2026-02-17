# RallyLab — Architecture

**Version:** 2.0
**Status:** Specification

---

## 1. Overview

RallyLab is an event-sourced, offline-first race management system. It consists of three layers:

1. **Track Controller** — Microcontroller firmware that reads physical track sensors
2. **Race Controller** — Browser-based application that manages race logic and state
3. **Supabase** — Hosted backend for auth, pre-race registration, and race day sync

There is no custom server code. The entire system is static HTML/JS plus Supabase's managed services.

### Key Characteristics

- **Offline-first:** Race day operates without internet connectivity
- **Event-sourced:** Race day uses an append-only event log; state is always derived
- **Browser-native:** No local server process required
- **Serverless:** No custom backend — Supabase provides auth, database, and API
- **Free-tier friendly:** Runs on Supabase's free plan for small youth groups

---

## 2. Technology Stack

### 2.1 Track Firmware

- **Language:** Python (MicroPython)
- **Platform:** Raspberry Pi Pico
- **Responsibilities:**
  - Read start gate and lane GPIO inputs
  - Timestamp events with microsecond precision
  - Emit structured event messages to Race Controller

### 2.2 Race Controller (Browser Runtime)

- **Language:** Vanilla JavaScript (ES modules, no build step)
- **Platform:** Chrome or Edge (v89+)
- **Responsibilities:**
  - Ingest track event stream via Web Serial API
  - Apply race logic (heat progression, re-runs, manual results)
  - Persist events to IndexedDB (race day)
  - Rebuild state from event log
  - Drive Operator Display and Audience Display
  - Sync events to Supabase (background, when online)

### 2.3 Supabase (Managed Backend)

- **Database:** PostgreSQL (Supabase-managed)
- **Auth:** Supabase Auth (magic link emails, session tokens)
- **API:** Auto-generated REST via PostgREST (no custom endpoints)
- **Security:** Row-Level Security (RLS) policies control all data access
- **Client:** `supabase-js` loaded from CDN (`https://esm.sh/@supabase/supabase-js@2`)

### 2.4 Static Hosting

The frontend is static HTML/CSS/JS served from any static host:
- Supabase hosting (if available)
- GitHub Pages
- Netlify / Vercel (free tier)
- Any CDN

No server-side rendering. No build step.

---

## 3. Race Day Deployment Topology

Both the **Operator Display** and **Audience Display** run as separate browser tabs/windows on the **same laptop**. The Race Controller logic runs in the Operator Display's browser tab.

```
┌──────────────────────────────────────────────────────────┐
│  Operator Laptop (Chrome/Edge)                           │
│                                                          │
│  ┌────────────────┐  BroadcastChannel  ┌──────────────┐ │
│  │ Operator       │──────────────────►│ Audience      │ │
│  │ Display        │                    │ Display       │ │
│  │ (Browser Tab)  │                    │ (Browser Tab) │ │
│  └───────┬────────┘                    └──────────────┘ │
│          │                                               │
│          │ Race Controller (JS runtime)                  │
│          │  ├─ Event Store (IndexedDB)                   │
│          │  ├─ State Manager                             │
│          │  ├─ Track Connection (Web Serial)             │
│          │  ├─ Supabase Sync Worker                      │
│          │  └─ USB Backup Worker                         │
│          │                                               │
└──────────┼───────────────────────────────────────────────┘
           │ USB Serial
           ▼
    ┌─────────────┐
    │ Track        │
    │ Controller   │
    │ (Pico)       │
    └─────────────┘
```

On race day, the laptop operates fully offline. Supabase sync happens in the background when internet is available.

### 3.1 Track Controller Connection

USB serial (v1). WiFi HTTP is a future option (see Phase 4).

---

## 4. Communication Protocols

### 4.1 Track Controller → Race Controller

- **Transport:** USB serial (115200 baud)
- **Protocol:** Text commands with JSON responses
- See `03-track-controller-protocol.md`

### 4.2 Operator Display → Audience Display

- **Transport:** BroadcastChannel API (in-browser, same origin)
- Operator tab posts state updates; Audience tab receives and renders
- Works fully offline

### 4.3 Frontend → Supabase

- **Transport:** HTTPS via `supabase-js` client library
- **Auth:** Supabase Auth (magic links, session management)
- **Data:** PostgREST auto-generated API (insert/query on tables with RLS)
- **Pattern:** Direct client-to-database (no middleware)

---

## 5. Persistence Strategy

### 5.1 Pre-Race (Registration, Rosters)

- **Database:** Supabase PostgreSQL
- **Access:** `supabase-js` client with RLS policies
- **Model:** Event-sourced — same `domain_events` table as race day
- Pre-race events (`EventCreated`, `SectionCreated`, `RosterUpdated`, etc.) are appended directly to Supabase
- State (rosters, car numbers, lock status) is derived client-side by replaying events

See `05-pre-race-data.md` for schema, RLS policies, and client usage.

### 5.2 Race Day (Local, Offline)

- **Database:** IndexedDB in the browser
- **Model:** Event-sourced (append-only log, derived state)
- Roster Package fetched from Supabase before race day
- All race events stored locally
- State derived by replaying events
- Survives browser refresh, tab close, and browser crash

### 5.3 Post-Race (Sync)

- Race day events sync to Supabase when online (background, non-blocking)
- Sync is one-way: browser → Supabase `domain_events` table
- `supabase-js` handles auth and insertion
- Idempotent: duplicates ignored via partial unique index on `client_event_id`

---

## 6. Event Store

### 6.1 IndexedDB Schema (Race Day)

```javascript
// Database: 'rallylab-races'

// Object store: 'events' (append-only event log)
{
  id: 1,                        // auto-increment, local only
  type: 'RaceCompleted',        // PascalCase event type
  payload: { /* event fields */ },
  timestamp: 1708012345678      // Unix ms (UTC)
}

// Object store: 'state' (derived, rebuilt from events)
{
  key: 'current',
  active_section: 'section-uuid',
  current_heat: 16,
  // ... other derived state
}

// Object store: 'settings' (UI preferences, sync cursor)
{
  key: 'sync_cursor',
  value: 47  // last event ID synced to Supabase
}
```

### 6.2 Event Types (Race Day)

All event types use PascalCase. See `04-domain-events.md` for the complete catalog.

Race day event types:
- `RosterLoaded`
- `CarArrived`
- `SectionStarted`
- `HeatStaged`
- `RaceCompleted`
- `RerunDeclared`
- `ResultManuallyEntered`
- `CarRemoved`
- `SectionCompleted`

### 6.3 State Rebuild

State is **always** derived from events, never stored as the source of truth.

```javascript
async function rebuildState() {
  const events = await db.getAll('events');
  const state = events.reduce(applyEvent, initialState);
  await db.put('state', { key: 'current', ...state });
  return state;
}
```

Typical race day: 200-500 events, ~100-250 KB total. Rebuild time: <50ms for 500 events.

### 6.4 Supabase Schema

All events — pre-race and race day — share a single table:

```sql
CREATE TABLE domain_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL,
  section_id UUID,                -- null for EventCreated
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  client_event_id BIGINT,         -- set for race day events (sync dedup)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_race_day_dedup
  ON domain_events(event_id, section_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX idx_domain_events_lookup
  ON domain_events(event_id, section_id);
```

See `05-pre-race-data.md` for RLS policies, triggers, and the `event_roles` access control table.

---

## 7. Supabase Sync

### 7.1 Sync Pattern

A background sync loop runs in the Operator Display tab using `supabase-js`:

```javascript
async function syncOnce(supabase, store, eventId, sectionId) {
  if (!navigator.onLine) return;

  const cursor = await store.getSyncCursor();
  const events = await store.getEventsAfter(cursor);
  if (events.length === 0) return;

  const rows = events.map(e => ({
    event_id: eventId,
    section_id: sectionId,
    client_event_id: e.id,
    event_type: e.type,
    payload: e.payload,
    created_by: userId
  }));

  const { error } = await supabase
    .from('domain_events')
    .upsert(rows, { onConflict: 'event_id,section_id,client_event_id' });

  if (!error) {
    await store.setSyncCursor(events[events.length - 1].id);
  }
}
```

Runs every 5 seconds. Racing is never blocked by sync status.

### 7.2 Restore from Supabase

When the Operator selects an Event (online):

```javascript
async function restoreFromSupabase(supabase, store, eventId, sectionId) {
  const { data: events } = await supabase
    .from('domain_events')
    .select('*')
    .eq('event_id', eventId)
    .eq('section_id', sectionId)
    .not('client_event_id', 'is', null)
    .order('client_event_id');

  for (const event of events) {
    await store.appendEvent({
      id: event.client_event_id,
      type: event.event_type,
      payload: event.payload,
      timestamp: new Date(event.created_at).getTime()
    });
  }

  return await store.rebuildState();
}
```

### 7.3 Roster Package Fetch

On race day, the Operator replays pre-race events from Supabase to derive the roster:

```javascript
async function importRoster(supabase, store, eventId) {
  const { data: events } = await supabase
    .from('domain_events')
    .select('*')
    .eq('event_id', eventId)
    .order('id');

  // Replay events to derive locked rosters
  const state = events.reduce(applyEvent, initialState);

  // Write RosterLoaded events into IndexedDB
  for (const section of Object.values(state.sections)) {
    if (!section.locked) continue;
    await store.appendEvent({
      type: 'RosterLoaded',
      event_id: eventId,
      section_id: section.section_id,
      participants: section.participants,
      timestamp: Date.now()
    });
  }
}
```

If offline, the Operator can import from a previously downloaded JSON file.

---

## 8. USB Backup (Opt-In)

### 8.1 Design

- **Opt-in:** Operator explicitly configures a USB backup directory
- **Background:** Backups every 10 events (non-blocking)
- **File System Access API:** Browser-native USB directory access

### 8.2 Backup File Format

```json
{
  "version": 1,
  "event_id": "uuid",
  "section_id": "uuid",
  "timestamp": 1708012345678,
  "events": [ /* full event log */ ]
}
```

### 8.3 Restore from USB

1. Open app on new laptop (cached as PWA)
2. Click "Restore from USB Backup"
3. Select backup JSON file
4. Events imported to IndexedDB
5. State rebuilt, racing resumes

---

## 9. Disaster Recovery

| Scenario | Impact | Recovery |
|----------|--------|----------|
| Browser refresh | None | Automatic — IndexedDB persists, state rebuilds |
| Browser crash | None | Relaunch browser, state rebuilds from IndexedDB |
| Laptop dies, internet available | 2-3 min downtime | New laptop → select event → restore from Supabase |
| Laptop dies, no internet, USB backup | 2-3 min downtime | New laptop → restore from USB stick |
| Laptop dies, no internet, no USB | Data lost | Re-run heats, or wait for internet to restore |

**Mitigations:** Bring spare laptop. Use phone hotspot. Configure USB backup.

---

## 10. BroadcastChannel Message Contract

The Operator Display pushes display state to the Audience Display via BroadcastChannel. The Audience Display is stateless — it only renders what it receives.

Channel name: `rallylab-race`

### Message Types

```javascript
// Welcome screen
{ type: 'SHOW_WELCOME', event_name: '...' }

// Heat staging
{
  type: 'SHOW_STAGING',
  heat: 16,
  lanes: [
    { lane: 1, car_number: 42, name: 'Billy' },
    { lane: 2, car_number: 17, name: 'Sarah' }
  ]
}

// Race results
{
  type: 'SHOW_RESULTS',
  heat: 16,
  results: [
    { place: 1, lane: 2, car_number: 17, name: 'Sarah', time_ms: 2150 },
    { place: 2, lane: 1, car_number: 42, name: 'Billy', time_ms: 2320 }
  ]
}

// Leaderboard
{
  type: 'SHOW_LEADERBOARD',
  section_name: 'Cubs',
  standings: [
    { rank: 1, car_number: 17, name: 'Sarah', avg_time_ms: 2205 },
    { rank: 2, car_number: 42, name: 'Billy', avg_time_ms: 2340 }
  ]
}

// Section complete
{ type: 'SHOW_SECTION_COMPLETE', section_name: 'Cubs' }
```

---

## 11. Browser Requirements

### 11.1 Required Browser

- **Chrome** (v89+) or **Edge** (Chromium-based, v89+)

### 11.2 Required Web APIs

- **Web Serial API** — Track Controller communication
- **IndexedDB** — Local event store
- **BroadcastChannel API** — Inter-tab communication
- **File System Access API** — USB backup (opt-in)
- **Service Worker / PWA** — Offline app loading

### 11.3 Not Supported

- Safari (lacks Web Serial API)
- Firefox (lacks Web Serial API)
- Mobile browsers (lack Web Serial API)

---

## 12. Architectural Principles

1. **Offline-first** — Race day works with zero internet dependency
2. **Event-sourced (everywhere)** — Append-only log is the source of truth; state is always derived
3. **No custom server** — Supabase provides auth, database, and API; no backend code to maintain
4. **No build step** — Vanilla JS, ES modules, CDN imports
5. **Clean separation** — Track = sensing, Race Controller = logic, UI = presentation
6. **Protocol-driven** — Stable protocol between Track Controller and Race Controller
7. **Fault tolerance via simplicity** — Deterministic state rebuild from events

---

## 13. Explicit Non-Goals (v1)

- No custom backend server (Python, Node, etc.)
- No frontend framework (React, Vue, etc.)
- No WebSocket layer
- No distributed real-time sync on race day
- No concurrent multi-operator editing (multiple operator accounts are for backup, not simultaneous use)
- No remote spectator apps (same-laptop only)

---

## 14. Implementation Phases

### Phase 1: Core Race Controller (Offline-Only)

Run a race day with zero internet dependency.

- IndexedDB event store
- Web Serial API connection to Track Controller
- Event-sourced state management
- Operator Display and Audience Display
- BroadcastChannel inter-tab communication
- Manual interventions (Re-Run, Manual Rank)

### Phase 2: Supabase Integration

Pre-race registration and cloud sync.

- Supabase project setup (tables, RLS, auth)
- Pre-race registration UI (Organizer + Registrar flows)
- Roster Package export/fetch
- Race day sync worker (upload events to Supabase)
- Restore from Supabase on load

### Phase 3: USB Backup (Opt-In)

Disaster recovery without internet.

- File System Access API backup worker
- Configure, manual trigger, and restore flows

### Phase 4: WiFi Track Connection (Future)

Support Track Controller via WiFi HTTP as alternative to USB serial.

---

## 15. Security Considerations

### 15.1 Data Privacy

- No sensitive participant data stored (names only, no health/contact info)
- All Supabase communication over HTTPS
- USB backup files contain only race data

### 15.2 Authentication

- **Supabase Auth** handles all authentication
- Magic link emails for Organizers, Registrars, and Operators
- Session tokens managed by `supabase-js` (stored in localStorage)
- No passwords anywhere in the system

### 15.3 Row-Level Security

All data access is controlled by Supabase RLS policies:
- Organizers can only access their own Events
- Registrars can only access their assigned Section
- Race day sync uses the Organizer's session
- See `05-pre-race-data.md` for complete RLS policies

---

## 16. Performance Characteristics

| Metric | Value |
|--------|-------|
| Typical event log size | 200-500 events, 100-250 KB |
| State rebuild (500 events) | <50ms |
| Supabase sync interval | 5 seconds |
| USB backup write | ~100ms |

---

## 17. Supabase Free Tier Fit

| Resource | Free Tier Limit | RallyLab Usage |
|----------|----------------|----------------|
| Database | 500 MB | <1 MB per event (trivial) |
| Auth users | Unlimited | ~10-20 per event |
| API requests | Unlimited | ~100/day pre-race, ~100/race day |
| Storage | 1 GB | Not used |
| Bandwidth | 5 GB | Negligible |

A small youth group's usage is well within free tier limits.

---

## 18. References

- `01-domain-language.md` — Terminology and roles
- `03-track-controller-protocol.md` — Track Controller protocol
- `04-domain-events.md` — Complete event catalog
- `05-pre-race-data.md` — Supabase tables, RLS policies, client usage
- `06-race-day-state-machine.md` — Race day state transitions
- `10-frontend-architecture.md` — Browser module structure

---

**End of Architecture v2.0**
