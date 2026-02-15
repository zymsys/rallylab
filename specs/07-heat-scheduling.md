# Kub Kars — Heat Scheduling Algorithm

**Version:** 1.1
**Status:** Specification

---

## 1. Overview

The Heat Scheduling Algorithm generates a sequence of heats for a Section such that:

1. Every participant runs on every lane exactly once (when mathematically possible)
2. Participants are grouped by similar speed for dramatic racing (after initial round)
3. No participant races alone (minimum 2 per heat)
4. Lane fairness is maximized even when perfect balance is impossible

**Strategy:** Hybrid approach using proven tournament algorithms when possible, falling back to greedy heuristic otherwise.

The scheduler runs as derived state — it is computed from the event log, never stored as an event. See `06-race-day-state-machine.md` for when scheduling runs.

---

## 2. Inputs

### 2.1 Required Inputs

```javascript
{
  section_id: "uuid",
  participants: [
    { car_number: 1, name: "Billy" },
    { car_number: 2, name: "Sarah" },
    // ... only participants with CarArrived events
  ],
  lane_count: 6,  // from Track Controller info command
  results: []     // empty for initial schedule
}
```

### 2.2 Optional Inputs

```javascript
{
  min_cars_per_heat: 2,    // default 2
  speed_matching: true,    // default true (uses results if available)
  algorithm_preference: "hybrid"  // "hybrid", "perfect", or "greedy"
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
    algorithm_used: "circle_method",  // or "greedy_heuristic"
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
function selectAlgorithm(participantCount, laneCount, results) {
  const N = participantCount;
  const L = laneCount;
  const hasResults = results && results.length > 0;

  const isPerfectlySolvable = isKnownSolvable(N, L);

  if (!hasResults && isPerfectlySolvable) {
    return "circle_method";
  }

  if (hasResults) {
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

---

## 5. Circle Method Algorithm (Perfect Balance)

Used when roster size is known solvable and no speed matching is needed.

### 5.1 How It Works

The Circle Method is a classic round-robin tournament algorithm that guarantees:
- Every participant races every other participant exactly once (in pair-wise terms)
- Perfect lane rotation (every participant runs each lane exactly once)

**Visual explanation for 8 participants, 6 lanes:**

```
Round 1:  1-2  3-4  5-6  7-8
Round 2:  1-3  4-5  6-7  8-2
Round 3:  1-4  5-6  7-8  2-3
Round 4:  1-5  6-7  8-2  3-4
Round 5:  1-6  7-8  2-3  4-5
Round 6:  1-7  8-2  3-4  5-6
Round 7:  1-8  2-3  4-5  6-7
```

Participant 1 stays fixed. Others rotate clockwise around the circle.

### 5.2 Implementation Sketch

```javascript
function circleMethod(participants, laneCount) {
  const N = participants.length;
  const heats = [];

  const hasBye = N % 2 === 1;
  const adjusted = hasBye
    ? [...participants, { car_number: null }]
    : participants;

  for (let round = 0; round < N; round++) {
    const heat = { heat_number: round + 1, lanes: [] };
    const pairings = generateCirclePairings(adjusted, round);

    let laneNum = 1;
    for (const [car1, car2] of pairings) {
      if (laneNum > laneCount) break;
      if (car1.car_number !== null) {
        heat.lanes.push({ lane: laneNum++, ...car1 });
      }
      if (car2.car_number !== null && laneNum <= laneCount) {
        heat.lanes.push({ lane: laneNum++, ...car2 });
      }
    }

    if (heat.lanes.length >= 2) {
      heats.push(heat);
    }
  }

  return heats;
}
```

### 5.3 Lane Assignment

Rotate lane assignments across heats for perfect balance:

```javascript
function assignLanes(pairings, round, laneCount) {
  const lanes = [];
  const startingLane = (round % laneCount) + 1;

  let currentLane = startingLane;
  for (const [car1, car2] of pairings) {
    if (car1) {
      lanes.push({ lane: currentLane, ...car1 });
      currentLane = (currentLane % laneCount) + 1;
    }
    if (car2) {
      lanes.push({ lane: currentLane, ...car2 });
      currentLane = (currentLane % laneCount) + 1;
    }
  }

  return lanes;
}
```

---

## 6. Greedy Heuristic Algorithm (Fallback)

Used when roster size is not known solvable OR when speed matching is enabled.

### 6.1 Algorithm Logic

1. **Initialize tracking:** Track how many times each participant has run on each lane (2D matrix). Track total heats run per participant.

2. **For each heat:** Select participants that need the most races remaining. Assign each participant to the lane they have run the least. Resolve conflicts by checking next-least-run lane.

3. **Speed matching (if results available):** Sort participants by average time. Group consecutive participants in speed tiers. Schedule heats from speed tiers to maximize within-tier racing.

### 6.2 Implementation Sketch

```javascript
function greedyHeuristic(participants, laneCount, results = null) {
  const N = participants.length;
  const L = laneCount;
  const targetHeats = N;

  const laneUsage = {};
  participants.forEach(p => {
    laneUsage[p.car_number] = {};
    for (let lane = 1; lane <= L; lane++) {
      laneUsage[p.car_number][lane] = 0;
    }
  });

  const heatsRun = {};
  participants.forEach(p => heatsRun[p.car_number] = 0);

  const heats = [];

  let speedGroups = null;
  if (results && results.length > 0) {
    speedGroups = groupBySpeed(participants, results, laneCount);
  }

  for (let heatNum = 1; heatNum <= targetHeats; heatNum++) {
    const heat = { heat_number: heatNum, lanes: [] };
    const carsForHeat = selectCarsForHeat(
      participants, heatsRun, L, speedGroups, heatNum
    );

    const usedLanes = new Set();
    for (const car of carsForHeat) {
      const lane = findLeastUsedLane(car.car_number, laneUsage, usedLanes);
      heat.lanes.push({ lane, ...car });
      usedLanes.add(lane);
      laneUsage[car.car_number][lane]++;
      heatsRun[car.car_number]++;
    }

    heat.lanes.sort((a, b) => a.lane - b.lane);
    if (heat.lanes.length >= 2) {
      heats.push(heat);
    }
  }

  return heats;
}
```

---

## 7. Speed Matching Logic

### 7.1 When Speed Matching Applies

Speed matching is enabled when:
- `results` array contains at least one completed heat
- `speed_matching` flag is true (default)

### 7.2 Speed Calculation

```javascript
function calculateAverageTimes(participants, results) {
  const times = {};
  const counts = {};

  participants.forEach(p => {
    times[p.car_number] = 0;
    counts[p.car_number] = 0;
  });

  // Only use accepted results (superseded results excluded)
  const acceptedResults = results.filter(r => r.status === 'accepted');

  acceptedResults.forEach(result => {
    if (result.times_ms) {
      Object.entries(result.times_ms).forEach(([lane, time_ms]) => {
        const car = result.lanes[lane - 1];
        if (car && car.car_number) {
          times[car.car_number] += time_ms;
          counts[car.car_number]++;
        }
      });
    }
  });

  const averages = {};
  participants.forEach(p => {
    averages[p.car_number] = counts[p.car_number] > 0
      ? times[p.car_number] / counts[p.car_number]
      : Infinity;  // No data yet = slowest group
  });

  return averages;
}
```

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

When a heat has only a `ResultManuallyEntered` (rank, no times), speed matching uses rank as a proxy: 1st place = fastest in group. See `08-scoring-and-leaderboard.md` for rank-to-time conversion.

---

## 8. Car Removal Mid-Event

When a car is removed (`CarRemoved` event):

```javascript
function handleCarRemoval(schedule, removedCarNumber, currentHeatNumber) {
  const remaining = schedule.participants.filter(
    p => p.car_number !== removedCarNumber
  );

  const futureHeats = generateSchedule({
    participants: remaining,
    lane_count: schedule.lane_count,
    results: schedule.results,
    starting_heat_number: currentHeatNumber + 1
  });

  return {
    ...schedule,
    heats: [
      ...schedule.heats.slice(0, currentHeatNumber),
      ...futureHeats.heats
    ]
  };
}
```

Removed car's partial results remain in the leaderboard but are marked incomplete (see `08-scoring-and-leaderboard.md`).

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

```javascript
function validateLaneBalance(schedule) {
  const laneUsage = {};

  schedule.heats.forEach(heat => {
    heat.lanes.forEach(({ car_number, lane }) => {
      if (!laneUsage[car_number]) laneUsage[car_number] = {};
      laneUsage[car_number][lane] = (laneUsage[car_number][lane] || 0) + 1;
    });
  });

  Object.entries(laneUsage).forEach(([carNumber, lanes]) => {
    const counts = Object.values(lanes);
    const max = Math.max(...counts);
    const min = Math.min(...counts);

    if (schedule.metadata.algorithm_used === "circle_method") {
      assert(max === 1 && min === 1, `Perfect balance failed for car ${carNumber}`);
    } else {
      assert(max - min <= 1, `Lane imbalance for car ${carNumber}: ${max} vs ${min}`);
    }
  });
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

## 11. Open Questions

1. **Berger Tables vs Circle Method:** For certain roster sizes, Berger Tables may give better lane distribution. Research needed.

2. **Re-run impact:** Only use final accepted time for speed matching. Confirmed.

3. **Manual rank results and speed matching:** Use rank as proxy for speed (1st place = fastest). Confirmed.

---

## 12. Implementation Phases

### Phase 1: Greedy Heuristic Only
- Works for any roster size
- No speed matching
- Validates lane balance (max difference of 1)

### Phase 2: Circle Method for Perfect Cases
- Auto-detect known solvable roster sizes
- Fall back to greedy for others

### Phase 3: Speed Matching
- Calculate average times from accepted results
- Group participants by speed tiers
- Regenerate schedule after initial round

### Phase 4: Car Removal
- Regenerate schedule for remaining participants
- Mark removed participant as incomplete in results

---

## 13. References

- `04-domain-events.md` — `HeatStaged`, `CarArrived`, `CarRemoved` events
- `06-race-day-state-machine.md` — When scheduling runs
- `08-scoring-and-leaderboard.md` — Scoring algorithm and rank-based fallback

---

**End of Heat Scheduling Algorithm v1.1**
