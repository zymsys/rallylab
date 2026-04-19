/**
 * Unit tests for state-manager.js
 * Run with: node --test test/state-manager.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyEvent, rebuildState, nextAvailableCarNumber, compareCarNumbers } from '../public/js/state-manager.js';

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

// ─── Tests ────────────────────────────────────────────────────────

describe('initialState', () => {
  it('has groups and registrars', () => {
    const s = initialState();
    assert.deepStrictEqual(s.groups, {});
    assert.deepStrictEqual(s.registrars, {});
    assert.deepStrictEqual(s.operators, {});
    assert.deepStrictEqual(s.sections, {});
  });
});

describe('GroupCreated', () => {
  it('adds group to state', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'GroupCreated',
      group_id: 'g1',
      group_name: '1st Newmarket'
    }));
    assert.deepStrictEqual(s.groups.g1, { group_id: 'g1', group_name: '1st Newmarket' });
  });
});

describe('RegistrarInvited', () => {
  it('adds registrar with group_ids and section_ids', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'a@b.com',
      group_ids: ['g1', 'g2'],
      section_ids: ['s1']
    }));
    assert.deepStrictEqual(s.registrars['a@b.com'], {
      email: 'a@b.com',
      group_ids: ['g1', 'g2'],
      section_ids: ['s1']
    });
  });

  it('overwrites previous invite for same email', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'a@b.com',
      group_ids: ['g1'],
      section_ids: ['s1']
    }));
    s = applyEvent(s, makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'a@b.com',
      group_ids: ['g1', 'g2'],
      section_ids: ['s1', 's2']
    }));
    assert.deepStrictEqual(s.registrars['a@b.com'].group_ids, ['g1', 'g2']);
    assert.deepStrictEqual(s.registrars['a@b.com'].section_ids, ['s1', 's2']);
  });
});

describe('RegistrarRemoved', () => {
  it('removes registrar from state', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'a@b.com',
      group_ids: ['g1'],
      section_ids: ['s1']
    }));
    assert.ok(s.registrars['a@b.com']);
    s = applyEvent(s, makeEvent({
      type: 'RegistrarRemoved',
      registrar_email: 'a@b.com'
    }));
    assert.strictEqual(s.registrars['a@b.com'], undefined);
  });

  it('does not affect other registrars', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'a@b.com',
      group_ids: ['g1'],
      section_ids: ['s1']
    }));
    s = applyEvent(s, makeEvent({
      type: 'RegistrarInvited',
      registrar_email: 'c@d.com',
      group_ids: ['g2'],
      section_ids: ['s2']
    }));
    s = applyEvent(s, makeEvent({
      type: 'RegistrarRemoved',
      registrar_email: 'a@b.com'
    }));
    assert.ok(s.registrars['c@d.com']);
    assert.strictEqual(s.registrars['a@b.com'], undefined);
  });
});

describe('OperatorInvited', () => {
  it('adds operator to state', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'OperatorInvited',
      rally_id: 'r1',
      operator_email: 'op@example.com',
      invited_by: 'org@example.com',
      timestamp: 1000
    }));
    assert.ok(s.operators['op@example.com']);
    assert.strictEqual(s.operators['op@example.com'].email, 'op@example.com');
    assert.strictEqual(s.operators['op@example.com'].invited_by, 'org@example.com');
  });

  it('allows multiple operators', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent({
      type: 'OperatorInvited',
      rally_id: 'r1',
      operator_email: 'op1@example.com',
      invited_by: 'org@example.com',
      timestamp: 1000
    }));
    s = applyEvent(s, makeEvent({
      type: 'OperatorInvited',
      rally_id: 'r1',
      operator_email: 'op2@example.com',
      invited_by: 'org@example.com',
      timestamp: 2000
    }));
    assert.strictEqual(Object.keys(s.operators).length, 2);
    assert.ok(s.operators['op1@example.com']);
    assert.ok(s.operators['op2@example.com']);
  });
});

describe('SectionCreated', () => {
  it('does not include registrar_email', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'SectionCreated',
      section_id: 's1',
      section_name: 'Kub Kars'
    }));
    assert.strictEqual(s.sections.s1.registrar_email, undefined);
    assert.deepStrictEqual(s.sections.s1.participants, []);
  });

  it('populates race_day.sections with full structure', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'SectionCreated',
      section_id: 's1',
      section_name: 'Kub Kars'
    }));
    assert.strictEqual(s.race_day.loaded, true);
    const rd = s.race_day.sections.s1;
    assert.ok(rd);
    assert.strictEqual(rd.section_id, 's1');
    assert.strictEqual(rd.section_name, 'Kub Kars');
    assert.deepStrictEqual(rd.participants, []);
    assert.deepStrictEqual(rd.arrived, []);
    assert.deepStrictEqual(rd.starts, {});
    assert.strictEqual(rd.next_start_number, 1);
  });
});

describe('RosterUpdated updates race_day.sections', () => {
  it('updates race_day.sections participants when section exists', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice' },
          { participant_id: 'p2', name: 'Bob' }
        ]
      }
    ]);
    assert.strictEqual(s.race_day.sections.s1.participants.length, 2);
    const alice = s.race_day.sections.s1.participants.find(p => p.name === 'Alice');
    assert.ok(alice);
    assert.strictEqual(alice.car_number, '1');
  });
});

describe('CheckInRoleGranted', () => {
  it('adds volunteer to checkin_volunteers', () => {
    const s = applyEvent(initialState(), makeEvent({
      type: 'CheckInRoleGranted',
      email: 'vol@example.com',
      section_ids: ['s1', 's2']
    }));
    assert.deepStrictEqual(s.checkin_volunteers['vol@example.com'], {
      email: 'vol@example.com',
      section_ids: ['s1', 's2']
    });
  });
});

describe('CheckInRoleRevoked', () => {
  it('removes volunteer from checkin_volunteers', () => {
    let s = applyEvent(initialState(), makeEvent({
      type: 'CheckInRoleGranted',
      email: 'vol@example.com',
      section_ids: ['s1']
    }));
    assert.ok(s.checkin_volunteers['vol@example.com']);
    s = applyEvent(s, makeEvent({
      type: 'CheckInRoleRevoked',
      email: 'vol@example.com'
    }));
    assert.strictEqual(s.checkin_volunteers['vol@example.com'], undefined);
  });
});

describe('RosterUpdated with group_id', () => {
  it('replaces only that group participants in section', () => {
    let s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice' },
          { participant_id: 'p2', name: 'Bob' }
        ]
      },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g2',
        participants: [
          { participant_id: 'p3', name: 'Carol' }
        ]
      }
    ]);

    // g1 has car 1,2 — g2 gap-fills to car 3
    assert.strictEqual(s.sections.s1.participants.length, 3);
    const alice = s.sections.s1.participants.find(p => p.name === 'Alice');
    const bob = s.sections.s1.participants.find(p => p.name === 'Bob');
    const carol = s.sections.s1.participants.find(p => p.name === 'Carol');
    assert.strictEqual(alice.car_number, '1');
    assert.strictEqual(bob.car_number, '2');
    assert.strictEqual(carol.car_number, '3');
    assert.strictEqual(alice.group_id, 'g1');
    assert.strictEqual(carol.group_id, 'g2');
  });

  it('gap-fills car numbers around existing groups', () => {
    let s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice' },
          { participant_id: 'p2', name: 'Bob' },
          { participant_id: 'p3', name: 'Carol' }
        ]
      }
    ]);

    // Remove middle participant (car 2)
    s = applyEvent(s, makeEvent({
      type: 'ParticipantRemoved',
      section_id: 's1',
      participant_id: 'p2'
    }));

    // Now add group g2 — should get car 2 (the gap) then car 4
    s = applyEvent(s, makeEvent({
      type: 'RosterUpdated',
      section_id: 's1',
      group_id: 'g2',
      participants: [
        { participant_id: 'p4', name: 'Dave' },
        { participant_id: 'p5', name: 'Eve' }
      ]
    }));

    assert.strictEqual(s.sections.s1.participants.length, 4);
    const dave = s.sections.s1.participants.find(p => p.name === 'Dave');
    const eve = s.sections.s1.participants.find(p => p.name === 'Eve');
    assert.strictEqual(dave.car_number, '2'); // fills the gap
    assert.strictEqual(eve.car_number, '4');  // next available
  });

  it('re-uploading a group replaces only that group', () => {
    let s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [{ participant_id: 'p1', name: 'Alice' }]
      },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g2',
        participants: [{ participant_id: 'p2', name: 'Bob' }]
      }
    ]);

    // Re-upload g1 with different participants
    s = applyEvent(s, makeEvent({
      type: 'RosterUpdated',
      section_id: 's1',
      group_id: 'g1',
      participants: [
        { participant_id: 'p3', name: 'Carol' },
        { participant_id: 'p4', name: 'Dave' }
      ]
    }));

    // Bob (g2) should still be there
    assert.strictEqual(s.sections.s1.participants.length, 3);
    assert.ok(s.sections.s1.participants.find(p => p.name === 'Bob'));
    assert.ok(s.sections.s1.participants.find(p => p.name === 'Carol'));
    assert.ok(s.sections.s1.participants.find(p => p.name === 'Dave'));
    assert.ok(!s.sections.s1.participants.find(p => p.name === 'Alice'));
  });
});

describe('ParticipantAdded with group_id', () => {
  it('includes group_id and auto-assigns car number', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        group_id: 'g1',
        participant: { participant_id: 'p1', name: 'Alice' }
      }
    ]);
    assert.strictEqual(s.sections.s1.participants[0].group_id, 'g1');
    assert.strictEqual(s.sections.s1.participants[0].car_number, '1');
  });

  it('gap-fills car number around existing participants', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice' },
          { participant_id: 'p2', name: 'Bob' }
        ]
      },
      { type: 'ParticipantRemoved', section_id: 's1', participant_id: 'p1' },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        group_id: 'g2',
        participant: { participant_id: 'p3', name: 'Carol' }
      }
    ]);
    // Carol should get car 1 (the gap left by Alice)
    const carol = s.sections.s1.participants.find(p => p.name === 'Carol');
    assert.strictEqual(carol.car_number, '1');
  });
});

describe('ParticipantRemoved with group_id', () => {
  it('filters by participant_id regardless of group_id', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        group_id: 'g1',
        participant: { participant_id: 'p1', name: 'Alice' }
      },
      {
        type: 'ParticipantRemoved',
        section_id: 's1',
        participant_id: 'p1',
        group_id: 'g1'
      }
    ]);
    assert.strictEqual(s.sections.s1.participants.length, 0);
  });
});

describe('nextAvailableCarNumber', () => {
  it('fills gaps across groups', () => {
    const section = {
      participants: [
        { car_number: '1', group_id: 'g1' },
        { car_number: '3', group_id: 'g2' }
      ]
    };
    assert.strictEqual(nextAvailableCarNumber(section), '2');
  });

  it('ignores custom non-numeric labels when picking next integer', () => {
    const section = {
      participants: [
        { car_number: 'B100', group_id: 'g1' },
        { car_number: 'B101', group_id: 'g1' }
      ]
    };
    assert.strictEqual(nextAvailableCarNumber(section), '1');
  });
});

describe('compareCarNumbers', () => {
  it('orders mixed numeric+letter labels naturally', () => {
    const arr = ['B100', 'B9', 'B10', 'A005'];
    arr.sort(compareCarNumbers);
    assert.deepStrictEqual(arr, ['A005', 'B9', 'B10', 'B100']);
  });

  it('handles pure numeric strings', () => {
    const arr = ['10', '2', '1'];
    arr.sort(compareCarNumbers);
    assert.deepStrictEqual(arr, ['1', '2', '10']);
  });
});

describe('RosterUpdated with explicit car_numbers', () => {
  it('honors explicit car_numbers from payload', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice', car_number: 'B100' },
          { participant_id: 'p2', name: 'Bob', car_number: 'B101' }
        ]
      }
    ]);
    const alice = s.sections.s1.participants.find(p => p.name === 'Alice');
    const bob = s.sections.s1.participants.find(p => p.name === 'Bob');
    assert.strictEqual(alice.car_number, 'B100');
    assert.strictEqual(bob.car_number, 'B101');
  });

  it('auto-assigns for participants without explicit car_number, avoiding collisions', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice', car_number: '1' },
          { participant_id: 'p2', name: 'Bob' },  // no explicit → auto-assign
          { participant_id: 'p3', name: 'Carol' } // no explicit → auto-assign
        ]
      }
    ]);
    const alice = s.sections.s1.participants.find(p => p.name === 'Alice');
    const bob = s.sections.s1.participants.find(p => p.name === 'Bob');
    const carol = s.sections.s1.participants.find(p => p.name === 'Carol');
    assert.strictEqual(alice.car_number, '1');
    // Bob and Carol should get 2 and 3 (skipping 1 reserved for Alice)
    assert.ok(['2', '3'].includes(bob.car_number));
    assert.ok(['2', '3'].includes(carol.car_number));
    assert.notStrictEqual(bob.car_number, carol.car_number);
  });

  it('preserves explicit car_numbers across groups within a section', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [
          { participant_id: 'p1', name: 'Alice', car_number: 'B100' }
        ]
      },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g2',
        participants: [
          { participant_id: 'p2', name: 'Bob', car_number: 'B200' }
        ]
      }
    ]);
    assert.strictEqual(s.sections.s1.participants.length, 2);
    const alice = s.sections.s1.participants.find(p => p.name === 'Alice');
    const bob = s.sections.s1.participants.find(p => p.name === 'Bob');
    assert.strictEqual(alice.car_number, 'B100');
    assert.strictEqual(bob.car_number, 'B200');
  });
});

describe('ParticipantAdded with explicit car_number', () => {
  it('honors explicit car_number', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        group_id: 'g1',
        participant: { participant_id: 'p1', name: 'Alice', car_number: 'B100' }
      }
    ]);
    assert.strictEqual(s.sections.s1.participants[0].car_number, 'B100');
  });

  it('falls back to auto-assign when explicit conflicts', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [{ participant_id: 'p1', name: 'Alice', car_number: 'B100' }]
      },
      {
        type: 'ParticipantAdded',
        section_id: 's1',
        group_id: 'g1',
        // explicit B100 conflicts; should auto-assign instead
        participant: { participant_id: 'p2', name: 'Bob', car_number: 'B100' }
      }
    ]);
    const bob = s.sections.s1.participants.find(p => p.name === 'Bob');
    assert.notStrictEqual(bob.car_number, 'B100');
    assert.strictEqual(bob.car_number, '1');
  });
});

describe('CarArrived normalizes car_number', () => {
  it('deduplicates int and string representations of the same car', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Beaver' },
      {
        type: 'RosterUpdated',
        section_id: 's1',
        group_id: 'g1',
        participants: [{ participant_id: 'p1', name: 'Alice', car_number: '42' }]
      },
      { type: 'CarArrived', section_id: 's1', car_number: 42 },     // int
      { type: 'CarArrived', section_id: 's1', car_number: '42' }    // string — dup
    ]);
    assert.deepStrictEqual(s.race_day.sections.s1.arrived, ['42']);
  });
});

describe('SectionCompleted', () => {
  it('marks section completed', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'SectionCompleted', section_id: 's1', timestamp: 1000 }
    ]);
    assert.strictEqual(s.race_day.sections.s1.starts[1].completed, true);
    assert.strictEqual(s.race_day.sections.s1.starts[1].early_end, false);
  });

  it('stores early_end flag when section ended early', () => {
    const s = buildState([
      { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
      { type: 'SectionStarted', section_id: 's1' },
      { type: 'SectionCompleted', section_id: 's1', early_end: true, total_heats: 5, timestamp: 1000 }
    ]);
    assert.strictEqual(s.race_day.sections.s1.starts[1].completed, true);
    assert.strictEqual(s.race_day.sections.s1.starts[1].early_end, true);
  });
});

describe('RaceCompleted', () => {
  const setup = () => [
    { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' },
    { type: 'SectionStarted', section_id: 's1' }
  ];

  it('stores partial times (DNF lane missing)', () => {
    const s = buildState([
      ...setup(),
      {
        type: 'RaceCompleted', section_id: 's1', heat_number: 1,
        lanes: [
          { lane: 1, car_number: 101, name: 'Alice' },
          { lane: 2, car_number: 102, name: 'Bob' }
        ],
        times_ms: { '1': 2500 },  // lane 2 DNF
        timestamp: 1000
      }
    ]);
    const result = s.race_day.sections.s1.starts[1].results[1];
    assert.strictEqual(result.times_ms['1'], 2500);
    assert.strictEqual(result.times_ms['2'], undefined);
    assert.strictEqual(result.lanes.length, 2);
  });

  it('merges times on second RaceCompleted for same heat (DNF re-run)', () => {
    const s = buildState([
      ...setup(),
      {
        type: 'RaceCompleted', section_id: 's1', heat_number: 1,
        lanes: [
          { lane: 1, car_number: 101, name: 'Alice' },
          { lane: 2, car_number: 102, name: 'Bob' }
        ],
        times_ms: { '1': 2500 },  // lane 2 DNF
        timestamp: 1000
      },
      {
        type: 'RaceCompleted', section_id: 's1', heat_number: 1,
        lanes: [{ lane: 2, car_number: 102, name: 'Bob' }],
        times_ms: { '2': 2800 },  // DNF re-run
        timestamp: 2000
      }
    ]);
    const result = s.race_day.sections.s1.starts[1].results[1];
    assert.strictEqual(result.times_ms['1'], 2500);  // original preserved
    assert.strictEqual(result.times_ms['2'], 2800);  // re-run filled in
    assert.strictEqual(result.lanes.length, 2);       // full lane list kept
    assert.strictEqual(result.timestamp, 2000);       // updated timestamp
  });

  it('replaces after RerunDeclared (full re-run, no merge)', () => {
    const s = buildState([
      ...setup(),
      {
        type: 'RaceCompleted', section_id: 's1', heat_number: 1,
        lanes: [
          { lane: 1, car_number: 101, name: 'Alice' },
          { lane: 2, car_number: 102, name: 'Bob' }
        ],
        times_ms: { '1': 2500, '2': 2800 },
        timestamp: 1000
      },
      {
        type: 'RerunDeclared', section_id: 's1', heat_number: 1,
        timestamp: 1500
      },
      {
        type: 'RaceCompleted', section_id: 's1', heat_number: 1,
        lanes: [
          { lane: 1, car_number: 101, name: 'Alice' },
          { lane: 2, car_number: 102, name: 'Bob' }
        ],
        times_ms: { '1': 2400, '2': 2700 },
        timestamp: 2000
      }
    ]);
    const result = s.race_day.sections.s1.starts[1].results[1];
    assert.strictEqual(result.times_ms['1'], 2400);  // new time, not merged
    assert.strictEqual(result.times_ms['2'], 2700);
  });
});

describe('rebuildState', () => {
  it('replays full event stream', () => {
    const events = [
      { payload: { type: 'RallyCreated', rally_id: 'e1', rally_name: 'Rally', rally_date: '2026-03-15', created_by: 'org@x.com' } },
      { payload: { type: 'SectionCreated', section_id: 's1', section_name: 'Kub Kars' } },
      { payload: { type: 'GroupCreated', group_id: 'g1', group_name: '1st Newmarket' } },
      { payload: { type: 'RegistrarInvited', registrar_email: 'r@x.com', group_ids: ['g1'], section_ids: ['s1'] } },
      { payload: { type: 'RosterUpdated', section_id: 's1', group_id: 'g1', participants: [{ participant_id: 'p1', name: 'Alice' }] } }
    ];

    const s = rebuildState(events);
    assert.strictEqual(s.rally_name, 'Rally');
    assert.strictEqual(Object.keys(s.groups).length, 1);
    assert.strictEqual(Object.keys(s.registrars).length, 1);
    assert.strictEqual(s.sections.s1.participants.length, 1);
    assert.strictEqual(s.sections.s1.participants[0].group_id, 'g1');
  });
});
