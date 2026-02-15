/**
 * Unit tests for race day event handlers in state-manager.js
 * Run with: node --test test/state-manager-raceday.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, applyEvent, rebuildState,
  deriveRaceDayPhase, getCurrentHeat, getAcceptedResult
} from '../public/js/state-manager.js';

// ─── Helpers ──────────────────────────────────────────────────────

function makeEvent(payload) {
  return { payload };
}

function buildState(payloads) {
  return payloads.reduce(
    (state, p) => applyEvent(state, makeEvent(p)),
    initialState()
  );
}

function baseRosterPayload() {
  return {
    type: 'RosterLoaded',
    section_id: 's1',
    section_name: 'Kub Kars',
    participants: [
      { participant_id: 'p1', name: 'Alice', car_number: 1 },
      { participant_id: 'p2', name: 'Bob', car_number: 2 },
      { participant_id: 'p3', name: 'Carol', car_number: 3 }
    ]
  };
}

// ─── RosterLoaded ────────────────────────────────────────────────

describe('RosterLoaded', () => {
  it('populates race_day section with participants', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    const sec = s.race_day.sections.s1;
    assert.ok(sec);
    assert.strictEqual(sec.participants.length, 3);
    assert.strictEqual(sec.section_name, 'Kub Kars');
    assert.strictEqual(sec.started, false);
    assert.strictEqual(sec.completed, false);
    assert.deepStrictEqual(sec.arrived, []);
    assert.deepStrictEqual(sec.removed, []);
    assert.deepStrictEqual(sec.heats, []);
    assert.deepStrictEqual(sec.results, {});
    assert.deepStrictEqual(sec.reruns, {});
  });

  it('sets loaded flag to true', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    assert.strictEqual(s.race_day.loaded, true);
  });

  it('preserves participant details', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    const alice = s.race_day.sections.s1.participants[0];
    assert.strictEqual(alice.participant_id, 'p1');
    assert.strictEqual(alice.name, 'Alice');
    assert.strictEqual(alice.car_number, 1);
  });

  it('loads multiple sections', () => {
    const s = buildState([
      baseRosterPayload(),
      {
        type: 'RosterLoaded',
        section_id: 's2',
        section_name: 'Scout Trucks',
        participants: [
          { participant_id: 'p4', name: 'Dave', car_number: 1 }
        ]
      }
    ]);
    assert.strictEqual(Object.keys(s.race_day.sections).length, 2);
    assert.ok(s.race_day.sections.s1);
    assert.ok(s.race_day.sections.s2);
  });
});

// ─── CarArrived ──────────────────────────────────────────────────

describe('CarArrived', () => {
  it('adds car_number to arrived list', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });

  it('accumulates multiple arrivals', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 },
      { type: 'CarArrived', section_id: 's1', car_number: 2 },
      { type: 'CarArrived', section_id: 's1', car_number: 3 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1, 2, 3]);
  });

  it('ignores duplicate arrivals', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 },
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });

  it('ignores unknown section', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 'unknown', car_number: 1 }
    ]);
    assert.strictEqual(s.race_day.sections.unknown, undefined);
  });
});

// ─── SectionStarted ─────────────────────────────────────────────

describe('SectionStarted', () => {
  it('sets started flag and active_section_id', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' }
    ]);
    assert.strictEqual(s.race_day.sections.s1.started, true);
    assert.strictEqual(s.race_day.active_section_id, 's1');
  });
});

// ─── HeatStaged ─────────────────────────────────────────────────

describe('HeatStaged', () => {
  it('pushes heat to heats array', () => {
    const lanes = [
      { lane: 1, car_number: 1, name: 'Alice' },
      { lane: 2, car_number: 2, name: 'Bob' }
    ];
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats.length, 1);
    assert.strictEqual(s.race_day.sections.s1.heats[0].heat_number, 1);
    assert.deepStrictEqual(s.race_day.sections.s1.heats[0].lanes, lanes);
  });

  it('accumulates heats', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] },
      { type: 'HeatStaged', section_id: 's1', heat_number: 2, lanes: [] }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats.length, 2);
  });
});

// ─── RaceCompleted ──────────────────────────────────────────────

describe('RaceCompleted', () => {
  it('stores result keyed by heat_number', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500, '2': 2700 },
        timestamp: 1000
      }
    ]);
    const result = s.race_day.sections.s1.results[1];
    assert.ok(result);
    assert.strictEqual(result.type, 'RaceCompleted');
    assert.strictEqual(result.times_ms['1'], 2500);
    assert.strictEqual(result.timestamp, 1000);
  });

  it('supersedes earlier result for same heat (latest wins)', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2600 },
        timestamp: 2000
      }
    ]);
    const result = s.race_day.sections.s1.results[1];
    assert.strictEqual(result.times_ms['1'], 2600);
    assert.strictEqual(result.timestamp, 2000);
  });
});

// ─── ResultManuallyEntered ──────────────────────────────────────

describe('ResultManuallyEntered', () => {
  it('stores manual ranking result', () => {
    const rankings = [
      { car_number: 1, place: 1 },
      { car_number: 2, place: 2 }
    ];
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'ResultManuallyEntered',
        section_id: 's1',
        heat_number: 1,
        rankings,
        timestamp: 1000
      }
    ]);
    const result = s.race_day.sections.s1.results[1];
    assert.strictEqual(result.type, 'ResultManuallyEntered');
    assert.deepStrictEqual(result.rankings, rankings);
  });

  it('supersedes RaceCompleted for same heat', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      },
      {
        type: 'ResultManuallyEntered',
        section_id: 's1',
        heat_number: 1,
        rankings: [{ car_number: 1, place: 1 }],
        timestamp: 2000
      }
    ]);
    const result = s.race_day.sections.s1.results[1];
    assert.strictEqual(result.type, 'ResultManuallyEntered');
  });
});

// ─── RerunDeclared ──────────────────────────────────────────────

describe('RerunDeclared', () => {
  it('increments rerun count and clears accepted result', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      },
      { type: 'RerunDeclared', section_id: 's1', heat_number: 1 }
    ]);
    assert.strictEqual(s.race_day.sections.s1.reruns[1], 1);
    assert.strictEqual(s.race_day.sections.s1.results[1], undefined);
  });

  it('increments rerun count on multiple reruns', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      },
      { type: 'RerunDeclared', section_id: 's1', heat_number: 1 },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2600 },
        timestamp: 2000
      },
      { type: 'RerunDeclared', section_id: 's1', heat_number: 1 }
    ]);
    assert.strictEqual(s.race_day.sections.s1.reruns[1], 2);
    assert.strictEqual(s.race_day.sections.s1.results[1], undefined);
  });
});

// ─── CarRemoved ─────────────────────────────────────────────────

describe('CarRemoved', () => {
  it('adds car_number to removed list', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarRemoved', section_id: 's1', car_number: 2 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.removed, [2]);
  });

  it('ignores duplicate removals', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarRemoved', section_id: 's1', car_number: 2 },
      { type: 'CarRemoved', section_id: 's1', car_number: 2 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.removed, [2]);
  });
});

// ─── SectionCompleted ───────────────────────────────────────────

describe('SectionCompleted', () => {
  it('sets completed flag', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'SectionCompleted', section_id: 's1' }
    ]);
    assert.strictEqual(s.race_day.sections.s1.completed, true);
  });
});

// ─── deriveRaceDayPhase ─────────────────────────────────────────

describe('deriveRaceDayPhase', () => {
  it('returns idle when not loaded', () => {
    const s = initialState();
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'idle');
  });

  it('returns event-loaded when section not found', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    assert.strictEqual(deriveRaceDayPhase(s, 'nonexistent'), 'event-loaded');
  });

  it('returns check-in before section started', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'check-in');
  });

  it('returns staging when heat staged but no result', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'staging');
  });

  it('returns results when last heat has result', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'results');
  });

  it('returns staging after rerun declared', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      },
      { type: 'RerunDeclared', section_id: 's1', heat_number: 1 }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'staging');
  });

  it('returns section-complete when completed', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'SectionCompleted', section_id: 's1' }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'section-complete');
  });
});

// ─── getCurrentHeat ─────────────────────────────────────────────

describe('getCurrentHeat', () => {
  it('returns 0 when no heats staged', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    assert.strictEqual(getCurrentHeat(s, 's1'), 0);
  });

  it('returns last staged heat number', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] },
      { type: 'HeatStaged', section_id: 's1', heat_number: 2, lanes: [] }
    ]);
    assert.strictEqual(getCurrentHeat(s, 's1'), 2);
  });
});

// ─── getAcceptedResult ──────────────────────────────────────────

describe('getAcceptedResult', () => {
  it('returns null when no result', () => {
    const s = applyEvent(initialState(), makeEvent(baseRosterPayload()));
    const sec = s.race_day.sections.s1;
    assert.strictEqual(getAcceptedResult(sec, 1), null);
  });

  it('returns the result for given heat', () => {
    const s = buildState([
      baseRosterPayload(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500 },
        timestamp: 1000
      }
    ]);
    const sec = s.race_day.sections.s1;
    const result = getAcceptedResult(sec, 1);
    assert.ok(result);
    assert.strictEqual(result.type, 'RaceCompleted');
  });
});

// ─── Pre-race events still work with race_day state ─────────────

describe('Integration: pre-race + race day coexistence', () => {
  it('both state trees are maintained', () => {
    const s = buildState([
      { type: 'EventCreated', event_id: 'e1', event_name: 'Rally', event_date: '2026-03-15', created_by: 'org@x.com' },
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      baseRosterPayload(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.strictEqual(s.event_name, 'Rally');
    assert.strictEqual(s.sections.s1.section_name, 'Kub Kars');
    assert.strictEqual(s.race_day.sections.s1.section_name, 'Kub Kars');
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });
});
