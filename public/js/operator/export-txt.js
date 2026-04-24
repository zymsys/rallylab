/**
 * operator/export-txt.js — Plain ASCII/txt exports for RallyLab.
 * Generates fixed-width text reports suitable for printing or plain-text viewing.
 */

import { computeLeaderboard, computeLaneStats, computeCarStats } from '../scoring.js';
import { flattenStart, getCompletedStarts } from '../state-manager.js';

// ─── Helpers ────────────────────────────────────────────────────

function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  return (ms / 1000).toFixed(3) + 's';
}

function groupName(state, groupId) {
  if (!groupId) return '';
  const g = state.groups[groupId];
  return g ? g.group_name : '';
}

function safeFilename(str) {
  return (str || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function pad(str, width, align = 'left') {
  const s = String(str == null ? '' : str);
  if (s.length >= width) return s.slice(0, width);
  const filler = ' '.repeat(width - s.length);
  if (align === 'right') return filler + s;
  if (align === 'center') {
    const left = Math.floor((width - s.length) / 2);
    const right = width - s.length - left;
    return ' '.repeat(left) + s + ' '.repeat(right);
  }
  return s + filler;
}

/**
 * Render an array-of-arrays as an ASCII table with column widths auto-sized.
 * First row is treated as the header.
 * @param {Array<Array>} rows
 * @param {Array<'left'|'right'|'center'>} [aligns]
 * @returns {string}
 */
function asciiTable(rows, aligns = []) {
  if (rows.length === 0) return '';
  const colCount = rows[0].length;
  const widths = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] == null ? '' : String(row[c]);
      if (cell.length > widths[c]) widths[c] = cell.length;
    }
  }

  const sep = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const fmtRow = (row) =>
    '| ' +
    row.map((cell, c) => pad(cell, widths[c], aligns[c] || 'left')).join(' | ') +
    ' |';

  const out = [sep, fmtRow(rows[0]), sep];
  for (let i = 1; i < rows.length; i++) out.push(fmtRow(rows[i]));
  out.push(sep);
  return out.join('\n');
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Heat Export ────────────────────────────────────────────────

/**
 * Export a single heat as a plain-text report.
 *
 * @param {Object} state - full app state
 * @param {Object} section - race_day section object
 * @param {Object} start - the start object containing this heat
 * @param {number} heatNumber
 */
export function exportHeatTxt(state, section, start, heatNumber) {
  const result = (start.results || {})[heatNumber];
  if (!result) return;

  const completedStarts = getCompletedStarts(section);
  const multiStart = completedStarts.length > 1;
  const startSuffix = multiStart ? ` (Rally ${start.start_number})` : '';

  const hasGroups = section.participants.some(p => p.group_id);
  const carGroupMap = {};
  for (const p of section.participants) {
    carGroupMap[p.car_number] = p.group_id || null;
  }

  const laneCorr = (start.lane_corrections || {})[heatNumber];
  const effectiveLanes = laneCorr || result.lanes || [];
  const sortedLanes = [...effectiveLanes].sort((a, b) => a.lane - b.lane);
  const sourceLabel = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
  const rerunCount = (start.reruns || {})[heatNumber] || 0;

  const lines = [];

  // Header block
  const title = `${section.section_name}${startSuffix} — Heat ${heatNumber}`;
  lines.push(title);
  lines.push('='.repeat(title.length));
  const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
  if (rallyLine) lines.push(rallyLine);
  let meta = `Source: ${sourceLabel}`;
  if (rerunCount > 0) meta += `   Re-runs: ${rerunCount}`;
  if (result.timestamp) {
    const d = new Date(result.timestamp);
    meta += `   Recorded: ${d.toLocaleString()}`;
  }
  lines.push(meta);
  lines.push('');

  // Heat result table
  const header = ['Lane', 'Car #', 'Name'];
  const aligns = ['right', 'right', 'left'];
  if (hasGroups) { header.push('Group'); aligns.push('left'); }
  if (result.type === 'RaceCompleted') { header.push('Time'); aligns.push('right'); }
  if (result.type === 'ResultManuallyEntered') { header.push('Place'); aligns.push('right'); }

  const rows = [header];
  for (const lane of sortedLanes) {
    const row = [lane.lane, '#' + lane.car_number, lane.name];
    if (hasGroups) row.push(groupName(state, carGroupMap[lane.car_number]));
    if (result.type === 'RaceCompleted' && result.times_ms) {
      const t = result.times_ms[String(lane.lane)];
      row.push(t != null ? formatTime(t) : 'DNF');
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      const r = result.rankings.find(r => r.car_number === lane.car_number);
      row.push(r ? r.place : '—');
    }
    rows.push(row);
  }
  lines.push(asciiTable(rows, aligns));

  // Standings
  const flatSec = flattenStart(section, start);
  const standings = computeLeaderboard(flatSec);
  if (standings.length > 0) {
    lines.push('');
    lines.push('Current Standings');
    lines.push('-----------------');

    const sHeader = ['Rank', 'Car #', 'Name'];
    const sAligns = ['right', 'right', 'left'];
    if (hasGroups) { sHeader.push('Group'); sAligns.push('left'); }
    sHeader.push('Avg', 'Best', 'Heats');
    sAligns.push('right', 'right', 'right');

    const sRows = [sHeader];
    for (const s of standings) {
      const row = [s.rank, '#' + s.car_number, s.name + (s.incomplete ? ' *' : '')];
      if (hasGroups) row.push(groupName(state, s.group_id));
      row.push(formatTime(s.avg_time_ms), formatTime(s.best_time_ms), s.heats_run);
      sRows.push(row);
    }
    lines.push(asciiTable(sRows, sAligns));

    if (standings.some(s => s.incomplete)) {
      lines.push('');
      lines.push('* incomplete (fewer heats run, or removed)');
    }
  }

  lines.push('');
  const filename = `${safeFilename(section.section_name)}-heat-${heatNumber}.txt`;
  downloadText(filename, lines.join('\n'));
}

// ─── Section Export ─────────────────────────────────────────────

/**
 * Render a heat result block (label + ASCII table) into `lines`.
 * Used by exportSectionTxt.
 */
function appendHeatBlock(lines, state, section, start, hn, hasGroups, carGroupMap) {
  const result = (start.results || {})[hn];
  if (!result) return;

  const laneCorr = (start.lane_corrections || {})[hn];
  const effectiveLanes = laneCorr || result.lanes || [];
  const sortedLanes = [...effectiveLanes].sort((a, b) => a.lane - b.lane);
  const sourceLabel = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
  const rerunCount = (start.reruns || {})[hn] || 0;

  let heatLabel = `Heat ${hn} — ${sourceLabel}`;
  if (rerunCount > 0) heatLabel += ` (rerun x${rerunCount})`;
  lines.push(heatLabel);

  const header = ['Lane', 'Car #', 'Name'];
  const aligns = ['right', 'right', 'left'];
  if (hasGroups) { header.push('Group'); aligns.push('left'); }
  if (result.type === 'RaceCompleted') { header.push('Time'); aligns.push('right'); }
  if (result.type === 'ResultManuallyEntered') { header.push('Place'); aligns.push('right'); }

  const rows = [header];
  for (const lane of sortedLanes) {
    const row = [lane.lane, '#' + lane.car_number, lane.name];
    if (hasGroups) row.push(groupName(state, carGroupMap[lane.car_number]));
    if (result.type === 'RaceCompleted' && result.times_ms) {
      const t = result.times_ms[String(lane.lane)];
      row.push(t != null ? formatTime(t) : 'DNF');
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      const r = result.rankings.find(r => r.car_number === lane.car_number);
      row.push(r ? r.place : '—');
    }
    rows.push(row);
  }
  lines.push(asciiTable(rows, aligns));
  lines.push('');
}

/**
 * Export a section+start as a plain-text report: standings, lane stats,
 * heat-by-heat results, and car statistics.
 *
 * @param {Object} state - full app state
 * @param {Object} section - race_day section object
 * @param {Object} start - the start object to export
 */
export function exportSectionTxt(state, section, start) {
  const completedStarts = getCompletedStarts(section);
  const multiStart = completedStarts.length > 1;
  const startSuffix = multiStart ? ` — Rally ${start.start_number}` : '';

  const hasGroups = section.participants.some(p => p.group_id);
  const carGroupMap = {};
  for (const p of section.participants) {
    carGroupMap[p.car_number] = p.group_id || null;
  }

  const flatSec = flattenStart(section, start);
  const standings = computeLeaderboard(flatSec);
  const laneStats = computeLaneStats(flatSec);
  const carStats = computeCarStats(flatSec);
  const results = start.results || {};
  const heatNumbers = Object.keys(results).map(Number).sort((a, b) => a - b);

  const lines = [];

  // Title
  const title = `${section.section_name}${startSuffix}`;
  lines.push(title);
  lines.push('='.repeat(title.length));
  const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
  if (rallyLine) lines.push(rallyLine);
  lines.push(`${section.participants.length} participants`);
  lines.push('');

  // Standings
  if (standings.length > 0) {
    lines.push('Standings');
    lines.push('---------');
    const sHeader = ['Rank', 'Car #', 'Name'];
    const sAligns = ['right', 'right', 'left'];
    if (hasGroups) { sHeader.push('Group'); sAligns.push('left'); }
    sHeader.push('Avg', 'Best', 'Heats');
    sAligns.push('right', 'right', 'right');

    const sRows = [sHeader];
    for (const s of standings) {
      const row = [s.rank, '#' + s.car_number, s.name + (s.incomplete ? ' *' : '')];
      if (hasGroups) row.push(groupName(state, s.group_id));
      row.push(formatTime(s.avg_time_ms), formatTime(s.best_time_ms), s.heats_run);
      sRows.push(row);
    }
    lines.push(asciiTable(sRows, sAligns));
    if (standings.some(s => s.incomplete)) {
      lines.push('* Incomplete — car removed or section ended early.');
    }
    lines.push('');
  }

  // Lane stats
  if (laneStats.length > 0) {
    const overallAvg = laneStats.reduce((s, l) => s + l.avg_time_ms, 0) / laneStats.length;
    lines.push('Lane Statistics');
    lines.push('---------------');
    const lHeader = ['Lane', 'Avg', 'Races', 'vs Overall'];
    const lAligns = ['right', 'right', 'right', 'right'];
    const lRows = [lHeader];
    for (const ls of laneStats) {
      const diff = ls.avg_time_ms - overallAvg;
      const diffStr = (diff >= 0 ? '+' : '-') + formatTime(Math.abs(diff)).replace('s', '') + 's';
      lRows.push(['Lane ' + ls.lane, formatTime(ls.avg_time_ms), ls.race_count, diffStr]);
    }
    lines.push(asciiTable(lRows, lAligns));
    lines.push('');
  }

  // Heat-by-heat
  if (heatNumbers.length > 0) {
    lines.push(`Heat Results${startSuffix}`);
    lines.push('------------');
    for (const hn of heatNumbers) {
      appendHeatBlock(lines, state, section, start, hn, hasGroups, carGroupMap);
    }
  }

  // Car stats
  if (carStats.length > 0) {
    const allLanes = new Set();
    for (const c of carStats) {
      for (const lane of Object.keys(c.lane_times)) allLanes.add(Number(lane));
    }
    const sortedLanes = [...allLanes].sort((a, b) => a - b);

    lines.push(`Car Statistics${startSuffix}`);
    lines.push('--------------');
    const cHeader = ['Car #', 'Name'];
    const cAligns = ['right', 'left'];
    if (hasGroups) { cHeader.push('Group'); cAligns.push('left'); }
    cHeader.push('Heats', 'Avg', 'Best');
    cAligns.push('right', 'right', 'right');
    for (const lane of sortedLanes) { cHeader.push(`L${lane}`); cAligns.push('right'); }

    const cRows = [cHeader];
    for (const c of carStats) {
      const row = ['#' + c.car_number, c.name + (c.removed ? ' *' : '')];
      if (hasGroups) row.push(groupName(state, carGroupMap[c.car_number]));
      row.push(
        c.heats_run,
        c.avg_time_ms != null ? formatTime(c.avg_time_ms) : '—',
        c.best_time_ms != null ? formatTime(c.best_time_ms) : '—',
      );
      for (const lane of sortedLanes) {
        row.push(c.lane_times[lane] != null ? formatTime(c.lane_times[lane]) : '');
      }
      cRows.push(row);
    }
    lines.push(asciiTable(cRows, cAligns));
    lines.push('');
  }

  const startLabel = multiStart ? `-rally-${start.start_number}` : '';
  const filename = `${safeFilename(section.section_name)}${startLabel}-report.txt`;
  downloadText(filename, lines.join('\n'));
}
