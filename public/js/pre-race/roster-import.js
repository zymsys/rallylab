/**
 * roster-import.js — CSV + XLSX parsing for roster uploads.
 * Uses SheetJS (global XLSX) loaded via CDN for Excel files.
 */

const HEADER_KEYWORDS = ['name', 'participant', 'scout', 'youth', 'child', 'student', 'first', 'last'];
const CAR_NUMBER_KEYWORDS = [
  'car number', 'car #', 'car no', 'car no.',
  'race number', 'race #', 'race no', 'race no.',
  'number', 'num', 'no', 'no.', '#'
];

/**
 * Parse a roster file and return participant objects: [{ name, car_number }].
 * car_number is a string (may be null if the file has no such column).
 * Supports CSV and XLSX/XLS.
 */
export async function parseRosterFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const text = await file.text();
    return parseCSV(text);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(file);
  }

  throw new Error(`Unsupported file type: .${ext}. Use CSV or Excel (.xlsx, .xls).`);
}

// ─── CSV Parser ────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];

  const rows = lines.map(parseCSVLine);
  return extractParticipants(rows);
}

/**
 * Parse a single CSV line, handling quoted fields with commas and escaped quotes.
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

// ─── Excel Parser ──────────────────────────────────────────────────

async function parseExcel(file) {
  if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS library not loaded. Refresh and try again.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  return extractParticipants(rows.map(row => row.map(String)));
}

// ─── Participant Extraction ────────────────────────────────────────

/**
 * Given a 2D array of strings, find the name and optional car-number columns
 * and return [{ name, car_number }]. Handles: single "Name" column, split
 * "First Name"/"Last Name" columns, and headerless files where the first
 * column is assumed to be names (no car_numbers in that case).
 */
function extractParticipants(rows) {
  if (rows.length === 0) return [];

  const firstRow = rows[0];
  const headerInfo = detectHeaders(firstRow);

  let dataRows;
  let nameExtractor;
  let carNumberIdx = null;

  if (headerInfo) {
    dataRows = rows.slice(1);
    nameExtractor = headerInfo.extractor;
    carNumberIdx = detectCarNumberColumn(firstRow);
  } else {
    // No header detected — assume first column is full names
    dataRows = rows;
    nameExtractor = (row) => row[0] || '';
  }

  const results = [];
  for (const row of dataRows) {
    const name = nameExtractor(row).trim();
    if (!name || isHeaderKeyword(name)) continue;
    const car_number = carNumberIdx != null
      ? (String(row[carNumberIdx] || '').trim() || null)
      : null;
    results.push({ name, car_number });
  }

  return results;
}

/**
 * Find the column index that holds car/race numbers, or null if no such
 * column exists in the header row.
 */
function detectCarNumberColumn(row) {
  const lower = row.map(cell => String(cell).toLowerCase().trim());
  for (const kw of CAR_NUMBER_KEYWORDS) {
    const idx = lower.findIndex(h => h === kw);
    if (idx !== -1) return idx;
  }
  return null;
}

/**
 * Detect header row and return column indices + extractor function.
 * Returns null if no header detected.
 */
function detectHeaders(row) {
  const lower = row.map(cell => String(cell).toLowerCase().trim());

  // Check for a single "Name" column
  const nameIdx = lower.findIndex(h => h === 'name' || h === 'participant' || h === 'participant name' || h === 'scout name' || h === 'youth name' || h === 'full name');
  if (nameIdx !== -1) {
    return { extractor: (r) => r[nameIdx] || '' };
  }

  // Check for first/last name split
  const firstIdx = lower.findIndex(h => h === 'first name' || h === 'first' || h === 'given name');
  const lastIdx = lower.findIndex(h => h === 'last name' || h === 'last' || h === 'surname' || h === 'family name');

  if (firstIdx !== -1 && lastIdx !== -1) {
    return {
      extractor: (r) => {
        const first = (r[firstIdx] || '').trim();
        const last = (r[lastIdx] || '').trim();
        return first && last ? `${first} ${last}` : first || last;
      }
    };
  }

  // Check if any cell in the first row is a header keyword
  if (lower.some(h => HEADER_KEYWORDS.includes(h))) {
    // Has header-like content but we can't map columns — use first non-empty column
    return { extractor: (r) => r.find(c => c && c.trim()) || '' };
  }

  return null; // No header detected
}

function isHeaderKeyword(str) {
  return HEADER_KEYWORDS.includes(str.toLowerCase().trim());
}

// ─── Bulk Roster Parser ───────────────────────────────────────────

const SECTION_KEYWORDS = ['section', 'division', 'class'];
const GROUP_KEYWORDS = ['group', 'pack', 'troop', 'unit', 'den', 'team'];

/**
 * Parse a roster file with Section, Name, optional Group and Car Number columns.
 * Returns [{ section, group, name, car_number }]. car_number is preserved
 * verbatim from the source (e.g. "B100") or null if the file has no such column.
 */
export async function parseBulkRosterFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let rows;

  if (ext === 'csv') {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    rows = lines.map(parseCSVLine);
  } else if (ext === 'xlsx' || ext === 'xls') {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS library not loaded. Refresh and try again.');
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      .map(row => row.map(String));
  } else {
    throw new Error(`Unsupported file type: .${ext}. Use CSV or Excel (.xlsx, .xls).`);
  }

  return extractBulkRows(rows);
}

function detectBulkHeaders(row) {
  const lower = row.map(cell => String(cell).toLowerCase().trim());

  // Section column (required)
  const sectionIdx = lower.findIndex(h => SECTION_KEYWORDS.includes(h));
  if (sectionIdx === -1) {
    throw new Error('No "Section" column found. Bulk import requires a Section column.');
  }

  // Group column (optional)
  const groupIdx = lower.findIndex(h => GROUP_KEYWORDS.includes(h));

  // Car number column (optional)
  const carNumberIdx = detectCarNumberColumn(row);

  // Name column — reuse existing header detection, but exclude section/group columns
  const nameInfo = detectHeaders(row);
  if (!nameInfo) {
    throw new Error('No name column found. Include a "Name" or "First Name"/"Last Name" column.');
  }

  return {
    sectionIdx,
    groupIdx: groupIdx === -1 ? null : groupIdx,
    carNumberIdx,
    nameExtractor: nameInfo.extractor
  };
}

function extractBulkRows(rows) {
  if (rows.length < 2) return []; // need header + at least one data row

  const { sectionIdx, groupIdx, carNumberIdx, nameExtractor } = detectBulkHeaders(rows[0]);
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const section = (row[sectionIdx] || '').trim();
    if (!section) continue; // skip rows with no section

    const name = nameExtractor(row).trim();
    if (!name || isHeaderKeyword(name)) continue;

    const group = groupIdx !== null ? (row[groupIdx] || '').trim() || null : null;
    const car_number = carNumberIdx != null
      ? (String(row[carNumberIdx] || '').trim() || null)
      : null;
    results.push({ section, group, name, car_number });
  }

  return results;
}
