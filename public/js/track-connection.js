/**
 * track-connection.js — Track controller connection (Protocol v2).
 * Supports three modes:
 *   1. USB Serial / WiFi HTTP — Pico track controller speaking v2 NDJSON.
 *   2. Fake Track (BroadcastChannel) — if fake-track.html is open, gate/reset drive the flow
 *   3. Manual fallback — operator clicks buttons in the UI to advance
 * See specs/03-track-controller-protocol-v2.md for the wire protocol.
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
let _serialLineBuf = '';
let _serialDataRedirect = null; // when set, raw REPL steals serial data

// V2 protocol client state.
//
// _v2NextId starts at a random offset rather than 0. The Pico's firmware
// session can outlive a host page (USB stays open across reloads), so its
// _subs and _pending maps may still hold ids from a prior host. Starting
// fresh from 1 risks colliding with that stale state ("id already in use
// as a sub", or — worse — the firmware delivering an old wait_race
// response to our new subscribe). A random ~24-bit prefix makes the
// collision probability vanishing without any handshake on connect.
let _v2NextId = Math.floor(Math.random() * 0x1000000); // monotonic, random base
const _v2Pending = new Map();               // id → { resolve, reject, kind }
const _v2Subs = new Map();                  // sub → { topics, onEvent, transport }
let _v2EventSource = null;                  // EventSource for WiFi events

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
      // Only broadcast mode change if no real track is connected —
      // otherwise the repeated TRACK_HELLO (every 2s) causes the
      // debug view to flip between USB/fake layouts.
      if (!_useSerial && !_useWifi) _notifyMode();
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

// ─── Serial helpers (v2 line reader) ────────────────────────────

function _handleSerialData(text) {
  _serialLineBuf += text;
  let nl;
  while ((nl = _serialLineBuf.indexOf('\n')) >= 0) {
    const line = _serialLineBuf.slice(0, nl).replace(/\r$/, '').trim();
    _serialLineBuf = _serialLineBuf.slice(nl + 1);
    if (!line) continue;
    _v2HandleLine(line, 'serial');
  }
}

function _v2HandleLine(line, transport) {
  // Be tolerant of non-JSON output (firmware boot logs, REPL noise).
  if (!line || line[0] !== '{') return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  _v2HandleFrame(frame, transport);
}

function _v2HandleFrame(frame, transport) {
  if (frame == null || typeof frame !== 'object') return;
  if ('id' in frame && ('ok' in frame || 'err' in frame)) {
    const id = frame.id;
    const pending = _v2Pending.get(id);
    if (!pending) return;
    _v2Pending.delete(id);
    if ('err' in frame) {
      const err = new Error(frame.err);
      err.code = frame.code;
      pending.reject(err);
    } else {
      pending.resolve(frame.ok);
    }
    return;
  }
  if ('sub' in frame && 'event' in frame) {
    const entry = _v2Subs.get(frame.sub);
    if (entry && (transport === undefined || entry.transport === transport)) {
      try {
        entry.onEvent(frame);
      } catch (e) {
        console.error('subscription handler threw', e);
      }
    }
  }
}

function _v2NewId() {
  _v2NextId += 1;
  return _v2NextId;
}

/**
 * Send a v2 request frame and resolve with its `ok` payload.
 * @param {string} cmd
 * @param {Object} [args] — extra fields merged into the frame
 * @param {{ signal?: AbortSignal, timeout?: number, id?: number }} [opts]
 */
function _v2Request(transport, cmd, args = {}, opts = {}) {
  const id = opts.id != null ? opts.id : _v2NewId();
  const frame = { id, cmd, ...args };

  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      _v2Pending.delete(id);
      cleanup();
      // Best-effort cancel on the device.
      _v2SendFrame(transport, { id: _v2NewId(), cmd: 'cancel', target: id }).catch(() => {});
      reject(new DOMException('Aborted', 'AbortError'));
    };

    _v2Pending.set(id, {
      resolve: (val) => { cleanup(); resolve(val); },
      reject: (err) => { cleanup(); reject(err); },
      kind: cmd,
    });

    if (opts.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        if (_v2Pending.delete(id)) {
          cleanup();
          reject(new Error(`No response from track controller for ${cmd} (timeout)`));
        }
      }, opts.timeout);
    }
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

    _v2SendFrame(transport, frame).catch((e) => {
      if (_v2Pending.delete(id)) {
        cleanup();
        reject(e);
      }
    });
  });
}

async function _v2SendFrame(transport, frame) {
  const line = JSON.stringify(frame);
  if (transport === 'serial') {
    await _serialPort.send(line + '\n');
    return;
  }
  if (transport === 'wifi') {
    const resp = await fetch(`${_wifiBaseUrl}/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: line,
    });
    if (!resp.ok) throw new Error(`Track returned ${resp.status}`);
    const data = await resp.json();
    // /cmd is request/response — the device returned the matching frame
    // synchronously. Feed it back into the dispatcher.
    _v2HandleFrame(data, 'wifi');
    return;
  }
  throw new Error(`unknown transport: ${transport}`);
}

function _v2ActiveTransport() {
  if (_useSerial) return 'serial';
  if (_useWifi) return 'wifi';
  return null;
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
  // GET /info is the convenience probe — no v2 frame needed since it's a
  // bare HTTP fetch. We still validate the protocol version below.
  const resp = await fetch(`${base}/info`, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`Track responded with ${resp.status}`);
  const probe = await resp.json();
  // The /info convenience route returns a v2 frame envelope { id, ok }.
  const info = probe.ok || probe;
  if (info.protocol && info.protocol !== '2.0') {
    throw new Error(
      `Track firmware speaks protocol ${info.protocol}, expected 2.0. Re-flash firmware.`
    );
  }
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
  _closeEventSource();
  _v2RejectAllPending(new Error('WiFi disconnected'));
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
      _v2RejectAllPending(new Error('Serial port disconnected'));
    }
  });

  await port.connect();
  _serialPort = port;
  _useSerial = true; // enable line reader so v2 frames route correctly

  // Happy path: firmware is already running, info responds with JSON
  try {
    let info;
    try {
      info = await _v2Request('serial', 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
    } catch {
      _serialLineBuf = '';
      info = await _v2Request('serial', 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
    }
    return _activateSerial(info);
  } catch {
    // Firmware not responding — try to recover via raw REPL
    _useSerial = false; // disable v2 reader during raw REPL ops
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

    let needsFlash = !hasMainPy;

    if (hasMainPy) {
      // Firmware files exist — execAndRestart already soft-reset, so main.py is starting.
      // But: it might be v1 firmware. Probe with a v1-style "info" line and check
      // protocol; if it's not 2.0 we re-flash.
      report('Detecting firmware version…');
      await new Promise(r => setTimeout(r, 1500));
      const probe = await _probeFirmwareVersion(port);
      if (probe && probe.protocol && probe.protocol !== '2.0') {
        report(`Found protocol ${probe.protocol} — upgrading to v2…`);
        needsFlash = true;
      } else if (!probe) {
        // No response at all — treat as needs-flash to be safe.
        needsFlash = true;
      }
    }

    if (needsFlash) {
      // Re-enter raw REPL (the probe may have left us in v1 mode).
      report('Downloading firmware…');
      const entries = await _fetchFirmwareFromGithub(report);

      // Remove stale .py files from any prior firmware version (v1 left
      // json_format.py / uuid_gen.py behind, etc.). Non-.py files like
      // wifi.json are preserved.
      const keep = entries.map(e => e.name);
      try {
        const removed = await fileManager.cleanStalePyFiles(keep);
        if (removed && removed.length) {
          report(`Removed stale: ${removed.join(', ')}`);
        }
      } catch (e) {
        console.warn('cleanStalePyFiles failed (non-fatal):', e.message);
      }

      await fileManager.writeFiles(entries, (name, i, total) => {
        report(`Installing ${name} (${i + 1}/${total})…`);
      });
      // writeFiles does exit + softReset, so main.py is now starting
      report('Starting firmware…');
    }

    // Give main.py time to boot
    await new Promise(r => setTimeout(r, 2000));
    _serialDataRedirect = null;
    _serialLineBuf = '';
    _useSerial = true;

    const info = await _v2Request('serial', 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
    return _activateSerial(info);
  } catch (e) {
    _serialDataRedirect = null;
    _useSerial = false;
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
  if (info.protocol && info.protocol !== '2.0') {
    throw new Error(
      `Track firmware speaks protocol ${info.protocol}, expected 2.0. Re-flash firmware.`
    );
  }
  _useSerial = true;
  _laneCount = info.lane_count || info.lanes || 6;
  _connected = true;
  _lastRaceId = null;

  // No reset frame here on purpose. A fire-and-forget reset races with the
  // first render's subscribe/wait_race; an awaited reset stalls connect.
  // _v2NextId's random base already prevents id-collision with stale
  // firmware state, which is what the reset used to defend against.

  _notifyMode();
  return { lane_count: _laneCount };
}

function _v2RejectAllPending(err) {
  for (const [, p] of _v2Pending) {
    try { p.reject(err); } catch {}
  }
  _v2Pending.clear();
}

/**
 * Probe a freshly-booted Pico for its firmware/protocol version using the
 * v1 plaintext "info" command. v1 firmware responds with a pretty-printed
 * JSON object (multi-line). v2 firmware will silently ignore non-JSON
 * lines, so the probe times out and we know to fall back differently.
 *
 * Returns { protocol, firmware, lane_count } on success, or null on
 * timeout / parse failure.
 */
async function _probeFirmwareVersion(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      _serialDataRedirect = null;
      resolve(null);
    }, timeoutMs);

    _serialDataRedirect = (text) => {
      buf += text;
      // v1 pretty-prints across multiple lines; balance braces.
      let depth = 0;
      let start = -1;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (c === '}') {
          depth--;
          if (depth === 0 && start >= 0) {
            try {
              const obj = JSON.parse(buf.slice(start, i + 1));
              if (obj && (obj.protocol || obj.firmware || obj.error)) {
                done = true;
                clearTimeout(t);
                _serialDataRedirect = null;
                resolve(obj);
                return;
              }
            } catch { /* keep buffering */ }
          }
        }
      }
    };

    port.send('info\n').catch(() => {
      if (done) return;
      done = true;
      clearTimeout(t);
      _serialDataRedirect = null;
      resolve(null);
    });
  });
}

async function _fetchFirmwareFromGithub(report) {
  // Prefer same-origin firmware (the version bundled with this web app).
  // The static server is configured to serve /firmware/ from the repo's
  // firmware directory, so the host always flashes its own version —
  // not whatever happens to be on GitHub `main`.
  try {
    const local = await _fetchFirmwareFromSameOrigin(report);
    if (local) return local;
  } catch (e) {
    console.warn('Same-origin firmware unavailable, falling back to GitHub:', e.message);
  }

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

/**
 * Try to fetch firmware from the same origin as this web app. A small
 * manifest at /firmware/MANIFEST.txt lists one filename per line so we
 * don't have to do directory listing in the browser. Returns null if
 * the manifest isn't reachable (so the caller can fall back to GitHub).
 */
async function _fetchFirmwareFromSameOrigin(report) {
  const manifestResp = await fetch('/firmware/MANIFEST.txt', { cache: 'no-store' });
  if (!manifestResp.ok) return null;
  const manifest = (await manifestResp.text())
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const entries = [];
  for (let i = 0; i < manifest.length; i++) {
    const name = manifest[i];
    report(`Reading ${name}…`);
    const r = await fetch(`/firmware/${name}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Failed to read ${name}`);
    entries.push({ name, content: await r.text() });
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
      _serialLineBuf = '';
      _useSerial = true;

      const info = await _v2Request('serial', 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
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
      _serialLineBuf = '';
      _useSerial = true;

      try {
        const info = await _v2Request('serial', 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
        _activateSerial(info);
      } catch {
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
  _serialLineBuf = '';
  _v2RejectAllPending(new Error('Serial disconnected'));
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
 * Send an arbitrary command (v1-style "cmd args" string) over USB serial
 * and resolve with the response payload. The argument string is parsed and
 * translated into a v2 frame, so callers don't need to write JSON.
 *
 * Examples:
 *   sendSerialCommand('dbg')                           → { ok: { ... } }
 *   sendSerialCommand('hostname_set my-track')         → { hostname: '...' }
 *   sendSerialCommand('wifi_setup my-ssid my-password')
 *
 * @param {string} cmd
 * @returns {Promise<Object>}
 */
export function sendSerialCommand(cmd) {
  if (!_useSerial || !_serialPort) {
    return Promise.reject(new Error('Not connected via USB'));
  }
  const { name, args } = _parseHumanCommand(cmd);
  return _v2Request('serial', name, args, { timeout: SERIAL_CMD_TIMEOUT });
}

function _parseHumanCommand(line) {
  const parts = line.trim().split(/\s+/);
  const name = parts[0] || '';
  const rest = parts.slice(1);
  const args = {};

  // Recognized positional shapes for legacy commands.
  if (name === 'wifi_setup' && rest.length >= 2) {
    args.ssid = rest[0];
    args.password = rest.slice(1).join(' ');
  } else if (name === 'hostname_set' && rest.length >= 1) {
    args.name = rest.join(' ');
  } else {
    // Generic: support key=value tokens, otherwise pass through.
    for (const tok of rest) {
      if (tok.includes('=')) {
        const [k, v] = tok.split('=', 2);
        args[k] = v;
      }
    }
  }
  return { name, args };
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

  const transport = _v2ActiveTransport();
  if (transport) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const args = { lanes: lanes.map(l => l.lane).join('') };
    if (_lastRaceId != null) args.after = _lastRaceId;
    try {
      const data = await _v2Request(transport, 'wait_race', args, { signal });
      _lastRaceId = data.race_id ?? _lastRaceId;
      _wifiError = null;
      return data.times_ms;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (transport === 'wifi') _wifiError = e.message;
      throw e;
    }
  }

  // Fake track (BroadcastChannel)
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

  const transport = _v2ActiveTransport();
  if (transport) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      await _v2Request(transport, 'wait_gate', {}, { signal });
      _wifiError = null;
      return;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (transport === 'wifi') _wifiError = e.message;
      throw e;
    }
  }

  // Fake track (BroadcastChannel)
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

// ─── V2 Subscriptions (live track status) ────────────────────────

/**
 * Subscribe to one or more topics on the track controller.
 * Topics: 'gate', 'lanes', 'edges', 'race', 'engine'.
 * onEvent receives the raw frame: { sub, event, ...fields }.
 *
 * Returns an object with .unsubscribe() to tear down. Returns null when
 * no real track is connected (fake/manual modes don't push events).
 *
 * @param {string[]} topics
 * @param {(frame: Object) => void} onEvent
 * @returns {{ sub: number, unsubscribe: () => Promise<void> } | null}
 */
export function subscribeTrackEvents(topics, onEvent) {
  const transport = _v2ActiveTransport();
  if (!transport) return null;

  if (transport === 'serial') return _subscribeSerial(topics, onEvent);
  if (transport === 'wifi') return _subscribeWifi(topics, onEvent);
  return null;
}

function _subscribeSerial(topics, onEvent) {
  // Allocate one id and use it for BOTH the request id and the sub id.
  // The firmware sets sub == req_id, and initial-state events follow
  // the ok response on the same serial line stream — they arrive before
  // any Promise microtask, so the handler MUST be registered
  // synchronously before the request is sent.
  const subId = _v2NewId();
  const wrapper = { sub: subId, transport: 'serial', topics, onEvent };
  _v2Subs.set(subId, wrapper);

  _v2Request('serial', 'subscribe', { topics },
             { timeout: SERIAL_CMD_TIMEOUT, id: subId })
    .catch((e) => {
      _v2Subs.delete(subId);
      console.warn('subscribe failed:', e.message);
    });

  return {
    sub: subId,
    unsubscribe: async () => {
      if (!_v2Subs.delete(subId)) return;
      try {
        await _v2Request('serial', 'unsubscribe', { sub: subId },
                         { timeout: SERIAL_CMD_TIMEOUT });
      } catch { /* transport may be gone */ }
    },
  };
}

function _subscribeWifi(topics, onEvent) {
  // Each WiFi subscription gets its own EventSource. The device's
  // /events route auto-subscribes when topics= is in the query.
  const url = `${_wifiBaseUrl}/events?topics=${encodeURIComponent(topics.join(','))}`;
  let es;
  try {
    es = new EventSource(url);
  } catch (e) {
    console.warn('EventSource not available:', e.message);
    return null;
  }

  // The first auto-sub request id on a fresh session is 1; we don't
  // strictly need to track it because every event on this stream is for
  // OUR subscription. Just unwrap and forward.
  es.onmessage = (e) => {
    const line = e.data;
    if (!line || line[0] !== '{') return;
    let frame;
    try { frame = JSON.parse(line); }
    catch { return; }
    if ('event' in frame) {
      try { onEvent(frame); } catch (err) { console.error(err); }
    }
  };
  es.onerror = () => {
    // Browser auto-reconnects.
  };

  return {
    sub: null,
    unsubscribe: async () => {
      try { es.close(); } catch {}
    },
  };
}

function _closeEventSource() {
  if (_v2EventSource) {
    try { _v2EventSource.close(); } catch {}
    _v2EventSource = null;
  }
}

// ─── Firmware update (in-band) ────────────────────────────────────

/**
 * Run an in-band firmware update over the active v2 transport.
 * Streams files via update_begin / update_chunk / update_commit and
 * waits for the device to come back after reboot.
 *
 * @param {Array<{name: string, content: string}>} files — text contents
 *   (utf-8). Sizes/sha256 are computed by this client.
 * @param {string} version — version string for the manifest.
 * @param {(stage: string, info?: Object) => void} [onProgress]
 * @returns {Promise<{firmware: string, protocol: string}>} new info
 */
export async function flashFirmwareInBand(files, version, onProgress = () => {}) {
  const transport = _v2ActiveTransport();
  if (!transport) throw new Error('Not connected to a track');

  // Build manifest with sha256.
  const enc = new TextEncoder();
  const manifest = [];
  const blobs = {};
  for (const f of files) {
    const bytes = enc.encode(f.content);
    blobs[f.name] = bytes;
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    manifest.push({
      name: f.name,
      size: bytes.length,
      sha256: Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0')).join(''),
    });
  }

  onProgress('begin');
  const beginOk = await _v2Request(transport, 'update_begin',
    { version, files: manifest }, { timeout: 10000 });
  const sessionId = beginOk.session;
  const chunkSize = beginOk.chunk_size;

  // Stream each file.
  for (let fi = 0; fi < manifest.length; fi++) {
    const m = manifest[fi];
    const bytes = blobs[m.name];
    let offset = 0;
    while (offset < bytes.length) {
      const slice = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
      const b64 = btoa(String.fromCharCode(...slice));
      await _v2Request(transport, 'update_chunk', {
        session: sessionId,
        name: m.name,
        offset,
        data: b64,
      }, { timeout: 15000 });
      offset += slice.length;
      onProgress('chunk', { file: m.name, fileIndex: fi, totalFiles: manifest.length,
                            sent: offset, size: bytes.length });
    }
  }

  onProgress('commit');
  await _v2Request(transport, 'update_commit', { session: sessionId },
                   { timeout: 10000 });

  onProgress('rebooting');
  // Device reboots ~500ms after committed: true. Drop pending requests
  // and wait for boot.
  _v2RejectAllPending(new Error('Track rebooting for firmware update'));
  await new Promise(r => setTimeout(r, 2500));

  // Re-probe info.
  const info = await _v2Request(transport, 'info', {}, { timeout: SERIAL_CMD_TIMEOUT });
  if (info.protocol !== '2.0') {
    throw new Error(`After flash, device reports protocol ${info.protocol}`);
  }
  onProgress('done', info);
  return info;
}

/**
 * Fetch the latest firmware from GitHub (the same source connectSerial
 * uses for first-time installs). Returns [{name, content}, ...].
 *
 * @returns {Promise<Array<{name: string, content: string}>>}
 */
export async function fetchLatestFirmware(onStatus = () => {}) {
  return _fetchFirmwareFromGithub(onStatus);
}

/**
 * Parse FIRMWARE_VERSION from a config.py text blob.
 */
export function parseFirmwareVersion(configText) {
  const m = configText.match(/FIRMWARE_VERSION\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}
