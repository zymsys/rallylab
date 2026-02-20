# RallyLab — Pre-Race Data (Supabase)

**Version:** 2.0
**Status:** Specification

---

## 1. Overview

The entire system — pre-race and race day — is event-sourced. All events live in a single `domain_events` table in Supabase. There is no custom server code. The browser talks directly to Supabase using `supabase-js`, with Row-Level Security (RLS) policies controlling all access.

### 1.1 Data Flow

```
Organizer signs up → Supabase Auth (magic link)
         │
         ▼
Appends RallyCreated, SectionCreated events → domain_events table
         │
         ├──► Invites Registrar(s) → RegistrarInvited event + magic link email
         │            │
         │            ▼
         │    Registrar signs in → appends RosterUpdated / ParticipantAdded events
         │
         ├──► Invites Operator(s) → OperatorInvited event + magic link email
         │
         ▼
Organizer appends SectionLocked event
         │
         ▼
Race day: replay events to derive roster (or import from JSON file)
```

### 1.2 Authentication

All auth is handled by **Supabase Auth**:

- **Magic link** (passwordless email) for both Organizers and Registrars
- `supabase-js` manages session tokens automatically
- No passwords anywhere

```javascript
// Request magic link
await supabase.auth.signInWithOtp({ email: 'user@example.com' });

// After clicking link, session is established automatically
const { data: { user } } = await supabase.auth.getUser();
```

---

## 2. Database Schema

### 2.1 Domain Events Table

All events — pre-race and race day — share a single append-only table:

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

-- Dedup index for race day sync (only applies when client_event_id is set)
CREATE UNIQUE INDEX idx_race_day_dedup
  ON domain_events(rally_id, section_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Lookup index for replaying events
CREATE INDEX idx_domain_events_lookup
  ON domain_events(rally_id, section_id);
```

### 2.2 Rally Roles Table (RLS Anchor)

A small derived table that tracks who has access to which Rally. Populated by database triggers when relevant events are inserted.

```sql
CREATE TABLE rally_roles (
  rally_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('organizer', 'operator', 'registrar', 'checkin_volunteer')),
  section_id UUID,                -- null for organizer/operator, set for registrar/checkin_volunteer
  PRIMARY KEY (rally_id, user_id)
);
```

This table is **not a source of truth** — it is a denormalized index derived from `RallyCreated` and invitation events.

---

## 3. Row-Level Security Policies

### 3.1 Domain Events

```sql
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;

-- Users can read events for Rallies they have a role in
CREATE POLICY "Read own events"
  ON domain_events FOR SELECT
  USING (
    rally_id IN (SELECT rally_id FROM rally_roles WHERE user_id = auth.uid())
  );

-- Users can append events for Rallies they have a role in
CREATE POLICY "Append own events"
  ON domain_events FOR INSERT
  WITH CHECK (
    -- RallyCreated is special: no role exists yet, allow any authenticated user
    (event_type = 'RallyCreated' AND auth.uid() IS NOT NULL)
    OR
    -- All other events: user must have a role for this rally_id
    (rally_id IN (SELECT rally_id FROM rally_roles WHERE user_id = auth.uid()))
  );
```

### 3.2 Rally Roles

```sql
ALTER TABLE rally_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own roles (needed for the domain_events policy)
CREATE POLICY "Read own roles"
  ON rally_roles FOR SELECT
  USING (user_id = auth.uid());
```

The `rally_roles` table is only written to by database triggers (SECURITY DEFINER), never directly by clients.

---

## 4. Database Triggers

### 4.1 Grant Organizer Role on RallyCreated

```sql
CREATE OR REPLACE FUNCTION on_rally_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'RallyCreated' THEN
    INSERT INTO rally_roles (rally_id, user_id, role)
    VALUES (NEW.rally_id, NEW.created_by, 'organizer')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_rally_created
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'RallyCreated')
  EXECUTE FUNCTION on_rally_created();
```

### 4.2 Grant Registrar Role on RegistrarInvited

When a Registrar is invited, we store their email. When they sign in and we know their user ID, we grant the role:

```sql
CREATE OR REPLACE FUNCTION on_registrar_invited()
RETURNS TRIGGER AS $$
DECLARE
  registrar_user_id UUID;
BEGIN
  IF NEW.event_type = 'RegistrarInvited' THEN
    -- Try to find existing user by email
    SELECT id INTO registrar_user_id
    FROM auth.users
    WHERE email = NEW.payload->>'registrar_email';

    IF registrar_user_id IS NOT NULL THEN
      INSERT INTO rally_roles (rally_id, user_id, role, section_id)
      VALUES (NEW.rally_id, registrar_user_id, 'registrar', NEW.section_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_registrar_invited
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'RegistrarInvited')
  EXECUTE FUNCTION on_registrar_invited();
```

### 4.3 Grant Operator Role on OperatorInvited

```sql
CREATE OR REPLACE FUNCTION on_operator_invited()
RETURNS TRIGGER AS $$
DECLARE
  operator_user_id UUID;
BEGIN
  IF NEW.event_type = 'OperatorInvited' THEN
    SELECT id INTO operator_user_id
    FROM auth.users
    WHERE email = NEW.payload->>'operator_email';

    IF operator_user_id IS NOT NULL THEN
      INSERT INTO rally_roles (rally_id, user_id, role)
      VALUES (NEW.rally_id, operator_user_id, 'operator')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_operator_invited
  AFTER INSERT ON domain_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'OperatorInvited')
  EXECUTE FUNCTION on_operator_invited();
```

### 4.4 Resolve Invited Roles on Sign-In

If an invited user (Registrar or Operator) signs up after being invited, we need to backfill their role. This runs when a new user is created in Supabase Auth:

```sql
CREATE OR REPLACE FUNCTION on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
  -- Find any RegistrarInvited events matching this email
  INSERT INTO rally_roles (rally_id, user_id, role, section_id)
  SELECT
    de.rally_id,
    NEW.id,
    'registrar',
    de.section_id
  FROM domain_events de
  WHERE de.event_type = 'RegistrarInvited'
    AND de.payload->>'registrar_email' = NEW.email
  ON CONFLICT DO NOTHING;

  -- Find any OperatorInvited events matching this email
  INSERT INTO rally_roles (rally_id, user_id, role)
  SELECT
    de.rally_id,
    NEW.id,
    'operator'
  FROM domain_events de
  WHERE de.event_type = 'OperatorInvited'
    AND de.payload->>'operator_email' = NEW.email
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION on_auth_user_created();
```

### 4.5 Enforce Section Lock

Prevent roster events after a `SectionLocked` event. A database function checks the event log:

```sql
CREATE OR REPLACE FUNCTION check_section_not_locked()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type IN ('RosterUpdated', 'ParticipantAdded', 'ParticipantRemoved') THEN
    IF EXISTS (
      SELECT 1 FROM domain_events
      WHERE rally_id = NEW.rally_id
        AND section_id = NEW.section_id
        AND event_type = 'SectionLocked'
    ) THEN
      RAISE EXCEPTION 'Section roster is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_section_lock
  BEFORE INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION check_section_not_locked();
```

---

## 5. Pre-Race Workflows (Client Code)

All operations append events via `supabase-js`. State is derived client-side by replaying the event log.

### 5.1 Append an Event

```javascript
async function appendEvent(supabase, event) {
  const { data, error } = await supabase
    .from('domain_events')
    .insert({
      rally_id: event.rally_id,
      section_id: event.section_id || null,
      event_type: event.type,
      payload: event,
      created_by: (await supabase.auth.getUser()).data.user.id
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

### 5.2 Replay Events to Derive State

```javascript
async function loadRallyState(supabase, rallyId) {
  const { data: events } = await supabase
    .from('domain_events')
    .select('*')
    .eq('rally_id', rallyId)
    .order('id');

  // Same reducer used on race day — shared state-manager.js module
  return events.reduce(applyEvent, initialState);
}
```

The pre-race UI and the race day UI share the same `state-manager.js` reducer. The only difference is where events come from (Supabase query vs IndexedDB).

### 5.3 Organizer: Create Rally

```javascript
await appendEvent(supabase, {
  type: 'RallyCreated',
  rally_id: crypto.randomUUID(),
  rally_name: 'Kub Kars Rally 2026',
  rally_date: '2026-03-15',
  created_by: user.email,
  timestamp: Date.now()
});
```

### 5.4 Organizer: Create Section

```javascript
await appendEvent(supabase, {
  type: 'SectionCreated',
  rally_id: rallyId,
  section_id: crypto.randomUUID(),
  section_name: 'Cubs',
  created_by: user.email,
  timestamp: Date.now()
});
```

### 5.5 Organizer: Invite Registrar

```javascript
// 1. Append the domain event
await appendEvent(supabase, {
  type: 'RegistrarInvited',
  rally_id: rallyId,
  section_id: sectionId,
  registrar_email: 'cubmaster@example.com',
  invited_by: user.email,
  timestamp: Date.now()
});

// 2. Send magic link to the Registrar
await supabase.auth.signInWithOtp({
  email: 'cubmaster@example.com'
});
```

The database trigger (Section 4.2/4.3) handles granting the Registrar access.

### 5.6 Organizer: Invite Operator

```javascript
// 1. Append the domain event
await appendEvent(supabase, {
  type: 'OperatorInvited',
  rally_id: rallyId,
  operator_email: 'backup-operator@example.com',
  invited_by: user.email,
  timestamp: Date.now()
});

// 2. Send magic link to the Operator
await supabase.auth.signInWithOtp({
  email: 'backup-operator@example.com'
});
```

The database trigger (Section 4.3/4.4) handles granting the Operator access.

---

### 5.7 Registrar: Upload Roster

```javascript
await appendEvent(supabase, {
  type: 'RosterUpdated',
  rally_id: rallyId,
  section_id: sectionId,
  participants: [
    { participant_id: crypto.randomUUID(), name: 'Billy Thompson' },
    { participant_id: crypto.randomUUID(), name: 'Sarah Chen' }
  ],
  submitted_by: user.email,
  timestamp: Date.now()
});
```

Car numbers are derived by the state manager when replaying events (sequential assignment based on array order).

### 5.8 Registrar: Add / Remove Participant

```javascript
// Add
await appendEvent(supabase, {
  type: 'ParticipantAdded',
  rally_id: rallyId,
  section_id: sectionId,
  participant: { participant_id: crypto.randomUUID(), name: 'Tommy Rodriguez' },
  car_number: nextAvailableCarNumber,  // computed from current derived state
  added_by: user.email,
  timestamp: Date.now()
});

// Remove
await appendEvent(supabase, {
  type: 'ParticipantRemoved',
  rally_id: rallyId,
  section_id: sectionId,
  participant_id: participantId,
  car_number: carNumber,
  removed_by: user.email,
  timestamp: Date.now()
});
```

### 5.9 Organizer: Lock Section

```javascript
await appendEvent(supabase, {
  type: 'SectionLocked',
  rally_id: rallyId,
  section_id: sectionId,
  locked_by: user.email,
  timestamp: Date.now()
});
```

After this, the database trigger (Section 4.4) prevents further roster events.

---

## 6. Roster Package (Race Day Import)

On race day, the Operator needs the locked roster. Two options:

### 6.1 Fetch from Supabase (Online)

Replay events to derive the roster, then create `RosterLoaded` events in IndexedDB:

```javascript
async function importRoster(supabase, store, rallyId) {
  // Replay pre-race events to derive current state
  const state = await loadRallyState(supabase, rallyId);

  // For each locked section, emit a RosterLoaded event into IndexedDB
  for (const section of Object.values(state.sections)) {
    if (!section.locked) continue;

    await store.appendEvent({
      type: 'RosterLoaded',
      rally_id: rallyId,
      section_id: section.section_id,
      participants: section.participants,  // derived from events
      timestamp: Date.now()
    });
  }
}
```

### 6.2 Import from JSON File (Offline)

The Organizer can export the derived roster as a JSON file before race day:

```json
{
  "version": 1,
  "rally_id": "uuid",
  "rally_name": "Kub Kars Rally 2026",
  "rally_date": "2026-03-15",
  "exported_at": 1708012345678,
  "sections": [
    {
      "section_id": "uuid",
      "section_name": "Cubs",
      "participants": [
        { "participant_id": "uuid", "name": "Billy Thompson", "car_number": 1 },
        { "participant_id": "uuid", "name": "Sarah Chen", "car_number": 2 }
      ]
    }
  ]
}
```

Car numbers restart at 1 per Section. The Race Controller uses `(section_id, car_number)` as the unique identifier.

---

## 7. Race Day Sync

Race day events sync from IndexedDB to the same `domain_events` table. See `02-architecture.md` Section 7 for the sync worker pattern.

**Sync uses upsert** with the partial unique index on `client_event_id`:

```javascript
const rows = events.map(e => ({
  rally_id: rallyId,
  section_id: sectionId,
  event_type: e.type,
  payload: e.payload,
  client_event_id: e.id,          // IndexedDB auto-increment ID
  created_by: userId
}));

const { error } = await supabase
  .from('domain_events')
  .upsert(rows, { onConflict: 'rally_id,section_id,client_event_id' });
```

**Restore** queries the same table, filtering for race day events (those with `client_event_id`):

```javascript
const { data } = await supabase
  .from('domain_events')
  .select('*')
  .eq('rally_id', rallyId)
  .eq('section_id', sectionId)
  .not('client_event_id', 'is', null)
  .order('client_event_id');
```

---

## 8. Supabase Free Tier Fit

| Resource | Free Tier Limit | RallyLab Usage |
|----------|----------------|----------------|
| Database | 500 MB | <1 MB per Rally (trivial) |
| Auth users | Unlimited | ~10-20 per Rally |
| API requests | Unlimited | ~100/day pre-race, ~100/race day |
| Storage | 1 GB | Not used |
| Bandwidth | 5 GB | Negligible |

A small youth group's usage is well within free tier limits.

---

## 9. References

- `02-architecture.md` — System architecture, Supabase sync pattern
- `04-domain-events.md` — Complete event catalog and schemas
- `10-frontend-architecture.md` — Module that wraps Supabase client

---

**End of Pre-Race Data v2.0**
