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
      <div class="audience-logo">${esc(eventName)}</div>
      <p class="audience-subtitle">Get ready to race!</p>
    </div>
  `;
}

// ─── Staging ─────────────────────────────────────────────────────

export function renderStaging(container, sectionName, heatNumber, lanes, nextHeat) {
  const sortedLanes = [...lanes].sort((a, b) => a.lane - b.lane);

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
    const nextLanes = [...nextHeat.lanes].sort((a, b) => a.lane - b.lane);
    let nextRows = '';
    for (const lane of nextLanes) {
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
        <thead><tr>
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          <th class="audience-th-time">Time</th>
        </tr></thead>
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
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          <th class="audience-th-time">Avg Time</th>
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
      <tr class="audience-reveal-hidden${medalClass}" data-rank="${s.rank}">
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
          <th class="audience-th-place"></th>
          <th class="audience-th-car">Car</th>
          <th>Name</th>
          <th class="audience-th-time">Avg Time</th>
          <th>Heats</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
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
