/**
 * commands.js — Event append, state loading, role derivation, and roster export.
 *
 * Persistence strategy:
 *   - Mock mode: IndexedDB (local-only, no server)
 *   - Real mode: Supabase (shared, RLS-controlled)
 *
 * State is always derived by replaying events through state-manager.js,
 * regardless of where the events are stored.
 */

import { isDemoMode } from '../config.js';
import { getUser, getClient } from '../supabase.js';
import { appendEvent as storeAppend, getEventsByRally, getAllEvents } from '../event-store.js';
import { rebuildState } from '../state-manager.js';

// ─── Event Append ─────────────────────────────────────────────────

/**
 * Append a domain event. Routes to Supabase (real) or IndexedDB (mock).
 */
export async function appendEvent(payload) {
  const user = getUser();

  if (isDemoMode()) {
    return storeAppend({
      ...payload,
      created_by: user?.email || null
    });
  }

  // Real mode: insert into Supabase domain_events
  const client = await getClient();
  const { error } = await client
    .from('domain_events')
    .insert({
      rally_id: payload.rally_id,
      section_id: payload.section_id || null,
      event_type: payload.type,
      payload,
      created_by: user?.id || null
    });

  if (error) throw new Error(error.message);
  return payload;
}

// ─── State Loading ────────────────────────────────────────────────

/**
 * Fetch all events for a rally and replay through the reducer.
 */
export async function loadRallyState(rallyId) {
  if (isDemoMode()) {
    const events = await getEventsByRally(rallyId);
    return rebuildState(events);
  }

  // Real mode: query Supabase
  const client = await getClient();
  const { data: rows, error } = await client
    .from('domain_events')
    .select('*')
    .eq('rally_id', rallyId)
    .order('id');

  if (error) throw new Error(error.message);

  // Map Supabase rows to domain events for the reducer
  const events = (rows || []).map(row => ({
    ...row.payload,
    type: row.event_type,
    rally_id: row.rally_id,
    section_id: row.section_id
  }));

  return rebuildState(events);
}

// ─── Role Derivation ──────────────────────────────────────────────

/**
 * Check if the current user is an organizer.
 */
export async function isOrganizer() {
  const user = getUser();
  if (!user) return false;

  if (isDemoMode()) {
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

  // Real mode: check rally_roles via RLS
  const client = await getClient();
  const { data: roles, error } = await client
    .from('rally_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'organizer')
    .limit(1);

  if (error) throw new Error(error.message);

  // If user has an organizer role, they're an organizer.
  // If they have no roles at all, they're a new user who can create rallies.
  if (roles && roles.length > 0) return true;

  const { count } = await client
    .from('rally_roles')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return count === 0; // New user with no roles can bootstrap
}

/**
 * Get rally IDs accessible to the current user.
 */
export async function getAccessibleRallyIds() {
  const user = getUser();
  if (!user) return [];

  if (isDemoMode()) {
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

  // Real mode: distinct rally_ids from rally_roles (RLS scoped to user)
  const client = await getClient();
  const { data: roles, error } = await client
    .from('rally_roles')
    .select('rally_id');

  if (error) throw new Error(error.message);

  const ids = new Set((roles || []).map(r => r.rally_id));
  return [...ids];
}

// ─── Clone Rally ─────────────────────────────────────────────────

/**
 * Create a new rally by cloning sections, groups, and participants from a source rally.
 * Emits: RallyCreated, GroupCreated (each), SectionCreated (each), RosterUpdated (per section+group).
 * Returns the new rally_id.
 */
export async function cloneRallyRoster(sourceState, newName, newDate) {
  const user = getUser();
  const newRallyId = crypto.randomUUID();

  // 1. Create the new rally
  await appendEvent({
    type: 'RallyCreated',
    rally_id: newRallyId,
    rally_name: newName,
    rally_date: newDate,
    created_by: user.email,
    timestamp: Date.now()
  });

  // 2. Clone groups (map old group_id → new group_id)
  const groupIdMap = {};
  for (const group of Object.values(sourceState.groups)) {
    const newGroupId = crypto.randomUUID();
    groupIdMap[group.group_id] = newGroupId;
    await appendEvent({
      type: 'GroupCreated',
      rally_id: newRallyId,
      group_id: newGroupId,
      group_name: group.group_name,
      created_by: user.email,
      timestamp: Date.now()
    });
  }

  // 3. Clone sections and their participants
  for (const section of Object.values(sourceState.sections)) {
    const newSectionId = crypto.randomUUID();
    await appendEvent({
      type: 'SectionCreated',
      rally_id: newRallyId,
      section_id: newSectionId,
      section_name: section.section_name,
      created_by: user.email,
      timestamp: Date.now()
    });

    if (section.participants.length === 0) continue;

    // Group participants by group_id for RosterUpdated events
    const byGroup = new Map();
    for (const p of section.participants) {
      const gid = p.group_id || null;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(p);
    }

    for (const [oldGroupId, participants] of byGroup) {
      const newGroupId = oldGroupId ? (groupIdMap[oldGroupId] || null) : null;
      await appendEvent({
        type: 'RosterUpdated',
        rally_id: newRallyId,
        section_id: newSectionId,
        group_id: newGroupId,
        participants: participants.map(p => ({
          participant_id: crypto.randomUUID(),
          name: p.name
        })),
        submitted_by: user.email,
        timestamp: Date.now()
      });
    }
  }

  return newRallyId;
}

// ─── Roster Export ────────────────────────────────────────────────

/**
 * Export a roster package JSON for race day import.
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
