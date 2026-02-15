# Kub Kars — Race Day State Machine

**Version:** 1.0
**Status:** Specification

---

## 1. Overview

This document defines the formal state machine for race day operations. All state transitions are triggered by domain events (see `04-domain-events.md`). The state machine governs what the Operator can do and what the Audience Display shows at any point during a race day.

---

## 2. States

```
Idle
  │
  │ RosterLoaded
  ▼
EventLoaded
  │
  │ CarArrived (one or more)
  │ SectionStarted
  ▼
SectionActive:CheckIn
  │
  │ SectionStarted
  ▼
SectionActive:Staging
  │
  │ RaceCompleted / ResultManuallyEntered
  ▼
SectionActive:Results
  │
  ├─ (auto) next heat ──► SectionActive:Staging
  │
  ├─ RerunDeclared ──► SectionActive:Staging (same heat)
  │
  │ (last heat completed)
  ▼
SectionComplete
  │
  │ (start another section or end)
  ▼
EventLoaded  ◄── (loop for next section)
```

### 2.1 State Definitions

| State | Description |
|-------|-------------|
| **Idle** | App loaded, no Event data present. Operator must load a Roster Package. |
| **EventLoaded** | Roster Package imported. Operator sees Section list. Audience Display shows Welcome. |
| **SectionActive:CheckIn** | A Section is selected. Operator checks in cars (`CarArrived`). Not yet racing. |
| **SectionActive:Staging** | Current heat is staged. Lane assignments shown on Audience Display. Waiting for race to complete. |
| **SectionActive:Results** | Race completed. Results shown on Audience Display. Operator can accept (advance), re-run, or enter manual result. |
| **SectionComplete** | All heats for this Section have been run. Final leaderboard shown. |

---

## 3. Transitions

### 3.1 Idle → EventLoaded

**Trigger:** `RosterLoaded` event (one per Section in the Roster Package)

**Guard:** Roster Package must contain at least one Section with participants.

**Effect:**
- Event data stored in event log
- Audience Display shows Welcome screen

### 3.2 EventLoaded → SectionActive:CheckIn

**Trigger:** Operator selects a Section to race

**Guard:** Section must have a loaded roster (via `RosterLoaded`).

**Effect:**
- Section becomes the active Section
- Operator can check in cars (`CarArrived`)

### 3.3 SectionActive:CheckIn → SectionActive:Staging

**Trigger:** `SectionStarted` event (Operator clicks "Start Section")

**Guard:** At least 2 cars must have `CarArrived` events.

**Effect:**
- Heat schedule generated from arrived cars (see `07-heat-scheduling.md`)
- `HeatStaged` event emitted for Heat 1
- Audience Display switches to Heat 1 Staging screen

### 3.4 SectionActive:Staging → SectionActive:Results

**Trigger:** `RaceCompleted` or `ResultManuallyEntered` event

**Guard:** Event must be for the currently staged heat.

**Effect:**
- Results computed (place, time)
- Audience Display shows Results screen
- Leaderboard updated (see `08-scoring-and-leaderboard.md`)

### 3.5 SectionActive:Results → SectionActive:Staging (next heat)

**Trigger:** Gate reset detected (`wait_gate` returns `gate_ready: true`), or auto-advance after results display

**Guard:** There must be remaining heats in the schedule.

**Effect:**
- `HeatStaged` event emitted for next heat
- Audience Display switches to next heat Staging screen

### 3.6 SectionActive:Results → SectionActive:Staging (re-run, same heat)

**Trigger:** `RerunDeclared` event (Operator clicks "Re-Run")

**Guard:** Must be in Results state.

**Effect:**
- Audience Display returns to Staging for the same heat
- Previous result will be superseded by the next `RaceCompleted` for this heat

### 3.7 SectionActive:Results → SectionComplete (last heat)

**Trigger:** Gate reset after the final heat's results are shown, and no more heats remain.

**Guard:** All heats must have accepted results.

**Effect:**
- `SectionCompleted` event emitted
- Audience Display shows final leaderboard / Section Complete screen

### 3.8 SectionComplete → EventLoaded

**Trigger:** Operator navigates back to Event Home (to start another Section or end)

**Effect:**
- Active Section cleared
- Audience Display returns to Welcome (or stays on final leaderboard until next Section starts)

---

## 4. Re-Run Sub-Cycle

Re-runs are not a separate state. They cycle within the existing states:

```
SectionActive:Results
  │
  │ RerunDeclared
  ▼
SectionActive:Staging (same heat number)
  │
  │ RaceCompleted
  ▼
SectionActive:Results (new result supersedes previous)
```

The `RerunDeclared` event marks operator intent. The next `RaceCompleted` for the same heat number becomes the accepted result, and all previous results for that heat are marked superseded.

Multiple re-runs are allowed. Each cycle follows the same pattern.

---

## 5. Audience Display State Mapping

| Race Day State | Audience Display Shows |
|----------------|----------------------|
| Idle | Nothing (app not ready) |
| EventLoaded | Welcome screen (Event name) |
| SectionActive:CheckIn | Welcome screen (or check-in progress) |
| SectionActive:Staging | Heat Staging (Section name, heat number, lane assignments) |
| SectionActive:Results | Race Results (ranked finish, times if available) |
| SectionComplete | Final Leaderboard / Section Complete |

### 5.1 Leaderboard Display

The Audience Display shows the leaderboard:
- Briefly after each heat's results (top N standings update)
- As the persistent display during SectionComplete

The Operator can trigger "Replay Last Results" to re-show results without affecting state progression.

---

## 6. Operator Actions per State

| State | Available Actions |
|-------|-------------------|
| Idle | Load Roster Package (file upload or server fetch) |
| EventLoaded | Select Section, browse rosters |
| SectionActive:CheckIn | Check in cars, Start Section |
| SectionActive:Staging | (waiting for race) Manual Rank (fallback) |
| SectionActive:Results | Re-Run, Replay Last Results, Manual Rank, Remove Car |
| SectionComplete | Start next Section, view final standings |

### 6.1 Admin Plane (Always Available)

While a Section is active, the Operator can browse other Sections' rosters in the Admin Plane without affecting the Audience Display. See `09-operator-ui-ux.md`.

---

## 7. Guard Conditions Summary

| Transition | Guard |
|------------|-------|
| Load Event | Roster Package has at least one Section with participants |
| Start Section | At least 2 cars checked in (`CarArrived`) |
| Accept results / advance | `RaceCompleted` or `ResultManuallyEntered` for current heat |
| Complete Section | All scheduled heats have accepted results |
| Re-Run | Must be in Results state for current heat |
| Remove Car | Section must be active; car must not already be removed |

---

## 8. Late Arrivals

If a car arrives (`CarArrived`) after `SectionStarted`, the heat schedule is regenerated for remaining heats to include the late arrival. Completed heats are not affected.

This does not change the current state — it modifies the derived heat schedule.

---

## 9. Error Recovery

### 9.1 Track Controller Disconnects

State remains unchanged. The system stays in `SectionActive:Staging` until the Track Controller reconnects and delivers a `RaceCompleted`, or the Operator enters a manual result.

### 9.2 Browser Refresh

State rebuilds from IndexedDB event log. The app returns to the correct state based on the last event for the active Section.

### 9.3 Car Destroyed Mid-Heat

1. Operator completes the current heat (result includes all lanes that finished)
2. Operator issues `CarRemoved` event
3. Heat schedule regenerates for remaining heats
4. Racing continues

---

## 10. References

- `04-domain-events.md` — Event definitions and schemas
- `07-heat-scheduling.md` — Heat schedule generation
- `08-scoring-and-leaderboard.md` — Scoring algorithm
- `09-operator-ui-ux.md` — Operator interface specification

---

**End of Race Day State Machine v1.0**
