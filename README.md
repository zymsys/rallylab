# RallyLab

A pinewood derby race management system for Scouting. Event-sourced, offline-first, and runs entirely in the browser.

## What It Does

RallyLab handles the full lifecycle of a pinewood derby event:

- **Pre-race** — Create events, define sections (Beaver Buggies, Kub Kars, Scout Trucks), register participants, assign car numbers, import rosters from CSV/XLSX
- **Race day check-in** — Registrars verify participant attendance and handle late registration
- **Race operations** — Operator stages heats, connects to the track controller via USB serial, records results automatically
- **Audience display** — Live leaderboard and race progress on a separate screen
- **Scheduling** — Automatic heat generation using circle method + greedy heuristic so every participant races in every lane

## Architecture

- **No framework, no build step** — Vanilla JS with ES modules, loaded directly in the browser
- **No custom server** — [Supabase](https://supabase.com) provides auth (magic links), PostgreSQL, and REST API
- **Event-sourced** — All state is derived by replaying an append-only stream of domain events. Pre-race events write to Supabase; race day events write to IndexedDB first and sync later
- **Offline-first** — The operator interface works without connectivity once bootstrapped. Race results are never lost

### Pages

| Page | Purpose |
|------|---------|
| `index.html` | Login and pre-race management (organizer) |
| `operator.html` | Race day operations (operator) |
| `registrar.html` | Race day check-in (registrar) |
| `audience.html` | Live leaderboard display |
| `fake-track.html` | Track simulator for development/demo |

### Module Structure

```
public/js/
├── state-manager.js       # Pure event reducer — the core of the system
├── supabase.js            # Supabase client (currently mock mode with localStorage)
├── event-store.js         # IndexedDB persistence for race day
├── scheduler.js           # Heat scheduling (circle method + greedy)
├── scoring.js             # Average time scoring, rank-based fallback
├── broadcast.js           # BroadcastChannel for cross-tab sync
├── track-connection.js    # Web Serial API for track controller
├── pre-race/              # Pre-race screens, dialogs, commands
├── operator/              # Race day operator UI
├── registrar/             # Race day check-in UI
├── audience/              # Audience display UI
└── fake-track/            # Track simulator
```

## Getting Started

Serve the `public/` directory with any static file server:

```bash
./start.sh
# or
cd public && python3 -m http.server 8080
```

Then open http://localhost:8080. The app runs in mock mode by default — no Supabase project needed for development.

To load demo data, use the "Load Demo Data" option from the pre-race interface.

## Running Tests

```bash
# Unit tests (Node.js native test runner)
node --test test/state-manager.test.mjs

# All unit tests
node --test test/*.test.mjs

# BDD feature tests (Cucumber)
npx cucumber-js

# Everything
npm run test:all
```

## Specifications

The `specs/` folder is the authoritative source of truth for the system design:

| Spec | Content |
|------|---------|
| [01-domain-language](specs/01-domain-language.md) | Terminology, roles, race lifecycle |
| [02-architecture](specs/02-architecture.md) | System architecture, persistence, sync |
| [03-track-controller-protocol](specs/03-track-controller-protocol.md) | Serial/HTTP protocol for the Pico track controller |
| [04-domain-events](specs/04-domain-events.md) | All domain event types with schemas |
| [05-pre-race-data](specs/05-pre-race-data.md) | Supabase tables, RLS policies |
| [06-race-day-state-machine](specs/06-race-day-state-machine.md) | Formal state machine for race day |
| [07-heat-scheduling](specs/07-heat-scheduling.md) | Heat scheduling algorithm |
| [08-scoring-and-leaderboard](specs/08-scoring-and-leaderboard.md) | Scoring rules |
| [09-operator-ui-ux](specs/09-operator-ui-ux.md) | Operator interface specification |
| [10-frontend-architecture](specs/10-frontend-architecture.md) | Module structure and responsibilities |
| [11-track-hardware](specs/11-track-hardware.md) | Track hardware design |

## Status

RallyLab is under active development. The pre-race workflow, race day operator, registrar check-in, audience display, and heat scheduling are functional in mock mode. Supabase integration (auth, persistence, sync) is not yet wired up.

## License

[MIT](LICENSE)
