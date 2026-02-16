/**
 * operator/screens.js — 5 operator screen renderers.
 * Screen A: Event List, Screen B: Event Home, Screen C: Check-In,
 * Screen D: Live Console, Screen E: Section Complete.
 */

import { computeLeaderboard } from '../scoring.js';
import { deriveRaceDayPhase, getCurrentHeat, getAcceptedResult } from '../state-manager.js';
import { showManualRankDialog, showRemoveCarDialog, showLoadRosterDialog, showCorrectLanesDialog, showStartSectionDialog, showChangeLanesDialog } from './dialogs.js';
import { showDemoDataDialog } from './demo-data.js';

// ─── Screen A: Event List ────────────────────────────────────────

export function renderEventList(container, params, ctx) {
  const { state, navigate, showToast } = ctx;
  const rd = state.race_day;
  const sections = rd.loaded ? Object.values(rd.sections) : [];

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <h2 class="screen-title">Race Day</h2>
    <div class="toolbar-actions" id="event-list-actions"></div>
  `;
  container.appendChild(toolbar);

  const actions = toolbar.querySelector('#event-list-actions');

  const loadBtn = document.createElement('button');
  loadBtn.className = 'btn btn-secondary';
  loadBtn.textContent = 'Load Roster Package';
  loadBtn.onclick = () => showLoadRosterDialog(ctx);
  actions.appendChild(loadBtn);

  const demoBtn = document.createElement('button');
  demoBtn.className = 'btn btn-primary';
  demoBtn.textContent = 'Load Demo Data';
  demoBtn.onclick = () => showDemoDataDialog(ctx);
  actions.appendChild(demoBtn);

  if (!rd.loaded || sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No roster loaded. Load a roster package or demo data to get started.';
    container.appendChild(empty);
    return;
  }

  // Show loaded event info
  const info = document.createElement('p');
  info.className = 'info-line';
  info.textContent = `${state.event_name || 'Event'} — ${sections.length} section${sections.length !== 1 ? 's' : ''}`;
  container.appendChild(info);

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn-primary';
  goBtn.style.marginTop = '1rem';
  goBtn.textContent = 'Go to Event Home';
  goBtn.onclick = () => navigate('event-home', {});
  container.appendChild(goBtn);
}

// ─── Screen B: Event Home ────────────────────────────────────────

export function renderEventHome(container, params, ctx) {
  const { state, navigate, showToast } = ctx;
  const rd = state.race_day;

  if (!rd.loaded) {
    container.innerHTML = '<div class="empty-state">No roster loaded.</div>';
    return;
  }

  const sections = Object.values(rd.sections);
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'toolbar';
  header.innerHTML = `
    <div>
      <h2 class="screen-title">${esc(state.event_name || 'Event')}</h2>
      <p class="screen-subtitle">${state.event_date || ''}</p>
    </div>
  `;
  container.appendChild(header);

  if (sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sections in roster.';
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
      <tbody id="sections-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#sections-body');
  for (const sec of sections) {
    const tr = document.createElement('tr');
    const phase = deriveRaceDayPhase(state, sec.section_id);
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

    // Check In button (always available if not complete)
    if (!sec.completed) {
      const checkInBtn = document.createElement('button');
      checkInBtn.className = 'btn btn-sm btn-secondary';
      checkInBtn.textContent = 'Check In';
      checkInBtn.onclick = () => navigate('check-in', { sectionId: sec.section_id });
      actionsCell.appendChild(checkInBtn);
    }

    // Start Section (if not started, >= 2 arrived)
    if (!sec.started && arrivedCount >= 2) {
      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-sm btn-primary';
      startBtn.textContent = 'Start Section';
      startBtn.onclick = () => showStartSectionDialog(sec.section_id, ctx);
      actionsCell.appendChild(startBtn);
    }

    // Live Console (if in progress)
    if (sec.started && !sec.completed) {
      const liveBtn = document.createElement('button');
      liveBtn.className = 'btn btn-sm btn-primary';
      liveBtn.textContent = 'Live Console';
      liveBtn.onclick = () => navigate('live-console', { sectionId: sec.section_id });
      actionsCell.appendChild(liveBtn);
    }

    // View Results (if complete)
    if (sec.completed) {
      const resultBtn = document.createElement('button');
      resultBtn.className = 'btn btn-sm btn-secondary';
      resultBtn.textContent = 'Results';
      resultBtn.onclick = () => navigate('section-complete', { sectionId: sec.section_id });
      actionsCell.appendChild(resultBtn);
    }

    tbody.appendChild(tr);
  }
}

// ─── Screen C: Check-In ─────────────────────────────────────────

export function renderCheckIn(container, params, ctx) {
  const { state, navigate, showToast, appendEvent, startSection } = ctx;
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
  header.querySelector('.back-btn').onclick = () => navigate('event-home', {});
  container.appendChild(header);

  // Counter
  const counter = document.createElement('p');
  counter.className = 'info-line checkin-counter';
  counter.textContent = `${arrivedCount} of ${totalCount} checked in`;
  container.appendChild(counter);

  // Start button
  if (!sec.started && arrivedCount >= 2) {
    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary';
    startBtn.style.marginBottom = '1rem';
    startBtn.textContent = 'Start This Section';
    startBtn.onclick = () => showStartSectionDialog(sectionId, ctx);
    container.appendChild(startBtn);
  } else if (!sec.started) {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.style.marginBottom = '1rem';
    hint.textContent = 'Check in at least 2 cars to start.';
    container.appendChild(hint);
  }

  if (sec.started) {
    const notice = document.createElement('p');
    notice.className = 'info-line';
    notice.style.color = 'var(--color-warning)';
    notice.style.marginBottom = '1rem';
    notice.textContent = 'Section already started. Late arrivals will trigger schedule regeneration.';
    container.appendChild(notice);
  }

  // Roster table with checkboxes
  const sorted = [...sec.participants].sort((a, b) => a.car_number - b.car_number);

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `
    <table>
      <thead><tr><th style="width:3rem"></th><th>Car #</th><th>Name</th><th>Status</th></tr></thead>
      <tbody id="checkin-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#checkin-body');
  for (const p of sorted) {
    const isArrived = arrivedSet.has(p.car_number);
    const isRemoved = removedSet.has(p.car_number);
    const tr = document.createElement('tr');
    if (isRemoved) tr.style.opacity = '0.5';

    const checkTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'checkin-toggle';
    checkbox.checked = isArrived;
    checkbox.disabled = isRemoved;
    checkbox.onchange = async () => {
      if (checkbox.checked && !isArrived) {
        await appendEvent({
          type: 'CarArrived',
          section_id: sectionId,
          car_number: p.car_number,
          timestamp: Date.now()
        });
        if (sec.started) {
          // Late arrival — re-import handleLateArrival
          const { handleLateArrival } = await import('./app.js');
          handleLateArrival(sectionId);
        }
        renderCheckIn(container, params, ctx);
      }
    };
    checkTd.appendChild(checkbox);
    tr.appendChild(checkTd);

    tr.innerHTML += `
      <td><strong>#${p.car_number}</strong></td>
      <td>${esc(p.name)}</td>
      <td>${isRemoved ? '<span class="status-badge status-removed">Removed</span>' :
             isArrived ? '<span class="status-badge status-arrived">Arrived</span>' :
             '<span class="status-badge status-idle">Waiting</span>'}</td>
    `;

    tbody.appendChild(tr);
  }
}

// ─── Screen D: Live Console ─────────────────────────────────────

export function renderLiveConsole(container, params, ctx) {
  const { state, navigate, showToast } = ctx;
  const { sectionId } = params;
  const sec = state.race_day.sections[sectionId];

  if (!sec) {
    container.innerHTML = '<div class="empty-state">Section not found.</div>';
    return;
  }

  const phase = deriveRaceDayPhase(state, sectionId);
  const currentHeat = getCurrentHeat(state, sectionId);
  const schedule = ctx.getSchedule();
  const totalHeats = schedule ? schedule.heats.length : 0;

  // If section is started but no schedule in memory for THIS section → show resume UI
  const isLiveForThisSection = ctx.liveSection?.sectionId === sectionId;
  const needsResume = sec.started && !sec.completed && (!schedule || !isLiveForThisSection);

  container.innerHTML = '';

  // Pinned header
  const header = document.createElement('div');
  header.className = 'console-header';

  let stateLabel;
  if (needsResume) stateLabel = 'Paused';
  else if (phase === 'staging') stateLabel = 'Staging';
  else if (phase === 'results') stateLabel = 'Results';
  else if (phase === 'section-complete') stateLabel = 'Complete';
  else stateLabel = 'Ready';

  const activeLanes = ctx.getAvailableLanes(sectionId);
  const lanesStr = activeLanes.join(', ');

  header.innerHTML = `
    <div class="console-title-row">
      <h2 class="screen-title">${esc(sec.section_name)}</h2>
      <span class="console-state-label">${stateLabel}</span>
    </div>
    <p class="info-line">Heat ${currentHeat} of ${totalHeats || '?'} &middot; Lanes: ${lanesStr}</p>
  `;
  container.appendChild(header);

  // Resume Racing prompt
  if (needsResume) {
    const resumeWrap = document.createElement('div');
    resumeWrap.className = 'console-resume';
    resumeWrap.style.textAlign = 'center';
    resumeWrap.style.padding = '2rem 0';

    const hint = document.createElement('p');
    hint.className = 'info-line';
    hint.style.marginBottom = '1rem';
    hint.textContent = 'Race loop is not running. Reconnect to the track and resume to continue.';
    resumeWrap.appendChild(hint);

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'btn btn-primary';
    resumeBtn.textContent = 'Resume Racing';
    resumeBtn.onclick = async () => {
      resumeBtn.disabled = true;
      resumeBtn.textContent = 'Resuming...';
      try {
        await ctx.resumeSection(sectionId);
      } catch (e) {
        resumeBtn.disabled = false;
        resumeBtn.textContent = 'Resume Racing';
        ctx.showToast('Resume failed: ' + e.message, 'error');
      }
    };
    resumeWrap.appendChild(resumeBtn);

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost';
    backBtn.style.marginTop = '0.5rem';
    backBtn.textContent = 'Event Home';
    backBtn.onclick = () => navigate('event-home', {});
    resumeWrap.appendChild(backBtn);

    container.appendChild(resumeWrap);
  }

  // Two-panel layout
  const panels = document.createElement('div');
  panels.className = 'console-panels';

  // Left panel: Current Heat
  const leftPanel = document.createElement('div');
  leftPanel.className = 'console-panel';

  if (currentHeat > 0) {
    const currentHeatData = sec.heats.find(h => h.heat_number === currentHeat);
    const result = getAcceptedResult(sec, currentHeat);

    leftPanel.innerHTML = `<h3 class="area-heading">Heat ${currentHeat}</h3>`;

    if (currentHeatData) {
      const laneTable = document.createElement('div');
      laneTable.className = 'table-wrap';
      let tableHtml = `
        <table class="lane-table">
          <thead><tr><th>Lane</th><th>Car #</th><th>Name</th>`;
      if (result && result.type === 'RaceCompleted') {
        tableHtml += '<th>Time</th>';
      }
      tableHtml += '</tr></thead><tbody>';

      const sortedLanes = [...currentHeatData.lanes].sort((a, b) => a.lane - b.lane);

      for (const lane of sortedLanes) {
        let timeStr = '';
        if (result && result.type === 'RaceCompleted') {
          const t = result.times_ms[String(lane.lane)];
          timeStr = `<td>${t != null ? formatTime(t) : '—'}</td>`;
        }
        tableHtml += `
          <tr>
            <td class="lane-number">Lane ${lane.lane}</td>
            <td><strong>#${lane.car_number}</strong></td>
            <td>${esc(lane.name)}</td>
            ${timeStr}
          </tr>`;
      }

      tableHtml += '</tbody></table>';
      laneTable.innerHTML = tableHtml;
      leftPanel.appendChild(laneTable);

      // Source badge
      if (result) {
        const badge = document.createElement('div');
        badge.style.marginTop = '0.5rem';
        const sourceType = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
        badge.innerHTML = `<span class="source-badge source-${sourceType.toLowerCase()}">${sourceType}</span>`;
        leftPanel.appendChild(badge);
      }
    }
  } else {
    leftPanel.innerHTML = '<p class="info-line">Waiting for first heat...</p>';
  }

  panels.appendChild(leftPanel);

  // Right panel: Leaderboard
  const rightPanel = document.createElement('div');
  rightPanel.className = 'console-panel';
  rightPanel.innerHTML = '<h3 class="area-heading">Standings</h3>';

  const standings = computeLeaderboard(sec);
  if (standings.length > 0) {
    const sTable = document.createElement('div');
    sTable.className = 'table-wrap';
    let html = `
      <table>
        <thead><tr><th>#</th><th>Car</th><th>Name</th><th>Avg Time</th></tr></thead>
        <tbody>`;
    for (const s of standings.slice(0, 10)) {
      html += `
        <tr${s.incomplete ? ' class="incomplete-row"' : ''}>
          <td>${s.rank}</td>
          <td><strong>#${s.car_number}</strong></td>
          <td>${esc(s.name)}</td>
          <td>${s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—'}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    sTable.innerHTML = html;
    rightPanel.appendChild(sTable);
  } else {
    rightPanel.innerHTML += '<p class="info-line">No results yet.</p>';
  }

  panels.appendChild(rightPanel);
  container.appendChild(panels);

  // Controls row (skip when showing resume prompt)
  if (needsResume) return;

  const controls = document.createElement('div');
  controls.className = 'console-controls';

  const usingFakeTrack = ctx.isUsingFakeTrack();

  // Run Heat button — manual fallback only (fake track uses gate click)
  if (!usingFakeTrack && currentHeat > 0 && phase === 'staging') {
    const currentHeatData = sec.heats.find(h => h.heat_number === currentHeat);
    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = 'Run Heat ' + currentHeat;
    runBtn.onclick = () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Racing...';
      if (currentHeatData) ctx.triggerManualRace(currentHeatData.lanes);
    };
    controls.appendChild(runBtn);
  }

  // Next Heat button — manual fallback only (fake track uses reset click)
  if (!usingFakeTrack && currentHeat > 0 && phase === 'results') {
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-primary';
    nextBtn.textContent = 'Next Heat';
    nextBtn.onclick = () => {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Staging...';
      ctx.triggerManualGate();
    };
    controls.appendChild(nextBtn);
  }

  // Re-Run button
  if (currentHeat > 0 && phase === 'results') {
    const rerunBtn = document.createElement('button');
    rerunBtn.className = 'btn btn-secondary';
    rerunBtn.textContent = 'Re-Run Heat ' + currentHeat;
    rerunBtn.onclick = () => {
      if (confirm(`Declare a re-run for Heat ${currentHeat}?`)) {
        ctx.declareRerun(sectionId, currentHeat);
      }
    };
    controls.appendChild(rerunBtn);
  }

  // Correct Lanes button
  if (currentHeat > 0 && phase === 'results') {
    const correctBtn = document.createElement('button');
    correctBtn.className = 'btn btn-secondary';
    correctBtn.textContent = 'Correct Lanes';
    correctBtn.onclick = () => showCorrectLanesDialog(sectionId, currentHeat, sec, ctx);
    controls.appendChild(correctBtn);
  }

  // Manual Rank button
  if (currentHeat > 0 && phase === 'staging') {
    const manualBtn = document.createElement('button');
    manualBtn.className = 'btn btn-secondary';
    manualBtn.textContent = 'Manual Rank';
    manualBtn.onclick = () => showManualRankDialog(sectionId, currentHeat, sec, ctx);
    controls.appendChild(manualBtn);
  }

  // Change Lanes button
  if (!sec.completed) {
    const changeLanesBtn = document.createElement('button');
    changeLanesBtn.className = 'btn btn-secondary';
    changeLanesBtn.textContent = 'Change Lanes';
    changeLanesBtn.onclick = () => showChangeLanesDialog(sectionId, sec, ctx);
    controls.appendChild(changeLanesBtn);
  }

  // Remove Car button
  if (!sec.completed) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove Car';
    removeBtn.onclick = () => showRemoveCarDialog(sectionId, sec, ctx);
    controls.appendChild(removeBtn);
  }

  // Back to Event Home
  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-ghost';
  backBtn.textContent = 'Event Home';
  backBtn.onclick = () => navigate('event-home', {});
  controls.appendChild(backBtn);

  container.appendChild(controls);
}

// ─── Screen E: Section Complete ─────────────────────────────────

export function renderSectionComplete(container, params, ctx) {
  const { state, navigate } = ctx;
  const { sectionId } = params;
  const sec = state.race_day.sections[sectionId];

  if (!sec) {
    container.innerHTML = '<div class="empty-state">Section not found.</div>';
    return;
  }

  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <h2 class="screen-title">${esc(sec.section_name)} — Final Results</h2>
  `;
  container.appendChild(header);

  const standings = computeLeaderboard(sec);

  if (standings.length > 0) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    let html = `
      <table>
        <thead><tr>
          <th>Rank</th><th>Car #</th><th>Name</th><th>Avg Time</th><th>Best Time</th><th>Heats</th>
        </tr></thead>
        <tbody>`;
    for (const s of standings) {
      html += `
        <tr${s.incomplete ? ' class="incomplete-row"' : ''}>
          <td><strong>${s.rank}</strong></td>
          <td>#${s.car_number}</td>
          <td>${esc(s.name)}</td>
          <td>${s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—'}</td>
          <td>${s.best_time_ms != null ? formatTime(s.best_time_ms) : '—'}</td>
          <td>${s.heats_run}${s.incomplete ? ' *' : ''}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    container.appendChild(wrap);

    const legend = document.createElement('p');
    legend.className = 'form-hint';
    legend.style.marginTop = '0.75rem';
    legend.textContent = '* Incomplete — car was removed before finishing all heats.';
    container.appendChild(legend);
  }

  const actions = document.createElement('div');
  actions.className = 'toolbar-actions';
  actions.style.marginTop = '1.5rem';

  const homeBtn = document.createElement('button');
  homeBtn.className = 'btn btn-secondary';
  homeBtn.textContent = 'Return to Event Home';
  homeBtn.onclick = () => navigate('event-home', {});
  actions.appendChild(homeBtn);

  // Reveal flow state
  let revealRemaining = standings.length;

  const showBtn = document.createElement('button');
  showBtn.className = 'btn btn-primary';
  showBtn.textContent = 'Show on Audience Display';

  const revealNextBtn = document.createElement('button');
  revealNextBtn.className = 'btn btn-primary';
  revealNextBtn.style.display = 'none';

  const revealAllBtn = document.createElement('button');
  revealAllBtn.className = 'btn btn-secondary';
  revealAllBtn.textContent = 'Reveal All';
  revealAllBtn.style.display = 'none';

  function updateRevealNextLabel() {
    revealNextBtn.textContent = `Reveal Next (${revealRemaining} remaining)`;
    revealNextBtn.disabled = revealRemaining === 0;
  }

  showBtn.onclick = async () => {
    const m = await import('../broadcast.js');
    m.sendSectionComplete(sec.section_name, standings);
    ctx.showToast('Section results sent to audience display', 'success');

    // Swap to reveal controls
    showBtn.style.display = 'none';
    revealNextBtn.style.display = '';
    revealAllBtn.style.display = '';
    updateRevealNextLabel();
  };

  revealNextBtn.onclick = async () => {
    const m = await import('../broadcast.js');
    m.sendRevealNext();
    revealRemaining--;
    updateRevealNextLabel();
    if (revealRemaining === 0) {
      revealNextBtn.style.display = 'none';
      revealAllBtn.style.display = 'none';
    }
  };

  revealAllBtn.onclick = async () => {
    const m = await import('../broadcast.js');
    m.sendRevealAll();
    revealRemaining = 0;
    revealNextBtn.style.display = 'none';
    revealAllBtn.style.display = 'none';
  };

  actions.appendChild(showBtn);
  actions.appendChild(revealNextBtn);
  actions.appendChild(revealAllBtn);

  container.appendChild(actions);
}

// ─── Helpers ─────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  return (ms / 1000).toFixed(3) + 's';
}
