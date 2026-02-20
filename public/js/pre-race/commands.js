/**
 * commands.js — Event append, state loading, role derivation, and roster export.
 */

import { getUser } from '../supabase.js';
import { appendEvent as storeAppend, getEventsByRally, getAllEvents } from '../event-store.js';
import { rebuildState } from '../state-manager.js';

/**
 * Append a domain event to IndexedDB.
 */
export async function appendEvent(payload) {
  const user = getUser();
  const record = await storeAppend({
    ...payload,
    created_by: user?.id || null
  });
  return record;
}

/**
 * Fetch all events for a rally_id and replay through the reducer.
 */
export async function loadRallyState(rallyId) {
  const events = await getEventsByRally(rallyId);
  return rebuildState(events);
}

/**
 * Check if the current user is an organizer.
 * Organizer is a global role: true if user has created any rally.
 * Also true for new users who haven't been invited as registrars (so they can bootstrap).
 */
export async function isOrganizer() {
  const user = getUser();
  if (!user) return false;

  const events = await getAllEvents();

  let createdAny = false;
  let invitedAsRegistrar = false;

  for (const e of events) {
    if (e.type === 'RallyCreated' && e.created_by === user.email) {
      createdAny = true;
    }
    if (e.type === 'RegistrarInvited' && e.registrar_email === user.email) {
      invitedAsRegistrar = true;
    }
  }

  return createdAny || !invitedAsRegistrar;
}

/**
 * Get rally IDs accessible to the current user.
 * Organizer: rallies they created. Registrar: rallies they're invited to
 * (unless subsequently removed without re-invite).
 */
export async function getAccessibleRallyIds() {
  const user = getUser();
  if (!user) return [];

  const events = await getAllEvents();

  const organizerIds = new Set();
  const registrarAccess = new Map();

  for (const e of events) {
    if (e.type === 'RallyCreated' && e.created_by === user.email) {
      organizerIds.add(e.rally_id);
    }
    if (e.type === 'RegistrarInvited' && e.registrar_email === user.email) {
      registrarAccess.set(e.rally_id, true);
    }
    if (e.type === 'RegistrarRemoved' && e.registrar_email === user.email) {
      registrarAccess.set(e.rally_id, false);
    }
  }

  const ids = new Set(organizerIds);
  for (const [rallyId, hasAccess] of registrarAccess) {
    if (hasAccess) ids.add(rallyId);
    else ids.delete(rallyId);
  }

  return [...ids];
}

/**
 * Export a roster package JSON for race day import.
 * Includes all sections that have at least one participant.
 */
export function exportRosterPackage(state) {
  const sections = Object.values(state.sections)
    .filter(s => s.participants.length > 0)
    .map(s => ({
      section_id: s.section_id,
      section_name: s.section_name,
      participants: s.participants.map(p => ({
        participant_id: p.participant_id,
        name: p.name,
        car_number: p.car_number,
        group_id: p.group_id || null
      }))
    }));

  if (sections.length === 0) {
    throw new Error('No sections with participants to export');
  }

  const groups = Object.values(state.groups).map(g => ({
    group_id: g.group_id,
    group_name: g.group_name
  }));

  const pkg = {
    version: 2,
    rally_id: state.rally_id,
    rally_name: state.rally_name,
    rally_date: state.rally_date,
    exported_at: Date.now(),
    groups,
    sections
  };

  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.rally_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-roster.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
