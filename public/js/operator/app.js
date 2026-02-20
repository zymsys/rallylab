/**
 * operator/app.js — Race day operator entry point.
 * Hash routing, state management, race loop.
 * Offline-first: no auth required, uses IndexedDB for event storage.
 */

import { openStore, appendEvent as storeAppend, getAllEvents, clear as clearStore } from '../event-store.js';
import { rebuildState, deriveRaceDayPhase, getCurrentHeat } from '../state-manager.js';
import { generateSchedule, regenerateAfterRemoval, regenerateAfterLateArrival, generateCatchUpHeats } from '../scheduler.js';
import {
  connect as trackConnect, waitForRace, waitForGate,
  getInfo as trackInfo, isConnected, isUsingFakeTrack,
  triggerManualRace, triggerManualGate
} from '../track-connection.js';
import { sendWelcome, sendStaging, sendResults, notifyEventsChanged, onSyncMessage } from '../broadcast.js';
import { getUser, signOut } from '../supabase.js';
import {
  renderRallyList, renderRallyHome, renderCheckIn,
  renderLiveConsole, renderSectionComplete
} from './screens.js';

const app = () => document.getElementById('app');
const breadcrumbs = () => document.getElementById('breadcrumbs');

// ─── Lane Helpers ─────────────────────────────────────────────────

/**
 * Get the available lanes for a section, falling back to a contiguous
 * range derived from the track hardware lane_count.
 * @param {string} sectionId
 * @returns {Array<number>}
 */
function getAvailableLanes(sectionId) {
  const sec = _state?.race_day.sections[sectionId];
  if (sec?.available_lanes) return sec.available_lanes;
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

// ─── Module State ────────────────────────────────────────────────

let _state = null;
let _liveSection = null;  // { sectionId, schedule }
let _raceAbort = null;     // AbortController for current race loop

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

  // Broadcast welcome to audience when rally data is available
  if (screenName === 'rally-home' && _state?.rally_name) {
    sendWelcome(_state.rally_name);
  }

  const ctx = {
    state: _state,
    liveSection: _liveSection,
    navigate,
    appendEvent: appendAndRebuild,
    startSection,
    resumeSection,
    declareRerun,
    removeCar,
    changeLanes,
    correctLanes,
    showToast,
    getSchedule: () => _liveSection?.schedule,
    getAvailableLanes,
    getTrackLaneCount,
    isUsingFakeTrack,
    triggerManualRace,
    triggerManualGate
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
  if (!sec || sec.completed) {
    bar.classList.add('hidden');
    return;
  }

  text.textContent = `${sec.section_name} — Race in progress`;
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
  await storeAppend(payload);
  await rebuildFromStore();
  notifyEventsChanged();
  return _state;
}

export async function rebuildFromStore() {
  const events = await getAllEvents();
  _state = rebuildState(events.map(e => ({ payload: e })));
}

export async function clearAndRebuild() {
  await clearStore();
  _state = rebuildState([]);
  _liveSection = null;
}

// ─── Schedule Reconstruction ────────────────────────────────────

/**
 * Reconstruct the schedule for a started section by replaying events.
 * The scheduler is fully deterministic, so replaying the same sequence
 * of generate/regenerate calls produces the identical schedule.
 * Derives availableLanes from SectionStarted + LanesChanged events.
 */
async function reconstructSchedule(sectionId) {
  const events = await getAllEvents();
  const sectionEvents = events.filter(e => e.section_id === sectionId);

  const arrived = new Set();
  const removed = new Set();
  let schedule = null;
  let started = false;
  let currentHeat = 0;
  let availableLanes = null;
  const completedCarNumbers = new Set();
  let completedResultCount = 0;

  // We also need participant data — pull from state (loaded from RosterLoaded)
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
      availableLanes = evt.available_lanes || getAvailableLanes(sectionId);
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
    } else if (evt.type === 'HeatStaged') {
      currentHeat = evt.heat_number;
      // Track which cars have been in completed heats
      const heat = sec.heats.find(h => h.heat_number === evt.heat_number);
      if (heat && sec.results[evt.heat_number]) {
        for (const lane of heat.lanes) {
          completedCarNumbers.add(lane.car_number);
        }
      }
    } else if (evt.type === 'RaceCompleted' || evt.type === 'ResultManuallyEntered') {
      completedResultCount++;
      // Update completedCarNumbers from the heat's lanes
      const heat = sec.heats.find(h => h.heat_number === evt.heat_number);
      if (heat) {
        for (const lane of heat.lanes) {
          completedCarNumbers.add(lane.car_number);
        }
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

  // Use provided lanes or fall back to full track
  if (!availableLanes) {
    availableLanes = getAvailableLanes(sectionId);
  }

  // Get arrived, non-removed participants
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(sec.removed);
  const participants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  if (participants.length < 2) {
    showToast('At least 2 checked-in cars required', 'error');
    return;
  }

  // Emit SectionStarted with lane configuration
  await appendAndRebuild({
    type: 'SectionStarted',
    section_id: sectionId,
    available_lanes: availableLanes,
    timestamp: Date.now()
  });

  // Generate schedule
  const schedule = generateSchedule({ participants, available_lanes: availableLanes });

  _liveSection = { sectionId, schedule };

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

  const schedule = await reconstructSchedule(sectionId);

  if (!schedule) {
    showToast('Could not reconstruct schedule', 'error');
    return;
  }

  _liveSection = { sectionId, schedule };

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
    const sec = () => _state.race_day.sections[sectionId];

    // Find next heat to run (first heat without a result)
    let heatIdx = 0;
    for (let i = 0; i < schedule.heats.length; i++) {
      const hn = schedule.heats[i].heat_number;
      if (!sec().results[hn]) {
        heatIdx = i;
        break;
      }
      heatIdx = i + 1;
    }

    while (heatIdx < schedule.heats.length) {
      if (signal.aborted) return;

      const heat = schedule.heats[heatIdx];

      // Emit HeatStaged
      await appendAndRebuild({
        type: 'HeatStaged',
        section_id: sectionId,
        heat_number: heat.heat_number,
        lanes: heat.lanes,
        timestamp: Date.now()
      });

      // Render staging + broadcast
      renderCurrentScreen();
      const nextHeat = heatIdx + 1 < schedule.heats.length ? schedule.heats[heatIdx + 1] : null;
      sendStaging(sec().section_name, heat.heat_number, heat.lanes,
        nextHeat ? { heat_number: nextHeat.heat_number, lanes: nextHeat.lanes } : null);

      // Wait for race (fake track: blocks on gate click; manual: blocks on button)
      const times_ms = await waitForRace(heat.lanes, signal);

      // Emit RaceCompleted
      await appendAndRebuild({
        type: 'RaceCompleted',
        section_id: sectionId,
        heat_number: heat.heat_number,
        times_ms,
        timestamp: Date.now()
      });

      // Render results + broadcast
      renderCurrentScreen();

      const resultData = buildResultsForBroadcast(sec(), heat);
      sendResults(sec().section_name, heat.heat_number, resultData);

      heatIdx++;

      // If more heats, wait for gate (fake track: blocks on reset; manual: blocks on button)
      if (heatIdx < schedule.heats.length) {
        await waitForGate(signal);
      }
    }

    // All heats done — emit SectionCompleted
    await appendAndRebuild({
      type: 'SectionCompleted',
      section_id: sectionId,
      timestamp: Date.now()
    });

    // Operator controls the audience reveal from the section-complete screen
    navigate('section-complete', { sectionId });
  } catch (err) {
    if (err.name === 'AbortError') {
      // Race loop cancelled (rerun, manual intervention)
      return;
    }
    console.error('Race loop error:', err);
    showToast('Race error: ' + err.message, 'error');
  }
}

function buildResultsForBroadcast(section, heat) {
  const result = section.results[heat.heat_number];
  if (!result) return [];

  if (result.type === 'RaceCompleted') {
    return heat.lanes.map(lane => ({
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
    heat_number: heatNumber,
    timestamp: Date.now()
  });

  renderCurrentScreen();

  // Restart race loop from the rerun heat
  runRaceLoop(sectionId);
}

// ─── Remove Car ──────────────────────────────────────────────────

async function removeCar(sectionId, carNumber, reason) {
  if (_raceAbort) _raceAbort.abort();

  await appendAndRebuild({
    type: 'CarRemoved',
    section_id: sectionId,
    car_number: carNumber,
    reason,
    timestamp: Date.now()
  });

  // Regenerate schedule
  const sec = _state.race_day.sections[sectionId];
  const availableLanes = getAvailableLanes(sectionId);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(sec.removed);
  const remaining = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  if (remaining.length >= 2) {
    const currentHeat = getCurrentHeat(_state, sectionId);
    _liveSection.schedule = regenerateAfterRemoval(
      _liveSection.schedule, remaining, currentHeat, availableLanes
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

// ─── Change Lanes ────────────────────────────────────────────────

async function changeLanes(sectionId, newLanes, reason) {
  if (_raceAbort) _raceAbort.abort();

  await appendAndRebuild({
    type: 'LanesChanged',
    section_id: sectionId,
    available_lanes: newLanes,
    reason,
    timestamp: Date.now()
  });

  // Regenerate schedule with new lane configuration
  const sec = _state.race_day.sections[sectionId];
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(sec.removed);
  const participants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  if (participants.length >= 2) {
    const currentHeat = getCurrentHeat(_state, sectionId);
    const completedHeats = _liveSection?.schedule?.heats.filter(h => h.heat_number <= currentHeat) || [];
    const newSchedule = generateSchedule({ participants, available_lanes: newLanes });

    // Renumber new heats to continue after completed heats
    const renumberedHeats = newSchedule.heats.map((heat, i) => ({
      ...heat,
      heat_number: currentHeat + i + 1
    }));

    _liveSection = {
      sectionId,
      schedule: {
        heats: [...completedHeats, ...renumberedHeats],
        metadata: {
          ...newSchedule.metadata,
          total_heats: completedHeats.length + renumberedHeats.length,
          available_lanes: newLanes
        }
      }
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
  const availableLanes = getAvailableLanes(sectionId);
  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(sec.removed);
  const allParticipants = sec.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number));

  const currentHeat = getCurrentHeat(_state, sectionId);

  // Regenerate schedule with all current participants
  _liveSection.schedule = regenerateAfterLateArrival(
    _liveSection.schedule, allParticipants, currentHeat, availableLanes
  );

  // Detect new participants who missed completed heats and need catch-up runs
  const completedCarNumbers = new Set();
  for (const heat of sec.heats) {
    if (sec.results[heat.heat_number]) {
      for (const lane of heat.lanes) {
        completedCarNumbers.add(lane.car_number);
      }
    }
  }
  const completedResultCount = Object.keys(sec.results).length;

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
    // Split: completed heats (≤ currentHeat) and remaining group heats (> currentHeat)
    const completed = schedule.heats.filter(h => h.heat_number <= currentHeat);
    const remaining = schedule.heats.filter(h => h.heat_number > currentHeat);

    // Renumber: catch-up heats first, then remaining group heats
    let nextNum = currentHeat + 1;
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
    heat_number: heatNumber,
    corrected_lanes: correctedLanes,
    reason,
    timestamp: Date.now()
  });

  renderCurrentScreen();
}

// ─── Render Helper ───────────────────────────────────────────────

function renderCurrentScreen() {
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    renderScreen(route.screenName, route.params);
  }
}

// ─── User Info ──────────────────────────────────────────────

function updateUserInfo() {
  const el = document.getElementById('user-info');
  const user = getUser();

  const buttons = [
    { label: 'Registrar', href: 'registrar.html' },
    { label: 'Audience', href: 'audience.html' },
    { label: 'Fake Track', href: 'fake-track.html' }
  ];

  for (const { label, href } of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-ghost';
    btn.textContent = label;
    btn.onclick = () => window.open(href);
    el.appendChild(btn);
  }

  if (user) {
    const email = document.createElement('span');
    email.className = 'user-email';
    email.textContent = user.email;
    el.appendChild(email);
  }

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'btn btn-sm btn-ghost';
  signOutBtn.style.color = 'rgba(255,255,255,0.7)';
  signOutBtn.textContent = 'Sign Out';
  signOutBtn.onclick = () => {
    signOut();
    window.location.href = 'index.html';
  };
  el.appendChild(signOutBtn);
}

// ─── Init ────────────────────────────────────────────────────────

async function init() {
  updateUserInfo();
  await openStore();
  await rebuildFromStore();

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
