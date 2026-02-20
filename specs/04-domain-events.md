# RallyLab — Domain Events Catalog

**Version:** 2.0
**Status:** Specification

---

## 1. Overview

This document catalogs all domain events in the RallyLab system. Events represent facts that have occurred and are the source of truth for all derived state.

### 1.1 Event Sourcing Principles

- **Events are immutable** — once written, never modified
- **Events are append-only** — new events supersede old ones, but old ones remain
- **State is derived** — all application state is rebuilt by replaying events
- **Events are facts** — they describe what happened, not what should happen

### 1.2 Event Naming

All event types use **PascalCase** (e.g., `RaceCompleted`, `HeatStaged`).

### 1.3 Event Scope

All events are stored in a single `domain_events` table in Supabase (PostgreSQL). Events are partitioned into two runtime contexts:

- **Pre-race events** — written directly to Supabase via `supabase-js`
- **Race day events** — written to IndexedDB first (offline-first), synced to Supabase when online

Both contexts share the same event-sourcing model: append-only, immutable, state derived by replay. See `05-pre-race-data.md` for Supabase schema and RLS policies.

---

## 2. Pre-Race Events (Supabase)

These events occur during registration and setup before race day. They are written directly to the `domain_events` table in Supabase via `supabase-js`. State is derived client-side by replaying events.

### 2.1 RallyCreated

The Organizer creates a new Rally.

```json
{
  "type": "RallyCreated",
  "rally_id": "uuid",
  "rally_name": "Kub Kars Rally 2026",
  "rally_date": "2026-03-15",
  "created_by": "organizer@example.com",
  "timestamp": 1708012345678
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"RallyCreated"` |
| `rally_id` | UUID | yes | Unique identifier for the Rally |
| `rally_name` | string | yes | Display name |
| `rally_date` | ISO 8601 date | yes | Scheduled date |
| `created_by` | string | yes | Organizer email |
| `timestamp` | integer | yes | Unix ms (UTC) |

---

### 2.2 SectionCreated

The Organizer creates a Section within a Rally.

```json
{
  "type": "SectionCreated",
  "rally_id": "uuid",
  "section_id": "uuid",
  "section_name": "Cubs",
  "created_by": "organizer@example.com",
  "timestamp": 1708012346789
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"SectionCreated"` |
| `rally_id` | UUID | yes | Parent Rally |
| `section_id` | UUID | yes | Unique identifier for the Section |
| `section_name` | string | yes | Display name (e.g., "Cubs", "Scouts") |
| `created_by` | string | yes | Organizer email |
| `timestamp` | integer | yes | Unix ms (UTC) |

---

### 2.3 RegistrarInvited

The Organizer invites a Registrar (Section Contact) to manage a Section's roster.

```json
{
  "type": "RegistrarInvited",
  "rally_id": "uuid",
  "section_id": "uuid",
  "registrar_email": "cubmaster@example.com",
  "invited_by": "organizer@example.com",
  "timestamp": 1708012347890
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"RegistrarInvited"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `registrar_email` | string | yes | Email of the Registrar |
| `invited_by` | string | yes | Organizer email |
| `timestamp` | integer | yes | Unix ms (UTC) |

Multiple `RegistrarInvited` events for the same Section replace previous invitations. The latest invitation is the active Registrar.

---

### 2.4 OperatorInvited

The Organizer invites an additional Operator to help run the Rally on race day.

```json
{
  "type": "OperatorInvited",
  "rally_id": "uuid",
  "operator_email": "backup-operator@example.com",
  "invited_by": "organizer@example.com",
  "timestamp": 1708012347890
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"OperatorInvited"` |
| `rally_id` | UUID | yes | |
| `operator_email` | string | yes | Email of the invited Operator |
| `invited_by` | string | yes | Organizer email |
| `timestamp` | integer | yes | Unix ms (UTC) |

Operators have access to the entire Rally (all Sections). No `section_id` — unlike Registrars who are scoped to a single Section.

Multiple Operators can be invited. The Organizer is implicitly an Operator and does not need an explicit invitation.

---

### 2.5 RosterUpdated

A Registrar uploads a participant list via spreadsheet import.

```json
{
  "type": "RosterUpdated",
  "rally_id": "uuid",
  "section_id": "uuid",
  "participants": [
    { "participant_id": "uuid", "name": "Billy Thompson" },
    { "participant_id": "uuid", "name": "Sarah Chen" }
  ],
  "submitted_by": "cubmaster@example.com",
  "timestamp": 1708012348901
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"RosterUpdated"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `participants` | array | yes | List of `{ participant_id, name }` |
| `submitted_by` | string | yes | Registrar email |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- **Destructive** — replaces entire roster for this Section
- Car numbers are regenerated sequentially (1, 2, 3, ...) based on array order
- Multiple `RosterUpdated` events for the same Section: latest wins

**Warning:** If participants have already painted car numbers, uploading a new spreadsheet renumbers all cars. Use `ParticipantAdded` / `ParticipantRemoved` for surgical edits.

---

### 2.6 ParticipantAdded

A Registrar adds a single participant without renumbering existing cars.

```json
{
  "type": "ParticipantAdded",
  "rally_id": "uuid",
  "section_id": "uuid",
  "participant": { "participant_id": "uuid", "name": "Tommy Rodriguez" },
  "car_number": 15,
  "added_by": "cubmaster@example.com",
  "timestamp": 1708012349012
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"ParticipantAdded"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `participant` | object | yes | `{ participant_id, name }` |
| `car_number` | integer | yes | Next available car number (server-assigned) |
| `added_by` | string | yes | Registrar email |
| `timestamp` | integer | yes | Unix ms (UTC) |

---

### 2.7 ParticipantRemoved

A Registrar removes a single participant.

```json
{
  "type": "ParticipantRemoved",
  "rally_id": "uuid",
  "section_id": "uuid",
  "participant_id": "uuid",
  "car_number": 7,
  "removed_by": "cubmaster@example.com",
  "timestamp": 1708012350123
}
```

Car number is retired (not immediately reused). `ParticipantAdded` fills gaps but numbers don't shift.

---

## 3. Race Day Events (Race Controller)

These events occur during race day and are stored in IndexedDB, with background sync to Supabase's `domain_events` table.

### 3.1 RosterLoaded

The Operator imports a roster into the Race Controller.

```json
{
  "type": "RosterLoaded",
  "rally_id": "uuid",
  "section_id": "uuid",
  "participants": [
    { "participant_id": "uuid", "name": "Billy Thompson", "car_number": 1 },
    { "participant_id": "uuid", "name": "Sarah Chen", "car_number": 2 }
  ],
  "timestamp": 1708098765432
}
```

This is a snapshot of the roster. Only loaded rosters can be raced.

---

### 3.2 CarArrived

A participant checks in on race day, confirming their car is present.

```json
{
  "type": "CarArrived",
  "rally_id": "uuid",
  "section_id": "uuid",
  "car_number": 7,
  "timestamp": 1708098766543
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"CarArrived"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `car_number` | integer | yes | Car being checked in |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Only cars with `CarArrived` events are included in heat scheduling
- No-shows are automatically excluded
- Late arrivals can check in; schedule regenerates for remaining heats

**Clarification:** This operates on the loaded roster. It does not add new participants or edit names/car numbers. `CarArrived` and `CarRemoved` only affect which cars from the roster participate in racing.

---

### 3.3 SectionStarted

The Operator begins racing a Section.

```json
{
  "type": "SectionStarted",
  "rally_id": "uuid",
  "section_id": "uuid",
  "available_lanes": [1, 2, 3, 4, 5, 6],
  "timestamp": 1708098767654
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"SectionStarted"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `available_lanes` | array of int | no | Lanes to use for this Section. Defaults to all lanes reported by Track Controller `info`. Example: `[1, 3, 5]` for Scout Trucks (alternate lanes due to car width). |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Heat schedule is generated using arrived cars and `available_lanes`
- Audience Display switches from Welcome to Heat 1 Staging
- See `06-race-day-state-machine.md` for state transition details
- See `11-track-hardware.md` §8 for physical lane constraints (e.g., Scout Trucks)

---

### 3.4 HeatStaged

The Race Controller stages the next heat, assigning participants to lanes.

```json
{
  "type": "HeatStaged",
  "rally_id": "uuid",
  "section_id": "uuid",
  "heat": 1,
  "lanes": [
    { "lane": 1, "car_number": 3, "name": "Tommy" },
    { "lane": 2, "car_number": 7, "name": "Alice" },
    { "lane": 3, "car_number": 1, "name": "Billy" },
    { "lane": 4, "car_number": 5, "name": "Emma" },
    { "lane": 5, "car_number": 2, "name": "Sarah" },
    { "lane": 6, "car_number": 8, "name": "Jake" }
  ],
  "timestamp": 1708098768000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"HeatStaged"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `heat` | integer | yes | Heat number |
| `lanes` | array | yes | Lane assignments: `{ lane, car_number, name }` |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Audience Display shows staging screen with lane assignments
- Track Operator uses this to load cars onto lanes
- Emitted when a Section starts (heat 1) and after each heat completes (next heat)

---

### 3.5 RaceCompleted

The Track Controller reports that a race has finished.

```json
{
  "type": "RaceCompleted",
  "rally_id": "uuid",
  "section_id": "uuid",
  "heat": 16,
  "race_id": "uuid",
  "times_ms": {
    "1": 2150,
    "2": 2320,
    "3": 2401,
    "4": 3010,
    "5": 2875,
    "6": 2601
  },
  "timestamp": 1708098768765
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"RaceCompleted"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `heat` | integer | yes | Heat number |
| `race_id` | UUID | yes | Unique ID from Track Controller |
| `times_ms` | object | yes | Lane → finish time (ms since start). Absent lanes are unused. |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Audience Display shows results screen
- Result is accepted unless superseded by a later `RaceCompleted` for the same heat (after a `RerunDeclared`)

**Supersession logic:** If multiple `RaceCompleted` events exist for the same heat, the latest (by timestamp) is the accepted result. Earlier results are marked superseded. A re-run that completes is simply another `RaceCompleted` for the same heat — no separate event type needed.

---

### 3.6 RerunDeclared

The Operator declares that the current heat must be re-run.

```json
{
  "type": "RerunDeclared",
  "rally_id": "uuid",
  "section_id": "uuid",
  "heat": 16,
  "reason": "car fell off track",
  "timestamp": 1708098769000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"RerunDeclared"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `heat` | integer | yes | Heat number to re-run |
| `reason` | string | optional | Human-readable reason |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Audience Display returns to staging for this heat
- The next `RaceCompleted` for this heat supersedes the previous result
- This is an operator intent event; the actual result comes from the next `RaceCompleted`

---

### 3.7 ResultManuallyEntered

The Operator manually ranked a heat without times (fallback when track hardware fails).

```json
{
  "type": "ResultManuallyEntered",
  "rally_id": "uuid",
  "section_id": "uuid",
  "heat": 16,
  "rankings": [
    { "place": 1, "lane": 3, "car_number": 7 },
    { "place": 2, "lane": 6, "car_number": 12 },
    { "place": 3, "lane": 1, "car_number": 4 },
    { "place": 4, "lane": 5, "car_number": 9 },
    { "place": 5, "lane": 2, "car_number": 15 },
    { "place": 6, "lane": 4, "car_number": 3 }
  ],
  "timestamp": 1708098770987
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"ResultManuallyEntered"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `heat` | integer | yes | |
| `rankings` | array | yes | Ordered finish: `{ place, lane, car_number }` |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- No times are recorded
- Audience Display shows results with ranks only (no times)
- Scoring uses rank-based fallback (see `08-scoring-and-leaderboard.md`)

**Supersession:** Operator can still re-run after manual entry. A subsequent `RaceCompleted` for this heat supersedes the manual result.

---

### 3.8 CarRemoved

A car is removed from the Rally mid-race (destroyed or disqualified).

```json
{
  "type": "CarRemoved",
  "rally_id": "uuid",
  "section_id": "uuid",
  "car_number": 7,
  "heat": 12,
  "reason": "destroyed",
  "timestamp": 1708098771098
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"CarRemoved"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `car_number` | integer | yes | |
| `heat` | integer | yes | Heat number when removed |
| `reason` | enum | yes | `"destroyed"` or `"disqualified"` |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Car is excluded from all future heats
- Heat schedule regenerates for remaining heats
- Partial results remain in leaderboard, marked incomplete (see `08-scoring-and-leaderboard.md`)

**Note:** Early departures due to family emergencies are NOT removed. The Track Operator runs those cars on behalf of the family.

---

### 3.9 ResultCorrected

The Operator corrects the lane-to-car mapping for a completed heat. Times are physically correct (the timer records by lane), but were attributed to the wrong cars because cars were placed in the wrong lanes.

```json
{
  "type": "ResultCorrected",
  "rally_id": "uuid",
  "section_id": "uuid",
  "heat_number": 5,
  "corrected_lanes": [
    { "lane": 1, "car_number": 7, "name": "Alice" },
    { "lane": 2, "car_number": 3, "name": "Tommy" }
  ],
  "reason": "Cars 7 and 3 were swapped",
  "timestamp": 1708098769000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"ResultCorrected"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `heat_number` | integer | yes | Heat whose lane assignments are corrected |
| `corrected_lanes` | array | yes | Updated lane assignments: `{ lane, car_number, name }` |
| `reason` | string | optional | Human-readable reason for the correction |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Replaces the `lanes` array on the matching `HeatStaged` heat entry
- Does NOT modify times — `RaceCompleted.times_ms` remains unchanged
- Leaderboard recomputes automatically since scoring reads from corrected `heats[].lanes`
- Multiple corrections to the same heat are allowed; each replaces the previous lanes

---

### 3.10 LanesChanged

The Operator changes which lanes are available mid-section (e.g., a lane sensor fails).

```json
{
  "type": "LanesChanged",
  "rally_id": "uuid",
  "section_id": "uuid",
  "available_lanes": [1, 3, 4, 5, 6],
  "reason": "Lane 2 sensor failure",
  "timestamp": 1708098769500
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"LanesChanged"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `available_lanes` | array of int | yes | New set of available lanes (replaces previous set) |
| `reason` | string | optional | Human-readable reason |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Replaces the current `available_lanes` for the active Section
- Heat schedule regenerates for remaining heats using the new lane set
- Completed heats are not affected
- Track Controller receives the new lane set on the next `wait_race` call
- Follows the same pattern as `CarRemoved`: modify inputs, regenerate schedule

**Derived state:** Current available lanes = `SectionStarted.available_lanes`, then apply each `LanesChanged` in timestamp order. The last value wins.

---

### 3.11 SectionCompleted

All heats for a Section have been run.

```json
{
  "type": "SectionCompleted",
  "rally_id": "uuid",
  "section_id": "uuid",
  "total_heats": 24,
  "timestamp": 1708098780000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"SectionCompleted"` |
| `rally_id` | UUID | yes | |
| `section_id` | UUID | yes | |
| `total_heats` | integer | yes | Total heats run |
| `timestamp` | integer | yes | Unix ms (UTC) |

**Behavior:**
- Audience Display shows final leaderboard / section complete screen
- Operator can start next Section or end Rally
- See `06-race-day-state-machine.md` for state transition

---

## 4. Event Ordering and Consistency

### 4.1 Event Constraints

Certain events can only occur after others:

**Pre-race:**
- `SectionCreated` requires `RallyCreated`
- `RegistrarInvited` requires `SectionCreated`
- `OperatorInvited` requires `RallyCreated`
- `RosterUpdated`, `ParticipantAdded`, `ParticipantRemoved` require `RegistrarInvited`

**Race day:**
- `SectionStarted` requires `RosterLoaded`
- `HeatStaged` requires `SectionStarted`
- `RaceCompleted`, `RerunDeclared`, `ResultManuallyEntered` require `HeatStaged`
- `ResultCorrected` requires `HeatStaged` for the referenced heat
- `LanesChanged` requires `SectionStarted` (Section must be active)
- `SectionCompleted` requires all heats to have accepted results

### 4.2 Timestamp Semantics

- All timestamps are Unix milliseconds (UTC)
- Timestamps reflect when the event was recorded, not when it occurred physically
- Events are ordered by timestamp within their scope (rally_id, section_id)

### 4.3 Idempotency

Events with the same payload written multiple times should be deduplicated:

- Pre-race: Use `(rally_id, section_id, event_type, timestamp)` as deduplication key
- Race day: Use `(rally_id, section_id, client_event_id)` as deduplication key

---

## 5. Derived State

The following state is **never stored in events** and is always computed by replaying the event log:

### 5.1 Car Numbers

- Derived from roster events
- `RosterUpdated` → sequential assignment (1, 2, 3, ...)
- `ParticipantAdded` → next available number (fills gaps)
- `ParticipantRemoved` → number retired

### 5.2 Heat Schedule

- Derived from arrived cars + results (for speed matching)
- Regenerated on demand
- See `07-heat-scheduling.md` for algorithm

### 5.3 Leaderboard

- Derived from accepted race results
- Average time across accepted heats
- Superseded results are excluded
- See `08-scoring-and-leaderboard.md` for scoring algorithm

### 5.4 Current Heat Number

- Derived from count of completed heats + 1
- Not stored as an event

### 5.5 Accepted Results

- Derived by finding latest result for each heat
- Multiple results for same heat → latest by timestamp wins
- Earlier results marked `superseded: true`

---

## 6. Event Storage

### 6.1 Supabase (PostgreSQL)

All events — pre-race and race day — live in a single table:

```sql
CREATE TABLE domain_events (
  id BIGSERIAL PRIMARY KEY,
  rally_id UUID NOT NULL,
  section_id UUID,                -- null for RallyCreated
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  client_event_id BIGINT,         -- set for race day events (sync dedup)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup index for race day sync (client_event_id is null for pre-race)
CREATE UNIQUE INDEX idx_race_day_dedup
  ON domain_events(rally_id, section_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX idx_domain_events_lookup
  ON domain_events(rally_id, section_id);
```

See `05-pre-race-data.md` for RLS policies and access control.

### 6.2 Race Controller (IndexedDB)

```javascript
// Object store: 'events'
{
  id: 1,                    // auto-increment
  type: 'RaceCompleted',    // PascalCase
  payload: { /* event fields */ },
  timestamp: 1708098768765
}
```

---

## 7. Event Catalog Summary

| Event Type | Scope | Trigger |
|------------|-------|---------|
| `RallyCreated` | Pre-race | Organizer creates Rally |
| `SectionCreated` | Pre-race | Organizer creates Section |
| `RegistrarInvited` | Pre-race | Organizer invites Registrar |
| `OperatorInvited` | Pre-race | Organizer invites Operator |
| `RosterUpdated` | Pre-race | Registrar uploads spreadsheet |
| `ParticipantAdded` | Pre-race | Registrar adds one participant |
| `ParticipantRemoved` | Pre-race | Registrar removes one participant |
| `RosterLoaded` | Race day | Operator imports roster |
| `CarArrived` | Race day | Operator checks in car |
| `SectionStarted` | Race day | Operator starts racing |
| `HeatStaged` | Race day | System stages next heat |
| `RaceCompleted` | Race day | Track Controller reports finish |
| `RerunDeclared` | Race day | Operator declares re-run |
| `ResultManuallyEntered` | Race day | Operator manually ranks heat |
| `CarRemoved` | Race day | Car destroyed or disqualified |
| `ResultCorrected` | Race day | Operator fixes lane-to-car mapping |
| `LanesChanged` | Race day | Operator changes available lanes mid-section |
| `SectionCompleted` | Race day | All heats completed |

**Total: 18 domain events** (7 pre-race, 11 race day)

---

**End of Domain Events Catalog v2.0**
