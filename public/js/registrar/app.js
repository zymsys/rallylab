/**
 * registrar/app.js — Registrar race day entry point.
 * Hash routing, state management, inter-tab sync.
 * Shares IndexedDB with operator via event-store.js.
 */

import { openStore, appendEvent as storeAppend, getAllEvents } from '../event-store.js';
import { rebuildState } from '../state-manager.js';
import { notifyEventsChanged, onSyncMessage } from '../broadcast.js';
import { renderSectionList, renderSectionCheckIn } from './screens.js';

const app = () => document.getElementById('app');
const breadcrumbs = () => document.getElementById('breadcrumbs');

// ─── Module State ────────────────────────────────────────────────

let _state = null;

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
  'section-list': renderSectionList,
  'section-checkin': renderSectionCheckIn
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

  const ctx = {
    state: _state,
    navigate,
    appendEvent: appendAndRebuild,
    showToast
  };

  renderFn(container, params, ctx);
}

// ─── Back / Forward ──────────────────────────────────────────────

window.addEventListener('popstate', () => {
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    renderScreen(route.screenName, route.params);
  } else {
    renderScreen('section-list', {});
  }
});

// ─── Breadcrumbs ─────────────────────────────────────────────────

function updateBreadcrumbs(screenName, params) {
  const bc = breadcrumbs();
  bc.innerHTML = '';

  if (screenName === 'section-checkin') {
    const a = document.createElement('a');
    a.href = encodeHash('section-list', {});
    a.textContent = 'Sections';
    a.onclick = (e) => { e.preventDefault(); navigate('section-list', {}); };
    bc.appendChild(a);

    const sep = document.createElement('span');
    sep.className = 'separator';
    sep.textContent = '/';
    bc.appendChild(sep);

    const span = document.createElement('span');
    span.textContent = 'Check-In';
    bc.appendChild(span);
  }
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

async function appendAndRebuild(payload) {
  await storeAppend(payload);
  await rebuildFromStore();
  notifyEventsChanged();
  return _state;
}

async function rebuildFromStore() {
  const events = await getAllEvents();
  _state = rebuildState(events.map(e => ({ payload: e })));
}

// ─── Render Helper ───────────────────────────────────────────────

function renderCurrentScreen() {
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    renderScreen(route.screenName, route.params);
  }
}

// ─── Init ────────────────────────────────────────────────────────

async function init() {
  await openStore();
  await rebuildFromStore();

  // Listen for sync messages from other tabs (e.g. operator)
  onSyncMessage(async (msg) => {
    if (msg.type === 'EVENTS_CHANGED') {
      await rebuildFromStore();
      renderCurrentScreen();
    }
  });

  // Route to current hash or section list
  const route = decodeHash(location.hash);
  if (route && screens[route.screenName]) {
    navigate(route.screenName, route.params, { replace: true });
  } else {
    navigate('section-list', {}, { replace: true });
  }
}

init().catch(e => {
  console.error('Init error:', e);
  app().innerHTML = `<p class="form-error">Failed to initialize: ${e.message}</p>`;
});
