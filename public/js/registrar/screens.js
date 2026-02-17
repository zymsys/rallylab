/**
 * registrar/screens.js — Section List and Section Check-In screens.
 * Registrar-only: no Start Section, no operator controls.
 */

import { showAddParticipantDialog, showCheckInConfirmDialog } from './dialogs.js';

// ─── Screen: Section List ────────────────────────────────────────

export function renderSectionList(container, params, ctx) {
  const { state, navigate } = ctx;
  const rd = state.race_day;
  const sections = rd.loaded ? Object.values(rd.sections) : [];

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = '<h2 class="screen-title">Sections</h2>';
  container.appendChild(toolbar);

  if (!rd.loaded || sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No roster loaded. The operator needs to load a roster package first.';
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Section</th>
        <th>Participants</th>
        <th>Checked In</th>
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody id="reg-sections-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#reg-sections-body');
  for (const sec of sections) {
    const tr = document.createElement('tr');
    const arrivedCount = sec.arrived.length;
    const totalCount = sec.participants.length;

    let statusLabel, statusClass;
    if (sec.completed) {
      statusLabel = 'Complete';
      statusClass = 'status-badge status-complete';
    } else if (sec.started) {
      statusLabel = 'In Progress';
      statusClass = 'status-badge status-active';
    } else {
      statusLabel = 'Not Started';
      statusClass = 'status-badge status-idle';
    }

    tr.innerHTML = `
      <td><strong>${esc(sec.section_name)}</strong></td>
      <td>${totalCount}</td>
      <td>${arrivedCount} / ${totalCount}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td class="table-actions"></td>
    `;

    const actionsCell = tr.querySelector('.table-actions');
    const checkInBtn = document.createElement('button');
    checkInBtn.className = 'btn btn-sm btn-primary';
    checkInBtn.textContent = 'Check In';
    checkInBtn.onclick = () => navigate('section-checkin', { sectionId: sec.section_id });
    actionsCell.appendChild(checkInBtn);

    tbody.appendChild(tr);
  }
}

// ─── Screen: Section Check-In ────────────────────────────────────

export function renderSectionCheckIn(container, params, ctx) {
  const { state, navigate, appendEvent, showToast } = ctx;
  const { sectionId } = params;
  const sec = state.race_day.sections[sectionId];

  if (!sec) {
    container.innerHTML = '<div class="empty-state">Section not found.</div>';
    return;
  }

  const arrivedSet = new Set(sec.arrived);
  const removedSet = new Set(sec.removed);
  const arrivedCount = sec.arrived.length;
  const totalCount = sec.participants.length;

  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <button class="back-btn" aria-label="Back">&larr;</button>
    <h2 class="screen-title">${esc(sec.section_name)} — Check-In</h2>
  `;
  header.querySelector('.back-btn').onclick = () => navigate('section-list', {});
  container.appendChild(header);

  // Status badge
  if (sec.completed) {
    const notice = document.createElement('p');
    notice.className = 'info-line';
    notice.style.color = 'var(--color-success)';
    notice.style.marginBottom = '1rem';
    notice.textContent = 'Section complete. Check-in is closed.';
    container.appendChild(notice);
  } else if (sec.started) {
    const notice = document.createElement('p');
    notice.className = 'info-line';
    notice.style.color = 'var(--color-warning)';
    notice.style.marginBottom = '1rem';
    notice.textContent = 'Section in progress. Late arrivals will trigger schedule regeneration.';
    container.appendChild(notice);
  }

  // Counter
  const counter = document.createElement('p');
  counter.className = 'info-line checkin-counter';
  counter.textContent = `${arrivedCount} of ${totalCount} checked in`;
  container.appendChild(counter);

  // Add Participant button (not available if section is complete)
  if (!sec.completed) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary';
    addBtn.style.marginBottom = '1rem';
    addBtn.textContent = 'Add Participant';
    addBtn.onclick = () => showAddParticipantDialog(sectionId, sec, ctx, () => {
      renderSectionCheckIn(container, params, ctx);
    });
    container.appendChild(addBtn);
  }

  // Roster table with check-in buttons
  const sorted = [...sec.participants].sort((a, b) => a.car_number - b.car_number);

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Car #</th><th>Name</th><th></th></tr></thead>
      <tbody id="reg-checkin-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#reg-checkin-body');
  for (const p of sorted) {
    const isArrived = arrivedSet.has(p.car_number);
    const isRemoved = removedSet.has(p.car_number);
    const tr = document.createElement('tr');
    if (isRemoved) tr.style.opacity = '0.5';

    tr.innerHTML = `
      <td><strong>#${p.car_number}</strong></td>
      <td>${esc(p.name)}</td>
      <td class="table-actions"></td>
    `;

    const actionsCell = tr.querySelector('.table-actions');
    if (isRemoved) {
      actionsCell.innerHTML = '<span class="status-badge status-removed">Removed</span>';
    } else if (isArrived) {
      actionsCell.innerHTML = '<span class="status-badge status-arrived">Arrived</span>';
    } else if (!sec.completed) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-primary';
      btn.textContent = 'Check In';
      btn.onclick = () => {
        showCheckInConfirmDialog(p, async () => {
          ctx.state = await appendEvent({
            type: 'CarArrived',
            section_id: sectionId,
            car_number: p.car_number,
            timestamp: Date.now()
          });
          showToast(`#${p.car_number} ${p.name} checked in`, 'success');
          renderSectionCheckIn(container, params, ctx);
        });
      };
      actionsCell.appendChild(btn);
    }

    tbody.appendChild(tr);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
