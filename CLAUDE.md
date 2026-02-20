# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RallyLab is a pinewood derby race management system for Scouting. It is event-sourced, offline-first, and runs entirely in the browser with no custom server.

## Architecture

- **No build step, no framework** — Vanilla JS with ES modules (`<script type="module">`), direct DOM manipulation, no package.json
- **No custom server** — Supabase provides auth (magic links), PostgreSQL, and REST API. supabase-js loaded from CDN (`https://esm.sh/@supabase/supabase-js@2`)
- **Event-sourced everywhere** — Single `domain_events` table. Pre-race writes directly to Supabase; race day writes to IndexedDB first, syncs later. All state is derived by replaying events through `state-manager.js`
- **`state-manager.js` is the core** — Pure event reducer with zero dependencies, shared between pre-race and race day. Functions: `initialState()`, `applyEvent()`, `rebuildState()`, `nextAvailableCarNumber()`
- **Currently in mock mode** — `supabase.js` uses `USE_MOCK = true` with localStorage/sessionStorage. Real Supabase integration is not yet wired up

### Module Layout

```
public/
├── index.html                 # Main entry point (login + pre-race)
├── css/styles.css             # Single stylesheet, CSS custom properties
└── js/
    ├── supabase.js            # Supabase client (currently mock with localStorage)
    ├── state-manager.js       # Pure event reducer (shared across all contexts)
    └── pre-race/
        ├── app.js             # Entry point: hash-based routing, auth flow, toasts
        ├── screens.js         # 4 screen renderers (login, rally-list, rally-home, section-detail)
        ├── dialogs.js         # Modal dialogs for all pre-race operations
        ├── commands.js        # appendEvent(), loadRallyState(), exportRosterPackage()
        ├── roster-import.js   # CSV/XLSX parsing with smart column detection
        └── demo-data.js       # Seed data generator
```

Operator (`operator/`), audience (`audience/`), and supporting modules (`event-store.js`, `track-connection.js`, `broadcast.js`, `scheduler.js`, `scoring.js`) are implemented. `sync-worker.js` is not yet implemented.

## Running Tests

```bash
node --test test/state-manager.test.mjs
```

Uses Node.js native test runner (`node:test`). No other test tooling. No linting or formatting tools are configured.

## Specifications

The `specs/` folder is the **authoritative** source of truth (not `docs/`, which contains earlier iterative drafts):

| File | Content |
|------|---------|
| `01-domain-language.md` | Terminology, roles, race lifecycle |
| `02-architecture.md` | System architecture, Supabase, persistence, sync |
| `03-track-controller-protocol.md` | Serial/HTTP protocol for Pico track controller |
| `04-domain-events.md` | All 18 event types with schemas |
| `05-pre-race-data.md` | Supabase tables, RLS policies, client usage |
| `06-race-day-state-machine.md` | Formal state machine for race day |
| `07-heat-scheduling.md` | Circle method + greedy scheduling algorithm |
| `08-scoring-and-leaderboard.md` | Average time scoring, rank-based fallback |
| `09-operator-ui-ux.md` | Operator interface specification |
| `10-frontend-architecture.md` | Module structure, responsibilities, PWA setup |

Always consult the relevant spec before implementing a feature. If code and spec disagree, the spec is authoritative.

## Domain Terminology

Use these terms consistently in code, UI, and comments:

- **Rally** (not "Event" or "Meet") — a pinewood derby competition
- **Section** (not "Division") — e.g., Beaver Buggies, Kub Kars, Scout Trucks
- **Participant** (not "Racer") — the person; **Car** — the physical object
- **Registrar** — the Section Contact role that manages registration
- **Operator** — runs the race day software; Organizer is implicitly an Operator, additional Operators can be invited
- Domain event types are **PascalCase**: `RaceCompleted`, `HeatStaged`, `ParticipantAdded`, `RallyCreated`, etc.
- Use `name` as the field name (not `display_name`)

## Conventions

- All external dependencies come from CDN — never add a package.json or build tooling
- SheetJS (XLSX) is loaded via script tag in HTML, accessed as the global `XLSX`
- Hash-based routing: `#screen/param=value` pattern in `app.js`
- Events are immutable and append-only — never modify or delete events
- State is always derived by replaying the event stream, never stored directly
