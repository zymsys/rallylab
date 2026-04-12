# RallyLab

A pinewood derby race management system for Scouting. Event-sourced, offline-first, and runs entirely in the browser.

**[rallylab.vicmetcalfe.com](https://rallylab.vicmetcalfe.com/)** — project site, user guide, and documentation.

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
| `index.html` | Landing page |
| `registration.html` | Login and pre-race management (organizer) |
| `operator.html` | Race day operations (operator) |
| `registrar.html` | Race day check-in (registrar) |
| `audience.html` | Live leaderboard display |
| `pico-debug.html` | Pico W serial terminal and file editor |
| `event-inspector.html` | Domain event stream viewer |
| `debug.html` | Multi-frame debug view with fake track |

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

Then open http://localhost:8080. Click "Try Demo" to explore without any setup.

### Supabase Setup (for real auth and persistence)

1. Create a [Supabase](https://supabase.com) project
2. In the Supabase SQL Editor, run the migration:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
   This creates the `domain_events` and `rally_roles` tables, RLS policies, and triggers. All four triggers must exist **before** any user signs up — Trigger 4 fires on `auth.users` insert and will fail if the tables are missing.
3. Copy the config file and fill in your project credentials:
   ```bash
   cp public/config.example.json public/config.json
   ```
   Edit `public/config.json` with your Supabase project URL and anon key (the JWT from Settings → API).
4. Ensure **Email → Magic Link** is enabled under Authentication → Providers in the Supabase dashboard.

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

## Track Controller Setup (Raspberry Pi Pico W)

The track controller runs MicroPython on a Raspberry Pi Pico W and communicates with RallyLab over USB serial or WiFi.

### Prerequisites

- Raspberry Pi Pico W (or plain Pico for USB-only)
- [mpremote](https://docs.micropython.org/en/latest/reference/mpremote.html) CLI tool (`pip install mpremote`)

### Flash MicroPython

A brand new Pico doesn't have MicroPython — you need to flash it first.

1. Download the MicroPython `.uf2` firmware for your board ([Pico W](https://micropython.org/download/RPI_PICO_W/), [Pico](https://micropython.org/download/RPI_PICO/)). Use v1.27 or later.
2. Hold the **BOOTSEL** button on the Pico while plugging it into USB. The Pico mounts as a USB drive (e.g., `RPI-RP2`).
3. Copy the `.uf2` file to the drive. The Pico reboots automatically and the drive disappears — this is expected.

### Find the Serial Port

Once MicroPython is flashed, the Pico appears as a serial device instead of a USB drive. List available serial ports to find it:

```bash
# macOS
ls /dev/cu.usbmodem*

# Linux
ls /dev/ttyACM*

# Windows (PowerShell)
Get-WmiObject Win32_SerialPort | Select-Object DeviceID, Description
```

You should see one device (e.g., `/dev/cu.usbmodem1101` on macOS, `/dev/ttyACM0` on Linux, or `COM3` on Windows). If nothing appears, the Pico may still be in BOOTSEL mode (it shows up as a USB drive instead) — go back to the flash step above. If multiple devices appear, unplug the Pico, check the list again, then plug it back in to see which one is new.

Use the device path in place of `<PORT>` in the commands below.

### Upload the Firmware

```bash
mpremote connect <PORT> cp firmware/*.py : + reset
```

This copies all `.py` files to the Pico's flash root and resets it. The controller runs `main.py` automatically on boot.

> **Note:** Don't use `cp -r firmware/ :` — that creates a `firmware/` subdirectory on the Pico instead of placing files at the root where MicroPython expects `main.py`.

### Configure Pin Mapping

The easiest way to configure pin mapping is **Learn Pins** in the operator UI: connect via USB, open the Track Manager, click **Learn Pins**, and trigger each sensor when prompted. The wizard writes the configuration directly to the Pico.

Alternatively, edit `firmware/config.py` before uploading. Three presets are provided:

| Preset | Use case |
|--------|----------|
| **Breadboard** (default) | Development — buttons on GP5-GP13, gate on GP8 |
| **Dedicated gate** | Real track where lanes skip DA-15 Pin 7 (recommended) |
| **Shared Pin 7** | Real track where Lane 2 and the start gate share Pin 7 |

Uncomment the appropriate `LANE_PINS` / `GATE_PIN` / `GATE_INVERT` / `SHARED_PIN7` block for your wiring. See [specs/11-track-hardware.md](specs/11-track-hardware.md) for the DA-15 connector pinout.

### Verify the Connection

The easiest way to verify is to open the operator page in a Chromium-based browser (Chrome, Edge), click **Connect Track**, and select the Pico's serial port. If the connection succeeds, the track mode indicator will show "Serial" and the lane count.

To verify from the command line, use `pyserial` (`pip install pyserial`):

```bash
python3 -c "
import serial, time
s = serial.Serial('<PORT>', 115200, timeout=3)
time.sleep(1)
s.write(b'info\n')
time.sleep(1)
print(s.read(s.in_waiting).decode())
s.close()
"
```

You should see:

```json
{
  "protocol": "1.0",
  "firmware": "0.1.0",
  "lane_count": 6
}
```

> **Note:** Don't use `mpremote repl` for testing — it interrupts `main.py` and drops you into the MicroPython Python REPL, where track commands like `info` won't work.

Use `dbg_watch` to test each sensor — press a lane button or trigger a sensor and verify the correct lane number appears.

### WiFi Setup (Optional)

From the serial REPL, scan for networks and connect:

```
wifi_scan
wifi_setup <SSID> <PASSWORD>
```

Credentials are saved to flash and auto-connect on boot. The HTTP server starts automatically once connected. You can optionally set a custom hostname:

```
hostname_set my-track
```

The controller will be reachable at `my-track.local` via mDNS.

### Connecting from RallyLab

- **USB Serial** — In the operator interface, click "Connect Track" and select the Pico's serial port. Requires a Chromium-based browser (Web Serial API).
- **WiFi** — The operator interface can connect via the Pico's HTTP endpoints at `http://<ip>` or `http://<hostname>.local`.

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

RallyLab is under active development. The pre-race workflow, race day operator, registrar check-in, audience display, and heat scheduling are functional. Demo mode works without any backend; real mode uses Supabase for auth and persistence.

## License

[MIT](LICENSE)
