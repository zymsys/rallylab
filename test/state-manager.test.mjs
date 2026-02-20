/**
 * Unit tests for state-manager.js
 * Run with: node --test test/state-manager.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyEvent, rebuildState, nextAvailableCarNumber } from '../public/js/state-manager.js';

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
    assert.deepStrictEqual(rd.removed, []);
    assert.strictEqual(rd.available_lanes, null);
    assert.strictEqual(rd.started, false);
    assert.strictEqual(rd.completed, false);
    assert.deepStrictEqual(rd.heats, []);
    assert.deepStrictEqual(rd.results, {});
    assert.deepStrictEqual(rd.reruns, {});
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
    assert.strictEqual(alice.car_number, 1);
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
    assert.strictEqual(alice.car_number, 1);
    assert.strictEqual(bob.car_number, 2);
    assert.strictEqual(carol.car_number, 3);
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
    assert.strictEqual(dave.car_number, 2); // fills the gap
    assert.strictEqual(eve.car_number, 4);  // next available
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
    assert.strictEqual(s.sections.s1.participants[0].car_number, 1);
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
    assert.strictEqual(carol.car_number, 1);
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
        { car_number: 1, group_id: 'g1' },
        { car_number: 3, group_id: 'g2' }
      ]
    };
    assert.strictEqual(nextAvailableCarNumber(section), 2);
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
