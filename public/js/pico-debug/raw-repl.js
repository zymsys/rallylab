/**
 * raw-repl.js — MicroPython raw REPL protocol engine.
 *
 * Protocol sequence for executing Python code on the Pico:
 *   1. Ctrl-C x2  → interrupt running firmware, drop to REPL
 *   2. Ctrl-A     → enter raw REPL (response: "raw REPL; CTRL-B to exit\r\n>")
 *   3. Send code in ~256-byte chunks + Ctrl-D → execute
 *   4. Response: "OK" + stdout + \x04 + stderr + \x04
 *   5. Ctrl-B     → exit raw REPL back to normal REPL
 *   6. Ctrl-D     → soft reset, firmware restarts
 */

const CTRL_A = '\x01';
const CTRL_B = '\x02';
const CTRL_C = '\x03';
const CTRL_D = '\x04';

const CHUNK_SIZE = 256;
const CHUNK_DELAY_MS = 50;
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Creates a raw REPL controller.
 *
 * @param {object} serial — serial port with send(text), sendRaw(bytes) methods
 * @param {(cb: (text: string) => void) => void} setDataCallback — replaces the serial onData handler
 */
export function createRawRepl(serial, setDataCallback) {
  let _buffer = '';
  let _resolveWait = null;
  let _waitPattern = null;

  /** Install our data collector */
  function _startCollecting() {
    _buffer = '';
    setDataCallback(_onData);
  }

  let _checkReady = null;  // () => boolean

  function _onData(text) {
    _buffer += text;
    if (_resolveWait && _checkReady && _checkReady()) {
      const resolve = _resolveWait;
      _resolveWait = null;
      _checkReady = null;
      resolve(_buffer);
    }
  }

  /**
   * Wait until check() returns true, or timeout.
   * @returns {Promise<string>} accumulated buffer
   */
  function _waitUntil(check, desc, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (check()) return Promise.resolve(_buffer);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        _resolveWait = null;
        _checkReady = null;
        reject(new Error(`Timeout waiting for ${desc} after ${timeoutMs}ms. Buffer: ${_buffer.slice(-200)}`));
      }, timeoutMs);
      _checkReady = check;
      _resolveWait = (buf) => {
        clearTimeout(timer);
        resolve(buf);
      };
    });
  }

  /**
   * Wait until _buffer contains `pattern`, or timeout.
   * @returns {Promise<string>} accumulated buffer
   */
  function _waitFor(pattern, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return _waitUntil(
      () => _buffer.indexOf(pattern) !== -1,
      `"${_escape(pattern)}"`,
      timeoutMs
    );
  }

  /** Count occurrences of char in _buffer */
  function _countChar(ch) {
    let n = 0;
    for (let i = 0; i < _buffer.length; i++) {
      if (_buffer[i] === ch) n++;
    }
    return n;
  }

  function _escape(s) {
    return s.replace(/[\x00-\x1f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Enter raw REPL mode: interrupt firmware, then switch to raw REPL.
   */
  async function enter() {
    _startCollecting();
    // Interrupt firmware
    await serial.send(CTRL_C);
    await _sleep(100);
    await serial.send(CTRL_C);
    await _sleep(200);
    // Enter raw REPL
    _buffer = '';
    await serial.send(CTRL_A);
    await _waitFor('raw REPL; CTRL-B to exit\r\n>', 5000);
  }

  /**
   * Execute Python code in raw REPL and return { stdout, stderr }.
   * Must already be in raw REPL mode (call enter() first).
   *
   * @param {string} code — Python source to execute
   * @param {number} [timeoutMs] — max wait for response
   * @returns {Promise<{ stdout: string, stderr: string }>}
   */
  async function exec(code, timeoutMs = DEFAULT_TIMEOUT_MS) {
    _buffer = '';

    // Send code in chunks to avoid overflowing the raw REPL input buffer
    for (let i = 0; i < code.length; i += CHUNK_SIZE) {
      const chunk = code.slice(i, i + CHUNK_SIZE);
      await serial.send(chunk);
      if (i + CHUNK_SIZE < code.length) {
        await _sleep(CHUNK_DELAY_MS);
      }
    }

    // Ctrl-D to execute
    await serial.send(CTRL_D);

    // Wait for the response: OK<stdout>\x04<stderr>\x04
    // The two \x04 markers are NOT adjacent when stderr has content.
    await _waitUntil(
      () => _buffer.indexOf('OK') !== -1 && _countChar(CTRL_D) >= 2,
      '2x \\x04',
      timeoutMs
    );

    // Parse response
    const buf = _buffer;
    const okIdx = buf.indexOf('OK');
    const afterOk = buf.slice(okIdx + 2);
    const firstEot = afterOk.indexOf(CTRL_D);
    const secondEot = afterOk.indexOf(CTRL_D, firstEot + 1);

    const stdout = afterOk.slice(0, firstEot);
    const stderr = afterOk.slice(firstEot + 1, secondEot);

    // After execution, raw REPL sends ">" prompt — wait for it
    _buffer = '';
    await _waitFor('>', 3000).catch(() => {}); // non-critical

    return { stdout, stderr };
  }

  /**
   * Exit raw REPL mode back to normal REPL.
   */
  async function exit() {
    _buffer = '';
    await serial.send(CTRL_B);
    await _sleep(100);
  }

  /**
   * Soft reset — restarts firmware.
   */
  async function softReset() {
    await serial.send(CTRL_D);
    await _sleep(500);
  }

  /**
   * Full cycle: enter raw REPL, execute code, exit, soft reset.
   * Returns { stdout, stderr }.
   */
  async function execAndRestart(code, timeoutMs) {
    await enter();
    const result = await exec(code, timeoutMs);
    await exit();
    await softReset();
    return result;
  }

  return { enter, exec, exit, softReset, execAndRestart };
}

/**
 * Escape a string for embedding inside triple-quoted Python strings.
 * Handles backslashes, triple quotes, and null bytes.
 */
export function escapePython(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'''/g, "\\'''")
    .replace(/\x00/g, '\\x00');
}
