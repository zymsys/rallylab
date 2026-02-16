/**
 * operator/dialogs.js — Modal dialogs for race day operator.
 * Manual Rank, Remove Car, Load Roster.
 */

const backdrop = () => document.getElementById('dialog-backdrop');
const dialogEl = () => document.getElementById('dialog');

function closeDialog() {
  const bd = backdrop();
  bd.classList.add('hidden');
  bd.setAttribute('aria-hidden', 'true');
  dialogEl().innerHTML = '';
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

export function showManualRankDialog(sectionId, heatNumber, section, ctx) {
  const heat = section.heats.find(h => h.heat_number === heatNumber);
  if (!heat) return;

  const lanes = [...heat.lanes].sort((a, b) => a.lane - b.lane);

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

export function showCorrectLanesDialog(sectionId, heatNumber, section, ctx) {
  const heat = section.heats.find(h => h.heat_number === heatNumber);
  if (!heat) return;

  const lanes = [...heat.lanes].sort((a, b) => a.lane - b.lane);
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

      previewText.textContent = `${data.event_name || 'Event'} — ${data.sections.length} section(s)`;
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

      // Create EventCreated if data includes event info
      if (rosterData.event_name) {
        await appendAndRebuild({
          type: 'EventCreated',
          event_id: rosterData.event_id || crypto.randomUUID(),
          event_name: rosterData.event_name,
          event_date: rosterData.event_date || '',
          created_by: 'operator',
          timestamp: Date.now()
        });
      }

      // Create RosterLoaded for each section
      for (const sec of rosterData.sections) {
        await appendAndRebuild({
          type: 'RosterLoaded',
          section_id: sec.section_id || crypto.randomUUID(),
          section_name: sec.section_name,
          participants: sec.participants,
          timestamp: Date.now()
        });
      }

      closeDialog();
      ctx.showToast('Roster loaded', 'success');
      ctx.navigate('event-home', {});
    } catch (e) {
      ctx.showToast(e.message, 'error');
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Roster';
    }
  };
}
