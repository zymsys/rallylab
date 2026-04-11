/**
 * operator/dialogs.js — Modal dialogs for race day operator.
 * Manual Rank, Remove Car, Load Roster, Car Statistics, Reports.
 */

import { computeCarStats } from '../scoring.js';
import { getCompletedStarts, getStart } from '../state-manager.js';
import { generateRallyReport, generateSectionReport, generateHeatReport, generateGroupReport } from './report.js';

const backdrop = () => document.getElementById('dialog-backdrop');
const dialogEl = () => document.getElementById('dialog');

function closeDialog() {
  const bd = backdrop();
  bd.classList.add('hidden');
  bd.setAttribute('aria-hidden', 'true');
  const d = dialogEl();
  d.innerHTML = '';
  d.classList.remove('dialog-wide');
}

function openDialog(html) {
  const d = dialogEl();
  d.innerHTML = html;
  const bd = backdrop();
  bd.classList.remove('hidden');
  bd.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    const input = d.querySelector('input, select, textarea');
    if (input) input.focus();
  });

  const onKey = (e) => {
    if (e.key === 'Escape') { closeDialog(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  bd.onclick = (e) => { if (e.target === bd) closeDialog(); };
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ─── Manual Rank Dialog ──────────────────────────────────────────

export function showManualRankDialog(sectionId, heatNumber, heatLanes, ctx) {
  if (!heatLanes || heatLanes.length === 0) return;

  const lanes = [...heatLanes].sort((a, b) => a.lane - b.lane);

  let laneRows = '';
  for (const lane of lanes) {
    const options = lanes.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    laneRows += `
      <tr>
        <td>Lane ${lane.lane}</td>
        <td><strong>#${lane.car_number}</strong> ${esc(lane.name)}</td>
        <td>
          <select class="form-input" data-car="${lane.car_number}" style="width:auto">
            ${options}
            <option value="dnf">DNF</option>
          </select>
        </td>
      </tr>`;
  }

  openDialog(`
    <div class="dialog-header">
      <h2>Manual Rank — Heat ${heatNumber}</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p class="form-hint" style="margin-bottom:0.75rem">Assign finish position for each lane.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Lane</th><th>Car</th><th>Place</th></tr></thead>
          <tbody id="dlg-manual-body">${laneRows}</tbody>
        </table>
      </div>
      <div id="dlg-manual-error" class="form-error" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="submit">Submit Results</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="submit"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-manual-error');
    errorEl.textContent = '';

    const selects = d.querySelectorAll('select[data-car]');
    const rankings = [];
    const usedPlaces = new Set();

    for (const sel of selects) {
      const carNumber = parseInt(sel.dataset.car, 10);
      const val = sel.value;
      if (val === 'dnf') continue;
      const place = parseInt(val, 10);
      if (usedPlaces.has(place)) {
        errorEl.textContent = `Place ${place} assigned to multiple cars`;
        return;
      }
      usedPlaces.add(place);
      rankings.push({ car_number: carNumber, place });
    }

    if (rankings.length === 0) {
      errorEl.textContent = 'At least one car must finish';
      return;
    }

    const btn = d.querySelector('[data-action="submit"]');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      await ctx.appendEvent({
        type: 'ResultManuallyEntered',
        section_id: sectionId,
        heat_number: heatNumber,
        lanes: heatLanes,
        rankings: rankings.sort((a, b) => a.place - b.place),
        timestamp: Date.now()
      });
      closeDialog();
      ctx.showToast('Manual results recorded', 'success');
      // Re-render
      ctx.navigate('live-console', { sectionId });
    } catch (e) {
      ctx.showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Results';
    }
  };
}

// ─── Remove Car Dialog ───────────────────────────────────────────

export function showRemoveCarDialog(sectionId, section, ctx) {
  const arrivedSet = new Set(section.arrived);
  const removedSet = new Set(section.removed);
  const eligible = section.participants
    .filter(p => arrivedSet.has(p.car_number) && !removedSet.has(p.car_number))
    .sort((a, b) => a.car_number - b.car_number);

  if (eligible.length === 0) {
    ctx.showToast('No cars to remove', 'warning');
    return;
  }

  const carOptions = eligible.map(p =>
    `<option value="${p.car_number}">#${p.car_number} ${esc(p.name)}</option>`
  ).join('');

  openDialog(`
    <div class="dialog-header">
      <h2>Remove Car</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-remove-car">Car</label>
        <select id="dlg-remove-car" class="form-input">${carOptions}</select>
      </div>
      <div class="form-group">
        <label for="dlg-remove-reason">Reason</label>
        <select id="dlg-remove-reason" class="form-input">
          <option value="destroyed">Car Destroyed</option>
          <option value="disqualified">Disqualified</option>
          <option value="withdrew">Withdrew</option>
          <option value="other">Other</option>
        </select>
      </div>
      <p class="form-hint" style="color:var(--color-warning)">
        This will remove the car from remaining heats and regenerate the schedule.
        Completed heat results will be preserved.
      </p>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-danger" data-action="remove">Remove Car</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="remove"]').onclick = async () => {
    const carNumber = parseInt(d.querySelector('#dlg-remove-car').value, 10);
    const reason = d.querySelector('#dlg-remove-reason').value;

    const btn = d.querySelector('[data-action="remove"]');
    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
      closeDialog();
      await ctx.removeCar(sectionId, carNumber, reason);
      ctx.showToast(`Car #${carNumber} removed`, 'success');
    } catch (e) {
      ctx.showToast(e.message, 'error');
    }
  };
}

// ─── Correct Lanes Dialog ────────────────────────────────────────

export function showCorrectLanesDialog(sectionId, heatNumber, heatLanes, ctx) {
  if (!heatLanes || heatLanes.length === 0) return;

  const lanes = [...heatLanes].sort((a, b) => a.lane - b.lane);
  const carsInHeat = lanes.map(l => ({ car_number: l.car_number, name: l.name }));

  let laneRows = '';
  for (const lane of lanes) {
    const options = carsInHeat.map(c =>
      `<option value="${c.car_number}"${c.car_number === lane.car_number ? ' selected' : ''}>#${c.car_number} ${esc(c.name)}</option>`
    ).join('');
    laneRows += `
      <tr>
        <td>Lane ${lane.lane}</td>
        <td>
          <select class="form-input" data-lane="${lane.lane}" style="width:auto">
            ${options}
          </select>
        </td>
      </tr>`;
  }

  openDialog(`
    <div class="dialog-header">
      <h2>Correct Lanes — Heat ${heatNumber}</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p class="form-hint" style="margin-bottom:0.75rem">Reassign which car was in each lane. Times stay the same — only the car-to-lane mapping changes.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Lane</th><th>Car</th></tr></thead>
          <tbody id="dlg-correct-body">${laneRows}</tbody>
        </table>
      </div>
      <div class="form-group" style="margin-top:0.75rem">
        <label for="dlg-correct-reason">Reason</label>
        <input id="dlg-correct-reason" class="form-input" type="text" placeholder="e.g. Cars 3 and 7 were swapped">
      </div>
      <div id="dlg-correct-error" class="form-error" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="submit">Save Correction</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="submit"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-correct-error');
    errorEl.textContent = '';

    const selects = d.querySelectorAll('select[data-lane]');
    const correctedLanes = [];
    const usedCars = new Set();

    for (const sel of selects) {
      const laneNum = parseInt(sel.dataset.lane, 10);
      const carNumber = parseInt(sel.value, 10);
      if (usedCars.has(carNumber)) {
        errorEl.textContent = `Car #${carNumber} assigned to multiple lanes`;
        return;
      }
      usedCars.add(carNumber);
      const car = carsInHeat.find(c => c.car_number === carNumber);
      correctedLanes.push({ lane: laneNum, car_number: carNumber, name: car.name });
    }

    // Check if anything actually changed
    const unchanged = lanes.every(orig => {
      const corrected = correctedLanes.find(c => c.lane === orig.lane);
      return corrected && corrected.car_number === orig.car_number;
    });
    if (unchanged) {
      errorEl.textContent = 'No changes made';
      return;
    }

    const reason = d.querySelector('#dlg-correct-reason').value.trim();

    const btn = d.querySelector('[data-action="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      closeDialog();
      await ctx.correctLanes(sectionId, heatNumber, correctedLanes, reason);
      ctx.showToast('Lane correction saved', 'success');
    } catch (e) {
      ctx.showToast(e.message, 'error');
    }
  };
}

// ─── Start Section Dialog ────────────────────────────────────────

export function showStartSectionDialog(sectionId, ctx) {
  const trackLaneCount = ctx.getTrackLaneCount();
  const allLanes = Array.from({ length: trackLaneCount }, (_, i) => i + 1);

  let checkboxes = '';
  for (const lane of allLanes) {
    checkboxes += `
      <label class="lane-checkbox">
        <input type="checkbox" value="${lane}" checked>
        Lane ${lane}
      </label>`;
  }

  openDialog(`
    <div class="dialog-header">
      <h2>Start Section</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p class="form-hint" style="margin-bottom:0.75rem">Select which lanes to use for this section. Uncheck any lanes that are unavailable.</p>
      <div class="lane-grid" id="dlg-lane-grid">${checkboxes}</div>
      <div id="dlg-start-error" class="form-error" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="start">Start Racing</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="start"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-start-error');
    errorEl.textContent = '';

    const selected = [];
    for (const cb of d.querySelectorAll('#dlg-lane-grid input[type="checkbox"]')) {
      if (cb.checked) selected.push(parseInt(cb.value, 10));
    }

    if (selected.length < 2) {
      errorEl.textContent = 'At least 2 lanes required';
      return;
    }

    const btn = d.querySelector('[data-action="start"]');
    btn.disabled = true;
    btn.textContent = 'Starting...';

    try {
      closeDialog();
      await ctx.startSection(sectionId, selected);
    } catch (e) {
      ctx.showToast(e.message, 'error');
    }
  };
}

// ─── Change Lanes Dialog ─────────────────────────────────────────

export function showChangeLanesDialog(sectionId, section, ctx) {
  const trackLaneCount = ctx.getTrackLaneCount();
  const allLanes = Array.from({ length: trackLaneCount }, (_, i) => i + 1);
  const currentLanes = new Set(ctx.getAvailableLanes(sectionId));

  let checkboxes = '';
  for (const lane of allLanes) {
    const checked = currentLanes.has(lane) ? ' checked' : '';
    checkboxes += `
      <label class="lane-checkbox">
        <input type="checkbox" value="${lane}"${checked}>
        Lane ${lane}
      </label>`;
  }

  openDialog(`
    <div class="dialog-header">
      <h2>Change Lanes</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p class="form-hint" style="margin-bottom:0.75rem">Select which lanes to use going forward. The schedule will be regenerated for remaining heats.</p>
      <div class="lane-grid" id="dlg-lane-grid">${checkboxes}</div>
      <div class="form-group" style="margin-top:0.75rem">
        <label for="dlg-lanes-reason">Reason</label>
        <input id="dlg-lanes-reason" class="form-input" type="text" placeholder="e.g. Lane 4 sensor broken">
      </div>
      <div id="dlg-lanes-error" class="form-error" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="apply">Apply Changes</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="apply"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-lanes-error');
    errorEl.textContent = '';

    const selected = [];
    for (const cb of d.querySelectorAll('#dlg-lane-grid input[type="checkbox"]')) {
      if (cb.checked) selected.push(parseInt(cb.value, 10));
    }

    if (selected.length < 2) {
      errorEl.textContent = 'At least 2 lanes required';
      return;
    }

    // Check if anything changed
    if (selected.length === currentLanes.size && selected.every(l => currentLanes.has(l))) {
      errorEl.textContent = 'No changes made';
      return;
    }

    const reason = d.querySelector('#dlg-lanes-reason').value.trim();

    const btn = d.querySelector('[data-action="apply"]');
    btn.disabled = true;
    btn.textContent = 'Applying...';

    try {
      closeDialog();
      await ctx.changeLanes(sectionId, selected, reason);
      ctx.showToast('Lanes updated — schedule regenerated', 'success');
    } catch (e) {
      ctx.showToast(e.message, 'error');
    }
  };
}

// ─── Restore from USB Dialog ─────────────────────────────────────

export function showRestoreFromUSBDialog(ctx) {
  openDialog(`
    <div class="dialog-header">
      <h2>Restore from USB Backup</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="upload-area" id="dlg-upload-area">
        <input type="file" id="dlg-file-input" accept=".json">
        <p>Drop a backup file here or <strong>click to browse</strong></p>
        <p class="form-hint" style="margin-top:0.5rem">rallylab-backup.json from USB stick</p>
      </div>
      <div id="dlg-upload-error" class="form-error" style="margin-top:0.5rem"></div>
      <div id="dlg-preview" style="display:none">
        <p class="info-line" id="dlg-preview-text"></p>
        <p class="form-hint" id="dlg-preview-detail"></p>
        <p class="form-hint" style="color:var(--color-warning);margin-top:0.5rem">
          This will replace all current race data.
        </p>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="restore" disabled>Restore Backup</button>
    </div>
  `);

  let backupData = null;

  const d = dialogEl();
  const area = d.querySelector('#dlg-upload-area');
  const fileInput = d.querySelector('#dlg-file-input');
  const errorEl = d.querySelector('#dlg-upload-error');
  const previewEl = d.querySelector('#dlg-preview');
  const previewText = d.querySelector('#dlg-preview-text');
  const previewDetail = d.querySelector('#dlg-preview-detail');
  const restoreBtn = d.querySelector('[data-action="restore"]');

  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  area.onclick = () => fileInput.click();

  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    errorEl.textContent = '';
    previewEl.style.display = 'none';
    restoreBtn.disabled = true;
    backupData = null;

    try {
      const { readBackupFile } = await import('../usb-backup.js');
      const data = await readBackupFile(file);
      backupData = data;

      // Extract rally name from first RallyCreated event
      const rallyEvent = data.events.find(e => e.type === 'RallyCreated');
      const rallyName = rallyEvent?.rally_name || 'Unknown Rally';
      const backupTime = new Date(data.timestamp).toLocaleString();

      previewText.textContent = `${rallyName} — ${data.events.length} events`;
      previewDetail.textContent = `Backup taken: ${backupTime}`;
      previewEl.style.display = 'block';
      restoreBtn.disabled = false;
    } catch (e) {
      errorEl.textContent = e.message;
    }
  }

  restoreBtn.onclick = async () => {
    if (!backupData) return;
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Restoring...';

    try {
      const { clearAndRebuild, rebuildFromStore } = await import('./app.js');
      const { appendEvent: storeAppend } = await import('../event-store.js');

      await clearAndRebuild();

      for (const evt of backupData.events) {
        // Strip local auto-increment id so IndexedDB assigns new keys.
        // Keep server_id and synced so sync-worker doesn't re-upload.
        const { id, ...rest } = evt;
        await storeAppend(rest);
      }

      await rebuildFromStore();

      closeDialog();
      ctx.showToast(`Restored ${backupData.events.length} events from backup`, 'success');
      ctx.navigate('rally-home', {});
    } catch (e) {
      ctx.showToast('Restore failed: ' + e.message, 'error');
      restoreBtn.disabled = false;
      restoreBtn.textContent = 'Restore Backup';
    }
  };
}

// ─── Track Manager Dialog ─────────────────────────────────────────

export function showTrackManagerDialog(ctx) {
  const mode = ctx.getTrackMode();
  const isSerial = mode === 'serial';
  const isWifi = mode === 'wifi';
  const isFake = mode === 'fake';
  const isDisconnected = mode === 'manual';
  const showUsb = ctx.isSerialSupported();

  // Status line
  let statusHtml;
  if (isSerial) {
    statusHtml = '<span class="status-badge status-active">Connected via USB</span>';
  } else if (isWifi) {
    const ip = ctx.getSavedTrackIp() || '';
    statusHtml = `<span class="status-badge status-active">WiFi &mdash; ${esc(ip)}</span>`;
  } else if (isFake) {
    statusHtml = '<span class="status-badge status-active">Fake Track</span>';
  } else {
    statusHtml = '<span class="status-badge status-idle">Not Connected</span>';
  }

  let bodyHtml = `<div id="dlg-track-status" style="margin-bottom:1rem">${statusHtml}</div>`;

  // Live sensor status (USB or WiFi)
  if (isSerial || isWifi) {
    bodyHtml += `
      <div style="border-top:1px solid var(--color-border);padding-top:1rem;margin-bottom:1rem">
        <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-secondary)">Sensor Status</label>
        <div id="dlg-sensor-status">Loading&hellip;</div>
      </div>`;
  }

  // WiFi setup section (only when USB is connected)
  if (isSerial) {
    bodyHtml += `
      <div style="border-top:1px solid var(--color-border);padding-top:1rem">
        <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.25rem;color:var(--color-text-secondary)">Pico WiFi</label>
        <div id="dlg-wifi-status" class="form-hint" style="margin-bottom:0.75rem">Checking&hellip;</div>
        <button class="btn btn-secondary btn-sm" data-action="scan" id="dlg-scan-btn" disabled>Scan for Networks</button>
        <span id="dlg-scan-spinner" class="form-hint" style="display:none;margin-left:0.5rem">Scanning&hellip;</span>
        <div id="dlg-network-list" style="display:none;margin-top:0.75rem"></div>
        <div id="dlg-wifi-form" style="display:none;margin-top:0.75rem">
          <div class="form-group" id="dlg-password-group">
            <label for="dlg-wifi-password">Password</label>
            <input id="dlg-wifi-password" class="form-input" type="password" placeholder="WiFi password">
          </div>
          <button class="btn btn-primary btn-sm" data-action="wifi-connect" id="dlg-wifi-connect-btn">Connect</button>
        </div>
        <div id="dlg-wifi-result" style="display:none;margin-top:0.75rem"></div>
        <div id="dlg-wifi-error" class="form-error" style="margin-top:0.5rem"></div>
      </div>
      <div style="border-top:1px solid var(--color-border);padding-top:1rem;margin-top:1rem">
        <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.25rem;color:var(--color-text-secondary)">Hostname</label>
        <div id="dlg-hostname-status" class="form-hint" style="margin-bottom:0.5rem">Checking&hellip;</div>
        <div style="display:flex;gap:0.5rem;align-items:flex-end">
          <div class="form-group" style="flex:1;margin:0">
            <input id="dlg-hostname-input" class="form-input" type="text"
              placeholder="e.g. pack42" maxlength="32" style="font-family:monospace">
          </div>
          <button class="btn btn-primary btn-sm" data-action="hostname-set" id="dlg-hostname-set-btn">Set</button>
          <button class="btn btn-secondary btn-sm" data-action="hostname-clear" id="dlg-hostname-clear-btn">Reset</button>
        </div>
        <p class="form-hint" style="margin-top:0.25rem">Lowercase letters, numbers, and hyphens. Devices on the network can reach this Pico at <strong><span id="dlg-hostname-preview">rallylab-XXXXXX</span>.local</strong></p>
        <div id="dlg-hostname-error" class="form-error" style="margin-top:0.5rem"></div>
      </div>`;
  }

  // Connect options (when disconnected)
  if (isDisconnected) {
    const savedIp = ctx.getSavedTrackIp() || '';
    bodyHtml += `
      <div class="form-group">
        <label for="dlg-track-ip">WiFi Address</label>
        <input id="dlg-track-ip" class="form-input" type="text"
          placeholder="e.g. 192.168.4.1 or rallylab.local" value="${esc(savedIp)}">
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-primary" data-action="connect-wifi">Connect WiFi</button>
        ${showUsb ? '<button class="btn btn-secondary" data-action="connect-usb">Connect USB</button>' : ''}
      </div>
      <div id="dlg-connect-error" class="form-error" style="margin-top:0.5rem"></div>`;
  }

  // Footer
  let footerHtml = '';
  if (isSerial || isWifi) {
    footerHtml += '<button class="btn btn-secondary" data-action="disconnect">Disconnect</button>';
  }
  footerHtml += `<div style="flex:1"></div>`;
  footerHtml += '<button class="btn btn-primary" data-action="done">Done</button>';

  openDialog(`
    <div class="dialog-header">
      <h2>Track Connection</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">${bodyHtml}</div>
    <div class="dialog-footer">${footerHtml}</div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="done"]').onclick = closeDialog;

  // Disconnect
  const disconnBtn = d.querySelector('[data-action="disconnect"]');
  if (disconnBtn) {
    disconnBtn.onclick = () => {
      if (isSerial) ctx.disconnectSerial();
      else if (isWifi) ctx.disconnectWifi();
      closeDialog();
      ctx.showToast('Track disconnected', 'info');
      ctx.renderCurrentScreen();
    };
  }

  // Live sensor status polling
  if (isSerial || isWifi) {
    _startSensorPolling(d, ctx, isSerial);
  }

  // USB Serial → WiFi setup
  if (isSerial) {
    _setupWifiSection(d, ctx);
  }

  // Disconnected → connect options
  if (isDisconnected) {
    _setupConnectOptions(d, ctx);
  }
}

function _startSensorPolling(d, ctx, isSerial) {
  const container = d.querySelector('#dlg-sensor-status');
  if (!container) return;

  let timer = null;
  let lastHtml = '';

  function scheduleNext() {
    if (document.body.contains(container)) {
      timer = setTimeout(poll, 500);
    }
  }

  async function poll() {
    try {
      let dbg;
      if (isSerial) {
        dbg = await ctx.sendSerialCommand('dbg');
      } else {
        const ip = ctx.getSavedTrackIp();
        if (!ip) { scheduleNext(); return; }
        const resp = await fetch(`http://${ip}/dbg`, { signal: AbortSignal.timeout(3000) });
        dbg = await resp.json();
      }

      if (!dbg || !dbg.io) { scheduleNext(); return; }

      const lanes = dbg.io.lanes || {};
      const gateReady = dbg.engine?.gate_ready;

      let html = '<div class="sensor-grid">';

      // Gate
      const gateLabel = gateReady ? 'Ready' : 'Open';
      const gateCls = gateReady ? 'sensor-ready' : 'sensor-triggered';
      html += `<div class="sensor-item ${gateCls}"><span class="sensor-dot"></span> Gate: ${esc(gateLabel)}</div>`;

      // Lanes
      const laneNums = Object.keys(lanes).map(Number).sort((a, b) => a - b);
      for (const lane of laneNums) {
        const info = lanes[lane];
        const triggered = info.debounced === 0;
        const cls = triggered ? 'sensor-triggered' : 'sensor-idle';
        const label = triggered ? 'Triggered' : 'Clear';
        html += `<div class="sensor-item ${cls}"><span class="sensor-dot"></span> Lane ${lane}: ${esc(label)}</div>`;
      }

      html += '</div>';

      // Only update DOM if content changed (avoids flicker)
      if (html !== lastHtml) {
        container.innerHTML = html;
        lastHtml = html;
      }
    } catch {
      // Port busy (e.g. wait_race pending) — show hint, keep retrying
      if (!lastHtml) {
        container.textContent = 'Waiting for track controller\u2026';
      }
    }

    scheduleNext();
  }

  poll();

  // Clean up when dialog closes — patch closeDialog via MutationObserver
  const observer = new MutationObserver(() => {
    if (!d.querySelector('#dlg-sensor-status')) {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    }
  });
  observer.observe(d, { childList: true });
}

function _setupWifiSection(d, ctx) {
  const wifiStatusEl = d.querySelector('#dlg-wifi-status');
  const scanBtn = d.querySelector('#dlg-scan-btn');
  const scanSpinner = d.querySelector('#dlg-scan-spinner');
  const networkList = d.querySelector('#dlg-network-list');
  const wifiForm = d.querySelector('#dlg-wifi-form');
  const passwordGroup = d.querySelector('#dlg-password-group');
  const wifiError = d.querySelector('#dlg-wifi-error');
  const wifiResult = d.querySelector('#dlg-wifi-result');
  const passwordInput = d.querySelector('#dlg-wifi-password');
  const wifiConnectBtn = d.querySelector('#dlg-wifi-connect-btn');

  let selectedSsid = null;

  // -- Hostname section --
  const hostnameStatusEl = d.querySelector('#dlg-hostname-status');
  const hostnameInput = d.querySelector('#dlg-hostname-input');
  const hostnamePreview = d.querySelector('#dlg-hostname-preview');
  const hostnameSetBtn = d.querySelector('#dlg-hostname-set-btn');
  const hostnameClearBtn = d.querySelector('#dlg-hostname-clear-btn');
  const hostnameError = d.querySelector('#dlg-hostname-error');

  function updateHostnamePreview() {
    const val = hostnameInput.value.trim().toLowerCase();
    hostnamePreview.textContent = val || 'rallylab-XXXXXX';
  }
  hostnameInput.addEventListener('input', updateHostnamePreview);

  function showHostname(hostname) {
    // hostname is e.g. "rallylab-a1b2c3.local"
    const name = hostname.replace(/\.local$/, '');
    hostnameStatusEl.innerHTML = `Currently <strong>${esc(hostname)}</strong>`;
    hostnameInput.value = name;
    hostnamePreview.textContent = name;
  }

  hostnameSetBtn.onclick = async () => {
    const name = hostnameInput.value.trim().toLowerCase();
    if (!name) { hostnameError.textContent = 'Enter a hostname'; return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 32) {
      hostnameError.textContent = 'Lowercase letters, numbers, and hyphens only (max 32 chars)';
      return;
    }
    hostnameError.textContent = '';
    hostnameSetBtn.disabled = true;
    try {
      const result = await ctx.sendSerialCommand(`hostname_set ${name}`);
      if (result.error) { hostnameError.textContent = result.error; }
      else { showHostname(result.hostname); ctx.showToast(`Hostname set to ${result.hostname}`, 'success'); }
    } catch (e) { hostnameError.textContent = e.message; }
    hostnameSetBtn.disabled = false;
  };

  hostnameClearBtn.onclick = async () => {
    hostnameError.textContent = '';
    hostnameClearBtn.disabled = true;
    try {
      const result = await ctx.sendSerialCommand('hostname_clear');
      if (result.error) { hostnameError.textContent = result.error; }
      else { showHostname(result.hostname); ctx.showToast('Hostname reset to default', 'info'); }
    } catch (e) { hostnameError.textContent = e.message; }
    hostnameClearBtn.disabled = false;
  };

  // Check current WiFi status on the Pico
  ctx.sendSerialCommand('wifi').then(status => {
    if (status.hostname) showHostname(status.hostname);
    else hostnameStatusEl.textContent = '';

    if (status.connected) {
      wifiStatusEl.innerHTML = `Connected to <strong>${esc(status.ssid)}</strong> &mdash; ${esc(status.ip)}`;
      const switchBtn = document.createElement('button');
      switchBtn.className = 'btn btn-primary btn-sm';
      switchBtn.style.marginTop = '0.5rem';
      switchBtn.style.display = 'block';
      switchBtn.textContent = 'Switch to WiFi';
      switchBtn.onclick = async () => {
        try {
          ctx.disconnectSerial();
          await ctx.connectWifi(status.ip);
          closeDialog();
          ctx.showToast(`Switched to WiFi \u2014 ${status.ip}`, 'success');
          ctx.renderCurrentScreen();
        } catch (e) {
          wifiError.textContent = 'Switch failed: ' + e.message;
        }
      };
      wifiStatusEl.appendChild(switchBtn);
    } else {
      wifiStatusEl.textContent = 'Not connected';
    }
    scanBtn.disabled = false;
  }).catch(() => {
    wifiStatusEl.textContent = 'Could not query WiFi status';
    hostnameStatusEl.textContent = '';
    scanBtn.disabled = false;
  });

  // Scan for networks
  scanBtn.onclick = async () => {
    wifiError.textContent = '';
    scanBtn.disabled = true;
    scanSpinner.style.display = '';
    networkList.style.display = 'none';
    wifiForm.style.display = 'none';
    wifiResult.style.display = 'none';

    try {
      const networks = await ctx.sendSerialCommand('wifi_scan');
      scanSpinner.style.display = 'none';
      scanBtn.disabled = false;

      if (!Array.isArray(networks) || networks.length === 0) {
        wifiError.textContent = 'No networks found';
        return;
      }

      networkList.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'wifi-network-list';

      for (const net of networks) {
        const item = document.createElement('label');
        item.className = 'wifi-network';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'wifi-network';
        radio.value = net.ssid;
        radio.onchange = () => {
          selectedSsid = net.ssid;
          wifiForm.style.display = '';
          if (net.security === 'open') {
            passwordGroup.style.display = 'none';
          } else {
            passwordGroup.style.display = '';
            passwordInput.focus();
          }
        };

        const ssidSpan = document.createElement('span');
        ssidSpan.className = 'wifi-network-ssid';
        ssidSpan.textContent = net.ssid;

        const metaSpan = document.createElement('span');
        metaSpan.className = 'wifi-network-meta';
        metaSpan.textContent = `${net.rssi} dBm`;
        if (net.security !== 'open') metaSpan.textContent += '  \uD83D\uDD12';

        item.appendChild(radio);
        item.appendChild(ssidSpan);
        item.appendChild(metaSpan);
        list.appendChild(item);
      }

      networkList.appendChild(list);
      networkList.style.display = '';
    } catch (e) {
      scanSpinner.style.display = 'none';
      scanBtn.disabled = false;
      wifiError.textContent = e.message;
    }
  };

  // Configure WiFi on Pico
  wifiConnectBtn.onclick = async () => {
    if (!selectedSsid) return;
    wifiError.textContent = '';
    wifiConnectBtn.disabled = true;
    wifiConnectBtn.textContent = 'Connecting\u2026';

    try {
      const password = passwordInput.value;
      const result = await ctx.sendSerialCommand(`wifi_setup ${selectedSsid} ${password}`);

      if (result.connected) {
        wifiForm.style.display = 'none';
        networkList.style.display = 'none';
        wifiResult.style.display = '';
        const hn = hostnameInput.value.trim();
        const addrHint = hn ? `${esc(result.ip)} (${esc(hn)}.local)` : esc(result.ip);
        wifiResult.innerHTML = `
          <div class="wifi-result-success">
            <strong>WiFi connected</strong> &mdash; ${addrHint}
            <p class="form-hint" style="margin:0.5rem 0">
              Disconnect USB and power the Pico separately, or switch now.
            </p>
            <button class="btn btn-primary btn-sm" data-action="switch-wifi">Switch to WiFi</button>
          </div>`;
        localStorage.setItem('rallylab_track_ip', result.ip);

        wifiResult.querySelector('[data-action="switch-wifi"]').onclick = async () => {
          try {
            ctx.disconnectSerial();
            await ctx.connectWifi(result.ip);
            closeDialog();
            ctx.showToast(`Switched to WiFi \u2014 ${result.ip}`, 'success');
            ctx.renderCurrentScreen();
          } catch (e) {
            wifiError.textContent = 'Switch failed: ' + e.message;
          }
        };
      } else {
        wifiError.textContent = result.error || 'Connection failed';
      }

      wifiConnectBtn.disabled = false;
      wifiConnectBtn.textContent = 'Connect';
    } catch (e) {
      wifiError.textContent = e.message;
      wifiConnectBtn.disabled = false;
      wifiConnectBtn.textContent = 'Connect';
    }
  };
}

function _setupConnectOptions(d, ctx) {
  const connectError = d.querySelector('#dlg-connect-error');
  const ipInput = d.querySelector('#dlg-track-ip');
  const connectWifiBtn = d.querySelector('[data-action="connect-wifi"]');
  const connectUsbBtn = d.querySelector('[data-action="connect-usb"]');

  if (connectWifiBtn) {
    const doConnect = async () => {
      connectError.textContent = '';
      const ip = ipInput.value.trim();
      if (!ip) {
        connectError.textContent = 'Enter an IP address';
        return;
      }
      connectWifiBtn.disabled = true;
      connectWifiBtn.textContent = 'Connecting\u2026';
      try {
        await ctx.connectWifi(ip);
        closeDialog();
        ctx.showToast(`Track connected at ${ip}`, 'success');
        afterTrackConnect(ctx);
      } catch (e) {
        connectError.textContent = e.message;
        connectWifiBtn.disabled = false;
        connectWifiBtn.textContent = 'Connect WiFi';
      }
    };
    connectWifiBtn.onclick = doConnect;
    ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doConnect(); }
    });
  }

  if (connectUsbBtn) {
    connectUsbBtn.onclick = async () => {
      connectError.textContent = '';
      connectUsbBtn.disabled = true;
      connectUsbBtn.textContent = 'Connecting\u2026';
      try {
        await ctx.connectSerial((status) => {
          connectUsbBtn.textContent = status;
        });
        closeDialog();
        ctx.showToast('Track connected via USB', 'success');
        afterTrackConnect(ctx);
      } catch (e) {
        connectError.textContent = e.message;
        connectUsbBtn.disabled = false;
        connectUsbBtn.textContent = 'Connect USB';
      }
    };
  }
}

// ─── Connect Track Dialog (legacy) ────────────────────────────────

export function showConnectTrackDialog(ctx) {
  const savedIp = ctx.getSavedTrackIp() || '';
  const showUsb = ctx.isSerialSupported();

  openDialog(`
    <div class="dialog-header">
      <h2>Connect Track</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-track-ip">Track Controller Address</label>
        <input id="dlg-track-ip" class="form-input" type="text"
          placeholder="e.g. 192.168.4.1 or rallylab.local" value="${esc(savedIp)}">
        <p class="form-hint">IP address or .local hostname from the Pico.</p>
      </div>
      ${showUsb ? `
      <div style="text-align:center;margin:1rem 0;color:var(--color-text-muted)">— or —</div>
      <div class="form-group" style="text-align:center">
        <button class="btn btn-secondary" data-action="usb">Connect via USB</button>
        <p class="form-hint" style="margin-top:0.5rem">Plug in the Pico via USB cable — no WiFi needed.</p>
      </div>
      ` : ''}
      <div id="dlg-track-error" class="form-error" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="connect">Connect</button>
    </div>
  `);

  const d = dialogEl();
  const ipInput = d.querySelector('#dlg-track-ip');
  const errorEl = d.querySelector('#dlg-track-error');
  const connectBtn = d.querySelector('[data-action="connect"]');

  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  async function doConnect() {
    errorEl.textContent = '';
    const ip = ipInput.value.trim();
    if (!ip) {
      errorEl.textContent = 'Enter an IP address';
      return;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    try {
      await ctx.connectWifi(ip);
      closeDialog();
      ctx.showToast(`Track connected at ${ip}`, 'success');
      afterTrackConnect(ctx);
    } catch (e) {
      errorEl.textContent = e.message;
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  }

  connectBtn.onclick = doConnect;
  ipInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doConnect(); }
  });

  const usbBtn = d.querySelector('[data-action="usb"]');
  if (usbBtn) {
    usbBtn.onclick = async () => {
      errorEl.textContent = '';
      usbBtn.disabled = true;
      usbBtn.textContent = 'Connecting...';
      try {
        await ctx.connectSerial((status) => {
          usbBtn.textContent = status;
        });
        closeDialog();
        ctx.showToast('Track connected via USB', 'success');
        afterTrackConnect(ctx);
      } catch (e) {
        errorEl.textContent = e.message;
        usbBtn.disabled = false;
        usbBtn.textContent = 'Connect via USB';
      }
    };
  }
}

/**
 * After a track connects, auto-resume if on live-console with a paused section.
 */
function afterTrackConnect(ctx) {
  const hash = location.hash.replace(/^#/, '');
  const match = hash.match(/^live-console\/sectionId=([^/]+)/);
  if (match && !ctx.liveSection) {
    ctx.resumeSection(match[1]);
  } else {
    ctx.renderCurrentScreen();
  }
}

// ─── Load Roster Dialog ──────────────────────────────────────────

export function showLoadRosterDialog(ctx) {
  openDialog(`
    <div class="dialog-header">
      <h2>Load Roster Package</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="upload-area" id="dlg-upload-area">
        <input type="file" id="dlg-file-input" accept=".json">
        <p>Drop a roster package here or <strong>click to browse</strong></p>
        <p class="form-hint" style="margin-top:0.5rem">JSON file exported from Pre-Race</p>
      </div>
      <div id="dlg-upload-error" class="form-error" style="margin-top:0.5rem"></div>
      <div id="dlg-preview" style="display:none">
        <p class="info-line" id="dlg-preview-text"></p>
        <div class="table-wrap" style="margin-top:0.5rem">
          <table>
            <thead><tr><th>Section</th><th>Participants</th></tr></thead>
            <tbody id="dlg-preview-body"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="load" disabled>Load Roster</button>
    </div>
  `);

  let rosterData = null;

  const d = dialogEl();
  const area = d.querySelector('#dlg-upload-area');
  const fileInput = d.querySelector('#dlg-file-input');
  const errorEl = d.querySelector('#dlg-upload-error');
  const previewEl = d.querySelector('#dlg-preview');
  const previewBody = d.querySelector('#dlg-preview-body');
  const previewText = d.querySelector('#dlg-preview-text');
  const loadBtn = d.querySelector('[data-action="load"]');

  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  area.onclick = () => fileInput.click();

  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    errorEl.textContent = '';
    previewEl.style.display = 'none';
    loadBtn.disabled = true;
    rosterData = null;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.sections || !Array.isArray(data.sections)) {
        throw new Error('Invalid roster package: missing sections array');
      }
      rosterData = data;

      previewText.textContent = `${data.rally_name || 'Rally'} — ${data.sections.length} section(s)`;
      previewBody.innerHTML = '';
      for (const sec of data.sections) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(sec.section_name)}</td><td>${sec.participants.length}</td>`;
        previewBody.appendChild(tr);
      }
      previewEl.style.display = 'block';
      loadBtn.disabled = false;
    } catch (e) {
      errorEl.textContent = e.message;
    }
  }

  loadBtn.onclick = async () => {
    if (!rosterData) return;
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading...';

    try {
      // Clear existing data
      const { clearAndRebuild, appendAndRebuild } = await import('./app.js');
      await clearAndRebuild();

      const rallyId = rosterData.rally_id || crypto.randomUUID();

      // Create RallyCreated if data includes rally info
      if (rosterData.rally_name) {
        await appendAndRebuild({
          type: 'RallyCreated',
          rally_id: rallyId,
          rally_name: rosterData.rally_name,
          rally_date: rosterData.rally_date || '',
          created_by: 'operator',
          timestamp: Date.now()
        });
      }

      // Create groups if present
      if (rosterData.groups) {
        for (const group of rosterData.groups) {
          await appendAndRebuild({
            type: 'GroupCreated',
            rally_id: rallyId,
            group_id: group.group_id,
            group_name: group.group_name,
            timestamp: Date.now()
          });
        }
      }

      // Create SectionCreated + RosterUpdated for each section
      for (const sec of rosterData.sections) {
        const sectionId = sec.section_id || crypto.randomUUID();
        await appendAndRebuild({
          type: 'SectionCreated',
          rally_id: rallyId,
          section_id: sectionId,
          section_name: sec.section_name,
          timestamp: Date.now()
        });
        if (sec.participants && sec.participants.length > 0) {
          await appendAndRebuild({
            type: 'RosterUpdated',
            rally_id: rallyId,
            section_id: sectionId,
            participants: sec.participants,
            timestamp: Date.now()
          });
        }
      }

      closeDialog();
      ctx.showToast('Roster loaded', 'success');
      ctx.navigate('rally-home', {});
    } catch (e) {
      ctx.showToast(e.message, 'error');
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Roster';
    }
  };
}

// ─── Car Statistics Dialog ──────────────────────────────────────

export function showCarStatsDialog(section) {
  const stats = computeCarStats(section);
  if (stats.length === 0) {
    openDialog(`
      <div class="dialog-header">
        <h2>Car Statistics</h2>
        <button class="dialog-close" aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <p class="empty-state">No race results yet.</p>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" data-action="close">Close</button>
      </div>
    `);
    const d = dialogEl();
    d.querySelector('.dialog-close').onclick = closeDialog;
    d.querySelector('[data-action="close"]').onclick = closeDialog;
    return;
  }

  // Collect all lanes that appear in results
  const allLanes = new Set();
  for (const car of stats) {
    for (const lane of Object.keys(car.lane_times)) {
      allLanes.add(Number(lane));
    }
  }
  const lanes = [...allLanes].sort((a, b) => a - b);

  const fmt = (ms) => {
    if (ms == null || !isFinite(ms)) return '—';
    return (ms / 1000).toFixed(3) + 's';
  };

  // Build table
  let html = '<div class="table-wrap"><table>';
  html += '<thead><tr><th>Car #</th><th>Name</th>';
  for (const l of lanes) html += `<th>Lane ${l}</th>`;
  html += '<th>Avg</th><th>Best</th><th>Heats</th></tr></thead><tbody>';

  for (const car of stats) {
    html += `<tr${car.removed ? ' class="incomplete-row"' : ''}>`;
    html += `<td>#${car.car_number}</td>`;
    html += `<td>${esc(car.name)}</td>`;
    for (const l of lanes) {
      const time = car.lane_times[l];
      html += `<td>${time !== undefined ? fmt(time) : '—'}</td>`;
    }
    html += `<td><strong>${fmt(car.avg_time_ms)}</strong></td>`;
    html += `<td>${fmt(car.best_time_ms)}</td>`;
    html += `<td>${car.heats_run}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  openDialog(`
    <div class="dialog-header">
      <h2>Car Statistics — ${esc(section.section_name)}</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body car-stats-body">${html}</div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="close">Close</button>
    </div>
  `);

  const d = dialogEl();
  d.classList.add('dialog-wide');
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="close"]').onclick = closeDialog;
}

// ─── Learn Pin Mapping ────────────────────────────────────────

/**
 * Interactive wizard that discovers GPIO pin assignments by asking the user
 * to trigger each sensor one at a time (like MIDI learn mode).
 */
export async function showLearnModeDialog(ctx) {
  const lanePins = {};
  let gatePin = null;
  let gateInvert = false;
  let learnCtrl = null;
  let laneNum = 1;
  let phase = 'init'; // init, gate-open, gate-close, lane, done

  function renderContent() {
    const d = dialogEl();
    const body = d.querySelector('#learn-body');
    const status = d.querySelector('#learn-status');
    const doneBtn = d.querySelector('[data-action="save"]');

    // Build learned pins summary
    let summary = '';
    if (gatePin !== null) {
      summary += `<div class="learn-pin-ok">Gate: GP${gatePin}${gateInvert ? ' (inverted)' : ''}</div>`;
    }
    for (const [lane, gpio] of Object.entries(lanePins)) {
      summary += `<div class="learn-pin-ok">Lane ${lane}: GP${gpio}</div>`;
    }

    let prompt = '';
    let hint = '';
    if (phase === 'init') {
      prompt = 'Starting learn mode…';
    } else if (phase === 'gate-open') {
      prompt = 'Open the start gate';
      hint = 'Release the gate lever, or press the gate button';
    } else if (phase === 'gate-close') {
      prompt = 'Now close the gate';
      hint = 'Push the gate back down, or release the button';
    } else if (phase === 'lane') {
      prompt = `Trigger lane ${laneNum} sensor`;
      hint = 'Push a car across the finish line, or press the lane button';
    } else if (phase === 'done') {
      prompt = 'All pins learned!';
    }

    body.innerHTML = `
      ${summary ? '<div class="learn-summary">' + summary + '</div>' : ''}
      <div class="learn-prompt">${esc(prompt)}</div>
      ${hint ? '<p class="form-hint">' + esc(hint) + '</p>' : ''}
      ${phase !== 'done' && phase !== 'init' ? '<div class="learn-waiting">Waiting for signal…</div>' : ''}
    `;

    if (doneBtn) {
      const canSave = gatePin !== null && Object.keys(lanePins).length > 0;
      doneBtn.disabled = !canSave;
      doneBtn.style.display = phase === 'done' || canSave ? '' : 'none';
    }
  }

  openDialog(`
    <div class="dialog-header">
      <h2>Learn Pin Mapping</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body" id="learn-body"></div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <div style="flex:1"></div>
      <button class="btn btn-primary" data-action="save" disabled style="display:none">Save &amp; Restart</button>
    </div>
  `);

  const d = dialogEl();

  async function cleanup() {
    if (learnCtrl) {
      try { await learnCtrl.cancel(); } catch {}
      learnCtrl = null;
    }
    closeDialog();
  }

  d.querySelector('.dialog-close').onclick = cleanup;
  d.querySelector('[data-action="cancel"]').onclick = cleanup;
  d.querySelector('[data-action="save"]').onclick = async () => {
    if (!learnCtrl) return;
    const status = d.querySelector('#learn-body');
    if (status) status.innerHTML = '<div class="learn-prompt">Saving and restarting…</div>';
    try {
      await learnCtrl.finish({ gatePin, gateInvert, lanePins });
      learnCtrl = null;
      closeDialog();
      ctx.showToast('Pin mapping saved — firmware restarted', 'success');
      ctx.renderCurrentScreen();
    } catch (e) {
      if (status) status.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
    }
  };

  renderContent();

  // Start learn mode
  try {
    learnCtrl = await ctx.startLearnMode();
  } catch (e) {
    const body = d.querySelector('#learn-body');
    body.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
    return;
  }

  // ── Step 1: Gate open ──
  phase = 'gate-open';
  renderContent();
  let edge;
  try {
    edge = await learnCtrl.waitForEdge();
  } catch { return; } // cancelled
  gatePin = edge.gpio;
  // If the pin went LOW on "open", that's inverted (breadboard button style)
  // If it went HIGH on "open", that's normal (reed switch)
  gateInvert = (edge.value === 0);

  // ── Step 2: Gate close (confirm + determine polarity) ──
  phase = 'gate-close';
  renderContent();
  try {
    edge = await learnCtrl.waitForEdge();
  } catch { return; }
  // Confirm it's the same pin
  if (edge.gpio !== gatePin) {
    // Different pin fired — use the first one as gate, exclude both
    await learnCtrl.excludePin(edge.gpio);
  }
  await learnCtrl.excludePin(gatePin);

  // ── Step 3+: Lanes ──
  phase = 'lane';
  renderContent();

  while (true) {
    try {
      edge = await learnCtrl.waitForEdge();
    } catch { return; }

    lanePins[laneNum] = edge.gpio;
    await learnCtrl.excludePin(edge.gpio);
    laneNum++;

    // Check if we should keep going or stop
    if (laneNum > 7) {
      phase = 'done';
      renderContent();
      break;
    }

    // Update UI — show option to finish or continue
    renderContent();
  }
}

// ─── Rally Report Dialog ────────────────────────────────────────

/**
 * Show a dialog to generate a rally report (all sections).
 * If any section has multiple starts, offer selection.
 */
export function showRallyReportDialog(ctx) {
  const { state } = ctx;
  const rd = state.race_day;
  const sections = Object.values(rd.sections);

  // Collect sections with completed starts
  const sectionsWithResults = [];
  let anyMultiStart = false;
  for (const sec of sections) {
    const completed = getCompletedStarts(sec);
    if (completed.length > 0) {
      sectionsWithResults.push({ section: sec, completedStarts: completed });
      if (completed.length > 1) anyMultiStart = true;
    }
  }

  if (sectionsWithResults.length === 0) {
    ctx.showToast('No completed sections to report.', 'info');
    return;
  }

  // If no multi-start sections, generate immediately
  if (!anyMultiStart) {
    generateRallyReport(state);
    closeDialog();
    return;
  }

  // Build dialog with start selection
  let html = `
    <h3 class="dialog-title">Rally Report</h3>
    <p class="form-hint">Some sections have been run multiple times. Select which runs to include.</p>
    <form id="rally-report-form">
  `;

  for (const { section, completedStarts } of sectionsWithResults) {
    if (completedStarts.length === 1) {
      html += `
        <div class="form-group" style="margin-bottom:0.5rem">
          <label><strong>${esc(section.section_name)}</strong> — 1 run</label>
          <input type="hidden" name="sec_${section.section_id}" value="all">
        </div>
      `;
    } else {
      html += `
        <fieldset class="form-group" style="margin-bottom:0.75rem;border:none;padding:0">
          <legend><strong>${esc(section.section_name)}</strong> — ${completedStarts.length} runs</legend>
          <label style="display:block;margin:0.25rem 0">
            <input type="radio" name="sec_${section.section_id}" value="all" checked> All runs
          </label>
      `;
      for (const s of completedStarts) {
        html += `
          <label style="display:block;margin:0.25rem 0">
            <input type="radio" name="sec_${section.section_id}" value="${s.start_number}"> Rally ${s.start_number} only
          </label>
        `;
      }
      html += '</fieldset>';
    }
  }

  html += `
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" id="report-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">Generate Report</button>
    </div>
    </form>
  `;

  openDialog(html);

  dialogEl().querySelector('#report-cancel').onclick = closeDialog;
  dialogEl().querySelector('#rally-report-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const sectionStarts = [];

    for (const { section, completedStarts } of sectionsWithResults) {
      const val = form.elements[`sec_${section.section_id}`]?.value;
      if (val === 'all') {
        sectionStarts.push({
          sectionId: section.section_id,
          startNumbers: completedStarts.map(s => s.start_number),
        });
      } else {
        sectionStarts.push({
          sectionId: section.section_id,
          startNumbers: [Number(val)],
        });
      }
    }

    generateRallyReport(state, { sectionStarts });
    closeDialog();
  };
}

// ─── Section Report Dialog ──────────────────────────────────────

/**
 * Show a dialog to generate a section report.
 * If the section has multiple starts, offer selection.
 */
export function showSectionReportDialog(section, ctx) {
  const { state } = ctx;
  const completedStarts = getCompletedStarts(section);

  if (completedStarts.length === 0) {
    ctx.showToast('No completed runs to report.', 'info');
    return;
  }

  // Single start — generate immediately
  if (completedStarts.length === 1) {
    generateSectionReport(state, section, [completedStarts[0].start_number]);
    return;
  }

  // Multi-start — show picker
  let html = `
    <h3 class="dialog-title">${esc(section.section_name)} — Section Report</h3>
    <p class="form-hint">This section has been run ${completedStarts.length} times. Select which runs to include.</p>
    <form id="section-report-form">
      <label style="display:block;margin:0.5rem 0">
        <input type="radio" name="start_choice" value="all" checked> All runs
      </label>
  `;

  for (const s of completedStarts) {
    html += `
      <label style="display:block;margin:0.5rem 0">
        <input type="radio" name="start_choice" value="${s.start_number}"> Rally ${s.start_number} only
      </label>
    `;
  }

  html += `
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" id="sec-report-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">Generate Report</button>
    </div>
    </form>
  `;

  openDialog(html);

  dialogEl().querySelector('#sec-report-cancel').onclick = closeDialog;
  dialogEl().querySelector('#section-report-form').onsubmit = (e) => {
    e.preventDefault();
    const val = e.target.elements.start_choice.value;
    const startNumbers = val === 'all'
      ? completedStarts.map(s => s.start_number)
      : [Number(val)];
    generateSectionReport(state, section, startNumbers);
    closeDialog();
  };
}

// ─── Group Reports Dialog ───────────────────────────────────────

/**
 * Show a dialog listing all groups that have participants with results.
 * The user picks a group (or "All Groups") and gets a PDF per group.
 */
export function showGroupReportsDialog(ctx) {
  const { state } = ctx;
  const rd = state.race_day;
  const sections = Object.values(rd.sections);

  // Find groups that have participants in completed sections
  const groupsWithResults = new Set();
  for (const sec of sections) {
    const completed = getCompletedStarts(sec);
    if (completed.length === 0) continue;
    for (const p of sec.participants) {
      if (p.group_id) groupsWithResults.add(p.group_id);
    }
  }

  if (groupsWithResults.size === 0) {
    ctx.showToast('No groups with completed results to report.', 'info');
    return;
  }

  const groups = [...groupsWithResults]
    .map(id => state.groups[id])
    .filter(Boolean)
    .sort((a, b) => a.group_name.localeCompare(b.group_name));

  // Check for multi-start sections
  let anyMultiStart = false;
  for (const sec of sections) {
    if (getCompletedStarts(sec).length > 1) { anyMultiStart = true; break; }
  }

  let html = `
    <h3 class="dialog-title">Group Reports</h3>
    <p class="form-hint">Generate a PDF report for a group's scouter, showing where their participants placed and their heat-by-heat times.</p>
    <form id="group-report-form">
      <div class="form-group">
        <label class="form-label">Group</label>
        <select class="form-input" name="group_choice">
          <option value="all">All Groups (one PDF each)</option>
  `;
  for (const g of groups) {
    html += `<option value="${g.group_id}">${esc(g.group_name)}</option>`;
  }
  html += '</select></div>';

  if (anyMultiStart) {
    html += `
      <div class="form-group">
        <label class="form-label">Runs to include</label>
        <select class="form-input" name="start_choice">
          <option value="all">All runs</option>
    `;
    // Collect all distinct start numbers across sections
    const allStartNums = new Set();
    for (const sec of sections) {
      for (const s of getCompletedStarts(sec)) allStartNums.add(s.start_number);
    }
    for (const sn of [...allStartNums].sort((a, b) => a - b)) {
      html += `<option value="${sn}">Rally ${sn} only</option>`;
    }
    html += '</select></div>';
  }

  html += `
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" id="grp-report-cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">Generate</button>
    </div>
    </form>
  `;

  openDialog(html);

  dialogEl().querySelector('#grp-report-cancel').onclick = closeDialog;
  dialogEl().querySelector('#group-report-form').onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const groupChoice = form.elements.group_choice.value;
    const startChoice = form.elements.start_choice?.value || 'all';
    const startNumbers = startChoice === 'all' ? null : [Number(startChoice)];

    const targetGroups = groupChoice === 'all'
      ? groups
      : groups.filter(g => g.group_id === groupChoice);

    for (const g of targetGroups) {
      generateGroupReport(state, g.group_id, startNumbers);
    }
    closeDialog();
  };
}
