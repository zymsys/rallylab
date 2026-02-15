/**
 * demo-data.js — Seed data for demonstrating the pre-race registration flow.
 */

import { clearAllData, getClient } from '../supabase.js';

export async function loadDemoData() {
  clearAllData();

  const client = getClient();
  const eventId = crypto.randomUUID();

  // Sections (age categories)
  const beaversId = crypto.randomUUID();
  const kubkarsId = crypto.randomUUID();
  const scoutsId = crypto.randomUUID();

  // Groups (scouting groups)
  const newmarketId = crypto.randomUUID();
  const aurora2Id = crypto.randomUUID();
  const aurora3Id = crypto.randomUUID();

  const now = Date.now();

  const events = [
    {
      type: 'EventCreated',
      event_id: eventId,
      event_name: 'Kub Kars Rally 2026',
      event_date: '2026-03-15',
      created_by: 'organizer@example.com',
      timestamp: now
    },
    // Sections
    {
      type: 'SectionCreated',
      event_id: eventId,
      section_id: beaversId,
      section_name: 'Beaver Buggies',
      created_by: 'organizer@example.com',
      timestamp: now + 1
    },
    {
      type: 'SectionCreated',
      event_id: eventId,
      section_id: kubkarsId,
      section_name: 'Kub Kars',
      created_by: 'organizer@example.com',
      timestamp: now + 2
    },
    {
      type: 'SectionCreated',
      event_id: eventId,
      section_id: scoutsId,
      section_name: 'Scout Trucks',
      created_by: 'organizer@example.com',
      timestamp: now + 3
    },
    // Groups
    {
      type: 'GroupCreated',
      event_id: eventId,
      group_id: newmarketId,
      group_name: '1st Newmarket',
      created_by: 'organizer@example.com',
      timestamp: now + 4
    },
    {
      type: 'GroupCreated',
      event_id: eventId,
      group_id: aurora2Id,
      group_name: '2nd Aurora',
      created_by: 'organizer@example.com',
      timestamp: now + 5
    },
    {
      type: 'GroupCreated',
      event_id: eventId,
      group_id: aurora3Id,
      group_name: '3rd Aurora',
      created_by: 'organizer@example.com',
      timestamp: now + 6
    },
    // Registrars — multi-scope assignments
    {
      type: 'RegistrarInvited',
      event_id: eventId,
      registrar_email: 'darryl@example.com',
      group_ids: [aurora2Id, aurora3Id],
      section_ids: [kubkarsId, scoutsId],
      invited_by: 'organizer@example.com',
      timestamp: now + 7
    },
    {
      type: 'RegistrarInvited',
      event_id: eventId,
      registrar_email: 'sarah@example.com',
      group_ids: [newmarketId],
      section_ids: [beaversId, kubkarsId, scoutsId],
      invited_by: 'organizer@example.com',
      timestamp: now + 8
    },
    // Rosters — 1st Newmarket Kub Kars
    {
      type: 'RosterUpdated',
      event_id: eventId,
      section_id: kubkarsId,
      group_id: newmarketId,
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Billy Thompson' },
        { participant_id: crypto.randomUUID(), name: 'Sarah Chen' },
        { participant_id: crypto.randomUUID(), name: 'Tommy Rodriguez' },
        { participant_id: crypto.randomUUID(), name: 'Emma Wilson' }
      ],
      submitted_by: 'sarah@example.com',
      timestamp: now + 9
    },
    // Rosters — 2nd Aurora Kub Kars
    {
      type: 'RosterUpdated',
      event_id: eventId,
      section_id: kubkarsId,
      group_id: aurora2Id,
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Jake Patel' },
        { participant_id: crypto.randomUUID(), name: 'Lily Okafor' },
        { participant_id: crypto.randomUUID(), name: 'Noah Kim' }
      ],
      submitted_by: 'darryl@example.com',
      timestamp: now + 10
    },
    // Rosters — 3rd Aurora Scout Trucks
    {
      type: 'RosterUpdated',
      event_id: eventId,
      section_id: scoutsId,
      group_id: aurora3Id,
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Liam Foster' },
        { participant_id: crypto.randomUUID(), name: 'Sophia Tanaka' },
        { participant_id: crypto.randomUUID(), name: 'Ethan Blackwood' },
        { participant_id: crypto.randomUUID(), name: 'Olivia Singh' },
        { participant_id: crypto.randomUUID(), name: 'Mason Rivera' }
      ],
      submitted_by: 'darryl@example.com',
      timestamp: now + 11
    },
    // Rosters — 1st Newmarket Beaver Buggies
    {
      type: 'RosterUpdated',
      event_id: eventId,
      section_id: beaversId,
      group_id: newmarketId,
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Ava Moreau' },
        { participant_id: crypto.randomUUID(), name: 'Chloe Nguyen' },
        { participant_id: crypto.randomUUID(), name: 'Lucas Brown' }
      ],
      submitted_by: 'sarah@example.com',
      timestamp: now + 12
    }
  ];

  for (const evt of events) {
    await client
      .from('domain_events')
      .insert({
        event_id: evt.event_id,
        section_id: evt.section_id || null,
        event_type: evt.type,
        payload: evt,
        created_by: '00000000-mock-user-demo'
      });
  }
}
