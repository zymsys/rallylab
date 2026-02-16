/**
 * broadcast.js — BroadcastChannel wrapper for operator→audience messaging.
 */

const CHANNEL_NAME = 'kubkars-race';

// ─── Operator Side ──────────────────────────────────────────────

let _operatorChannel = null;

function getOperatorChannel() {
  if (!_operatorChannel) {
    _operatorChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  return _operatorChannel;
}

function send(message) {
  getOperatorChannel().postMessage(message);
}

export function sendWelcome(eventName) {
  send({ type: 'SHOW_WELCOME', event_name: eventName });
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
  send({ type: 'REVEAL_NEXT' });
}

export function sendRevealAll() {
  send({ type: 'REVEAL_ALL' });
}

// ─── Audience Side ──────────────────────────────────────────────

let _audienceChannel = null;

export function onMessage(callback) {
  if (_audienceChannel) _audienceChannel.close();
  _audienceChannel = new BroadcastChannel(CHANNEL_NAME);
  _audienceChannel.onmessage = (e) => callback(e.data);
}

// ─── Inter-Tab Sync (operator ↔ registrar) ──────────────────────

const SYNC_CHANNEL_NAME = 'kubkars-sync';
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
  if (_operatorChannel) { _operatorChannel.close(); _operatorChannel = null; }
  if (_audienceChannel) { _audienceChannel.close(); _audienceChannel = null; }
  if (_syncChannel) { _syncChannel.close(); _syncChannel = null; }
}
