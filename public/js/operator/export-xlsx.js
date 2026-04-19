/**
 * operator/export-xlsx.js — Rich Excel export for RallyLab.
 * Uses SheetJS (XLSX global, loaded from CDN in operator.html).
 *
 * Generates a multi-sheet .xlsx workbook for a section/start:
 *   Sheet 1: Standings    — full leaderboard
 *   Sheet 2: Heat Results — every heat with lane assignments and times
 *   Sheet 3: Car Stats    — per-car matrix with per-lane times
 *   Sheet 4: Lane Stats   — per-lane averages
 */

import { computeLeaderboard, computeLaneStats, computeCarStats } from '../scoring.js';
import { flattenStart } from '../state-manager.js';

// ─── Helpers ────────────────────────────────────────────────────

function fmtTime(ms) {
  if (ms == null || !isFinite(ms)) return null;
  return ms / 1000;
}

function groupName(state, groupId) {
  if (!groupId) return '';
  const g = state.groups[groupId];
  return g ? g.group_name : '';
}

function safeFilename(str) {
  return (str || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** Truncate sheet name to 31 chars (Excel limit). */
function sheetName(name) {
  return name.length > 31 ? name.slice(0, 31) : name;
}

/**
 * Set column widths on a worksheet based on content.
 * @param {Object} ws - SheetJS worksheet
 * @param {Array<Array>} aoa - array-of-arrays data (including header row)
 */
function autoWidth(ws, aoa) {
  const widths = [];
  for (const row of aoa) {
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const len = cell != null ? String(cell).length : 0;
      widths[c] = Math.max(widths[c] || 0, len);
    }
  }
  ws['!cols'] = widths.map(w => ({ wch: Math.min(w + 2, 40) }));
}

// ─── Export ─────────────────────────────────────────────────────

/**
 * Export a section+start as a multi-sheet .xlsx workbook.
 * @param {Object} state - full app state
 * @param {Object} section - race_day section object
 * @param {Object} start - the start object to export
 */
export function exportSectionXlsx(state, section, start) {
  const flatSec = flattenStart(section, start);
  const standings = computeLeaderboard(flatSec);
  const laneStats = computeLaneStats(flatSec);
  const carStats = computeCarStats(flatSec);
  const results = start.results || {};
  const heatNumbers = Object.keys(results).map(Number).sort((a, b) => a - b);

  const hasGroups = section.participants.some(p => p.group_id);
  const carGroupMap = {};
  for (const p of section.participants) {
    carGroupMap[p.car_number] = p.group_id || null;
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Standings ────────────────────────────────────────

  {
    const header = ['Rank', 'Car #', 'Name'];
    if (hasGroups) header.push('Group');
    header.push('Avg Time (s)', 'Best Time (s)', 'Heats Run', 'Complete');

    const rows = standings.map(s => {
      const row = [s.rank, s.car_number, s.name];
      if (hasGroups) row.push(groupName(state, s.group_id));
      row.push(fmtTime(s.avg_time_ms), fmtTime(s.best_time_ms), s.heats_run, !s.incomplete);
      return row;
    });

    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Standings');
  }

  // ── Sheet 2: Heat Results ─────────────────────────────────────

  if (heatNumbers.length > 0) {
    const header = ['Heat', 'Lane', 'Car #', 'Name'];
    if (hasGroups) header.push('Group');
    header.push('Time (s)', 'Place', 'Source', 'Reruns');

    const rows = [];
    for (const hn of heatNumbers) {
      const result = results[hn];
      if (!result) continue;

      const laneCorr = (start.lane_corrections || {})[hn];
      const effectiveLanes = laneCorr || result.lanes || [];
      const sortedLanes = [...effectiveLanes].sort((a, b) => a.lane - b.lane);
      const sourceLabel = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
      const rerunCount = (start.reruns || {})[hn] || 0;

      for (const lane of sortedLanes) {
        const row = [hn, lane.lane, lane.car_number, lane.name];
        if (hasGroups) row.push(groupName(state, carGroupMap[lane.car_number]));

        // Time
        if (result.type === 'RaceCompleted' && result.times_ms) {
          const t = result.times_ms[String(lane.lane)];
          row.push(fmtTime(t));
        } else {
          row.push(null);
        }

        // Place (manual rankings)
        if (result.type === 'ResultManuallyEntered' && result.rankings) {
          const r = result.rankings.find(r => r.car_number === lane.car_number);
          row.push(r ? r.place : null);
        } else {
          row.push(null);
        }

        row.push(sourceLabel, rerunCount > 0 ? rerunCount : null);
        rows.push(row);
      }
    }

    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Heat Results');
  }

  // ── Sheet 3: Car Statistics ───────────────────────────────────

  if (carStats.length > 0) {
    // Collect all lane numbers
    const allLanes = new Set();
    for (const c of carStats) {
      for (const lane of Object.keys(c.lane_times)) allLanes.add(Number(lane));
    }
    const sortedLanes = [...allLanes].sort((a, b) => a - b);

    const header = ['Car #', 'Name'];
    if (hasGroups) header.push('Group');
    header.push('Heats Run', 'Avg Time (s)', 'Best Time (s)');
    for (const lane of sortedLanes) header.push(`Lane ${lane} (s)`);

    const rows = carStats.map(c => {
      const row = [c.car_number, c.name + (c.removed ? ' *' : '')];
      if (hasGroups) row.push(groupName(state, carGroupMap[c.car_number]));
      row.push(c.heats_run, fmtTime(c.avg_time_ms), fmtTime(c.best_time_ms));
      for (const lane of sortedLanes) {
        row.push(fmtTime(c.lane_times[lane]));
      }
      return row;
    });

    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Car Statistics');
  }

  // ── Sheet 4: Lane Statistics ──────────────────────────────────

  if (laneStats.length > 0) {
    const overallAvg = laneStats.reduce((s, l) => s + l.avg_time_ms, 0) / laneStats.length;

    const header = ['Lane', 'Avg Time (s)', 'Race Count', 'vs Overall (s)'];
    const rows = laneStats.map(ls => {
      const diff = (ls.avg_time_ms - overallAvg) / 1000;
      return [ls.lane, fmtTime(ls.avg_time_ms), ls.race_count, Math.round(diff * 1000) / 1000];
    });

    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Lane Statistics');
  }

  // ── Download ──────────────────────────────────────────────────

  const filename = `${safeFilename(section.section_name)}-results.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Export an entrants list across all sections as an .xlsx workbook.
 * One sheet per section with an Arrived column for paper check-in.
 * @param {Object} state - full app state
 * @param {string[]} [sectionIds] - optional filter; defaults to all sections
 */
export function exportEntrantsXlsx(state, sectionIds) {
  const rd = state.race_day;
  const allSections = Object.values(rd.sections);
  const sections = sectionIds
    ? allSections.filter(s => sectionIds.includes(s.section_id))
    : allSections;

  const wb = XLSX.utils.book_new();
  let anyWritten = false;

  for (const section of sections) {
    if (section.participants.length === 0) continue;
    anyWritten = true;

    const hasGroups = section.participants.some(p => p.group_id);
    const sorted = [...section.participants].sort((a, b) => a.car_number - b.car_number);

    const header = ['Arrived', 'Car #', 'Name'];
    if (hasGroups) header.push('Group');

    const rows = sorted.map(p => {
      const row = ['', p.car_number, p.name];
      if (hasGroups) row.push(groupName(state, p.group_id));
      return row;
    });

    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws, aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(section.section_name));
  }

  if (!anyWritten) return;

  const filename = `${safeFilename(state.rally_name || 'rally')}-entrants.xlsx`;
  XLSX.writeFile(wb, filename);
}
