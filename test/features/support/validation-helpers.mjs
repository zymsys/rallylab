/**
 * validation-helpers.mjs — Lane balance checks and schedule validation utilities.
 */

/**
 * Build a 2D matrix of lane usage: { car_number: { lane: count } }
 * @param {Object} schedule
 * @returns {Object}
 */
export function buildLaneUsageMatrix(schedule) {
  const matrix = {};
  for (const heat of schedule.heats) {
    for (const { car_number, lane } of heat.lanes) {
      if (!matrix[car_number]) matrix[car_number] = {};
      matrix[car_number][lane] = (matrix[car_number][lane] || 0) + 1;
    }
  }
  return matrix;
}

/**
 * Assert lane balance within a tolerance for every participant.
 * For greedy: max - min <= 1 across all used lanes.
 * @param {Object} schedule
 * @param {number} maxDifference - Maximum allowed difference between max and min lane usage
 * @throws {Error} if any participant exceeds tolerance
 */
export function assertLaneBalanceWithin(schedule, maxDifference = 1) {
  const matrix = buildLaneUsageMatrix(schedule);
  const errors = [];

  for (const [carNumber, lanes] of Object.entries(matrix)) {
    const counts = Object.values(lanes);
    if (counts.length === 0) continue;
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min > maxDifference) {
      errors.push(
        `Car ${carNumber}: lane imbalance ${max} - ${min} = ${max - min} (max allowed: ${maxDifference})`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Lane balance violations:\n${errors.join('\n')}`);
  }
}

/**
 * Assert perfect lane balance: every participant uses each lane exactly once.
 * @param {Object} schedule
 * @param {number} laneCount
 * @throws {Error} if any participant doesn't have exactly 1 use per lane
 */
export function assertPerfectLaneBalance(schedule, laneCount) {
  const matrix = buildLaneUsageMatrix(schedule);
  const errors = [];

  for (const [carNumber, lanes] of Object.entries(matrix)) {
    for (let lane = 1; lane <= laneCount; lane++) {
      const count = lanes[lane] || 0;
      if (count !== 1) {
        errors.push(
          `Car ${carNumber}: lane ${lane} used ${count} time(s) (expected exactly 1)`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Perfect lane balance violations:\n${errors.join('\n')}`);
  }
}

/**
 * Count total heats each participant appears in.
 * @param {Object} schedule
 * @returns {Object} car_number → heat count
 */
export function countHeatsPerParticipant(schedule) {
  const counts = {};
  for (const heat of schedule.heats) {
    for (const { car_number } of heat.lanes) {
      counts[car_number] = (counts[car_number] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Verify no participant appears twice in the same heat.
 * @param {Object} schedule
 * @throws {Error} if a duplicate is found
 */
export function assertNoDuplicatesInHeat(schedule) {
  for (const heat of schedule.heats) {
    const cars = heat.lanes.map(l => l.car_number);
    const unique = new Set(cars);
    if (cars.length !== unique.size) {
      throw new Error(
        `Heat ${heat.heat_number}: duplicate car in same heat (cars: ${cars.join(', ')})`
      );
    }
  }
}

/**
 * Verify every heat has at least minCars participants.
 * @param {Object} schedule
 * @param {number} minCars
 * @throws {Error} if any heat has fewer
 */
export function assertMinCarsPerHeat(schedule, minCars = 2) {
  for (const heat of schedule.heats) {
    if (heat.lanes.length < minCars) {
      throw new Error(
        `Heat ${heat.heat_number}: only ${heat.lanes.length} car(s) (minimum: ${minCars})`
      );
    }
  }
}
