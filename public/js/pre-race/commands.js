/**
 * commands.js — Event append, state loading, and roster export.
 */

import { getClient, getUser } from '../supabase.js';
import { rebuildState } from '../state-manager.js';

/**
 * Append a domain event. Wraps the insert pattern from spec 05 §5.1.
 */
export async function appendEvent(payload) {
  const client = getClient();
  const user = getUser();

  const { data, error } = await client
    .from('domain_events')
    .insert({
      event_id: payload.event_id,
      section_id: payload.section_id || null,
      event_type: payload.type,
      payload,
      created_by: user.id
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Fetch all events for an event_id and replay through the reducer.
 */
export async function loadEventState(eventId) {
  const client = getClient();

  const { data: events, error } = await client
    .from('domain_events')
    .select('*')
    .eq('event_id', eventId)
    .order('id');

  if (error) throw new Error(error.message);
  return rebuildState(events);
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
    event_id: state.event_id,
    event_name: state.event_name,
    event_date: state.event_date,
    exported_at: Date.now(),
    groups,
    sections
  };

  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.event_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-roster.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
