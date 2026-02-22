# Appendix A: Domain Language Reference

This appendix provides the authoritative terminology used throughout RallyLab. Consistent use of these terms ensures clear communication between organizers, operators, registrars, and the software.

# 1. System Layers

## 1.1 Track
The physical wooden track assembly, including:
- Lanes
- Finish switches (normally open)
- Start gate switch (normally closed)
- Wiring
- DB15 interface

The Track contains no software intelligence.

## 1.2 Track Controller
The microcontroller hardware and firmware that:
- Reads Track switches
- Detects start gate release
- Detects lane finish events
- Timestamps finish events
- Communicates race data to the Race Controller

The Track Controller has no knowledge of Participants, Heats, or competition structure.

## 1.3 Race Controller
The computer running race management software.

Responsibilities:
- Hosts web server
- Hosts Operator Display
- Hosts Audience Display
- Stores race results
- Manages competition structure (Heats, Participants, Rally)

# 2. Human Roles

## 2.1 Operator
The person operating the Race Controller software.

Responsibilities:
- Arms the system
- Oversees race start (from the software perspective)
- Declares re-runs when necessary
- Manages Heats and Races
- Finalizes results

The Operator does NOT physically release the starting gate and does not manage physical track hardware.

## 2.2 Track Operator
The person managing the physical Track hardware.

Responsibilities:
- Loads cars onto lanes
- Ensures cars are properly staged
- Physically releases the starting gate
- Monitors physical track condition
- Communicates physical issues to the Operator

The Track Operator does NOT use the Race Controller software during normal operation.

## 2.3 Audience
Spectators watching the race.
Includes youth, parents, friends, and Scouters.

# 3. UI Surfaces

## 3.1 Operator Display
The browser interface used by the Operator.
Provides control, monitoring, and race management tools.

## 3.2 Audience Display
The browser interface shown publicly.
Provides high-visibility race visuals and results.

# 4. Race Lifecycle Terminology

## 4.1 Arm
Operator action that prepares the system to detect a race start.

Effects:
- Track Controller begins monitoring start gate
- Finish lane timers are cleared
- System enters Armed state

## 4.2 Armed (State)
System state in which:
- Start gate is closed
- System is waiting for gate release
- No timing has started

## 4.3 Start
The moment the start gate transitions from closed to open.

Detected by the Track Controller.

Effects:
- Race clock starts
- Lane timers become active
- System enters Running state

Start is detected, not initiated by software.

## 4.4 Running (State)
The race is in progress.
At least one lane has not yet finished.

## 4.5 Finish (Lane Finish)
The moment a specific lane's finish switch transitions from open to closed.

Effects:
- That lane's time is frozen
- Lane marked Finished

Each lane finishes independently.

## 4.6 Complete (Race Complete)
State reached when all active lanes have finished.

No automatic timeout is defined.
The Operator may intervene if a race cannot complete normally.

## 4.7 Re-run
Operator decision that the current race result is invalid.

Effects:
- Recorded times are discarded
- The Heat is run again

This term is used externally (Operator and Audience facing).

## 4.8 Reset
Operator action that:
- Clears lane results
- Returns system to Idle state
- Prepares for next Arm

# 5. Competition Structure

## 5.1 Lane
A numbered physical path on the Track.

Properties:
- Lane number
- Assigned Participant (per Heat)
- Finish time (per Race)

## 5.2 Participant
A person entered in the competition.

Possible properties:
- Name
- Car name (optional)
- Group / Rank (optional)

## 5.3 Heat
A scheduled grouping of Participants assigned to lanes for one Race.

A Heat may require a Re-run.

## 5.4 Race
A single timed run of a Heat.

A Heat may have:
- One valid Race
- Multiple attempts (if Re-run is declared)

Clarification:
- A Heat is the scheduled assignment of Participants to lanes.
- A Race is the physical execution (one run) of that Heat.

## 5.5 Rally
The full competition (a pinewood derby race day).

Note:
"Rally" is the preferred term. "Event" and "Meet" may appear in legacy discussion but refer to the same concept.

Contains:
- All Participants
- All Heats
- All Results

# 6. Design Boundary Principle

The Track Controller knows nothing about Participants.
The Race Controller knows nothing about physical switch wiring.

Responsibility Boundary:
- The Race Controller governs competition structure (Rally, Heat, Race) and software state.
- The Track hardware and Track Operator govern physical staging and gate release.

The Track Controller bridges physical events into the software domain but does not interpret competition rules.

This separation is intentional and foundational.

# 7. Operational Modes

## 7.1 Dry Run Mode
A non-competitive operational mode used for testing hardware and software.

Characteristics:
- No results are persisted as official
- Participants may not be assigned
- Used for validation, setup, or demonstrations

## 7.2 Rally Mode
Competitive operational mode.

Characteristics:
- Heats and Races are recorded as official results
- Results are persisted
- Standings contribute to the Rally
