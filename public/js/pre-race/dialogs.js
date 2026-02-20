/**
 * dialogs.js — Modal dialogs for pre-race screens.
 */

import { appendEvent, loadRallyState } from './commands.js';
import { getUser } from '../supabase.js';
import { parseRosterFile } from './roster-import.js';
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

// ─── 5. Upload Roster ──────────────────────────────────────────────
export function showUploadRosterDialog(rallyId, sectionId, groupId, section, onUploaded) {
  const existingCount = groupId
    ? section.participants.filter(p => p.group_id === groupId).length
    : section.participants.length;
  const isReimport = existingCount > 0;

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
        and <strong>Last Name</strong> columns. Other columns are ignored.
        A header row is optional.
      </p>
      <div id="dlg-upload-error" class="form-error" style="margin-top:0.5rem"></div>
      <div id="dlg-preview" class="preview-table" style="display:none">
        <p class="info-line" id="dlg-preview-count"></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th></tr></thead>
            <tbody id="dlg-preview-body"></tbody>
          </table>
        </div>
        ${isReimport ? `
        <div class="reimport-warning" id="dlg-reimport-warning">
          <p class="form-hint" style="color:var(--color-warning);margin-top:0.75rem">
            This will replace the existing ${existingCount} participant${existingCount !== 1 ? 's' : ''}
            and reassign all car numbers.
          </p>
          <label class="checkbox-item" style="margin-top:0.5rem">
            <input type="checkbox" id="dlg-reimport-confirm">
            I confirm that car numbers have not yet been distributed
          </label>
        </div>` : ''}
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="confirm" disabled>Confirm Upload</button>
    </div>
  `);

  let parsedNames = [];

  const d = dialogEl();
  const area = d.querySelector('#dlg-upload-area');
  const fileInput = d.querySelector('#dlg-file-input');
  const errorEl = d.querySelector('#dlg-upload-error');
  const previewEl = d.querySelector('#dlg-preview');
  const previewBody = d.querySelector('#dlg-preview-body');
  const previewCount = d.querySelector('#dlg-preview-count');
  const confirmBtn = d.querySelector('[data-action="confirm"]');
  const reimportCheckbox = d.querySelector('#dlg-reimport-confirm');

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

  function updateConfirmEnabled() {
    if (parsedNames.length === 0) {
      confirmBtn.disabled = true;
    } else if (isReimport && reimportCheckbox) {
      confirmBtn.disabled = !reimportCheckbox.checked;
    } else {
      confirmBtn.disabled = false;
    }
  }

  if (reimportCheckbox) {
    reimportCheckbox.addEventListener('change', updateConfirmEnabled);
  }

  async function handleFile(file) {
    errorEl.textContent = '';
    previewEl.style.display = 'none';
    confirmBtn.disabled = true;
    parsedNames = [];

    try {
      parsedNames = await parseRosterFile(file);
      if (parsedNames.length === 0) {
        errorEl.textContent = 'No participant names found in file';
        return;
      }
    } catch (e) {
      errorEl.textContent = e.message;
      return;
    }

    // Show preview (names only — car numbers are assigned after upload)
    previewCount.textContent = `${parsedNames.length} participants found`;
    previewBody.innerHTML = '';
    parsedNames.forEach((name) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(name)}</td>`;
      previewBody.appendChild(tr);
    });
    previewEl.style.display = 'block';
    updateConfirmEnabled();
  }

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Uploading...';

    try {
      const user = getUser();
      const participants = parsedNames.map(name => ({
        participant_id: crypto.randomUUID(),
        name
      }));

      await appendEvent({
        type: 'RosterUpdated',
        rally_id: rallyId,
        section_id: sectionId,
        group_id: groupId || null,
        participants,
        submitted_by: user.email,
        timestamp: Date.now()
      });

      closeDialog();
      showToast(`Roster uploaded: ${participants.length} participants`, 'success');
      if (onUploaded) onUploaded();
    } catch (e) {
      showToast(e.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Upload';
    }
  };
}

// ─── 6. Add Participant ────────────────────────────────────────────
export function showAddParticipantDialog(rallyId, sectionId, groupId, section, onAdded) {
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
      <p class="form-hint">Car number will be assigned automatically.</p>
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
    const nameErr = d.querySelector('#dlg-participant-name-error');
    nameErr.textContent = '';

    if (!name) { nameErr.textContent = 'Participant name is required'; return; }

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
        participant: { participant_id: crypto.randomUUID(), name },
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

// ─── Helpers ───────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
