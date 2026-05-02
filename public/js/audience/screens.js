/**
 * audience/screens.js — 5 audience renderers optimized for projector display.
 * Large fonts, high contrast, dark theme.
 */

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  return (ms / 1000).toFixed(3) + 's';
}

// ─── Welcome ─────────────────────────────────────────────────────

export function renderWelcome(container, rallyName) {
  container.innerHTML = `
    <div class="audience-welcome">
      <div class="audience-logo">${esc(rallyName)}</div>
      <p class="audience-subtitle">Get ready to race!</p>
    </div>
  `;
}

// ─── Staging ─────────────────────────────────────────────────────

export function renderStaging(container, sectionName, heatNumber, lanes, nextHeat) {
  const sortedLanes = [...lanes].sort((a, b) => a.lane - b.lane);
  const nextLanesSorted = nextHeat ? [...nextHeat.lanes].sort((a, b) => a.lane - b.lane) : [];

  let currentRows = '';
  for (const lane of sortedLanes) {
    currentRows += `
      <tr>
        <td class="audience-lane-number">Lane ${lane.lane}</td>
        <td class="audience-car-number">#${lane.car_number}</td>
        <td class="audience-name">${esc(lane.name)}</td>
      </tr>`;
  }

  let nextHtml = '';
  if (nextHeat) {
    let nextRows = '';
    for (const lane of nextLanesSorted) {
      nextRows += `
        <tr>
          <td class="audience-lane-number">Lane ${lane.lane}</td>
          <td class="audience-car-number">#${lane.car_number}</td>
          <td class="audience-name">${esc(lane.name)}</td>
        </tr>`;
    }
    nextHtml = `
      <div class="audience-staging-col">
        <div class="audience-upnext-label">Up Next — Heat ${nextHeat.heat_number}</div>
        <table class="audience-lane-table">
          <tbody>${nextRows}</tbody>
        </table>
      </div>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-heat-label">Heat ${heatNumber}</div>
      </div>
      <div class="audience-staging-columns${nextHeat ? '' : ' audience-staging-single'}">
        <div class="audience-staging-col">
          <div class="audience-staging-label">Now Staging</div>
          <table class="audience-lane-table">
            <tbody>${currentRows}</tbody>
          </table>
        </div>
        ${nextHtml}
      </div>
    </div>
  `;
}

// ─── Results ─────────────────────────────────────────────────────

export function renderResults(container, sectionName, heatNumber, results) {
  const showGroup = results.some(r => r.group_name);
  let tableRows = '';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const place = r.place || (i + 1);
    const medalClass = place <= 3 ? ` audience-place-${place}` : '';
    tableRows += `
      <tr class="${medalClass}">
        <td class="audience-place">${place}</td>
        <td class="audience-car-number">#${r.car_number}</td>
        <td class="audience-name">${esc(r.name)}</td>
        ${showGroup ? `<td class="audience-group">${esc(r.group_name || '')}</td>` : ''}
        <td class="audience-time">${r.time_ms ? formatTime(r.time_ms) : 'DNF'}</td>
      </tr>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-heat-label">Heat ${heatNumber} Results</div>
      </div>
      <table class="audience-results-table">
        <thead><tr>
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          ${showGroup ? '<th>Group</th>' : ''}
          <th class="audience-th-time">Time</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Leaderboard ─────────────────────────────────────────────────

export function renderLeaderboard(container, sectionName, standings) {
  const top = standings.slice(0, 10);
  const showGroup = top.some(s => s.group_name);
  let tableRows = '';
  for (const s of top) {
    const medalClass = s.rank <= 3 ? ` audience-place-${s.rank}` : '';
    tableRows += `
      <tr class="${medalClass}">
        <td class="audience-place">${s.rank}</td>
        <td class="audience-car-number">#${s.car_number}</td>
        <td class="audience-name">${esc(s.name)}</td>
        ${showGroup ? `<td class="audience-group">${esc(s.group_name || '')}</td>` : ''}
        <td class="audience-time">${s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—'}</td>
      </tr>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-heat-label">Standings</div>
      </div>
      <table class="audience-results-table">
        <thead><tr>
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          ${showGroup ? '<th>Group</th>' : ''}
          <th class="audience-th-time">Avg Time</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Section Complete ────────────────────────────────────────────

export function renderSectionComplete(container, sectionName, standings) {
  const showGroup = standings.some(s => s.group_name);
  let tableRows = '';
  for (const s of standings) {
    const medalClass = s.rank <= 3 ? ` audience-place-${s.rank}` : '';
    tableRows += `
      <tr class="audience-reveal-hidden${medalClass}" data-rank="${s.rank}">
        <td class="audience-place">${s.rank}</td>
        <td class="audience-car-number">#${s.car_number}</td>
        <td class="audience-name">${esc(s.name)}</td>
        ${showGroup ? `<td class="audience-group">${esc(s.group_name || '')}</td>` : ''}
        <td class="audience-time">${s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—'}</td>
        <td>${s.heats_run}${s.incomplete ? ' *' : ''}</td>
      </tr>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-complete-banner">Section Complete</div>
      </div>
      <table class="audience-results-table">
        <thead><tr>
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          ${showGroup ? '<th>Group</th>' : ''}
          <th class="audience-th-time">Avg Time</th>
          <th>Heats</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Track Status Overlay ────────────────────────────────────────
//
// A persistent banner pinned to the top of the audience screen that tells
// the gate operator whether it's safe to drop the start gate. The big
// failure mode it prevents: opening the gate before all six lane sensors
// have been reset, which logs phantom finishes for the next heat.
//
// State machine, keyed on the operator's race phase:
//
//   waiting-for-gate, lanes still triggered → red "RESET LANE SENSORS"
//   waiting-for-gate, gate not closed       → amber "RESET START GATE"
//   waiting-for-gate, gate closed, clear    → green "READY — START NEXT HEAT"
//   waiting-for-race, gate still closed     → amber "WAITING FOR START GATE"
//   waiting-for-race, gate dropped          → green "RACING!" / "N of M finished"
//   any other phase                         → overlay hidden

const OVERLAY_ID = 'audience-track-overlay';

function getOrCreateOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'audience-track-overlay';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

export function clearTrackOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.hidden = true;
}

export function renderTrackOverlay(status) {
  const el = getOrCreateOverlay();
  const view = deriveOverlayView(status);
  if (!view) {
    el.hidden = true;
    return;
  }

  let lanesHtml = '';
  if (view.lanes && view.lanes.length) {
    lanesHtml = '<div class="audience-track-overlay-lanes">';
    for (const lane of view.lanes) {
      const cls = lane.triggered
        ? 'audience-track-lane audience-track-lane-bad'
        : 'audience-track-lane audience-track-lane-ok';
      lanesHtml += `<span class="${cls}">L${lane.lane}</span>`;
    }
    lanesHtml += '</div>';
  }

  el.className = `audience-track-overlay audience-track-${view.tone}`;
  el.innerHTML = `
    <div class="audience-track-overlay-headline">${esc(view.headline)}</div>
    ${view.detail ? `<div class="audience-track-overlay-detail">${esc(view.detail)}</div>` : ''}
    ${lanesHtml}
  `;
  el.hidden = false;
}

function deriveOverlayView(status) {
  const phase = status.phase;
  const active = Array.isArray(status.active_lanes) ? status.active_lanes : [];
  const triggeredSet = new Set(status.triggered_lanes || []);
  const triggered = active.filter(l => triggeredSet.has(l));
  const total = active.length;
  const lanes = active.map(l => ({ lane: l, triggered: triggeredSet.has(l) }));

  if (phase === 'waiting-for-gate') {
    if (triggered.length > 0) {
      return {
        tone: 'bad',
        headline: 'RESET LANE SENSORS',
        detail: `Lane ${triggered.join(', ')} still triggered — pull the cars before opening the gate`,
        lanes,
      };
    }
    if (status.gate_ready === false) {
      return { tone: 'warn', headline: 'RESET START GATE', detail: null, lanes };
    }
    if (status.gate_ready === true) {
      return { tone: 'ok', headline: 'READY — START NEXT HEAT', detail: null, lanes };
    }
    return null;
  }

  if (phase === 'waiting-for-race') {
    if (status.gate_ready === false) {
      if (triggered.length === 0) {
        return { tone: 'ok', headline: 'RACING!', detail: null, lanes };
      }
      if (triggered.length >= total && total > 0) {
        return { tone: 'ok', headline: 'RACE FINISHED', detail: null, lanes };
      }
      return {
        tone: 'ok',
        headline: `${triggered.length} OF ${total} LANES FINISHED`,
        detail: null,
        lanes,
      };
    }
    return { tone: 'warn', headline: 'WAITING FOR START GATE', detail: null, lanes };
  }

  return null;
}

/**
 * Reveal the next hidden row (last place first → first place last).
 * Returns the number of rows still hidden after this reveal.
 */
export function revealNext() {
  const hidden = document.querySelectorAll('.audience-reveal-hidden');
  if (hidden.length === 0) return 0;

  // Last hidden row = highest rank number = last place among remaining
  const row = hidden[hidden.length - 1];
  row.classList.remove('audience-reveal-hidden');

  const rank = parseInt(row.dataset.rank, 10);
  if (rank <= 3) {
    row.classList.add('audience-reveal-medal');
  } else {
    row.classList.add('audience-reveal-show');
  }

  return hidden.length - 1;
}

/**
 * Reveal all remaining hidden rows with a staggered cascade (60ms per row).
 */
export function revealAll() {
  const hidden = [...document.querySelectorAll('.audience-reveal-hidden')];
  if (hidden.length === 0) return;

  // Reveal from last place (end of list) to first place (start of list)
  const reversed = [...hidden].reverse();
  reversed.forEach((row, i) => {
    setTimeout(() => {
      row.classList.remove('audience-reveal-hidden');
      const rank = parseInt(row.dataset.rank, 10);
      if (rank <= 3) {
        row.classList.add('audience-reveal-medal');
      } else {
        row.classList.add('audience-reveal-show');
      }
    }, i * 60);
  });
}
