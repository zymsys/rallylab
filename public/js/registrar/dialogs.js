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

// ─── Add Participant Dialog ──────────────────────────────────────

export function showAddParticipantDialog(sectionId, section, ctx, onComplete) {
  const nextCarNum = nextAvailableCarNumber(section);

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
      const participantId = crypto.randomUUID();

      // Emit ParticipantAdded — honor explicit car_number when provided
      const state = await ctx.appendEvent({
        type: 'ParticipantAdded',
        section_id: sectionId,
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
