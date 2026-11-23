import type { PhoneRoutine, PhoneRoutineDetail, PhoneTask, TaskRoutine } from '@ledge/protocol';
import type { RoutineTask } from '../../src/model/routines';

/** Monday 23 November 2026, 13:02 on the phone's clock: the mockup's moment (docs/mockups/ledge-routines.html). */
export const NOW = new Date(2026, 10, 23, 13, 2).getTime();
/** A local wall-clock moment as an ISO instant, as the daemon's `nextRun` comes. */
export const at = (d: number, h: number, m: number, month = 10) => new Date(2026, month, d, h, m).toISOString();

/** A routine as the phone's list gets it: the mockup's briefing unless told otherwise. */
export const routine = (extra: Partial<PhoneRoutine> = {}): PhoneRoutine => ({
  id: 'r1a2b3c', name: 'briefing', target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' },
  schedule: { kind: 'recurring', times: ['13:30', '08:00', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: '2026-11-01T08:00:00.000Z', key: 'k-briefing',
  nextRun: at(23, 13, 30), lastRun: { at: '2026-11-23T07:42:00.000Z', slot: '08:00', outcome: 'resumed', late: true }, ...extra
});

/** The mockup's « point-hebdo », asked by Iris and waiting on the user. */
export const pointHebdo = (extra: Partial<PhoneRoutine> = {}): PhoneRoutine => routine({
  id: 'r3f9a12', name: 'point-hebdo', schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending',
  createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, key: 'k-point', nextRun: undefined, lastRun: undefined, ...extra
});

/** The mockup's « veille », whose 18:00 run could not leave. */
export const veille = (extra: Partial<PhoneRoutine> = {}): PhoneRoutine => routine({
  id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, key: 'k-veille',
  schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, nextRun: at(23, 18, 0),
  lastRun: { at: '2026-11-22T17:00:00.000Z', slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille' }, ...extra
});

/** A one-shot proposed with two others, waiting on the user. */
export const oneShot = (id: string, name: string, when: string, extra: Partial<PhoneRoutine> = {}): PhoneRoutine => routine({
  id, name, schedule: { kind: 'once', at: [when] }, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' },
  key: `k-${name}`, nextRun: undefined, lastRun: undefined, ...extra
});

/** The routine whole, as `routine.detail` brings it. */
export const detail = (r: PhoneRoutine, prompt: string): PhoneRoutineDetail => {
  const { cut: _c, proposed: _p, ...rest } = r;
  return { ...rest, prompt };
};

/** A routine's item of « À toi », given to Ledge by the session that asked. */
export const routineTask = (id: string, routine: TaskRoutine, extra: Partial<PhoneTask> = {}): RoutineTask => ({
  id, title: 'Iris veut programmer « point-hebdo »', owner: 'ledge', ownerName: 'Ledge', giver: 'iris', giverName: 'Iris', state: 'open',
  at: new Date(2026, 10, 23, 2, 10).toISOString(), updatedAt: new Date(2026, 10, 23, 2, 10).toISOString(), routine, ...extra
});
