/**
 * state-manager.js — Event reducer for Kub Kars.
 * Pure functions, zero DOM/Supabase dependencies.
 * Shared between pre-race and race day.
 */

export function initialState() {
  return {
    event_id: null,
    event_name: null,
    event_date: null,
    created_by: null,
    sections: {},
    groups: {},
    registrars: {}
  };
}

export function applyEvent(state, event) {
  const payload = event.payload || event;

  switch (payload.type) {
    case 'EventCreated':
      return {
        ...state,
        event_id: payload.event_id,
        event_name: payload.event_name,
        event_date: payload.event_date,
        created_by: payload.created_by
      };

    case 'SectionCreated':
      return {
        ...state,
        sections: {
          ...state.sections,
          [payload.section_id]: {
            section_id: payload.section_id,
            section_name: payload.section_name,
            participants: []
          }
        }
      };

    case 'GroupCreated':
      return {
        ...state,
        groups: {
          ...state.groups,
          [payload.group_id]: {
            group_id: payload.group_id,
            group_name: payload.group_name
          }
        }
      };

    case 'RegistrarInvited':
      return {
        ...state,
        registrars: {
          ...state.registrars,
          [payload.registrar_email]: {
            email: payload.registrar_email,
            group_ids: payload.group_ids || [],
            section_ids: payload.section_ids || []
          }
        }
      };

    case 'RegistrarRemoved': {
      const { [payload.registrar_email]: _, ...remaining } = state.registrars;
      return { ...state, registrars: remaining };
    }

    case 'RosterUpdated': {
      const section = state.sections[payload.section_id];
      if (!section) return state;

      const groupId = payload.group_id;
      // Keep participants from other groups, remove this group's participants
      const otherParticipants = groupId
        ? section.participants.filter(p => p.group_id !== groupId)
        : [];
      const usedNumbers = new Set(otherParticipants.map(p => p.car_number));

      // Assign car numbers to new participants, gap-filling
      const newParticipants = payload.participants.map(p => {
        let n = 1;
        while (usedNumbers.has(n)) n++;
        usedNumbers.add(n);
        return {
          participant_id: p.participant_id,
          name: p.name,
          car_number: n,
          group_id: groupId || null
        };
      });

      return {
        ...state,
        sections: {
          ...state.sections,
          [payload.section_id]: {
            ...section,
            participants: [...otherParticipants, ...newParticipants]
          }
        }
      };
    }

    case 'ParticipantAdded': {
      const section = state.sections[payload.section_id];
      if (!section) return state;
      const carNumber = nextAvailableCarNumber(section);
      return {
        ...state,
        sections: {
          ...state.sections,
          [payload.section_id]: {
            ...section,
            participants: [
              ...section.participants,
              {
                participant_id: payload.participant.participant_id,
                name: payload.participant.name,
                car_number: carNumber,
                group_id: payload.group_id || null
              }
            ]
          }
        }
      };
    }

    case 'ParticipantRemoved': {
      const section = state.sections[payload.section_id];
      if (!section) return state;
      return {
        ...state,
        sections: {
          ...state.sections,
          [payload.section_id]: {
            ...section,
            participants: section.participants.filter(
              p => p.participant_id !== payload.participant_id
            )
          }
        }
      };
    }

    default:
      return state;
  }
}

export function rebuildState(events) {
  return events.reduce((state, event) => applyEvent(state, event), initialState());
}

/**
 * Find the lowest positive integer not currently used by any participant
 * in the given section. This fills gaps left by removed participants.
 */
export function nextAvailableCarNumber(section) {
  const used = new Set(section.participants.map(p => p.car_number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
