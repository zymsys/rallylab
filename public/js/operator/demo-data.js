/**
 * operator/demo-data.js — Race day demo data seeder.
 * Loads roster only — no auto check-in so the check-in flow can be tested.
 */

export async function loadDemoData(ctx) {
  const { clearAndRebuild, appendAndRebuild } = await import('./app.js');
  await clearAndRebuild();

  const eventId = crypto.randomUUID();
  const beaversId = crypto.randomUUID();
  const kubkarsId = crypto.randomUUID();
  const scoutsId = crypto.randomUUID();

  const now = Date.now();

  // Event
  await appendAndRebuild({
    type: 'EventCreated',
    event_id: eventId,
    event_name: 'Kub Kars Rally 2026',
    event_date: '2026-03-15',
    created_by: 'operator',
    timestamp: now
  });

  // Sections with participants
  const sections = [
    {
      id: beaversId,
      name: 'Beaver Buggies',
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Ava Moreau', car_number: 1 },
        { participant_id: crypto.randomUUID(), name: 'Chloe Nguyen', car_number: 2 },
        { participant_id: crypto.randomUUID(), name: 'Lucas Brown', car_number: 3 },
        { participant_id: crypto.randomUUID(), name: 'Mia Johnson', car_number: 4 },
        { participant_id: crypto.randomUUID(), name: 'Leo Garcia', car_number: 5 },
        { participant_id: crypto.randomUUID(), name: 'Isla Patel', car_number: 6 }
      ]
    },
    {
      id: kubkarsId,
      name: 'Kub Kars',
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Billy Thompson', car_number: 1 },
        { participant_id: crypto.randomUUID(), name: 'Sarah Chen', car_number: 2 },
        { participant_id: crypto.randomUUID(), name: 'Tommy Rodriguez', car_number: 3 },
        { participant_id: crypto.randomUUID(), name: 'Emma Wilson', car_number: 4 },
        { participant_id: crypto.randomUUID(), name: 'Jake Patel', car_number: 5 },
        { participant_id: crypto.randomUUID(), name: 'Lily Okafor', car_number: 6 },
        { participant_id: crypto.randomUUID(), name: 'Noah Kim', car_number: 7 }
      ]
    },
    {
      id: scoutsId,
      name: 'Scout Trucks',
      participants: [
        { participant_id: crypto.randomUUID(), name: 'Liam Foster', car_number: 1 },
        { participant_id: crypto.randomUUID(), name: 'Sophia Tanaka', car_number: 2 },
        { participant_id: crypto.randomUUID(), name: 'Ethan Blackwood', car_number: 3 },
        { participant_id: crypto.randomUUID(), name: 'Olivia Singh', car_number: 4 },
        { participant_id: crypto.randomUUID(), name: 'Mason Rivera', car_number: 5 }
      ]
    }
  ];

  for (const sec of sections) {
    await appendAndRebuild({
      type: 'RosterLoaded',
      section_id: sec.id,
      section_name: sec.name,
      participants: sec.participants,
      timestamp: now + 1
    });

    // No auto check-in — test the check-in flow manually
  }
}
