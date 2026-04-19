/**
 * dialogs.js — Modal dialogs for pre-race screens.
 */

import { appendEvent, loadRallyState } from './commands.js';
import { getUser } from '../supabase.js';
import { parseRosterFile, parseBulkRosterFile } from './roster-import.js';
import { nextAvailableCarNumber } from '../state-manager.js';
import { showToast } from './app.js';

const backdrop = () => document.getElementById('dialog-backdrop');
const dialogEl = () => document.getElementById('dialog');

export function closeDialog() {
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

  // Focus first input
  requestAnimationFrame(() => {
    const input = d.querySelector('input, select, textarea');
    if (input) input.focus();
  });

  // Escape to close
  const onKey = (e) => {
    if (e.key === 'Escape') { closeDialog(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  // Backdrop click to close
  bd.onclick = (e) => { if (e.target === bd) closeDialog(); };

  // Enter on text/email/date inputs triggers the primary button
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!e.target.matches('input[type="text"], input[type="email"], input[type="date"]')) return;
    e.preventDefault();
    const btn = d.querySelector('.btn-primary');
    if (btn && !btn.disabled) btn.click();
  });
}

// ─── 1. Create Rally ───────────────────────────────────────────────
export function showCreateRallyDialog(onCreated) {
  openDialog(`
    <div class="dialog-header">
      <h2>Create Rally</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-rally-name">Rally Name</label>
        <input id="dlg-rally-name" class="form-input" type="text" placeholder="e.g. Kub Kars Rally 2026" maxlength="100">
        <div id="dlg-rally-name-error" class="form-error"></div>
      </div>
      <div class="form-group">
        <label for="dlg-rally-date">Rally Date</label>
        <input id="dlg-rally-date" class="form-input" type="date">
        <div id="dlg-rally-date-error" class="form-error"></div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="create">Create Rally</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="create"]').onclick = async () => {
    const name = d.querySelector('#dlg-rally-name').value.trim();
    const date = d.querySelector('#dlg-rally-date').value;
    const nameErr = d.querySelector('#dlg-rally-name-error');
    const dateErr = d.querySelector('#dlg-rally-date-error');

    nameErr.textContent = '';
    dateErr.textContent = '';

    if (!name) { nameErr.textContent = 'Rally name is required'; return; }
    if (!date) { dateErr.textContent = 'Rally date is required'; return; }

    const btn = d.querySelector('[data-action="create"]');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const user = getUser();
      const rally_id = crypto.randomUUID();
      await appendEvent({
        type: 'RallyCreated',
        rally_id,
        rally_name: name,
        rally_date: date,
        created_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast('Rally created', 'success');
      if (onCreated) onCreated(rally_id);
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Create Rally';
    }
  };
}

// ─── 2. Create Section ─────────────────────────────────────────────
export function showCreateSectionDialog(rallyId, existingNames, onCreated) {
  openDialog(`
    <div class="dialog-header">
      <h2>Add Section</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-section-name">Section Name</label>
        <input id="dlg-section-name" class="form-input" type="text" placeholder="e.g. Kub Kars, Scout Trucks" maxlength="60">
        <div id="dlg-section-name-error" class="form-error"></div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="create">Add Section</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="create"]').onclick = async () => {
    const name = d.querySelector('#dlg-section-name').value.trim();
    const nameErr = d.querySelector('#dlg-section-name-error');
    nameErr.textContent = '';

    if (!name) { nameErr.textContent = 'Section name is required'; return; }
    if (existingNames.includes(name.toLowerCase())) {
      nameErr.textContent = 'A section with this name already exists';
      return;
    }

    const btn = d.querySelector('[data-action="create"]');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
      const user = getUser();
      await appendEvent({
        type: 'SectionCreated',
        rally_id: rallyId,
        section_id: crypto.randomUUID(),
        section_name: name,
        created_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast('Section added', 'success');
      if (onCreated) onCreated();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Add Section';
    }
  };
}

// ─── 3. Create Group ────────────────────────────────────────────────
export function showCreateGroupDialog(rallyId, existingNames, onCreated) {
  openDialog(`
    <div class="dialog-header">
      <h2>Add Group</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-group-name">Group Name</label>
        <input id="dlg-group-name" class="form-input" type="text" placeholder="e.g. 1st Newmarket" maxlength="60">
        <div id="dlg-group-name-error" class="form-error"></div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="create">Add Group</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="create"]').onclick = async () => {
    const name = d.querySelector('#dlg-group-name').value.trim();
    const nameErr = d.querySelector('#dlg-group-name-error');
    nameErr.textContent = '';

    if (!name) { nameErr.textContent = 'Group name is required'; return; }
    if (existingNames.includes(name.toLowerCase())) {
      nameErr.textContent = 'A group with this name already exists';
      return;
    }

    const btn = d.querySelector('[data-action="create"]');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
      const user = getUser();
      await appendEvent({
        type: 'GroupCreated',
        rally_id: rallyId,
        group_id: crypto.randomUUID(),
        group_name: name,
        created_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast('Group added', 'success');
      if (onCreated) onCreated();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Add Group';
    }
  };
}

// ─── 4. Invite / Edit Registrar ─────────────────────────────────────
export function showInviteRegistrarDialog(rallyId, state, existingEmail, onDone) {
  const groups = Object.values(state.groups);
  const sections = Object.values(state.sections);
  const existing = existingEmail ? state.registrars[existingEmail] : null;
  const isEdit = !!existing;

  const groupChecks = groups.map(g => {
    const checked = existing && existing.group_ids.includes(g.group_id) ? 'checked' : '';
    return `<label class="checkbox-item">
      <input type="checkbox" value="${g.group_id}" ${checked}>
      ${esc(g.group_name)}
    </label>`;
  }).join('');

  const sectionChecks = sections.map(s => {
    const checked = existing && existing.section_ids.includes(s.section_id) ? 'checked' : '';
    return `<label class="checkbox-item">
      <input type="checkbox" value="${s.section_id}" ${checked}>
      ${esc(s.section_name)}
    </label>`;
  }).join('');

  openDialog(`
    <div class="dialog-header">
      <h2>${isEdit ? 'Edit' : 'Invite'} Registrar</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-registrar-email">Email</label>
        <input id="dlg-registrar-email" class="form-input" type="email"
          placeholder="registrar@example.com"
          value="${existing ? esc(existing.email) : ''}"
          ${isEdit ? 'readonly' : ''}>
        <div id="dlg-registrar-email-error" class="form-error"></div>
        ${!isEdit ? '<p class="form-hint">In demo mode, no email is actually sent.</p>' : ''}
      </div>
      ${groups.length > 0 ? `
      <div class="form-group">
        <label>Groups</label>
        <div class="checkbox-list" id="dlg-group-checks">${groupChecks}</div>
        <div id="dlg-groups-error" class="form-error"></div>
      </div>` : ''}
      ${sections.length > 0 ? `
      <div class="form-group">
        <label>Sections</label>
        <div class="checkbox-list" id="dlg-section-checks">${sectionChecks}</div>
        <div id="dlg-sections-error" class="form-error"></div>
      </div>` : ''}
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="invite">${isEdit ? 'Save Changes' : 'Send Invitation'}</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="invite"]').onclick = async () => {
    const email = d.querySelector('#dlg-registrar-email').value.trim().toLowerCase();
    const emailErr = d.querySelector('#dlg-registrar-email-error');
    emailErr.textContent = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailErr.textContent = 'Enter a valid email address';
      return;
    }

    const groupCheckboxes = d.querySelectorAll('#dlg-group-checks input[type="checkbox"]');
    const sectionCheckboxes = d.querySelectorAll('#dlg-section-checks input[type="checkbox"]');
    const selectedGroupIds = [...groupCheckboxes].filter(c => c.checked).map(c => c.value);
    const selectedSectionIds = [...sectionCheckboxes].filter(c => c.checked).map(c => c.value);

    const groupsErr = d.querySelector('#dlg-groups-error');
    const sectionsErr = d.querySelector('#dlg-sections-error');
    if (groupsErr) groupsErr.textContent = '';
    if (sectionsErr) sectionsErr.textContent = '';

    const btn = d.querySelector('[data-action="invite"]');
    btn.disabled = true;
    btn.textContent = isEdit ? 'Saving...' : 'Sending...';

    try {
      const user = getUser();
      await appendEvent({
        type: 'RegistrarInvited',
        rally_id: rallyId,
        registrar_email: email,
        group_ids: selectedGroupIds,
        section_ids: selectedSectionIds,
        invited_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast(isEdit ? `Updated ${email}` : `Invitation sent to ${email}`, 'success');
      if (onDone) onDone();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Save Changes' : 'Send Invitation';
    }
  };
}

// ─── 5. Invite Operator ─────────────────────────────────────────────
export function showInviteOperatorDialog(rallyId, existingEmails, onDone) {
  openDialog(`
    <div class="dialog-header">
      <h2>Invite Operator</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-operator-email">Email</label>
        <input id="dlg-operator-email" class="form-input" type="email" placeholder="operator@example.com">
        <div id="dlg-operator-email-error" class="form-error"></div>
        <p class="form-hint">Operators have full access to all sections on race day. In demo mode, no email is actually sent.</p>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="invite">Send Invitation</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="invite"]').onclick = async () => {
    const email = d.querySelector('#dlg-operator-email').value.trim().toLowerCase();
    const emailErr = d.querySelector('#dlg-operator-email-error');
    emailErr.textContent = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailErr.textContent = 'Enter a valid email address';
      return;
    }

    if (existingEmails.includes(email)) {
      emailErr.textContent = 'This person is already an operator';
      return;
    }

    const btn = d.querySelector('[data-action="invite"]');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const user = getUser();
      await appendEvent({
        type: 'OperatorInvited',
        rally_id: rallyId,
        operator_email: email,
        invited_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast(`Invitation sent to ${email}`, 'success');
      if (onDone) onDone();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Send Invitation';
    }
  };
}

// ─── 6. Upload Roster ───────────────────────────────────────────────
export function showUploadRosterDialog(rallyId, sectionId, groupId, section, onUploaded) {
  openDialog(`
    <div class="dialog-header">
      <h2>Upload Roster</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="upload-area" id="dlg-upload-area">
        <input type="file" id="dlg-file-input" accept=".csv,.xlsx,.xls">
        <p>Drop a file here or <strong>click to browse</strong></p>
        <p class="form-hint" style="margin-top:0.5rem">CSV or Excel (.xlsx, .xls)</p>
      </div>
      <p class="form-hint" style="margin-top:0.75rem">
        Include a <strong>Name</strong> column, or separate <strong>First Name</strong>
        and <strong>Last Name</strong> columns. A <strong>Car Number</strong> column is optional.
        Participants already in the roster are skipped — you can re-upload the same file to add new names.
      </p>
      <div id="dlg-upload-error" class="form-error" style="margin-top:0.5rem"></div>
      <div id="dlg-preview" class="preview-table" style="display:none">
        <p class="info-line" id="dlg-preview-count"></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th id="dlg-preview-head">Name</th></tr></thead>
            <tbody id="dlg-preview-body"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="confirm" disabled>Add Participants</button>
    </div>
  `);

  let parsedRows = [];  // [{ name, car_number }]
  let toAdd = [];        // rows that will actually be emitted
  let skipped = [];

  const d = dialogEl();
  const area = d.querySelector('#dlg-upload-area');
  const fileInput = d.querySelector('#dlg-file-input');
  const errorEl = d.querySelector('#dlg-upload-error');
  const previewEl = d.querySelector('#dlg-preview');
  const previewBody = d.querySelector('#dlg-preview-body');
  const previewCount = d.querySelector('#dlg-preview-count');
  const confirmBtn = d.querySelector('[data-action="confirm"]');

  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  area.onclick = () => fileInput.click();

  // Drag and drop
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
    confirmBtn.disabled = true;
    parsedRows = [];
    toAdd = [];
    skipped = [];

    try {
      parsedRows = await parseRosterFile(file);
      if (parsedRows.length === 0) {
        errorEl.textContent = 'No participant names found in file';
        return;
      }
    } catch (e) {
      errorEl.textContent = e.message;
      return;
    }

    // Reject within-file and cross-group car_number conflicts up front.
    const dupCheck = validateCarNumbers(parsedRows, section, groupId);
    if (dupCheck) {
      errorEl.textContent = dupCheck;
      return;
    }

    // Classify against existing section participants — skip duplicates.
    const classification = classifyAgainstExisting(parsedRows, section, () => groupId || null);
    toAdd = classification.toAdd;
    skipped = classification.skipped;

    const hasCarNumbers = parsedRows.some(r => r.car_number);

    // Summary line
    const parts = [`${toAdd.length} new`];
    if (skipped.length > 0) parts.push(`${skipped.length} already in roster (will skip)`);
    previewCount.textContent = parts.join(', ');

    // Rebuild the preview table header
    const previewHead = previewEl.querySelector('thead tr');
    previewHead.innerHTML = hasCarNumbers
      ? '<th style="width:6rem">Car #</th><th>Name</th><th style="width:8rem">Status</th>'
      : '<th>Name</th><th style="width:8rem">Status</th>';

    previewBody.innerHTML = '';
    const statusNew = '<span class="status-badge status-active">NEW</span>';
    const statusSkip = '<span class="status-badge status-idle">SKIP</span>';

    // Show new rows first, then skipped (so the new ones are visible without scrolling)
    const orderedRows = [
      ...toAdd.map(r => ({ row: r, isNew: true })),
      ...skipped.map(s => ({ row: s.row, isNew: false }))
    ];
    orderedRows.forEach(({ row, isNew }) => {
      const tr = document.createElement('tr');
      if (!isNew) tr.style.opacity = '0.6';
      tr.innerHTML = hasCarNumbers
        ? `<td>${row.car_number ? '#' + esc(row.car_number) : '<em>auto</em>'}</td><td>${esc(row.name)}</td><td>${isNew ? statusNew : statusSkip}</td>`
        : `<td>${esc(row.name)}</td><td>${isNew ? statusNew : statusSkip}</td>`;
      previewBody.appendChild(tr);
    });

    previewEl.style.display = 'block';
    confirmBtn.disabled = toAdd.length === 0;
    confirmBtn.textContent = toAdd.length === 0
      ? 'Nothing to Add'
      : `Add ${toAdd.length} Participant${toAdd.length !== 1 ? 's' : ''}`;
  }

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Adding...';

    try {
      const user = getUser();
      const now = Date.now();

      // Emit ParticipantAdded per new row (additive; preserves existing roster)
      for (const row of toAdd) {
        await appendEvent({
          type: 'ParticipantAdded',
          rally_id: rallyId,
          section_id: sectionId,
          group_id: groupId || null,
          participant: {
            participant_id: crypto.randomUUID(),
            name: row.name,
            ...(row.car_number ? { car_number: row.car_number } : {})
          },
          added_by: user.email,
          timestamp: now
        });
      }

      closeDialog();
      const suffix = skipped.length > 0 ? `, skipped ${skipped.length} already in roster` : '';
      showToast(`Added ${toAdd.length} participant${toAdd.length !== 1 ? 's' : ''}${suffix}`, 'success');
      if (onUploaded) onUploaded();
    } catch (e) {
      showToast(e.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = `Add ${toAdd.length} Participant${toAdd.length !== 1 ? 's' : ''}`;
    }
  };
}

// ─── 7. Create Rally from Existing ──────────────────────────────────
export function showCreateFromExistingDialog(rallies, onCreated) {
  const options = rallies.map(r =>
    `<option value="${r.rally_id}">${esc(r.rally_name)} (${r.rally_date})</option>`
  ).join('');

  openDialog(`
    <div class="dialog-header">
      <h2>Create from Existing Rally</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-source-rally">Source Rally</label>
        <select id="dlg-source-rally" class="form-input">${options}</select>
        <p class="form-hint">Sections, groups, and participants will be copied.</p>
      </div>
      <div class="form-group">
        <label for="dlg-new-rally-name">New Rally Name</label>
        <input id="dlg-new-rally-name" class="form-input" type="text" maxlength="100">
        <div id="dlg-new-rally-name-error" class="form-error"></div>
      </div>
      <div class="form-group">
        <label for="dlg-new-rally-date">Rally Date</label>
        <input id="dlg-new-rally-date" class="form-input" type="date">
        <div id="dlg-new-rally-date-error" class="form-error"></div>
      </div>
      <div id="dlg-source-summary" class="info-line" style="margin-top:0.5rem"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="create">Create Rally</button>
    </div>
  `);

  const d = dialogEl();
  const sourceSelect = d.querySelector('#dlg-source-rally');
  const nameInput = d.querySelector('#dlg-new-rally-name');
  const summaryEl = d.querySelector('#dlg-source-summary');

  // Pre-fill name from first source rally
  function updateFromSource() {
    const selected = rallies.find(r => r.rally_id === sourceSelect.value);
    if (selected) {
      nameInput.value = selected.rally_name;
      const sCount = selected.sectionCount;
      const pCount = selected.participantCount;
      summaryEl.textContent = `${sCount} section${sCount !== 1 ? 's' : ''}, ${pCount} participant${pCount !== 1 ? 's' : ''}`;
    }
  }
  updateFromSource();
  sourceSelect.onchange = updateFromSource;

  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="create"]').onclick = async () => {
    const name = nameInput.value.trim();
    const date = d.querySelector('#dlg-new-rally-date').value;
    const nameErr = d.querySelector('#dlg-new-rally-name-error');
    const dateErr = d.querySelector('#dlg-new-rally-date-error');

    nameErr.textContent = '';
    dateErr.textContent = '';

    if (!name) { nameErr.textContent = 'Rally name is required'; return; }
    if (!date) { dateErr.textContent = 'Rally date is required'; return; }

    const btn = d.querySelector('[data-action="create"]');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const { cloneRallyRoster } = await import('./commands.js');
      const sourceId = sourceSelect.value;
      const sourceState = await loadRallyState(sourceId);

      const newRallyId = await cloneRallyRoster(sourceState, name, date);
      closeDialog();
      showToast('Rally created from existing', 'success');
      if (onCreated) onCreated(newRallyId);
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Create Rally';
    }
  };
}

// ─── 8. Add Participant ────────────────────────────────────────────
export function showAddParticipantDialog(rallyId, sectionId, groupId, section, onAdded) {
  const nextCarNum = nextAvailableCarNumber(section);

  openDialog(`
    <div class="dialog-header">
      <h2>Add Participant</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-participant-name">Participant Name</label>
        <input id="dlg-participant-name" class="form-input" type="text" placeholder="e.g. Tommy Rodriguez" maxlength="100">
        <div id="dlg-participant-name-error" class="form-error"></div>
      </div>
      <div class="form-group">
        <label for="dlg-participant-car-number">Car Number <span class="form-hint" style="font-weight:normal">(optional)</span></label>
        <input id="dlg-participant-car-number" class="form-input" type="text" placeholder="${esc(nextCarNum)} (auto-assigned)" maxlength="20">
        <div id="dlg-participant-car-number-error" class="form-error"></div>
        <p class="form-hint">Leave blank for auto-assignment, or enter a specific label (e.g. <code>B100</code>).</p>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="add">Add Participant</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="add"]').onclick = async () => {
    const name = d.querySelector('#dlg-participant-name').value.trim();
    const carNumberRaw = d.querySelector('#dlg-participant-car-number').value.trim();
    const nameErr = d.querySelector('#dlg-participant-name-error');
    const carErr = d.querySelector('#dlg-participant-car-number-error');
    nameErr.textContent = '';
    carErr.textContent = '';

    if (!name) { nameErr.textContent = 'Participant name is required'; return; }

    if (carNumberRaw) {
      const existing = section.participants.find(p => String(p.car_number) === carNumberRaw);
      if (existing) {
        carErr.textContent = `Car #${carNumberRaw} is already assigned to ${existing.name}`;
        return;
      }
    }

    const btn = d.querySelector('[data-action="add"]');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
      const user = getUser();
      await appendEvent({
        type: 'ParticipantAdded',
        rally_id: rallyId,
        section_id: sectionId,
        group_id: groupId || null,
        participant: {
          participant_id: crypto.randomUUID(),
          name,
          ...(carNumberRaw ? { car_number: carNumberRaw } : {})
        },
        added_by: user.email,
        timestamp: Date.now()
      });
      closeDialog();
      showToast(`Added ${name}`, 'success');
      if (onAdded) onAdded();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Add Participant';
    }
  };
}

// ─── 9. Bulk Import Roster ────────────────────────────────────────

export function showBulkImportDialog(rallyId, state, onComplete) {
  let parsedRows = [];

  function renderUploadPhase() {
    openDialog(`
      <div class="dialog-header">
        <h2>Bulk Import Roster</h2>
        <button class="dialog-close" aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <div class="upload-area" id="dlg-upload-area">
          <input type="file" id="dlg-file-input" accept=".csv,.xlsx,.xls">
          <p>Drop a file here or <strong>click to browse</strong></p>
          <p class="form-hint" style="margin-top:0.5rem">CSV or Excel (.xlsx, .xls)</p>
        </div>
        <p class="form-hint" style="margin-top:0.75rem">
          Include <strong>Section</strong> and <strong>Name</strong> columns.
          <strong>Group</strong> and <strong>Car Number</strong> columns are optional.
          Participants already in the roster are skipped — re-upload the same file any time to add new names.
        </p>
        <div id="dlg-bulk-error" class="form-error" style="margin-top:0.5rem"></div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="next" disabled>Next</button>
      </div>
    `);

    const d = dialogEl();
    const area = d.querySelector('#dlg-upload-area');
    const fileInput = d.querySelector('#dlg-file-input');
    const errorEl = d.querySelector('#dlg-bulk-error');
    const nextBtn = d.querySelector('[data-action="next"]');

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
      nextBtn.disabled = true;
      parsedRows = [];

      try {
        parsedRows = await parseBulkRosterFile(file);
        if (parsedRows.length === 0) {
          errorEl.textContent = 'No participant rows found with a Section value.';
          return;
        }
      } catch (e) {
        errorEl.textContent = e.message;
        return;
      }

      // Reject within-file duplicate car_numbers up front — that's a
      // clerical error in the spreadsheet. Cross-roster duplicates are
      // handled by the classifier at preview time (skip semantics).
      const err = validateBulkCarNumbers(parsedRows);
      if (err) {
        errorEl.textContent = err;
        parsedRows = [];
        return;
      }

      const hasCarNumbers = parsedRows.some(r => r.car_number);
      const countSuffix = hasCarNumbers ? ' (car numbers preserved)' : '';
      area.innerHTML = `<p><strong>${file.name}</strong> — ${parsedRows.length} participants found${countSuffix}</p>`;
      nextBtn.disabled = false;
    }

    nextBtn.onclick = () => renderPreviewPhase();
  }

  function renderPreviewPhase() {
    // Build section → group → rows structure (preserving file order).
    // Each entry is the full parsed row so car_number flows through to emit.
    const sectionOrder = [];
    const sectionMap = new Map(); // sectionName → Map(groupName|null → [{name, car_number}])

    for (const row of parsedRows) {
      if (!sectionMap.has(row.section)) {
        sectionOrder.push(row.section);
        sectionMap.set(row.section, new Map());
      }
      const groups = sectionMap.get(row.section);
      const key = row.group; // null for ungrouped
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ name: row.name, car_number: row.car_number });
    }

    const hasCarNumbers = parsedRows.some(r => r.car_number);

    // Build lookup maps for existing sections/groups
    const existingSections = new Map(
      Object.values(state.sections).map(s => [s.section_name.toLowerCase().trim(), s])
    );
    const existingGroups = new Map(
      Object.values(state.groups).map(g => [g.group_name.toLowerCase().trim(), g])
    );

    const hasGroups = parsedRows.some(r => r.group !== null);
    const uniqueGroups = hasGroups
      ? [...new Set(parsedRows.filter(r => r.group).map(r => r.group))]
      : [];

    // Classify per section: which rows are new vs already in the roster.
    // Keyed by sectionName. Each entry holds the full set of rows (with their
    // group) broken into toAdd and skipped, so the preview + emit can both use it.
    const sectionClassification = new Map();
    for (const sectionName of sectionOrder) {
      const existing = existingSections.get(sectionName.toLowerCase().trim()) || null;
      const sectionRows = [];
      for (const [groupName, entries] of sectionMap.get(sectionName)) {
        for (const entry of entries) {
          sectionRows.push({ name: entry.name, car_number: entry.car_number, _group: groupName });
        }
      }
      const groupIdResolver = (row) => {
        if (!row._group) return null;
        const g = existingGroups.get(row._group.toLowerCase().trim());
        return g ? g.group_id : undefined; // undefined = new group (nothing to match)
      };
      const { toAdd, skipped } = classifyAgainstExisting(sectionRows, existing, groupIdResolver);
      sectionClassification.set(sectionName, { toAdd, skipped });
    }

    const totalToAdd = [...sectionClassification.values()].reduce((n, c) => n + c.toAdd.length, 0);
    const totalSkipped = [...sectionClassification.values()].reduce((n, c) => n + c.skipped.length, 0);

    // Summary line
    let summaryParts = [`${totalToAdd} new participant${totalToAdd !== 1 ? 's' : ''}`];
    if (totalSkipped > 0) summaryParts.push(`${totalSkipped} already in roster`);
    summaryParts.push(`${sectionOrder.length} section${sectionOrder.length !== 1 ? 's' : ''}`);
    if (hasGroups) summaryParts.push(`${uniqueGroups.length} group${uniqueGroups.length !== 1 ? 's' : ''}`);
    const summary = summaryParts.join(' · ');

    // Build per-section preview HTML — group rows show new/skip counts.
    let sectionsHtml = '';
    for (const sectionName of sectionOrder) {
      const isNewSection = !existingSections.has(sectionName.toLowerCase().trim());
      const sectionBadge = isNewSection
        ? '<span class="status-badge status-active">NEW</span>'
        : '<span class="status-badge status-idle">EXISTS</span>';
      const { toAdd, skipped } = sectionClassification.get(sectionName);
      const groupsInSection = sectionMap.get(sectionName);

      let bodyHtml = '';
      if (hasGroups) {
        let rowsHtml = '';
        for (const [groupName, entries] of groupsInSection) {
          // Count new vs skipped within this group
          const inGroup = (r) => r._group === groupName;
          const newInGroup = toAdd.filter(inGroup).length;
          const skipInGroup = skipped.filter(s => s.row._group === groupName).length;

          const carCount = entries.filter(e => e.car_number).length;
          const carLabel = hasCarNumbers && carCount > 0
            ? ` <span class="form-hint">(${carCount} w/ car #)</span>`
            : '';
          const countCell = skipInGroup > 0
            ? `<td>${newInGroup} new, ${skipInGroup} skip</td>`
            : `<td>${newInGroup}</td>`;
          if (groupName === null) {
            rowsHtml += `<tr><td><em>Ungrouped</em>${carLabel}</td>${countCell}<td></td></tr>`;
          } else {
            const gNew = !existingGroups.has(groupName.toLowerCase().trim());
            const gBadge = gNew
              ? '<span class="status-badge status-active">NEW</span>'
              : '<span class="status-badge status-idle">EXISTS</span>';
            rowsHtml += `<tr><td>${esc(groupName)}${carLabel}</td>${countCell}<td>${gBadge}</td></tr>`;
          }
        }
        bodyHtml = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Group</th><th>Participants</th><th>Status</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>`;
      } else {
        const fragments = [`${toAdd.length} new`];
        if (skipped.length > 0) fragments.push(`${skipped.length} already in roster`);
        bodyHtml = `<p class="form-hint" style="margin-left:0.5rem">${fragments.join(', ')}</p>`;
      }

      sectionsHtml += `
        <div style="margin-bottom:1rem">
          <div class="toolbar" style="margin-bottom:0.25rem">
            <h3 class="area-heading">${esc(sectionName)}</h3>
            ${sectionBadge}
          </div>
          ${bodyHtml}
        </div>`;
    }

    const confirmLabel = totalToAdd === 0
      ? 'Nothing to Add'
      : `Add ${totalToAdd} Participant${totalToAdd !== 1 ? 's' : ''}`;

    openDialog(`
      <div class="dialog-header">
        <h2>Bulk Import Roster</h2>
        <button class="dialog-close" aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <p class="info-line" style="margin-bottom:1rem">${summary}</p>
        ${sectionsHtml}
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" data-action="back">Back</button>
        <button class="btn btn-primary" data-action="confirm" ${totalToAdd === 0 ? 'disabled' : ''}>${confirmLabel}</button>
      </div>
    `);

    const d = dialogEl();
    d.querySelector('.dialog-close').onclick = closeDialog;
    d.querySelector('[data-action="back"]').onclick = () => renderUploadPhase();

    const confirmBtn = d.querySelector('[data-action="confirm"]');

    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Importing...';

      try {
        const user = getUser();
        const now = Date.now();

        // Resolve section names → IDs (create new sections on demand)
        const sectionIdMap = new Map();
        for (const sectionName of sectionOrder) {
          const key = sectionName.toLowerCase().trim();
          const { toAdd } = sectionClassification.get(sectionName);
          if (toAdd.length === 0) continue; // nothing to add in this section

          const existing = existingSections.get(key);
          if (existing) {
            sectionIdMap.set(key, existing.section_id);
          } else {
            const section_id = crypto.randomUUID();
            await appendEvent({
              type: 'SectionCreated',
              rally_id: rallyId,
              section_id,
              section_name: sectionName,
              created_by: user.email,
              timestamp: now
            });
            sectionIdMap.set(key, section_id);
          }
        }

        // Resolve group names → IDs (create new groups referenced by rows we're adding)
        const groupIdMap = new Map();
        const groupsToCreate = new Set();
        for (const [, { toAdd }] of sectionClassification) {
          for (const row of toAdd) {
            if (row._group) groupsToCreate.add(row._group);
          }
        }
        for (const groupName of groupsToCreate) {
          const key = groupName.toLowerCase().trim();
          const existing = existingGroups.get(key);
          if (existing) {
            groupIdMap.set(key, existing.group_id);
          } else {
            const group_id = crypto.randomUUID();
            await appendEvent({
              type: 'GroupCreated',
              rally_id: rallyId,
              group_id,
              group_name: groupName,
              created_by: user.email,
              timestamp: now
            });
            groupIdMap.set(key, group_id);
          }
        }

        // Emit ParticipantAdded per new row (additive — preserves existing roster)
        for (const sectionName of sectionOrder) {
          const { toAdd } = sectionClassification.get(sectionName);
          if (toAdd.length === 0) continue;
          const sectionId = sectionIdMap.get(sectionName.toLowerCase().trim());

          for (const row of toAdd) {
            const groupId = row._group
              ? groupIdMap.get(row._group.toLowerCase().trim())
              : null;
            await appendEvent({
              type: 'ParticipantAdded',
              rally_id: rallyId,
              section_id: sectionId,
              group_id: groupId,
              participant: {
                participant_id: crypto.randomUUID(),
                name: row.name,
                ...(row.car_number ? { car_number: row.car_number } : {})
              },
              added_by: user.email,
              timestamp: now
            });
          }
        }

        closeDialog();
        const suffix = totalSkipped > 0 ? `, skipped ${totalSkipped} already in roster` : '';
        showToast(`Imported ${totalToAdd} participant${totalToAdd !== 1 ? 's' : ''}${suffix}`, 'success');
        if (onComplete) onComplete();
      } catch (e) {
        showToast(e.message, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmLabel;
      }
    };
  }

  renderUploadPhase();
}

// ─── Helpers ───────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Classify file rows against existing section participants. Used to make
 * roster imports idempotent — the same file can be uploaded repeatedly and
 * only new participants are added.
 *
 * Matching strategy (skip as duplicate if either matches):
 *   1. car_number match, section-wide (car_numbers are section-unique)
 *   2. name match (case-insensitive), scoped to the target group
 *
 * @param {Array<{name, car_number?}>} rows — rows being imported
 * @param {Object|null} existingSection — state.sections[id], or null if new
 * @param {(row) => string|null|undefined} groupIdResolver — resolve a row's
 *   target group_id; undefined means the group doesn't exist yet (no matches)
 * @returns {{ toAdd: Array, skipped: Array<{row, existing}> }}
 */
function classifyAgainstExisting(rows, existingSection, groupIdResolver) {
  if (!existingSection || existingSection.participants.length === 0) {
    return { toAdd: rows.slice(), skipped: [] };
  }

  const byCar = new Map();
  for (const p of existingSection.participants) {
    byCar.set(String(p.car_number), p);
  }

  const byNameInGroup = new Map(); // gKey → Map(nameKey → participant)
  for (const p of existingSection.participants) {
    const gKey = p.group_id || '__ungrouped__';
    if (!byNameInGroup.has(gKey)) byNameInGroup.set(gKey, new Map());
    byNameInGroup.get(gKey).set(p.name.trim().toLowerCase(), p);
  }

  const toAdd = [];
  const skipped = [];
  for (const row of rows) {
    const car = row.car_number ? String(row.car_number).trim() : null;
    const nameKey = row.name.trim().toLowerCase();

    if (car && byCar.has(car)) {
      skipped.push({ row, existing: byCar.get(car) });
      continue;
    }

    const rowGroupId = groupIdResolver(row);
    const gKey = rowGroupId || '__ungrouped__';
    const groupNames = byNameInGroup.get(gKey);
    if (groupNames && groupNames.has(nameKey)) {
      skipped.push({ row, existing: groupNames.get(nameKey) });
      continue;
    }

    toAdd.push(row);
  }

  return { toAdd, skipped };
}

/**
 * Validate car_numbers in parsed rows for a single-section/group upload.
 * Returns an error message string or null if valid.
 * `section` is optional; when provided, we also reject conflicts with
 * participants in OTHER groups of the same section.
 */
function validateCarNumbers(rows, section, groupId) {
  const seen = new Map();
  for (const row of rows) {
    if (!row.car_number) continue;
    const key = row.car_number.trim();
    if (!key) continue;
    if (seen.has(key)) {
      return `Duplicate car number "${key}" in file: ${seen.get(key)} and ${row.name}`;
    }
    seen.set(key, row.name);
  }

  if (section) {
    const otherParticipants = groupId
      ? section.participants.filter(p => p.group_id !== groupId)
      : [];
    for (const p of otherParticipants) {
      if (seen.has(String(p.car_number))) {
        return `Car number "${p.car_number}" is already assigned to ${p.name} in this section`;
      }
    }
  }
  return null;
}

/**
 * Validate car_numbers within a bulk import file: no section may contain two
 * rows with the same car_number (that would be a clerical mistake in the
 * spreadsheet). Cross-section and cross-roster conflicts are handled by the
 * classifier at import time (via skip semantics).
 *
 * @param {Array<{section, group, name, car_number}>} parsedRows
 * @returns {string|null} error message or null if valid
 */
function validateBulkCarNumbers(parsedRows) {
  const bySection = new Map();
  for (const row of parsedRows) {
    if (!bySection.has(row.section)) bySection.set(row.section, []);
    bySection.get(row.section).push(row);
  }

  for (const [sectionName, rows] of bySection) {
    const seen = new Map();
    for (const row of rows) {
      if (!row.car_number) continue;
      const key = row.car_number.trim();
      if (!key) continue;
      if (seen.has(key)) {
        return `Duplicate car number "${key}" in section "${sectionName}": ${seen.get(key)} and ${row.name}`;
      }
      seen.set(key, row.name);
    }
  }
  return null;
}
