/**
 * pico-debug/app.js — Entry point for the Pico W Debug Console.
 *
 * Wires up: serial connection, terminal I/O, tab switching,
 * file list + CodeMirror editor, save/upload/restart, and
 * mode management (busy states during raw REPL operations).
 */

import { isSerialSupported, createSerialPort } from './serial-port.js';
import { createRawRepl } from './raw-repl.js';
import { createFileManager } from './file-manager.js';

// ─── DOM refs ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const btnConnect      = $('#btn-connect');
const btnDisconnect   = $('#btn-disconnect');
const statusDot       = $('#status-dot');
const statusLabel     = $('#status-label');
const terminalOutput  = $('#terminal-output');
const terminalContent = $('#terminal-content');
const terminalAnchor  = $('#terminal-anchor');
const terminalInput   = $('#terminal-input');
const fileListEl      = $('#file-list');
const editorFilename  = $('#editor-filename');
const editorContainer = $('#editor-container');
const btnSave         = $('#btn-save');
const btnRestart      = $('#btn-restart');
const btnRefresh      = $('#btn-refresh-files');
const btnUpload       = $('#btn-upload-file');
const btnLoadGithub   = $('#btn-load-github');
const uploadInput     = $('#upload-input');
const busyOverlay     = $('#busy-overlay');
const busyText        = $('#busy-text');

// ─── State ───────────────────────────────────────────────
let _serial = null;
let _rawRepl = null;
let _fileManager = null;
let _editor = null;          // CodeMirror instance
let _activeFile = null;      // currently open filename
let _busy = false;
let _dataCallback = null;    // current serial data handler
let _cmdHistory = [];
let _historyIdx = -1;
let _lineBuf = '';         // accumulates partial serial lines for terminal display

// ─── Feature detection ───────────────────────────────────
if (!isSerialSupported()) {
  $('#no-serial-banner').style.display = 'block';
  btnConnect.disabled = true;
}

// ─── Serial setup ────────────────────────────────────────
function initSerial() {
  _serial = createSerialPort({
    onData: (text) => {
      if (_dataCallback) {
        _dataCallback(text);
      } else {
        // Buffer partial lines so chunk boundaries don't split output
        _lineBuf += text;
        const lines = _lineBuf.split('\n');
        _lineBuf = lines.pop(); // keep incomplete trailing fragment
        for (const line of lines) {
          if (line.trim()) appendTerminal(line + '\n', 'resp');
        }
      }
    },
    onConnect: () => {
      statusDot.classList.add('connected');
      statusLabel.textContent = 'Connected';
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
      terminalInput.disabled = false;
      terminalInput.focus();
      appendTerminal('Connected to Pico W\n', 'sys');
    },
    onDisconnect: () => {
      statusDot.classList.remove('connected');
      statusLabel.textContent = 'Disconnected';
      btnConnect.disabled = false;
      btnDisconnect.disabled = true;
      terminalInput.disabled = true;
      _dataCallback = null;
      _lineBuf = '';
      appendTerminal('Disconnected\n', 'sys');
    }
  });

  _rawRepl = createRawRepl(_serial, (cb) => { _dataCallback = cb; });
  _fileManager = createFileManager(_rawRepl);
}

// ─── Terminal ────────────────────────────────────────────
function appendTerminal(text, cls = 'resp') {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text;
  terminalContent.appendChild(span);
  terminalAnchor.scrollIntoView({ block: 'end' });
}

function sendCommand(cmd) {
  if (!_serial || !_serial.isConnected() || _busy) return;
  appendTerminal('> ' + cmd + '\n', 'cmd');
  _serial.send(cmd + '\r\n');
}

// Terminal input
terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const cmd = terminalInput.value.trim();
    if (cmd) {
      _cmdHistory.push(cmd);
      _historyIdx = _cmdHistory.length;
      sendCommand(cmd);
    }
    terminalInput.value = '';
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (_historyIdx > 0) {
      _historyIdx--;
      terminalInput.value = _cmdHistory[_historyIdx];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_historyIdx < _cmdHistory.length - 1) {
      _historyIdx++;
      terminalInput.value = _cmdHistory[_historyIdx];
    } else {
      _historyIdx = _cmdHistory.length;
      terminalInput.value = '';
    }
  }
});

// Quick-command buttons
document.querySelectorAll('.quick-cmds button').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    if (cmd) sendCommand(cmd);
  });
});

// ─── Connect / Disconnect ────────────────────────────────
btnConnect.addEventListener('click', async () => {
  try {
    if (!_serial) initSerial();
    await _serial.connect();
  } catch (err) {
    if (err.name !== 'NotFoundError') { // user cancelled picker
      appendTerminal('Connection error: ' + err.message + '\n', 'err');
    }
  }
});

btnDisconnect.addEventListener('click', async () => {
  if (_serial) await _serial.disconnect();
});

// ─── Tabs ────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = $(`#tab-${btn.dataset.tab}`);
    panel.classList.add('active');

    // Refresh CodeMirror when switching to files tab
    if (btn.dataset.tab === 'files' && _editor) {
      setTimeout(() => _editor.refresh(), 0);
    }
  });
});

// ─── Busy overlay ────────────────────────────────────────
function showBusy(msg) {
  _busy = true;
  busyText.textContent = msg;
  busyOverlay.classList.add('active');
  terminalInput.disabled = true;
}

function hideBusy() {
  _busy = false;
  busyOverlay.classList.remove('active');
  if (_serial && _serial.isConnected()) {
    terminalInput.disabled = false;
  }
  // Restore terminal data handler
  _dataCallback = null;
}

// ─── CodeMirror editor ───────────────────────────────────
function initEditor() {
  if (_editor) return;
  editorContainer.innerHTML = '';
  _editor = CodeMirror(editorContainer, {
    value: '',
    mode: 'python',
    theme: 'material-darker',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
    readOnly: true,
  });
}

function loadIntoEditor(filename, content) {
  if (!_editor) initEditor();
  _activeFile = filename;
  editorFilename.textContent = filename;
  _editor.setValue(content);
  _editor.setOption('readOnly', false);
  _editor.clearHistory();
  btnSave.disabled = false;
  setTimeout(() => _editor.refresh(), 0);
}

// ─── File list ───────────────────────────────────────────
async function refreshFileList() {
  if (!_serial || !_serial.isConnected()) {
    appendTerminal('Not connected — cannot list files\n', 'err');
    return;
  }
  showBusy('Loading file list...');
  try {
    const files = await _fileManager.listFiles();
    renderFileList(files);
    appendTerminal(`Found ${files.length} files\n`, 'sys');
  } catch (err) {
    appendTerminal('Error listing files: ' + err.message + '\n', 'err');
  } finally {
    hideBusy();
  }
}

function renderFileList(files) {
  fileListEl.innerHTML = '';
  for (const name of files) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = name;
    if (name === _activeFile) div.classList.add('active');
    div.addEventListener('click', () => openFile(name));
    fileListEl.appendChild(div);
  }
}

async function openFile(filename) {
  if (!_serial || !_serial.isConnected()) return;
  showBusy(`Reading ${filename}...`);
  try {
    const content = await _fileManager.readFile(filename);
    if (!_editor) initEditor();
    loadIntoEditor(filename, content);
    // Update active state in file list
    fileListEl.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.textContent === filename);
    });
  } catch (err) {
    appendTerminal('Error reading ' + filename + ': ' + err.message + '\n', 'err');
  } finally {
    hideBusy();
  }
}

// ─── Save ────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  if (!_activeFile || !_editor || !_serial || !_serial.isConnected()) return;
  const content = _editor.getValue();
  showBusy(`Saving ${_activeFile}...`);
  try {
    await _fileManager.writeFile(_activeFile, content);
    appendTerminal(`Saved ${_activeFile} (${content.length} bytes)\n`, 'sys');
  } catch (err) {
    appendTerminal('Error saving ' + _activeFile + ': ' + err.message + '\n', 'err');
  } finally {
    hideBusy();
  }
});

// ─── Restart firmware ────────────────────────────────────
btnRestart.addEventListener('click', async () => {
  if (!_serial || !_serial.isConnected()) return;
  showBusy('Restarting firmware...');
  try {
    // Interrupt and soft reset
    _dataCallback = () => {}; // swallow REPL output during restart
    await _serial.send('\x03');
    await _sleep(100);
    await _serial.send('\x03');
    await _sleep(200);
    await _serial.send('\x04'); // Ctrl-D soft reset
    await _sleep(1000);
    appendTerminal('Firmware restarted\n', 'sys');
  } catch (err) {
    appendTerminal('Error restarting: ' + err.message + '\n', 'err');
  } finally {
    hideBusy();
  }
});

// ─── Upload files ────────────────────────────────────────
btnUpload.addEventListener('click', () => {
  if (!_serial || !_serial.isConnected()) {
    appendTerminal('Not connected — cannot upload\n', 'err');
    return;
  }
  uploadInput.click();
});

uploadInput.addEventListener('change', async () => {
  const files = Array.from(uploadInput.files);
  if (!files.length) return;
  uploadInput.value = ''; // reset for next upload

  showBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
  try {
    const entries = [];
    for (const file of files) {
      entries.push({ name: file.name, content: await file.text() });
    }
    await _fileManager.writeFiles(entries, (name, i, total) => {
      appendTerminal(`Uploaded ${name} (${i + 1}/${total})\n`, 'sys');
      busyText.textContent = `Uploading ${i + 2}/${total}...`;
    });
    appendTerminal(`Done — ${entries.length} file${entries.length > 1 ? 's' : ''} uploaded\n`, 'sys');
    await refreshFileList();
  } catch (err) {
    appendTerminal('Upload error: ' + err.message + '\n', 'err');
    hideBusy();
  }
  // refreshFileList calls hideBusy
});

// ─── Load firmware from GitHub ──────────────────────────
const FIRMWARE_API = 'https://api.github.com/repos/zymsys/rallylab/contents/firmware';

btnLoadGithub.addEventListener('click', async () => {
  if (!_serial || !_serial.isConnected()) {
    appendTerminal('Not connected — cannot load firmware\n', 'err');
    return;
  }

  showBusy('Fetching file list from GitHub...');
  try {
    // Fetch directory listing
    const resp = await fetch(FIRMWARE_API);
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
    const listing = await resp.json();
    const pyFiles = listing.filter(f => f.name.endsWith('.py') && f.type === 'file');
    if (!pyFiles.length) throw new Error('No .py files found in firmware/');

    appendTerminal(`Found ${pyFiles.length} firmware files on GitHub\n`, 'sys');

    // Fetch each file's raw content
    const entries = [];
    for (let i = 0; i < pyFiles.length; i++) {
      busyText.textContent = `Downloading ${pyFiles[i].name} (${i + 1}/${pyFiles.length})...`;
      const raw = await fetch(pyFiles[i].download_url);
      if (!raw.ok) throw new Error(`Failed to download ${pyFiles[i].name}`);
      entries.push({ name: pyFiles[i].name, content: await raw.text() });
    }

    // Write all files to Pico
    busyText.textContent = `Writing files to Pico...`;
    await _fileManager.writeFiles(entries, (name, i, total) => {
      appendTerminal(`Wrote ${name} (${i + 1}/${total})\n`, 'sys');
      busyText.textContent = `Writing ${i + 2}/${total}...`;
    });
    appendTerminal(`Done — ${entries.length} firmware files loaded from GitHub\n`, 'sys');
    await refreshFileList();
  } catch (err) {
    appendTerminal('Error loading from GitHub: ' + err.message + '\n', 'err');
    hideBusy();
  }
});

// ─── Refresh button ──────────────────────────────────────
btnRefresh.addEventListener('click', () => refreshFileList());

// ─── Keyboard shortcut ──────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl+S → save
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (!btnSave.disabled) btnSave.click();
  }
});

// ─── Helpers ─────────────────────────────────────────────
function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
