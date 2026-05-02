/**
 * operator/screens.js — 5 operator screen renderers.
 * Screen A: Rally List, Screen B: Rally Home, Screen C: Check-In,
 * Screen D: Live Console, Screen E: Section Complete.
 */

import { computeLeaderboard, computeLaneStats } from '../scoring.js';
import { deriveRaceDayPhase, getAcceptedResult, getActiveStart, getLatestStart, getStart, getCompletedStarts, flattenStart, compareCarNumbers } from '../state-manager.js';
import { showManualRankDialog, showRemoveCarDialog, showLoadRosterDialog, showCorrectLanesDialog, showStartSectionDialog, showChangeLanesDialog, showRestoreFromUSBDialog, showTrackManagerDialog, showCarStatsDialog, showRallyReportDialog, showSectionReportDialog, showGroupReportsDialog } from './dialogs.js';
import { generateHeatReport, generateEntrantsReport } from './report.js';
import { exportSectionXlsx, exportEntrantsXlsx, exportHeatXlsx } from './export-xlsx.js';
import { exportHeatTxt, exportSectionTxt } from './export-txt.js';
import { showDemoDataDialog } from './demo-data.js';

// ─── Screen A: Rally List ────────────────────────────────────────

export function renderRallyList(container, params, ctx) {
  const { state, navigate, showToast } = ctx;
  const rd = state.race_day;
  const sections = rd.loaded ? Object.values(rd.sections) : [];

  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <h2 class="screen-title">Race Day</h2>
    <div class="toolbar-actions" id="rally-list-actions"></div>
  `;
  container.appendChild(toolbar);

  const actions = toolbar.querySelector('#rally-list-actions');

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

  if (ctx.isUSBBackupSupported()) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-secondary';
    restoreBtn.textContent = 'Restore from USB';
    restoreBtn.onclick = () => showRestoreFromUSBDialog(ctx);
    actions.appendChild(restoreBtn);
  }

  if (!rd.loaded || sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No roster loaded. Open a rally from the cloud, load a roster package, or load demo data to get started.';
    container.appendChild(empty);

    if (ctx.isCloudAvailable && ctx.isCloudAvailable()) {
      renderCloudRallyPicker(container, ctx);
    }
    return;
  }

  // Show loaded event info
  const info = document.createElement('p');
  info.className = 'info-line';
  info.textContent = `${state.rally_name || 'Rally'} — ${sections.length} section${sections.length !== 1 ? 's' : ''}`;
  container.appendChild(info);

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn-primary';
  goBtn.style.marginTop = '1rem';
  goBtn.textContent = 'Go to Rally Home';
  goBtn.onclick = () => navigate('rally-home', {});
  container.appendChild(goBtn);
}

// ─── Screen B: Rally Home ────────────────────────────────────────

export function renderRallyHome(container, params, ctx) {
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
      <h2 class="screen-title">${esc(state.rally_name || 'Rally')}</h2>
      <p class="screen-subtitle">${state.rally_date || ''}</p>
    </div>
    <div class="toolbar-actions" id="rally-home-actions"></div>
  `;
  container.appendChild(header);

  // USB Backup controls (only shown when File System Access API is available)
  if (ctx.isUSBBackupSupported()) {
    const actionsDiv = header.querySelector('#rally-home-actions');
    if (ctx.isUSBBackupConfigured()) {
      const indicator = document.createElement('span');
      indicator.className = 'status-badge status-active';
      indicator.textContent = 'USB Backup Active';
      actionsDiv.appendChild(indicator);

      const disableLink = document.createElement('button');
      disableLink.className = 'btn btn-sm btn-ghost';
      disableLink.textContent = 'Disable';
      disableLink.onclick = async () => {
        await ctx.disableUSBBackup();
        navigate('rally-home', {}, { replace: true });
        showToast('USB backup disabled', 'info');
      };
      actionsDiv.appendChild(disableLink);
    } else {
      const enableBtn = document.createElement('button');
      enableBtn.className = 'btn btn-secondary';
      enableBtn.textContent = 'Enable USB Backup';
      enableBtn.onclick = async () => {
        try {
          await ctx.configureUSBBackup();
          navigate('rally-home', {}, { replace: true });
          showToast('USB backup enabled — backup written', 'success');
        } catch (e) {
          if (e.name !== 'AbortError') {
            showToast('USB backup failed: ' + e.message, 'error');
          }
        }
      };
      actionsDiv.appendChild(enableBtn);
    }
  }

  // Track Connection controls — single clickable badge opens Track Manager
  {
    const actionsDiv = header.querySelector('#rally-home-actions');
    const trackMode = ctx.getTrackMode();

    let badgeLabel, badgeClass;
    if (trackMode === 'wifi') {
      const ip = ctx.getSavedTrackIp() || '';
      badgeLabel = `Track: ${ip}`;
      badgeClass = 'status-badge status-active';
    } else if (trackMode === 'serial') {
      badgeLabel = 'Track: USB';
      badgeClass = 'status-badge status-active';
    } else if (trackMode === 'fake') {
      badgeLabel = 'Fake Track';
      badgeClass = 'status-badge status-active';
    } else {
      badgeLabel = 'Connect Track';
      badgeClass = 'status-badge status-idle';
    }

    const badge = document.createElement('button');
    badge.className = badgeClass + ' track-badge-btn';
    badge.textContent = badgeLabel;
    badge.onclick = () => showTrackManagerDialog(ctx);
    actionsDiv.appendChild(badge);

    if (trackMode === 'manual') {
      const savedIp = ctx.getSavedTrackIp();
      if (savedIp) {
        const hint = document.createElement('span');
        hint.className = 'form-hint';
        hint.style.marginLeft = '0.5rem';
        hint.textContent = `${savedIp} (offline)`;
        actionsDiv.appendChild(hint);
      }
    }
  }

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
    const arrivedCount = sec.arrived.length;
    const totalCount = sec.participants.length;

    const activeStart = getActiveStart(sec);
    const latestStart = getLatestStart(sec);
    const completedStarts = getCompletedStarts(sec);
    const hasActiveStart = !!activeStart;

    let statusLabel, statusClass;
    if (hasActiveStart) {
      statusLabel = completedStarts.length > 0
        ? `Rally ${activeStart.start_number} In Progress`
        : 'In Progress';
      statusClass = 'status-badge status-active';
    } else if (completedStarts.length > 0) {
      statusLabel = completedStarts.length > 1
        ? `${completedStarts.length} Rallies Complete`
        : 'Complete';
      statusClass = 'status-badge status-complete';
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

    // Check In button (always available)
    const checkInBtn = document.createElement('button');
    checkInBtn.className = 'btn btn-sm btn-secondary';
    checkInBtn.textContent = 'Check In';
    checkInBtn.onclick = () => navigate('check-in', { sectionId: sec.section_id });
    actionsCell.appendChild(checkInBtn);

    // Start Section (available when no active start and >= 2 arrived)
    if (!hasActiveStart && arrivedCount >= 2) {
      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-sm btn-primary';
      startBtn.textContent = 'Start Section';
      startBtn.onclick = () => showStartSectionDialog(sec.section_id, ctx);
      actionsCell.appendChild(startBtn);
    }

    // Live Console (if a start is in progress)
    if (hasActiveStart) {
      const liveBtn = document.createElement('button');
      liveBtn.className = 'btn btn-sm btn-primary';
      liveBtn.textContent = 'Live Console';
      liveBtn.onclick = () => navigate('live-console', { sectionId: sec.section_id });
      actionsCell.appendChild(liveBtn);
    }

    // View Results (if any start is complete)
    if (completedStarts.length > 0) {
      const resultBtn = document.createElement('button');
      resultBtn.className = 'btn btn-sm btn-secondary';
      resultBtn.textContent = 'Results';
      resultBtn.onclick = () => {
        // If only one completed start, go directly; otherwise show latest
        const sn = completedStarts[completedStarts.length - 1].start_number;
        navigate('section-complete', { sectionId: sec.section_id, startNumber: sn });
      };
      actionsCell.appendChild(resultBtn);
    }

    tbody.appendChild(tr);
  }

  // Export/report buttons
  const anyParticipants = sections.some(s => s.participants.length > 0);
  const anyComplete = sections.some(s => getCompletedStarts(s).length > 0);

  if (anyParticipants) {
    const reportWrap = document.createElement('div');
    reportWrap.style.marginTop = '1.5rem';
    reportWrap.style.display = 'flex';
    reportWrap.style.gap = '0.5rem';
    reportWrap.style.flexWrap = 'wrap';

    const entrantsPdfBtn = document.createElement('button');
    entrantsPdfBtn.className = 'btn btn-secondary';
    entrantsPdfBtn.textContent = 'Entrants (PDF)';
    entrantsPdfBtn.onclick = () => generateEntrantsReport(state);
    reportWrap.appendChild(entrantsPdfBtn);

    const entrantsXlsxBtn = document.createElement('button');
    entrantsXlsxBtn.className = 'btn btn-secondary';
    entrantsXlsxBtn.textContent = 'Entrants (Excel)';
    entrantsXlsxBtn.onclick = () => exportEntrantsXlsx(state);
    reportWrap.appendChild(entrantsXlsxBtn);

    if (anyComplete) {
      const reportBtn = document.createElement('button');
      reportBtn.className = 'btn btn-secondary';
      reportBtn.textContent = 'Rally Report (PDF)';
      reportBtn.onclick = () => showRallyReportDialog(ctx);
      reportWrap.appendChild(reportBtn);

      // Group Reports — only if any participants have group_id
      const hasGroups = sections.some(s => s.participants.some(p => p.group_id));
      if (hasGroups) {
        const groupBtn = document.createElement('button');
        groupBtn.className = 'btn btn-secondary';
        groupBtn.textContent = 'Group Reports (PDF)';
        groupBtn.onclick = () => showGroupReportsDialog(ctx);
        reportWrap.appendChild(groupBtn);
      }
    }

    container.appendChild(reportWrap);
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
  const activeStart = getActiveStart(sec);
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
  header.querySelector('.back-btn').onclick = () => navigate('rally-home', {});
  container.appendChild(header);

  // Counter
  const counter = document.createElement('p');
  counter.className = 'info-line checkin-counter';
  counter.textContent = `${arrivedCount} of ${totalCount} checked in`;
  container.appendChild(counter);

  // Start button (available when no active start and >= 2 arrived)
  if (!activeStart && arrivedCount >= 2) {
    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary';
    startBtn.style.marginBottom = '1rem';
    startBtn.textContent = 'Start This Section';
    startBtn.onclick = () => showStartSectionDialog(sectionId, ctx);
    container.appendChild(startBtn);
  } else if (!activeStart && arrivedCount < 2) {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.style.marginBottom = '1rem';
    hint.textContent = 'Check in at least 2 cars to start.';
    container.appendChild(hint);
  }

  if (activeStart) {
    const notice = document.createElement('p');
    notice.className = 'info-line';
    notice.style.color = 'var(--color-warning)';
    notice.style.marginBottom = '1rem';
    notice.textContent = 'Section in progress. Late arrivals will trigger schedule regeneration.';
    container.appendChild(notice);
  }

  // Roster table with checkboxes
  const sorted = [...sec.participants].sort((a, b) => compareCarNumbers(a.car_number, b.car_number));

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const hasGroups = sorted.some(p => p.group_id);

  wrap.innerHTML = `
    <table>
      <thead><tr><th style="width:3rem"></th><th>Car #</th><th>Name</th>${hasGroups ? '<th>Group</th>' : ''}<th>Status</th></tr></thead>
      <tbody id="checkin-body"></tbody>
    </table>
  `;
  container.appendChild(wrap);

  const tbody = wrap.querySelector('#checkin-body');
  for (const p of sorted) {
    const isArrived = arrivedSet.has(p.car_number);
    const isRemoved = activeStart ? activeStart.removed.includes(p.car_number) : false;
    const tr = document.createElement('tr');
    if (isRemoved) tr.style.opacity = '0.5';

    const gName = groupName(state, p.group_id);

    // Set static cells first via innerHTML, then prepend the checkbox td
    // (innerHTML += would destroy programmatic event handlers)
    tr.innerHTML = `
      <td><strong>#${p.car_number}</strong></td>
      <td>${esc(p.name)}</td>
      ${hasGroups ? `<td>${esc(gName)}</td>` : ''}
      <td>${isRemoved ? '<span class="status-badge status-removed">Removed</span>' :
             isArrived ? '<span class="status-badge status-arrived">Arrived</span>' :
             '<span class="status-badge status-idle">Waiting</span>'}</td>
    `;

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
        if (activeStart) {
          // Late arrival — re-import handleLateArrival
          const { handleLateArrival } = await import('./app.js');
          handleLateArrival(sectionId);
        }
        // Re-navigate to refresh ctx with updated state
        navigate('check-in', params, { replace: true });
      }
    };
    checkTd.appendChild(checkbox);
    tr.prepend(checkTd);

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

  const schedule = ctx.getSchedule();
  const totalHeats = schedule ? schedule.heats.length : 0;
  const stagingHeat = ctx.getStagingHeat();
  const isStaging = stagingHeat != null;

  // Get the active or latest start for this section
  const startNumber = ctx.getStartNumber();
  const activeStart = getActiveStart(sec);
  const currentStart = startNumber ? getStart(sec, startNumber) : (activeStart || getLatestStart(sec));
  const startResults = currentStart ? (currentStart.results || {}) : {};

  // Derive current heat number from staging heat or last result
  const resultHeatNumbers = Object.keys(startResults).map(Number);
  const lastResultHeat = resultHeatNumbers.length > 0 ? Math.max(...resultHeatNumbers) : 0;
  const currentHeat = isStaging ? stagingHeat.heat_number : lastResultHeat;

  // If section is started but no schedule in memory for THIS section → show resume UI
  const isLiveForThisSection = ctx.liveSection?.sectionId === sectionId;
  const needsResume = activeStart && !activeStart.completed && (!schedule || !isLiveForThisSection);

  container.innerHTML = '';

  // Pinned header
  const header = document.createElement('div');
  header.className = 'console-header';

  const awaitingRotationEarly = ctx.isAwaitingRotationDecision();
  let stateLabel;
  if (awaitingRotationEarly) stateLabel = 'Rotation Complete';
  else if (needsResume) stateLabel = 'Paused';
  else if (isStaging) stateLabel = 'Staging';
  else if (lastResultHeat > 0) stateLabel = 'Results';
  else if (currentStart?.completed) stateLabel = 'Complete';
  else stateLabel = 'Ready';

  const activeLanes = ctx.getAvailableLanes(sectionId);
  const lanesStr = activeLanes.join(', ');

  const trackMode = ctx.getTrackMode();
  const trackBadgeLabel = trackMode === 'serial' ? 'USB Track' : trackMode === 'wifi' ? 'WiFi Track' : trackMode === 'fake' ? 'Fake Track' : 'Manual';
  const trackBadgeClass = trackMode === 'manual' ? 'status-idle' : 'status-active';

  // Track phase — what the race loop is blocking on right now
  const trackPhase = ctx.getTrackPhase();
  const phaseLabels = {
    'idle':              'Idle',
    'staging':           'Cars staging',
    'waiting-for-race':  'Waiting for race',
    'result':            'Result recorded',
    'waiting-for-gate':  'Waiting for gate',
    'rotation-decision': 'Rotation complete',
  };
  const phaseLabel = phaseLabels[trackPhase] || trackPhase;
  const phaseClass = trackPhase === 'waiting-for-race' ? 'phase-waiting'
    : trackPhase === 'waiting-for-gate' ? 'phase-waiting'
    : trackPhase === 'result' ? 'phase-result'
    : trackPhase === 'staging' ? 'phase-staging'
    : 'phase-idle';

  const sectionTitle = currentStart && sec.next_start_number > 2
    ? `${sec.section_name} — Rally ${currentStart.start_number}`
    : sec.section_name;

  header.innerHTML = `
    <div class="console-title-row">
      <h2 class="screen-title">${esc(sectionTitle)}</h2>
      <span class="status-badge ${trackBadgeClass} track-badge-btn" id="console-track-badge">${trackBadgeLabel}</span>
      <span class="console-state-label">${stateLabel}</span>
      <span class="track-phase-badge ${phaseClass}" id="track-phase-toggle">${phaseLabel}</span>
    </div>
    <p class="info-line">Heat ${currentHeat} of ${totalHeats || '?'} &middot; Lanes: ${lanesStr}</p>
  `;
  header.querySelector('#console-track-badge').onclick = () => showTrackManagerDialog(ctx);

  // Track phase log (collapsible)
  const phaseLog = ctx.getTrackPhaseLog();
  if (phaseLog.length > 0) {
    const logWrap = document.createElement('div');
    logWrap.className = 'track-phase-log';
    logWrap.hidden = true;
    logWrap.id = 'track-phase-log';

    const list = document.createElement('ol');
    list.className = 'track-phase-log-list';
    const entries = phaseLog.slice().reverse();
    for (const entry of entries) {
      const li = document.createElement('li');
      const d = new Date(entry.time);
      const ts = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const label = phaseLabels[entry.phase] || entry.phase;
      li.innerHTML = `<span class="phase-log-time">${ts}</span> <span class="phase-log-label">${esc(label)}</span>${entry.detail ? ` <span class="phase-log-detail">${esc(entry.detail)}</span>` : ''}`;
      list.appendChild(li);
    }
    logWrap.appendChild(list);
    header.appendChild(logWrap);

    header.querySelector('#track-phase-toggle').onclick = () => {
      logWrap.hidden = !logWrap.hidden;
    };
    header.querySelector('#track-phase-toggle').style.cursor = 'pointer';
  }

  container.appendChild(header);

  // Resume Racing prompt
  if (needsResume) {
    const resumeWrap = document.createElement('div');
    resumeWrap.className = 'console-resume';
    resumeWrap.style.textAlign = 'center';
    resumeWrap.style.padding = '2rem 0';

    const trackReady = trackMode === 'serial' || trackMode === 'wifi' || trackMode === 'fake';

    const hint = document.createElement('p');
    hint.className = 'info-line';
    hint.style.marginBottom = '1rem';
    if (trackReady) {
      hint.textContent = 'Track connected. Press Resume Racing to continue.';
    } else {
      hint.innerHTML = 'Race loop is not running. <a href="#" id="reconnect-link">Reconnect</a> to the track, then resume.';
      hint.querySelector('#reconnect-link').onclick = (e) => {
        e.preventDefault();
        showTrackManagerDialog(ctx);
      };
    }
    resumeWrap.appendChild(hint);

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'btn btn-primary';
    resumeBtn.textContent = trackReady ? 'Resume Racing' : 'Resume in Manual Mode';
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
    backBtn.textContent = 'Rally Home';
    backBtn.onclick = () => navigate('rally-home', {});
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
    const result = currentStart ? currentStart.results[currentHeat] || null : null;
    // Lane data: from staging heat (if staging) or from result (if showing results)
    const currentLanes = isStaging ? stagingHeat.lanes : (result?.lanes || []);

    leftPanel.innerHTML = `<h3 class="area-heading">Heat ${currentHeat}</h3>`;

    if (currentLanes.length > 0) {
      const gMap = buildGroupMap(sec, state);
      const heatHasGroups = currentLanes.some(l => gMap[l.car_number]);
      const laneTable = document.createElement('div');
      laneTable.className = 'table-wrap';
      let tableHtml = `
        <table class="lane-table">
          <thead><tr><th>Lane</th><th>Car #</th><th>Name</th>`;
      if (heatHasGroups) tableHtml += '<th>Group</th>';
      if (result && result.type === 'RaceCompleted' && result.times_ms) {
        tableHtml += '<th>Time</th>';
      }
      tableHtml += '</tr></thead><tbody>';

      const sortedLanes = [...currentLanes].sort((a, b) => a.lane - b.lane);

      for (const lane of sortedLanes) {
        let timeStr = '';
        if (result && result.type === 'RaceCompleted' && result.times_ms) {
          const t = result.times_ms[String(lane.lane)];
          timeStr = `<td>${t != null ? formatTime(t) : 'DNF'}</td>`;
        }
        tableHtml += `
          <tr>
            <td class="lane-number">Lane ${lane.lane}</td>
            <td><strong>#${lane.car_number}</strong></td>
            <td>${esc(lane.name)}</td>
            ${heatHasGroups ? `<td>${esc(gMap[lane.car_number] || '')}</td>` : ''}
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

  const flatSec = currentStart ? flattenStart(sec, currentStart) : { participants: sec.participants, arrived: sec.arrived, results: {}, removed: [], lane_corrections: {}, reruns: {} };
  const standings = computeLeaderboard(flatSec);
  const standingsHaveGroups = standings.some(s => s.group_id);
  if (standings.length > 0) {
    const sTable = document.createElement('div');
    sTable.className = 'table-wrap';
    let html = `
      <table>
        <thead><tr><th>#</th><th>Car</th><th>Name</th>${standingsHaveGroups ? '<th>Group</th>' : ''}<th>Avg Time</th></tr></thead>
        <tbody>`;
    for (const s of standings.slice(0, 10)) {
      html += `
        <tr${s.incomplete ? ' class="incomplete-row"' : ''}>
          <td>${s.rank}</td>
          <td><strong>#${s.car_number}</strong></td>
          <td>${esc(s.name)}</td>
          ${standingsHaveGroups ? `<td>${esc(groupName(state, s.group_id))}</td>` : ''}
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

  // ─── Lane Statistics ──────────────────────────────────────
  const laneStats = computeLaneStats(flatSec);
  if (laneStats.length > 0) {
    const laneSection = document.createElement('div');
    laneSection.className = 'lane-stats';

    const overallAvg = laneStats.reduce((s, l) => s + l.avg_time_ms, 0) / laneStats.length;

    let lsHtml = '<h3 class="area-heading">Lane Statistics</h3><div class="table-wrap"><table><thead><tr><th>Lane</th><th>Avg Time</th><th>Races</th><th>vs Avg</th></tr></thead><tbody>';
    for (const ls of laneStats) {
      const diff = ls.avg_time_ms - overallAvg;
      const diffStr = (diff >= 0 ? '+' : '') + formatTime(Math.abs(diff)).replace('s', '');
      const diffClass = Math.abs(diff) > 20 ? ' class="lane-outlier"' : '';
      lsHtml += `<tr>
        <td class="lane-number">Lane ${ls.lane}</td>
        <td>${formatTime(ls.avg_time_ms)}</td>
        <td>${ls.race_count}</td>
        <td${diffClass}>${diff >= 0 ? '+' : '-'}${formatTime(Math.abs(diff)).replace('s', '')}s</td>
      </tr>`;
    }
    lsHtml += '</tbody></table></div>';
    laneSection.innerHTML = lsHtml;
    container.appendChild(laneSection);
  }

  // ─── Heat History Log ───────────────────────────────────────
  // Show all past results (excluding current heat) in reverse order.
  // When awaiting rotation decision, include all heats — the current heat's
  // controls are hidden by the rotation prompt, so the history is the only
  // place to access re-run / correct-lanes for the last heat.
  const excludeHeat = awaitingRotationEarly ? null : currentHeat;
  const pastResults = Object.values(startResults)
    .filter(r => r.heat_number !== excludeHeat)
    .sort((a, b) => b.heat_number - a.heat_number);

  if (pastResults.length > 0) {
    const historySection = document.createElement('div');
    historySection.className = 'heat-history';

    const historyHeading = document.createElement('h3');
    historyHeading.className = 'area-heading';
    historyHeading.style.marginBottom = '0.75rem';
    historyHeading.textContent = 'Heat History';
    historySection.appendChild(historyHeading);

    const gMap = buildGroupMap(sec, state);
    const histHasGroups = sec.participants.some(p => p.group_id);

    for (const result of pastResults) {
      const hn = result.heat_number;
      const startReruns = currentStart ? currentStart.reruns : {};
      const startLaneCorrections = currentStart ? currentStart.lane_corrections : {};
      const rerunCount = startReruns[hn] || 0;
      const sourceType = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
      // Effective lanes: lane_corrections override result.lanes
      const effectiveLanes = startLaneCorrections[hn] || result.lanes || [];
      // Get catch_up flag from schedule if available
      const scheduleHeat = schedule?.heats.find(h => h.heat_number === hn);
      const isCatchUp = scheduleHeat?.catch_up || false;

      const details = document.createElement('details');
      details.className = 'heat-history-item';

      // Summary row
      const summary = document.createElement('summary');
      summary.className = 'heat-history-summary';
      let badges = `<span class="source-badge source-${sourceType.toLowerCase()}">${sourceType}</span>`;
      if (rerunCount > 0) {
        badges += ` <span class="status-badge status-idle">Rerun x${rerunCount}</span>`;
      }
      if (isCatchUp) {
        badges += ' <span class="status-badge status-idle">Catch-up</span>';
      }
      summary.innerHTML = `
        <span class="heat-history-label">Heat ${hn}</span>
        ${badges}
      `;
      details.appendChild(summary);

      // Expanded content: lane table + correct button
      const body = document.createElement('div');
      body.className = 'heat-history-body';

      const sortedLanes = [...effectiveLanes].sort((a, b) => a.lane - b.lane);
      let tHtml = '<div class="table-wrap"><table><thead><tr><th>Lane</th><th>Car #</th><th>Name</th>';
      if (histHasGroups) tHtml += '<th>Group</th>';
      if (result.type === 'RaceCompleted') tHtml += '<th>Time</th>';
      if (result.type === 'ResultManuallyEntered') tHtml += '<th>Place</th>';
      tHtml += '</tr></thead><tbody>';

      for (const lane of sortedLanes) {
        tHtml += `<tr>
          <td class="lane-number">Lane ${lane.lane}</td>
          <td><strong>#${lane.car_number}</strong></td>
          <td>${esc(lane.name)}</td>`;
        if (histHasGroups) {
          tHtml += `<td>${esc(gMap[lane.car_number] || '')}</td>`;
        }
        if (result.type === 'RaceCompleted') {
          const t = result.times_ms[String(lane.lane)];
          tHtml += `<td>${t != null ? formatTime(t) : 'DNF'}</td>`;
        }
        if (result.type === 'ResultManuallyEntered') {
          const r = result.rankings.find(r => r.car_number === lane.car_number);
          tHtml += `<td>${r ? r.place : '—'}</td>`;
        }
        tHtml += '</tr>';
      }
      tHtml += '</tbody></table></div>';
      body.innerHTML = tHtml;

      const btnRow = document.createElement('div');
      btnRow.style.marginTop = '0.5rem';
      btnRow.style.display = 'flex';
      btnRow.style.gap = '0.5rem';
      btnRow.style.flexWrap = 'wrap';

      const correctBtn = document.createElement('button');
      correctBtn.className = 'btn btn-sm btn-secondary';
      correctBtn.textContent = 'Correct Lanes';
      correctBtn.onclick = () => showCorrectLanesDialog(sectionId, hn, effectiveLanes, ctx);
      btnRow.appendChild(correctBtn);

      const rerunHistBtn = document.createElement('button');
      rerunHistBtn.className = 'btn btn-sm btn-secondary';
      rerunHistBtn.textContent = 'Re-Run Heat';
      rerunHistBtn.onclick = () => {
        if (confirm(`Declare a re-run for Heat ${hn}? All results for this heat will be discarded.`)) {
          ctx.declareRerun(sectionId, hn);
        }
      };
      btnRow.appendChild(rerunHistBtn);

      if (result.type === 'RaceCompleted' && result.times_ms) {
        const histDnfLanes = effectiveLanes.filter(l => result.times_ms[String(l.lane)] == null);
        if (histDnfLanes.length > 0) {
          const histDnfNames = histDnfLanes.map(l => l.name).join(', ');
          const dnfHistBtn = document.createElement('button');
          dnfHistBtn.className = 'btn btn-sm btn-primary';
          dnfHistBtn.textContent = 'Re-Run DNF';
          dnfHistBtn.title = histDnfNames;
          dnfHistBtn.onclick = () => {
            if (confirm(`Re-run DNF car(s): ${histDnfNames}?\nOther results will be kept.`)) {
              ctx.declareDnfRerun(sectionId, hn);
            }
          };
          btnRow.appendChild(dnfHistBtn);
        }
      }

      const heatPdfBtn = document.createElement('button');
      heatPdfBtn.className = 'btn btn-sm btn-secondary';
      heatPdfBtn.textContent = 'PDF';
      heatPdfBtn.onclick = () => generateHeatReport(state, sec, currentStart, hn);
      btnRow.appendChild(heatPdfBtn);

      const heatXlsxBtn = document.createElement('button');
      heatXlsxBtn.className = 'btn btn-sm btn-secondary';
      heatXlsxBtn.textContent = 'Excel';
      heatXlsxBtn.onclick = () => exportHeatXlsx(state, sec, currentStart, hn);
      btnRow.appendChild(heatXlsxBtn);

      const heatTxtBtn = document.createElement('button');
      heatTxtBtn.className = 'btn btn-sm btn-secondary';
      heatTxtBtn.textContent = 'Text';
      heatTxtBtn.onclick = () => exportHeatTxt(state, sec, currentStart, hn);
      btnRow.appendChild(heatTxtBtn);

      body.appendChild(btnRow);

      details.appendChild(body);
      historySection.appendChild(details);
    }

    container.appendChild(historySection);
  }

  // Controls row (skip when showing resume prompt)
  if (needsResume) return;

  // ─── Rotation Decision Prompt ────────────────────────────────
  const awaitingRotation = ctx.isAwaitingRotationDecision();
  if (awaitingRotation) {
    const rotationWrap = document.createElement('div');
    rotationWrap.className = 'rotation-decision';
    rotationWrap.style.textAlign = 'center';
    rotationWrap.style.padding = '2rem 0';

    const heatsCompleted = Object.keys(startResults).length;
    const laneCount = ctx.getAvailableLanes(sectionId).length;
    const rotationNum = Math.round(heatsCompleted / laneCount);

    const msg = document.createElement('p');
    msg.className = 'info-line';
    msg.style.marginBottom = '1rem';
    msg.style.fontSize = '1.1rem';
    msg.textContent = `All ${heatsCompleted} heats complete (${rotationNum} rotation${rotationNum !== 1 ? 's' : ''}). What next?`;
    rotationWrap.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '1rem';
    btnRow.style.justifyContent = 'center';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add Rotation';
    addBtn.onclick = () => {
      addBtn.disabled = true;
      addBtn.textContent = 'Generating...';
      ctx.addRotation(sectionId);
    };
    btnRow.appendChild(addBtn);

    const completeBtn = document.createElement('button');
    completeBtn.className = 'btn btn-secondary';
    completeBtn.textContent = 'Complete Section';
    completeBtn.onclick = () => {
      completeBtn.disabled = true;
      ctx.completeSection();
    };
    btnRow.appendChild(completeBtn);

    rotationWrap.appendChild(btnRow);
    container.appendChild(rotationWrap);
    return; // Don't show regular controls while awaiting decision
  }

  const controls = document.createElement('div');
  controls.className = 'console-controls';

  const usingAutomatedTrack = ctx.isUsingFakeTrack() || ctx.isUsingWifi() || ctx.isUsingSerial();

  const isResults = !isStaging && lastResultHeat > 0;

  // Run Heat button — manual fallback only (automated tracks drive the flow)
  if (!usingAutomatedTrack && currentHeat > 0 && isStaging) {
    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary';
    runBtn.textContent = 'Run Heat ' + currentHeat;
    runBtn.onclick = () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Racing...';
      ctx.triggerManualRace(stagingHeat.lanes);
    };
    controls.appendChild(runBtn);
  }

  // Next Heat button — manual fallback only (automated tracks drive the flow)
  if (!usingAutomatedTrack && currentHeat > 0 && isResults) {
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
  if (currentHeat > 0 && isResults) {
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

  // Re-Run DNF button — only when result has lanes with missing times
  if (currentHeat > 0 && isResults) {
    const lastResult = startResults[currentHeat];
    if (lastResult?.type === 'RaceCompleted' && lastResult.times_ms) {
      const dnfLanes = (lastResult.lanes || []).filter(l => lastResult.times_ms[String(l.lane)] == null);
      if (dnfLanes.length > 0) {
        const dnfNames = dnfLanes.map(l => l.name).join(', ');
        const dnfBtn = document.createElement('button');
        dnfBtn.className = 'btn btn-primary';
        dnfBtn.textContent = 'Re-Run DNF';
        dnfBtn.title = dnfNames;
        dnfBtn.onclick = () => {
          if (confirm(`Re-run DNF car(s): ${dnfNames}?\nOther results will be kept.`)) {
            ctx.declareDnfRerun(sectionId, currentHeat);
          }
        };
        controls.appendChild(dnfBtn);
      }
    }
  }

  // Correct Lanes button
  if (currentHeat > 0 && isResults) {
    const lastResult = startResults[currentHeat];
    const startLaneCorr = currentStart ? currentStart.lane_corrections : {};
    const effectiveLanes = startLaneCorr[currentHeat] || lastResult?.lanes || [];
    const correctBtn = document.createElement('button');
    correctBtn.className = 'btn btn-secondary';
    correctBtn.textContent = 'Correct Lanes';
    correctBtn.onclick = () => showCorrectLanesDialog(sectionId, currentHeat, effectiveLanes, ctx);
    controls.appendChild(correctBtn);
  }

  // Manual Rank button
  if (currentHeat > 0 && isStaging) {
    const manualBtn = document.createElement('button');
    manualBtn.className = 'btn btn-secondary';
    manualBtn.textContent = 'Manual Rank';
    manualBtn.onclick = () => showManualRankDialog(sectionId, currentHeat, stagingHeat.lanes, ctx);
    controls.appendChild(manualBtn);
  }

  // Change Lanes button
  if (currentStart && !currentStart.completed) {
    const changeLanesBtn = document.createElement('button');
    changeLanesBtn.className = 'btn btn-secondary';
    changeLanesBtn.textContent = 'Change Lanes';
    changeLanesBtn.onclick = () => showChangeLanesDialog(sectionId, sec, ctx);
    controls.appendChild(changeLanesBtn);
  }

  // Car Stats button — available once any results exist
  if (Object.keys(startResults).length > 0) {
    const statsBtn = document.createElement('button');
    statsBtn.className = 'btn btn-secondary';
    statsBtn.textContent = 'Car Stats';
    statsBtn.onclick = () => showCarStatsDialog(flatSec);
    controls.appendChild(statsBtn);
  }

  // Remove Car button
  if (currentStart && !currentStart.completed) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove Car';
    removeBtn.onclick = () => showRemoveCarDialog(sectionId, flatSec, ctx);
    controls.appendChild(removeBtn);
  }

  // End Section Early button — only when racing has started and there are results
  if (currentStart && !currentStart.completed && currentStart.started && lastResultHeat > 0) {
    const endEarlyBtn = document.createElement('button');
    endEarlyBtn.className = 'btn btn-danger';
    endEarlyBtn.textContent = 'End Section Early';
    endEarlyBtn.onclick = () => {
      const heatsCompleted = Object.keys(startResults).length;
      if (confirm(
        `End this section early?\n\n` +
        `${heatsCompleted} of ${totalHeats} heats completed. ` +
        `Final standings will be based on results so far. ` +
        `All participants will be marked incomplete.\n\n` +
        `This cannot be undone.`
      )) {
        ctx.endSectionEarly(sectionId);
      }
    };
    controls.appendChild(endEarlyBtn);
  }

  // Back to Rally Home
  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-ghost';
  backBtn.textContent = 'Rally Home';
  backBtn.onclick = () => navigate('rally-home', {});
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

  const completedStarts = getCompletedStarts(sec);
  let selectedStartNumber = params.startNumber ? Number(params.startNumber) : null;
  if (!selectedStartNumber && completedStarts.length > 0) {
    selectedStartNumber = completedStarts[completedStarts.length - 1].start_number;
  }
  const currentStart = selectedStartNumber ? getStart(sec, selectedStartNumber) : null;

  // Section title — include rally number when multiple starts exist
  const titleSuffix = completedStarts.length > 1 && currentStart
    ? ` — Rally ${currentStart.start_number}`
    : '';

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <h2 class="screen-title">${esc(sec.section_name)}${titleSuffix} — Final Results</h2>
    ${currentStart?.early_end ? '<p class="form-hint">Section ended early — standings based on completed heats.</p>' : ''}
  `;
  container.appendChild(header);

  // Start picker when multiple completed starts exist
  if (completedStarts.length > 1) {
    const pickerWrap = document.createElement('div');
    pickerWrap.style.marginBottom = '1rem';
    const rallyName = state.rally_name || 'Rally';
    for (const s of completedStarts) {
      const btn = document.createElement('button');
      btn.className = s.start_number === selectedStartNumber
        ? 'btn btn-sm btn-primary'
        : 'btn btn-sm btn-secondary';
      btn.textContent = `${rallyName} ${s.start_number}`;
      btn.style.marginRight = '0.5rem';
      btn.onclick = () => navigate('section-complete', { sectionId, startNumber: s.start_number }, { replace: true });
      pickerWrap.appendChild(btn);
    }
    container.appendChild(pickerWrap);
  }

  const flatSec = currentStart ? flattenStart(sec, currentStart) : { participants: sec.participants, arrived: sec.arrived, results: {}, removed: [], lane_corrections: {}, reruns: {} };
  const standings = computeLeaderboard(flatSec);
  const resultsHaveGroups = standings.some(s => s.group_id);

  if (standings.length > 0) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    let html = `
      <table>
        <thead><tr>
          <th>Rank</th><th>Car #</th><th>Name</th>${resultsHaveGroups ? '<th>Group</th>' : ''}<th>Avg Time</th><th>Best Time</th><th>Heats</th>
        </tr></thead>
        <tbody>`;
    for (const s of standings) {
      html += `
        <tr${s.incomplete ? ' class="incomplete-row"' : ''}>
          <td><strong>${s.rank}</strong></td>
          <td>#${s.car_number}</td>
          <td>${esc(s.name)}</td>
          ${resultsHaveGroups ? `<td>${esc(groupName(state, s.group_id))}</td>` : ''}
          <td>${s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—'}</td>
          <td>${s.best_time_ms != null ? formatTime(s.best_time_ms) : '—'}</td>
          <td>${s.heats_run}${s.incomplete ? ' *' : ''}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    container.appendChild(wrap);

    if (standings.some(s => s.incomplete)) {
      const legend = document.createElement('p');
      legend.className = 'form-hint';
      legend.style.marginTop = '0.75rem';
      legend.textContent = currentStart?.early_end
        ? '* Incomplete — section ended before all heats were run.'
        : '* Incomplete — car was removed before finishing all heats.';
      container.appendChild(legend);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'toolbar-actions';
  actions.style.marginTop = '1.5rem';

  const homeBtn = document.createElement('button');
  homeBtn.className = 'btn btn-secondary';
  homeBtn.textContent = 'Return to Rally Home';

  homeBtn.onclick = () => navigate('rally-home', {});
  actions.appendChild(homeBtn);

  if (standings.length > 0) {
    const xlsxBtn = document.createElement('button');
    xlsxBtn.className = 'btn btn-secondary';
    xlsxBtn.textContent = 'Export Excel';
    xlsxBtn.onclick = () => exportSectionXlsx(state, sec, currentStart);
    actions.appendChild(xlsxBtn);

    const pdfBtn = document.createElement('button');
    pdfBtn.className = 'btn btn-secondary';
    pdfBtn.textContent = 'Export PDF';
    pdfBtn.onclick = () => showSectionReportDialog(sec, ctx);
    actions.appendChild(pdfBtn);

    const txtBtn = document.createElement('button');
    txtBtn.className = 'btn btn-secondary';
    txtBtn.textContent = 'Export Text';
    txtBtn.onclick = () => exportSectionTxt(state, sec, currentStart);
    actions.appendChild(txtBtn);
  }

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
    const { withGroupNames } = await import('./app.js');
    const displayName = completedStarts.length > 1 && currentStart
      ? `${sec.section_name} — ${state.rally_name || 'Rally'} ${currentStart.start_number}`
      : sec.section_name;
    m.sendSectionComplete(displayName, withGroupNames(sec, standings));
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

/** Look up group name for a participant's group_id. Returns '' if no group. */
function groupName(state, groupId) {
  if (!groupId) return '';
  const g = state.groups[groupId];
  return g ? g.group_name : '';
}

/** Build car_number → group_name map for a section's participants. */
function buildGroupMap(sec, state) {
  const map = {};
  for (const p of sec.participants) {
    map[p.car_number] = groupName(state, p.group_id);
  }
  return map;
}

/**
 * Render the cloud rally picker. Lists rallies the signed-in user can access
 * via Supabase; clicking one bootstraps it into IndexedDB and navigates home.
 */
async function renderCloudRallyPicker(container, ctx) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '1.5rem';
  wrap.innerHTML = `<h3 class="screen-subtitle" style="margin-bottom:0.5rem">Open from cloud</h3><p class="info-line" id="cloud-status">Loading…</p>`;
  container.appendChild(wrap);

  let rallies = [];
  try {
    const { listAccessibleRallies } = await import('../pre-race/commands.js');
    rallies = await listAccessibleRallies();
  } catch (e) {
    wrap.querySelector('#cloud-status').textContent = `Couldn't load cloud rallies: ${e.message}`;
    return;
  }

  if (rallies.length === 0) {
    wrap.querySelector('#cloud-status').textContent = 'No cloud rallies available for your account.';
    return;
  }

  wrap.querySelector('#cloud-status').remove();

  const list = document.createElement('div');
  list.className = 'table-wrap';
  list.innerHTML = `<table><thead><tr><th>Rally</th><th>Date</th><th></th></tr></thead><tbody></tbody></table>`;
  const tbody = list.querySelector('tbody');
  for (const r of rallies) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${esc(r.rally_name)}</strong></td><td>${esc(r.rally_date || '')}</td><td class="table-actions"></td>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-primary';
    btn.textContent = 'Open';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        await ctx.openCloudRally(r.rally_id);
      } catch (e) {
        ctx.showToast(`Open failed: ${e.message}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Open';
      }
    };
    tr.querySelector('.table-actions').appendChild(btn);
    tbody.appendChild(tr);
  }
  wrap.appendChild(list);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  return (ms / 1000).toFixed(3) + 's';
}

