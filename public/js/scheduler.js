/**
 * scheduler.js — Heat scheduling algorithm for RallyLab.
 * Pure functions, zero DOM/IndexedDB dependencies.
 * Deterministic: same input always produces same schedule.
 *
 * See specs/07-heat-scheduling.md for algorithm specification.
 */

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Generate a complete heat schedule for a section.
 * @param {Object} params
 * @param {Array<{car_number: number, name: string}>} params.participants
 * @param {Array<number>} params.available_lanes - Physical lane numbers (e.g. [1,2,3,4,5,6] or [1,3,5])
 * @param {Array} [params.results=[]]
 * @param {Object} [params.options={}]
 * @returns {{heats: Array, metadata: Object}}
 */
export function generateSchedule({ participants, available_lanes, results = [], options = {} }) {
  if (!participants || participants.length < 2) {
    throw new Error('Cannot generate schedule: at least 2 participants required');
  }

  const laneCount = available_lanes.length;
  const algorithm = selectAlgorithm(participants.length, laneCount, results, options);
  let heats;
  let speedMatched = false;

  if (algorithm === 'circle_method') {
    heats = circleMethod(participants, available_lanes);
  } else if (algorithm === 'speed_matched_greedy') {
    const groups = groupBySpeed(participants, results, laneCount);
    heats = greedyHeuristic(participants, available_lanes, groups);
    speedMatched = true;
  } else {
    heats = greedyHeuristic(participants, available_lanes);
  }

  const laneBalancePerfect = algorithm === 'circle_method';

  return {
    heats,
    metadata: {
      algorithm_used: algorithm,
      total_heats: heats.length,
      cars_per_heat: heats.map(h => h.lanes.length),
      lane_balance_perfect: laneBalancePerfect,
      speed_matched: speedMatched,
      available_lanes
    }
  };
}

/**
 * Regenerate schedule after a car is removed mid-event.
 * Preserves completed heats, regenerates remaining.
 * @param {Object} schedule - Current schedule
 * @param {Array} remainingParticipants - Participants still racing
 * @param {number} currentHeatNumber - Last completed heat
 * @param {Array<number>} availableLanes - Physical lane numbers
 * @param {Array} [results=[]]
 * @returns {Object} Updated schedule
 */
export function regenerateAfterRemoval(schedule, remainingParticipants, currentHeatNumber, availableLanes, results = []) {
  if (remainingParticipants.length < 2) {
    throw new Error('Cannot generate schedule: at least 2 participants required');
  }

  const completedHeats = schedule.heats.filter(h => h.heat_number <= currentHeatNumber);
  const newSchedule = generateSchedule({
    participants: remainingParticipants,
    available_lanes: availableLanes,
    results,
    options: {}
  });

  // Renumber new heats to continue after completed heats
  const renumberedHeats = newSchedule.heats.map((heat, i) => ({
    ...heat,
    heat_number: currentHeatNumber + i + 1
  }));

  return {
    heats: [...completedHeats, ...renumberedHeats],
    metadata: {
      ...newSchedule.metadata,
      total_heats: completedHeats.length + renumberedHeats.length
    }
  };
}

/**
 * Regenerate schedule after a late arrival.
 * Preserves completed heats, regenerates remaining with new participant.
 * @param {Object} schedule - Current schedule
 * @param {Array} allParticipants - All participants including new arrival
 * @param {number} currentHeatNumber - Last completed heat
 * @param {Array<number>} availableLanes - Physical lane numbers
 * @param {Array} [results=[]]
 * @returns {Object} Updated schedule
 */
export function regenerateAfterLateArrival(schedule, allParticipants, currentHeatNumber, availableLanes, results = []) {
  const completedHeats = schedule.heats.filter(h => h.heat_number <= currentHeatNumber);
  const newSchedule = generateSchedule({
    participants: allParticipants,
    available_lanes: availableLanes,
    results,
    options: {}
  });

  const renumberedHeats = newSchedule.heats.map((heat, i) => ({
    ...heat,
    heat_number: currentHeatNumber + i + 1
  }));

  return {
    heats: [...completedHeats, ...renumberedHeats],
    metadata: {
      ...newSchedule.metadata,
      total_heats: completedHeats.length + renumberedHeats.length
    }
  };
}

/**
 * Generate solo catch-up heats for a late participant.
 * Each heat puts the participant alone in a different lane, cycling through available lanes.
 * @param {Object} participant - { car_number, name }
 * @param {number} catchUpCount - Number of catch-up heats needed
 * @param {Array<number>} availableLanes - Physical lane numbers
 * @param {number} startHeatNumber - First heat number to use
 * @returns {Array} Array of catch-up heat objects with catch_up: true
 */
export function generateCatchUpHeats(participant, catchUpCount, availableLanes, startHeatNumber) {
  const heats = [];
  for (let i = 0; i < catchUpCount; i++) {
    const lane = availableLanes[i % availableLanes.length];
    heats.push({
      heat_number: startHeatNumber + i,
      catch_up: true,
      lanes: [{
        lane,
        car_number: participant.car_number,
        name: participant.name
      }]
    });
  }
  return heats;
}

// ─── Algorithm Selection ─────────────────────────────────────────────

/**
 * Select the best algorithm based on participant count, lane count, and results.
 * @param {number} participantCount
 * @param {number} laneCount
 * @param {Array} results
 * @param {Object} [options={}]
 * @returns {'circle_method'|'greedy_heuristic'|'speed_matched_greedy'}
 */
export function selectAlgorithm(participantCount, laneCount, results, options = {}) {
  const hasResults = results && results.length > 0;
  const speedMatchingEnabled = options.speed_matching !== false;

  if (!hasResults && isKnownSolvable(participantCount, laneCount)) {
    return 'circle_method';
  }

  if (hasResults && speedMatchingEnabled) {
    return 'speed_matched_greedy';
  }

  return 'greedy_heuristic';
}

/**
 * Check if a roster size is known solvable for perfect lane balance.
 * @param {number} N - Number of participants
 * @param {number} L - Number of lanes
 * @returns {boolean}
 */
export function isKnownSolvable(N, L) {
  const knownSolvable = [6, 7, 8, 12, 16, 18, 24, 32];

  if (knownSolvable.includes(N)) return true;
  if (isPowerOfTwo(N)) return true;
  if (N === L || N === L + 1) return true;

  return false;
}

// ─── Circle Method ───────────────────────────────────────────────────

/**
 * Circle Method algorithm for perfect lane balance.
 * Uses a cyclic construction: in heat h, lane l gets participant (h + l) mod N.
 * This guarantees every participant runs each lane exactly once.
 * @param {Array<{car_number: number, name: string}>} participants
 * @param {Array<number>} availableLanes - Physical lane numbers
 * @returns {Array} heats
 */
export function circleMethod(participants, availableLanes) {
  const N = participants.length;
  const L = Math.min(availableLanes.length, N);
  const heats = [];

  for (let h = 0; h < N; h++) {
    const lanes = [];
    for (let l = 0; l < L; l++) {
      const idx = (h + l) % N;
      lanes.push({
        lane: availableLanes[l],
        car_number: participants[idx].car_number,
        name: participants[idx].name
      });
    }
    heats.push({ heat_number: h + 1, lanes });
  }

  return heats;
}

// ─── Greedy Heuristic ────────────────────────────────────────────────

/**
 * Greedy heuristic algorithm for lane-balanced scheduling.
 * Guarantees max(lane_usage) - min(lane_usage) <= 1 per participant.
 * @param {Array<{car_number: number, name: string}>} participants
 * @param {Array<number>} availableLanes - Physical lane numbers
 * @param {Array<Array>} [speedGroups=null] - Optional speed tier groupings
 * @returns {Array} heats
 */
export function greedyHeuristic(participants, availableLanes, speedGroups = null) {
  const N = participants.length;
  const L = availableLanes.length;
  const effectiveLanes = availableLanes.slice(0, Math.min(L, N));
  const targetHeats = N;

  // Track lane usage per participant: { car_number: { lane: count } }
  const laneUsage = {};
  for (const p of participants) {
    laneUsage[p.car_number] = {};
    for (const lane of effectiveLanes) {
      laneUsage[p.car_number][lane] = 0;
    }
  }

  // Track total heats run per participant
  const heatsRun = {};
  for (const p of participants) {
    heatsRun[p.car_number] = 0;
  }

  const heats = [];

  if (speedGroups) {
    // Schedule within speed tiers
    for (const group of speedGroups) {
      const groupEffectiveLanes = availableLanes.slice(0, Math.min(L, group.length));
      const groupTargetHeats = group.length;
      const groupLaneUsage = {};
      const groupHeatsRun = {};
      for (const p of group) {
        groupLaneUsage[p.car_number] = {};
        for (const lane of groupEffectiveLanes) {
          groupLaneUsage[p.car_number][lane] = 0;
        }
        groupHeatsRun[p.car_number] = 0;
      }

      for (let h = 0; h < groupTargetHeats; h++) {
        const cars = selectCarsForHeat(group, groupHeatsRun, groupEffectiveLanes.length);
        if (cars.length < 2) continue;

        const heatLanes = assignLanesBalanced(cars, groupLaneUsage, groupEffectiveLanes);
        for (const entry of heatLanes) {
          groupLaneUsage[entry.car_number][entry.lane]++;
          groupHeatsRun[entry.car_number]++;
        }

        heatLanes.sort((a, b) => a.lane - b.lane);
        heats.push({ heat_number: heats.length + 1, lanes: heatLanes });
      }
    }
  } else {
    // No speed groups: schedule all participants together
    for (let heatNum = 1; heatNum <= targetHeats; heatNum++) {
      const cars = selectCarsForHeat(participants, heatsRun, effectiveLanes.length);
      if (cars.length < 2) continue;

      const heatLanes = assignLanesBalanced(cars, laneUsage, effectiveLanes);
      for (const entry of heatLanes) {
        laneUsage[entry.car_number][entry.lane]++;
        heatsRun[entry.car_number]++;
      }

      heatLanes.sort((a, b) => a.lane - b.lane);
      heats.push({ heat_number: heatNum, lanes: heatLanes });
    }
  }

  return heats;
}

/**
 * Select cars for a heat. Picks participants needing the most races.
 * @param {Array} participants
 * @param {Object} heatsRun - car_number → count
 * @param {number} maxCars - Maximum cars in this heat (= effective lane count)
 * @returns {Array} Selected participants
 */
function selectCarsForHeat(participants, heatsRun, maxCars) {
  // Sort by: fewest heats run first, then by car_number for determinism
  const sorted = [...participants].sort((a, b) => {
    const diff = (heatsRun[a.car_number] || 0) - (heatsRun[b.car_number] || 0);
    if (diff !== 0) return diff;
    return a.car_number - b.car_number;
  });

  return sorted.slice(0, maxCars);
}

/**
 * Assign cars to lanes optimally, minimizing lane imbalance.
 * Uses backtracking search with pruning — fast for typical lane counts (≤ 8).
 * @param {Array} cars - Selected participants for this heat
 * @param {Object} laneUsage - { car_number: { lane: count } }
 * @param {Array<number>} effectiveLanes - Physical lane numbers to use
 * @returns {Array<{lane: number, car_number: number, name: string}>}
 */
function assignLanesBalanced(cars, laneUsage, effectiveLanes) {
  const n = cars.length;
  const bestAssignment = new Array(n).fill(effectiveLanes[0]);
  let bestScore = Infinity;

  /**
   * Compute imbalance score: max over all cars of (max_usage - min_usage)
   * after applying the given assignment.
   */
  function computeScore(assignment) {
    let maxImbalance = 0;
    for (let i = 0; i < n; i++) {
      const cn = cars[i].car_number;
      let maxU = 0, minU = Infinity;
      for (const l of effectiveLanes) {
        let u = laneUsage[cn][l] || 0;
        if (l === assignment[i]) u++;
        if (u > maxU) maxU = u;
        if (u < minU) minU = u;
      }
      const imbalance = maxU - minU;
      if (imbalance > maxImbalance) maxImbalance = imbalance;
    }
    return maxImbalance;
  }

  function search(idx, used, current) {
    if (idx === n) {
      const s = computeScore(current);
      if (s < bestScore) {
        bestScore = s;
        for (let i = 0; i < n; i++) bestAssignment[i] = current[i];
      }
      return;
    }

    // Early pruning: compute partial score for already-assigned cars
    if (idx > 0) {
      let partialMax = 0;
      for (let i = 0; i < idx; i++) {
        const cn = cars[i].car_number;
        let maxU = 0, minU = Infinity;
        for (const l of effectiveLanes) {
          let u = laneUsage[cn][l] || 0;
          if (l === current[i]) u++;
          if (u > maxU) maxU = u;
          if (u < minU) minU = u;
        }
        partialMax = Math.max(partialMax, maxU - minU);
      }
      if (partialMax >= bestScore) return;
    }

    for (const lane of effectiveLanes) {
      if (used.has(lane)) continue;
      current[idx] = lane;
      used.add(lane);
      search(idx + 1, used, current);
      used.delete(lane);
    }
  }

  search(0, new Set(), new Array(n));

  return cars.map((car, i) => ({
    lane: bestAssignment[i],
    car_number: car.car_number,
    name: car.name
  }));
}

// ─── Speed Matching ──────────────────────────────────────────────────

/**
 * Calculate average times for each participant from accepted results.
 * Uses the latest result per heat (superseded results excluded).
 * For ResultManuallyEntered, uses rank as a speed proxy.
 * @param {Array} participants
 * @param {Array} results - RaceCompleted and ResultManuallyEntered events
 * @returns {Object} car_number → average time (ms), Infinity if no data
 */
export function calculateAverageTimes(participants, results) {
  // Find the accepted (latest by timestamp) result for each heat
  const acceptedByHeat = {};
  for (const r of results) {
    const heat = r.heat;
    if (!acceptedByHeat[heat] || r.timestamp > acceptedByHeat[heat].timestamp) {
      acceptedByHeat[heat] = r;
    }
  }

  const totalTimes = {};
  const counts = {};
  for (const p of participants) {
    totalTimes[p.car_number] = 0;
    counts[p.car_number] = 0;
  }

  for (const result of Object.values(acceptedByHeat)) {
    if (result.type === 'RaceCompleted' && result.times_ms) {
      // We need to map lane → car_number from the schedule
      // But results contain times_ms keyed by lane string
      // The schedule's HeatStaged tells us which car is in which lane
      // For the scheduler, we receive results with lane-keyed times
      // and need to cross-reference with the heat's lane assignments
      // Since we don't have the full schedule context here, results
      // should include a lanes array or we derive car from heat staging
      //
      // For now, results include heat + times_ms keyed by lane.
      // The caller is expected to provide results that include
      // a `lanes` mapping or the times_ms directly maps to car times.
      // We'll handle this via the lanes field on the result if present.
      if (result.lanes) {
        for (const [laneStr, timeMs] of Object.entries(result.times_ms)) {
          const laneIdx = parseInt(laneStr, 10) - 1;
          const car = result.lanes[laneIdx];
          if (car && car.car_number != null && totalTimes[car.car_number] !== undefined) {
            totalTimes[car.car_number] += timeMs;
            counts[car.car_number]++;
          }
        }
      }
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      // Use rank as speed proxy: smaller rank = faster
      // Convert to pseudo-time: rank * 1000 (so 1st=1000, 2nd=2000, etc.)
      for (const { car_number, place } of result.rankings) {
        if (totalTimes[car_number] !== undefined) {
          totalTimes[car_number] += place * 1000;
          counts[car_number]++;
        }
      }
    }
  }

  const averages = {};
  for (const p of participants) {
    averages[p.car_number] = counts[p.car_number] > 0
      ? totalTimes[p.car_number] / counts[p.car_number]
      : Infinity;
  }

  return averages;
}

/**
 * Group participants into speed tiers based on results.
 * @param {Array} participants
 * @param {Array} results
 * @param {number} laneCount - Group size equals lane count
 * @returns {Array<Array>} Speed tier groups (fastest first)
 */
export function groupBySpeed(participants, results, laneCount) {
  const averages = calculateAverageTimes(participants, results);

  const sorted = [...participants].sort((a, b) => {
    const diff = averages[a.car_number] - averages[b.car_number];
    if (diff !== 0) return diff;
    return a.car_number - b.car_number;
  });

  const groups = [];
  for (let i = 0; i < sorted.length; i += laneCount) {
    groups.push(sorted.slice(i, i + laneCount));
  }

  return groups;
}

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Validate lane balance of a generated schedule.
 * @param {Object} schedule - Schedule with heats and metadata
 * @returns {{valid: boolean, errors: Array<string>}}
 */
export function validateLaneBalance(schedule) {
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
    if (counts.length === 0) continue;
    const max = Math.max(...counts);
    const min = Math.min(...counts);

    if (max - min > maxDiff) {
      errors.push(
        `Car ${carNumber}: lane imbalance ${max} - ${min} = ${max - min}` +
        (isPerfect ? ' (expected perfect balance)' : ` (max allowed: ${maxDiff})`)
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * @param {number} n
 * @returns {boolean}
 */
function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}
