/**
 * sync-indicator.js — Shared sync status indicator for operator/registrar.
 *
 * Renders two clickable badges into #user-info: outbound (uploads) and
 * inbound (Realtime push). Click either when in error state for a dialog
 * showing the underlying error and a "Retry now" button.
 */

import { isDemoMode } from '../config.js';
import { getClient } from '../supabase.js';
import {
  onSyncStatus,
  onInboundStatus,
  syncOnce,
  subscribeToRally,
  unsubscribeFromRally
} from '../sync-worker.js';

/**
 * Mount the sync indicator into the page header.
 * @param {Object} opts
 * @param {() => string|null} opts.getRallyId - Returns the active rally id
 *   so the inbound retry knows which channel to re-subscribe.
 */
export function initSyncIndicator({ getRallyId } = {}) {
  if (isDemoMode()) return;

  const el = document.getElementById('user-info');
  if (!el) return;

  const inbound = document.createElement('span');
  inbound.id = 'inbound-indicator';
  inbound.className = 'sync-indicator';
  inbound.title = 'Cloud push channel';
  el.prepend(inbound);

  const indicator = document.createElement('span');
  indicator.id = 'sync-indicator';
  indicator.className = 'sync-indicator';
  indicator.title = 'Upload status';
  el.prepend(indicator);

  let outboundError = null;
  let inboundError = null;
  let pendingForRetry = 0;

  onSyncStatus(({ status, pendingCount, error }) => {
    indicator.className = `sync-indicator sync-${status} sync-clickable`;
    const labels = {
      synced: 'Synced',
      pending: `${pendingCount} pending`,
      offline: 'Offline',
      error: 'Sync error'
    };
    indicator.textContent = '↑ ' + (labels[status] || status);
    const base = 'Upload: ' + (labels[status] || status);
    indicator.title = error ? `${base}\n${error}\n\nClick for details` : `${base}\nClick to force sync`;
    outboundError = error || null;
    pendingForRetry = pendingCount || 0;
  });

  onInboundStatus(({ status, error }) => {
    const klass = {
      idle: 'sync-offline',
      connecting: 'sync-pending',
      live: 'sync-synced',
      offline: 'sync-offline',
      error: 'sync-error'
    }[status] || 'sync-offline';
    inbound.className = `sync-indicator ${klass}` + (error ? ' sync-clickable' : '');
    const labels = {
      idle: 'Push idle',
      connecting: 'Connecting…',
      live: 'Live',
      offline: 'Offline',
      error: 'Push error'
    };
    inbound.textContent = '↓ ' + (labels[status] || status);
    const base = 'Push channel: ' + (labels[status] || status);
    inbound.title = error ? `${base}\n${error}\n\nClick for details` : base;
    inboundError = error || null;
  });

  indicator.addEventListener('click', () => {
    if (outboundError) {
      showSyncErrorDialog('Upload sync error', outboundError, () => syncOnce());
    } else {
      // No error: still useful to force a sync attempt — tells user immediately
      // whether queued events upload, instead of waiting for the 5s tick.
      syncOnce().catch(e => console.warn('Manual syncOnce failed:', e.message));
    }
  });

  inbound.addEventListener('click', async () => {
    if (!inboundError) return;
    showSyncErrorDialog('Cloud push channel error', inboundError, async () => {
      const rallyId = getRallyId && getRallyId();
      if (!rallyId) return;
      const client = await getClient();
      unsubscribeFromRally();
      await subscribeToRally(client, rallyId);
    });
  });
}

function showSyncErrorDialog(title, error, onRetry) {
  const backdrop = document.getElementById('dialog-backdrop');
  const dialog = document.getElementById('dialog');
  if (!backdrop || !dialog) {
    alert(`${title}\n\n${error}`);
    return;
  }
  const safeError = String(error).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  dialog.innerHTML = `
    <h2>${title}</h2>
    <p>The last attempt failed with this error:</p>
    <pre class="sync-error-detail">${safeError}</pre>
    <p class="sync-error-hint">Common causes: the Supabase row-level-security policy is blocking writes for this user, the auth session has expired (sign out and back in), or the network is offline. Check the browser console for the full stack trace.</p>
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" id="sync-error-close">Close</button>
      <button type="button" class="btn btn-primary" id="sync-error-retry">Retry now</button>
    </div>
  `;
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');

  const close = () => {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    dialog.innerHTML = '';
  };
  document.getElementById('sync-error-close').onclick = close;
  document.getElementById('sync-error-retry').onclick = async () => {
    close();
    try { await onRetry(); } catch (e) { console.warn('Retry failed:', e.message); }
  };
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
}
