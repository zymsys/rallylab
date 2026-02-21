/**
 * Unit tests for scoring.js
 * Run with: node --test test/scoring.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLeaderboard, getAcceptedResults,
  sectionAverageTime, syntheticTimesFromRanking
} from '../public/js/scoring.js';

// ─── Helpers ──────────────────────────────────────────────────────

function makeSection({ participants, heats, results, removed = [] }) {
  return {
    participants,
    heats,
    results,
    removed,
    arrived: participants.map(p => p.car_number),
    started: true,
    completed: false,
    reruns: {}
  };
}

const alice = { participant_id: 'p1', name: 'Alice', car_number: 1 };
const bob = { participant_id: 'p2', name: 'Bob', car_number: 2 };
const carol = { participant_id: 'p3', name: 'Carol', car_number: 3 };

// ─── getAcceptedResults ─────────────────────────────────────────

describe('getAcceptedResults', () => {
  it('returns all results from section.results map', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2500, '2': 2700 }, timestamp: 100 },
        2: { type: 'RaceCompleted', heat_number: 2, times_ms: { '1': 2600, '2': 2800 }, timestamp: 200 }
      }
    });
    const accepted = getAcceptedResults(section);
    assert.strictEqual(accepted.length, 2);
  });
});

// ─── sectionAverageTime ─────────────────────────────────────────

describe('sectionAverageTime', () => {
  it('computes average across all timed results', () => {
    const results = [
      { type: 'RaceCompleted', times_ms: { '1': 2000, '2': 3000 } },
      { type: 'RaceCompleted', times_ms: { '1': 2500, '2': 2500 } }
    ];
    assert.strictEqual(sectionAverageTime(results), 2500);
  });

  it('returns null when no timed results', () => {
    const results = [
      { type: 'ResultManuallyEntered', rankings: [{ car_number: 1, place: 1 }] }
    ];
    assert.strictEqual(sectionAverageTime(results), null);
  });

  it('ignores manual results', () => {
    const results = [
      { type: 'RaceCompleted', times_ms: { '1': 2000 } },
      { type: 'ResultManuallyEntered', rankings: [] }
    ];
    assert.strictEqual(sectionAverageTime(results), 2000);
  });
});

// ─── syntheticTimesFromRanking ──────────────────────────────────

describe('syntheticTimesFromRanking', () => {
  it('uses section average as baseline', () => {
    const rankings = [
      { car_number: 1, place: 1 },
      { car_number: 2, place: 2 },
      { car_number: 3, place: 3 }
    ];
    const times = syntheticTimesFromRanking(rankings, 2500);
    assert.strictEqual(times[1], 2500);
    assert.strictEqual(times[2], 2550);
    assert.strictEqual(times[3], 2600);
  });

  it('uses 3000ms baseline when no timed results', () => {
    const rankings = [{ car_number: 1, place: 1 }];
    const times = syntheticTimesFromRanking(rankings, null);
    assert.strictEqual(times[1], 3000);
  });
});

// ─── computeLeaderboard ─────────────────────────────────────────

describe('computeLeaderboard — timed heats', () => {
  it('ranks by average time ascending', () => {
    const section = makeSection({
      participants: [alice, bob, carol],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' }
        ]},
        { heat_number: 2, lanes: [
          { lane: 1, car_number: 2, name: 'Bob' },
          { lane: 2, car_number: 3, name: 'Carol' }
        ]},
        { heat_number: 3, lanes: [
          { lane: 1, car_number: 3, name: 'Carol' },
          { lane: 2, car_number: 1, name: 'Alice' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2000, '2': 2500 }, timestamp: 100 },
        2: { type: 'RaceCompleted', heat_number: 2, times_ms: { '1': 2400, '2': 2200 }, timestamp: 200 },
        3: { type: 'RaceCompleted', heat_number: 3, times_ms: { '1': 2300, '2': 2100 }, timestamp: 300 }
      }
    });

    const standings = computeLeaderboard(section);
    assert.strictEqual(standings.length, 3);

    // Alice: heat1 lane1=2000, heat3 lane2=2100 → avg 2050
    assert.strictEqual(standings[0].name, 'Alice');
    assert.strictEqual(standings[0].avg_time_ms, 2050);
    assert.strictEqual(standings[0].rank, 1);

    // Carol: heat2 lane2=2200, heat3 lane1=2300 → avg 2250
    assert.strictEqual(standings[1].name, 'Carol');
    assert.strictEqual(standings[1].avg_time_ms, 2250);
    assert.strictEqual(standings[1].rank, 2);

    // Bob: heat1 lane2=2500, heat2 lane1=2400 → avg 2450
    assert.strictEqual(standings[2].name, 'Bob');
    assert.strictEqual(standings[2].avg_time_ms, 2450);
    assert.strictEqual(standings[2].rank, 3);
  });

  it('tie-breaks by best single heat time', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' }
        ]},
        { heat_number: 2, lanes: [
          { lane: 1, car_number: 2, name: 'Bob' },
          { lane: 2, car_number: 1, name: 'Alice' }
        ]}
      ],
      results: {
        // Both average to 2500, but Alice has a better best (2400 vs 2450)
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2400, '2': 2450 }, timestamp: 100 },
        2: { type: 'RaceCompleted', heat_number: 2, times_ms: { '1': 2550, '2': 2600 }, timestamp: 200 }
      }
    });

    const standings = computeLeaderboard(section);
    // Alice avg = (2400+2600)/2 = 2500, best = 2400
    // Bob avg = (2450+2550)/2 = 2500, best = 2450
    assert.strictEqual(standings[0].name, 'Alice');
    assert.strictEqual(standings[1].name, 'Bob');
  });
});

describe('computeLeaderboard — manual heats', () => {
  it('uses synthetic times for manual rankings', () => {
    const section = makeSection({
      participants: [alice, bob, carol],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' },
          { lane: 3, car_number: 3, name: 'Carol' }
        ]}
      ],
      results: {
        1: {
          type: 'ResultManuallyEntered',
          heat_number: 1,
          rankings: [
            { car_number: 2, place: 1 },
            { car_number: 1, place: 2 },
            { car_number: 3, place: 3 }
          ],
          timestamp: 100
        }
      }
    });

    const standings = computeLeaderboard(section);
    // No timed heats → baseline 3000, offset 50
    // Bob: 3000 (1st), Alice: 3050 (2nd), Carol: 3100 (3rd)
    assert.strictEqual(standings[0].name, 'Bob');
    assert.strictEqual(standings[1].name, 'Alice');
    assert.strictEqual(standings[2].name, 'Carol');
  });
});

describe('computeLeaderboard — mixed timed and manual', () => {
  it('blends real and synthetic times', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' }
        ]},
        { heat_number: 2, lanes: [
          { lane: 1, car_number: 2, name: 'Bob' },
          { lane: 2, car_number: 1, name: 'Alice' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2400, '2': 2600 }, timestamp: 100 },
        2: {
          type: 'ResultManuallyEntered',
          heat_number: 2,
          rankings: [
            { car_number: 1, place: 1 },
            { car_number: 2, place: 2 }
          ],
          timestamp: 200
        }
      }
    });

    const standings = computeLeaderboard(section);
    // Section avg from heat 1: (2400+2600)/2 = 2500
    // Alice: timed 2400 + synthetic 2500 = avg 2450
    // Bob: timed 2600 + synthetic 2550 = avg 2575
    assert.strictEqual(standings[0].name, 'Alice');
    assert.strictEqual(standings[1].name, 'Bob');
  });
});

describe('computeLeaderboard — removed cars', () => {
  it('excludes removed participants even if they ran heats', () => {
    const section = makeSection({
      participants: [alice, bob, carol],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' },
          { lane: 3, car_number: 3, name: 'Carol' }
        ]},
        { heat_number: 2, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 3, name: 'Carol' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2800, '2': 2000, '3': 2500 }, timestamp: 100 },
        2: { type: 'RaceCompleted', heat_number: 2, times_ms: { '1': 2700, '2': 2600 }, timestamp: 200 }
      },
      removed: [2] // Bob removed after heat 1
    });

    const standings = computeLeaderboard(section);
    // Bob excluded entirely despite having fastest time
    assert.strictEqual(standings.length, 2);
    assert.strictEqual(standings[0].name, 'Carol');
    assert.strictEqual(standings[1].name, 'Alice');
    assert.ok(standings.every(s => s.name !== 'Bob'));
  });

  it('excludes removed participants with zero heats', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2500 }, timestamp: 100 }
      },
      removed: [2] // Bob removed before any heats
    });

    const standings = computeLeaderboard(section);
    assert.strictEqual(standings.length, 1);
    assert.strictEqual(standings[0].name, 'Alice');
  });
});

describe('computeLeaderboard — participants who never raced', () => {
  it('excludes registered participants who never checked in', () => {
    const section = makeSection({
      participants: [alice, bob, carol],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2200, '2': 2400 }, timestamp: 100 }
      }
    });

    const standings = computeLeaderboard(section);
    // Carol registered but never scheduled/raced — excluded
    assert.strictEqual(standings.length, 2);
    assert.ok(standings.every(s => s.name !== 'Carol'));
  });

  it('excludes all participants when no heats have run', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [],
      results: {}
    });
    const standings = computeLeaderboard(section);
    assert.strictEqual(standings.length, 0);
  });

  it('only includes participants with results in a small section', () => {
    const section = makeSection({
      participants: [alice, bob, carol],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2500 }, timestamp: 100 }
      }
    });

    const standings = computeLeaderboard(section);
    // Only Alice raced — Bob and Carol excluded even though section is small
    assert.strictEqual(standings.length, 1);
    assert.strictEqual(standings[0].name, 'Alice');
  });
});

describe('computeLeaderboard — edge cases', () => {
  it('handles single heat', () => {
    const section = makeSection({
      participants: [alice, bob],
      heats: [
        { heat_number: 1, lanes: [
          { lane: 1, car_number: 1, name: 'Alice' },
          { lane: 2, car_number: 2, name: 'Bob' }
        ]}
      ],
      results: {
        1: { type: 'RaceCompleted', heat_number: 1, times_ms: { '1': 2200, '2': 2400 }, timestamp: 100 }
      }
    });

    const standings = computeLeaderboard(section);
    assert.strictEqual(standings[0].name, 'Alice');
    assert.strictEqual(standings[0].avg_time_ms, 2200);
    assert.strictEqual(standings[0].best_time_ms, 2200);
  });
});
