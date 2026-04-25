/**
 * sw-update.js — Service worker registration and in-app update prompt.
 *
 * On mobile, hard refresh is awkward, so we surface SW updates explicitly:
 * when a new SW finishes installing it sits in `waiting`, we show a banner,
 * and tapping "Reload" sends SKIP_WAITING and reloads on controllerchange.
 */

if ('serviceWorker' in navigator) {
  registerAndWatch();
}

async function registerAndWatch() {
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('Service worker registration failed', e);
    return;
  }

  // First load: nothing controls the page yet, so a `waiting` worker here is
  // not really an "update" — it'll claim on activate. Only prompt when there
  // is already a controller (i.e. an old SW the user is currently using).
  if (reg.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(reg.waiting);
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBanner(installing);
      }
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const checkForUpdate = () => { reg.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 60 * 60 * 1000);
}

function showUpdateBanner(worker) {
  if (document.getElementById('sw-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.className = 'sw-update-banner';
  banner.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'sw-update-banner-text';
  text.textContent = 'A new version of RallyLab is available.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'sw-update-banner-reload';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    reload.textContent = 'Updating…';
    worker.postMessage({ type: 'SKIP_WAITING' });
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'sw-update-banner-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(text, reload, dismiss);
  document.body.appendChild(banner);
}
