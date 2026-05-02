/**
 * state-manager.js — Event reducer for RallyLab.
 * Pure functions, zero DOM/Supabase dependencies.
 * Shared between pre-race and race day.
 */

// Car numbers are opaque string identifiers (e.g. "42", "B100"). Normalize every
// value crossing into state so equality (Set, ===, .includes) is type-stable.
function normalizeCarNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeLanes(lanes) {
  if (!Array.isArray(lanes)) return lanes;
  return lanes.map(l => l && l.car_number != null
    ? { ...l, car_number: normalizeCarNumber(l.car_number) }
    : l);
}

/**
 * Compare two car numbers using natural sort (so "B9" < "B100").
 * Works for strings or numbers.
 */
export function compareCarNumbers(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

export function initialState() {
  return {
    rally_id: null,
    rally_name: null,
    rally_date: null,
    created_by: null,
    sections: {},
    groups: {},
    registrars: {},
    operators: {},
    checkin_volunteers: {},
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
    case 'RallyCreated':
      return {
        ...state,
        rally_id: payload.rally_id,
        rally_name: payload.rally_name,
        rally_date: payload.rally_date,
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
        },
        race_day: {
          ...state.race_day,
          loaded: true,
          sections: {
            ...state.race_day.sections,
            [payload.section_id]: {
              section_id: payload.section_id,
              section_name: payload.section_name,
              participants: [],
              arrived: [],
              starts: {},
              next_start_number: 1
            }
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

    case 'OperatorInvited':
      return {
        ...state,
        operators: {
          ...state.operators,
          [payload.operator_email]: {
            email: payload.operator_email,
            invited_by: payload.invited_by
          }
        }
      };

    case 'RosterUpdated': {
      const section = state.sections[payload.section_id];
      if (!section) return state;

      const groupId = payload.group_id;
      // Keep participants from other groups, remove this group's participants
      const otherParticipants = groupId
        ? section.participants.filter(p => p.group_id !== groupId)
        : [];
      const usedNumbers = new Set(otherParticipants.map(p => String(p.car_number)));

      // Reserve any explicit car_numbers in this payload first so auto-assign
      // avoids them. Duplicates among explicit values are resolved by letting
      // the first occurrence win and the rest fall through to auto-assign.
      const explicitReserved = new Set();
      for (const p of payload.participants) {
        const explicit = normalizeCarNumber(p.car_number);
        if (explicit && !usedNumbers.has(explicit) && !explicitReserved.has(explicit)) {
          explicitReserved.add(explicit);
        }
      }

      const newParticipants = payload.participants.map(p => {
        let carNumber = normalizeCarNumber(p.car_number);
        // Honor the explicit value only if still available; otherwise auto-assign.
        if (!carNumber || !explicitReserved.has(carNumber) || usedNumbers.has(carNumber)) {
          let n = 1;
          while (usedNumbers.has(String(n)) || explicitReserved.has(String(n))) n++;
          carNumber = String(n);
        } else {
          explicitReserved.delete(carNumber);
        }
        usedNumbers.add(carNumber);
        return {
          participant_id: p.participant_id,
          name: p.name,
          car_number: carNumber,
          group_id: groupId || null
        };
      });

      const mergedParticipants = [...otherParticipants, ...newParticipants];

      let newState = {
        ...state,
        sections: {
          ...state.sections,
          [payload.section_id]: {
            ...section,
            participants: mergedParticipants
          }
        }
      };

      // Also update race_day.sections if it exists
      const rdSec = state.race_day.sections[payload.section_id];
      if (rdSec) {
        newState = {
          ...newState,
          race_day: {
            ...newState.race_day,
            sections: {
              ...newState.race_day.sections,
              [payload.section_id]: {
                ...rdSec,
                participants: mergedParticipants
              }
            }
          }
        };
      }

      return newState;
    }

    case 'ParticipantAdded': {
      let newState = state;

      const explicit = normalizeCarNumber(payload.participant.car_number);

      // Update pre-race sections
      const section = state.sections[payload.section_id];
      if (section) {
        const used = new Set(section.participants.map(p => String(p.car_number)));
        const carNumber = (explicit && !used.has(explicit))
          ? explicit
          : nextAvailableCarNumber(section);
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
        const rdUsed = new Set(rdSec.participants.map(p => String(p.car_number)));
        const rdCarNumber = (explicit && !rdUsed.has(explicit))
          ? explicit
          : nextAvailableCarNumber(rdSec);
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

    case 'ParticipantUpdated': {
      // Patches participant fields (name, group_id) without changing car_number
      // or participant_id. Applied to both the pre-race roster and any race-day
      // section copy so check-in screens see corrections immediately.
      const patch = (p) => {
        if (p.participant_id !== payload.participant_id) return p;
        const next = { ...p };
        if (Object.prototype.hasOwnProperty.call(payload, 'name')) next.name = payload.name;
        if (Object.prototype.hasOwnProperty.call(payload, 'group_id')) next.group_id = payload.group_id || null;
        return next;
      };

      let newState = state;
      const section = state.sections[payload.section_id];
      if (section) {
        newState = {
          ...newState,
          sections: {
            ...newState.sections,
            [payload.section_id]: {
              ...section,
              participants: section.participants.map(patch)
            }
          }
        };
      }
      const rdSec = state.race_day.sections[payload.section_id];
      if (rdSec) {
        newState = {
          ...newState,
          race_day: {
            ...newState.race_day,
            sections: {
              ...newState.race_day.sections,
              [payload.section_id]: {
                ...rdSec,
                participants: rdSec.participants.map(patch)
              }
            }
          }
        };
      }
      return newState;
    }

    // ─── Race Day Events ──────────────────────────────────────────

    case 'CarArrived': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const cn = normalizeCarNumber(payload.car_number);
      if (cn == null || sec.arrived.includes(cn)) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              arrived: [...sec.arrived, cn]
            }
          }
        }
      };
    }

    case 'SectionStarted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || sec.next_start_number;
      return {
        ...state,
        race_day: {
          ...rd,
          active_section_id: payload.section_id,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              next_start_number: sn + 1,
              starts: {
                ...sec.starts,
                [sn]: {
                  start_number: sn,
                  started: true,
                  completed: false,
                  early_end: false,
                  available_lanes: payload.available_lanes || null,
                  removed: [],
                  results: {},
                  reruns: {},
                  lane_corrections: {}
                }
              }
            }
          }
        }
      };
    }

    case 'LanesChanged': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: { ...start, available_lanes: payload.available_lanes }
              }
            }
          }
        }
      };
    }

    case 'RaceCompleted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      // If a result already exists for this heat (DNF re-run), merge times
      const existing = start.results[payload.heat_number];
      const isPartialMerge = existing && existing.type === 'RaceCompleted';
      const mergedTimes = isPartialMerge
        ? { ...existing.times_ms, ...payload.times_ms }
        : payload.times_ms;
      const mergedLanes = isPartialMerge
        ? existing.lanes
        : normalizeLanes(payload.lanes || []);
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  results: {
                    ...start.results,
                    [payload.heat_number]: {
                      type: 'RaceCompleted',
                      heat_number: payload.heat_number,
                      lanes: mergedLanes,
                      times_ms: mergedTimes,
                      timestamp: payload.timestamp
                    }
                  }
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
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      const normalizedRankings = Array.isArray(payload.rankings)
        ? payload.rankings.map(r => ({ ...r, car_number: normalizeCarNumber(r.car_number) }))
        : payload.rankings;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  results: {
                    ...start.results,
                    [payload.heat_number]: {
                      type: 'ResultManuallyEntered',
                      heat_number: payload.heat_number,
                      lanes: normalizeLanes(payload.lanes || []),
                      rankings: normalizedRankings,
                      timestamp: payload.timestamp
                    }
                  }
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
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      const currentReruns = start.reruns[payload.heat_number] || 0;
      const { [payload.heat_number]: _, ...remainingResults } = start.results;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  reruns: { ...start.reruns, [payload.heat_number]: currentReruns + 1 },
                  results: remainingResults
                }
              }
            }
          }
        }
      };
    }

    case 'CarRemoved': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      const cn = normalizeCarNumber(payload.car_number);
      if (cn == null || start.removed.includes(cn)) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  removed: [...start.removed, cn]
                }
              }
            }
          }
        }
      };
    }

    case 'SectionCompleted': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  completed: true,
                  early_end: payload.early_end || false
                }
              }
            }
          }
        }
      };
    }

    case 'ResultCorrected': {
      const rd = state.race_day;
      const sec = rd.sections[payload.section_id];
      if (!sec) return state;
      const sn = payload.start_number || activeStartNumber(sec);
      const start = sec.starts[sn];
      if (!start) return state;
      return {
        ...state,
        race_day: {
          ...rd,
          sections: {
            ...rd.sections,
            [payload.section_id]: {
              ...sec,
              starts: {
                ...sec.starts,
                [sn]: {
                  ...start,
                  lane_corrections: {
                    ...start.lane_corrections,
                    [payload.heat_number]: normalizeLanes(payload.corrected_lanes)
                  }
                }
              }
            }
          }
        }
      };
    }

    case 'CheckInRoleGranted':
      return {
        ...state,
        checkin_volunteers: {
          ...state.checkin_volunteers,
          [payload.email]: {
            email: payload.email,
            section_ids: payload.section_ids || []
          }
        }
      };

    case 'CheckInRoleRevoked': {
      const { [payload.email]: _, ...remainingVolunteers } = state.checkin_volunteers;
      return { ...state, checkin_volunteers: remainingVolunteers };
    }

    default:
      return state;
  }
}

/**
 * Compare two events for replay order.
 *
 * Local IndexedDB `id` reflects insertion order *on this device*, not the
 * canonical event order. When an operator already has pre-race events
 * locally and then receives a registrar-originated CarArrived back from
 * the cloud, the inbound event can land at a lower local id than the
 * SectionCreated it depends on (or vice versa across devices), and the
 * reducer drops it because the section "doesn't exist yet."
 *
 * Supabase's BIGSERIAL `server_id` is monotonic across all devices, so we
 * use it as the primary key when present, and fall back to local id for
 * events still queued offline (which by definition came after everything
 * already synced on this device).
 */
function compareEventsForReplay(a, b) {
  const aServer = a.server_id != null ? Number(a.server_id) : null;
  const bServer = b.server_id != null ? Number(b.server_id) : null;
  if (aServer != null && bServer != null) return aServer - bServer;
  if (aServer != null) return -1;
  if (bServer != null) return 1;
  return (a.id || 0) - (b.id || 0);
}

export function rebuildState(events) {
  const ordered = [...events].sort(compareEventsForReplay);
  return ordered.reduce((state, event) => applyEvent(state, event), initialState());
}

/**
 * Find the lowest positive integer (as a string) not currently used by any
 * participant in the given section. Fills gaps left by removed participants.
 * Returned as a string because car_numbers are opaque identifiers throughout
 * the system (registrars may assign custom labels like "B100").
 */
export function nextAvailableCarNumber(section) {
  const used = new Set(section.participants.map(p => String(p.car_number)));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/**
 * Find the start_number of the active (started but not completed) start,
 * or fall back to the highest start_number. Used internally when events
 * don't carry an explicit start_number (backward compat).
 */
function activeStartNumber(sec) {
  const starts = Object.values(sec.starts || {});
  const active = starts.find(s => s.started && !s.completed);
  if (active) return active.start_number;
  if (starts.length > 0) return Math.max(...starts.map(s => s.start_number));
  return 1;
}

/**
 * Get a specific start object by start_number.
 * @param {Object} section - race_day section object
 * @param {number} startNumber
 * @returns {Object|null}
 */
export function getStart(section, startNumber) {
  return section.starts[startNumber] || null;
}

/**
 * Get the active (started, not completed) start, or null.
 * @param {Object} section - race_day section object
 * @returns {Object|null}
 */
export function getActiveStart(section) {
  return Object.values(section.starts || {}).find(s => s.started && !s.completed) || null;
}

/**
 * Get the latest (highest-numbered) start, or null.
 * @param {Object} section - race_day section object
 * @returns {Object|null}
 */
export function getLatestStart(section) {
  const starts = Object.values(section.starts || {});
  if (starts.length === 0) return null;
  return starts.reduce((a, b) => a.start_number > b.start_number ? a : b);
}

/**
 * Get all completed starts for a section.
 * @param {Object} section - race_day section object
 * @returns {Array<Object>}
 */
export function getCompletedStarts(section) {
  return Object.values(section.starts || {}).filter(s => s.completed).sort((a, b) => a.start_number - b.start_number);
}

/**
 * Build a "flat" section-like object from a section + start, suitable for
 * passing to scoring functions that expect the old flat shape.
 * @param {Object} section - race_day section object
 * @param {Object} start - a start object from section.starts
 * @returns {Object}
 */
export function flattenStart(section, start) {
  return {
    participants: section.participants,
    arrived: section.arrived,
    results: start.results,
    removed: start.removed,
    lane_corrections: start.lane_corrections,
    reruns: start.reruns,
    early_end: start.early_end || false
  };
}

/**
 * Derive the current race day phase for a section.
 * @param {Object} state - Full application state
 * @param {string} sectionId
 * @param {number} [startNumber] - specific start to check; defaults to latest
 * @returns {'idle'|'rally-loaded'|'check-in'|'racing'|'section-complete'}
 */
export function deriveRaceDayPhase(state, sectionId, startNumber) {
  const rd = state.race_day;
  if (!rd.loaded) return 'idle';

  const sec = rd.sections[sectionId];
  if (!sec) return 'rally-loaded';

  const starts = Object.values(sec.starts || {});
  if (starts.length === 0) return 'check-in';

  const start = startNumber
    ? sec.starts[startNumber]
    : getLatestStart(sec);

  if (!start) return 'check-in';
  if (start.completed) return 'section-complete';
  if (start.started) return 'racing';
  return 'check-in';
}

/**
 * Get the accepted (latest) result for a heat within a start.
 * @param {Object} section - race_day section object
 * @param {number} heatNumber
 * @param {number} [startNumber] - defaults to active start
 * @returns {Object|null}
 */
export function getAcceptedResult(section, heatNumber, startNumber) {
  const start = startNumber
    ? section.starts[startNumber]
    : (getActiveStart(section) || getLatestStart(section));
  if (!start) return null;
  return start.results[heatNumber] || null;
}
