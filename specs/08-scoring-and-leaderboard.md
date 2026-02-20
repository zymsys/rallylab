# RallyLab — Scoring and Leaderboard

**Version:** 1.0
**Status:** Specification

---

## 1. Overview

Scoring determines participant rankings within a Section based on race results. All scoring state is **derived** — computed from the event log, never stored as events. Rankings are recomputed on every state rebuild.

### 1.1 Core Principle

**Average time across all accepted heats.** Lower average = higher rank.

---

## 2. Accepted Results

Before scoring, determine which result is accepted for each heat:

1. For each heat number, find all `RaceCompleted` and `ResultManuallyEntered` events
2. The latest event (by timestamp) for a given heat is the accepted result
3. Earlier results for the same heat are marked superseded and excluded from scoring
4. `RerunDeclared` events do not produce results — they signal intent; the subsequent `RaceCompleted` produces the actual result

```javascript
function getAcceptedResults(events) {
  const byHeat = {};

  for (const event of events) {
    if (event.type === 'RaceCompleted' || event.type === 'ResultManuallyEntered') {
      const heat = event.payload.heat;
      if (!byHeat[heat] || event.timestamp > byHeat[heat].timestamp) {
        byHeat[heat] = event;
      }
    }
  }

  return Object.values(byHeat);
}
```

---

## 3. Scoring Algorithm

### 3.1 Timed Results (`RaceCompleted`)

For each participant, collect their finish time from every accepted heat they participated in:

```javascript
function computeScores(participants, acceptedResults, heatSchedule) {
  const scores = {};

  participants.forEach(p => {
    scores[p.car_number] = {
      car_number: p.car_number,
      name: p.name,
      times: [],        // individual heat times (ms)
      heats_run: 0,
      total_heats: 0,   // expected heats from schedule
      removed: false
    };
  });

  for (const result of acceptedResults) {
    if (result.type === 'RaceCompleted') {
      // Map lane times to car numbers using heat schedule
      const heatLanes = heatSchedule[result.payload.heat];
      if (!heatLanes) continue;

      for (const assignment of heatLanes) {
        const laneKey = String(assignment.lane);
        const time = result.payload.times_ms[laneKey];
        if (time !== undefined && scores[assignment.car_number]) {
          scores[assignment.car_number].times.push(time);
          scores[assignment.car_number].heats_run++;
        }
      }
    }
  }

  return scores;
}
```

### 3.2 Average Time

```javascript
function averageTime(times) {
  if (times.length === 0) return Infinity;
  return times.reduce((sum, t) => sum + t, 0) / times.length;
}
```

### 3.3 Manual Results (`ResultManuallyEntered`) — Rank-Based Fallback

When a heat has only rank data (no times), convert ranks to synthetic times for averaging:

**Algorithm:**
1. Find the average finish time across all timed heats in the Section
2. Apply a fixed offset per rank position

```javascript
function syntheticTimesFromRanking(rankings, sectionAverageTime) {
  // If no timed heats exist at all, use a default baseline
  const baseline = sectionAverageTime || 3000; // 3 seconds default
  const offsetPerPlace = 50; // 50ms gap between places

  const times = {};
  for (const { place, car_number } of rankings) {
    // 1st place gets baseline, 2nd gets baseline + 50, etc.
    times[car_number] = baseline + (place - 1) * offsetPerPlace;
  }

  return times;
}
```

**Rationale:** This preserves relative ordering from manual ranking while producing values that blend reasonably with real times. The 50ms offset is large enough to maintain rank order but small enough not to dominate averages.

**When all heats are manual:** Rankings are determined purely by average synthetic time, which preserves the manually-assigned ordering.

---

## 4. Ranking

### 4.1 Primary Sort: Average Time (ascending)

```javascript
function rankParticipants(scores) {
  const ranked = Object.values(scores)
    .filter(s => !s.removed || s.heats_run > 0)  // include removed with partial results
    .sort((a, b) => {
      const avgA = averageTime(a.times);
      const avgB = averageTime(b.times);

      if (avgA !== avgB) return avgA - avgB;  // lower time = higher rank

      // Tie-break: best single heat time
      const bestA = Math.min(...a.times);
      const bestB = Math.min(...b.times);
      return bestA - bestB;
    });

  // Assign ranks
  return ranked.map((entry, index) => ({
    rank: index + 1,
    ...entry,
    avg_time_ms: Math.round(averageTime(entry.times))
  }));
}
```

### 4.2 Tie-Breaking

1. **Average time** (primary)
2. **Best single heat time** (secondary) — the fastest individual heat
3. **If still tied:** Same rank assigned to both participants

### 4.3 Incomplete Participants (Removed Cars)

Participants removed mid-rally (`CarRemoved`):
- Their completed heats are scored normally
- They are ranked **below** all participants who completed the full schedule
- Marked with `incomplete: true` in the leaderboard
- Sorted among themselves by average time of completed heats

```javascript
function separateCompleteAndIncomplete(rankings, expectedHeats) {
  const complete = rankings.filter(r => r.heats_run >= expectedHeats);
  const incomplete = rankings.filter(r => r.heats_run < expectedHeats)
    .map(r => ({ ...r, incomplete: true }));

  // Re-rank: complete first, then incomplete
  let rank = 1;
  const final = [];

  for (const entry of complete) {
    final.push({ ...entry, rank: rank++ });
  }
  for (const entry of incomplete) {
    final.push({ ...entry, rank: rank++ });
  }

  return final;
}
```

---

## 5. Leaderboard

### 5.1 Per-Section Leaderboard

Each Section has its own independent leaderboard. No cross-Section rankings in v1.

### 5.2 Leaderboard Data Structure

```javascript
{
  section_id: "uuid",
  section_name: "Cubs",
  standings: [
    {
      rank: 1,
      car_number: 17,
      name: "Sarah",
      avg_time_ms: 2205,
      best_time_ms: 2150,
      heats_run: 12,
      incomplete: false
    },
    {
      rank: 2,
      car_number: 42,
      name: "Billy",
      avg_time_ms: 2340,
      best_time_ms: 2280,
      heats_run: 12,
      incomplete: false
    },
    // ...
    {
      rank: 11,
      car_number: 7,
      name: "Tommy",
      avg_time_ms: 2450,
      best_time_ms: 2400,
      heats_run: 5,
      incomplete: true  // removed at heat 5
    }
  ]
}
```

### 5.3 Audience Display

The Audience Display shows leaderboard data in two contexts:

1. **After each heat:** Top N standings (brief display before next staging)
2. **Section complete:** Full final standings

The leaderboard message to the Audience Display via BroadcastChannel:

```javascript
{
  type: 'SHOW_LEADERBOARD',
  section_name: 'Cubs',
  standings: [ /* ranked entries */ ]
}
```

See `02-architecture.md` for the full BroadcastChannel message contract.

---

## 6. Section Average Time

The Section average time is used for:
- Synthetic time generation from manual rankings (Section 3.3)
- Speed matching in heat scheduling (see `07-heat-scheduling.md`)

```javascript
function sectionAverageTime(acceptedResults) {
  let totalTime = 0;
  let count = 0;

  for (const result of acceptedResults) {
    if (result.type === 'RaceCompleted' && result.payload.times_ms) {
      for (const time of Object.values(result.payload.times_ms)) {
        totalTime += time;
        count++;
      }
    }
  }

  return count > 0 ? totalTime / count : null;
}
```

---

## 7. Edge Cases

### 7.1 No Timed Results

If all heats are manually ranked (complete hardware failure), scoring uses synthetic times throughout. Rankings follow manual placements.

### 7.2 Mixed Timed and Manual

Some heats timed, others manual. Synthetic times blend with real times in the average. The 50ms offset between manual places keeps rankings reasonable.

### 7.3 Participant with Zero Heats

A participant who checked in (`CarArrived`) but was removed (`CarRemoved`) before any heat: ranked last with `heats_run: 0`.

### 7.4 Single Heat

Average time = the only time. Tie-breaking by best time is equivalent.

---

## 8. Implementation Notes

- Scoring is **always recomputed** from the event log — never cached as an event
- Recomputation is fast (~1ms for typical event sizes)
- The leaderboard updates after every `RaceCompleted`, `ResultManuallyEntered`, or `CarRemoved` event

---

## 9. References

- `04-domain-events.md` — `RaceCompleted`, `ResultManuallyEntered`, `RerunDeclared`, `CarRemoved` events
- `06-race-day-state-machine.md` — When leaderboard is displayed
- `07-heat-scheduling.md` — Speed matching uses scoring data

---

**End of Scoring and Leaderboard v1.0**
