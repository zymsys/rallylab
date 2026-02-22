/**
 * serial-port.js — Web Serial API wrapper for Pico W communication.
 *
 * Handles connect/disconnect, sending text, and reading incoming data
 * via a streaming reader loop. Dispatches received text to a callback.
 */

/** @returns {boolean} Whether the Web Serial API is available */
export function isSerialSupported() {
  return 'serial' in navigator;
}

/**
 * Creates a serial port manager.
 *
 * @param {object} opts
 * @param {(text: string) => void} opts.onData — called with each decoded text chunk
 * @param {() => void} opts.onConnect — called after successful connection
 * @param {() => void} opts.onDisconnect — called on disconnect (intentional or cable pull)
 */
export function createSerialPort({ onData, onConnect, onDisconnect }) {
  let _port = null;
  let _reader = null;
  let _writer = null;
  let _reading = false;
  const _encoder = new TextEncoder();
  const _decoder = new TextDecoder();

  async function connect() {
    if (_port) return;
    _port = await navigator.serial.requestPort();
    await _port.open({ baudRate: 115200 });
    _writer = _port.writable.getWriter();
    onConnect();
    _readLoop();
  }

  async function _readLoop() {
    _reading = true;
    while (_port && _port.readable && _reading) {
      _reader = _port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await _reader.read();
          if (done) break;
          if (value) onData(_decoder.decode(value));
        }
      } catch (err) {
        // Read error — port was likely disconnected
        if (_reading) {
          console.warn('Serial read error:', err);
        }
      } finally {
        try { _reader.releaseLock(); } catch {}
        _reader = null;
      }
    }
    // If we exit the loop unexpectedly, treat as disconnect
    if (_reading) {
      _reading = false;
      _cleanup();
      onDisconnect();
    }
  }

  /**
   * Send a text string over serial.
   * @param {string} text
   */
  async function send(text) {
    if (!_writer) throw new Error('Not connected');
    await _writer.write(_encoder.encode(text));
  }

  /**
   * Send raw bytes over serial.
   * @param {Uint8Array} bytes
   */
  async function sendRaw(bytes) {
    if (!_writer) throw new Error('Not connected');
    await _writer.write(bytes);
  }

  async function disconnect() {
    _reading = false;
    try {
      if (_reader) { await _reader.cancel(); _reader.releaseLock(); }
    } catch {}
    try {
      if (_writer) { _writer.releaseLock(); }
    } catch {}
    try {
      if (_port) await _port.close();
    } catch {}
    _cleanup();
    onDisconnect();
  }

  function _cleanup() {
    _port = null;
    _reader = null;
    _writer = null;
  }

  function isConnected() {
    return _port !== null;
  }

  return { connect, disconnect, send, sendRaw, isConnected };
}
