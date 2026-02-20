/**
 * Unit tests for race day event handlers in state-manager.js
 * Run with: node --test test/state-manager-raceday.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, applyEvent, rebuildState,
  nextAvailableCarNumber, deriveRaceDayPhase, getCurrentHeat, getAcceptedResult
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

/**
 * Returns an array of SectionCreated + RosterUpdated events that
 * populate both pre-race and race_day sections with 3 participants.
 */
function baseRosterPayloads() {
  return [
    {
      type: 'SectionCreated',
      section_id: 's1',
      section_name: 'Kub Kars'
    },
    {
      type: 'RosterUpdated',
      section_id: 's1',
      participants: [
        { participant_id: 'p1', name: 'Alice' },
        { participant_id: 'p2', name: 'Bob' },
        { participant_id: 'p3', name: 'Carol' }
      ]
    }
  ];
}

// ─── SectionCreated + RosterUpdated populates race_day ────────────

describe('SectionCreated + RosterUpdated populates race_day', () => {
  it('populates race_day section with participants', () => {
    const s = buildState(baseRosterPayloads());
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
    const s = buildState(baseRosterPayloads());
    assert.strictEqual(s.race_day.loaded, true);
  });

  it('preserves participant details with auto-assigned car numbers', () => {
    const s = buildState(baseRosterPayloads());
    const alice = s.race_day.sections.s1.participants[0];
    assert.strictEqual(alice.participant_id, 'p1');
    assert.strictEqual(alice.name, 'Alice');
    assert.strictEqual(alice.car_number, 1);
  });

  it('initializes available_lanes as null', () => {
    const s = buildState(baseRosterPayloads());
    assert.strictEqual(s.race_day.sections.s1.available_lanes, null);
  });

  it('loads multiple sections', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      {
        type: 'SectionCreated',
        section_id: 's2',
        section_name: 'Scout Trucks'
      },
      {
        type: 'RosterUpdated',
        section_id: 's2',
        participants: [
          { participant_id: 'p4', name: 'Dave' }
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
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });

  it('accumulates multiple arrivals', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 },
      { type: 'CarArrived', section_id: 's1', car_number: 2 },
      { type: 'CarArrived', section_id: 's1', car_number: 3 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1, 2, 3]);
  });

  it('ignores duplicate arrivals', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 },
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });

  it('ignores unknown section', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 'unknown', car_number: 1 }
    ]);
    assert.strictEqual(s.race_day.sections.unknown, undefined);
  });
});

// ─── SectionStarted ─────────────────────────────────────────────

describe('SectionStarted', () => {
  it('sets started flag and active_section_id', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' }
    ]);
    assert.strictEqual(s.race_day.sections.s1.started, true);
    assert.strictEqual(s.race_day.active_section_id, 's1');
  });

  it('stores available_lanes when provided', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1', available_lanes: [1, 3, 5] }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.available_lanes, [1, 3, 5]);
  });

  it('keeps available_lanes as null when not provided', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' }
    ]);
    assert.strictEqual(s.race_day.sections.s1.available_lanes, null);
  });
});

// ─── LanesChanged ───────────────────────────────────────────────

describe('LanesChanged', () => {
  it('updates available_lanes on the section', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1', available_lanes: [1, 2, 3, 4, 5, 6] },
      { type: 'LanesChanged', section_id: 's1', available_lanes: [1, 3, 5] }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.available_lanes, [1, 3, 5]);
  });

  it('ignores unknown section', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'LanesChanged', section_id: 'unknown', available_lanes: [1, 2] }
    ]);
    assert.strictEqual(s.race_day.sections.unknown, undefined);
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
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats.length, 1);
    assert.strictEqual(s.race_day.sections.s1.heats[0].heat_number, 1);
    assert.deepStrictEqual(s.race_day.sections.s1.heats[0].lanes, lanes);
  });

  it('accumulates heats', () => {
    const s = buildState([
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
      { type: 'CarRemoved', section_id: 's1', car_number: 2 }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.removed, [2]);
  });

  it('ignores duplicate removals', () => {
    const s = buildState([
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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

  it('returns rally-loaded when section not found', () => {
    const s = buildState(baseRosterPayloads());
    assert.strictEqual(deriveRaceDayPhase(s, 'nonexistent'), 'rally-loaded');
  });

  it('returns check-in before section started', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'check-in');
  });

  it('returns staging when heat staged but no result', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'staging');
  });

  it('returns results when last heat has result', () => {
    const s = buildState([
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
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
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'SectionCompleted', section_id: 's1' }
    ]);
    assert.strictEqual(deriveRaceDayPhase(s, 's1'), 'section-complete');
  });
});

// ─── getCurrentHeat ─────────────────────────────────────────────

describe('getCurrentHeat', () => {
  it('returns 0 when no heats staged', () => {
    const s = buildState(baseRosterPayloads());
    assert.strictEqual(getCurrentHeat(s, 's1'), 0);
  });

  it('returns last staged heat number', () => {
    const s = buildState([
      ...baseRosterPayloads(),
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
    const s = buildState(baseRosterPayloads());
    const sec = s.race_day.sections.s1;
    assert.strictEqual(getAcceptedResult(sec, 1), null);
  });

  it('returns the result for given heat', () => {
    const s = buildState([
      ...baseRosterPayloads(),
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

// ─── ParticipantAdded (race day context) ─────────────────────────

describe('ParticipantAdded in race_day context', () => {
  it('adds participant to race_day.sections with correct auto car number', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        participant: { participant_id: 'p4', name: 'Dave' }
      }
    ]);
    const rdSec = s.race_day.sections.s1;
    assert.strictEqual(rdSec.participants.length, 4);
    const dave = rdSec.participants.find(p => p.participant_id === 'p4');
    assert.ok(dave);
    assert.strictEqual(dave.name, 'Dave');
    assert.strictEqual(dave.car_number, 4); // next after 1, 2, 3
  });

  it('fills gaps in pre-race car numbers after removal', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        participants: [
          { participant_id: 'p1', name: 'Alice' },
          { participant_id: 'p3', name: 'Carol' }
        ]
      },
      { type: 'ParticipantRemoved', section_id: 's1', participant_id: 'p1' },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        participant: { participant_id: 'p4', name: 'Dave' }
      }
    ]);
    // Pre-race fills the gap (Alice removed, car 1 free)
    const davePreRace = s.sections.s1.participants.find(p => p.participant_id === 'p4');
    assert.strictEqual(davePreRace.car_number, 1);
    // Race day has no gap (ParticipantRemoved doesn't affect race_day)
    const daveRaceDay = s.race_day.sections.s1.participants.find(p => p.participant_id === 'p4');
    assert.strictEqual(daveRaceDay.car_number, 3);
  });

  it('full late-registration flow: ParticipantAdded + CarArrived', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 },
      { type: 'CarArrived', section_id: 's1', car_number: 2 },
      { type: 'SectionStarted', section_id: 's1' },
      // Late registration
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        participant: { participant_id: 'p4', name: 'Dave' }
      },
      { type: 'CarArrived', section_id: 's1', car_number: 4 }
    ]);
    const rdSec = s.race_day.sections.s1;
    assert.strictEqual(rdSec.participants.length, 4);
    assert.deepStrictEqual(rdSec.arrived, [1, 2, 4]);
    assert.strictEqual(rdSec.started, true);
    const dave = rdSec.participants.find(p => p.participant_id === 'p4');
    assert.strictEqual(dave.car_number, 4);
    assert.strictEqual(dave.name, 'Dave');
  });

  it('updates both pre-race and race_day sections', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        participant: { participant_id: 'p4', name: 'Dave' }
      }
    ]);
    // Pre-race section should have all participants (SectionCreated created it)
    assert.strictEqual(s.sections.s1.participants.length, 4);
    assert.strictEqual(s.sections.s1.participants[3].name, 'Dave');
    // Race day section
    assert.strictEqual(s.race_day.sections.s1.participants.length, 4);
  });
});

// ─── HeatStaged catch_up flag ────────────────────────────────────

describe('HeatStaged catch_up flag', () => {
  it('defaults catch_up to false when not provided', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: [] }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats[0].catch_up, false);
  });

  it('stores catch_up: true when provided', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'HeatStaged',
        section_id: 's1',
        heat_number: 1,
        lanes: [{ lane: 1, car_number: 1, name: 'Alice' }],
        catch_up: true
      }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats[0].catch_up, true);
  });
});

// ─── ResultCorrected ────────────────────────────────────────────

describe('ResultCorrected', () => {
  it('replaces lane assignments for matching heat', () => {
    const originalLanes = [
      { lane: 1, car_number: 1, name: 'Alice' },
      { lane: 2, car_number: 2, name: 'Bob' }
    ];
    const correctedLanes = [
      { lane: 1, car_number: 2, name: 'Bob' },
      { lane: 2, car_number: 1, name: 'Alice' }
    ];
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'HeatStaged', section_id: 's1', heat_number: 1, lanes: originalLanes },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500, '2': 2700 },
        timestamp: 1000
      },
      {
        type: 'ResultCorrected',
        section_id: 's1',
        heat_number: 1,
        corrected_lanes: correctedLanes,
        reason: 'Cars were swapped'
      }
    ]);
    const heat = s.race_day.sections.s1.heats[0];
    assert.deepStrictEqual(heat.lanes, correctedLanes);
  });

  it('does not affect results/times', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'HeatStaged', section_id: 's1', heat_number: 1,
        lanes: [{ lane: 1, car_number: 1, name: 'Alice' }, { lane: 2, car_number: 2, name: 'Bob' }]
      },
      {
        type: 'RaceCompleted',
        section_id: 's1',
        heat_number: 1,
        times_ms: { '1': 2500, '2': 2700 },
        timestamp: 1000
      },
      {
        type: 'ResultCorrected',
        section_id: 's1',
        heat_number: 1,
        corrected_lanes: [{ lane: 1, car_number: 2, name: 'Bob' }, { lane: 2, car_number: 1, name: 'Alice' }]
      }
    ]);
    const result = s.race_day.sections.s1.results[1];
    assert.strictEqual(result.times_ms['1'], 2500);
    assert.strictEqual(result.times_ms['2'], 2700);
  });

  it('does not affect other heats', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'HeatStaged', section_id: 's1', heat_number: 1,
        lanes: [{ lane: 1, car_number: 1, name: 'Alice' }]
      },
      {
        type: 'HeatStaged', section_id: 's1', heat_number: 2,
        lanes: [{ lane: 1, car_number: 2, name: 'Bob' }]
      },
      {
        type: 'ResultCorrected',
        section_id: 's1',
        heat_number: 1,
        corrected_lanes: [{ lane: 1, car_number: 3, name: 'Carol' }]
      }
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.heats[1].lanes, [{ lane: 1, car_number: 2, name: 'Bob' }]);
  });

  it('multiple corrections to same heat — last wins', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      { type: 'SectionStarted', section_id: 's1' },
      {
        type: 'HeatStaged', section_id: 's1', heat_number: 1,
        lanes: [{ lane: 1, car_number: 1, name: 'Alice' }, { lane: 2, car_number: 2, name: 'Bob' }]
      },
      {
        type: 'ResultCorrected',
        section_id: 's1',
        heat_number: 1,
        corrected_lanes: [{ lane: 1, car_number: 2, name: 'Bob' }, { lane: 2, car_number: 1, name: 'Alice' }]
      },
      {
        type: 'ResultCorrected',
        section_id: 's1',
        heat_number: 1,
        corrected_lanes: [{ lane: 1, car_number: 3, name: 'Carol' }, { lane: 2, car_number: 1, name: 'Alice' }]
      }
    ]);
    assert.strictEqual(s.race_day.sections.s1.heats[0].lanes[0].car_number, 3);
  });

  it('ignores unknown section', () => {
    const s = buildState([
      ...baseRosterPayloads(),
      {
        type: 'ResultCorrected',
        section_id: 'unknown',
        heat_number: 1,
        corrected_lanes: []
      }
    ]);
    assert.strictEqual(s.race_day.sections.unknown, undefined);
  });
});

// ─── Pre-race events still work with race_day state ─────────────

describe('Integration: pre-race + race day coexistence', () => {
  it('both state trees are maintained', () => {
    const s = buildState([
      { type: 'RallyCreated', rally_id: 'e1', rally_name: 'Rally', rally_date: '2026-03-15', created_by: 'org@x.com' },
      ...baseRosterPayloads(),
      { type: 'CarArrived', section_id: 's1', car_number: 1 }
    ]);
    assert.strictEqual(s.rally_name, 'Rally');
    assert.strictEqual(s.sections.s1.section_name, 'Kub Kars');
    assert.strictEqual(s.race_day.sections.s1.section_name, 'Kub Kars');
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, [1]);
  });
});
