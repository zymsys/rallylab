/**
 * track-connection.js — Track controller connection.
 * Supports three modes:
 *   1. WiFi HTTP — Pico track controller over WiFi (long-poll /wait/race, /wait/gate)
 *   2. Fake Track (BroadcastChannel) — if fake-track.html is open, gate/reset drive the flow
 *   3. Manual fallback — operator clicks buttons in the UI to advance
 * See specs/03-track-controller-protocol.md for real protocol.
 */

import { createSerialPort } from './pico-debug/serial-port.js';
import { createRawRepl } from './pico-debug/raw-repl.js';
import { createFileManager } from './pico-debug/file-manager.js';
export { isSerialSupported } from './pico-debug/serial-port.js';

const TRACK_CHANNEL = 'rallylab-track';
const MODE_CHANNEL = 'rallylab-track-mode';
const RESPONSE_TIMEOUT = 30000; // 30s fallback timeout
const SERIAL_CMD_TIMEOUT = 5000; // 5s for serial command responses
const FIRMWARE_API = 'https://api.github.com/repos/zymsys/rallylab/contents/firmware';
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
let _serialDataRedirect = null; // when set, raw REPL steals serial data

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

function _serialSendCommand(cmd, timeout = SERIAL_CMD_TIMEOUT) {
  return new Promise((resolve, reject) => {
    _serialJsonBuf = '';
    _serialBraceDepth = 0;

    const timer = timeout > 0 ? setTimeout(() => {
      _serialResponseResolve = null;
      _serialResponseReject = null;
      reject(new Error('No response from track controller (timeout)'));
    }, timeout) : null;

    _serialResponseResolve = (data) => {
      if (timer) clearTimeout(timer);
      resolve(data);
    };
    _serialResponseReject = (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    };
    _serialPort.send(cmd + '\n').catch((err) => {
      if (timer) clearTimeout(timer);
      _serialResponseResolve = null;
      _serialResponseReject = null;
      reject(err);
    });
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
 *
 * If the firmware isn't responding (e.g. Pico is at the MicroPython REPL),
 * automatically recovers:
 *   - If main.py exists on the device → soft-resets to start it
 *   - If main.py is missing → downloads firmware from GitHub, uploads it, then starts it
 *
 * @param {(status: string) => void} [onStatus] — called with progress messages during recovery
 * @returns {Promise<{lane_count: number}>}
 */
export async function connectSerial(onStatus) {
  const report = onStatus || (() => {});

  const port = createSerialPort({
    onData: (text) => {
      if (_serialDataRedirect) _serialDataRedirect(text);
      else _handleSerialData(text);
    },
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

  // Happy path: firmware is already running, info responds with JSON
  try {
    let info;
    try {
      info = await _serialSendCommand('info');
    } catch {
      _serialJsonBuf = '';
      _serialBraceDepth = 0;
      info = await _serialSendCommand('info');
    }
    return _activateSerial(info);
  } catch {
    // Firmware not responding — try to recover via raw REPL
  }

  const rawRepl = createRawRepl(port, (cb) => { _serialDataRedirect = cb; });
  const fileManager = createFileManager(rawRepl);

  try {
    report('Checking device…');

    // Check what files exist on the Pico
    const { stdout } = await rawRepl.execAndRestart(
      "import os; print(','.join(os.listdir('/')))"
    );
    const files = stdout.trim().split(',');
    const hasMainPy = files.includes('main.py');

    if (hasMainPy) {
      // Firmware files exist — execAndRestart already soft-reset, so main.py is starting
      report('Starting firmware…');
    } else {
      // No firmware on the device — download from GitHub and install
      report('Downloading firmware…');
      const entries = await _fetchFirmwareFromGithub(report);
      await fileManager.writeFiles(entries, (name, i, total) => {
        report(`Installing ${name} (${i + 1}/${total})…`);
      });
      // writeFiles does exit + softReset, so main.py is now starting
      report('Starting firmware…');
    }

    // Give main.py time to boot
    await new Promise(r => setTimeout(r, 2000));
    _serialDataRedirect = null;
    _serialJsonBuf = '';
    _serialBraceDepth = 0;

    const info = await _serialSendCommand('info');
    return _activateSerial(info);
  } catch (e) {
    _serialDataRedirect = null;
    _serialPort = null;
    await port.disconnect();
    throw new Error(
      'Could not start the track controller. ' +
      'Try using the Pico Debug page to upload firmware manually, ' +
      'or see the Track Controller Setup section in the README.'
    );
  }
}

function _activateSerial(info) {
  _useSerial = true;
  _laneCount = info.lane_count || info.lanes || 6;
  _connected = true;
  _lastRaceId = null;
  _notifyMode();
  return { lane_count: _laneCount };
}

async function _fetchFirmwareFromGithub(report) {
  const resp = await fetch(FIRMWARE_API);
  if (!resp.ok) throw new Error('Could not download firmware from GitHub');
  const listing = await resp.json();
  const pyFiles = listing.filter(f => f.name.endsWith('.py') && f.type === 'file');
  if (!pyFiles.length) throw new Error('No firmware files found on GitHub');

  const entries = [];
  for (let i = 0; i < pyFiles.length; i++) {
    report(`Downloading ${pyFiles[i].name}…`);
    const raw = await fetch(pyFiles[i].download_url);
    if (!raw.ok) throw new Error(`Failed to download ${pyFiles[i].name}`);
    entries.push({ name: pyFiles[i].name, content: await raw.text() });
  }
  return entries;
}

// ─── Learn Mode (GPIO pin discovery) ─────────────────────────────

// Long-running MicroPython script that polls all GP0-GP22 and streams
// edge events as single-line JSON.  Runs in raw REPL so it reads raw
// pin values, independent of the firmware's configured pin mapping.
const LEARN_SCAN_CODE = `
from machine import Pin
import time
pins={}
state={}
for gp in range(0,23):
 try:
  p=Pin(gp,Pin.IN,Pin.PULL_UP)
  pins[gp]=p
  state[gp]=p.value()
 except:
  pass
time.sleep_ms(200)
for gp,p in pins.items():
 state[gp]=p.value()
print('READY')
while True:
 for gp,p in pins.items():
  v=p.value()
  if v!=state[gp]:
   time.sleep_ms(10)
   v2=p.value()
   if v2!=state[gp]:
    state[gp]=v2
    print('{"gpio":%d,"value":%d}' % (gp,v2))
 time.sleep_ms(1)
`.trim();

const CHUNK_SIZE = 256;
const CHUNK_DELAY = 50;

/**
 * Start GPIO learn mode for automatic pin mapping discovery.
 * Enters raw REPL and runs a streaming scan — edge detection is near-instant.
 *
 * @returns {Promise<{ waitForEdge, excludePin, finish, cancel }>}
 */
export async function startLearnMode() {
  if (!_useSerial || !_serialPort) {
    throw new Error('Not connected via USB serial');
  }

  _useSerial = false; // pause normal serial command handling

  const rawRepl = createRawRepl(_serialPort, (cb) => { _serialDataRedirect = cb; });
  const excludedPins = new Set();
  let edgeResolve = null;
  let edgeReject = null;
  let cancelled = false;
  let lineBuf = '';

  // Parse streaming JSON lines from the scan script
  function handleStreamData(text) {
    lineBuf += text;
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop(); // keep incomplete trailing fragment
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'OK' || trimmed === 'READY') continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.gpio !== undefined && !excludedPins.has(obj.gpio) && edgeResolve) {
          const resolve = edgeResolve;
          edgeResolve = null;
          edgeReject = null;
          resolve({ gpio: obj.gpio, value: obj.value });
        }
      } catch { /* ignore non-JSON output */ }
    }
  }

  // Enter raw REPL and launch the scan script (don't use exec — it blocks until completion)
  await rawRepl.enter();

  _serialDataRedirect = handleStreamData;

  // Send scan code in chunks + Ctrl-D to execute
  for (let i = 0; i < LEARN_SCAN_CODE.length; i += CHUNK_SIZE) {
    await _serialPort.send(LEARN_SCAN_CODE.slice(i, i + CHUNK_SIZE));
    if (i + CHUNK_SIZE < LEARN_SCAN_CODE.length) {
      await new Promise(r => setTimeout(r, CHUNK_DELAY));
    }
  }
  await _serialPort.send('\x04'); // Ctrl-D = execute

  // Wait for the READY signal (pins set up, baseline taken)
  await new Promise((resolve, reject) => {
    const origHandler = handleStreamData;
    const timer = setTimeout(() => {
      _serialDataRedirect = origHandler;
      reject(new Error('Timeout waiting for scan to start'));
    }, 10000);
    _serialDataRedirect = (text) => {
      lineBuf += text;
      if (lineBuf.includes('READY')) {
        clearTimeout(timer);
        // Drain everything up to and including READY
        lineBuf = lineBuf.slice(lineBuf.indexOf('READY') + 5);
        _serialDataRedirect = origHandler;
        resolve();
      }
    };
  });

  _serialDataRedirect = handleStreamData;

  /**
   * Interrupt the scan script and return to raw REPL prompt.
   */
  async function interruptScan() {
    _serialDataRedirect = null;
    lineBuf = '';
    // Ctrl-C interrupts the running script; raw REPL outputs error + prompt
    await _serialPort.send('\x03');
    await new Promise(r => setTimeout(r, 300));
    await _serialPort.send('\x03');
    await new Promise(r => setTimeout(r, 300));
  }

  return {
    /**
     * Wait for the next GPIO edge. Near-instant detection.
     * Returns { gpio: number, value: 0|1 } — value 0 = fell to ground, 1 = rose to pull-up.
     */
    waitForEdge() {
      if (cancelled) return Promise.reject(new Error('Learn mode cancelled'));
      return new Promise((resolve, reject) => {
        edgeResolve = resolve;
        edgeReject = reject;
      });
    },

    /**
     * Exclude a GPIO from future edge detection (filtered in JS, no round-trip).
     */
    excludePin(gpio) {
      excludedPins.add(gpio);
    },

    /**
     * Write config.py with the learned mapping and restart firmware.
     * @param {{ gatePin: number, gateInvert: boolean, lanePins: Object<number,number> }} config
     */
    async finish(config) {
      cancelled = true;
      if (edgeReject) { edgeReject(new Error('Learn mode finished')); edgeResolve = null; edgeReject = null; }

      await interruptScan();

      const laneCount = Object.keys(config.lanePins).length;
      const laneEntries = Object.entries(config.lanePins)
        .map(([lane, gpio]) => `    ${lane}: ${gpio},`)
        .join('\n');

      const configPy = `# config.py — Pin mapping and constants
# Generated by Learn Mode

FIRMWARE_VERSION = "0.1.0"
PROTOCOL_VERSION = "1.0"

LANE_PINS = {
${laneEntries}
}
GATE_PIN = ${config.gatePin}
GATE_INVERT = ${config.gateInvert ? 'True' : 'False'}
SHARED_PIN7 = False

LANE_COUNT = ${laneCount}
DEBOUNCE_MS = 10
RACE_TIMEOUT_MS = 15000

# WiFi / HTTP
HTTP_PORT = 80
WIFI_CONNECT_TIMEOUT_MS = 10000
`;

      // Re-enter raw REPL cleanly to write the file
      const fileRepl = createRawRepl(_serialPort, (cb) => { _serialDataRedirect = cb; });
      await fileRepl.enter();

      const escaped = configPy.replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'");
      await fileRepl.exec(
        `f=open('config.py','w')\nf.write('''${escaped}''')\nf.close()\nprint('ok')`,
        15000
      );

      await fileRepl.exit();
      await fileRepl.softReset();

      // Wait for firmware to boot with new config
      await new Promise(r => setTimeout(r, 2000));
      _serialDataRedirect = null;
      _serialJsonBuf = '';
      _serialBraceDepth = 0;

      const info = await _serialSendCommand('info');
      _activateSerial(info);
    },

    /**
     * Cancel learn mode and restart firmware with existing config.
     */
    async cancel() {
      cancelled = true;
      if (edgeReject) { edgeReject(new Error('Learn mode cancelled')); edgeResolve = null; edgeReject = null; }

      try {
        await interruptScan();
        // Exit raw REPL and soft reset to restart firmware
        await _serialPort.send('\x02'); // Ctrl-B = exit raw REPL
        await new Promise(r => setTimeout(r, 100));
        await _serialPort.send('\x04'); // Ctrl-D = soft reset
      } catch {}

      await new Promise(r => setTimeout(r, 2000));
      _serialDataRedirect = null;
      _serialJsonBuf = '';
      _serialBraceDepth = 0;

      try {
        const info = await _serialSendCommand('info');
        _activateSerial(info);
      } catch {
        _useSerial = true;
        _connected = true;
        _notifyMode();
      }
    }
  };
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
      const data = await _serialSendCommand(cmd, 0);
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
      await _serialSendCommand('wait_gate', 0);
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
