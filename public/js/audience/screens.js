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

export function renderWelcome(container, eventName) {
  container.innerHTML = `
    <div class="audience-welcome">
      <div class="audience-logo">Kub Kars</div>
      <p class="audience-event-name">${esc(eventName)}</p>
      <p class="audience-subtitle">Get ready to race!</p>
    </div>
  `;
}

// ─── Staging ─────────────────────────────────────────────────────

export function renderStaging(container, sectionName, heatNumber, lanes) {
  const sortedLanes = [...lanes].sort((a, b) => a.lane - b.lane);

  let tableRows = '';
  for (const lane of sortedLanes) {
    tableRows += `
      <tr>
        <td class="audience-lane-number">Lane ${lane.lane}</td>
        <td class="audience-car-number">#${lane.car_number}</td>
        <td class="audience-name">${esc(lane.name)}</td>
      </tr>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-heat-label">Heat ${heatNumber}</div>
      </div>
      <div class="audience-staging-label">Now Staging</div>
      <table class="audience-lane-table">
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Results ─────────────────────────────────────────────────────

export function renderResults(container, sectionName, heatNumber, results) {
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
        <td class="audience-time">${r.time_ms ? formatTime(r.time_ms) : '—'}</td>
      </tr>`;
  }

  container.innerHTML = `
    <div class="audience-screen">
      <div class="audience-header">
        <h1 class="audience-section">${esc(sectionName)}</h1>
        <div class="audience-heat-label">Heat ${heatNumber} Results</div>
      </div>
      <table class="audience-results-table">
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Leaderboard ─────────────────────────────────────────────────

export function renderLeaderboard(container, sectionName, standings) {
  let tableRows = '';
  const top = standings.slice(0, 10);
  for (const s of top) {
    const medalClass = s.rank <= 3 ? ` audience-place-${s.rank}` : '';
    tableRows += `
      <tr class="${medalClass}">
        <td class="audience-place">${s.rank}</td>
        <td class="audience-car-number">#${s.car_number}</td>
        <td class="audience-name">${esc(s.name)}</td>
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
          <th></th><th></th><th></th><th>Avg Time</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

// ─── Section Complete ────────────────────────────────────────────

export function renderSectionComplete(container, sectionName, standings) {
  let tableRows = '';
  for (const s of standings) {
    const medalClass = s.rank <= 3 ? ` audience-place-${s.rank}` : '';
    tableRows += `
      <tr class="${medalClass}">
        <td class="audience-place">${s.rank}</td>
        <td class="audience-car-number">#${s.car_number}</td>
        <td class="audience-name">${esc(s.name)}</td>
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
          <th></th><th></th><th></th><th>Avg Time</th><th>Heats</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}
