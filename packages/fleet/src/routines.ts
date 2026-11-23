import type { Routine, RoutineCmd, RoutineField, RoutineRefusal } from '@ledge/protocol';

/**
 * Routines (spec 2026-11-23-routines-design, mockup docs/mockups/ledge-routines.html): each machine's daemon keeps its own
 * and fires them on its own clock. A front reads them through the fleet, each with the machine that holds it.
 */

/** A routine, with the machine whose daemon holds and fires it. */
export type FleetRoutine = Routine & { machineId: string };

/** What a front asks of a routine: a `routine.cmd` without its envelope, sent to one machine. */
export type RoutineAsk = Omit<RoutineCmd, 'type' | 'rid'>;

/** Why a `routineCmd` failed: the machine is down or falls (`offline`), its daemon does not know routines (`outdated`), or the
 *  daemon refused it (its own code). */
export interface RoutineFailure { code: RoutineRefusal | 'offline' | 'outdated'; message: string; /** The field the daemon names (ff7a19c2). */ field?: RoutineField }

/** The routines of every machine as one list, from the per-machine lists the fleet keeps. */
export function fleetRoutines(byMachine: ReadonlyMap<string, readonly Routine[]>): FleetRoutine[] {
  return [...byMachine].flatMap(([machineId, rs]) => rs.map(r => ({ ...r, machineId })));
}

/** A machine's list after a `routine.changed`: the routine replaced in place (or added first, as the list is newest first), or
 *  taken out (`removed`). Pure. */
export function applyRoutineChange(list: readonly Routine[], change: { routine?: Routine | undefined; removed?: string | undefined }): Routine[] {
  if (change.removed) return list.filter(r => r.id !== change.removed);
  const r = change.routine;
  if (!r) return [...list];
  return list.some(x => x.id === r.id) ? list.map(x => (x.id === r.id ? r : x)) : [r, ...list];
}
