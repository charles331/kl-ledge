import type { OperatorNotice, Task } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet/routines';

/* The routines mockup's examples (docs/mockups/ledge-routines.html, cards 15 and 23), shared by the routine tests. */
export const T = '2026-11-23T01:10:00.000Z';
export const base = { catchUp: 'once' as const, createdAt: T, createdBy: { kind: 'session' as const, id: 'iris', name: 'Iris' }, prompt: 'Point de la semaine du {date}.' };
export const iris = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
/** The mockup's examples (docs/mockups/ledge-routines.html, cards 15 and 23), on the local machine. */
export const pointHebdo: FleetRoutine = { ...base, machineId: 'local', key: 'k-point', id: 'r3f9a12', name: 'point-hebdo', target: iris, schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending' };
export const veille: FleetRoutine = { ...base, machineId: 'local', id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, createdBy: { kind: 'user' },
  schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, state: 'enabled', lastRun: { at: T, slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille', field: 'cwd' } };
export const once = (id: string, name: string, at: string): FleetRoutine => ({ ...base, machineId: 'local', key: `k-${id}`, id, name, target: iris, schedule: { kind: 'once', at: [at] }, state: 'pending' });
export const group = [once('r000001', 'prepa-121', '2026-12-03T16:00'), once('r000002', 'prepa-comite-archi', '2026-12-07T15:00'), once('r000003', 'prepa-demo-compart', '2026-12-08T09:30')];
export const task = (id: string, routine: Task['routine'], extra: Partial<Task> = {}): Task => ({
  id, title: 'Iris veut programmer « point-hebdo »', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T, updatedAt: T, log: [], routine, ...extra
});
export const decision = (taskId: string): OperatorNotice => ({ id: `decision:${taskId}`, kind: 'decision', text: 'Iris veut programmer « point-hebdo »', who: 'Iris', priority: 'routine', at: T });
