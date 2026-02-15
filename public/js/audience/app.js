/**
 * audience/app.js — Audience display BroadcastChannel listener.
 * Stateless: renders whatever the operator sends.
 */

import { onMessage } from '../broadcast.js';
import {
  renderWelcome, renderStaging, renderResults,
  renderLeaderboard, renderSectionComplete
} from './screens.js';

const app = () => document.getElementById('app');

onMessage((msg) => {
  const container = app();

  switch (msg.type) {
    case 'SHOW_WELCOME':
      renderWelcome(container, msg.event_name);
      break;
    case 'SHOW_STAGING':
      renderStaging(container, msg.section_name, msg.heat_number, msg.lanes);
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
  }
});
