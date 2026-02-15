# Kub Kars — Heat Scheduling Algorithm

**Version:** 2.0
**Status:** Implemented

---

## 1. Overview

The Heat Scheduling Algorithm generates a sequence of heats for a Section such that:

1. Every participant runs on every lane exactly once (when mathematically possible)
2. Participants are grouped by similar speed for dramatic racing (after initial round)
3. No participant races alone (minimum 2 per heat)
4. Lane fairness is maximized even when perfect balance is impossible

**Strategy:** Hybrid approach using a cyclic construction for perfect lane balance when the roster size is known solvable, falling back to a greedy heuristic with optimal lane assignment otherwise.

The scheduler runs as derived state — it is computed from the event log, never stored as an event. See `06-race-day-state-machine.md` for when scheduling runs.

---

## 2. Inputs

### 2.1 Required Inputs

```javascript
{
  participants: [
    { car_number: 1, name: "Billy" },
    { car_number: 2, name: "Sarah" },
    // ... only participants with CarArrived events
  ],
  lane_count: 6,  // from Track Controller info command
  results: []     // empty for initial schedule
}
```

Note: `section_id` is not passed to the scheduler. The caller scopes participants and results to the section before invoking.

### 2.2 Optional Inputs

```javascript
{
  speed_matching: true     // default true (uses results if available)
}
```

---

## 3. Outputs

```javascript
{
  heats: [
    {
      heat_number: 1,
      lanes: [
        { lane: 1, car_number: 3, name: "Tommy" },
        { lane: 2, car_number: 7, name: "Alice" },
        { lane: 3, car_number: 1, name: "Billy" },
        { lane: 4, car_number: 5, name: "Emma" },
        { lane: 5, car_number: 2, name: "Sarah" },
        { lane: 6, car_number: 8, name: "Jake" }
      ]
    },
    // ... more heats
  ],
  metadata: {
    algorithm_used: "circle_method",  // or "greedy_heuristic" or "speed_matched_greedy"
    total_heats: 12,
    cars_per_heat: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    lane_balance_perfect: true,
    speed_matched: false
  }
}
```

---

## 4. Algorithm Selection Logic

```javascript
function selectAlgorithm(participantCount, laneCount, results, options = {}) {
  const hasResults = results && results.length > 0;
  const speedMatchingEnabled = options.speed_matching !== false;

  if (!hasResults && isKnownSolvable(participantCount, laneCount)) {
    return "circle_method";
  }

  if (hasResults && speedMatchingEnabled) {
    return "speed_matched_greedy";
  }

  return "greedy_heuristic";
}

function isKnownSolvable(N, L) {
  const knownSolvable = [6, 7, 8, 12, 16, 18, 24, 32];

  if (knownSolvable.includes(N)) return true;
  if (isPowerOfTwo(N)) return true;
  if (N === L || N === L + 1) return true;

  return false;
}
```

When `speed_matching` is explicitly `false`, results are ignored for algorithm selection and the scheduler uses the greedy heuristic without speed tiers.

---

## 5. Cyclic Method Algorithm (Perfect Balance)

Used when roster size is known solvable and no speed matching is needed.

### 5.1 How It Works

The Cyclic Method uses a direct construction that guarantees every participant runs each lane exactly once. In heat `h`, lane `l` is assigned participant `(h + l) mod N`. This produces a Latin-square-like structure where:

- Each column (lane) contains every participant exactly once across all heats
- Each row (heat) contains `L` distinct participants (where `L = min(lane_count, N)`)
- Each participant races exactly `L` times total

**Visual explanation for 8 participants, 6 lanes:**

```
Heat 1:  P1  P2  P3  P4  P5  P6
Heat 2:  P2  P3  P4  P5  P6  P7
Heat 3:  P3  P4  P5  P6  P7  P8
Heat 4:  P4  P5  P6  P7  P8  P1
Heat 5:  P5  P6  P7  P8  P1  P2
Heat 6:  P6  P7  P8  P1  P2  P3
Heat 7:  P7  P8  P1  P2  P3  P4
Heat 8:  P8  P1  P2  P3  P4  P5
```

Each participant appears in exactly 6 heats (once per lane) and sits out 2 heats.

### 5.2 Implementation

```javascript
function circleMethod(participants, laneCount) {
  const N = participants.length;
  const L = Math.min(laneCount, N);
  const heats = [];

  for (let h = 0; h < N; h++) {
    const lanes = [];
    for (let l = 0; l < L; l++) {
      const idx = (h + l) % N;
      lanes.push({
        lane: l + 1,
        car_number: participants[idx].car_number,
        name: participants[idx].name
      });
    }
    heats.push({ heat_number: h + 1, lanes });
  }

  return heats;
}
```

### 5.3 Why Cyclic Over Pairing-Based

The original spec proposed a pairing-based round-robin (circle method with fixed participant and clockwise rotation). During implementation, this approach was found to not achieve perfect lane balance — the pairing algorithm only produces `N-1` unique rounds for even `N`, and lane assignment via rotation does not guarantee each participant visits each lane exactly once.

The cyclic construction is provably correct for all `N ≥ L`, simpler to implement, and deterministic. No bye handling is needed.

---

## 6. Greedy Heuristic Algorithm (Fallback)

Used when roster size is not known solvable OR when speed matching is enabled.

### 6.1 Algorithm Logic

1. **Initialize tracking:** Track how many times each participant has run on each lane (2D matrix: `laneUsage[car_number][lane] = count`). Track total heats run per participant.

2. **Target heats:** `targetHeats = N` (number of participants). Each participant races `effectiveLanes` times (where `effectiveLanes = min(lane_count, N)`), producing `N × effectiveLanes` total slots across `N` heats of `effectiveLanes` cars each.

3. **Car selection per heat:** Sort participants by fewest heats run (ascending), then by car number for deterministic tie-breaking. Select the first `effectiveLanes` participants.

4. **Lane assignment per heat:** Use backtracking search to find the assignment of cars to lanes that minimizes the maximum imbalance (`max_usage - min_usage`) across all participants. This considers all car-lane combinations simultaneously rather than assigning one car at a time.

5. **Speed groups (if provided):** Each speed tier is scheduled independently with its own lane usage tracking and heat count (`groupTargetHeats = group.length`).

### 6.2 Lane Assignment: Backtracking Search

A simple per-car greedy ("assign each car to its least-used lane") fails for certain roster sizes (e.g., 15 participants on 6 lanes) because the last-assigned car in each heat repeatedly gets suboptimal leftover lanes.

The implementation instead uses a backtracking search with pruning over all possible car-to-lane assignments within a heat. For each candidate assignment, it computes an imbalance score (the maximum `max_usage - min_usage` across all cars after applying the assignment) and keeps the assignment with the lowest score. Early pruning terminates branches that cannot improve on the current best.

This is fast for typical lane counts (≤ 8 lanes = at most 8! = 40,320 branches before pruning).

### 6.3 Guarantee

`max(lane_usage) - min(lane_usage) <= 1` for every participant across the full schedule.

---

## 7. Speed Matching Logic

### 7.1 When Speed Matching Applies

Speed matching is enabled when:
- `results` array contains at least one completed heat
- `speed_matching` flag is true (default)

### 7.2 Speed Calculation

Accepted results are determined by finding the latest result per heat by timestamp (superseded results are those with an earlier timestamp for the same heat number). No `status` field is needed on the result objects.

```javascript
function calculateAverageTimes(participants, results) {
  // Find accepted (latest by timestamp) result for each heat
  const acceptedByHeat = {};
  for (const r of results) {
    if (!acceptedByHeat[r.heat] || r.timestamp > acceptedByHeat[r.heat].timestamp) {
      acceptedByHeat[r.heat] = r;
    }
  }

  const totalTimes = {};
  const counts = {};
  participants.forEach(p => {
    totalTimes[p.car_number] = 0;
    counts[p.car_number] = 0;
  });

  for (const result of Object.values(acceptedByHeat)) {
    if (result.type === 'RaceCompleted' && result.times_ms && result.lanes) {
      // result.lanes maps lane index to { car_number }
      Object.entries(result.times_ms).forEach(([laneStr, timeMs]) => {
        const car = result.lanes[parseInt(laneStr, 10) - 1];
        if (car && car.car_number != null && totalTimes[car.car_number] !== undefined) {
          totalTimes[car.car_number] += timeMs;
          counts[car.car_number]++;
        }
      });
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      // Rank as speed proxy: place * 1000 (1st=1000, 2nd=2000, etc.)
      for (const { car_number, place } of result.rankings) {
        if (totalTimes[car_number] !== undefined) {
          totalTimes[car_number] += place * 1000;
          counts[car_number]++;
        }
      }
    }
  }

  const averages = {};
  participants.forEach(p => {
    averages[p.car_number] = counts[p.car_number] > 0
      ? totalTimes[p.car_number] / counts[p.car_number]
      : Infinity;  // No data yet = slowest group
  });

  return averages;
}
```

**Result input format:** `RaceCompleted` results must include a `lanes` array mapping lane position to car: `[{ car_number: 3 }, { car_number: 7 }, ...]`. This is derived from the `HeatStaged` event's lane assignments and attached by the caller.

### 7.3 Speed Grouping Strategy

```javascript
function groupBySpeed(participants, results, laneCount) {
  const averages = calculateAverageTimes(participants, results);

  const sorted = participants
    .slice()
    .sort((a, b) => averages[a.car_number] - averages[b.car_number]);

  // Group into speed tiers (group size = lane count)
  const groups = [];
  for (let i = 0; i < sorted.length; i += laneCount) {
    groups.push(sorted.slice(i, i + laneCount));
  }

  return groups;
}
```

### 7.4 Re-run Impact

Only the final accepted time for each heat is used for speed calculation. Superseded results are excluded. This is consistent with the scoring algorithm (see `08-scoring-and-leaderboard.md`).

### 7.5 Manual Rank Results

When a heat has only a `ResultManuallyEntered` (rank, no times), speed matching uses rank as a speed proxy: `place * 1000` milliseconds (1st = 1000, 2nd = 2000, etc.). This preserves relative ordering without requiring actual times.

---

## 8. Schedule Modifications Mid-Event

### 8.1 Car Removal

When a car is removed (`CarRemoved` event), the caller filters the participant list and calls `regenerateAfterRemoval`:

```javascript
function regenerateAfterRemoval(schedule, remainingParticipants, currentHeatNumber, laneCount, results) {
  const completedHeats = schedule.heats.filter(h => h.heat_number <= currentHeatNumber);
  const newSchedule = generateSchedule({
    participants: remainingParticipants,
    lane_count: laneCount,
    results
  });

  // Renumber new heats to continue after completed heats
  const renumberedHeats = newSchedule.heats.map((heat, i) => ({
    ...heat,
    heat_number: currentHeatNumber + i + 1
  }));

  return {
    heats: [...completedHeats, ...renumberedHeats],
    metadata: { ...newSchedule.metadata, total_heats: completedHeats.length + renumberedHeats.length }
  };
}
```

Removed car's partial results remain in the leaderboard but are marked incomplete (see `08-scoring-and-leaderboard.md`).

### 8.2 Late Arrival

When a `CarArrived` event occurs after `SectionStarted`, the caller adds the participant and calls `regenerateAfterLateArrival` with the same signature as removal. Completed heats are preserved; the new participant appears in regenerated heats.

---

## 9. Edge Cases

### 9.1 Roster Size < 2

Cannot schedule heats. Minimum 2 participants required.

### 9.2 Roster Size < Lane Count

Example: 4 participants, 6 lanes. All heats have 4 participants max. Lanes 5-6 remain empty. Each participant still runs each used lane exactly once.

### 9.3 Roster Size > 100

Warn Organizer that this creates 100+ heats. Suggest splitting into multiple Sections. No hard limit; greedy heuristic handles up to ~200 participants.

### 9.4 Late Arrival

When a `CarArrived` event occurs after `SectionStarted`, the schedule regenerates for remaining heats to include the new participant. Completed heats are not affected.

---

## 10. Testing Requirements

### 10.1 Lane Balance Validation

`validateLaneBalance(schedule)` returns `{ valid: boolean, errors: string[] }`. For circle method schedules, it checks `max === min` (perfect balance). For greedy schedules, it checks `max - min <= 1`.

```javascript
function validateLaneBalance(schedule) {
  const laneUsage = {};
  for (const heat of schedule.heats) {
    for (const { car_number, lane } of heat.lanes) {
      if (!laneUsage[car_number]) laneUsage[car_number] = {};
      laneUsage[car_number][lane] = (laneUsage[car_number][lane] || 0) + 1;
    }
  }

  const errors = [];
  const isPerfect = schedule.metadata?.algorithm_used === 'circle_method';
  const maxDiff = isPerfect ? 0 : 1;

  for (const [carNumber, lanes] of Object.entries(laneUsage)) {
    const counts = Object.values(lanes);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min > maxDiff) {
      errors.push(`Car ${carNumber}: lane imbalance ${max - min}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### 10.2 Test Cases

- 6 participants, 6 lanes (trivial perfect)
- 7 participants, 6 lanes (known solvable)
- 12 participants, 6 lanes (known solvable)
- 10 participants, 6 lanes (greedy fallback)
- 15 participants, 6 lanes (greedy fallback)
- 32 participants, 6 lanes (perfect)
- 50 participants, 6 lanes (greedy)

### 10.3 Integration Tests

- Generate schedule → run all heats → verify every participant ran N times
- Remove car at heat 5 → verify schedule regenerates correctly
- Speed matching: run 6 heats → verify next 6 heats group by speed
- Late arrival at heat 3 → verify new participant appears in remaining heats

---

## 11. Resolved Questions

1. **Berger Tables vs Circle Method:** Resolved — the cyclic construction (`participant = (heat + lane) % N`) is simpler than both and provably achieves perfect lane balance for all `N ≥ L`. No need for Berger Tables or pairing-based round-robin.

2. **Re-run impact:** Resolved — only the latest result per heat (by timestamp) is used for speed matching. Superseded results are excluded.

3. **Manual rank results and speed matching:** Resolved — rank is converted to pseudo-time (`place * 1000`) for consistent sorting with timed results.

---

## 12. Implementation

All phases are implemented in `public/js/scheduler.js` with Cucumber.js tests in `test/features/`.

**Module:** `public/js/scheduler.js` — pure functions, zero DOM/IndexedDB dependencies, deterministic (no `Math.random()`).

**Exported API:**

```javascript
// Public API
export function generateSchedule({ participants, lane_count, results, options })
export function regenerateAfterRemoval(schedule, remainingParticipants, currentHeatNumber, laneCount, results)
export function regenerateAfterLateArrival(schedule, allParticipants, currentHeatNumber, laneCount, results)

// Exported internals (for direct testing)
export function selectAlgorithm(participantCount, laneCount, results, options)
export function isKnownSolvable(N, L)
export function circleMethod(participants, laneCount)
export function greedyHeuristic(participants, laneCount, speedGroups)
export function calculateAverageTimes(participants, results)
export function groupBySpeed(participants, results, laneCount)
export function validateLaneBalance(schedule)
```

**Tests:** `npx cucumber-js` — 49 scenarios across 6 feature files covering all algorithms, edge cases, and schedule modifications.

---

## 13. References

- `04-domain-events.md` — `HeatStaged`, `CarArrived`, `CarRemoved` events
- `06-race-day-state-machine.md` — When scheduling runs
- `08-scoring-and-leaderboard.md` — Scoring algorithm and rank-based fallback

---

**End of Heat Scheduling Algorithm v2.0**
