/**
 * operator/report.js — PDF report generation for RallyLab.
 * Uses jsPDF + jspdf-autotable (loaded from CDN in operator.html).
 *
 * Three report types:
 *   - Rally report:   all sections in the rally
 *   - Section report: one section, one or all starts
 *   - Heat report:    a single heat's details
 */

import { computeLeaderboard, computeLaneStats, computeCarStats } from '../scoring.js';
import { getCompletedStarts, getStart, flattenStart } from '../state-manager.js';

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

function makePdf(orientation = 'portrait') {
  return new window.jspdf.jsPDF({ orientation, unit: 'pt', format: 'letter' });
}

function addPageFooter(doc, rallyName) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`${rallyName}`, 40, ph - 20);
    doc.text(`Page ${i} of ${pageCount}`, pw - 40, ph - 20, { align: 'right' });
  }
}

function downloadPdf(doc, filename) {
  doc.save(filename);
}

/**
 * Render a leaderboard standings table using autoTable.
 * @returns {number} The final Y position after the table.
 */
function renderStandingsTable(doc, standings, state, startY, options = {}) {
  const hasGroups = standings.some(s => s.group_id);
  const compact = options.compact || false;

  const columns = [
    { header: 'Rank', dataKey: 'rank' },
    { header: 'Car #', dataKey: 'car' },
    { header: 'Name', dataKey: 'name' },
  ];
  if (hasGroups) columns.push({ header: 'Group', dataKey: 'group' });
  columns.push(
    { header: 'Avg Time', dataKey: 'avg' },
    { header: 'Best Time', dataKey: 'best' },
    { header: 'Heats', dataKey: 'heats' },
  );

  const rows = standings.map(s => ({
    rank: s.rank,
    car: '#' + s.car_number,
    name: s.name + (s.incomplete ? ' *' : ''),
    group: groupName(state, s.group_id),
    avg: s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—',
    best: s.best_time_ms != null ? formatTime(s.best_time_ms) : '—',
    heats: s.heats_run,
  }));

  doc.autoTable({
    startY,
    columns,
    body: rows,
    theme: 'grid',
    styles: { fontSize: compact ? 8 : 9, cellPadding: compact ? 2 : 3 },
    headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 40, right: 40 },
  });

  return doc.lastAutoTable.finalY;
}

/**
 * Render a lane statistics table.
 * @returns {number} The final Y position after the table.
 */
function renderLaneStatsTable(doc, laneStats, startY) {
  if (laneStats.length === 0) return startY;

  const overallAvg = laneStats.reduce((s, l) => s + l.avg_time_ms, 0) / laneStats.length;

  const columns = [
    { header: 'Lane', dataKey: 'lane' },
    { header: 'Avg Time', dataKey: 'avg' },
    { header: 'Races', dataKey: 'count' },
    { header: 'vs Overall', dataKey: 'diff' },
  ];

  const rows = laneStats.map(ls => {
    const diff = ls.avg_time_ms - overallAvg;
    return {
      lane: 'Lane ' + ls.lane,
      avg: formatTime(ls.avg_time_ms),
      count: ls.race_count,
      diff: (diff >= 0 ? '+' : '-') + formatTime(Math.abs(diff)).replace('s', '') + 's',
    };
  });

  doc.autoTable({
    startY,
    columns,
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 40, right: 40 },
    tableWidth: 'wrap',
  });

  return doc.lastAutoTable.finalY;
}

/**
 * Render a heat result table.
 * @returns {number} The final Y position after the table.
 */
function renderHeatTable(doc, result, state, section, startY) {
  const heatLanes = result.lanes || [];
  if (heatLanes.length === 0) return startY;

  const hasGroups = section.participants.some(p => p.group_id);
  const gMap = {};
  for (const p of section.participants) {
    gMap[p.car_number] = groupName(state, p.group_id);
  }

  const columns = [
    { header: 'Lane', dataKey: 'lane' },
    { header: 'Car #', dataKey: 'car' },
    { header: 'Name', dataKey: 'name' },
  ];
  if (hasGroups) columns.push({ header: 'Group', dataKey: 'group' });

  if (result.type === 'RaceCompleted') {
    columns.push({ header: 'Time', dataKey: 'time' });
  } else if (result.type === 'ResultManuallyEntered') {
    columns.push({ header: 'Place', dataKey: 'place' });
  }

  const sortedLanes = [...heatLanes].sort((a, b) => a.lane - b.lane);

  const rows = sortedLanes.map(lane => {
    const row = {
      lane: 'Lane ' + lane.lane,
      car: '#' + lane.car_number,
      name: lane.name,
      group: gMap[lane.car_number] || '',
    };
    if (result.type === 'RaceCompleted' && result.times_ms) {
      const t = result.times_ms[String(lane.lane)];
      row.time = t != null ? formatTime(t) : 'DNF';
    } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
      const r = result.rankings.find(r => r.car_number === lane.car_number);
      row.place = r ? r.place : '—';
    }
    return row;
  });

  doc.autoTable({
    startY,
    columns,
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 40, right: 40 },
    tableWidth: 'wrap',
  });

  return doc.lastAutoTable.finalY;
}

// ─── Section Heading ────────────────────────────────────────────

function renderSectionHeading(doc, title, subtitle, startY) {
  doc.setFontSize(14);
  doc.setTextColor(30);
  doc.text(title, 40, startY);
  let y = startY + 4;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(subtitle, 40, y + 12);
    y += 12;
  }
  return y + 14;
}

// ─── Rally Report ───────────────────────────────────────────────

/**
 * Generate a full rally report covering all sections.
 * @param {Object} state - full app state
 * @param {Object} [options]
 * @param {Array<{sectionId: string, startNumbers: number[]}>} [options.sectionStarts] - which starts per section
 */
export function generateRallyReport(state, options = {}) {
  const doc = makePdf('portrait');
  const pw = doc.internal.pageSize.getWidth();
  const rd = state.race_day;
  const sections = Object.values(rd.sections);

  // Title page
  doc.setFontSize(24);
  doc.setTextColor(30);
  doc.text(state.rally_name || 'Rally', pw / 2, 80, { align: 'center' });

  if (state.rally_date) {
    doc.setFontSize(12);
    doc.setTextColor(80);
    doc.text(state.rally_date, pw / 2, 105, { align: 'center' });
  }

  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text('Race Report', pw / 2, 125, { align: 'center' });

  // Summary stats
  let totalParticipants = 0;
  let totalHeats = 0;
  for (const sec of sections) {
    totalParticipants += sec.participants.length;
    const completed = getCompletedStarts(sec);
    for (const s of completed) {
      totalHeats += Object.keys(s.results || {}).length;
    }
  }

  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(`${sections.length} section${sections.length !== 1 ? 's' : ''} · ${totalParticipants} participants · ${totalHeats} heats`, pw / 2, 150, { align: 'center' });

  // Each section
  for (const sec of sections) {
    const completedStarts = getCompletedStarts(sec);
    if (completedStarts.length === 0) continue;

    // Determine which starts to include
    const requestedStarts = options.sectionStarts
      ?.find(ss => ss.sectionId === sec.section_id)?.startNumbers;

    const startsToReport = requestedStarts
      ? completedStarts.filter(s => requestedStarts.includes(s.start_number))
      : completedStarts;

    for (const start of startsToReport) {
      doc.addPage();

      const titleSuffix = completedStarts.length > 1 ? ` — Rally ${start.start_number}` : '';
      let y = renderSectionHeading(doc, sec.section_name + titleSuffix, null, 50);

      const flatSec = flattenStart(sec, start);
      const standings = computeLeaderboard(flatSec);

      if (standings.length > 0) {
        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text('Standings', 40, y);
        y = renderStandingsTable(doc, standings, state, y + 6);

        if (standings.some(s => s.incomplete)) {
          doc.setFontSize(7);
          doc.setTextColor(120);
          doc.text('* Incomplete — car removed or section ended early.', 40, y + 10);
          y += 16;
        }
      }

      // Lane stats
      const laneStats = computeLaneStats(flatSec);
      if (laneStats.length > 0) {
        y += 14;
        if (y > 680) { doc.addPage(); y = 50; }
        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text('Lane Statistics', 40, y);
        y = renderLaneStatsTable(doc, laneStats, y + 6);
      }
    }
  }

  addPageFooter(doc, state.rally_name || 'Rally');
  downloadPdf(doc, `${safeFilename(state.rally_name)}-rally-report.pdf`);
}

// ─── Section Report ─────────────────────────────────────────────

/**
 * Generate a detailed section report.
 * @param {Object} state - full app state
 * @param {Object} section - race_day section object
 * @param {number[]} startNumbers - which starts to include
 */
export function generateSectionReport(state, section, startNumbers) {
  const doc = makePdf('portrait');
  const pw = doc.internal.pageSize.getWidth();
  const completedStarts = getCompletedStarts(section);
  const multiStart = completedStarts.length > 1;

  // Title
  doc.setFontSize(20);
  doc.setTextColor(30);
  doc.text(section.section_name, pw / 2, 50, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(80);
  const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
  if (rallyLine) doc.text(rallyLine, pw / 2, 70, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${section.participants.length} participants`, pw / 2, 88, { align: 'center' });

  const startsToReport = startNumbers
    ? completedStarts.filter(s => startNumbers.includes(s.start_number))
    : completedStarts;

  let isFirstStart = true;
  for (const start of startsToReport) {
    const titleSuffix = multiStart ? ` — Rally ${start.start_number}` : '';
    const flatSec = flattenStart(section, start);
    const standings = computeLeaderboard(flatSec);
    const laneStats = computeLaneStats(flatSec);
    const results = start.results || {};
    const heatNumbers = Object.keys(results).map(Number).sort((a, b) => a - b);

    let y;
    if (isFirstStart) {
      y = 105;
      isFirstStart = false;
    } else {
      doc.addPage();
      y = 50;
    }

    // Standings
    if (standings.length > 0) {
      y = renderSectionHeading(doc, 'Standings' + titleSuffix, null, y);
      y = renderStandingsTable(doc, standings, state, y);

      if (standings.some(s => s.incomplete)) {
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('* Incomplete — car removed or section ended early.', 40, y + 10);
        y += 16;
      }
    }

    // Lane stats
    if (laneStats.length > 0) {
      y += 14;
      if (y > 680) { doc.addPage(); y = 50; }
      y = renderSectionHeading(doc, 'Lane Statistics', null, y);
      y = renderLaneStatsTable(doc, laneStats, y);
    }

    // Heat-by-heat results
    if (heatNumbers.length > 0) {
      doc.addPage();
      let hy = 50;
      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.text('Heat Results' + titleSuffix, 40, hy);
      hy += 20;

      for (const hn of heatNumbers) {
        const result = results[hn];
        if (!result) continue;

        if (hy > 660) { doc.addPage(); hy = 50; }

        const sourceLabel = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
        const rerunCount = (start.reruns || {})[hn] || 0;
        let heatLabel = `Heat ${hn}`;
        if (rerunCount > 0) heatLabel += ` (rerun x${rerunCount})`;
        heatLabel += ` — ${sourceLabel}`;

        doc.setFontSize(9);
        doc.setTextColor(50);
        doc.text(heatLabel, 40, hy);
        hy += 4;

        hy = renderHeatTable(doc, result, state, section, hy);
        hy += 10;
      }
    }

    // Car statistics
    const carStats = computeCarStats(flatSec);
    if (carStats.length > 0) {
      doc.addPage();
      let cy = 50;
      cy = renderSectionHeading(doc, 'Car Statistics' + titleSuffix, null, cy);

      const hasGroups = section.participants.some(p => p.group_id);
      const columns = [
        { header: 'Car #', dataKey: 'car' },
        { header: 'Name', dataKey: 'name' },
      ];
      if (hasGroups) columns.push({ header: 'Group', dataKey: 'group' });
      columns.push(
        { header: 'Heats', dataKey: 'heats' },
        { header: 'Avg Time', dataKey: 'avg' },
        { header: 'Best Time', dataKey: 'best' },
      );

      // Add lane columns dynamically
      const allLanes = new Set();
      for (const c of carStats) {
        for (const lane of Object.keys(c.lane_times)) allLanes.add(Number(lane));
      }
      const sortedLanes = [...allLanes].sort((a, b) => a - b);
      for (const lane of sortedLanes) {
        columns.push({ header: `L${lane}`, dataKey: `lane_${lane}` });
      }

      // Build car_number → group_id lookup from participants
      const carGroupMap = {};
      for (const p of section.participants) {
        carGroupMap[p.car_number] = p.group_id || null;
      }

      const rows = carStats.map(c => {
        const row = {
          car: '#' + c.car_number,
          name: c.name + (c.removed ? ' *' : ''),
          group: groupName(state, carGroupMap[c.car_number]),
          heats: c.heats_run,
          avg: c.avg_time_ms != null ? formatTime(c.avg_time_ms) : '—',
          best: c.best_time_ms != null ? formatTime(c.best_time_ms) : '—',
        };
        for (const lane of sortedLanes) {
          row[`lane_${lane}`] = c.lane_times[lane] != null ? formatTime(c.lane_times[lane]) : '';
        }
        return row;
      });

      doc.autoTable({
        startY: cy,
        columns,
        body: rows,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 250] },
        margin: { left: 40, right: 40 },
      });
    }
  }

  addPageFooter(doc, state.rally_name || 'Rally');
  const startLabel = startNumbers && multiStart
    ? `-rally-${startNumbers.join('-')}`
    : '';
  downloadPdf(doc, `${safeFilename(section.section_name)}${startLabel}-report.pdf`);
}

// ─── Entrants List ──────────────────────────────────────────────

/**
 * Generate a printable entrants list across all sections.
 * Each section on its own page with a check-in checkbox column.
 * @param {Object} state - full app state
 * @param {string[]} [sectionIds] - optional filter; defaults to all sections
 */
export function generateEntrantsReport(state, sectionIds) {
  const doc = makePdf('portrait');
  const pw = doc.internal.pageSize.getWidth();
  const rd = state.race_day;
  const allSections = Object.values(rd.sections);
  const sections = sectionIds
    ? allSections.filter(s => sectionIds.includes(s.section_id))
    : allSections;

  if (sections.length === 0) return;

  let isFirst = true;
  let totalParticipants = 0;

  for (const sec of sections) {
    if (sec.participants.length === 0) continue;
    totalParticipants += sec.participants.length;

    if (!isFirst) doc.addPage();
    isFirst = false;

    // Section title
    doc.setFontSize(20);
    doc.setTextColor(30);
    doc.text(sec.section_name, pw / 2, 50, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(80);
    const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
    if (rallyLine) doc.text(rallyLine, pw / 2, 70, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Entrants — ${sec.participants.length} registered`, pw / 2, 88, { align: 'center' });

    const hasGroups = sec.participants.some(p => p.group_id);
    const sorted = [...sec.participants].sort((a, b) => a.car_number - b.car_number);

    const columns = [
      { header: 'Arrived', dataKey: 'arrived' },
      { header: 'Car #', dataKey: 'car' },
      { header: 'Name', dataKey: 'name' },
    ];
    if (hasGroups) columns.push({ header: 'Group', dataKey: 'group' });

    const rows = sorted.map(p => ({
      arrived: '',
      car: '#' + p.car_number,
      name: p.name,
      group: groupName(state, p.group_id),
    }));

    doc.autoTable({
      startY: 105,
      columns,
      body: rows,
      theme: 'grid',
      styles: { fontSize: 11, cellPadding: 6 },
      headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] },
      columnStyles: { arrived: { cellWidth: 60, halign: 'center' } },
      margin: { left: 40, right: 40 },
    });
  }

  if (totalParticipants === 0) return;

  addPageFooter(doc, state.rally_name || 'Rally');
  downloadPdf(doc, `${safeFilename(state.rally_name || 'rally')}-entrants.pdf`);
}

// ─── Heat Report ────────────────────────────────────────────────

/**
 * Generate a single-heat report.
 * @param {Object} state - full app state
 * @param {Object} section - race_day section object
 * @param {Object} start - the start object containing this heat
 * @param {number} heatNumber
 */
export function generateHeatReport(state, section, start, heatNumber) {
  const doc = makePdf('portrait');
  const pw = doc.internal.pageSize.getWidth();

  const result = (start.results || {})[heatNumber];
  if (!result) return;

  const completedStarts = getCompletedStarts(section);
  const multiStart = completedStarts.length > 1;
  const titleSuffix = multiStart ? ` — Rally ${start.start_number}` : '';

  // Header
  doc.setFontSize(18);
  doc.setTextColor(30);
  doc.text(`${section.section_name}${titleSuffix}`, pw / 2, 50, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(50);
  doc.text(`Heat ${heatNumber}`, pw / 2, 72, { align: 'center' });

  const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
  if (rallyLine) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(rallyLine, pw / 2, 90, { align: 'center' });
  }

  // Metadata
  let y = 110;
  const sourceLabel = result.type === 'RaceCompleted' ? 'Timed' : 'Manual';
  const rerunCount = (start.reruns || {})[heatNumber] || 0;
  let meta = `Source: ${sourceLabel}`;
  if (rerunCount > 0) meta += ` · Re-runs: ${rerunCount}`;
  if (result.timestamp) {
    const d = new Date(result.timestamp);
    meta += ` · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(meta, 40, y);
  y += 16;

  // Heat result table
  y = renderHeatTable(doc, result, state, section, y);

  // Current leaderboard snapshot (after this heat)
  const flatSec = flattenStart(section, start);
  const standings = computeLeaderboard(flatSec);
  if (standings.length > 0) {
    y += 20;
    if (y > 660) { doc.addPage(); y = 50; }
    y = renderSectionHeading(doc, 'Current Standings', null, y);
    y = renderStandingsTable(doc, standings, state, y, { compact: true });
  }

  addPageFooter(doc, state.rally_name || 'Rally');
  downloadPdf(doc, `${safeFilename(section.section_name)}-heat-${heatNumber}.pdf`);
}

// ─── Group Report ───────────────────────────────────────────────

/**
 * Generate a report for a single group across all (or selected) sections.
 * Shows where the group's participants placed in overall standings, plus
 * their individual heat times — suitable for handing to the group's scouter.
 *
 * @param {Object} state - full app state
 * @param {string} groupId - the group to report on
 * @param {number[]|null} startNumbers - per-section start filter (null = all)
 */
export function generateGroupReport(state, groupId, startNumbers) {
  const group = state.groups[groupId];
  if (!group) return;

  const doc = makePdf('portrait');
  const pw = doc.internal.pageSize.getWidth();
  const rd = state.race_day;

  // Title
  doc.setFontSize(20);
  doc.setTextColor(30);
  doc.text(group.group_name, pw / 2, 50, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(80);
  const rallyLine = [state.rally_name, state.rally_date].filter(Boolean).join(' — ');
  if (rallyLine) doc.text(rallyLine, pw / 2, 70, { align: 'center' });

  // Collect sections that have participants from this group
  const sections = Object.values(rd.sections);
  const groupCarNumbers = new Set();
  for (const sec of sections) {
    for (const p of sec.participants) {
      if (p.group_id === groupId) groupCarNumbers.add(p.car_number);
    }
  }

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${groupCarNumbers.size} participant${groupCarNumbers.size !== 1 ? 's' : ''}`, pw / 2, 88, { align: 'center' });

  let isFirstSection = true;

  for (const sec of sections) {
    const groupParticipants = sec.participants.filter(p => p.group_id === groupId);
    if (groupParticipants.length === 0) continue;

    const completedStarts = getCompletedStarts(sec);
    if (completedStarts.length === 0) continue;

    const multiStart = completedStarts.length > 1;
    const startsToReport = startNumbers
      ? completedStarts.filter(s => startNumbers.includes(s.start_number))
      : completedStarts;

    for (const start of startsToReport) {
      const titleSuffix = multiStart ? ` — Rally ${start.start_number}` : '';
      const flatSec = flattenStart(sec, start);
      const allStandings = computeLeaderboard(flatSec);
      const groupCarSet = new Set(groupParticipants.map(p => p.car_number));

      // Filter standings to this group's cars, keeping overall rank
      const groupStandings = allStandings.filter(s => groupCarSet.has(s.car_number));
      if (groupStandings.length === 0) continue;

      let y;
      if (isFirstSection) {
        y = 105;
        isFirstSection = false;
      } else {
        doc.addPage();
        y = 50;
      }

      // Section heading
      y = renderSectionHeading(doc, sec.section_name + titleSuffix,
        `${allStandings.length} cars in section · ${groupStandings.length} from ${group.group_name}`, y);

      // Group standings (overall rank preserved)
      const columns = [
        { header: 'Overall Rank', dataKey: 'rank' },
        { header: 'Car #', dataKey: 'car' },
        { header: 'Name', dataKey: 'name' },
        { header: 'Group', dataKey: 'group' },
        { header: 'Avg Time', dataKey: 'avg' },
        { header: 'Best Time', dataKey: 'best' },
        { header: 'Heats', dataKey: 'heats' },
      ];

      const rows = groupStandings.map(s => ({
        rank: `${s.rank} of ${allStandings.length}`,
        car: '#' + s.car_number,
        name: s.name + (s.incomplete ? ' *' : ''),
        group: groupName(state, s.group_id),
        avg: s.avg_time_ms != null ? formatTime(s.avg_time_ms) : '—',
        best: s.best_time_ms != null ? formatTime(s.best_time_ms) : '—',
        heats: s.heats_run,
      }));

      doc.autoTable({
        startY: y,
        columns,
        body: rows,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 250] },
        margin: { left: 40, right: 40 },
      });
      y = doc.lastAutoTable.finalY;

      // Per-car heat breakdown for this group's participants
      const results = start.results || {};
      const heatNumbers = Object.keys(results).map(Number).sort((a, b) => a - b);

      if (heatNumbers.length > 0) {
        y += 16;
        if (y > 660) { doc.addPage(); y = 50; }
        doc.setFontSize(10);
        doc.setTextColor(50);
        doc.text('Heat-by-Heat Results', 40, y);
        y += 6;

        // Build columns: Heat #, then one column per group car
        const heatCols = [{ header: 'Heat', dataKey: 'heat' }];
        for (const p of groupParticipants) {
          heatCols.push({ header: `#${p.car_number} ${p.name}`, dataKey: `car_${p.car_number}` });
        }

        const heatRows = [];
        for (const hn of heatNumbers) {
          const result = results[hn];
          if (!result) continue;
          const laneCorr = (start.lane_corrections || {})[hn];
          const effectiveLanes = laneCorr || result.lanes || [];

          const row = { heat: hn };
          for (const p of groupParticipants) {
            const lane = effectiveLanes.find(l => l.car_number === p.car_number);
            if (!lane) {
              row[`car_${p.car_number}`] = '';
              continue;
            }
            if (result.type === 'RaceCompleted' && result.times_ms) {
              const t = result.times_ms[String(lane.lane)];
              row[`car_${p.car_number}`] = t != null ? formatTime(t) : 'DNF';
            } else if (result.type === 'ResultManuallyEntered' && result.rankings) {
              const r = result.rankings.find(r => r.car_number === p.car_number);
              row[`car_${p.car_number}`] = r ? `#${r.place}` : '—';
            }
          }
          heatRows.push(row);
        }

        doc.autoTable({
          startY: y,
          columns: heatCols,
          body: heatRows,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [40, 40, 60], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 245, 250] },
          margin: { left: 40, right: 40 },
        });
      }
    }
  }

  addPageFooter(doc, state.rally_name || 'Rally');
  downloadPdf(doc, `${safeFilename(group.group_name)}-report.pdf`);
}
