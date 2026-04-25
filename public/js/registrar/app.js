/**
 * registrar/app.js — Registrar race day entry point.
 * Hash routing, state management, inter-tab sync.
 * Shares IndexedDB with operator via event-store.js.
 */

import { isDemoMode } from '../config.js';
import { openStore, appendEvent as storeAppend, getAllEvents } from '../event-store.js';
import { rebuildState } from '../state-manager.js';
import { notifyEventsChanged, onSyncMessage } from '../broadcast.js';
import { getUser, getClient, signOut, initAuth } from '../supabase.js';
import { startSync, subscribeToRally, onInboundEvents } from '../sync-worker.js';
import { initSyncIndicator } from '../shared/sync-indicator.js';
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
    showToast,
    openCloudRally,
    isCloudAvailable: () => !isDemoMode() && !!getUser()
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
  // Ensure rally_id is set so sync-worker uploads to the correct rally and
  // event-store doesn't fall back to a fresh random UUID.
  if (!payload.rally_id && _state?.rally_id) {
    payload = { ...payload, rally_id: _state.rally_id };
  }
  await storeAppend(payload);
  await rebuildFromStore();
  notifyEventsChanged();
  return _state;
}

async function rebuildFromStore() {
  const events = await getAllEvents();
  _state = rebuildState(events);
}

/**
 * Bring up Supabase plumbing once we know the rally we're on:
 *   - startSync uploads any local events the registrar has accumulated offline
 *   - subscribeToRally pulls the full event history and opens a Realtime
 *     channel so other devices' check-ins land here within a tick.
 * Safe to call multiple times — both helpers are idempotent for the same args.
 */
async function bringUpCloudSync(rallyId) {
  if (isDemoMode() || !rallyId) return;
  const user = getUser();
  if (!user) return;
  try {
    const client = await getClient();
    startSync(client, user.id);
    await subscribeToRally(client, rallyId);
  } catch (e) {
    console.warn('Cloud sync setup failed:', e.message);
  }
}

/**
 * Bootstrap a rally chosen from the cloud picker: pulls events into IndexedDB
 * and opens the Realtime channel, then re-renders so the section list fills in.
 */
export async function openCloudRally(rallyId) {
  if (isDemoMode() || !rallyId) return;
  const client = await getClient();
  const user = getUser();
  if (user) startSync(client, user.id);  // before subscribeToRally so echo dedup sees _userId
  await subscribeToRally(client, rallyId);
  await rebuildFromStore();
  navigate('section-list', {}, { replace: true });
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
  if (!user) return;

  el.innerHTML = `<span class="user-email">${user.email}</span>`;

  const btn = document.createElement('button');
  btn.className = 'btn btn-sm btn-ghost';
  btn.style.color = 'rgba(255,255,255,0.7)';
  btn.textContent = 'Sign Out';
  btn.onclick = async () => {
    await signOut();
    window.location.href = 'registration.html';
  };
  el.appendChild(btn);
}

// ─── Init ────────────────────────────────────────────────────────

async function init() {
  await initAuth();
  updateUserInfo();
  initSyncIndicator({ getRallyId: () => _state?.rally_id });
  await openStore();
  await rebuildFromStore();

  // If we already have a rally locally, bring up cloud sync so registrars
  // on other devices see this device's check-ins (and vice-versa).
  if (_state?.rally_id) bringUpCloudSync(_state.rally_id);

  // Listen for sync messages from other tabs (e.g. operator)
  onSyncMessage(async (msg) => {
    if (msg.type === 'EVENTS_CHANGED') {
      await rebuildFromStore();
      renderCurrentScreen();
    }
  });

  // Listen for inbound events from Supabase (Realtime push + reconnect pull)
  onInboundEvents(async () => {
    await rebuildFromStore();
    renderCurrentScreen();
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
