#!/usr/bin/env node

/**
 * generate-docs.mjs — Captures screenshots of all RallyLab interfaces
 * for the HTML user guide.
 *
 * Usage:
 *   node scripts/generate-docs.mjs
 *
 * Output: Screenshots in public/guide/images/
 */

import { spawn } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const GUIDE_DIR = join(ROOT, 'public', 'guide');
const GUIDE_IMAGES_DIR = join(GUIDE_DIR, 'images');
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = 8090;
const BASE = `http://localhost:${PORT}`;

// ─── HTTP Server ────────────────────────────────────────────────

function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', PUBLIC_DIR], {
    stdio: 'pipe'
  });
  proc.stderr.on('data', () => {}); // suppress output
  return proc;
}

async function waitForServer(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${BASE}/registration.html`);
      if (resp.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('HTTP server did not start');
}

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { process.stdout.write(`  ${msg}\n`); }

/** Remove any toast elements before screenshots. */
async function clearToasts(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach(t => t.remove());
  });
}

/** Take a screenshot and return { path, buffer }. */
async function capture(page, name) {
  await clearToasts(page);
  await sleep(200); // let animations settle
  const path = join(GUIDE_IMAGES_DIR, `${name}.png`);
  const buffer = await page.screenshot({ path, fullPage: false });
  log(`screenshot: ${name}`);
  return { path, buffer };
}

// ─── Pre-Race Screenshots ───────────────────────────────────────

async function capturePreRace(browser) {
  log('--- Pre-Race ---');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1. Login screen
  await page.goto(`${BASE}/registration.html`);
  await page.waitForSelector('.login-container');
  await capture(page, 'pre-race-login');

  // 2. Click demo mode → rally list
  await page.click('#demo-btn');
  await page.waitForSelector('.screen-title');
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen-title');
    return el && el.textContent.includes('Your Rallies');
  });
  await sleep(500);
  await capture(page, 'pre-race-rally-list');

  // 3. Open Create Rally dialog (from rally list)
  await page.click('#rally-list-actions .btn-primary');
  await page.waitForSelector('#dlg-rally-name');
  await capture(page, 'pre-race-dlg-create-rally');
  await page.click('.dialog-close');
  await sleep(200);

  // 4. Rally Home — click Manage on the first rally
  await page.click('text=Manage');
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen-title');
    return el && !el.textContent.includes('Your Rallies');
  });
  await sleep(300);
  await capture(page, 'pre-race-rally-home');

  // 5. Dialogs from Rally Home
  // Add Section
  await page.click('#section-actions .btn-primary');
  await page.waitForSelector('#dlg-section-name');
  await capture(page, 'pre-race-dlg-add-section');
  await page.click('.dialog-close');
  await sleep(200);

  // Add Group
  await page.click('#group-actions .btn-primary');
  await page.waitForSelector('#dlg-group-name');
  await capture(page, 'pre-race-dlg-add-group');
  await page.click('.dialog-close');
  await sleep(200);

  // Invite Registrar
  await page.click('#registrar-actions .btn-primary');
  await page.waitForSelector('#dlg-registrar-email');
  await capture(page, 'pre-race-dlg-invite-registrar');
  await page.click('.dialog-close');
  await sleep(200);

  // Invite Operator
  await page.click('#operator-actions .btn-primary');
  await page.waitForSelector('#dlg-operator-email');
  await capture(page, 'pre-race-dlg-invite-operator');
  await page.click('.dialog-close');
  await sleep(200);

  // 6. Section Detail (grouped) — click the "Roster" button in sections table (not "Export Roster")
  await page.click('#sections-body .btn-sm');
  await page.waitForSelector('.section-header', { timeout: 10000 });
  await sleep(300);
  await capture(page, 'pre-race-section-detail-grouped');

  // Extract IDs for filtered view navigation (before leaving this screen)
  const sectionDetailHash = await page.evaluate(() => location.hash);
  const sectionMatch = sectionDetailHash.match(/sectionId=([^/]+)/);
  const rallyMatch = sectionDetailHash.match(/rallyId=([^/]+)/);

  // 7. Section Detail (filtered by group) — navigate via hash
  if (sectionMatch && rallyMatch) {
    // Get group ID from the app state
    const ids = await page.evaluate(async () => {
      const { loadRallyState } = await import('./js/pre-race/commands.js');
      const hash = location.hash.replace(/^#/, '');
      const parts = hash.split('/');
      const params = {};
      for (let i = 1; i < parts.length; i++) {
        const eq = parts[i].indexOf('=');
        if (eq !== -1) params[parts[i].slice(0, eq)] = decodeURIComponent(parts[i].slice(eq + 1));
      }
      if (!params.rallyId) return null;
      const state = await loadRallyState(params.rallyId);
      const groups = Object.keys(state.groups || {});
      const sections = Object.keys(state.sections || {});
      // Find a section that has participants with a group_id
      for (const secId of sections) {
        const sec = state.sections[secId];
        const withGroup = sec.participants.find(p => p.group_id);
        if (withGroup) {
          return { sectionId: secId, groupId: withGroup.group_id, rallyId: params.rallyId };
        }
      }
      return groups.length > 0 && sections.length > 0
        ? { sectionId: sections[0], groupId: groups[0], rallyId: params.rallyId }
        : null;
    });

    if (ids) {
      await page.evaluate(({ sectionId, groupId, rallyId }) => {
        location.hash = `section-detail/rallyId=${rallyId}/sectionId=${sectionId}/groupId=${groupId}`;
      }, ids);
      await page.waitForSelector('.section-header', { timeout: 10000 });
      await sleep(500);
      await capture(page, 'pre-race-section-detail-filtered');

      // Upload Roster dialog (available on filtered view for organizer)
      const uploadBtn = page.locator('#section-actions .btn-secondary', { hasText: 'Upload Roster' });
      if (await uploadBtn.count() > 0) {
        await uploadBtn.click();
        await page.waitForSelector('#dlg-upload-area', { timeout: 5000 });
        await capture(page, 'pre-race-dlg-upload-roster');
        await page.click('.dialog-close');
        await sleep(200);
      }

      // Add Participant dialog
      const addPartBtn = page.locator('#section-actions .btn-primary', { hasText: 'Add Participant' });
      if (await addPartBtn.count() > 0) {
        await addPartBtn.click();
        await page.waitForSelector('#dlg-participant-name', { timeout: 5000 });
        await capture(page, 'pre-race-dlg-add-participant');
        await page.click('.dialog-close');
        await sleep(200);
      }
    }
  }

  await ctx.close();
}

// ─── Operator Screenshots ───────────────────────────────────────

async function captureOperator(browser) {
  log('--- Operator ---');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1. Rally list
  await page.goto(`${BASE}/operator.html`);
  await page.waitForSelector('.screen-title');
  await sleep(500);
  await capture(page, 'operator-rally-list');

  // 2. Load Demo Data dialog
  await page.click('text=Load Demo Data');
  await page.waitForSelector('[data-action="load"]');
  await sleep(200);

  // Set all checked in
  await page.selectOption('#dlg-checkin-mode', 'all');
  await capture(page, 'operator-dlg-demo-data');

  // 3. Load the demo data
  await page.click('[data-action="load"]');
  // Wait for navigation to rally-home
  await page.waitForFunction(() => {
    const el = document.querySelector('.screen-title');
    return el && !el.textContent.includes('Race Day');
  }, { timeout: 15000 });
  await sleep(500);
  await capture(page, 'operator-rally-home');

  // 4. Check-In — click first "Check In" button
  await page.click('text=Check In >> nth=0');
  await page.waitForSelector('.checkin-counter');
  await sleep(300);
  await capture(page, 'operator-check-in');

  // 5. Start Section dialog — click Start This Section or go back and click Start Section
  const startThisBtn = page.locator('text=Start This Section');
  if (await startThisBtn.count() > 0) {
    await startThisBtn.click();
  } else {
    const startBtn = page.locator('text=Start Section');
    if (await startBtn.count() > 0) {
      await startBtn.click();
    }
  }
  await page.waitForSelector('#dlg-lane-grid');
  await capture(page, 'operator-dlg-start-section');

  // 6. Click Start Racing
  await page.click('[data-action="start"]');
  await page.waitForSelector('.console-header', { timeout: 10000 });
  await sleep(500);

  // Wait for the staging state — "Run Heat" button appears
  await page.waitForSelector('.console-controls .btn-primary', { timeout: 10000 });
  await capture(page, 'operator-live-console-staging');

  // 7. Open Manual Rank dialog (available during staging)
  const manualRankBtn = page.locator('text=Manual Rank');
  if (await manualRankBtn.count() > 0) {
    await manualRankBtn.click();
    await page.waitForSelector('#dlg-manual-body');
    await capture(page, 'operator-dlg-manual-rank');
    await page.click('.dialog-close');
    await sleep(200);
  }

  // 8. Open Remove Car dialog
  const removeBtn = page.locator('text=Remove Car');
  if (await removeBtn.count() > 0) {
    await removeBtn.click();
    await page.waitForSelector('#dlg-remove-car');
    await capture(page, 'operator-dlg-remove-car');
    await page.click('.dialog-close');
    await sleep(200);
  }

  // 9. Open Change Lanes dialog
  const changeLanesBtn = page.locator('.console-controls >> text=Change Lanes');
  if (await changeLanesBtn.count() > 0) {
    await changeLanesBtn.click();
    await page.waitForSelector('#dlg-lane-grid');
    await capture(page, 'operator-dlg-change-lanes');
    await page.click('.dialog-close');
    await sleep(200);
  }

  // 10. Click "Run Heat" to get results
  const runHeatBtn = page.locator('.console-controls .btn-primary', { hasText: /Run Heat/ });
  if (await runHeatBtn.count() > 0) {
    await runHeatBtn.click();
    await page.waitForSelector('.console-controls .btn-primary:has-text("Next Heat")', { timeout: 10000 });
    await sleep(300);
    await capture(page, 'operator-live-console-results');
  }

  // 11. Run through remaining heats to reach section complete
  let safetyCounter = 0;
  while (safetyCounter < 50) {
    safetyCounter++;

    const isComplete = await page.evaluate(() => location.hash.includes('section-complete'));
    if (isComplete) break;

    const nextBtn = page.locator('.console-controls .btn-primary', { hasText: 'Next Heat' });
    if (await nextBtn.count() > 0) {
      await nextBtn.click();
      await sleep(500);
      await page.waitForFunction(() => {
        const runBtn = document.querySelector('.console-controls .btn-primary');
        return (runBtn && runBtn.textContent.includes('Run Heat')) ||
               location.hash.includes('section-complete');
      }, { timeout: 10000 });
      continue;
    }

    const runBtn = page.locator('.console-controls .btn-primary', { hasText: /Run Heat/ });
    if (await runBtn.count() > 0) {
      await runBtn.click();
      await sleep(500);
      await page.waitForFunction(() => {
        const nextBtn = document.querySelector('.console-controls .btn-primary');
        return (nextBtn && nextBtn.textContent.includes('Next Heat')) ||
               location.hash.includes('section-complete');
      }, { timeout: 10000 });
      continue;
    }

    await sleep(500);
  }

  // 12. Section Complete screen
  await page.waitForSelector('.section-header');
  await sleep(300);
  await capture(page, 'operator-section-complete');

  // Return context for registrar/audience (they share IndexedDB)
  return ctx;
}

// ─── Registrar Screenshots ─────────────────────────────────────

async function captureRegistrar(ctx) {
  log('--- Registrar ---');
  const page = await ctx.newPage();

  await page.goto(`${BASE}/registrar.html`);
  await page.waitForSelector('.screen-title');
  await sleep(500);
  await capture(page, 'registrar-section-list');

  const checkInBtn = page.locator('text=Check In >> nth=0');
  if (await checkInBtn.count() > 0) {
    await checkInBtn.click();
    await page.waitForSelector('.checkin-counter');
    await sleep(300);
    await capture(page, 'registrar-section-checkin');
  }

  await page.close();
}

// ─── Audience Screenshots ───────────────────────────────────────

async function captureAudience(ctx) {
  log('--- Audience ---');
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(`${BASE}/audience.html`);
  await sleep(500);

  // 1. Welcome
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({ type: 'SHOW_WELCOME', rally_name: 'Kub Kars Rally 2026' });
    ch.close();
  });
  await page.waitForSelector('.audience-welcome');
  await sleep(300);
  await capture(page, 'audience-welcome');

  // 2. Staging
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({
      type: 'SHOW_STAGING',
      section_name: 'Kub Kars',
      heat_number: 1,
      lanes: [
        { lane: 1, car_number: 101, name: 'Billy Thompson' },
        { lane: 2, car_number: 102, name: 'Sarah Chen' },
        { lane: 3, car_number: 103, name: 'Tommy Rodriguez' },
        { lane: 4, car_number: 104, name: 'Emma Wilson' }
      ],
      next_heat: {
        heat_number: 2,
        lanes: [
          { lane: 1, car_number: 103, name: 'Tommy Rodriguez' },
          { lane: 2, car_number: 105, name: 'Jake Patel' },
          { lane: 3, car_number: 101, name: 'Billy Thompson' },
          { lane: 4, car_number: 106, name: 'Lily Okafor' }
        ]
      }
    });
    ch.close();
  });
  await page.waitForSelector('.audience-staging-columns');
  await sleep(300);
  await capture(page, 'audience-staging');

  // 3. Results
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({
      type: 'SHOW_RESULTS',
      section_name: 'Kub Kars',
      heat_number: 1,
      results: [
        { car_number: 102, name: 'Sarah Chen', time_ms: 2847, place: 1 },
        { car_number: 104, name: 'Emma Wilson', time_ms: 2953, place: 2 },
        { car_number: 101, name: 'Billy Thompson', time_ms: 3124, place: 3 },
        { car_number: 103, name: 'Tommy Rodriguez', time_ms: 3267, place: 4 }
      ]
    });
    ch.close();
  });
  await page.waitForSelector('.audience-results-table');
  await sleep(300);
  await capture(page, 'audience-results');

  // 4. Leaderboard
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({
      type: 'SHOW_LEADERBOARD',
      section_name: 'Kub Kars',
      standings: [
        { rank: 1, car_number: 102, name: 'Sarah Chen', avg_time_ms: 2847 },
        { rank: 2, car_number: 104, name: 'Emma Wilson', avg_time_ms: 2953 },
        { rank: 3, car_number: 101, name: 'Billy Thompson', avg_time_ms: 3124 },
        { rank: 4, car_number: 103, name: 'Tommy Rodriguez', avg_time_ms: 3267 },
        { rank: 5, car_number: 105, name: 'Jake Patel', avg_time_ms: 3401 },
        { rank: 6, car_number: 106, name: 'Lily Okafor', avg_time_ms: 3512 },
        { rank: 7, car_number: 107, name: 'Noah Kim', avg_time_ms: 3689 }
      ]
    });
    ch.close();
  });
  await page.waitForSelector('.audience-results-table');
  await sleep(300);
  await capture(page, 'audience-leaderboard');

  // 5. Section Complete (with progressive reveal)
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({
      type: 'SHOW_SECTION_COMPLETE',
      section_name: 'Kub Kars',
      standings: [
        { rank: 1, car_number: 102, name: 'Sarah Chen', avg_time_ms: 2847, heats_run: 6 },
        { rank: 2, car_number: 104, name: 'Emma Wilson', avg_time_ms: 2953, heats_run: 6 },
        { rank: 3, car_number: 101, name: 'Billy Thompson', avg_time_ms: 3124, heats_run: 6 },
        { rank: 4, car_number: 103, name: 'Tommy Rodriguez', avg_time_ms: 3267, heats_run: 6 },
        { rank: 5, car_number: 105, name: 'Jake Patel', avg_time_ms: 3401, heats_run: 6 },
        { rank: 6, car_number: 106, name: 'Lily Okafor', avg_time_ms: 3512, heats_run: 6 },
        { rank: 7, car_number: 107, name: 'Noah Kim', avg_time_ms: 3689, heats_run: 6 }
      ]
    });
    ch.close();
  });
  await page.waitForSelector('.audience-complete-banner');
  await sleep(300);

  // Reveal all with animation
  await page.evaluate(() => {
    const ch = new BroadcastChannel('rallylab-race');
    ch.postMessage({ type: 'REVEAL_ALL' });
    ch.close();
  });
  // Wait for reveal animation to complete (7 items * 60ms + buffer)
  await sleep(800);
  await capture(page, 'audience-section-complete');

  await page.close();
}

// ─── Pico Debug Console Screenshots ─────────────────────────────

async function capturePicoDebug(browser) {
  log('--- Pico Debug Console ---');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/pico-debug.html`);
  await sleep(500);

  // Read actual firmware file for the editor
  const enginePy = readFileSync(join(ROOT, 'firmware', 'engine.py'), 'utf-8');

  // Playwright's Chromium lacks Web Serial — hide the banner and fake connected state
  await page.evaluate(() => {
    document.querySelector('#no-serial-banner').style.display = 'none';
    document.querySelector('#status-dot').classList.add('connected');
    document.querySelector('#status-label').textContent = 'Connected';
    document.querySelector('#btn-connect').disabled = true;
    document.querySelector('#btn-disconnect').disabled = false;
    document.querySelector('#terminal-input').disabled = false;

    const content = document.querySelector('#terminal-content');
    function addLine(text, cls) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      content.appendChild(span);
    }

    addLine('Connected to Pico W\n', 'sys');
    addLine('> info\n', 'cmd');
    addLine('{\n  "firmware": "0.1.0",\n  "lane_count": 6,\n  "protocol": "1.0"\n}\n', 'resp');
    addLine('> state\n', 'cmd');
    addLine('null\n', 'resp');
    addLine('> gate\n', 'cmd');
    addLine('{\n  "gate_ready": true\n}\n', 'resp');
    addLine('> dbg\n', 'cmd');
    addLine(`{
  "controller": {
    "firmware": "0.1.0",
    "protocol": "1.0",
    "uptime_ms": 45231
  },
  "engine": {
    "active_lanes": null,
    "gate_ready": true,
    "phase": "IDLE",
    "race_id": null
  },
  "io": {
    "debounce_ms": 10,
    "start_gate": {
      "debounced": 1,
      "invert": true,
      "pull": "up",
      "raw": 1
    }
  }
}\n`, 'resp');
  });

  await capture(page, 'pico-debug-terminal');

  // Switch to Files tab
  await page.click('[data-tab="files"]');
  await sleep(200);

  // Inject file list and load engine.py into CodeMirror
  await page.evaluate((engineContent) => {
    const files = ['config.py', 'engine.py', 'gpio_manager.py', 'main.py', 'serial_handler.py', 'uuid_gen.py'];
    const fileList = document.querySelector('#file-list');
    fileList.innerHTML = '';
    for (const name of files) {
      const div = document.createElement('div');
      div.className = 'file-item' + (name === 'engine.py' ? ' active' : '');
      div.textContent = name;
      fileList.appendChild(div);
    }

    document.querySelector('#editor-filename').textContent = 'engine.py';
    document.querySelector('#btn-save').disabled = false;

    const container = document.querySelector('#editor-container');
    container.innerHTML = '';
    const editor = CodeMirror(container, {
      value: engineContent,
      mode: 'python',
      theme: 'material-darker',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      lineWrapping: true,
      readOnly: false,
    });
    setTimeout(() => editor.refresh(), 0);
  }, enginePy);

  await sleep(500);
  await capture(page, 'pico-debug-files');

  await ctx.close();
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('RallyLab User Guide — Screenshot Capture');
  console.log('=========================================\n');

  const { chromium } = await import('@playwright/test');

  mkdirSync(GUIDE_IMAGES_DIR, { recursive: true });

  log('Starting HTTP server...');
  const server = startServer();
  await waitForServer();
  log('Server ready on port ' + PORT);

  let browser;
  try {
    log('Launching browser...');
    browser = await chromium.launch({ headless: true });

    await capturePreRace(browser);
    const ctx = await captureOperator(browser);
    await captureRegistrar(ctx);
    await captureAudience(ctx);
    await ctx.close();
    await capturePicoDebug(browser);
  } catch (err) {
    console.error('\nError during screenshot capture:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
    return;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('\nDone! Screenshots saved to public/guide/images/');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});
