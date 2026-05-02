/**
 * audience/app.js — Audience display BroadcastChannel listener.
 * Stateless: renders whatever the operator sends.
 */

import { onMessage, requestState } from '../broadcast.js';
import {
  renderWelcome, renderStaging, renderResults,
  renderLeaderboard, renderSectionComplete,
  revealNext, revealAll,
  renderTrackOverlay, clearTrackOverlay
} from './screens.js';

const app = () => document.getElementById('app');
const ZOOM_STORAGE_KEY = 'rallylab-audience-zoom';
let _hasReceived = false;

function applyZoom(level) {
  const z = Number.isFinite(level) && level > 0 ? level : 1;
  app().style.zoom = z;
}

// Apply any persisted zoom immediately so first paint isn't briefly unscaled.
try {
  const saved = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY));
  if (Number.isFinite(saved) && saved > 0) applyZoom(saved);
} catch {}

onMessage((msg) => {
  if (msg.type !== 'SET_ZOOM') _hasReceived = true;
  const container = app();

  switch (msg.type) {
    case 'SHOW_WELCOME':
      renderWelcome(container, msg.rally_name);
      break;
    case 'SHOW_STAGING':
      renderStaging(container, msg.section_name, msg.heat_number, msg.lanes, msg.next_heat);
      break;
    case 'SHOW_RESULTS':
      renderResults(container, msg.section_name, msg.heat_number, msg.results);
      break;
    case 'SHOW_LEADERBOARD':
      renderLeaderboard(container, msg.section_name, msg.standings);
      break;
    case 'SHOW_SECTION_COMPLETE':
      renderSectionComplete(container, msg.section_name, msg.standings);
      break;
    case 'REVEAL_NEXT':
      revealNext();
      break;
    case 'REVEAL_ALL':
      revealAll();
      break;
    case 'SET_ZOOM':
      applyZoom(msg.level);
      try { localStorage.setItem(ZOOM_STORAGE_KEY, String(msg.level)); } catch {}
      break;
    case 'TRACK_STATUS':
      renderTrackOverlay(msg);
      break;
    case 'TRACK_STATUS_CLEAR':
      clearTrackOverlay();
      break;
  }
});

// Ask the operator for its current display state (handles late join / refresh).
// Retry a few times in case the operator channel isn't ready yet.
requestState();
setTimeout(() => { if (!_hasReceived) requestState(); }, 1000);
setTimeout(() => { if (!_hasReceived) requestState(); }, 3000);
