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

## Scheduling BDD Tests

Cucumber feature specs for the heat scheduling algorithm. Run with `npx cucumber-js`.

| Feature | Scenarios | Description |
|---------|-----------|-------------|
| [circle-method](test/features/circle-method.feature) | 6 | Perfect lane balance for solvable roster sizes; every car races each lane once |
| [greedy-heuristic](test/features/greedy-heuristic.feature) | 6 | Fallback algorithm for non-solvable sizes; lane balance within 1 |
| [algorithm-selection](test/features/algorithm-selection.feature) | 11 | Auto-selects circle method or greedy based on roster size and lane count |
| [speed-matching](test/features/speed-matching.feature) | 5 | Groups participants by average time after initial heats |
| [schedule-modifications](test/features/schedule-modifications.feature) | 8 | Car removal and late arrival trigger schedule regeneration mid-event |
| [edge-cases](test/features/edge-cases.feature) | 5 | Boundary conditions: zero participants, single car, more lanes than cars |

## E2E Test Suite

Browser-based feature tests using Playwright + playwright-bdd. Run with `npx bddgen && npx playwright test`.

| Feature | Scenarios | Description |
|---------|-----------|-------------|
| [smoke](test/e2e/features/smoke.feature) | 5 | App loads, auth flows, demo data bootstrap |
| [pre-race](test/e2e/features/pre-race.feature) | 4 | Create events and sections, add participants, import demo roster |
| [registrar](test/e2e/features/registrar.feature) | 6 | Registrar role: scoped access, combo table, filtered roster, add participant |
| [check-in](test/e2e/features/check-in.feature) | 4 | Operator check-in screen: mark cars arrived, counter updates, start section |
| [section-completion](test/e2e/features/section-completion.feature) | 4 | Final results screen, leaderboard columns, return to event home |
| [multi-section](test/e2e/features/multi-section.feature) | 3 | Race multiple sections in sequence, view per-section results |
| [late-checkin](test/e2e/features/late-checkin.feature) | 2 | Mid-race arrival generates catch-up heats for missed rounds |
| [late-registration](test/e2e/features/late-registration.feature) | 2 | Participant added after racing begins receives catch-up heats |
| [car-removal](test/e2e/features/car-removal.feature) | 2 | Remove broken car mid-race; results preserved, schedule regenerated |
| [rerun](test/e2e/features/rerun.feature) | 2 | Re-run a disputed heat; new result supersedes previous |
| [lane-correction](test/e2e/features/lane-correction.feature) | 2 | Correct lane misassignment retroactively after a heat completes |
| [lane-configuration](test/e2e/features/lane-configuration.feature) | 3 | Non-adjacent lane sets, mid-race lane changes, restaging |

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
