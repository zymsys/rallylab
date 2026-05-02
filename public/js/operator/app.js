/**
 * operator/app.js — Race day operator entry point.
 * Hash routing, state management, race loop.
 * Offline-first: no auth required, uses IndexedDB for event storage.
 */

import { isDemoMode } from '../config.js';
import { openStore, appendEvent as storeAppend, getAllEvents, clear as clearStore } from '../event-store.js';
import { rebuildState, deriveRaceDayPhase, getActiveStart, getLatestStart, getStart } from '../state-manager.js';
import { generateSchedule, regenerateAfterRemoval, regenerateAfterLateArrival, generateCatchUpHeats } from '../scheduler.js';
import {
  connect as trackConnect, waitForRace, waitForGate,
  getInfo as trackInfo, isConnected, isUsingFakeTrack,
  triggerManualRace, triggerManualGate,
  connectWifi, disconnectWifi, isUsingWifi, getSavedTrackIp,
  getTrackMode, getWifiError,
  connectSerial, disconnectSerial, isUsingSerial, isSerialSupported,
  sendSerialCommand, startLearnMode, subscribeTrackEvents
} from '../track-connection.js';
import { sendWelcome, sendStaging, sendResults, sendZoom, getZoom, notifyEventsChanged, onSyncMessage, initOperatorChannel } from '../broadcast.js';
import { getUser, getClient, signOut, initAuth } from '../supabase.js';
import { startSync, stopSync, subscribeToRally, onInboundEvents } from '../sync-worker.js';
import { initSyncIndicator } from '../shared/sync-indicator.js';
import {
  renderRallyList, renderRallyHome, renderCheckIn,
  renderLiveConsole, renderSectionComplete
} from './screens.js';
import {
  isSupported as isUSBBackupSupported,
  configure as configureUSBBackupImpl,
  isConfigured as isUSBBackupConfigured,
  disable as disableUSBBackup,
  onEventAppended as usbOnEventAppended,
  restore as restoreUSBBackup,
  reauthorize as reauthorizeUSBBackupImpl
} from '../usb-backup.js';

const app = () => document.getElementById('app');
const breadcrumbs = () => document.getElementById('breadcrumbs');

// ─── Lane Helpers ─────────────────────────────────────────────────

/**
 * Get the available lanes for a section, falling back to a contiguous
 * range derived from the track hardware lane_count.
 * @param {string} sectionId
 * @returns {Array<number>}
 */
function getAvailableLanes(sectionId, startNumber) {
  const sec = _state?.race_day.sections[sectionId];
  if (sec) {
    const start = startNumber
      ? getStart(sec, startNumber)
      : (getActiveStart(sec) || getLatestStart(sec));
    if (start?.available_lanes) return start.available_lanes;
  }
  const count = trackInfo().lane_count;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Get the hardware track lane count (for UI lane pickers).
 * @returns {number}
 */
function getTrackLaneCount() {
  return trackInfo().lane_count;
}

// ─── Audience Broadcast Helpers ──────────────────────────────────

/** Attach group_name to each row (lane/result/standing) for audience display. */
export function withGroupNames(section, rows) {
  if (!rows) return rows;
  return rows.map(row => {
    if (row.group_name !== undefined) return row;
    const p = section.participants.find(pp => pp.car_number === row.car_number);
    const gid = row.group_id || p?.group_id;
    const name = gid ? (_state?.groups?.[gid]?.group_name || '') : '';
    return { ...row, group_name: name };
  });
}

/**
 * Get the current heat number for a section by finding the first
 * schedule heat without a result. Returns 0 if no schedule or no heats.
 * @param {string} sectionId
 * @returns {number}
 */
function getLastCompletedHeatNumber(sectionId, startNumber) {
  const sec = _state?.race_day.sections[sectionId];
  if (!sec) return 0;
  const start = startNumber
    ? getStart(sec, startNumber)
    : (getActiveStart(sec) || getLatestStart(sec));
  if (!start) return 0;
  const completedNums = Object.keys(start.results || {}).map(Number);
  return completedNums.length > 0 ? Math.max(...completedNums) : 0;
}

// ─── Module State ────────────────────────────────────────────────

let _state = null;
let _liveSection = null;  // { sectionId, schedule, stagingHeat }
let _raceAbort = null;     // AbortController for current race loop
let _rotationResolver = null; // Resolver for rotation decision prompt

// ─── Track Phase ─────────────────────────────────────────────────
// Tracks what the race loop is currently waiting on, so the operator
// can see at a glance what the system expects to happen next.

const TRACK_PHASE_LOG_MAX = 20;
let _trackPhase = 'idle';      // current phase label
let _trackPhaseLog = [];       // [{ phase, detail, time }] most recent last

function setTrackPhase(phase, detail) {
  _trackPhase = phase;
  _trackPhaseLog.push({ phase, detail: detail || null, time: Date.now() });
  if (_trackPhaseLog.length > TRACK_PHASE_LOG_MAX) {
    _trackPhaseLog = _trackPhaseLog.slice(-TRACK_PHASE_LOG_MAX);
  }
}

// Test bridge — exposes internal state for E2E assertions
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__rallylab', {
    get: () => ({ state: _state, liveSection: _liveSection })
  });
}

// ─── Hash Routing ────────────────────────────────────────────────

function encodeHash(screenName, params) {
  const parts = [screenName];
  for (const [k, v] of Object.entries(params)) {
    if (v != null) parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return '#' + parts.join('/');
}

function decodeHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (!raw) return null;
  const parts = raw.split('/');
  const screenName = parts[0];
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq !== -1) {
      params[parts[i].slice(0, eq)] = decodeURIComponent(parts[i].slice(eq + 1));
    }
  }
  return { screenName, params };
}

const screens = {
  'rally-list': renderRallyList,
  'rally-home': renderRallyHome,
  'check-in': renderCheckIn,
  'live-console': renderLiveConsole,
  'section-complete': renderSectionComplete
};

export function navigate(screenName, params = {}, { replace = false } = {}) {
  const hash = encodeHash(screenName, params);
  if (replace) {
    history.replaceState(null, '', hash);
  } else if (location.hash !== hash) {
    history.pushState(null, '', hash);
  }

  renderScreen(screenName, params);
}

function renderScreen(screenName, params) {
  const container = app();
  const renderFn = screens[screenName];
  if (!renderFn) {
    container.innerHTML = '<p>Unknown screen</p>';
    return;
  }

  updateBreadcrumbs(screenName, params);
  updateLiveBar(screenName, params);

  // Broadcast state to audience display
  if (screenName === 'rally-home' && _state?.rally_name) {
    sendWelcome(_state.rally_name);
    // Restore any race-day events from cloud (runs in background)
    tryRestore(_state.rally_id);
  } else if (screenName === 'live-console' && _liveSection?.stagingHeat) {
    const sec = _state.race_day.sections[_liveSection.sectionId];
    const heat = _liveSection.stagingHeat;
    const schedule = _liveSection.schedule;
    const heatIdx = schedule.heats.findIndex(h => h.heat_number === heat.heat_number);
    const nextHeat = heatIdx >= 0 && heatIdx + 1 < schedule.heats.length ? schedule.heats[heatIdx + 1] : null;
    sendStaging(sec.section_name, heat.heat_number, withGroupNames(sec, heat.lanes),
      nextHeat ? { heat_number: nextHeat.heat_number, lanes: withGroupNames(sec, nextHeat.lanes) } : null);
  }

  const ctx = {
    state: _state,
    liveSection: _liveSection,
    getStartNumber: () => _liveSection?.startNumber || null,
    navigate,
    appendEvent: appendAndRebuild,
    startSection,
    resumeSection,
    declareRerun,
    declareDnfRerun,
    endSectionEarly,
    removeCar,
    changeLanes,
    correctLanes,
    showToast,
    getSchedule: () => _liveSection?.schedule,
    getStagingHeat: () => _liveSection?.stagingHeat || null,
    isAwaitingRotationDecision: () => _liveSection?.awaitingRotationDecision || false,
    getAvailableLanes,
    getTrackLaneCount,
    isUsingFakeTrack,
    triggerManualRace,
    triggerManualGate,
    connectWifi,
    disconnectWifi,
    isUsingWifi,
    getSavedTrackIp,
    getTrackMode,
    getWifiError,
    connectSerial,
    disconnectSerial,
    isUsingSerial,
    isSerialSupported,
    sendSerialCommand,
    startLearnMode,
    subscribeTrackEvents,
    configureUSBBackup,
    reauthorizeUSBBackup,
    disableUSBBackup,
    isUSBBackupConfigured,
    isUSBBackupSupported,
    addRotation,
    completeSection,
    renderCurrentScreen,
    getTrackPhase: () => _trackPhase,
    getTrackPhaseLog: () => _trackPhaseLog,
    pauseRaceLoop: () => { if (_raceAbort) _raceAbort.abort(); },
    openCloudRally,
    isCloudAvailable: () => !isDemoMode() && !!getUser()
  };

  const result = renderFn(container, params, ctx);
  if (result && typeof result.catch === 'function') {
    result.catch(e => {
      container.innerHTML = `<p class="form-error">Error: ${e.message}</p>`;
      console.error(e);
    });
  }
}

// ─── Back / Forward ──────────────────────────────────────────────

window.addEventListener('popstate', () => {
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    renderScreen(route.screenName, route.params);
  } else {
    renderScreen('rally-list', {});
  }
});

// ─── Breadcrumbs ─────────────────────────────────────────────────

function updateBreadcrumbs(screenName, params) {
  const bc = breadcrumbs();
  bc.innerHTML = '';

  const items = [];
  if (screenName !== 'rally-list') {
    items.push({ label: 'Rallies', screen: 'rally-list' });
  }

  if (['check-in', 'live-console', 'section-complete'].includes(screenName)) {
    items.push({ label: 'Rally', screen: 'rally-home' });
  }

  if (screenName === 'check-in') items.push({ label: 'Check-In', screen: null });
  if (screenName === 'live-console') items.push({ label: 'Live Console', screen: null });
  if (screenName === 'section-complete') items.push({ label: 'Complete', screen: null });

  items.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'separator';
      sep.textContent = '/';
      bc.appendChild(sep);
    }

    if (item.screen && item.screen !== screenName) {
      const a = document.createElement('a');
      a.href = encodeHash(item.screen, {});
      a.textContent = item.label;
      a.onclick = (e) => { e.preventDefault(); navigate(item.screen, {}); };
      bc.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = item.label;
      bc.appendChild(span);
    }
  });
}

// ─── Live Bar ────────────────────────────────────────────────────

function updateLiveBar(screenName, params) {
  const bar = document.getElementById('live-bar');
  const btn = document.getElementById('live-bar-btn');
  const text = document.getElementById('live-bar-text');

  if (!_liveSection || screenName === 'live-console') {
    bar.classList.add('hidden');
    return;
  }

  const sec = _state?.race_day.sections[_liveSection.sectionId];
  if (!sec) {
    bar.classList.add('hidden');
    return;
  }
  const activeStart = getActiveStart(sec);
  if (!activeStart) {
    bar.classList.add('hidden');
    return;
  }

  const startLabel = sec.next_start_number > 2
    ? `${sec.section_name} (Rally ${activeStart.start_number})`
    : sec.section_name;
  text.textContent = `${startLabel} — Race in progress`;
  bar.classList.remove('hidden');
  btn.onclick = () => navigate('live-console', { sectionId: _liveSection.sectionId });
}

// ─── Toast System ────────────────────────────────────────────────

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 300ms';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Event Append + State Rebuild ────────────────────────────────

export async function appendAndRebuild(payload) {
  // Ensure rally_id is set from current state so sync-worker can upload correctly
  if (!payload.rally_id && _state?.rally_id) {
    payload = { ...payload, rally_id: _state.rally_id };
  }
  await storeAppend(payload);
  await rebuildFromStore();
  notifyEventsChanged();
  usbOnEventAppended(getAllEvents, _state?.rally_id).catch(e => console.warn('USB backup write failed:', e));
  return _state;
}

export async function rebuildFromStore() {
  const events = await getAllEvents();
  _state = rebuildState(events);
}

export async function clearAndRebuild() {
  await clearStore();
  _state = rebuildState([]);
  _liveSection = null;
}

/**
 * Bootstrap a rally from Supabase: pull all events into IndexedDB, subscribe
 * to Realtime push for live updates, rebuild state, and navigate to its home.
 * Used by the rally-list "Open from Cloud" picker.
 */
export async function openCloudRally(rallyId) {
  if (isDemoMode() || !rallyId) return;
  const client = await getClient();
  const user = getUser();
  if (user) startSync(client, user.id);  // before subscribeToRally so echo dedup sees _userId
  await subscribeToRally(client, rallyId);
  await rebuildFromStore();
  navigate('rally-home', {});
}

// ─── Schedule Reconstruction ────────────────────────────────────

/**
 * Reconstruct the schedule for a started section by replaying events.
 * The scheduler is fully deterministic, so replaying the same sequence
 * of generate/regenerate calls produces the identical schedule.
 * Derives availableLanes from SectionStarted + LanesChanged events.
 */
async function reconstructSchedule(sectionId, startNumber) {
  const events = await getAllEvents();
  // Filter to section events that belong to this start (or have no start_number for compat)
  const sectionEvents = events.filter(e => {
    if (e.section_id !== sectionId) return false;
    // CarArrived is section-level, always include
    if (e.type === 'CarArrived') return true;
    // Events with a start_number must match; events without one are legacy (start 1)
    if (e.start_number != null) return e.start_number === startNumber;
    // Legacy events without start_number — include only for start 1
    return startNumber === 1 || startNumber == null;
  });

  const arrived = new Set();
  const removed = new Set();
  let schedule = null;
  let started = false;
  let currentHeat = 0;
  let availableLanes = null;
  const completedCarNumbers = new Set();
  let completedResultCount = 0;
  const accumulatedResults = {}; // heat_number → result, for deterministic reconstruction

  // We also need participant data — pull from state
  const sec = _state.race_day.sections[sectionId];
  if (!sec) throw new Error('Section not found');

  for (const evt of sectionEvents) {
    if (evt.type === 'CarArrived') {
      arrived.add(evt.car_number);
      if (started && schedule) {
        const allParticipants = sec.participants
          .filter(p => arrived.has(p.car_number) && !removed.has(p.car_number));
        schedule = regenerateAfterLateArrival(schedule, allParticipants, currentHeat, availableLanes);

        // Generate catch-up heats, inserted immediately after currentHeat
        const allCatchUpHeats = [];
        for (const p of allParticipants) {
          if (!completedCarNumbers.has(p.car_number) && completedResultCount > 0) {
            const catchUpHeats = generateCatchUpHeats(
              p, completedResultCount, availableLanes, 0
            );
            allCatchUpHeats.push(...catchUpHeats);
          }
        }

        if (allCatchUpHeats.length > 0) {
          const completed = schedule.heats.filter(h => h.heat_number <= currentHeat);
          const remaining = schedule.heats.filter(h => h.heat_number > currentHeat);
          let nextNum = currentHeat + 1;
          for (const h of allCatchUpHeats) { h.heat_number = nextNum++; }
          for (const h of remaining) { h.heat_number = nextNum++; }
          schedule.heats = [...completed, ...allCatchUpHeats, ...remaining];
          schedule.metadata.total_heats = schedule.heats.length;
        }
      }
    } else if (evt.type === 'CarRemoved') {
      removed.add(evt.car_number);
      if (started && schedule) {
        const remaining = sec.participants
          .filter(p => arrived.has(p.car_number) && !removed.has(p.car_number));
        if (remaining.length >= 2) {
          schedule = regenerateAfterRemoval(schedule, remaining, currentHeat, availableLanes);
        }
      }
    } else if (evt.type === 'SectionStarted') {
      started = true;
      availableLanes = evt.available_lanes || getAvailableLanes(sectionId, startNumber);
      const participants = sec.participants
        .filter(p => arrived.has(p.car_number) && !removed.has(p.car_number));
      schedule = generateSchedule({ participants, available_lanes: availableLanes });
    } else if (evt.type === 'LanesChanged') {
      availableLanes = evt.available_lanes;
      if (started && schedule) {
        const participants = sec.participants
          .filter(p => arrived.has(p.car_number) && !removed.has(p.car_number));
        if (participants.length >= 2) {
          schedule = generateSchedule({ participants, available_lanes: availableLanes });
          // Renumber after completed heats
          const renumbered = schedule.heats.map((heat, i) => ({
            ...heat, heat_number: currentHeat + i + 1
          }));
          const completedHeats = schedule.heats.length > 0 ? [] : [];
          schedule = { ...schedule, heats: renumbered, metadata: { ...schedule.metadata, total_heats: renumbered.length } };
        }
      }
    } else if (evt.type === 'RaceCompleted' || evt.type === 'ResultManuallyEntered') {
      currentHeat = evt.heat_number;
      completedResultCount++;
      // Track result for deterministic reconstruction of rotation schedules
      accumulatedResults[evt.heat_number] = {
        type: evt.type,
        heat_number: evt.heat_number,
        heat: evt.heat_number,
        lanes: evt.lanes || [],
        times_ms: evt.times_ms,
        rankings: evt.rankings,
        timestamp: evt.timestamp
      };
      // Update completedCarNumbers from the result's lanes
      const lanes = evt.lanes || [];
      for (const lane of lanes) {
        completedCarNumbers.add(lane.car_number);
      }
    } else if (evt.type === 'RotationAdded') {
      // Regenerate a speed-matched rotation using only results known at this point
      if (started && schedule) {
        const participants = sec.participants
          .filter(p => arrived.has(p.car_number) && !removed.has(p.car_number));
        const results = Object.values(accumulatedResults);
        const newSchedule = generateSchedule({
          participants,
          available_lanes: availableLanes,
          results
        });
        const lastHeatNum = schedule.heats.length > 0
          ? Math.max(...schedule.heats.map(h => h.heat_number))
          : 0;
        const renumberedHeats = newSchedule.heats.map((heat, i) => ({
          ...heat,
          heat_number: lastHeatNum + i + 1
        }));
        schedule.heats.push(...renumberedHeats);
        schedule.metadata.total_heats = schedule.heats.length;
      }
    }
  }

  return schedule;
}

// ─── Section Start + Race Loop ───────────────────────────────────

async function startSection(sectionId, availableLanes) {
  if (_raceAbort) _raceAbort.abort();

  if (!isConnected()) {
    await trackConnect();
  }

  const sec = _state.race_day.sections[sectionId];
  const startNumber = sec.next_start_number;

  // Use provided lanes or fall back to full track
  if (!availableLanes) {
    availableLanes = getAvailableLanes(sectionId);
  }

  // Get arrived, non-removed participants (arrived is section-level)
  const arrivedSet = new Set(sec.arrived);
  const participants = sec.participants
    .filter(p => arrivedSet.has(p.car_number));

  if (participants.length < 2) {
    showToast('At least 2 checked-in cars required', 'error');
    return;
  }

  // Emit SectionStarted with lane configuration and start_number
  await appendAndRebuild({
    type: 'SectionStarted',
    section_id: sectionId,
    start_number: startNumber,
    available_lanes: availableLanes,
    timestamp: Date.now()
  });

  // Generate schedule
  const schedule = generateSchedule({ participants, available_lanes: availableLanes });

  _liveSection = { sectionId, startNumber, schedule };
  setTrackPhase('idle', 'Section started');

  // Ensure background sync is running (may already be started at init)
  beginSync();

  // Navigate to live console
  navigate('live-console', { sectionId });

  // Start race loop
  runRaceLoop(sectionId);
}

// ─── Resume Section ─────────────────────────────────────────────

async function resumeSection(sectionId) {
  if (_raceAbort) _raceAbort.abort();

  if (!isConnected()) {
    await trackConnect();
  }

  const sec = _state.race_day.sections[sectionId];
  const active = getActiveStart(sec);
  const startNumber = active ? active.start_number : getLatestStart(sec)?.start_number;

  const schedule = await reconstructSchedule(sectionId, startNumber);

  if (!schedule) {
    showToast('Could not reconstruct schedule', 'error');
    return;
  }

  _liveSection = { sectionId, startNumber, schedule, stagingHeat: null };
  setTrackPhase('idle', 'Resuming');

  // Re-render so the resume button is replaced with heat controls
  renderCurrentScreen();

  runRaceLoop(sectionId);
}

/**
 * Race loop: stage → wait for race → record results → wait for gate → repeat.
 * With fake track: gate release and reset clicks drive the pacing.
 * Without fake track: operator clicks "Run Heat" / "Next Heat" buttons.
 */
async function runRaceLoop(sectionId) {
  _raceAbort = new AbortController();
  const signal = _raceAbort.signal;

  try {
    const schedule = _liveSection.schedule;
    const startNumber = _liveSection.startNumber;
    const sec = () => _state.race_day.sections[sectionId];
    const startResults = () => {
      const start = getStart(sec(), startNumber);
      return start ? (start.results || {}) : {};
    };

    // Find next heat to run (first heat without a result)
    let heatIdx = 0;
    for (let i = 0; i < schedule.heats.length; i++) {
      const hn = schedule.heats[i].heat_number;
      if (!startResults()[hn]) {
        heatIdx = i;
        break;
      }
      heatIdx = i + 1;
    }

    while (heatIdx < schedule.heats.length) {
      if (signal.aborted) return;

      const heat = schedule.heats[heatIdx];

      // Set transient staging state (not persisted)
      _liveSection.stagingHeat = heat;
      setTrackPhase('staging', `Heat ${heat.heat_number}`);

      // Render staging + broadcast
      renderCurrentScreen();
      const nextHeat = heatIdx + 1 < schedule.heats.length ? schedule.heats[heatIdx + 1] : null;
      sendStaging(sec().section_name, heat.heat_number, withGroupNames(sec(), heat.lanes),
        nextHeat ? { heat_number: nextHeat.heat_number, lanes: withGroupNames(sec(), nextHeat.lanes) } : null);

      // Wait for race (fake track: blocks on gate click; manual: blocks on button)
      setTrackPhase('waiting-for-race', `Heat ${heat.heat_number}`);
      renderCurrentScreen();
      const times_ms = await waitForRace(heat.lanes, signal);

      // Emit RaceCompleted with lane assignments
      await appendAndRebuild({
        type: 'RaceCompleted',
        section_id: sectionId,
        start_number: _liveSection.startNumber,
        heat_number: heat.heat_number,
        lanes: heat.lanes,
        times_ms,
        timestamp: Date.now()
      });

      // Clear staging state after result is recorded
      _liveSection.stagingHeat = null;
      setTrackPhase('result', `Heat ${heat.heat_number}`);

      // Render results + broadcast
      renderCurrentScreen();

      const resultData = buildResultsForBroadcast(sec(), heat, _liveSection.startNumber);
      sendResults(sec().section_name, heat.heat_number, withGroupNames(sec(), resultData));

      heatIdx++;

      // If more heats, wait for gate (fake track: blocks on reset; manual: blocks on button)
      if (heatIdx < schedule.heats.length) {
        setTrackPhase('waiting-for-gate', `Heat ${heat.heat_number}`);
        renderCurrentScreen();
        await waitForGate(signal);
      }
    }

    // All heats done — ask operator: complete or add rotation?
    setTrackPhase('rotation-decision', 'All heats complete');
    _liveSection.awaitingRotationDecision = true;
    renderCurrentScreen();

    const decision = await waitForRotationDecision(signal);
    _liveSection.awaitingRotationDecision = false;

    if (decision === 'add-rotation') {
      // Add rotation was handled by addRotation() which updated the schedule
      // Continue the race loop with the new heats
      return runRaceLoop(sectionId);
    }

    // Complete the section
    setTrackPhase('idle', 'Section completed');
    await appendAndRebuild({
      type: 'SectionCompleted',
      section_id: sectionId,
      start_number: _liveSection.startNumber,
      timestamp: Date.now()
    });

    // Operator controls the audience reveal from the section-complete screen
    navigate('section-complete', { sectionId, startNumber: _liveSection.startNumber });
  } catch (err) {
    if (err.name === 'AbortError') {
      // Race loop cancelled (rerun, manual intervention)
      setTrackPhase('idle', 'Race loop cancelled');
      return;
    }
    console.error('Race loop error:', err);
    showToast('Race error: ' + err.message, 'error');
  }
}

// ─── Rotation Decision ────────────────────────────────────────

/**
 * Wait for the operator to decide: complete section or add another rotation.
 * Returns 'complete' or 'add-rotation'.
 */
function waitForRotationDecision(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = () => { _rotationResolver = null; reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', onAbort, { once: true });
    _rotationResolver = (decision) => {
      signal.removeEventListener('abort', onAbort);
      _rotationResolver = null;
      resolve(decision);
    };
  });
}

/**
 * Add a new rotation: generate speed-matched heats and append to schedule.
 * Called from the UI when operator clicks "Add Rotation".
 */
async function addRotation(sectionId) {
  const sec = _state.race_day.sections[sectionId];
  const startNumber = _liveSection?.startNumber;
  const start = getStart(sec, startNumber) || getActiveStart(sec);
  const availableLanes = getAvailableLanes(sectionId, startNumber);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(start ? start.removed : []);
  const participants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  // Convert state results to the format the scheduler expects
  const results = Object.values(start.results || {}).map(r => ({
    ...r,
    heat: r.heat_number
  }));

  // Generate new speed-matched schedule
  const newSchedule = generateSchedule({
    participants,
    available_lanes: availableLanes,
    results
  });

  // Renumber new heats to continue after existing schedule
  const lastHeatNum = _liveSection.schedule.heats.length > 0
    ? Math.max(..._liveSection.schedule.heats.map(h => h.heat_number))
    : 0;

  const renumberedHeats = newSchedule.heats.map((heat, i) => ({
    ...heat,
    heat_number: lastHeatNum + i + 1
  }));

  // Append to current schedule
  _liveSection.schedule.heats.push(...renumberedHeats);
  _liveSection.schedule.metadata.total_heats = _liveSection.schedule.heats.length;

  // Emit RotationAdded event for reconstruction
  await appendAndRebuild({
    type: 'RotationAdded',
    section_id: sectionId,
    start_number: startNumber,
    timestamp: Date.now()
  });

  // Resolve the rotation decision
  if (_rotationResolver) {
    _rotationResolver('add-rotation');
  }
}

/**
 * Complete the section after all heats. Resolves the rotation decision prompt.
 */
function completeSection() {
  if (_rotationResolver) {
    _rotationResolver('complete');
  }
}

function buildResultsForBroadcast(section, heat, startNumber) {
  const start = getStart(section, startNumber) || getActiveStart(section) || getLatestStart(section);
  if (!start) return [];
  const result = start.results[heat.heat_number];
  if (!result) return [];

  const lanes = result.lanes || heat.lanes;

  if (result.type === 'RaceCompleted') {
    return lanes.map(lane => ({
      lane: lane.lane,
      car_number: lane.car_number,
      name: lane.name,
      time_ms: result.times_ms[String(lane.lane)]
    })).sort((a, b) => (a.time_ms || Infinity) - (b.time_ms || Infinity));
  }

  if (result.type === 'ResultManuallyEntered') {
    return result.rankings.map(r => {
      const p = section.participants.find(p => p.car_number === r.car_number);
      return { car_number: r.car_number, name: p?.name || '', place: r.place };
    }).sort((a, b) => a.place - b.place);
  }

  return [];
}

// ─── Re-Run ──────────────────────────────────────────────────────

async function declareRerun(sectionId, heatNumber) {
  if (_raceAbort) _raceAbort.abort();

  await appendAndRebuild({
    type: 'RerunDeclared',
    section_id: sectionId,
    start_number: _liveSection?.startNumber,
    heat_number: heatNumber,
    timestamp: Date.now()
  });

  renderCurrentScreen();

  // Restart race loop from the rerun heat
  runRaceLoop(sectionId);
}

// ─── DNF Re-Run ─────────────────────────────────────────────────

async function declareDnfRerun(sectionId, heatNumber) {
  if (_raceAbort) _raceAbort.abort();

  const sec = _state.race_day.sections[sectionId];
  const start = getStart(sec, _liveSection.startNumber) || getActiveStart(sec);
  if (!start) return;

  const result = start.results[heatNumber];
  if (!result || result.type !== 'RaceCompleted') return;

  const dnfLanes = (result.lanes || []).filter(l => result.times_ms[String(l.lane)] == null);
  if (dnfLanes.length === 0) return;

  // Stage re-run with only DNF lanes
  _liveSection.stagingHeat = { heat_number: heatNumber, lanes: dnfLanes };
  renderCurrentScreen();
  sendStaging(sec.section_name, heatNumber, withGroupNames(sec, dnfLanes), null);

  _raceAbort = new AbortController();
  const signal = _raceAbort.signal;

  try {
    const times_ms = await waitForRace(dnfLanes, signal);

    // Emit RaceCompleted — state manager merges with existing result
    await appendAndRebuild({
      type: 'RaceCompleted',
      section_id: sectionId,
      start_number: _liveSection.startNumber,
      heat_number: heatNumber,
      lanes: dnfLanes,
      times_ms,
      timestamp: Date.now()
    });

    _liveSection.stagingHeat = null;
    renderCurrentScreen();

    // Broadcast merged results
    const heat = _liveSection.schedule.heats.find(h => h.heat_number === heatNumber);
    const resultData = buildResultsForBroadcast(
      _state.race_day.sections[sectionId],
      heat || { heat_number: heatNumber },
      _liveSection.startNumber
    );
    sendResults(sec.section_name, heatNumber, withGroupNames(sec, resultData));

    // Resume race loop from next heat
    runRaceLoop(sectionId);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('DNF re-run error:', err);
    showToast('DNF re-run error: ' + err.message, 'error');
  }
}

// ─── Remove Car ──────────────────────────────────────────────────

async function removeCar(sectionId, carNumber, reason) {
  if (_raceAbort) _raceAbort.abort();

  const startNumber = _liveSection?.startNumber;

  await appendAndRebuild({
    type: 'CarRemoved',
    section_id: sectionId,
    start_number: startNumber,
    car_number: carNumber,
    reason,
    timestamp: Date.now()
  });

  // Regenerate schedule
  const sec = _state.race_day.sections[sectionId];
  const start = getStart(sec, startNumber) || getActiveStart(sec);
  const availableLanes = getAvailableLanes(sectionId, startNumber);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(start ? start.removed : []);
  const remaining = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  if (remaining.length >= 2) {
    const currentHeatNum = getLastCompletedHeatNumber(sectionId);
    _liveSection.schedule = regenerateAfterRemoval(
      _liveSection.schedule, remaining, currentHeatNum, availableLanes
    );
  }

  renderCurrentScreen();

  // Restart race loop
  if (remaining.length >= 2) {
    runRaceLoop(sectionId);
  } else {
    showToast('Not enough cars to continue', 'warning');
  }
}

// ─── End Section Early ───────────────────────────────────────────

async function endSectionEarly(sectionId) {
  if (_raceAbort) _raceAbort.abort();

  const startNumber = _liveSection?.startNumber;
  const sec = _state.race_day.sections[sectionId];
  const start = getStart(sec, startNumber) || getActiveStart(sec);
  const heatsCompleted = start ? Object.keys(start.results || {}).length : 0;

  await appendAndRebuild({
    type: 'SectionCompleted',
    section_id: sectionId,
    start_number: startNumber,
    early_end: true,
    total_heats: heatsCompleted,
    timestamp: Date.now()
  });

  navigate('section-complete', { sectionId, startNumber });
}

// ─── Change Lanes ────────────────────────────────────────────────

async function changeLanes(sectionId, newLanes, reason) {
  if (_raceAbort) _raceAbort.abort();

  const startNumber = _liveSection?.startNumber;

  await appendAndRebuild({
    type: 'LanesChanged',
    section_id: sectionId,
    start_number: startNumber,
    available_lanes: newLanes,
    reason,
    timestamp: Date.now()
  });

  // Regenerate schedule with new lane configuration
  const sec = _state.race_day.sections[sectionId];
  const start = getStart(sec, startNumber) || getActiveStart(sec);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(start ? start.removed : []);
  const participants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  if (participants.length >= 2) {
    const currentHeatNum = getLastCompletedHeatNumber(sectionId, startNumber);
    const completedHeats = _liveSection?.schedule?.heats.filter(h => h.heat_number <= currentHeatNum) || [];
    const newSchedule = generateSchedule({ participants, available_lanes: newLanes });

    // Renumber new heats to continue after completed heats
    const renumberedHeats = newSchedule.heats.map((heat, i) => ({
      ...heat,
      heat_number: currentHeatNum + i + 1
    }));

    _liveSection = {
      ..._liveSection,
      sectionId,
      startNumber,
      schedule: {
        heats: [...completedHeats, ...renumberedHeats],
        metadata: {
          ...newSchedule.metadata,
          total_heats: completedHeats.length + renumberedHeats.length,
          available_lanes: newLanes
        }
      },
      stagingHeat: null
    };
  }

  renderCurrentScreen();

  // Restart race loop
  if (_liveSection) {
    runRaceLoop(sectionId);
  }
}

// ─── Late Arrival ────────────────────────────────────────────────

export function handleLateArrival(sectionId) {
  if (!_liveSection || _liveSection.sectionId !== sectionId) return;

  const sec = _state.race_day.sections[sectionId];
  const startNumber = _liveSection.startNumber;
  const start = getStart(sec, startNumber) || getActiveStart(sec);
  const availableLanes = getAvailableLanes(sectionId, startNumber);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(start ? start.removed : []);
  const allParticipants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  const currentHeatNum = getLastCompletedHeatNumber(sectionId, startNumber);

  // Regenerate schedule with all current participants
  _liveSection.schedule = regenerateAfterLateArrival(
    _liveSection.schedule, allParticipants, currentHeatNum, availableLanes
  );

  // Detect new participants who missed completed heats and need catch-up runs
  const completedCarNumbers = new Set();
  const startResults = start ? (start.results || {}) : {};
  for (const result of Object.values(startResults)) {
    if (result.lanes) {
      for (const lane of result.lanes) {
        completedCarNumbers.add(lane.car_number);
      }
    }
  }
  const completedResultCount = Object.keys(startResults).length;

  // Collect all catch-up heats, then insert them immediately after currentHeat
  const allCatchUpHeats = [];
  for (const p of allParticipants) {
    if (!completedCarNumbers.has(p.car_number) && completedResultCount > 0) {
      const catchUpHeats = generateCatchUpHeats(
        p, completedResultCount, availableLanes, 0 // temp numbering, renumbered below
      );
      allCatchUpHeats.push(...catchUpHeats);
    }
  }

  if (allCatchUpHeats.length > 0) {
    const schedule = _liveSection.schedule;
    // Split: completed heats (≤ currentHeatNum) and remaining group heats (> currentHeatNum)
    const completed = schedule.heats.filter(h => h.heat_number <= currentHeatNum);
    const remaining = schedule.heats.filter(h => h.heat_number > currentHeatNum);

    // Renumber: catch-up heats first, then remaining group heats
    let nextNum = currentHeatNum + 1;
    for (const h of allCatchUpHeats) { h.heat_number = nextNum++; }
    for (const h of remaining) { h.heat_number = nextNum++; }

    schedule.heats = [...completed, ...allCatchUpHeats, ...remaining];
    schedule.metadata.total_heats = schedule.heats.length;
  }
}

// ─── Correct Lanes ───────────────────────────────────────────────

async function correctLanes(sectionId, heatNumber, correctedLanes, reason) {
  await appendAndRebuild({
    type: 'ResultCorrected',
    section_id: sectionId,
    start_number: _liveSection?.startNumber,
    heat_number: heatNumber,
    corrected_lanes: correctedLanes,
    reason,
    timestamp: Date.now()
  });

  renderCurrentScreen();
}

// ─── USB Backup ──────────────────────────────────────────────────

async function configureUSBBackup() {
  await configureUSBBackupImpl(getAllEvents, _state?.rally_id);
}

async function reauthorizeUSBBackup() {
  return reauthorizeUSBBackupImpl(getAllEvents, _state?.rally_id);
}

// ─── Render Helper ───────────────────────────────────────────────

function renderCurrentScreen() {
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    renderScreen(route.screenName, route.params);
  }
  updateUserInfo(); // rebuild Open menu (track mode may have changed)
}

// ─── Sync Status Indicator ────────────────────────────────────────
// Implementation lives in shared/sync-indicator.js so the registrar can
// reuse it. We pass a getter so the inbound retry can re-subscribe to
// whatever rally is currently active.

/**
 * Wire up inbound sync for the active rally: an initial catch-up pull
 * from Supabase, plus a Realtime push subscription so registrar events
 * (check-ins, late roster updates) land in IndexedDB while we're online.
 * On reconnect, the subscription does another catch-up pull. The actual
 * rebuild + render is driven by the onInboundEvents listener in init().
 */
async function tryRestore(rallyId) {
  if (isDemoMode() || !rallyId) return;
  try {
    const client = await getClient();
    await subscribeToRally(client, rallyId);
  } catch (e) {
    console.warn('Subscribe failed:', e.message);
  }
}

/**
 * Start Supabase background sync. Events carry their own rally_id/section_id,
 * so we only need the client and user to begin uploading.
 */
async function beginSync() {
  if (isDemoMode()) return;
  const user = getUser();
  if (!user) return;
  try {
    const client = await getClient();
    startSync(client, user.id);
  } catch (e) {
    console.warn('Sync not available:', e.message);
  }
}

// ─── User Info ──────────────────────────────────────────────

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

function clampZoom(level) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(level * 10) / 10));
}

function buildAudienceZoomControl() {
  const wrap = document.createElement('div');
  wrap.className = 'audience-zoom';
  wrap.title = 'Audience display zoom';

  const label = document.createElement('span');
  label.className = 'audience-zoom-label';
  label.textContent = 'Audience';

  const minus = document.createElement('button');
  minus.className = 'btn btn-sm btn-ghost audience-zoom-btn';
  minus.textContent = '−';
  minus.setAttribute('aria-label', 'Decrease audience zoom');

  const value = document.createElement('button');
  value.className = 'btn btn-sm btn-ghost audience-zoom-value';
  value.title = 'Reset audience zoom to 100%';

  const plus = document.createElement('button');
  plus.className = 'btn btn-sm btn-ghost audience-zoom-btn';
  plus.textContent = '+';
  plus.setAttribute('aria-label', 'Increase audience zoom');

  const render = () => { value.textContent = `${Math.round(getZoom() * 100)}%`; };
  const set = (lvl) => { sendZoom(clampZoom(lvl)); render(); };

  minus.onclick = () => set(getZoom() - ZOOM_STEP);
  plus.onclick = () => set(getZoom() + ZOOM_STEP);
  value.onclick = () => set(1);

  wrap.append(label, minus, value, plus);
  render();
  return wrap;
}

function updateUserInfo() {
  const el = document.getElementById('user-info');
  el.innerHTML = '';
  const user = getUser();

  el.appendChild(buildAudienceZoomControl());

  const viewWrap = document.createElement('div');
  viewWrap.className = 'view-menu';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-sm btn-ghost';
  viewBtn.textContent = 'Open \u25BE';
  viewWrap.appendChild(viewBtn);

  const menu = document.createElement('div');
  menu.className = 'view-menu-dropdown';
  menu.hidden = true;

  const realTrack = getTrackMode() === 'wifi' || getTrackMode() === 'serial';
  const isSerial = getTrackMode() === 'serial';
  const items = [
    { label: 'Debug View', href: 'debug.html' },
    { label: 'Registrar', href: 'registrar.html' },
    { label: 'Audience', href: 'audience.html' },
    ...(!realTrack ? [{ label: 'Fake Track', href: 'fake-track.html' }] : []),
    ...(realTrack ? [{ label: 'Pico Debug', href: 'pico-debug.html' }] : []),
    { label: 'Event Inspector', href: 'event-inspector.html' },
  ];

  for (const { label, href } of items) {
    const a = document.createElement('a');
    a.className = 'view-menu-item';
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.onclick = () => { menu.hidden = true; };
    menu.appendChild(a);
  }

  viewBtn.onclick = () => { menu.hidden = !menu.hidden; };
  document.addEventListener('click', (e) => {
    if (!viewWrap.contains(e.target)) menu.hidden = true;
  });

  viewWrap.appendChild(menu);
  el.appendChild(viewWrap);

  if (user) {
    const email = document.createElement('span');
    email.className = 'user-email';
    email.textContent = user.email;
    el.appendChild(email);
  }

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'btn btn-sm btn-ghost';
  signOutBtn.textContent = 'Sign Out';
  signOutBtn.onclick = async () => {
    stopSync();
    await signOut();
    window.location.href = 'registration.html';
  };
  el.appendChild(signOutBtn);
}

// ─── Init ────────────────────────────────────────────────────────

async function init() {
  initOperatorChannel();
  sendZoom(getZoom());
  await initAuth();
  updateUserInfo();
  initSyncIndicator({ getRallyId: () => _state?.rally_id });
  await openStore();
  await rebuildFromStore();

  // Resume USB backup if a handle was persisted in a prior session.
  if (isUSBBackupSupported()) {
    try {
      const status = await restoreUSBBackup(getAllEvents, _state?.rally_id);
      if (status === 'needs-permission') {
        showToast('USB backup needs permission — click "Reconnect backup" in settings', 'warning');
      } else if (status === 'resumed') {
        showToast('USB backup resumed', 'success');
      }
    } catch (e) {
      console.warn('USB backup restore failed:', e);
    }
  }

  // Start background sync early so check-in events are uploaded immediately
  beginSync();

  // Connect track
  await trackConnect();

  // Listen for sync messages from other tabs (e.g. registrar)
  onSyncMessage(async (msg) => {
    if (msg.type === 'EVENTS_CHANGED') {
      await rebuildFromStore();
      // If a section is live, handle potential late arrivals
      if (_liveSection) {
        handleLateArrival(_liveSection.sectionId);
      }
      renderCurrentScreen();
    }
  });

  // Listen for inbound events from Supabase (Realtime push + reconnect pull)
  onInboundEvents(async (count, kind) => {
    await rebuildFromStore();
    if (kind === 'pull' && count > 0) {
      showToast(`Pulled ${count} event${count !== 1 ? 's' : ''} from cloud`, 'success');
    }
    if (_liveSection) {
      handleLateArrival(_liveSection.sectionId);
    }
    renderCurrentScreen();
  });

  // Route to current hash or rally list
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    navigate(route.screenName, route.params, { replace: true });
  } else {
    navigate('rally-list', {}, { replace: true });
  }
}

init().catch(e => {
  console.error('Init error:', e);
  app().innerHTML = `<p class="form-error">Failed to initialize: ${e.message}</p>`;
});
