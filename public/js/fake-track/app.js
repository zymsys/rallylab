/**
 * fake-track/app.js — Fake track simulator entry point.
 * BroadcastChannel listener + state machine:
 *   idle → staged → racing → resetting → idle
 */

import { computeAllRaceTimes, resetProfiles } from './car-profiles.js';
import {
  createTrack, stageCars, runRace,
  showResetButton, resetTrack, showIdle
} from './track-renderer.js';

const TRACK_CHANNEL = 'kubkars-track';
const LANE_COUNT = 6;

// ─── State ──────────────────────────────────────────────────────

let _state = 'idle'; // idle | staged | racing | resetting
let _channel = null;
let _currentRequestId = null;
let _raceAnimation = null; // { cancel }

const statusEl = () => document.getElementById('ft-status');
const container = () => document.getElementById('track');

function setStatus(text) {
  const el = statusEl();
  if (el) el.textContent = text;
}

function setState(newState) {
  _state = newState;
  document.body.dataset.trackState = newState;
}

// ─── Channel Setup ──────────────────────────────────────────────

function initChannel() {
  _channel = new BroadcastChannel(TRACK_CHANNEL);

  // Announce presence immediately and on interval
  _channel.postMessage({ type: 'TRACK_HELLO' });
  setInterval(() => {
    _channel.postMessage({ type: 'TRACK_HELLO' });
  }, 2000);

  _channel.onmessage = (e) => handleMessage(e.data);
}

// ─── Message Handler ────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'CONNECT':
      _channel.postMessage({
        type: 'CONNECTED',
        requestId: msg.requestId,
        lane_count: LANE_COUNT
      });
      setStatus('Connected');
      break;

    case 'PING':
      // Respond with hello so track-connection detects us
      _channel.postMessage({ type: 'TRACK_HELLO' });
      break;

    case 'STAGE_RACE':
      handleStageRace(msg);
      break;

    case 'WAIT_GATE':
      handleWaitGate(msg);
      break;

    case 'CANCEL':
      handleCancel(msg);
      break;
  }
}

// ─── Stage Race ─────────────────────────────────────────────────

function handleStageRace(msg) {
  // Cancel any ongoing animation
  if (_raceAnimation) {
    _raceAnimation.cancel();
    _raceAnimation = null;
  }

  _currentRequestId = msg.requestId;
  const lanes = msg.lanes; // [{ lane, car_number, name }]

  setState('staged');
  setStatus(`Heat — Cars staged!`);

  // Compute times upfront
  const times_ms = computeAllRaceTimes(lanes);

  // Render staged cars
  resetTrack(container());
  stageCars(container(), lanes);

  // Enable gate lever — on click, start the race
  const gate = container().querySelector('.ft-gate-btn');
  if (gate) {
    gate.disabled = false;
    gate.classList.add('ft-gate-ready');
    gate.onclick = () => startRace(lanes, times_ms);
  }
}

// ─── Start Race ─────────────────────────────────────────────────

function startRace(lanes, times_ms) {
  setState('racing');
  setStatus('Racing...');

  const gate = container().querySelector('.ft-gate-btn');
  if (gate) {
    gate.disabled = true;
    gate.classList.remove('ft-gate-ready');
    gate.classList.add('ft-gate-released');
    // Reset gate visual after animation
    setTimeout(() => gate.classList.remove('ft-gate-released'), 600);
  }

  _raceAnimation = runRace(container(), lanes, times_ms, () => {
    // Race complete callback
    _raceAnimation = null;
    setState('idle');
    setStatus('Race complete — waiting for operator...');

    _channel.postMessage({
      type: 'RACE_COMPLETE',
      requestId: _currentRequestId,
      times_ms
    });
    _currentRequestId = null;
  });
}

// ─── Wait Gate (Reset Switches) ────────────────────────────────

function handleWaitGate(msg) {
  _currentRequestId = msg.requestId;
  setState('resetting');
  setStatus('Reset switches to continue');

  showResetButton(container(), () => {
    setState('idle');
    setStatus('Gate ready — waiting for operator...');

    _channel.postMessage({
      type: 'GATE_READY',
      requestId: _currentRequestId
    });
    _currentRequestId = null;
  });
}

// ─── Cancel ─────────────────────────────────────────────────────

function handleCancel(msg) {
  if (_raceAnimation) {
    _raceAnimation.cancel();
    _raceAnimation = null;
  }

  setState('idle');
  setStatus('Cancelled — waiting for operator...');
  resetTrack(container());
}

// ─── Init ───────────────────────────────────────────────────────

function init() {
  createTrack(container(), LANE_COUNT);
  showIdle(container());
  initChannel();
}

init();
