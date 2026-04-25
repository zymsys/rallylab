/**
 * broadcast.js — BroadcastChannel wrapper for operator→audience messaging.
 */

const CHANNEL_NAME = 'rallylab-race';
const ZOOM_STORAGE_KEY = 'rallylab-audience-zoom';

// ─── Operator Side ──────────────────────────────────────────────

let _operatorChannel = null;
let _lastMessage = null;
let _lastZoom = (() => {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch { return 1; }
})();

function getOperatorChannel() {
  if (!_operatorChannel) {
    _operatorChannel = new BroadcastChannel(CHANNEL_NAME);
    _operatorChannel.onmessage = (e) => {
      if (e.data?.type === 'REQUEST_STATE') {
        _operatorChannel.postMessage({ type: 'SET_ZOOM', level: _lastZoom });
        if (_lastMessage) _operatorChannel.postMessage(_lastMessage);
      }
    };
  }
  return _operatorChannel;
}

function send(message) {
  _lastMessage = message;
  getOperatorChannel().postMessage(message);
}

/** Eagerly create the operator channel so REQUEST_STATE is handled immediately. */
export function initOperatorChannel() {
  getOperatorChannel();
}

export function sendWelcome(rallyName) {
  send({ type: 'SHOW_WELCOME', rally_name: rallyName });
}

export function sendStaging(sectionName, heatNumber, lanes, nextHeat) {
  send({
    type: 'SHOW_STAGING',
    section_name: sectionName,
    heat_number: heatNumber,
    lanes,
    next_heat: nextHeat || null
  });
}

export function sendResults(sectionName, heatNumber, results) {
  send({
    type: 'SHOW_RESULTS',
    section_name: sectionName,
    heat_number: heatNumber,
    results
  });
}

export function sendLeaderboard(sectionName, standings) {
  send({
    type: 'SHOW_LEADERBOARD',
    section_name: sectionName,
    standings
  });
}

export function sendSectionComplete(sectionName, standings) {
  send({
    type: 'SHOW_SECTION_COMPLETE',
    section_name: sectionName,
    standings
  });
}

export function sendRevealNext() {
  getOperatorChannel().postMessage({ type: 'REVEAL_NEXT' });
}

export function sendRevealAll() {
  getOperatorChannel().postMessage({ type: 'REVEAL_ALL' });
}

export function sendZoom(level) {
  _lastZoom = level;
  try { localStorage.setItem(ZOOM_STORAGE_KEY, String(level)); } catch {}
  getOperatorChannel().postMessage({ type: 'SET_ZOOM', level });
}

export function getZoom() {
  return _lastZoom;
}

// ─── Audience Side ──────────────────────────────────────────────

let _audienceChannel = null;

export function onMessage(callback) {
  if (_audienceChannel) _audienceChannel.close();
  _audienceChannel = new BroadcastChannel(CHANNEL_NAME);
  _audienceChannel.onmessage = (e) => callback(e.data);
}

export function requestState() {
  if (_audienceChannel) {
    _audienceChannel.postMessage({ type: 'REQUEST_STATE' });
  }
}

// ─── Inter-Tab Sync (operator ↔ registrar) ──────────────────────

const SYNC_CHANNEL_NAME = 'rallylab-sync';
let _syncChannel = null;

function getSyncChannel() {
  if (!_syncChannel) {
    _syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  }
  return _syncChannel;
}

export function notifyEventsChanged() {
  getSyncChannel().postMessage({ type: 'EVENTS_CHANGED' });
}

export function onSyncMessage(callback) {
  getSyncChannel().onmessage = (e) => callback(e.data);
}

// ─── Cleanup ────────────────────────────────────────────────────

export function close() {
  if (_operatorChannel) { _operatorChannel.close(); _operatorChannel = null; _lastMessage = null; }
  if (_audienceChannel) { _audienceChannel.close(); _audienceChannel = null; }
  if (_syncChannel) { _syncChannel.close(); _syncChannel = null; }
}
