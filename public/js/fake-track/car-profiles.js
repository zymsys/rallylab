/**
 * fake-track/car-profiles.js — Persistent speed profiles for simulated cars.
 * Pure data module, no DOM. Each car gets a consistent speed personality
 * so the scheduler's speed-matching algorithm visibly kicks in.
 */

// car_number → { baseTime, variance }
const _profiles = new Map();

/**
 * Triangular distribution: most values cluster near the mode.
 * @param {number} min
 * @param {number} max
 * @param {number} mode
 * @returns {number}
 */
function triangular(min, max, mode) {
  const u = Math.random();
  const fc = (mode - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/**
 * Get or create a persistent speed profile for a car.
 * @param {number} car_number
 * @returns {{ baseTime: number, variance: number }}
 */
export function getOrCreateProfile(car_number) {
  if (_profiles.has(car_number)) {
    return _profiles.get(car_number);
  }
  const profile = {
    baseTime: Math.round(triangular(2200, 3800, 3000)),
    variance: 80 + Math.random() * 70  // 80–150ms
  };
  _profiles.set(car_number, profile);
  return profile;
}

/**
 * Compute race times for all lanes in a heat.
 * Each car's time = baseTime + gaussian noise scaled by variance.
 * @param {Array<{lane: number, car_number: number}>} lanes
 * @returns {Object} times_ms keyed by lane number string, e.g. { "1": 2845, "2": 3102 }
 */
export function computeAllRaceTimes(lanes) {
  const times_ms = {};
  for (const { lane, car_number } of lanes) {
    const profile = getOrCreateProfile(car_number);
    // Box-Muller for gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const noise = z * profile.variance;
    const time = Math.max(1800, Math.round(profile.baseTime + noise));
    times_ms[String(lane)] = time;
  }
  return times_ms;
}

/**
 * Clear all profiles (fresh start).
 */
export function resetProfiles() {
  _profiles.clear();
}
