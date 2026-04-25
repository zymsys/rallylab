/**
 * registrar/dialogs.js — Add Participant dialog for late registration.
 */

import { nextAvailableCarNumber } from '../state-manager.js';

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

// ─── Check-In Confirmation Dialog ────────────────────────────────

export function showCheckInConfirmDialog(participant, onConfirm) {
  openDialog(`
    <div class="dialog-header">
      <h2>Confirm Check-In</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p>Check in <strong>#${participant.car_number} ${esc(participant.name)}</strong>?</p>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="confirm">Check In</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;
  d.querySelector('[data-action="confirm"]').onclick = async () => {
    const btn = d.querySelector('[data-action="confirm"]');
    btn.disabled = true;
    btn.textContent = 'Checking in...';
    await onConfirm();
    closeDialog();
  };
}

// ─── Group Picker (shared) ───────────────────────────────────────
// Renders a <select> over existing rally groups plus "Ungrouped" and a
// "+ New group…" option that toggles a sibling text input. Returns helpers
// the caller uses to read/resolve the selection. The caller is responsible
// for emitting GroupCreated when `resolve()` reports a new group.

const NEW_GROUP_VALUE = '__new__';
const NO_GROUP_VALUE = '';

function buildGroupPicker(d, groups, initialGroupId) {
  const select = d.querySelector('#dlg-participant-group');
  const newWrap = d.querySelector('#dlg-participant-group-new-wrap');
  const newInput = d.querySelector('#dlg-participant-group-new');
  if (!select) return null;

  select.onchange = () => {
    const showNew = select.value === NEW_GROUP_VALUE;
    newWrap.style.display = showNew ? '' : 'none';
    if (showNew) requestAnimationFrame(() => newInput.focus());
  };

  // Pre-select the participant's existing group if editing.
  if (initialGroupId && groups.some(g => g.group_id === initialGroupId)) {
    select.value = initialGroupId;
  }

  /** Validate + resolve the picker into { groupId, newGroupName }. */
  function resolve() {
    if (select.value === NEW_GROUP_VALUE) {
      const name = newInput.value.trim();
      if (!name) return { error: 'Group name is required', focus: newInput };
      const dup = groups.find(g => g.group_name.toLowerCase() === name.toLowerCase());
      if (dup) return { groupId: dup.group_id, newGroupName: null };
      return { groupId: crypto.randomUUID(), newGroupName: name };
    }
    return { groupId: select.value || null, newGroupName: null };
  }

  return { resolve };
}

function groupPickerHtml(groups, initialGroupId) {
  const opts = [
    `<option value="${NO_GROUP_VALUE}">Ungrouped</option>`,
    ...groups.map(g => {
      const sel = g.group_id === initialGroupId ? ' selected' : '';
      return `<option value="${esc(g.group_id)}"${sel}>${esc(g.group_name)}</option>`;
    }),
    `<option value="${NEW_GROUP_VALUE}">+ New group…</option>`
  ].join('');
  return `
    <div class="form-group">
      <label for="dlg-participant-group">Group</label>
      <select id="dlg-participant-group" class="form-input">${opts}</select>
      <div id="dlg-participant-group-new-wrap" class="form-group" style="display:none;margin-top:0.5rem">
        <input type="text" id="dlg-participant-group-new" class="form-input" placeholder="New group name" autocomplete="off" maxlength="60">
      </div>
    </div>
  `;
}

// ─── Add Participant Dialog ──────────────────────────────────────

export function showAddParticipantDialog(sectionId, section, ctx, onComplete) {
  const nextCarNum = nextAvailableCarNumber(section);
  const groups = Object.values(ctx.state.groups || {});

  openDialog(`
    <div class="dialog-header">
      <h2>Add Participant</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <div class="form-group">
        <label for="dlg-participant-name">Name</label>
        <input type="text" id="dlg-participant-name" class="form-input" placeholder="Participant name" autocomplete="off">
      </div>
      ${groupPickerHtml(groups, null)}
      <div class="form-group">
        <label for="dlg-participant-car-number">Car Number <span class="form-hint" style="font-weight:normal">(optional)</span></label>
        <input type="text" id="dlg-participant-car-number" class="form-input" placeholder="${esc(nextCarNum)} (auto-assigned)" autocomplete="off" maxlength="20">
        <p class="form-hint">Leave blank for auto-assignment, or enter a specific label (e.g. <code>B100</code>).</p>
      </div>
      <div id="dlg-add-error" class="form-error"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="submit">Add &amp; Check In</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  const nameInput = d.querySelector('#dlg-participant-name');
  const carInput = d.querySelector('#dlg-participant-car-number');
  const picker = buildGroupPicker(d, groups, null);

  // Submit on Enter in either input
  const onEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      d.querySelector('[data-action="submit"]').click();
    }
  };
  nameInput.addEventListener('keydown', onEnter);
  carInput.addEventListener('keydown', onEnter);

  d.querySelector('[data-action="submit"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-add-error');
    errorEl.textContent = '';

    const name = nameInput.value.trim();
    const carNumberRaw = carInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Name is required';
      nameInput.classList.add('error');
      nameInput.focus();
      return;
    }

    const groupSel = picker.resolve();
    if (groupSel.error) {
      errorEl.textContent = groupSel.error;
      groupSel.focus.classList.add('error');
      groupSel.focus.focus();
      return;
    }

    if (carNumberRaw) {
      const existing = section.participants.find(p => String(p.car_number) === carNumberRaw);
      if (existing) {
        errorEl.textContent = `Car #${carNumberRaw} is already assigned to ${existing.name}`;
        carInput.classList.add('error');
        carInput.focus();
        return;
      }
    }

    const btn = d.querySelector('[data-action="submit"]');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
      // Create the new group first so ParticipantAdded can reference it.
      if (groupSel.newGroupName) {
        await ctx.appendEvent({
          type: 'GroupCreated',
          group_id: groupSel.groupId,
          group_name: groupSel.newGroupName,
          timestamp: Date.now()
        });
      }

      const participantId = crypto.randomUUID();

      // Emit ParticipantAdded — honor explicit car_number when provided
      const state = await ctx.appendEvent({
        type: 'ParticipantAdded',
        section_id: sectionId,
        group_id: groupSel.groupId || null,
        participant: {
          participant_id: participantId,
          name,
          ...(carNumberRaw ? { car_number: carNumberRaw } : {})
        },
        timestamp: Date.now()
      });

      // Find the assigned car number from rebuilt state
      const rdSec = state.race_day.sections[sectionId];
      const added = rdSec.participants.find(p => p.participant_id === participantId);
      const carNumber = added ? added.car_number : nextCarNum;

      // Emit CarArrived
      ctx.state = await ctx.appendEvent({
        type: 'CarArrived',
        section_id: sectionId,
        car_number: carNumber,
        timestamp: Date.now()
      });

      closeDialog();
      ctx.showToast(`${name} added as Car #${carNumber}`, 'success');
      if (onComplete) onComplete();
    } catch (e) {
      ctx.showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Add & Check In';
    }
  };
}

// ─── Edit Participant Dialog ─────────────────────────────────────

export function showEditParticipantDialog(sectionId, participant, ctx, onComplete) {
  const groups = Object.values(ctx.state.groups || {});

  openDialog(`
    <div class="dialog-header">
      <h2>Edit Participant</h2>
      <button class="dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="dialog-body">
      <p class="info-line">Car <strong>#${esc(participant.car_number)}</strong></p>
      <div class="form-group">
        <label for="dlg-participant-name">Name</label>
        <input type="text" id="dlg-participant-name" class="form-input" value="${esc(participant.name)}" autocomplete="off">
      </div>
      ${groupPickerHtml(groups, participant.group_id || null)}
      <div id="dlg-edit-error" class="form-error"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-primary" data-action="submit">Save Changes</button>
    </div>
  `);

  const d = dialogEl();
  d.querySelector('.dialog-close').onclick = closeDialog;
  d.querySelector('[data-action="cancel"]').onclick = closeDialog;

  const nameInput = d.querySelector('#dlg-participant-name');
  const picker = buildGroupPicker(d, groups, participant.group_id || null);

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      d.querySelector('[data-action="submit"]').click();
    }
  });

  d.querySelector('[data-action="submit"]').onclick = async () => {
    const errorEl = d.querySelector('#dlg-edit-error');
    errorEl.textContent = '';

    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Name is required';
      nameInput.classList.add('error');
      nameInput.focus();
      return;
    }

    const groupSel = picker.resolve();
    if (groupSel.error) {
      errorEl.textContent = groupSel.error;
      groupSel.focus.classList.add('error');
      groupSel.focus.focus();
      return;
    }

    const nameChanged = name !== participant.name;
    const groupChanged = (groupSel.groupId || null) !== (participant.group_id || null);
    if (!nameChanged && !groupChanged && !groupSel.newGroupName) {
      closeDialog();
      return;
    }

    const btn = d.querySelector('[data-action="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      if (groupSel.newGroupName) {
        await ctx.appendEvent({
          type: 'GroupCreated',
          group_id: groupSel.groupId,
          group_name: groupSel.newGroupName,
          timestamp: Date.now()
        });
      }

      const update = {
        type: 'ParticipantUpdated',
        section_id: sectionId,
        participant_id: participant.participant_id,
        timestamp: Date.now()
      };
      if (nameChanged) update.name = name;
      if (groupChanged || groupSel.newGroupName) update.group_id = groupSel.groupId || null;

      ctx.state = await ctx.appendEvent(update);

      closeDialog();
      ctx.showToast(`Updated #${participant.car_number} ${name}`, 'success');
      if (onComplete) onComplete();
    } catch (e) {
      ctx.showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  };
}
