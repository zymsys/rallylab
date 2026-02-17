/**
 * track-connection.js — Track controller connection.
 * Supports two modes:
 *   1. Fake Track (BroadcastChannel) — if fake-track.html is open, gate/reset drive the flow
 *   2. Manual fallback — operator clicks buttons in the UI to advance
 * See specs/03-track-controller-protocol.md for real protocol.
 */

const TRACK_CHANNEL = 'rallylab-track';
const RESPONSE_TIMEOUT = 30000; // 30s fallback timeout

let _connected = false;
let _laneCount = 6;
let _trackChannel = null;
let _useFakeTrack = false;
let _messageHandler = null;
let _requestId = 0;

// Manual fallback resolvers (when no fake track)
let _manualRaceResolver = null;
let _manualGateResolver = null;

// ─── Channel Setup ──────────────────────────────────────────────

function ensureChannel() {
  if (_trackChannel) return;
  _trackChannel = new BroadcastChannel(TRACK_CHANNEL);
  _trackChannel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'TRACK_HELLO') {
      _useFakeTrack = true;
    }
    if (_messageHandler) {
      _messageHandler(msg);
    }
  };
}

/**
 * Wait for a response from the fake track with timeout fallback.
 * @param {string} requestId
 * @param {string} expectedType
 * @param {AbortSignal} [signal]
 * @param {number} [timeout] - ms before fallback; 0 = no timeout (rely on signal)
 * @returns {Promise<Object>}
 */
function waitForResponse(requestId, expectedType, signal, timeout = RESPONSE_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = timeout > 0 ? setTimeout(() => {
      cleanup();
      console.warn(`Fake track timeout waiting for ${expectedType}, falling back`);
      resolve(null); // null signals fallback
    }, timeout) : null;

    function onMessage(msg) {
      if (msg.type === expectedType && msg.requestId === requestId) {
        cleanup();
        resolve(msg);
      }
    }

    function onAbort() {
      cleanup();
      _trackChannel.postMessage({ type: 'CANCEL', requestId });
      reject(new DOMException('Aborted', 'AbortError'));
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      _messageHandler = null;
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    _messageHandler = onMessage;
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Whether the fake track is connected.
 * @returns {boolean}
 */
export function isUsingFakeTrack() {
  return _useFakeTrack;
}

/**
 * Connect to the track controller.
 * @returns {Promise<{lane_count: number}>}
 */
export async function connect() {
  ensureChannel();

  // Give fake track a moment to respond with TRACK_HELLO
  if (!_useFakeTrack) {
    _trackChannel.postMessage({ type: 'PING' });
    await new Promise(r => setTimeout(r, 300));
  }

  if (_useFakeTrack) {
    const rid = String(++_requestId);
    _trackChannel.postMessage({ type: 'CONNECT', requestId: rid });
    const resp = await waitForResponse(rid, 'CONNECTED', null);
    if (resp) {
      _connected = true;
      _laneCount = resp.lane_count || 6;
      return { lane_count: _laneCount };
    }
  }

  // Fallback: mock mode
  _connected = true;
  _laneCount = 6;
  return { lane_count: _laneCount };
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
 * Fake track: posts STAGE_RACE, awaits RACE_COMPLETE (blocks on gate click).
 * No fake track: blocks until operator calls triggerManualRace().
 * @param {Array<{lane: number, car_number: number}>} lanes
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>} times_ms keyed by lane number string
 */
export async function waitForRace(lanes, signal) {
  ensureChannel();

  if (_useFakeTrack) {
    const rid = String(++_requestId);
    _trackChannel.postMessage({ type: 'STAGE_RACE', requestId: rid, lanes });
    const resp = await waitForResponse(rid, 'RACE_COMPLETE', signal, 0);
    if (resp && resp.times_ms) {
      return resp.times_ms;
    }
  }

  // Manual fallback: block until operator triggers
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    _manualRaceResolver = (times_ms) => {
      _manualRaceResolver = null;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(times_ms);
    };

    function onAbort() {
      _manualRaceResolver = null;
      reject(new DOMException('Aborted', 'AbortError'));
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wait for the gate to be ready for the next race.
 * Fake track: posts WAIT_GATE, awaits GATE_READY (blocks on reset click).
 * No fake track: blocks until operator calls triggerManualGate().
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function waitForGate(signal) {
  ensureChannel();

  if (_useFakeTrack) {
    const rid = String(++_requestId);
    _trackChannel.postMessage({ type: 'WAIT_GATE', requestId: rid });
    const resp = await waitForResponse(rid, 'GATE_READY', signal, 0);
    if (resp) return;
  }

  // Manual fallback: block until operator triggers
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    _manualGateResolver = () => {
      _manualGateResolver = null;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };

    function onAbort() {
      _manualGateResolver = null;
      reject(new DOMException('Aborted', 'AbortError'));
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Manual trigger: resolve a pending waitForRace with random times.
 * Called by operator UI "Run Heat" button when no fake track.
 * @param {Array<{lane: number}>} lanes
 */
export function triggerManualRace(lanes) {
  if (!_manualRaceResolver) return;
  const times_ms = {};
  for (const { lane } of lanes) {
    times_ms[String(lane)] = Math.round(2000 + Math.random() * 2000);
  }
  _manualRaceResolver(times_ms);
}

/**
 * Manual trigger: resolve a pending waitForGate.
 * Called by operator UI "Next Heat" button when no fake track.
 */
export function triggerManualGate() {
  if (!_manualGateResolver) return;
  _manualGateResolver();
}
