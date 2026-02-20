# RallyLab — Domain Language

**Version:** 1.0
**Status:** Specification

---

## 1. System Layers

### 1.1 Track

The physical wooden track assembly, including:
- Lanes
- Finish switches (normally open)
- Start gate switch (normally closed)
- Wiring
- DB15 interface

The Track contains no software intelligence.

### 1.2 Track Controller

The microcontroller hardware and firmware that:
- Reads Track switches
- Detects start gate release
- Detects lane finish events
- Timestamps finish events
- Communicates race data to the Race Controller

The Track Controller has no knowledge of Participants, Heats, or competition structure.

### 1.3 Race Controller

The browser-based application that manages race day operations.

Responsibilities:
- Stores race results (IndexedDB)
- Manages competition structure (Heats, Participants, Rally)
- Hosts Operator Display and Audience Display (separate browser tabs)
- Communicates with Track Controller via Web Serial API
- Syncs events to Supabase when online

See `02-architecture.md` for full architecture specification.

---

## 2. Human Roles

### 2.1 Organizer

The person who creates and configures the Rally before race day.

Responsibilities:
- Creates the Rally
- Creates Sections
- Invites Registrars
- Invites Operators (for race day redundancy)
- Reviews submitted rosters
- Exports roster package for race day

The Organizer is implicitly an Operator on race day. They may invite additional Operators as backup (see 2.3).

### 2.2 Registrar

The Section Contact responsible for submitting a roster for their Section.

Responsibilities:
- Receives invitation (email magic link)
- Uploads participant list (e.g., MyScouts export)
- Selects participating youth
- Submits final roster

Each Registrar manages exactly one Section. In Scouting terminology, this is typically the Group or Section Scouter.

### 2.3 Operator

The person operating the Race Controller software on race day. The Organizer is always an Operator. Additional Operators can be invited by the Organizer for redundancy (e.g., in case the primary Operator is unavailable). All Operators have equivalent access to the Rally.

Responsibilities:
- Loads the Rally and starts Sections
- Oversees race progression (from the software perspective)
- Declares re-runs when necessary
- Enters manual results when hardware fails
- Finalizes results
- Can also view the pre-race registration UI

The Operator does NOT physically release the starting gate and does not manage physical track hardware.

### 2.4 Track Operator

The person managing the physical Track hardware on race day.

Responsibilities:
- Loads cars onto lanes
- Ensures cars are properly staged
- Physically releases the starting gate
- Monitors physical track condition
- Communicates physical issues to the Operator

The Track Operator does NOT use the Race Controller software during normal operation.

### 2.5 Audience

Spectators watching the race. Includes youth, parents, friends, and Scouters.

### 2.6 Check-in Volunteer

A person invited per-Section who can check in cars on race day. Their access is limited to marking `CarArrived` for participants in their assigned Section.

Responsibilities:
- Verifies car is present and meets inspection criteria
- Marks car as arrived (`CarArrived`) in the Race Controller

Check-in Volunteers cannot start Sections, manage heats, enter results, or perform any Operator actions. They are scoped to exactly one Section (like Registrars).

### 2.7 Multiple Roles

A person can hold multiple roles for the same Rally. For example, a Section Scouter might be both a Registrar (managing their Section's roster) and an Operator (running the race day software). The UI adapts based on the union of the user's roles.

---

## 3. UI Surfaces

### 3.1 Operator Display

The browser tab used by the Operator. Provides control, monitoring, and race management tools.

### 3.2 Audience Display

The browser tab shown publicly (typically fullscreen on a projector). Provides high-visibility race visuals and results.

Both displays run on the same laptop and communicate via the BroadcastChannel API.

---

## 4. Race Lifecycle Terminology

### 4.1 Arm

Operator action that prepares the system to detect a race start.

Effects:
- Track Controller begins monitoring start gate
- Finish lane timers are cleared
- System enters Armed state

### 4.2 Armed (State)

System state in which:
- Start gate is closed
- System is waiting for gate release
- No timing has started

### 4.3 Start

The moment the start gate transitions from closed to open.

Detected by the Track Controller.

Effects:
- Race clock starts
- Lane timers become active
- System enters Running state

Start is detected, not initiated by software.

### 4.4 Running (State)

The race is in progress. At least one lane has not yet finished.

### 4.5 Finish (Lane Finish)

The moment a specific lane's finish switch transitions from open to closed.

Effects:
- That lane's time is frozen
- Lane marked Finished

Each lane finishes independently.

### 4.6 Complete (Race Complete)

State reached when all active lanes have finished.

No automatic timeout is defined. The Operator may intervene if a race cannot complete normally.

### 4.7 Re-run

Operator decision that the current race result is invalid.

Effects:
- Recorded times are discarded (superseded)
- The Heat is run again

This term is used externally (Operator and Audience facing).

### 4.8 Reset

Operator action that:
- Clears lane results
- Returns system to Idle state
- Prepares for next Arm

---

## 5. Competition Structure

### 5.1 Rally

The full competition rally (e.g., "Kub Kars Rally 2026").

Contains:
- One or more Sections
- All Participants (organized by Section)
- All Heats and Results

"Rally" is the standard term. Avoid "Meet" or "Event" (which refers to domain events in the event-sourcing sense).

### 5.2 Section

A group of Participants who race independently within a Rally. Each Section has its own roster, heat schedule, and leaderboard.

Examples:
- Beaver Buggies (Beavers)
- Kub Kars (Cubs)
- Scout Trucks (Scouts)

In Scouting contexts, "Division" is sometimes used as a synonym for Section.

Properties:
- Section name
- Roster (list of Participants with car numbers)
- Independent leaderboard and results

### 5.3 Lane

A numbered physical path on the Track.

Properties:
- Lane number (1-based)
- Assigned Participant (per Heat)
- Finish time (per Race)

### 5.4 Participant

A person competing in the Rally.

Properties:
- Name
- Car number (assigned per Section, stable once set)

A Participant is identified by their car number within a Section.

### 5.5 Car

The physical pinewood derby car.

Properties:
- Car number (painted or written on the car)
- Associated Participant

In code and protocol contexts, `car_number` is the primary identifier used during race day operations.

### 5.6 Heat

A scheduled grouping of Participants assigned to lanes for one Race.

A Heat may require a Re-run.

### 5.7 Race

A single timed run of a Heat.

A Heat may have:
- One valid Race
- Multiple attempts (if Re-run is declared)

Clarification:
- A Heat is the scheduled assignment of Participants to lanes.
- A Race is the physical execution (one run) of that Heat.

---

## 6. Operational Modes

### 6.1 Dry Run Mode

A non-competitive operational mode used for testing hardware and software.

Characteristics:
- No results are persisted as official
- Participants may not be assigned
- Used for validation, setup, or demonstrations

### 6.2 Rally Mode

Competitive operational mode.

Characteristics:
- Heats and Races are recorded as official results
- Results are persisted
- Standings contribute to the Rally

---

## 7. Design Boundary Principle

The Track Controller knows nothing about Participants.
The Race Controller knows nothing about physical switch wiring.

Responsibility Boundary:
- The Race Controller governs competition structure (Rally, Heat, Race) and software state.
- The Track hardware and Track Operator govern physical staging and gate release.

The Track Controller bridges physical events into the software domain but does not interpret competition rules.

This separation is intentional and foundational.

---

**End of Domain Language v1.0**
