import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema, ServerMessageSchema, PhoneClientMessageSchema, PhoneServerMessageSchema, PhoneTaskSchema, PhoneRoutineSchema,
  RoutineSchema, RoutineSpecSchema, TaskSchema, type Routine
} from '../src/index.js';

const AT = '2026-11-23T07:00:00.000Z';
const OP = '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const routine: Routine = {
  id: 'r1a2b3c', name: 'briefing',
  target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude', model: 'opus' },
  schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], tz: 'Europe/Brussels' },
  prompt: 'Briefing de {slot} (précédent : {last}). Relis etat.md.',
  catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: AT,
  runs: [{ at: AT, slot: '08:00', slotAt: AT, outcome: 'resumed', late: true }],
  lastRun: { at: AT, slot: '08:00', slotAt: AT, outcome: 'resumed', late: true },
  nextRun: '2026-11-23T12:30:00.000Z', nextRuns: ['2026-11-23T12:30:00.000Z', '2026-11-23T15:30:00.000Z', '2026-11-24T07:00:00.000Z']
};
/** Parses and serialises through JSON, as the wire does. */
const wire = <T>(schema: { parse(v: unknown): T }, v: unknown): T => schema.parse(JSON.parse(JSON.stringify(v)));

describe('routine schema', () => {
  it('round-trips a routine, and one a session made, pending', () => {
    expect(wire(RoutineSchema, routine)).toEqual(routine);
    const pending: Routine = { ...routine, state: 'pending', createdBy: { kind: 'session', id: 'iris-1', name: 'Iris' } };
    const { lastRun: _l, nextRun: _n, runs: _r, nextRuns: _x, ...bare } = pending;
    expect(wire(RoutineSchema, bare)).toEqual(bare);
  });
  it('refuses a bad time, a time or a day twice, an empty schedule and a bad id', () => {
    const bad = (schedule: object) => RoutineSchema.safeParse({ ...routine, schedule: { kind: 'recurring', ...schedule } }).success;
    expect(bad({ times: ['8:00'], days: ['mon'] })).toBe(false);
    expect(bad({ times: ['24:00'], days: ['mon'] })).toBe(false);
    expect(bad({ times: ['08:00', '08:00'], days: ['mon'] })).toBe(false);
    expect(bad({ times: ['08:00'], days: ['mon', 'mon'] })).toBe(false);
    expect(bad({ times: [], days: ['mon'] })).toBe(false);
    expect(bad({ times: ['08:00'], days: [] })).toBe(false);
    expect(bad({ times: ['08:00'], days: ['lun'] })).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, id: 'r12345' }).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, name: 'a briefing' }).success).toBe(false);
  });
  it('round-trips a two-week schedule, a one-shot, a proposal, and refuses a bad anchor or moment', () => {
    const biweekly = { ...routine, schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } } };
    expect(wire(RoutineSchema, biweekly)).toEqual(biweekly);
    const once = { ...routine, schedule: { kind: 'once', at: ['2026-12-03T16:00', '2026-12-10T16:00'] }, expiresAfterRun: true, state: 'done' };
    expect(wire(RoutineSchema, once)).toEqual(once);
    const proposed = { ...routine, proposal: { spec: { name: 'briefing', target: routine.target, schedule: { kind: 'recurring', times: ['09:00'], days: ['mon'] }, prompt: 'x' }, by: { id: 'iris-1', name: 'Iris' }, at: AT } };
    expect(wire(RoutineSchema, proposed)).toEqual(proposed);
    expect(RoutineSchema.safeParse({ ...routine, schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 3, anchor: '2026-11-27' } } }).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '27/11/2026' } } }).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, schedule: { kind: 'once', at: ['2026-12-03 16:00'] } }).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, schedule: { kind: 'once', at: [] } }).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, runs: Array(6).fill(routine.lastRun) }).success).toBe(false);
  });
  it('refuses a field it does not know, so a front cannot slip one in', () => {
    expect(RoutineSpecSchema.safeParse({ name: 'b', target: routine.target, schedule: routine.schedule, prompt: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('routine wire messages', () => {
  it('round-trips the local fronts\' list, commands and changes', () => {
    const list = { type: 'routine.list', rid: 'q1' };
    const add = { type: 'routine.cmd', rid: 'q2', op: 'add', by: 'iris-1', key: 'k', spec: { name: 'briefing', target: routine.target, schedule: routine.schedule, prompt: routine.prompt } };
    const update = { type: 'routine.cmd', rid: 'q3', op: 'update', routine: 'briefing', patch: { schedule: { kind: 'recurring', times: ['09:00'], days: ['mon'] } } };
    for (const m of [list, add, update, ...(['pause', 'resume', 'run', 'rm', 'approve', 'refuse'] as const).map(op => ({ type: 'routine.cmd', rid: 'q', op, routine: 'r1a2b3c' }))]) {
      expect(wire(ClientMessageSchema, m)).toEqual(m);
    }
    for (const m of [
      { type: 'routine.listed', rid: 'q1', routines: [routine] },
      { type: 'routine.result', rid: 'q2', routine },
      { type: 'routine.result', rid: 'q4', removed: 'r1a2b3c' },
      { type: 'routine.result', rid: 'q5', reason: 'no such routine', code: 'not_found' },
      { type: 'routine.changed', routine },
      { type: 'routine.changed', removed: 'r1a2b3c' },
      { type: 'routine.previewed', rid: 'q6', nextRuns: ['2026-12-03T15:00:00.000Z'] },
      { type: 'routine.previewed', rid: 'q7', nextRuns: [], reason: 'fuseau horaire inconnu' }
    ]) expect(wire(ServerMessageSchema, m)).toEqual(m);
    const preview = { type: 'routine.preview', rid: 'q6', schedule: { kind: 'once', at: ['2026-12-03T16:00'] } };
    expect(wire(ClientMessageSchema, preview)).toEqual(preview);
    const approve = { type: 'routine.cmd', rid: 'q8', op: 'approve', routine: 'r1a2b3c', spec: { name: 'briefing', target: routine.target, schedule: routine.schedule, prompt: 'corrigé' } };
    expect(wire(ClientMessageSchema, approve)).toEqual(approve);
  });
  it('refuses an unknown op', () => {
    expect(ClientMessageSchema.safeParse({ type: 'routine.cmd', rid: 'q', op: 'fire', routine: 'r1a2b3c' }).success).toBe(false);
  });
  it('carries a routine\'s « À toi » item on a task', () => {
    const task = { id: 't1', title: 'Iris veut programmer « briefing »', giver: 'iris-1', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: AT, updatedAt: AT, log: [],
      routine: { kind: 'approve', id: 'r1a2b3c', name: 'briefing' } };
    expect(wire(TaskSchema, task)).toEqual(task);
    const failed = { ...task, routine: { kind: 'failed', id: 'r1a2b3c', name: 'briefing', reason: 'dossier introuvable' } };
    const grouped = { ...task, routine: { kind: 'approve', id: 'r1a2b3c', name: 'prepa-121', ids: ['r1a2b3c', 'r4d5e6f'] } };
    expect(wire(TaskSchema, grouped)).toEqual(grouped);
    expect(wire(TaskSchema, failed)).toEqual(failed);
  });
});

describe('routine phone messages', () => {
  it('round-trips the list, the commands with an assertion on approve, and the changes', () => {
    const assertion = { id: 'aWQ', clientDataJSON: 'Y2Q', authenticatorData: 'YWQ', signature: 'c2ln' };
    for (const m of [
      { type: 'routine.list' },
      { type: 'routine.cmd', op: OP, action: 'run', routine: 'r1a2b3c' },
      { type: 'routine.show', routine: 'r1a2b3c' },
      { type: 'routine.cmd', op: OP, action: 'approve', routine: 'r1a2b3c', routineKey: 'k3y', assertion },
      { type: 'confirm.prepare', purpose: 'routine', routine: 'r1a2b3c', routineKey: 'k3y' }
    ]) expect(wire(PhoneClientMessageSchema, m)).toEqual(m);
    const { prompt, runs, ...rest } = routine;
    const seen = { ...rest, key: 'k3y', proposed: true };
    const { proposed: _pp, ...detailed } = seen;
    for (const m of [
      { type: 'routines', routines: [seen] },
      { type: 'routine.changed', routine: seen },
      { type: 'routine.changed', removed: 'r1a2b3c' },
      { type: 'routine.detail', id: 'r1a2b3c', routine: { ...detailed, prompt, runs } },
      { type: 'routine.detail', id: 'r1a2b3c', gone: true },
      { type: 'operation.result', op: OP, status: 'rejected', reason: 'not_pending' }
    ]) expect(wire(PhoneServerMessageSchema, m)).toEqual(m);
  });
  it('keeps the prompt off the phone\'s list and refuses an action the phone does not have', () => {
    expect(PhoneRoutineSchema.safeParse({ ...routine, key: 'k3y' }).success).toBe(false);
    const { prompt: _p, runs: _r, ...rest } = routine;
    expect(PhoneRoutineSchema.safeParse({ ...rest, key: 'k3y', target: { ...routine.target, cwd: `/${'a'.repeat(600)}` } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'routine.cmd', op: OP, action: 'rm', routine: 'r1a2b3c' }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'routine.cmd', op: OP, action: 'add', routine: 'r1a2b3c' }).success).toBe(false);
  });
  it('carries a routine\'s item on the phone\'s task', () => {
    const t = { id: 't1', title: 'La routine briefing (Iris) n\'a pas pu partir', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: AT, updatedAt: AT,
      routine: { kind: 'failed', id: 'r1a2b3c', name: 'briefing', reason: 'dossier introuvable' } };
    expect(wire(PhoneTaskSchema, t)).toEqual(t);
  });
});
