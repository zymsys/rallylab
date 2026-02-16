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
    registrars: {},
    race_day: {
      loaded: false,
      sections: {},
      active_section_id: null
    }
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
      let newState = state;

      // Update pre-race sections
      const section = state.sections[payload.section_id];
      if (section) {
        const carNumber = nextAvailableCarNumber(section);
        newState = {
          ...newState,
          sections: {
            ...newState.sections,
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

      // Update race_day sections (late registration)
      const rdSec = state.race_day.sections[payload.section_id];
      if (rdSec) {
        const rdCarNumber = nextAvailableCarNumber(rdSec);
        newState = {
          ...newState,
          race_day: {
            ...newState.race_day,
            sections: {
              ...newState.race_day.sections,
              [payload.section_id]: {
                ...rdSec,
                participants: [
                  ...rdSec.participants,
                  {
                    participant_id: payload.participant.participant_id,
                    name: payload.participant.name,
                    car_number: rdCarNumber,
                    group_id: payload.group_id || null
                  }
                ]
              }
            }
          }
        };
      }

      return newState;
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

    // ─── Race Day Events ──────────────────────────────────────────

    case 'RosterLoaded': {
      const rd = state.race_day;
      const sectionEntry = {
        section_id: payload.section_id,
        section_name: payload.section_name,
        participants: (payload.participants || []).map(p => ({
          participant_id: p.participant_id,
          name: p.name,
          car_number: p.car_number,
          group_id: p.group_id || null
        })),
        arrived: [],
        removed: [],
        started: false,
        completed: false,
        heats: [],
        results: {},
        reruns: {}
      };
      return {
        ...state,
        race_day: {
          ...rd,
          loaded: true,
          sections: { ...rd.sections, [payload.section_id]: sectionEntry }
        }
      };
    }

    case 'CarArrived': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      if (sec.arrived.includes(payload.car_number)) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              arrived: [...sec.arrived, payload.car_number]
            }
          }
        }
      };
    }

    case 'SectionStarted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          active_section_id: payload.section_id,
          sections: {
            ...rd.sections,
            [payload.section_id]: { ...sec, started: true }
          }
        }
      };
    }

    case 'HeatStaged': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              heats: [...sec.heats, {
                heat_number: payload.heat_number,
                lanes: payload.lanes
              }]
            }
          }
        }
      };
    }

    case 'RaceCompleted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              results: {
                ...sec.results,
                [payload.heat_number]: {
                  type: 'RaceCompleted',
                  heat_number: payload.heat_number,
                  times_ms: payload.times_ms,
                  timestamp: payload.timestamp
                }
              }
            }
          }
        }
      };
    }

    case 'ResultManuallyEntered': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              results: {
                ...sec.results,
                [payload.heat_number]: {
                  type: 'ResultManuallyEntered',
                  heat_number: payload.heat_number,
                  rankings: payload.rankings,
                  timestamp: payload.timestamp
                }
              }
            }
          }
        }
      };
    }

    case 'RerunDeclared': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const currentReruns = sec.reruns[payload.heat_number] || 0;
      const { [payload.heat_number]: _, ...remainingResults } = sec.results;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              reruns: { ...sec.reruns, [payload.heat_number]: currentReruns + 1 },
              results: remainingResults
            }
          }
        }
      };
    }

    case 'CarRemoved': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      if (sec.removed.includes(payload.car_number)) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              removed: [...sec.removed, payload.car_number]
            }
          }
        }
      };
    }

    case 'SectionCompleted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: { ...sec, completed: true }
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

/**
 * Derive the current race day phase for a section.
 * @param {Object} state - Full application state
 * @param {string} sectionId
 * @returns {'idle'|'event-loaded'|'check-in'|'staging'|'results'|'section-complete'}
 */
export function deriveRaceDayPhase(state, sectionId) {
  const rd = state.race_day;
  if (!rd.loaded) return 'idle';

  const sec = rd.sections[sectionId];
  if (!sec) return 'event-loaded';

  if (sec.completed) return 'section-complete';

  if (!sec.started) return 'check-in';

  // Section is started — determine staging vs results
  const heatCount = sec.heats.length;
  if (heatCount === 0) return 'staging';

  const lastHeat = sec.heats[heatCount - 1].heat_number;
  const hasResult = sec.results[lastHeat] != null;

  return hasResult ? 'results' : 'staging';
}

/**
 * Get the current heat number for a section.
 * Returns the last staged heat number, or 0 if no heats staged.
 * @param {Object} state - Full application state
 * @param {string} sectionId
 * @returns {number}
 */
export function getCurrentHeat(state, sectionId) {
  const sec = state.race_day.sections[sectionId];
  if (!sec || sec.heats.length === 0) return 0;
  return sec.heats[sec.heats.length - 1].heat_number;
}

/**
 * Get the accepted (latest) result for a heat.
 * @param {Object} section - race_day section object
 * @param {number} heatNumber
 * @returns {Object|null}
 */
export function getAcceptedResult(section, heatNumber) {
  return section.results[heatNumber] || null;
}
