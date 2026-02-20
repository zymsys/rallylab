# RallyLab — Operator UI/UX

**Version:** 1.1
**Status:** Specification

---

This document specifies the **Operator UI/UX** for race day using a **gate-driven epoch model** and a **mostly passive Operator**.

Scope: UI/UX only (implementable). For state transitions, see `06-race-day-state-machine.md`. For event definitions, see `04-domain-events.md`.

---

## 1. Goals

- Operator can run a Rally with **minimal interaction**
- Track Operator runs the physical race; software primarily **displays staging + results**
- Automatic progression between heats (no "Next Heat" button)
- Provide simple intervention paths: **Re-Run**, **Replay Last Results**, **Manual Rank**

---

## 2. Key UX Decisions

1. Starting a Section immediately shows **Heat 1 Staging** on the Audience Display
2. **No race "running" UI** — the race happens physically; software shows **staging** and **results**
3. **No timers** for advancing screens — transitions follow **gate/epoch progression**
4. Operator may browse other Sections during a live run; Audience Display reflects **Active Section** only

---

## 3. Two UI Planes

### 3.1 Active Run Plane

Exactly one Section may be **Active (LIVE)** at a time.

- Drives Audience Display content
- Owns current heat + last results
- See state machine states in `06-race-day-state-machine.md`

### 3.2 Admin Plane

Operator may browse rosters/Sections at any time.

- Does **not** affect the Audience Display
- Used for questions like "Is Billy registered in Scouts?"

---

## 4. Screens

### 4.1 Screen A — Rally List

**Purpose:** Select or load a Rally.

**State:** `Idle`

UI:
- List of available Rallies (from server if online, or from file import)
- Buttons: **Load Rally** (file import), **Fetch from Server** (if online)

Behavior:
- Loading a Rally transitions to `RallyLoaded`
- Audience Display shows **Welcome** screen

---

### 4.2 Screen B — Rally Home

**Purpose:** See Sections and manage the Rally.

**State:** `RallyLoaded`

UI:
- Rally name and date
- Section list showing: Section name, participant count, status (not started / in progress / complete)

Actions:
- Click a Section → opens **Section Detail** (Admin Plane)
- **Start Section** → begins check-in, then racing

Audience Display:
- Shows **Welcome** until a Section is started

---

### 4.3 Screen C — Section Detail (Admin Plane)

**Purpose:** View roster, check in cars, start racing.

**State:** `RallyLoaded` or `SectionActive:CheckIn`

UI:
- Roster table: Car #, Name, Checked In (yes/no)
- **Check In** toggle per car (emits `CarArrived`)
- **Start This Section** button (requires at least 2 cars checked in)

Behavior:
- Browsing rosters does **not** change the Audience Display (Admin Plane)
- Starting the Section transitions to `SectionActive:Staging`

---

### 4.4 Screen D — Live Section Console (Active Run Plane)

**Purpose:** Run the active Section with minimal interaction.

**State:** `SectionActive:Staging` or `SectionActive:Results`

#### Pinned Header (always visible)

- **Active Section: \<name\> (LIVE)**
- **Heat: \<number\>** (optionally "Heat X of Y")
- State label: **Staging** or **Results**

#### Main Content

Two stacked panels (or side-by-side on wide screens):

**1) Current Heat (Staging)**
- Lane assignment table: Lane → Car # → Name
- Mirrors the Audience Display staging view

**2) Last Results**
- Results table: Place → Lane → Car # → Name → Time (if available)
- If manual: Place → Lane → Car # → Name (no time)
- Small badge: "Source: Track" or "Source: Manual"

#### Operator Controls (three core buttons)

1. **Re-Run**
   - Emits `RerunDeclared` event
   - Returns Audience Display to current heat staging
   - The next completion supersedes the previous result
   - No confirmation dialog

2. **Replay Last Results**
   - Re-shows the last results on the Audience Display
   - Does not change heat progression or emit events

3. **Manual Rank**
   - Opens Manual Rank modal (see Section 5)

#### Additional Controls

4. **Remove Car**
   - Available during Results state
   - Opens confirmation: "Remove car #X from remaining heats?"
   - Emits `CarRemoved` event
   - Schedule regenerates for remaining heats

#### Admin Plane Access While Live

- Operator may navigate to other Sections/rosters
- The UI keeps **Active Section (LIVE)** visible and offers: **Return to Live Console**
- Audience Display never changes unless the Operator deliberately starts a different Section

---

### 4.5 Screen E — Section Complete

**Purpose:** Show final results for a completed Section.

**State:** `SectionComplete`

UI:
- Section name with "Complete" badge
- Final leaderboard (full standings)
- Buttons: **Return to Rally Home**, **Show Leaderboard on Display**

Audience Display:
- Shows final leaderboard / Section Complete screen
- **Show Leaderboard on Display** re-broadcasts the leaderboard

---

## 5. Manual Rank Modal (Fallback)

Purpose: allow the Rally to continue if hardware fails or results cannot be trusted.

UI:
- Shows the current heat lane assignments
- Operator assigns an **ordered finish** per lane (rank only)
- Optional per lane: DNF checkbox

Save behavior:
- Emits `ResultManuallyEntered` event
- Audience Display shows Results screen (ranks only, no times)
- Scoring uses rank-based fallback (see `08-scoring-and-leaderboard.md`)

Policy:
- Manual results are authoritative until superseded by a Re-Run + new completion

---

## 6. Audience Display

The Audience Display is driven entirely by BroadcastChannel messages from the Operator Display. It is stateless. See `02-architecture.md` for the message contract.

### 6.1 Welcome

Shown when Rally is loaded, before any Section starts.

### 6.2 Heat Staging

Shown when a Section starts or when advancing to the next heat.

Shows:
- Section name
- Heat number
- Lane assignments (Lane → Car # → Name)
- "Stage Cars" / "Ready" messaging

### 6.3 Results

Shown after a race completion or manual rank entry.

Shows:
- Ranked finish (Place → Car # → Name → Time)
- Times if available; "Manual" badge if not

### 6.4 Leaderboard

Shown briefly after results (top N update), and persistently during Section Complete.

Shows:
- Ranked standings (Rank → Car # → Name → Avg Time)
- Incomplete participants marked

### 6.5 Section Complete

Shown after the last heat's results. Displays final standings.

### 6.6 Return to Staging

Triggered by gate reset detection (Track Operator has reset the gate for the next heat). No timer — the transition follows the physical gate state.

Operator overrides:
- **Replay Last Results** re-shows Results without changing progression
- **Re-Run** returns to Staging for the same heat

---

## 7. Minimal Acceptance Criteria

- Operator can load a Rally and start a Section
- Audience Display shows Welcome → Heat Staging → Results → next Heat Staging automatically
- Operator can:
  - Re-Run the current heat
  - Replay last results
  - Enter manual ranked results
  - Remove a car mid-rally
- Operator can browse other Section rosters without affecting the Audience Display
- Active Section remains visibly pinned as LIVE while browsing
- Section completion shows final leaderboard on Audience Display

---

## 8. Out of Scope

- Heat generation algorithms (see `07-heat-scheduling.md`)
- Track protocol details (see `03-track-controller-protocol.md`)
- Persistence model (see `02-architecture.md`)
- Scoring algorithm (see `08-scoring-and-leaderboard.md`)

---

## 9. References

- `02-architecture.md` — BroadcastChannel message contract
- `04-domain-events.md` — Events emitted by Operator actions
- `06-race-day-state-machine.md` — State transitions and guards
- `08-scoring-and-leaderboard.md` — Scoring and rank-based fallback

---

**End of Operator UI/UX v1.1**
