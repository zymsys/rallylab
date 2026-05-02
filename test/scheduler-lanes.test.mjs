/**
 * Unit tests for regenerateAfterLaneChange in scheduler.js
 *
 * Trevor reported that mid-rally lane changes used to bounce the heat
 * counter back to 1. These tests pin down the contract: completed heats
 * are kept verbatim, and new heats are numbered after the last completed
 * one.
 *
 * Run with: node --test test/scheduler-lanes.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, regenerateAfterLaneChange } from '../public/js/scheduler.js';

function participants(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ car_number: String(i), name: `Car ${i}` });
  }
  return out;
}

describe('regenerateAfterLaneChange', () => {
  it('does not reset heat numbering when lanes drop mid-rally', () => {
    const ps = participants(6);
    const original = generateSchedule({ participants: ps, available_lanes: [1, 2, 3, 4] });

    // Pretend heats 1..3 ran on the original schedule.
    const merged = regenerateAfterLaneChange(original, ps, 3, [1, 2, 3]);

    const heatNumbers = merged.heats.map(h => h.heat_number);
    assert.ok(heatNumbers.length > 3, 'expected new heats appended after completed ones');
    assert.deepStrictEqual(
      heatNumbers.slice(0, 3),
      [1, 2, 3],
      'completed heats kept their numbers'
    );
    assert.strictEqual(heatNumbers[3], 4, 'first new heat picks up at last_completed + 1');
    for (let i = 1; i < heatNumbers.length; i++) {
      assert.strictEqual(
        heatNumbers[i],
        heatNumbers[i - 1] + 1,
        `heat numbers monotonically increase (broke at index ${i})`
      );
    }
  });

  it('preserves completed heat lane assignments verbatim', () => {
    const ps = participants(5);
    const original = generateSchedule({ participants: ps, available_lanes: [1, 2, 3, 4] });
    const completed = original.heats.slice(0, 2);

    const merged = regenerateAfterLaneChange(original, ps, 2, [1, 2, 3]);

    assert.deepStrictEqual(merged.heats[0], completed[0]);
    assert.deepStrictEqual(merged.heats[1], completed[1]);
  });

  it('starts numbering at 1 when no heats have completed yet', () => {
    const ps = participants(4);
    const original = generateSchedule({ participants: ps, available_lanes: [1, 2, 3, 4] });

    const merged = regenerateAfterLaneChange(original, ps, 0, [1, 2, 3]);

    assert.strictEqual(merged.heats[0].heat_number, 1);
    for (let i = 1; i < merged.heats.length; i++) {
      assert.strictEqual(merged.heats[i].heat_number, merged.heats[i - 1].heat_number + 1);
    }
  });

  it('uses the new available_lanes when generating the tail of the schedule', () => {
    const ps = participants(6);
    const original = generateSchedule({ participants: ps, available_lanes: [1, 2, 3, 4] });

    const merged = regenerateAfterLaneChange(original, ps, 2, [1, 2, 3]);

    const newHeats = merged.heats.filter(h => h.heat_number > 2);
    assert.ok(newHeats.length > 0);
    for (const heat of newHeats) {
      for (const assignment of heat.lanes) {
        assert.ok(
          [1, 2, 3].includes(assignment.lane),
          `heat ${heat.heat_number} placed a car on lane ${assignment.lane} which is no longer available`
        );
      }
    }
    assert.deepStrictEqual(merged.metadata.available_lanes, [1, 2, 3]);
  });

  it('reports total_heats as completed + newly generated', () => {
    const ps = participants(6);
    const original = generateSchedule({ participants: ps, available_lanes: [1, 2, 3, 4] });

    const merged = regenerateAfterLaneChange(original, ps, 4, [1, 2, 3]);

    const newHeatCount = merged.heats.filter(h => h.heat_number > 4).length;
    assert.strictEqual(merged.metadata.total_heats, 4 + newHeatCount);
  });

  it('handles a missing or empty incoming schedule', () => {
    const ps = participants(4);

    const fromNull = regenerateAfterLaneChange(null, ps, 0, [1, 2, 3]);
    assert.strictEqual(fromNull.heats[0].heat_number, 1);

    const fromEmpty = regenerateAfterLaneChange({ heats: [] }, ps, 0, [1, 2, 3]);
    assert.strictEqual(fromEmpty.heats[0].heat_number, 1);
  });

  it('throws when fewer than 2 participants remain', () => {
    assert.throws(
      () => regenerateAfterLaneChange({ heats: [] }, participants(1), 0, [1, 2, 3]),
      /at least 2 participants/
    );
  });
});
