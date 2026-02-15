/**
 * screens.js — Screen render functions for pre-race registration.
 * 4 screens: Login, Event List, Event Home, Section Detail.
 */

import { signIn, getUser, getAccessibleEventIds } from '../supabase.js';
import { loadEventState, appendEvent, exportRosterPackage } from './commands.js';
import {
  showCreateEventDialog,
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
      <div class="logo-large">Kub Kars</div>
      <p class="tagline">Pinewood Derby Race Management</p>
      <form class="login-form" id="login-form">
        <div class="form-group">
          <label for="login-email">Email</label>
          <input id="login-email" class="form-input" type="email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label>Sign in as</label>
          <div class="radio-group">
            <label><input type="radio" name="role" value="organizer" checked> Organizer</label>
            <label><input type="radio" name="role" value="registrar"> Registrar</label>
          </div>
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
    const role = document.querySelector('input[name="role"]:checked').value;
    if (!email) return;
    signIn(email, role);
  };

  document.getElementById('demo-btn').onclick = async () => {
    const btn = document.getElementById('demo-btn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
      await loadDemoData();
      signIn('organizer@example.com', 'organizer');
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Load Demo Data & Sign In';
    }
  };
}

// ─── Screen 2: Event List ──────────────────────────────────────────
export async function renderEventList(container) {
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading events...</p>';

  const eventIds = getAccessibleEventIds();
  const events = [];

  for (const id of eventIds) {
    try {
      const state = await loadEventState(id);
      const sectionCount = Object.keys(state.sections).length;
      events.push({ event_id: id, event_name: state.event_name, event_date: state.event_date, sectionCount });
    } catch { /* skip broken events */ }
  }

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <h2 class="screen-title">Your Events</h2>
    <div class="toolbar-actions" id="event-list-actions"></div>
  `;
  container.appendChild(toolbar);

  if (user.role === 'organizer') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '+ Create Event';
    btn.onclick = () => showCreateEventDialog((newId) => navigate('event-home', { eventId: newId }));
    toolbar.querySelector('#event-list-actions').appendChild(btn);
  }

  if (events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = user.role === 'organizer'
      ? '<p>No events yet. Create your first event to get started.</p>'
      : '<p>No events found. Ask your organizer to invite you.</p>';
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Event Name</th><th>Date</th><th>Sections</th><th></th></tr></thead>
      <tbody id="event-list-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#event-list-body');
  for (const evt of events) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(evt.event_name)}</strong></td>
      <td>${evt.event_date}</td>
      <td>${evt.sectionCount}</td>
      <td class="table-actions"></td>
    `;
    const manageBtn = document.createElement('button');
    manageBtn.className = 'btn btn-sm btn-secondary';
    manageBtn.textContent = 'Manage';
    manageBtn.onclick = () => navigate('event-home', { eventId: evt.event_id });
    tr.querySelector('.table-actions').appendChild(manageBtn);
    tbody.appendChild(tr);
  }
}

// ─── Screen 3: Event Home ──────────────────────────────────────────
export async function renderEventHome(container, params) {
  const { eventId } = params;
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading event...</p>';

  const state = await loadEventState(eventId);
  const isOrganizer = user.role === 'organizer';
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
      <h2 class="screen-title">${esc(state.event_name)}</h2>
      <p class="screen-subtitle">${state.event_date}</p>
    </div>
    <div class="toolbar-actions" id="event-home-actions"></div>
  `;
  container.appendChild(header);

  const actions = header.querySelector('#event-home-actions');

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

  if (isOrganizer) {
    renderOrganizerEventHome(container, params, state, sections, groups, registrars);
  } else {
    renderRegistrarEventHome(container, params, state, sections, groups);
  }
}

function renderOrganizerEventHome(container, params, state, sections, groups, registrars) {
  const { eventId } = params;
  const refresh = () => renderEventHome(container, params);

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
    showCreateSectionDialog(eventId, existingNames, refresh);
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
      viewBtn.onclick = () => navigate('section-detail', { eventId, sectionId: section.section_id });
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
    showCreateGroupDialog(eventId, existingNames, refresh);
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

  if (groups.length > 0 && sections.length > 0) {
    const inviteBtn = document.createElement('button');
    inviteBtn.className = 'btn btn-sm btn-primary';
    inviteBtn.textContent = '+ Invite Registrar';
    inviteBtn.onclick = () => showInviteRegistrarDialog(eventId, state, null, refresh);
    regHeading.querySelector('#registrar-actions').appendChild(inviteBtn);
  }

  if (registrars.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = groups.length === 0 || sections.length === 0
      ? 'Add groups and sections before inviting registrars.'
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
      editBtn.onclick = () => showInviteRegistrarDialog(eventId, state, reg.email, refresh);
      actionsCell.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => confirmRemoveRegistrar(eventId, reg.email, container, params);
      actionsCell.appendChild(removeBtn);

      tbody.appendChild(tr);
    }
  }
}

function renderRegistrarEventHome(container, params, state, sections, groups) {
  const { eventId } = params;
  const user = getUser();
  const reg = state.registrars[user.email];

  if (!reg || reg.group_ids.length === 0 || reg.section_ids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'You have no assigned groups or sections. Contact your organizer.';
    container.appendChild(empty);
    return;
  }

  // Build combo list: group x section
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

  if (combos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No valid group/section assignments found.';
    container.appendChild(empty);
    return;
  }

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
      eventId,
      sectionId: combo.sectionId,
      groupId: combo.groupId
    });
    tr.querySelector('.table-actions').appendChild(manageBtn);
    tbody.appendChild(tr);
  }
}

async function confirmRemoveRegistrar(eventId, email, container, params) {
  if (!confirm(`Remove registrar ${email}? Their uploaded data will be kept.`)) return;

  try {
    const user = getUser();
    await appendEvent({
      type: 'RegistrarRemoved',
      event_id: eventId,
      registrar_email: email,
      removed_by: user.email,
      timestamp: Date.now()
    });
    showToast(`Removed ${email}`, 'success');
    renderEventHome(container, params);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── Screen 4: Section Detail ──────────────────────────────────────
export async function renderSectionDetail(container, params) {
  const { eventId, sectionId, groupId } = params;
  const user = getUser();
  container.innerHTML = '<p class="info-line">Loading section...</p>';

  const state = await loadEventState(eventId);
  const section = state.sections[sectionId];
  if (!section) {
    container.innerHTML = '<p class="info-line">Section not found.</p>';
    return;
  }

  const isOrganizer = user.role === 'organizer';

  // canEdit: organizer can always edit. Registrar must have group+section access.
  let canEdit = false;
  if (isOrganizer) {
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
  header.querySelector('.back-btn').onclick = () => navigate('event-home', { eventId });
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
  const { eventId, sectionId } = params;
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
    uploadBtn.onclick = () => showUploadRosterDialog(eventId, sectionId, groupId, section, () => renderSectionDetail(container, params));
    actions.appendChild(uploadBtn);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = '+ Add Participant';
    addBtn.onclick = () => showAddParticipantDialog(
      eventId, sectionId, groupId, section,
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
  const { eventId, sectionId } = params;
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
      editLink.onclick = () => navigate('section-detail', { eventId, sectionId, groupId: gid });
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
  const { eventId, sectionId } = params;
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
        eventId, sectionId, p, container, params
      );
      td.appendChild(removeBtn);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

async function confirmRemoveParticipant(eventId, sectionId, participant, container, params) {
  if (!confirm(`Remove ${participant.name} (car #${participant.car_number})?`)) return;

  try {
    const user = getUser();
    await appendEvent({
      type: 'ParticipantRemoved',
      event_id: eventId,
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
