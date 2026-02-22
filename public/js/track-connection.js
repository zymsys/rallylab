/**
 * track-connection.js — Track controller connection.
 * Supports three modes:
 *   1. WiFi HTTP — Pico track controller over WiFi (long-poll /wait/race, /wait/gate)
 *   2. Fake Track (BroadcastChannel) — if fake-track.html is open, gate/reset drive the flow
 *   3. Manual fallback — operator clicks buttons in the UI to advance
 * See specs/03-track-controller-protocol.md for real protocol.
 */

import { createSerialPort } from './pico-debug/serial-port.js';
export { isSerialSupported } from './pico-debug/serial-port.js';

const TRACK_CHANNEL = 'rallylab-track';
const MODE_CHANNEL = 'rallylab-track-mode';
const RESPONSE_TIMEOUT = 30000; // 30s fallback timeout
const TRACK_IP_KEY = 'rallylab_track_ip';

let _modeChannel = null;
function _notifyMode() {
  if (!_modeChannel) _modeChannel = new BroadcastChannel(MODE_CHANNEL);
  _modeChannel.postMessage(getTrackMode());
}

let _connected = false;
let _laneCount = 6;
let _trackChannel = null;
let _useFakeTrack = false;
let _messageHandler = null;
let _requestId = 0;

// WiFi HTTP state
let _useWifi = false;
let _wifiBaseUrl = '';
let _lastRaceId = null;
let _wifiError = null;

// USB Serial state
let _useSerial = false;
let _serialPort = null;
let _serialJsonBuf = '';
let _serialBraceDepth = 0;
let _serialResponseResolve = null;
let _serialResponseReject = null;

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
      _notifyMode();
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

// ─── Serial Helpers ─────────────────────────────────────────────

function _handleSerialData(text) {
  if (!_serialResponseResolve) return;
  for (const ch of text) {
    if (ch === '{' || ch === '[') {
      _serialBraceDepth++;
      _serialJsonBuf += ch;
    } else if (ch === '}' || ch === ']') {
      _serialBraceDepth--;
      _serialJsonBuf += ch;
      if (_serialBraceDepth === 0) {
        try {
          const data = JSON.parse(_serialJsonBuf);
          _serialJsonBuf = '';
          const resolve = _serialResponseResolve;
          _serialResponseResolve = null;
          _serialResponseReject = null;
          resolve(data);
        } catch (e) {
          _serialJsonBuf = '';
          _serialBraceDepth = 0;
          const reject = _serialResponseReject;
          _serialResponseResolve = null;
          _serialResponseReject = null;
          reject(new Error('Invalid JSON from track controller'));
        }
        return;
      }
    } else if (_serialBraceDepth > 0) {
      _serialJsonBuf += ch;
    }
  }
}

function _serialSendCommand(cmd) {
  return new Promise((resolve, reject) => {
    _serialJsonBuf = '';
    _serialBraceDepth = 0;
    _serialResponseResolve = resolve;
    _serialResponseReject = reject;
    _serialPort.send(cmd + '\n').catch(reject);
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

// ─── WiFi HTTP API ──────────────────────────────────────────────

/**
 * Probe a Pico track controller at the given IP and activate WiFi mode.
 * @param {string} ip — IP address (e.g. "192.168.1.42")
 * @returns {Promise<{lane_count: number}>}
 */
export async function connectWifi(ip) {
  const base = `http://${ip}`;
  const resp = await fetch(`${base}/info`, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`Track responded with ${resp.status}`);
  const info = await resp.json();
  _useWifi = true;
  _wifiBaseUrl = base;
  _wifiError = null;
  _lastRaceId = null;
  _laneCount = info.lane_count || info.lanes || 6;
  _connected = true;
  localStorage.setItem(TRACK_IP_KEY, ip);
  _notifyMode();
  return { lane_count: _laneCount };
}

/**
 * Disconnect WiFi mode and clear saved IP.
 */
export function disconnectWifi() {
  _useWifi = false;
  _wifiBaseUrl = '';
  _wifiError = null;
  _lastRaceId = null;
  localStorage.removeItem(TRACK_IP_KEY);
  _notifyMode();
}

/**
 * Whether WiFi mode is active.
 * @returns {boolean}
 */
export function isUsingWifi() {
  return _useWifi;
}

/**
 * Read saved track IP from localStorage, or null.
 * @returns {string|null}
 */
export function getSavedTrackIp() {
  return localStorage.getItem(TRACK_IP_KEY);
}

/**
 * Current track mode: 'wifi', 'fake', or 'manual'.
 * @returns {string}
 */
export function getTrackMode() {
  if (_useSerial) return 'serial';
  if (_useWifi) return 'wifi';
  if (_useFakeTrack) return 'fake';
  return 'manual';
}

/**
 * Last WiFi error message, or null.
 * @returns {string|null}
 */
export function getWifiError() {
  return _wifiError;
}

// ─── USB Serial API ─────────────────────────────────────────────

/**
 * Connect to the Pico track controller via USB serial.
 * Opens the browser port picker, probes with `info`, activates serial mode.
 * @returns {Promise<{lane_count: number}>}
 */
export async function connectSerial() {
  const port = createSerialPort({
    onData: _handleSerialData,
    onConnect: () => {},
    onDisconnect: () => {
      _useSerial = false;
      _connected = false;
      _notifyMode();
      if (_serialResponseReject) {
        const reject = _serialResponseReject;
        _serialResponseResolve = null;
        _serialResponseReject = null;
        reject(new Error('Serial port disconnected'));
      }
    }
  });

  await port.connect();
  _serialPort = port;

  try {
    const info = await _serialSendCommand('info');
    _useSerial = true;
    _laneCount = info.lane_count || info.lanes || 6;
    _connected = true;
    _lastRaceId = null;
    _notifyMode();
    return { lane_count: _laneCount };
  } catch (e) {
    _serialPort = null;
    port.disconnect();
    throw e;
  }
}

/**
 * Disconnect USB serial and clear serial state.
 */
export function disconnectSerial() {
  if (_serialPort) {
    _serialPort.disconnect();
    _serialPort = null;
  }
  _useSerial = false;
  _serialJsonBuf = '';
  _serialBraceDepth = 0;
  _serialResponseResolve = null;
  _serialResponseReject = null;
  _lastRaceId = null;
  _notifyMode();
}

/**
 * Whether USB serial mode is active.
 * @returns {boolean}
 */
export function isUsingSerial() {
  return _useSerial;
}

/**
 * Send an arbitrary command over USB serial and return the parsed JSON response.
 * Only works when connected via USB serial. Rejects if another command is pending.
 * @param {string} cmd
 * @returns {Promise<Object>}
 */
export function sendSerialCommand(cmd) {
  if (!_useSerial || !_serialPort) {
    return Promise.reject(new Error('Not connected via USB'));
  }
  if (_serialResponseResolve) {
    return Promise.reject(new Error('Serial port busy'));
  }
  return _serialSendCommand(cmd);
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

  // Try auto-reconnect from saved WiFi IP
  const savedIp = getSavedTrackIp();
  if (savedIp) {
    try {
      return await connectWifi(savedIp);
    } catch (e) {
      console.warn('WiFi auto-reconnect failed:', e.message);
      // Fall through to manual
    }
  }

  // Fallback: manual mode
  _connected = true;
  _laneCount = 6;
  _notifyMode();
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

  // USB Serial: send command and wait for response
  if (_useSerial) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const lanesStr = lanes.map(l => l.lane).join('');
    let cmd = `wait_race?lanes=${lanesStr}`;
    if (_lastRaceId != null) cmd += `&after=${_lastRaceId}`;

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      _serialPort.send('gate\n').catch(() => {});
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      const data = await _serialSendCommand(cmd);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) throw new DOMException('Aborted', 'AbortError');
      if (data.error) throw new Error(data.error);
      _lastRaceId = data.race_id ?? _lastRaceId;
      return data.times_ms;
    } catch (e) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) throw new DOMException('Aborted', 'AbortError');
      throw e;
    }
  }

  // WiFi HTTP: long-poll the Pico for race completion
  if (_useWifi) {
    const lanesStr = lanes.map(l => l.lane).join('');
    let url = `${_wifiBaseUrl}/wait/race?lanes=${lanesStr}`;
    if (_lastRaceId != null) url += `&after=${_lastRaceId}`;
    try {
      const resp = await fetch(url, { signal });
      if (!resp.ok) throw new Error(`Track returned ${resp.status}`);
      const data = await resp.json();
      _lastRaceId = data.race_id ?? _lastRaceId;
      _wifiError = null;
      return data.times_ms;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      _wifiError = e.message;
      throw e;
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

  // USB Serial: send command and wait for response
  if (_useSerial) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      _serialPort.send('gate\n').catch(() => {});
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      await _serialSendCommand('wait_gate');
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) throw new DOMException('Aborted', 'AbortError');
      return;
    } catch (e) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) throw new DOMException('Aborted', 'AbortError');
      throw e;
    }
  }

  // WiFi HTTP: long-poll the Pico for gate ready
  if (_useWifi) {
    try {
      const resp = await fetch(`${_wifiBaseUrl}/wait/gate`, { signal });
      if (!resp.ok) throw new Error(`Track returned ${resp.status}`);
      _wifiError = null;
      return;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      _wifiError = e.message;
      throw e;
    }
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
