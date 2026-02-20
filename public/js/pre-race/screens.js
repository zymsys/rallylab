/**
 * screens.js — Screen render functions for pre-race registration.
 * 4 screens: Login, Rally List, Rally Home, Section Detail.
 */

import { signIn, getUser } from '../supabase.js';
import { loadRallyState, appendEvent, exportRosterPackage, isOrganizer, getAccessibleRallyIds } from './commands.js';
import {
  showCreateRallyDialog,
  showCreateSectionDialog,
  showCreateGroupDialog,
  showInviteRegistrarDialog,
  showUploadRosterDialog,
  showAddParticipantDialog
} from './dialogs.js';
import { showToast, navigate } from './app.js';
import { loadDemoData } from './demo-data.js';

// ─── Screen 1: Login ──────────────────────────────────────────────
export function renderLogin(container) {
  container.innerHTML = `
    <div class="login-container">
      <div class="logo-large">RallyLab</div>
      <p class="tagline">Pinewood Derby Race Management</p>
      <form class="login-form" id="login-form">
        <div class="form-group">
          <label for="login-email">Email</label>
          <input id="login-email" class="form-input" type="email" placeholder="you@example.com" required>
        </div>
        <button type="submit" class="btn btn-primary">Sign In</button>
      </form>
      <div class="login-divider">or</div>
      <button class="btn btn-secondary" id="demo-btn" style="width:100%;justify-content:center">Load Demo Data &amp; Sign In</button>
    </div>
  `;

  document.getElementById('login-form').onsubmit = (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    if (!email) return;
    signIn(email);
  };

  document.getElementById('demo-btn').onclick = async () => {
    const btn = document.getElementById('demo-btn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
      await loadDemoData();
      signIn('organizer@example.com');
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Load Demo Data & Sign In';
    }
  };
}

// ─── Screen 2: Rally List ──────────────────────────────────────────
export async function renderRallyList(container) {
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading rallies...</p>';

  const rallyIds = await getAccessibleRallyIds();
  const rallies = [];

  for (const id of rallyIds) {
    try {
      const state = await loadRallyState(id);
      const sectionCount = Object.keys(state.sections).length;
      rallies.push({ rally_id: id, rally_name: state.rally_name, rally_date: state.rally_date, sectionCount });
    } catch { /* skip broken rallies */ }
  }

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <h2 class="screen-title">Your Rallies</h2>
    <div class="toolbar-actions" id="rally-list-actions"></div>
  `;
  container.appendChild(toolbar);

  const _isOrganizerList = await isOrganizer();
  if (_isOrganizerList) {
    const createBtn = document.createElement('button');
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = '+ Create Rally';
    createBtn.onclick = () => showCreateRallyDialog((newId) => navigate('rally-home', { rallyId: newId }));
    toolbar.querySelector('#rally-list-actions').appendChild(createBtn);
  }

  if (rallies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = _isOrganizerList
      ? '<p>No rallies yet. Create your first rally to get started.</p>'
      : '<p>No rallies found. Ask your organizer to invite you.</p>';
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Rally Name</th><th>Date</th><th>Sections</th><th></th></tr></thead>
      <tbody id="rally-list-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#rally-list-body');
  for (const evt of rallies) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(evt.rally_name)}</strong></td>
      <td>${evt.rally_date}</td>
      <td>${evt.sectionCount}</td>
      <td class="table-actions"></td>
    `;
    const manageBtn = document.createElement('button');
    manageBtn.className = 'btn btn-sm btn-secondary';
    manageBtn.textContent = 'Manage';
    manageBtn.onclick = () => navigate('rally-home', { rallyId: evt.rally_id });
    tr.querySelector('.table-actions').appendChild(manageBtn);
    tbody.appendChild(tr);
  }
}

// ─── Screen 3: Rally Home ──────────────────────────────────────────
export async function renderRallyHome(container, params) {
  const { rallyId } = params;
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading rally...</p>';

  const state = await loadRallyState(rallyId);
  const _isOrganizer = await isOrganizer();
  const sections = Object.values(state.sections);
  const groups = Object.values(state.groups);
  const registrars = Object.values(state.registrars);
  const hasParticipants = sections.some(s => s.participants.length > 0);

  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'toolbar';
  header.innerHTML = `
    <div>
      <h2 class="screen-title">${esc(state.rally_name)}</h2>
      <p class="screen-subtitle">${state.rally_date}</p>
    </div>
    <div class="toolbar-actions" id="rally-home-actions"></div>
  `;
  container.appendChild(header);

  const actions = header.querySelector('#rally-home-actions');

  if (hasParticipants) {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-secondary';
    exportBtn.textContent = 'Export Roster';
    exportBtn.onclick = () => {
      try {
        exportRosterPackage(state);
        showToast('Roster package downloaded', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
    actions.appendChild(exportBtn);
  }

  if (_isOrganizer) {
    const raceDayBtn = document.createElement('button');
    raceDayBtn.className = 'btn btn-primary';
    raceDayBtn.textContent = 'Race Day';
    raceDayBtn.onclick = () => window.location.href = 'operator.html';
    actions.appendChild(raceDayBtn);
  } else {
    const checkInBtn = document.createElement('button');
    checkInBtn.className = 'btn btn-primary';
    checkInBtn.textContent = 'Race Day Check-In';
    checkInBtn.onclick = () => window.location.href = 'registrar.html';
    actions.appendChild(checkInBtn);
  }

  if (_isOrganizer) {
    renderOrganizerRallyHome(container, params, state, sections, groups, registrars);
  } else {
    renderRegistrarRallyHome(container, params, state, sections, groups);
  }
}

function renderOrganizerRallyHome(container, params, state, sections, groups, registrars) {
  const { rallyId } = params;
  const refresh = () => renderRallyHome(container, params);

  // ── Area 1: Sections ──
  const sectionsHeading = document.createElement('div');
  sectionsHeading.className = 'toolbar';
  sectionsHeading.innerHTML = `
    <h3 class="area-heading">Sections</h3>
    <div class="toolbar-actions" id="section-actions"></div>
  `;
  container.appendChild(sectionsHeading);

  const addSectionBtn = document.createElement('button');
  addSectionBtn.className = 'btn btn-sm btn-primary';
  addSectionBtn.textContent = '+ Add Section';
  addSectionBtn.onclick = () => {
    const existingNames = sections.map(s => s.section_name.toLowerCase());
    showCreateSectionDialog(rallyId, existingNames, refresh);
  };
  sectionsHeading.querySelector('#section-actions').appendChild(addSectionBtn);

  if (sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sections yet. Add a section to start building your roster.';
    container.appendChild(empty);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Section</th><th>Participants</th><th></th></tr></thead>
        <tbody id="sections-body"></tbody>
      </table>
    `;
    container.appendChild(wrap);

    const tbody = wrap.querySelector('#sections-body');
    for (const section of sections) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${esc(section.section_name)}</strong></td>
        <td>${section.participants.length}</td>
        <td class="table-actions"></td>
      `;

      const actionsCell = tr.querySelector('.table-actions');

      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-sm btn-secondary';
      viewBtn.textContent = 'Roster';
      viewBtn.onclick = () => navigate('section-detail', { rallyId, sectionId: section.section_id });
      actionsCell.appendChild(viewBtn);

      tbody.appendChild(tr);
    }
  }

  // ── Area 2: Groups ──
  const groupsHeading = document.createElement('div');
  groupsHeading.className = 'toolbar';
  groupsHeading.style.marginTop = '2rem';
  groupsHeading.innerHTML = `
    <h3 class="area-heading">Groups</h3>
    <div class="toolbar-actions" id="group-actions"></div>
  `;
  container.appendChild(groupsHeading);

  const addGroupBtn = document.createElement('button');
  addGroupBtn.className = 'btn btn-sm btn-primary';
  addGroupBtn.textContent = '+ Add Group';
  addGroupBtn.onclick = () => {
    const existingNames = groups.map(g => g.group_name.toLowerCase());
    showCreateGroupDialog(rallyId, existingNames, refresh);
  };
  groupsHeading.querySelector('#group-actions').appendChild(addGroupBtn);

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No groups yet. Add a group before inviting registrars.';
    container.appendChild(empty);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Group</th></tr></thead>
        <tbody id="groups-body"></tbody>
      </table>
    `;
    container.appendChild(wrap);

    const tbody = wrap.querySelector('#groups-body');
    for (const group of groups) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(group.group_name)}</td>`;
      tbody.appendChild(tr);
    }
  }

  // ── Area 3: Registrars ──
  const regHeading = document.createElement('div');
  regHeading.className = 'toolbar';
  regHeading.style.marginTop = '2rem';
  regHeading.innerHTML = `
    <h3 class="area-heading">Registrars</h3>
    <div class="toolbar-actions" id="registrar-actions"></div>
  `;
  container.appendChild(regHeading);

  if (sections.length > 0) {
    const inviteBtn = document.createElement('button');
    inviteBtn.className = 'btn btn-sm btn-primary';
    inviteBtn.textContent = '+ Invite Registrar';
    inviteBtn.onclick = () => showInviteRegistrarDialog(rallyId, state, null, refresh);
    regHeading.querySelector('#registrar-actions').appendChild(inviteBtn);
  }

  if (registrars.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = sections.length === 0
      ? 'Add sections before inviting registrars.'
      : 'No registrars invited yet.';
    container.appendChild(empty);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Email</th><th>Groups</th><th>Sections</th><th></th></tr></thead>
        <tbody id="registrars-body"></tbody>
      </table>
    `;
    container.appendChild(wrap);

    const tbody = wrap.querySelector('#registrars-body');
    for (const reg of registrars) {
      const tr = document.createElement('tr');
      const groupNames = reg.group_ids
        .map(id => state.groups[id]?.group_name)
        .filter(Boolean)
        .join(', ');
      const sectionNames = reg.section_ids
        .map(id => state.sections[id]?.section_name)
        .filter(Boolean)
        .join(', ');

      tr.innerHTML = `
        <td>${esc(reg.email)}</td>
        <td>${esc(groupNames) || '<span style="color:var(--color-text-secondary)">None</span>'}</td>
        <td>${esc(sectionNames) || '<span style="color:var(--color-text-secondary)">None</span>'}</td>
        <td class="table-actions"></td>
      `;

      const actionsCell = tr.querySelector('.table-actions');

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => showInviteRegistrarDialog(rallyId, state, reg.email, refresh);
      actionsCell.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => confirmRemoveRegistrar(rallyId, reg.email, container, params);
      actionsCell.appendChild(removeBtn);

      tbody.appendChild(tr);
    }
  }
}

function renderRegistrarRallyHome(container, params, state, sections, groups) {
  const { rallyId } = params;
  const user = getUser();
  const reg = state.registrars[user.email];

  if (!reg) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'You are not registered for this rally. Contact your organizer.';
    container.appendChild(empty);
    return;
  }

  // Registrar with groups + sections: show combo table for pre-race roster management
  if (reg.group_ids.length > 0 && reg.section_ids.length > 0) {
    const combos = [];
    for (const groupId of reg.group_ids) {
      for (const sectionId of reg.section_ids) {
        const group = state.groups[groupId];
        const section = state.sections[sectionId];
        if (!group || !section) continue;
        const count = section.participants.filter(p => p.group_id === groupId).length;
        combos.push({ groupId, sectionId, groupName: group.group_name, sectionName: section.section_name, count });
      }
    }

    if (combos.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Group</th><th>Section</th><th>Participants</th><th></th></tr></thead>
          <tbody id="combos-body"></tbody>
        </table>
      `;
      container.appendChild(wrap);

      const tbody = wrap.querySelector('#combos-body');
      for (const combo of combos) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${esc(combo.groupName)}</strong></td>
          <td>${esc(combo.sectionName)}</td>
          <td>${combo.count}</td>
          <td class="table-actions"></td>
        `;

        const manageBtn = document.createElement('button');
        manageBtn.className = 'btn btn-sm btn-secondary';
        manageBtn.textContent = 'Manage';
        manageBtn.onclick = () => navigate('section-detail', {
          rallyId,
          sectionId: combo.sectionId,
          groupId: combo.groupId
        });
        tr.querySelector('.table-actions').appendChild(manageBtn);
        tbody.appendChild(tr);
      }
    }
  } else {
    // No groups — race day check-in only
    const hint = document.createElement('p');
    hint.className = 'info-line';
    hint.style.marginTop = '1rem';
    hint.textContent = 'You are set up for race day check-in. Use the "Race Day Check-In" button above when ready.';
    container.appendChild(hint);
  }
}

async function confirmRemoveRegistrar(rallyId, email, container, params) {
  if (!confirm(`Remove registrar ${email}? Their uploaded data will be kept.`)) return;

  try {
    const user = getUser();
    await appendEvent({
      type: 'RegistrarRemoved',
      rally_id: rallyId,
      registrar_email: email,
      removed_by: user.email,
      timestamp: Date.now()
    });
    showToast(`Removed ${email}`, 'success');
    renderRallyHome(container, params);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Screen 4: Section Detail ──────────────────────────────────────
export async function renderSectionDetail(container, params) {
  const { rallyId, sectionId, groupId } = params;
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading section...</p>';

  const state = await loadRallyState(rallyId);
  const section = state.sections[sectionId];
  if (!section) {
    container.innerHTML = '<p class="info-line">Section not found.</p>';
    return;
  }

  const _isOrganizer = await isOrganizer();

  // canEdit: organizer can always edit. Registrar must have group+section access.
  let canEdit = false;
  if (_isOrganizer) {
    canEdit = true;
  } else {
    const reg = state.registrars[user.email];
    if (reg && groupId) {
      canEdit = reg.group_ids.includes(groupId) && reg.section_ids.includes(sectionId);
    }
  }

  container.innerHTML = '';

  // Header with back button
  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <button class="back-btn" aria-label="Back">&larr;</button>
    <h2 class="screen-title">${esc(section.section_name)}</h2>
  `;
  header.querySelector('.back-btn').onclick = () => navigate('rally-home', { rallyId });
  container.appendChild(header);

  // Show group context if filtering by group
  if (groupId && state.groups[groupId]) {
    const info = document.createElement('p');
    info.className = 'info-line';
    info.textContent = `Group: ${state.groups[groupId].group_name}`;
    container.appendChild(info);
  }

  if (groupId) {
    // ── Filtered view: single group's participants ──
    renderFilteredRoster(container, params, state, section, groupId, canEdit);
  } else {
    // ── Overview: all participants grouped by group ──
    renderGroupedRoster(container, params, state, section, canEdit);
  }
}

function renderFilteredRoster(container, params, state, section, groupId, canEdit) {
  const { rallyId, sectionId } = params;
  const participants = section.participants.filter(p => p.group_id === groupId);

  // Actions toolbar
  if (canEdit) {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = '<div></div><div class="toolbar-actions" id="section-actions"></div>';
    container.appendChild(toolbar);

    const actions = toolbar.querySelector('#section-actions');

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn btn-secondary';
    uploadBtn.textContent = 'Upload Roster';
    uploadBtn.onclick = () => showUploadRosterDialog(rallyId, sectionId, groupId, section, () => renderSectionDetail(container, params));
    actions.appendChild(uploadBtn);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = '+ Add Participant';
    addBtn.onclick = () => showAddParticipantDialog(
      rallyId, sectionId, groupId, section,
      () => renderSectionDetail(container, params)
    );
    actions.appendChild(addBtn);
  }

  if (participants.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No participants yet. Upload a roster or add participants one at a time.';
    container.appendChild(empty);
    return;
  }

  const sorted = [...participants].sort((a, b) => a.car_number - b.car_number);
  renderRosterTable(container, sorted, canEdit, params, section);

  const count = document.createElement('p');
  count.className = 'info-line';
  count.style.marginTop = '0.75rem';
  count.textContent = `${participants.length} participant${participants.length !== 1 ? 's' : ''}`;
  container.appendChild(count);
}

function renderGroupedRoster(container, params, state, section, canEdit) {
  const { rallyId, sectionId } = params;
  const isOrganizer = canEdit; // only organizers see grouped view

  if (section.participants.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No participants yet.';
    container.appendChild(empty);
    return;
  }

  // Group participants by group_id
  const byGroup = new Map();
  for (const p of section.participants) {
    const gid = p.group_id || '__ungrouped__';
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(p);
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Car #</th><th>Name</th><th></th></tr></thead>
      <tbody id="roster-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#roster-body');

  for (const [gid, participants] of byGroup) {
    const sorted = [...participants].sort((a, b) => a.car_number - b.car_number);
    const groupName = gid === '__ungrouped__' ? 'Ungrouped' : (state.groups[gid]?.group_name || 'Unknown Group');

    // Group subheading row
    const headerTr = document.createElement('tr');
    headerTr.className = 'group-header-row';
    headerTr.innerHTML = `<td colspan="2"><strong>${esc(groupName)}</strong> (${sorted.length})</td><td class="table-actions"></td>`;

    if (isOrganizer && gid !== '__ungrouped__') {
      const editLink = document.createElement('button');
      editLink.className = 'btn btn-sm btn-ghost';
      editLink.textContent = 'Edit';
      editLink.onclick = () => navigate('section-detail', { rallyId, sectionId, groupId: gid });
      headerTr.querySelector('.table-actions').appendChild(editLink);
    }

    tbody.appendChild(headerTr);

    for (const p of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${p.car_number}</strong></td>
        <td>${esc(p.name)}</td>
        <td></td>
      `;
      tbody.appendChild(tr);
    }
  }

  const count = document.createElement('p');
  count.className = 'info-line';
  count.style.marginTop = '0.75rem';
  count.textContent = `${section.participants.length} participant${section.participants.length !== 1 ? 's' : ''} total`;
  container.appendChild(count);
}

function renderRosterTable(container, sorted, canEdit, params, section) {
  const { rallyId, sectionId } = params;
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Car #</th><th>Name</th>${canEdit ? '<th></th>' : ''}</tr></thead>
      <tbody id="roster-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#roster-body');
  for (const p of sorted) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${p.car_number}</strong></td>
      <td>${esc(p.name)}</td>
    `;

    if (canEdit) {
      const td = document.createElement('td');
      td.className = 'table-actions';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-ghost';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => confirmRemoveParticipant(
        rallyId, sectionId, p, container, params
      );
      td.appendChild(removeBtn);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

async function confirmRemoveParticipant(rallyId, sectionId, participant, container, params) {
  if (!confirm(`Remove ${participant.name} (car #${participant.car_number})?`)) return;

  try {
    const user = getUser();
    await appendEvent({
      type: 'ParticipantRemoved',
      rally_id: rallyId,
      section_id: sectionId,
      participant_id: participant.participant_id,
      group_id: participant.group_id || null,
      car_number: participant.car_number,
      removed_by: user.email,
      timestamp: Date.now()
    });
    showToast(`Removed ${participant.name}`, 'success');
    renderSectionDetail(container, params);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
