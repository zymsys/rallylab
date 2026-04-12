/**
 * audience/app.js — Audience display BroadcastChannel listener.
 * Stateless: renders whatever the operator sends.
 */

import { onMessage, requestState } from '../broadcast.js';
import {
  renderWelcome, renderStaging, renderResults,
  renderLeaderboard, renderSectionComplete,
  revealNext, revealAll
} from './screens.js';

const app = () => document.getElementById('app');
let _hasReceived = false;

onMessage((msg) => {
  _hasReceived = true;
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
  }
});

// Ask the operator for its current display state (handles late join / refresh).
// Retry a few times in case the operator channel isn't ready yet.
requestState();
setTimeout(() => { if (!_hasReceived) requestState(); }, 1000);
setTimeout(() => { if (!_hasReceived) requestState(); }, 3000);
