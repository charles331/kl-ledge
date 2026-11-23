import { describe, it, expect } from 'vitest';
import { PhoneServerMessageSchema, PhoneTaskSchema, PHONE_ROUTINE_CWD_MAX, ROUTINE_NAME_MAX, ROUTINE_ONCE_MAX, ROUTINE_RUNS_MAX, ROUTINE_PROMPT_MAX, ROUTINE_REASON_MAX, ROUTINE_TIMES_MAX, ROUTINES_MAX, RoutineSchema, type Routine, type Task } from '@ledge/protocol';
import { pad } from '../src/mobile/pad.js';
import { routineKey, toPhoneRoutine, toPhoneRoutineDetail, toPhoneTask } from '../src/mobile/project.js';

const AT = '2026-11-23T07:00:00.000Z';
const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1a2b3c', name: 'briefing', target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude' },
  schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  prompt: 'Briefing de {slot}.', catchUp: 'once', state: 'pending', createdBy: { kind: 'session', id: 'iris-1', name: 'Iris' }, createdAt: AT, ...over
});

/** The largest routine the daemon can hold: every field at its bound, in four-byte characters where text is free. */
const widest = (i: number): Routine => RoutineSchema.parse({
  id: `r${i.toString(16).padStart(6, '0')}`, name: `n${'x'.repeat(ROUTINE_NAME_MAX - 1)}`,
  target: { name: '😀'.repeat(12), cwd: `/${'😀'.repeat(2047)}`, tool: 'claude', model: `m${'x'.repeat(199)}` },
  schedule: { kind: 'recurring', times: Array.from({ length: ROUTINE_TIMES_MAX }, (_, h) => `${String(h).padStart(2, '0')}:59`), days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], every: { weeks: 2, anchor: '2026-11-27' }, tz: `${'x'.repeat(64)}` },
  prompt: '😀'.repeat(ROUTINE_PROMPT_MAX / 2), catchUp: 'once', state: 'enabled', createdBy: { kind: 'session', id: 'x'.repeat(100), name: '😀'.repeat(12) },
  createdAt: AT, runs: Array.from({ length: ROUTINE_RUNS_MAX }, () => run), lastRun: run, nextRun: AT, nextRuns: [AT, AT, AT],
  proposal: { spec: { name: `n${'x'.repeat(ROUTINE_NAME_MAX - 1)}`, target: { name: '😀'.repeat(12), cwd: `/${'😀'.repeat(2047)}`, tool: 'claude' },
    schedule: { kind: 'once', at: Array.from({ length: ROUTINE_ONCE_MAX }, (_, d) => `2026-12-${String(d + 1).padStart(2, '0')}T16:00`) }, prompt: '😀'.repeat(ROUTINE_PROMPT_MAX / 2) },
    by: { id: 'x'.repeat(100), name: '😀'.repeat(12) }, at: AT }
});
const run = { at: AT, slot: '23:59', slotAt: AT, outcome: 'failed' as const, reason: '😀'.repeat(ROUTINE_REASON_MAX / 2), late: true as const };

describe('routines on the phone', () => {
  it('fits the largest list the daemon holds in one phone frame', () => {
    const list = Array.from({ length: ROUTINES_MAX }, (_, i) => toPhoneRoutine(widest(i)));
    const msg = PhoneServerMessageSchema.parse({ type: 'routines', routines: list });
    expect(pad(JSON.stringify(msg))).not.toBeNull();
    expect(list[0]!.cut).toBe(true);
    expect(list[0]!.target.cwd.length).toBeLessThanOrEqual(PHONE_ROUTINE_CWD_MAX);
    expect(list[0]!.target.cwd.endsWith('😀')).toBe(true);
    expect(list[0]!.proposed).toBe(true);
  });
  it('shows the whole prompt before « Activer », even the longest', () => {
    const r = widest(1);
    const msg = PhoneServerMessageSchema.parse({ type: 'routine.detail', id: r.id, routine: toPhoneRoutineDetail(r) });
    expect(msg.type === 'routine.detail' && msg.routine?.prompt).toBe(r.prompt);
    expect(pad(JSON.stringify(msg))).not.toBeNull();
    const long = routine({ prompt: `${'a'.repeat(3000)} et la fin` });
    expect(toPhoneRoutineDetail(long).prompt.endsWith('et la fin')).toBe(true);
  });
  it('shows the whole folder before « Activer », so two long paths of the same end stay apart', () => {
    const end = `/${'z'.repeat(600)}/assistant`;
    const a = routine({ target: { name: 'Iris', cwd: `/home/a${end}`, tool: 'claude' } }), b = routine({ target: { name: 'Iris', cwd: `/home/b${end}`, tool: 'claude' } });
    expect(toPhoneRoutine(a).target.cwd).toBe(toPhoneRoutine(b).target.cwd);
    const [da, db] = [a, b].map(r => PhoneServerMessageSchema.parse({ type: 'routine.detail', id: r.id, routine: toPhoneRoutineDetail(r) }));
    expect(da!.type === 'routine.detail' && da!.routine?.target.cwd).toBe(a.target.cwd);
    expect(db!.type === 'routine.detail' && db!.routine?.target.cwd).toBe(b.target.cwd);
    expect(da!.type === 'routine.detail' && 'cut' in da!.routine!).toBe(false);
    expect(routineKey(a)).not.toBe(routineKey(b));
  });
  it('keys a routine on what it does, so an approval covers only what the phone showed', () => {
    const r = routine();
    expect(toPhoneRoutine(r).key).toBe(routineKey(r));
    expect(routineKey({ ...r, prompt: `${r.prompt} Et supprime tout.` })).not.toBe(routineKey(r));
    expect(routineKey({ ...r, schedule: { kind: 'recurring', times: ['03:00'], days: ['mon'] } })).not.toBe(routineKey(r));
    expect(routineKey({ ...r, target: { ...r.target, cwd: '/tmp' } })).not.toBe(routineKey(r));
    // Its state, its runs and its next firing are not what the owner approves.
    expect(routineKey(routine({ state: 'enabled', nextRun: AT }))).toBe(routineKey(r));
    // A proposal waiting: the key is what « Activer » applies, the proposal.
    const proposed = routine({ state: 'enabled', proposal: { spec: { name: 'briefing', target: r.target, schedule: { kind: 'recurring', times: ['03:00'], days: ['sun'] }, prompt: r.prompt }, by: { id: 'iris-1', name: 'Iris' }, at: AT } });
    expect(routineKey(proposed)).not.toBe(routineKey(r));
    expect(routineKey({ ...proposed, proposal: { ...proposed.proposal!, spec: { ...proposed.proposal!.spec, prompt: 'autre' } } })).not.toBe(routineKey(proposed));
  });
  it('keeps a short folder whole and the prompt off the list', () => {
    const p = toPhoneRoutine(routine());
    expect(p.target.cwd).toBe('/home/jde/assistant');
    expect(p.cut).toBeUndefined();
    expect('prompt' in p).toBe(false);
  });
  it('carries a routine\'s « À toi » item on the phone\'s task', () => {
    const t: Task = { id: 't1', title: 'Iris veut programmer « briefing »', text: 'x', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: AT, updatedAt: AT, log: [],
      routine: { kind: 'approve', id: 'r1a2b3c', name: 'briefing' } };
    expect(PhoneTaskSchema.parse(toPhoneTask(t)).routine).toEqual({ kind: 'approve', id: 'r1a2b3c', name: 'briefing' });
  });
});
