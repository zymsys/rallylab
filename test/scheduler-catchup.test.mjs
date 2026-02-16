/**
 * Unit tests for generateCatchUpHeats in scheduler.js
 * Run with: node --test test/scheduler-catchup.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCatchUpHeats } from '../public/js/scheduler.js';

const participant = { car_number: 7, name: 'Alice' };

describe('generateCatchUpHeats', () => {
  it('returns empty array when catchUpCount is 0', () => {
    const heats = generateCatchUpHeats(participant, 0, [1,2,3,4], 10);
    assert.deepStrictEqual(heats, []);
  });

  it('generates correct number of heats', () => {
    const heats = generateCatchUpHeats(participant, 3, [1,2,3,4], 10);
    assert.strictEqual(heats.length, 3);
  });

  it('numbers heats starting from startHeatNumber', () => {
    const heats = generateCatchUpHeats(participant, 3, [1,2,3,4], 10);
    assert.strictEqual(heats[0].heat_number, 10);
    assert.strictEqual(heats[1].heat_number, 11);
    assert.strictEqual(heats[2].heat_number, 12);
  });

  it('cycles through available lanes', () => {
    const heats = generateCatchUpHeats(participant, 5, [1,2,3], 1);
    assert.strictEqual(heats[0].lanes[0].lane, 1);
    assert.strictEqual(heats[1].lanes[0].lane, 2);
    assert.strictEqual(heats[2].lanes[0].lane, 3);
    assert.strictEqual(heats[3].lanes[0].lane, 1); // wraps
    assert.strictEqual(heats[4].lanes[0].lane, 2); // wraps
  });

  it('marks all heats as catch_up', () => {
    const heats = generateCatchUpHeats(participant, 3, [1,2,3,4], 1);
    for (const heat of heats) {
      assert.strictEqual(heat.catch_up, true);
    }
  });

  it('each heat has a single lane entry with correct participant', () => {
    const heats = generateCatchUpHeats(participant, 2, [1,2,3,4], 1);
    for (const heat of heats) {
      assert.strictEqual(heat.lanes.length, 1);
      assert.strictEqual(heat.lanes[0].car_number, 7);
      assert.strictEqual(heat.lanes[0].name, 'Alice');
    }
  });

  it('works with 1 lane', () => {
    const heats = generateCatchUpHeats(participant, 3, [1], 1);
    assert.strictEqual(heats.length, 3);
    for (const heat of heats) {
      assert.strictEqual(heat.lanes[0].lane, 1);
    }
  });

  it('cycles through non-contiguous lanes', () => {
    const heats = generateCatchUpHeats(participant, 5, [1,3,5], 1);
    assert.strictEqual(heats[0].lanes[0].lane, 1);
    assert.strictEqual(heats[1].lanes[0].lane, 3);
    assert.strictEqual(heats[2].lanes[0].lane, 5);
    assert.strictEqual(heats[3].lanes[0].lane, 1); // wraps
    assert.strictEqual(heats[4].lanes[0].lane, 3); // wraps
  });
});
