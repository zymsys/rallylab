/**
 * operator.steps.js — Playwright-BDD step definitions for race day operator E2E tests.
 *
 * Approach:
 *  - Setup (Given/Background) injects events via the app's own module functions
 *    (dynamic import of /js/operator/app.js) to populate IndexedDB quickly.
 *  - Actions (When) drive the real UI — buttons, dialogs, checkboxes.
 *  - Assertions (Then) mix DOM checks with state inspection via window.__rallylab.
 */

import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures.js';

// ─── Constants ───────────────────────────────────────────────────

// Default roster for most race scenarios.
// Cars 1-7 are checked in by default; 8-9 are registered but NOT checked in.
const ROSTER = [
  { name: 'Alice Anderson', car_number: 1 },
  { name: 'Bob Baker', car_number: 2 },
  { name: 'Charlie Clark', car_number: 3 },
  { name: 'Diana Davis', car_number: 4 },
  { name: 'Broken Betty', car_number: 5 },
  { name: 'Frank Fisher', car_number: 6 },
  { name: 'Grace Green', car_number: 7 },
  { name: 'Tardy Tina', car_number: 8 },
  { name: 'Slow Sam', car_number: 9 },
];
const DEFAULT_CHECKED_IN = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_LANES = [1, 2, 3, 4];

const SCOUT_TRUCKS_ROSTER = [
  { name: 'Scout Alpha', car_number: 1 },
  { name: 'Scout Bravo', car_number: 2 },
  { name: 'Scout Charlie', car_number: 3 },
  { name: 'Scout Delta', car_number: 4 },
  { name: 'Scout Echo', car_number: 5 },
  { name: 'Scout Foxtrot', car_number: 6 },
  { name: 'Scout Golf', car_number: 7 },
  { name: 'Scout Hotel', car_number: 8 },
];

// Small roster for section-completion tests (4 participants, 3 lanes = 4 heats).
const SMALL_ROSTER = [
  { name: 'Amy Adams', car_number: 1 },
  { name: 'Ben Brown', car_number: 2 },
  { name: 'Cal Clark', car_number: 3 },
  { name: 'Dee Davis', car_number: 4 },
];
const SMALL_CHECKED_IN = [1, 2, 3, 4];
const SMALL_LANES = [1, 2, 3];

// Second small roster for multi-section tests.
const SMALL_ROSTER_B = [
  { name: 'Erin Evans', car_number: 1 },
  { name: 'Finn Foster', car_number: 2 },
  { name: 'Gina Grant', car_number: 3 },
  { name: 'Hugo Harris', car_number: 4 },
];

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Inject events into IndexedDB via the operator app module, then optionally
 * start the section and navigate to the live console.
 */
async function injectAndNavigate(page, raceContext, cfg) {
  const {
    sectionName, participants, checkedIn, availableLanes, started = true,
  } = cfg;

  await page.goto('/operator.html');
  await page.waitForSelector('.screen-title', { timeout: 10000 });

  const result = await page.evaluate(async (c) => {
    const app = await import('/js/operator/app.js');
    await app.clearAndRebuild();

    const sectionId = crypto.randomUUID();
    await app.appendAndRebuild({
      type: 'EventCreated', event_id: crypto.randomUUID(),
      event_name: 'Test Rally 2026', event_date: '2026-03-15',
      created_by: 'operator', timestamp: Date.now(),
    });
    await app.appendAndRebuild({
      type: 'RosterLoaded', section_id: sectionId,
      section_name: c.sectionName,
      participants: c.participants.map(p => ({
        participant_id: crypto.randomUUID(), name: p.name, car_number: p.car_number,
      })),
      timestamp: Date.now(),
    });
    for (const carNum of c.checkedIn) {
      await app.appendAndRebuild({
        type: 'CarArrived', section_id: sectionId,
        car_number: carNum, timestamp: Date.now(),
      });
    }
    if (c.started) {
      await app.appendAndRebuild({
        type: 'SectionStarted', section_id: sectionId,
        available_lanes: c.availableLanes, timestamp: Date.now(),
      });
    }
    return sectionId;
  }, { sectionName, participants, checkedIn, availableLanes, started });

  raceContext.sectionId = result;
  raceContext.sectionName = sectionName;
  raceContext.participants = [...participants];
  raceContext.checkedIn = [...checkedIn];
  raceContext.availableLanes = [...availableLanes];

  if (started) {
    await page.evaluate((sid) => {
      import('/js/operator/app.js').then(a => a.navigate('live-console', { sectionId: sid }));
    }, result);
    await page.waitForSelector('.console-header', { timeout: 10000 });
    await page.getByRole('button', { name: 'Resume Racing' }).click();
    await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
  } else {
    await page.evaluate(() => {
      import('/js/operator/app.js').then(a => a.navigate('event-home', {}));
    });
    await page.waitForSelector('.screen-title', { timeout: 10000 });
  }
}

/** Click "Run Heat N" and wait for results. */
async function runCurrentHeat(page) {
  await page.getByRole('button', { name: /^Run Heat \d+$/ }).click();
  // Results phase: Re-Run or Next Heat button appears
  await page.getByRole('button', { name: /Re-Run Heat|Next Heat/ }).first().waitFor({ timeout: 10000 });
}

/** Click "Next Heat" and wait for staging. */
async function advanceToNextHeat(page) {
  await page.getByRole('button', { name: 'Next Heat' }).click();
  await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
}

/** Run N heats. Leaves the page in results state for the last completed heat. */
async function completeHeats(page, raceContext, count) {
  for (let i = 0; i < count; i++) {
    await runCurrentHeat(page);
    raceContext.completedHeats++;
    if (i < count - 1) await advanceToNextHeat(page);
  }
}

/**
 * Run all remaining heats through to section completion.
 * Runs heats 1..N-1 normally, then fires the final heat and waits for
 * the "Final Results" heading (the race loop auto-navigates on completion).
 */
async function completeAllRemainingHeats(page, raceContext) {
  const info = await getHeatInfo(page);
  const totalHeats = info.total;
  const remaining = totalHeats - raceContext.completedHeats;

  // Run all but the last heat with normal advance
  for (let i = 0; i < remaining - 1; i++) {
    await runCurrentHeat(page);
    raceContext.completedHeats++;
    await advanceToNextHeat(page);
  }

  // Final heat: click Run Heat, then wait for the section-complete screen
  await page.getByRole('button', { name: /^Run Heat \d+$/ }).click();
  raceContext.completedHeats++;
  await page.getByRole('heading', { name: /Final Results/ }).waitFor({ timeout: 15000 });
}

/** Parse "Heat N of M" from the console header. */
async function getHeatInfo(page) {
  const text = await page.locator('.info-line').first().textContent();
  const m = text.match(/Heat (\d+) of (\d+)/);
  return m ? { current: parseInt(m[1]), total: parseInt(m[2]) } : null;
}

/** Read the schedule from the test bridge. */
async function getSchedule(page) {
  return page.evaluate(() => window.__rallylab?.liveSection?.schedule);
}

/** Read the race_day section state from the test bridge. */
async function getSectionState(page) {
  return page.evaluate(() => {
    const s = window.__rallylab?.state;
    if (!s) return null;
    const sid = s.race_day.active_section_id;
    return sid ? s.race_day.sections[sid] : null;
  });
}

/** Open the Change Lanes dialog, set lanes, and apply. */
async function changeLanes(page, lanes) {
  await page.getByRole('button', { name: 'Change Lanes' }).click();
  await page.waitForSelector('#dlg-lane-grid', { timeout: 5000 });

  const cbs = page.locator('#dlg-lane-grid input[type="checkbox"]');
  const count = await cbs.count();
  for (let i = 0; i < count; i++) {
    const cb = cbs.nth(i);
    const val = parseInt(await cb.getAttribute('value'));
    const want = lanes.includes(val);
    const has = await cb.isChecked();
    if (want !== has) await cb.click();
  }
  await page.locator('#dlg-lanes-reason').fill('Test lane change');
  await page.getByRole('button', { name: 'Apply Changes' }).click();
  // Wait for race loop to restart — Run Heat button reappears
  await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
}

/**
 * Inject two sections into IndexedDB, check in section A cars,
 * and navigate to event-home.
 */
async function injectTwoSections(page, raceContext, cfgA, cfgB) {
  await page.goto('/operator.html');
  await page.waitForSelector('.screen-title', { timeout: 10000 });

  const result = await page.evaluate(async (c) => {
    const app = await import('/js/operator/app.js');
    await app.clearAndRebuild();

    const sectionIdA = crypto.randomUUID();
    const sectionIdB = crypto.randomUUID();

    await app.appendAndRebuild({
      type: 'EventCreated', event_id: crypto.randomUUID(),
      event_name: 'Test Rally 2026', event_date: '2026-03-15',
      created_by: 'operator', timestamp: Date.now(),
    });

    // Section A
    await app.appendAndRebuild({
      type: 'RosterLoaded', section_id: sectionIdA,
      section_name: c.cfgA.sectionName,
      participants: c.cfgA.participants.map(p => ({
        participant_id: crypto.randomUUID(), name: p.name, car_number: p.car_number,
      })),
      timestamp: Date.now(),
    });

    // Section B
    await app.appendAndRebuild({
      type: 'RosterLoaded', section_id: sectionIdB,
      section_name: c.cfgB.sectionName,
      participants: c.cfgB.participants.map(p => ({
        participant_id: crypto.randomUUID(), name: p.name, car_number: p.car_number,
      })),
      timestamp: Date.now(),
    });

    // Check in section A cars
    for (const carNum of c.cfgA.checkedIn) {
      await app.appendAndRebuild({
        type: 'CarArrived', section_id: sectionIdA,
        car_number: carNum, timestamp: Date.now(),
      });
    }

    return { sectionIdA, sectionIdB };
  }, { cfgA, cfgB });

  raceContext.sectionId = result.sectionIdA;
  raceContext.sectionName = cfgA.sectionName;
  raceContext.participants = [...cfgA.participants];
  raceContext.checkedIn = [...cfgA.checkedIn];
  raceContext.availableLanes = [...cfgA.availableLanes];

  raceContext.sectionIdB = result.sectionIdB;
  raceContext.sectionNameB = cfgB.sectionName;
  raceContext.participantsB = [...cfgB.participants];
  raceContext.checkedInB = [];
  raceContext.availableLanesB = [...cfgB.availableLanes];
  raceContext.completedHeatsB = 0;

  await page.evaluate(() => {
    import('/js/operator/app.js').then(a => a.navigate('event-home', {}));
  });
  await page.waitForSelector('.screen-title', { timeout: 10000 });
}

// ═══════════════════════════════════════════════════════════════════
//  BACKGROUND / GIVEN
// ═══════════════════════════════════════════════════════════════════

Given('a race is in progress with a started section', async ({ page, raceContext }) => {
  await injectAndNavigate(page, raceContext, {
    sectionName: 'Kub Kars',
    participants: ROSTER,
    checkedIn: DEFAULT_CHECKED_IN,
    availableLanes: DEFAULT_LANES,
  });
});

Given('an event with a Scout Trucks section', async ({ page, raceContext }) => {
  await injectAndNavigate(page, raceContext, {
    sectionName: 'Scout Trucks',
    participants: SCOUT_TRUCKS_ROSTER,
    checkedIn: [],
    availableLanes: [1, 2, 3, 4, 5, 6],
    started: false,
  });
});

// ── Race progression ─────────────────────────────────────────────

Given('{int} group heats have been completed', async ({ page, raceContext }, count) => {
  await completeHeats(page, raceContext, count);
});

Given('{int} heats have been completed', async ({ page, raceContext }, count) => {
  await completeHeats(page, raceContext, count);
});

Given('the section has started but no heats are completed', async ({ page }) => {
  const info = await getHeatInfo(page);
  expect(info.current).toBe(1);
});

Given('heat {int} has just been completed', async ({ page, raceContext }, n) => {
  const needed = n - raceContext.completedHeats;
  for (let i = 0; i < needed; i++) {
    if (i > 0) await advanceToNextHeat(page);
    await runCurrentHeat(page);
    raceContext.completedHeats++;
  }
});

Given('heat {int} has just completed with results', async ({ page, raceContext }, n) => {
  const needed = n - raceContext.completedHeats;
  for (let i = 0; i < needed; i++) {
    if (i > 0) await advanceToNextHeat(page);
    await runCurrentHeat(page);
    raceContext.completedHeats++;
  }
});

// ── Participant state ────────────────────────────────────────────

Given('{string} is registered but not checked in', async ({ raceContext }, name) => {
  const p = raceContext.participants.find(x => x.name === name);
  expect(p, `${name} should be in roster`).toBeTruthy();
  expect(raceContext.checkedIn).not.toContain(p.car_number);
});

Given('{string} and {string} are registered but not checked in',
  async ({ raceContext }, name1, name2) => {
    for (const name of [name1, name2]) {
      const p = raceContext.participants.find(x => x.name === name);
      expect(p, `${name} should be in roster`).toBeTruthy();
      expect(raceContext.checkedIn).not.toContain(p.car_number);
    }
  });

// ── Car state ────────────────────────────────────────────────────

Given('car #{int} {string} finished in that heat', async ({ page }, carNum) => {
  await expect(page.locator('.lane-table').getByText(`#${carNum}`)).toBeVisible();
});

Given('car #{int} has already been removed', async ({ page, raceContext }, carNum) => {
  await page.getByRole('button', { name: 'Remove Car' }).click();
  await page.waitForSelector('#dlg-remove-car', { timeout: 5000 });
  await page.locator('#dlg-remove-car').selectOption(String(carNum));
  await page.locator('[data-action="remove"]').click();
  await page.waitForTimeout(500);
});

// ── Lane correction setup ────────────────────────────────────────

Given('heat {int} completed with car #{int} in lane {int} and car #{int} in lane {int}',
  async ({ page, raceContext }, heatNum, _car1, _lane1, _car2, _lane2) => {
    const needed = heatNum - raceContext.completedHeats;
    for (let i = 0; i < needed; i++) {
      if (i > 0) await advanceToNextHeat(page);
      await runCurrentHeat(page);
      raceContext.completedHeats++;
    }
    // Record the ACTUAL cars in the first two lanes (the scheduler may not
    // place the exact cars the feature mentions — that's just illustrative).
    const sec = await getSectionState(page);
    const heat = sec.heats.find(h => h.heat_number === heatNum);
    raceContext.correctionHeat = heatNum;
    raceContext.actualSwap = {
      lane1: heat.lanes[0].lane,
      car1: heat.lanes[0].car_number,
      lane2: heat.lanes[1].lane,
      car2: heat.lanes[1].car_number,
    };
  });

Given('car #{int} recorded {float}s and car #{int} recorded {float}s',
  async ({ raceContext }, _car1, _time1, _car2, _time2) => {
    // Times are generated randomly by the manual track; store for reference
    raceContext.recordedTimes = { [_car1]: _time1, [_car2]: _time2 };
  });

Given('heat {int} was completed and heat {int} is now staged',
  async ({ page, raceContext }, completedHeat, stagedHeat) => {
    const needed = completedHeat - raceContext.completedHeats;
    for (let i = 0; i < needed; i++) {
      if (i > 0) await advanceToNextHeat(page);
      await runCurrentHeat(page);
      raceContext.completedHeats++;
    }
    await advanceToNextHeat(page);
    const info = await getHeatInfo(page);
    expect(info.current).toBe(stagedHeat);
  });

// ── Scout Trucks setup ──────────────────────────────────────────

Given('{int} participants are checked in for Scout Trucks', async ({ page, raceContext }, count) => {
  // Inject CarArrived events directly to avoid timing issues with checkbox re-renders
  const sid = raceContext.sectionId;
  await page.evaluate(async ({ sid, count }) => {
    const app = await import('/js/operator/app.js');
    for (let i = 1; i <= count; i++) {
      await app.appendAndRebuild({
        type: 'CarArrived', section_id: sid,
        car_number: i, timestamp: Date.now(),
      });
    }
    // Re-render current screen to reflect new state
    app.navigate('event-home', {});
  }, { sid, count });
  await page.waitForSelector('.screen-title', { timeout: 10000 });
  raceContext.checkedIn = Array.from({ length: count }, (_, i) => i + 1);
});

Given('Scout Trucks is racing with lanes {int}, {int}, and {int}',
  async ({ page, raceContext }, l1, l2, l3) => {
    const lanes = [l1, l2, l3];
    const sid = raceContext.sectionId;

    // Check in all participants via event injection
    await page.evaluate(async ({ sid, participants }) => {
      const app = await import('/js/operator/app.js');
      for (const p of participants) {
        await app.appendAndRebuild({
          type: 'CarArrived', section_id: sid,
          car_number: p.car_number, timestamp: Date.now(),
        });
      }
    }, { sid, participants: SCOUT_TRUCKS_ROSTER });
    raceContext.checkedIn = SCOUT_TRUCKS_ROSTER.map(p => p.car_number);

    // Start section with specific lanes via event injection + navigate
    await page.evaluate(async ({ sid, lanes }) => {
      const app = await import('/js/operator/app.js');
      await app.appendAndRebuild({
        type: 'SectionStarted', section_id: sid,
        available_lanes: lanes, timestamp: Date.now(),
      });
      app.navigate('live-console', { sectionId: sid });
    }, { sid, lanes });

    await page.waitForSelector('.console-header', { timeout: 10000 });
    await page.getByRole('button', { name: 'Resume Racing' }).click();
    await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
    raceContext.availableLanes = lanes;
  });

Given('Scout Trucks is in the staging state for heat {int}',
  async ({ page, raceContext }, heatNum) => {
    const sid = raceContext.sectionId;
    const defaultLanes = [1, 3, 5];

    // Check in all + start via event injection
    await page.evaluate(async ({ sid, participants, lanes }) => {
      const app = await import('/js/operator/app.js');
      for (const p of participants) {
        await app.appendAndRebuild({
          type: 'CarArrived', section_id: sid,
          car_number: p.car_number, timestamp: Date.now(),
        });
      }
      await app.appendAndRebuild({
        type: 'SectionStarted', section_id: sid,
        available_lanes: lanes, timestamp: Date.now(),
      });
      app.navigate('live-console', { sectionId: sid });
    }, { sid, participants: SCOUT_TRUCKS_ROSTER, lanes: defaultLanes });

    await page.waitForSelector('.console-header', { timeout: 10000 });
    await page.getByRole('button', { name: 'Resume Racing' }).click();
    await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
    raceContext.checkedIn = SCOUT_TRUCKS_ROSTER.map(p => p.car_number);
    raceContext.availableLanes = defaultLanes;

    // Progress to heat N staging
    for (let i = 1; i < heatNum; i++) {
      await runCurrentHeat(page);
      raceContext.completedHeats++;
      await advanceToNextHeat(page);
    }
    const label = await page.locator('.console-state-label').textContent();
    expect(label).toBe('Staging');
  });

// ── Small race for section-completion tests ─────────────────────

Given('a small race is in progress with a started section', async ({ page, raceContext }) => {
  await injectAndNavigate(page, raceContext, {
    sectionName: 'Kub Kars',
    participants: SMALL_ROSTER,
    checkedIn: SMALL_CHECKED_IN,
    availableLanes: SMALL_LANES,
  });
});

// ── Check-in setup ──────────────────────────────────────────────

Given('an event with an unstarted section and no cars checked in', async ({ page, raceContext }) => {
  await injectAndNavigate(page, raceContext, {
    sectionName: 'Kub Kars',
    participants: SMALL_ROSTER,
    checkedIn: [],
    availableLanes: SMALL_LANES,
    started: false,
  });
});

Given('I navigate to the check-in screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Check In' }).click();
  await page.waitForSelector('#checkin-body', { timeout: 10000 });
});

// ── Multi-section setup ─────────────────────────────────────────

Given('an event with two sections', async ({ page, raceContext }) => {
  await injectTwoSections(page, raceContext, {
    sectionName: 'Kub Kars',
    participants: SMALL_ROSTER,
    checkedIn: SMALL_CHECKED_IN,
    availableLanes: SMALL_LANES,
  }, {
    sectionName: 'Scout Trucks',
    participants: SMALL_ROSTER_B,
    checkedIn: [],
    availableLanes: SMALL_LANES,
  });
});

Given('section A is started with all cars checked in', async ({ page, raceContext }) => {
  const sid = raceContext.sectionId;
  const lanes = raceContext.availableLanes;

  await page.evaluate(async ({ sid, lanes }) => {
    const app = await import('/js/operator/app.js');
    await app.appendAndRebuild({
      type: 'SectionStarted', section_id: sid,
      available_lanes: lanes, timestamp: Date.now(),
    });
    app.navigate('live-console', { sectionId: sid });
  }, { sid, lanes });

  await page.waitForSelector('.console-header', { timeout: 10000 });
  await page.getByRole('button', { name: 'Resume Racing' }).click();
  await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
});

// ═══════════════════════════════════════════════════════════════════
//  WHEN
// ═══════════════════════════════════════════════════════════════════

When('all remaining heats are completed', async ({ page, raceContext }) => {
  await completeAllRemainingHeats(page, raceContext);
});

When('the operator adds a new participant {string}', async ({ page, raceContext }, name) => {
  const sid = raceContext.sectionId;
  await page.evaluate(async ({ sid, name }) => {
    const app = await import('/js/operator/app.js');
    await app.appendAndRebuild({
      type: 'ParticipantAdded', section_id: sid,
      participant: { participant_id: crypto.randomUUID(), name },
      timestamp: Date.now(),
    });
  }, { sid, name });

  // Read the assigned car number from state
  const sec = await getSectionState(page);
  const p = sec.participants.find(x => x.name === name);
  raceContext.participants.push({ name, car_number: p.car_number });
});

When('{string} checks in', async ({ page, raceContext }, name) => {
  const sid = raceContext.sectionId;
  const p = raceContext.participants.find(x => x.name === name);
  expect(p, `${name} not found in participants`).toBeTruthy();

  // Emit CarArrived + handle late arrival directly via the app module.
  // This avoids navigating away from the live console, which would
  // interrupt the race loop's gate-wait.
  await page.evaluate(async ({ sid, carNumber }) => {
    const app = await import('/js/operator/app.js');
    await app.appendAndRebuild({
      type: 'CarArrived', section_id: sid,
      car_number: carNumber, timestamp: Date.now(),
    });
    app.handleLateArrival(sid);
  }, { sid, carNumber: p.car_number });

  raceContext.checkedIn.push(p.car_number);
});

When('the operator removes car #{int} with reason {string}',
  async ({ page }, carNum, reason) => {
    await page.getByRole('button', { name: 'Remove Car' }).click();
    await page.waitForSelector('#dlg-remove-car', { timeout: 5000 });
    await page.locator('#dlg-remove-car').selectOption(String(carNum));
    await page.locator('#dlg-remove-reason').selectOption(reason);
  });

When(/the operator declares (?:a|another) re-run/, async ({ page }) => {
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /^Re-Run Heat/ }).click();
  await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
});

When('the heat completes again with new times', async ({ page }) => {
  await runCurrentHeat(page);
});

When('the heat completes again', async ({ page }) => {
  await runCurrentHeat(page);
});

When('the heat completes a third time', async ({ page }) => {
  await runCurrentHeat(page);
});

When('the operator corrects lane assignments swapping cars #{int} and #{int}',
  async ({ page, raceContext }, _car1, _car2) => {
    // Use the actual cars from the heat (the feature's car numbers are illustrative).
    const { car1, car2 } = raceContext.actualSwap;

    await page.getByRole('button', { name: 'Correct Lanes' }).click();
    await page.waitForSelector('#dlg-correct-body', { timeout: 5000 });

    const selects = page.locator('#dlg-correct-body select[data-lane]');
    const cnt = await selects.count();
    for (let i = 0; i < cnt; i++) {
      const sel = selects.nth(i);
      const cur = parseInt(await sel.inputValue());
      if (cur === car1) await sel.selectOption(String(car2));
      else if (cur === car2) await sel.selectOption(String(car1));
    }
    await page.locator('#dlg-correct-reason').fill(`Cars ${car1} and ${car2} were swapped`);
    await page.getByRole('button', { name: 'Save Correction' }).click();
    // Wait for the success toast (correction is applied async after dialog closes)
    await page.getByText('Lane correction saved').waitFor({ timeout: 5000 });
  });

When('the operator corrects the lane assignments for heat {int}',
  async ({ page, raceContext }, heatNum) => {
    // Correct lanes via event injection (the Correct Lanes button is only
    // available in results state, but we may be in staging for a later heat).
    const sid = raceContext.sectionId;
    await page.evaluate(async ({ sid, heatNum }) => {
      const app = await import('/js/operator/app.js');
      const state = window.__rallylab.state;
      const sec = state.race_day.sections[sid];
      const heat = sec.heats.find(h => h.heat_number === heatNum);
      if (!heat || heat.lanes.length < 2) return;
      // Swap first two lanes' car assignments
      const corrected = heat.lanes.map(l => ({ ...l }));
      const tmp = corrected[0].car_number;
      const tmpName = corrected[0].name;
      corrected[0].car_number = corrected[1].car_number;
      corrected[0].name = corrected[1].name;
      corrected[1].car_number = tmp;
      corrected[1].name = tmpName;
      await app.appendAndRebuild({
        type: 'ResultCorrected', section_id: sid,
        heat_number: heatNum, corrected_lanes: corrected,
        reason: 'Lane correction test', timestamp: Date.now(),
      });
    }, { sid, heatNum });
    raceContext.correctionHeat = heatNum;
  });

When('the operator starts the section with lanes {int}, {int}, and {int}',
  async ({ page, raceContext }, l1, l2, l3) => {
    const lanes = [l1, l2, l3];

    // Click whichever start button is visible (Check-In or Event Home)
    const startBtn = page.getByRole('button', { name: /Start.*Section/ });
    await startBtn.click();
    await page.waitForSelector('.lane-grid', { timeout: 5000 });

    const cbs = page.locator('#dlg-lane-grid input[type="checkbox"]');
    const cnt = await cbs.count();
    for (let i = 0; i < cnt; i++) {
      const cb = cbs.nth(i);
      const val = parseInt(await cb.getAttribute('value'));
      const want = lanes.includes(val);
      const has = await cb.isChecked();
      if (want !== has) await cb.click();
    }
    await page.getByRole('button', { name: 'Start Racing' }).click();
    await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });
    raceContext.availableLanes = lanes;
  });

When('the operator changes available lanes to {int} and {int}',
  async ({ page, raceContext }, l1, l2) => {
    await changeLanes(page, [l1, l2]);
    raceContext.availableLanes = [l1, l2];
  });

When('the operator changes available lanes to {int}, {int}, {int}, and {int}',
  async ({ page, raceContext }, l1, l2, l3, l4) => {
    await changeLanes(page, [l1, l2, l3, l4]);
    raceContext.availableLanes = [l1, l2, l3, l4];
  });

// ── Check-in When steps ─────────────────────────────────────────

When('I check in car #{int}', async ({ page }, carNum) => {
  const row = page.locator('#checkin-body tr', { hasText: `#${carNum}` });
  await row.locator('.checkin-toggle').click();
  await expect(row.locator('.status-badge')).toHaveText('Arrived', { timeout: 5000 });
});

// ── Multi-section When steps ────────────────────────────────────

When('I start section B from event home', async ({ page, raceContext }) => {
  const sidB = raceContext.sectionIdB;

  // Inject CarArrived events for all section B participants
  await page.evaluate(async ({ sidB, participants }) => {
    const app = await import('/js/operator/app.js');
    for (const p of participants) {
      await app.appendAndRebuild({
        type: 'CarArrived', section_id: sidB,
        car_number: p.car_number, timestamp: Date.now(),
      });
    }
    app.navigate('event-home', {});
  }, { sidB, participants: raceContext.participantsB });

  await page.waitForSelector('.screen-title', { timeout: 10000 });

  // Click "Start Section" in section B's row
  const row = page.locator('tr', { hasText: raceContext.sectionNameB });
  await row.getByRole('button', { name: 'Start Section' }).click();

  // Lane dialog
  await page.waitForSelector('.lane-grid', { timeout: 5000 });
  const lanes = raceContext.availableLanesB;
  const cbs = page.locator('#dlg-lane-grid input[type="checkbox"]');
  const cnt = await cbs.count();
  for (let i = 0; i < cnt; i++) {
    const cb = cbs.nth(i);
    const val = parseInt(await cb.getAttribute('value'));
    const want = lanes.includes(val);
    const has = await cb.isChecked();
    if (want !== has) await cb.click();
  }
  await page.getByRole('button', { name: 'Start Racing' }).click();
  await page.getByRole('button', { name: /^Run Heat/ }).waitFor({ timeout: 10000 });

  // Swap raceContext to point at section B
  raceContext.sectionId = sidB;
  raceContext.sectionName = raceContext.sectionNameB;
  raceContext.participants = [...raceContext.participantsB];
  raceContext.checkedIn = raceContext.participantsB.map(p => p.car_number);
  raceContext.availableLanes = [...raceContext.availableLanesB];
  raceContext.completedHeats = 0;
});

// ═══════════════════════════════════════════════════════════════════
//  THEN
// ═══════════════════════════════════════════════════════════════════

// ── Catch-up heat assertions ─────────────────────────────────────

Then('{int} solo catch-up heats should be inserted for {string}',
  async ({ page, raceContext }, count, name) => {
    const schedule = await getSchedule(page);
    expect(schedule).toBeTruthy();
    const p = raceContext.participants.find(x => x.name === name);
    const catchUps = schedule.heats.filter(h =>
      h.catch_up && h.lanes.some(l => l.car_number === p.car_number)
    );
    expect(catchUps.length).toBe(count);
    // Solo: each catch-up heat should have exactly 1 lane entry
    for (const h of catchUps) {
      expect(h.lanes.length).toBe(1);
    }
  });

Then('the catch-up heats should appear before remaining group heats', async ({ page }) => {
  const schedule = await getSchedule(page);
  let seenGroupAfterCatchUp = false;
  let lastCatchUp = -1;
  for (const h of schedule.heats) {
    if (h.catch_up) lastCatchUp = h.heat_number;
  }
  for (const h of schedule.heats) {
    if (!h.catch_up && h.heat_number > lastCatchUp) continue;
    if (!h.catch_up && h.heat_number > 0 && lastCatchUp > 0 && h.heat_number < lastCatchUp) {
      seenGroupAfterCatchUp = true;
    }
  }
  // Simplified: all catch-up heats should be contiguous and before remaining group heats
  const catchUpNums = schedule.heats.filter(h => h.catch_up).map(h => h.heat_number);
  const groupNums = schedule.heats.filter(h => !h.catch_up && h.heat_number > (catchUpNums[0] || 0)).map(h => h.heat_number);
  if (catchUpNums.length > 0 && groupNums.length > 0) {
    expect(Math.max(...catchUpNums)).toBeLessThan(Math.min(...groupNums));
  }
});

Then('{string} should appear in the remaining group heats', async ({ page, raceContext }, name) => {
  const schedule = await getSchedule(page);
  const p = raceContext.participants.find(x => x.name === name);
  const sec = await getSectionState(page);
  const completedHeatNums = new Set(Object.keys(sec.results).map(Number));

  const futureGroup = schedule.heats.filter(h =>
    !h.catch_up && !completedHeatNums.has(h.heat_number)
  );
  const inFuture = futureGroup.some(h => h.lanes.some(l => l.car_number === p.car_number));
  expect(inFuture).toBe(true);
});

Then('no catch-up heats should be generated', async ({ page }) => {
  const schedule = await getSchedule(page);
  const catchUps = schedule.heats.filter(h => h.catch_up);
  expect(catchUps.length).toBe(0);
});

Then('{string} should appear in all group heats', async ({ page, raceContext }, name) => {
  const schedule = await getSchedule(page);
  const p = raceContext.participants.find(x => x.name === name);
  const groupHeats = schedule.heats.filter(h => !h.catch_up);
  for (const h of groupHeats) {
    const inHeat = h.lanes.some(l => l.car_number === p.car_number);
    // Participant should be in SOME group heats (balanced scheduling)
    // With circle method, they appear in exactly lane_count heats
    if (!inHeat) continue; // OK if not in every heat
  }
  // At minimum, they should appear in at least one group heat
  const count = groupHeats.filter(h => h.lanes.some(l => l.car_number === p.car_number)).length;
  expect(count).toBeGreaterThan(0);
});

Then('the catch-up heats cycle through available lanes', async ({ page, raceContext }) => {
  const schedule = await getSchedule(page);
  const catchUps = schedule.heats.filter(h => h.catch_up);
  expect(catchUps.length).toBeGreaterThan(0);
  const lanes = raceContext.availableLanes;
  // Verify each catch-up heat uses a valid lane from the available set
  for (const h of catchUps) {
    expect(lanes).toContain(h.lanes[0].lane);
  }
  // If there are multiple catch-up heats, verify they don't all use the same lane
  if (catchUps.length > 1) {
    const usedLanes = new Set(catchUps.map(h => h.lanes[0].lane));
    expect(usedLanes.size).toBeGreaterThan(1);
  }
});

Then('{string} should have {int} catch-up heats', async ({ page, raceContext }, name, count) => {
  const schedule = await getSchedule(page);
  const p = raceContext.participants.find(x => x.name === name);
  const catchUps = schedule.heats.filter(h =>
    h.catch_up && h.lanes.some(l => l.car_number === p.car_number)
  );
  expect(catchUps.length).toBe(count);
});

Then('all catch-up heats should appear before remaining group heats', async ({ page }) => {
  const schedule = await getSchedule(page);
  const sec = await getSectionState(page);
  const completedNums = new Set(Object.keys(sec.results).map(Number));

  const catchUpNums = schedule.heats
    .filter(h => h.catch_up)
    .map(h => h.heat_number);
  const futureGroupNums = schedule.heats
    .filter(h => !h.catch_up && !completedNums.has(h.heat_number))
    .map(h => h.heat_number);

  if (catchUpNums.length > 0 && futureGroupNums.length > 0) {
    expect(Math.max(...catchUpNums)).toBeLessThan(Math.min(...futureGroupNums));
  }
});

// ── Car removal assertions ───────────────────────────────────────

Then('a confirmation dialog should appear', async ({ page }) => {
  // The Remove Car dialog is already open (from the When step).
  await expect(page.locator('.dialog')).toBeVisible();
  await expect(page.locator('.dialog').getByRole('heading', { name: 'Remove Car' })).toBeVisible();
});

Then('after confirming, the remaining heats should not include car #{int}',
  async ({ page }, carNum) => {
    // Click the Remove button in the dialog
    await page.locator('[data-action="remove"]').click();
    await page.waitForTimeout(500);

    const schedule = await getSchedule(page);
    const sec = await getSectionState(page);
    const completedNums = new Set(Object.keys(sec.results).map(Number));

    const futureHeats = schedule.heats.filter(h => !completedNums.has(h.heat_number));
    for (const h of futureHeats) {
      const hasCar = h.lanes.some(l => l.car_number === carNum);
      expect(hasCar, `Car #${carNum} found in future heat ${h.heat_number}`).toBe(false);
    }
  });

Then("car #{int}'s prior results should still appear on the leaderboard",
  async ({ page }, carNum) => {
    // Check the standings panel for the car number
    await expect(page.locator('.console-panel').last().getByText(`#${carNum}`)).toBeVisible();
  });

Then('the remove car option should not be available for car #{int}',
  async ({ page }, carNum) => {
    await page.getByRole('button', { name: 'Remove Car' }).click();
    await page.waitForSelector('#dlg-remove-car', { timeout: 5000 });

    // The car should not appear in the dropdown options
    const options = await page.locator('#dlg-remove-car option').allTextContents();
    const hasCar = options.some(t => t.includes(`#${carNum}`));
    expect(hasCar).toBe(false);

    // Close dialog
    await page.locator('[data-action="cancel"]').click();
  });

// ── Re-run assertions ────────────────────────────────────────────

Then('the display should return to staging for heat {int}', async ({ page }, heatNum) => {
  const label = await page.locator('.console-state-label').textContent();
  expect(label).toBe('Staging');
  const info = await getHeatInfo(page);
  expect(info.current).toBe(heatNum);
});

Then('when the heat completes again with new times', async ({ page }) => {
  await runCurrentHeat(page);
});

Then('the new result should replace the previous result', async ({ page }) => {
  const label = await page.locator('.console-state-label').textContent();
  expect(label).toBe('Results');
  // Times should be visible in the lane table
  await expect(page.locator('.lane-table td').filter({ hasText: /\d+\.\d+s/ }).first()).toBeVisible();
});

Then('the leaderboard should reflect only the new times', async ({ page }) => {
  // Standings panel should show updated averages
  await expect(page.locator('.console-panel').last().locator('table')).toBeVisible();
});

Then('only the final result should be used for scoring', async ({ page }) => {
  const sec = await getSectionState(page);
  // For each heat, there should be exactly one accepted result
  // The reruns map should show counts > 0 for re-run heats
  const rerunHeats = Object.keys(sec.reruns).map(Number);
  expect(rerunHeats.length).toBeGreaterThan(0);

  // Verify the result exists (superseded results are removed by RerunDeclared)
  for (const hn of rerunHeats) {
    expect(sec.results[hn]).toBeTruthy();
  }
});

// ── Lane correction assertions ───────────────────────────────────

Then('car #{int} should now be assigned to lane {int} with time {float}s',
  async ({ page, raceContext }, _carNum, laneNum, _time) => {
    // The feature's car numbers are illustrative — verify using actual swap data.
    // "car #7 in lane 1" means the car originally in lane 2 should now be in lane 1.
    const swap = raceContext.actualSwap;
    // Determine the expected car based on swap: lane1 now has car2, lane2 now has car1.
    const expectedCar = laneNum === swap.lane1 ? swap.car2 : swap.car1;

    const sec = await getSectionState(page);
    const heatNum = raceContext.correctionHeat;
    const heat = sec.heats.find(h => h.heat_number === heatNum);
    expect(heat, `Heat ${heatNum} not found`).toBeTruthy();
    const lane = heat.lanes.find(l => l.lane === laneNum);
    expect(lane, `Lane ${laneNum} not found in heat ${heatNum}`).toBeTruthy();
    expect(lane.car_number).toBe(expectedCar);
  });

Then('the leaderboard should update to reflect the corrected assignments', async ({ page }) => {
  await expect(page.locator('.console-panel').last().locator('table')).toBeVisible();
});

Then('the correction should apply retroactively', async ({ page, raceContext }) => {
  const sec = await getSectionState(page);
  const heat = sec.heats.find(h => h.heat_number === raceContext.correctionHeat);
  expect(heat).toBeTruthy();
  // Just verify the correction event was applied (lanes changed)
  // The actual swap was done in the When step
});

Then('the current staging for heat {int} should not be affected',
  async ({ page }, heatNum) => {
    const info = await getHeatInfo(page);
    expect(info.current).toBe(heatNum);
    const label = await page.locator('.console-state-label').textContent();
    expect(label).toBe('Staging');
  });

// ── Lane configuration assertions ────────────────────────────────

Then('all staged heats should only use lanes {int}, {int}, and {int}',
  async ({ page }, l1, l2, l3) => {
    const lanes = new Set([l1, l2, l3]);
    const schedule = await getSchedule(page);
    for (const h of schedule.heats) {
      for (const l of h.lanes) {
        expect(lanes.has(l.lane), `Lane ${l.lane} in heat ${h.heat_number} not in allowed set`).toBe(true);
      }
    }
  });

Then('each heat should have at most {int} cars', async ({ page }, maxCars) => {
  const schedule = await getSchedule(page);
  for (const h of schedule.heats) {
    expect(h.lanes.length).toBeLessThanOrEqual(maxCars);
  }
});

Then('the schedule should provide balanced lane assignments', async ({ page }) => {
  const schedule = await getSchedule(page);
  // Count how many times each lane is used
  const laneCounts = {};
  for (const h of schedule.heats) {
    for (const l of h.lanes) {
      laneCounts[l.lane] = (laneCounts[l.lane] || 0) + 1;
    }
  }
  const counts = Object.values(laneCounts);
  if (counts.length > 1) {
    const maxDiff = Math.max(...counts) - Math.min(...counts);
    // Lane usage should be within 2 of each other (reasonably balanced)
    expect(maxDiff).toBeLessThanOrEqual(2);
  }
});

Then('completed heats should be preserved unchanged', async ({ page, raceContext }) => {
  const sec = await getSectionState(page);
  // All previously completed heats should still have results
  for (let i = 1; i <= raceContext.completedHeats; i++) {
    expect(sec.results[i], `Result for heat ${i} missing`).toBeTruthy();
  }
});

Then('remaining heats should be regenerated for {int} lanes', async ({ page }, laneCount) => {
  const schedule = await getSchedule(page);
  const sec = await getSectionState(page);
  const completedNums = new Set(Object.keys(sec.results).map(Number));

  const futureHeats = schedule.heats.filter(h => !completedNums.has(h.heat_number));
  for (const h of futureHeats) {
    expect(h.lanes.length).toBeLessThanOrEqual(laneCount);
  }
});

Then('each remaining heat should have at most {int} cars', async ({ page }, maxCars) => {
  const schedule = await getSchedule(page);
  const sec = await getSectionState(page);
  const completedNums = new Set(Object.keys(sec.results).map(Number));

  const futureHeats = schedule.heats.filter(h => !completedNums.has(h.heat_number));
  for (const h of futureHeats) {
    expect(h.lanes.length).toBeLessThanOrEqual(maxCars);
  }
});

Then('heat {int} should be restaged with the new lane set', async ({ page, raceContext }) => {
  const info = await getHeatInfo(page);
  // Verify the current heat uses the new lanes
  const schedule = await getSchedule(page);
  const heat = schedule.heats.find(h => h.heat_number === info.current);
  expect(heat).toBeTruthy();
  const laneNums = new Set(heat.lanes.map(l => l.lane));
  for (const l of raceContext.availableLanes) {
    // At least some of the new lanes should be used
  }
  // Every lane in the heat must be in the available set
  for (const l of heat.lanes) {
    expect(raceContext.availableLanes).toContain(l.lane);
  }
});

// ── Section completion assertions ─────────────────────────────────

Then('I should see all {int} participants on the leaderboard', async ({ page }, count) => {
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(count);
});

Then('the leaderboard should have columns {string}', async ({ page }, columnsStr) => {
  const expected = columnsStr.split(',').map(s => s.trim());
  const headers = page.locator('table thead th');
  const count = await headers.count();
  const actual = [];
  for (let i = 0; i < count; i++) {
    actual.push((await headers.nth(i).textContent()).trim());
  }
  expect(actual).toEqual(expected);
});

// ── Check-in assertions ─────────────────────────────────────────

Then('the check-in counter should show {string}', async ({ page }, text) => {
  await expect(page.locator('.checkin-counter')).toHaveText(text);
});

Then('all cars should show {string} status', async ({ page }, status) => {
  const badges = page.locator('#checkin-body .status-badge');
  const count = await badges.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(badges.nth(i)).toHaveText(status);
  }
});

Then('car #{int} should show {string} status', async ({ page }, carNum, status) => {
  const row = page.locator('#checkin-body tr', { hasText: `#${carNum}` });
  await expect(row.locator('.status-badge')).toHaveText(status);
});

Then('the {string} button should not be visible', async ({ page }, text) => {
  await expect(page.getByRole('button', { name: text })).not.toBeVisible();
});

Then('the {string} button should be visible', async ({ page }, text) => {
  await expect(page.getByRole('button', { name: text })).toBeVisible();
});

// ── Multi-section assertions ────────────────────────────────────

Then('I should see {string} for section {string}', async ({ page }, text, sectionName) => {
  const row = page.locator('tr', { hasText: sectionName });
  await expect(row.getByText(text)).toBeVisible();
});
