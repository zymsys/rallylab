/**
 * track-connection.js — Track controller connection (mock mode).
 * Simulates race results with random times for demo/testing.
 * See specs/03-track-controller-protocol.md for real protocol.
 */

const USE_MOCK = true;

let _connected = false;
let _laneCount = 6;

/**
 * Connect to the track controller.
 * Mock: instantly succeeds with 6 lanes.
 * @returns {Promise<{lane_count: number}>}
 */
export async function connect() {
  if (USE_MOCK) {
    _connected = true;
    _laneCount = 6;
    return { lane_count: _laneCount };
  }
  throw new Error('Real track connection not implemented');
}

/**
 * Get track info.
 * @returns {{lane_count: number}}
 */
export function getInfo() {
  return { lane_count: _laneCount };
}

/**
 * Check if connected.
 * @returns {boolean}
 */
export function isConnected() {
  return _connected;
}

/**
 * Disconnect from the track controller.
 */
export function disconnect() {
  _connected = false;
}

/**
 * Wait for a race to complete. Returns times per lane.
 * Mock: random delay 2-5s, random times 2000-4000ms per lane.
 * @param {Array<{lane: number, car_number: number}>} lanes - Lane assignments
 * @param {AbortSignal} [signal] - Optional cancellation signal
 * @returns {Promise<Object>} times_ms keyed by lane number string
 */
export async function waitForRace(lanes, signal) {
  if (USE_MOCK) {
    const delay = 2000 + Math.random() * 3000;
    await cancellableDelay(delay, signal);

    const times_ms = {};
    for (const { lane } of lanes) {
      times_ms[String(lane)] = Math.round(2000 + Math.random() * 2000);
    }
    return times_ms;
  }
  throw new Error('Real track connection not implemented');
}

/**
 * Wait for the gate to be ready for the next race.
 * Mock: random delay 1-3s.
 * @param {AbortSignal} [signal] - Optional cancellation signal
 * @returns {Promise<void>}
 */
export async function waitForGate(signal) {
  if (USE_MOCK) {
    const delay = 1000 + Math.random() * 2000;
    await cancellableDelay(delay, signal);
    return;
  }
  throw new Error('Real track connection not implemented');
}

/**
 * Cancellable delay using AbortSignal.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function cancellableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}
