/**
 * app.js — Pre-race entry point: auth routing, navigation, toast system.
 * Uses hash-based routing (#screen/param=value) for back/forward and reload.
 */

import { initAuth, onAuthChange, getUser, signOut, isOrganizer, getAccessibleEventIds } from '../supabase.js';
import { renderLogin, renderEventList, renderEventHome, renderSectionDetail } from './screens.js';

const app = () => document.getElementById('app');
const userInfo = () => document.getElementById('user-info');
const breadcrumbs = () => document.getElementById('breadcrumbs');

// ─── Hash Encoding ───────────────────────────────────────────────

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

// ─── Navigation ────────────────────────────────────────────────────

let _currentScreen = null;
let _currentParams = {};

const screens = {
  'login': renderLogin,
  'event-list': renderEventList,
  'event-home': renderEventHome,
  'section-detail': renderSectionDetail
};

/**
 * Navigate to a screen. Updates the URL hash and renders.
 * Set `replace` to true to replace the current history entry
 * instead of pushing a new one (used for auth redirects).
 */
export function navigate(screenName, params = {}, { replace = false } = {}) {
  _currentScreen = screenName;
  _currentParams = params;

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

  const result = renderFn(container, params);
  if (result && typeof result.catch === 'function') {
    result.catch(e => {
      container.innerHTML = `<p class="form-error">Error: ${e.message}</p>`;
      console.error(e);
    });
  }
}

// ─── Back / Forward ──────────────────────────────────────────────

window.addEventListener('popstate', () => {
  const user = getUser();
  if (!user) {
    renderScreen('login', {});
    return;
  }

  const route = decodeHash(location.hash);
  if (route && route.screenName !== 'login' && screens[route.screenName]) {
    _currentScreen = route.screenName;
    _currentParams = route.params;
    renderScreen(route.screenName, route.params);
  } else {
    renderScreen('event-list', {});
  }
});

// ─── Breadcrumbs ─────────────────────────────────────────────────

function updateBreadcrumbs(screenName, params) {
  const bc = breadcrumbs();
  bc.innerHTML = '';

  if (screenName === 'login') return;

  const items = [];
  items.push({ label: 'Events', screen: 'event-list' });

  if (screenName === 'event-home' || screenName === 'section-detail') {
    items.push({ label: 'Event', screen: 'event-home', params: { eventId: params.eventId } });
  }

  if (screenName === 'section-detail') {
    items.push({ label: 'Section', screen: null }); // current, no link
  }

  items.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'separator';
      sep.textContent = '/';
      bc.appendChild(sep);
    }

    if (item.screen && item.screen !== screenName) {
      const a = document.createElement('a');
      a.href = encodeHash(item.screen, item.params || {});
      a.textContent = item.label;
      a.onclick = (e) => { e.preventDefault(); navigate(item.screen, item.params || {}); };
      bc.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = item.label;
      bc.appendChild(span);
    }
  });
}

// ─── User Info ───────────────────────────────────────────────────

function updateUserInfo() {
  const el = userInfo();
  const user = getUser();
  if (!user) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `
    <span class="user-email">${user.email}</span>
  `;

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'btn btn-sm btn-ghost';
  signOutBtn.style.color = 'rgba(255,255,255,0.7)';
  signOutBtn.textContent = 'Sign Out';
  signOutBtn.onclick = () => signOut();
  el.appendChild(signOutBtn);
}

// ─── Toast System ──────────────────────────────────────────────────

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

// ─── Auth Flow ─────────────────────────────────────────────────────

initAuth();

onAuthChange((event, session) => {
  updateUserInfo();
  if (session && session.user) {
    // Try to restore route from hash, otherwise go to event list
    const route = decodeHash(location.hash);
    if (route && route.screenName !== 'login' && screens[route.screenName]) {
      navigate(route.screenName, route.params, { replace: true });
    } else {
      // Registrar with exactly one event: skip the list, go straight to it
      const eventIds = getAccessibleEventIds();
      if (!isOrganizer() && eventIds.length === 1) {
        navigate('event-home', { eventId: eventIds[0] }, { replace: true });
      } else {
        navigate('event-list', {}, { replace: true });
      }
    }
  } else {
    navigate('login', {}, { replace: true });
  }
});
