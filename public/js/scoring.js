/**
 * scoring.js — Leaderboard computation for RallyLab.
 * Pure functions, zero DOM dependencies.
 * See specs/08-scoring-and-leaderboard.md for algorithm specification.
 */

import { compareCarNumbers } from './state-manager.js';

/**
 * Get the accepted results from a race day section.
 * The section.results map already stores latest-wins (superseded by applyEvent),
 * so we just return the values.
 * @param {Object} section - race_day section object
 * @returns {Array<Object>} Accepted results
 */
export function getAcceptedResults(section) {
  return Object.values(section.results || {});
}

/**
 * Compute the section-wide average time from all timed results.
 * Used as baseline for synthetic times from manual rankings.
 * @param {Array} acceptedResults
 * @returns {number|null} Average time in ms, or null if no timed results
 */
export function sectionAverageTime(acceptedResults) {
  let totalTime = 0;
  let count = 0;

  for (const result of acceptedResults) {
    if (result.type === 'RaceCompleted' && result.times_ms) {
      for (const time of Object.values(result.times_ms)) {
        totalTime += time;
        count++;
      }
    }
  }

  return count > 0 ? totalTime / count : null;
}

/**
 * Convert manual rankings to synthetic times for averaging.
 * @param {Array<{car_number: number, place: number}>} rankings
 * @param {number|null} avgTime - Section average time, or null
 * @returns {Object} car_number → synthetic time (ms)
 */
export function syntheticTimesFromRanking(rankings, avgTime) {
  const baseline = avgTime || 3000;
  const offsetPerPlace = 50;

  const times = {};
  for (const { place, car_number } of rankings) {
    times[car_number] = baseline + (place - 1) * offsetPerPlace;
  }
  return times;
}

/**
 * Compute leaderboard standings for a section.
 * @param {Object} section - race_day section object
 * @returns {Array<Object>} Ranked standings
 */
export function computeLeaderboard(section) {
  const acceptedResults = getAcceptedResults(section);
  const avgTime = sectionAverageTime(acceptedResults);

  // Compute scores for each participant
  const scores = {};
  const removedSet = new Set(section.removed);

  for (const p of section.participants) {
    scores[p.car_number] = {
      car_number: p.car_number,
      name: p.name,
      group_id: p.group_id || null,
      times: [],
      heats_run: 0,
      removed: removedSet.has(p.car_number)
    };
  }

  for (const result of acceptedResults) {
    // Effective lanes: lane_corrections override result.lanes
    const heatLanes = (section.lane_corrections && section.lane_corrections[result.heat_number])
      || result.lanes;
    if (!heatLanes || heatLanes.length === 0) continue;

    if (result.type === 'RaceCompleted' && result.times_ms) {
      for (const assignment of heatLanes) {
        const laneKey = String(assignment.lane);
        const time = result.times_ms[laneKey];
        if (time !== undefined && scores[assignment.car_number]) {
          scores[assignment.car_number].times.push(time);
          scores[assignment.car_number].heats_run++;
        }
      }
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      const synth = syntheticTimesFromRanking(result.rankings, avgTime);
      for (const { car_number } of result.rankings) {
        if (scores[car_number] && synth[car_number] !== undefined) {
          scores[car_number].times.push(synth[car_number]);
          scores[car_number].heats_run++;
        }
      }
    }
  }

  // Determine expected heats (max heats_run among non-removed participants)
  const expectedHeats = Math.max(
    0,
    ...Object.values(scores)
      .filter(s => !s.removed)
      .map(s => s.heats_run)
  );

  // Rank participants (include removed cars — they keep their prior results, marked incomplete)
  const entries = Object.values(scores)
    .filter(s => s.heats_run > 0);

  // Separate complete and incomplete (removed cars are always incomplete)
  const complete = entries.filter(s => s.heats_run >= expectedHeats && !s.removed);
  const incomplete = entries.filter(s => s.heats_run < expectedHeats || s.removed);

  // Sort each group by avg time, then best single heat
  const sortByTime = (a, b) => {
    const avgA = averageTime(a.times);
    const avgB = averageTime(b.times);
    if (avgA !== avgB) return avgA - avgB;

    const bestA = a.times.length > 0 ? Math.min(...a.times) : Infinity;
    const bestB = b.times.length > 0 ? Math.min(...b.times) : Infinity;
    return bestA - bestB;
  };

  complete.sort(sortByTime);
  incomplete.sort(sortByTime);

  // Assign ranks
  let rank = 1;
  const standings = [];

  for (const entry of complete) {
    standings.push({
      rank: rank++,
      car_number: entry.car_number,
      name: entry.name,
      group_id: entry.group_id,
      avg_time_ms: Math.round(averageTime(entry.times)),
      best_time_ms: entry.times.length > 0 ? Math.round(Math.min(...entry.times)) : null,
      heats_run: entry.heats_run,
      incomplete: false
    });
  }

  for (const entry of incomplete) {
    standings.push({
      rank: rank++,
      car_number: entry.car_number,
      name: entry.name,
      group_id: entry.group_id,
      avg_time_ms: entry.times.length > 0 ? Math.round(averageTime(entry.times)) : null,
      best_time_ms: entry.times.length > 0 ? Math.round(Math.min(...entry.times)) : null,
      heats_run: entry.heats_run,
      incomplete: true
    });
  }

  return standings;
}

/**
 * Compute per-lane statistics from all timed results in a section.
 * @param {Object} section - race_day section object
 * @returns {Array<{lane: number, avg_time_ms: number, race_count: number}>} Sorted by lane number
 */
export function computeLaneStats(section) {
  const lanes = {}; // lane → { total_ms, count }

  for (const result of Object.values(section.results || {})) {
    if (result.type !== 'RaceCompleted' || !result.times_ms) continue;
    for (const [laneKey, time] of Object.entries(result.times_ms)) {
      const lane = Number(laneKey);
      if (!lanes[lane]) lanes[lane] = { total_ms: 0, count: 0 };
      lanes[lane].total_ms += time;
      lanes[lane].count++;
    }
  }

  return Object.entries(lanes)
    .map(([lane, { total_ms, count }]) => ({
      lane: Number(lane),
      avg_time_ms: Math.round(total_ms / count),
      race_count: count
    }))
    .sort((a, b) => a.lane - b.lane);
}

/**
 * Compute per-car, per-lane time matrix from all timed results in a section.
 * @param {Object} section - race_day section object
 * @returns {Array<{car_number: number, name: string, lane_times: Object<number, number>, avg_time_ms: number|null, best_time_ms: number|null, heats_run: number}>}
 *   Sorted by car_number. lane_times maps lane → time_ms (only timed results).
 */
export function computeCarStats(section) {
  const cars = {};
  const removedSet = new Set(section.removed);

  for (const p of section.participants) {
    cars[p.car_number] = {
      car_number: p.car_number,
      name: p.name,
      lane_times: {},   // lane → time_ms
      all_times: [],
      heats_run: 0,
      removed: removedSet.has(p.car_number)
    };
  }

  for (const result of Object.values(section.results || {})) {
    const heatLanes = (section.lane_corrections && section.lane_corrections[result.heat_number])
      || result.lanes;
    if (!heatLanes || heatLanes.length === 0) continue;

    if (result.type === 'RaceCompleted' && result.times_ms) {
      for (const assignment of heatLanes) {
        const laneKey = String(assignment.lane);
        const time = result.times_ms[laneKey];
        if (time !== undefined && cars[assignment.car_number]) {
          const car = cars[assignment.car_number];
          car.lane_times[assignment.lane] = time;
          car.all_times.push(time);
          car.heats_run++;
        }
      }
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      for (const { car_number } of result.rankings) {
        if (cars[car_number]) cars[car_number].heats_run++;
      }
    }
  }

  return Object.values(cars)
    .filter(c => c.heats_run > 0)
    .map(c => ({
      car_number: c.car_number,
      name: c.name,
      lane_times: c.lane_times,
      avg_time_ms: c.all_times.length > 0 ? Math.round(averageTime(c.all_times)) : null,
      best_time_ms: c.all_times.length > 0 ? Math.round(Math.min(...c.all_times)) : null,
      heats_run: c.heats_run,
      removed: c.removed
    }))
    .sort((a, b) => compareCarNumbers(a.car_number, b.car_number));
}

/**
 * @param {Array<number>} times
 * @returns {number}
 */
function averageTime(times) {
  if (times.length === 0) return Infinity;
  return times.reduce((sum, t) => sum + t, 0) / times.length;
}
