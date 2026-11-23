import { fromRoutines } from '../src/operator/detect.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDecision, TaskSchema, type Routine, type RoutineSpec, type Session, type Weekday } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTasks, type Tasks } from '../src/daemon/tasks.js';
import { routineKey } from '../src/routineKey.js';
import { createRoutines, daysLabel, scheduleLabel, latestSlot, loadRoutines, nextSlot, nextSlots, routinesJournal, type RoutineCaller, type Routines, type RoutinesDeps } from '../src/daemon/routines.js';

const TZ = 'Europe/Brussels';
const T0 = '2026-11-20T06:00:00.000Z'; // Friday 07:00 in Brussels
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/home/jde/assistant', project: 'assistant', title: `${name} · assistant`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
const spec = (over: Partial<RoutineSpec> = {}): RoutineSpec => ({ name: 'briefing', target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude' },
  schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], tz: TZ }, prompt: 'Briefing de {slot} (précédent : {last}), {date}.', ...over });
const at = (s: string) => Date.parse(s);
const flush = () => new Promise(r => setTimeout(r, 0));

let store: Store; let tasks: Tasks; let routines: Routines; let clock: number; let dir: string; let journal: ReturnType<typeof routinesJournal>;
let typed: Array<{ to: string; text: string; rid: string }>; let queued: Set<string>; let withdrawn: string[];
let resumed: string[]; let launched: Array<{ name: string; prompt: string }>; let missing: Set<string>;
const user: RoutineCaller = { kind: 'user' };
const as = (id: string): RoutineCaller => ({ kind: 'session', session: store.get(id)! });
const cmd = (caller: RoutineCaller, op: Parameters<Routines['run']>[0]['op'], extra: Partial<Parameters<Routines['run']>[0]> = {}) => routines.run({ type: 'routine.cmd', rid: 'q', op, ...extra }, caller);
const deps = (over: Partial<RoutinesDeps> = {}): RoutinesDeps => ({
  store, tasks, home: '/home/jde', tz: TZ, now: () => clock, startMs: 3_600_000,
  mailbox: {
    notify: (to, text, rid) => { if (!store.get(to)?.tmuxSession) return false; typed.push({ to, text, rid }); queued.add(rid); return true; },
    waiting: rid => queued.has(rid), withdraw: rid => { withdrawn.push(rid); return queued.delete(rid); }
  },
  resume: async s => { resumed.push(s.id); store.upsert({ ...s, state: 'idle', exitedAt: undefined }); return null; },
  resumable: s => !!s.agentSessionId,
  launch: async req => { launched.push({ name: req.name, prompt: req.prompt }); const s = mk('fresh', req.name); store.upsert(s); return s; },
  folder: async cwd => (missing.has(cwd) ? `dossier introuvable : ${cwd}` : undefined),
  journal,
  ...over
});
const only = () => routines.all()[0]!;
const decisions = () => tasks.all().filter(openDecision);
const typedDone = (i = typed.length - 1) => { queued.delete(typed[i]!.rid); routines.noticeDone(typed[i]!.rid, true); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'routines-'));
  journal = routinesJournal(join(dir, 'routines.json'));
  store = new Store({ journalPath: join(dir, 'sessions.json') });
  tasks = createTasks({ store, mailbox: { notify: () => true }, now: () => new Date(clock).toISOString() });
  clock = at(T0); typed = []; queued = new Set(); withdrawn = []; resumed = []; launched = []; missing = new Set();
  routines = createRoutines(deps());
});
afterEach(() => { routines.close(); tasks.close(); });

describe('slots', () => {
  const sched = spec().schedule;
  it('finds the next slot over times and days, Friday evening to Monday morning', () => {
    expect(nextSlot(sched, at(T0), TZ)).toEqual({ at: at('2026-11-20T07:00:00.000Z'), slot: '08:00' });
    expect(nextSlot(sched, at('2026-11-20T07:00:00.000Z'), TZ)!.slot).toBe('13:30');
    expect(new Date(nextSlot(sched, at('2026-11-20T16:00:00.000Z'), TZ)!.at).toISOString()).toBe('2026-11-23T07:00:00.000Z');
  });
  it('keeps 08:00 at 08:00 across a DST change, and in another zone', () => {
    // Brussels moves to summer time on Sunday 29 March 2026: 08:00 is 07:00 UTC before, 06:00 after.
    expect(new Date(nextSlot(sched, at('2026-03-27T06:00:00.000Z'), TZ)!.at).toISOString()).toBe('2026-03-27T07:00:00.000Z');
    expect(new Date(nextSlot(sched, at('2026-03-27T16:00:00.000Z'), TZ)!.at).toISOString()).toBe('2026-03-30T06:00:00.000Z');
    expect(new Date(nextSlot({ ...sched, tz: 'America/New_York' }, at(T0), 'America/New_York')!.at).toISOString()).toBe('2026-11-20T13:00:00.000Z');
  });
  it('finds the latest slot missed, never one before the last check', () => {
    expect(latestSlot(sched, at('2026-11-20T15:00:00.000Z'), TZ, at(T0))).toEqual({ at: at('2026-11-20T12:30:00.000Z'), slot: '13:30' });
    expect(latestSlot(sched, at('2026-11-20T15:00:00.000Z'), TZ, at('2026-11-20T13:00:00.000Z'))).toBeUndefined();
  });
  const two = (anchor: string, days: Weekday[], time: string) =>
    ({ kind: 'recurring' as const, times: [time], days, every: { weeks: 2 as const, anchor }, tz: TZ });
  const next3 = (s: RoutineSpec['schedule'], from: string) => nextSlots(s, at(from), TZ, 3).map(x => new Date(x.at).toISOString());
  it('every two weeks: the anchor\'s ISO week and every other one, anchor past or future, on another weekday', () => {
    // Anchor a Friday (the Sprint Review), slot a Thursday of the same week.
    expect(next3(two('2026-11-27', ['thu'], '16:00'), T0)).toEqual(['2026-11-26T15:00:00.000Z', '2026-12-10T15:00:00.000Z', '2026-12-24T15:00:00.000Z']);
    // The same parity from an anchor 52 weeks before, or 14 weeks after (2026 has 53 ISO weeks: 2026-01-02 is the other parity).
    expect(next3(two('2026-01-02', ['thu'], '16:00'), T0)[0]).toBe('2026-12-03T15:00:00.000Z');
    expect(next3(two('2025-11-28', ['thu'], '16:00'), T0)).toEqual(next3(two('2026-11-27', ['thu'], '16:00'), T0));
    expect(next3(two('2027-03-05', ['thu'], '16:00'), T0)).toEqual(next3(two('2026-11-27', ['thu'], '16:00'), T0));
    // The off weeks' anchor gives the other Thursdays.
    expect(next3(two('2026-11-20', ['thu'], '16:00'), T0)).toEqual(['2026-12-03T15:00:00.000Z', '2026-12-17T15:00:00.000Z', '2026-12-31T15:00:00.000Z']);
  });
  it('every two weeks across ISO week 53 and a DST change', () => {
    // 2026 has 53 ISO weeks: Thursday 31 December 2026 is in week 53, Thursday 14 January 2027 two weeks later.
    expect(next3(two('2026-12-31', ['thu'], '08:15'), '2026-12-30T00:00:00.000Z')).toEqual(['2026-12-31T07:15:00.000Z', '2027-01-14T07:15:00.000Z', '2027-01-28T07:15:00.000Z']);
    // Over Brussels' change to summer time (29 March 2027 is not it: 28 March 2027 is), 08:15 stays 08:15.
    expect(next3(two('2027-03-18', ['thu'], '08:15'), '2027-03-17T00:00:00.000Z')).toEqual(['2027-03-18T07:15:00.000Z', '2027-04-01T06:15:00.000Z', '2027-04-15T06:15:00.000Z']);
  });
  it('the owner\'s §4 routines: their next 3 firings from Friday 20 November 2026 07:00, written by hand', () => {
    const wk = (days: Weekday[], times: string[]) => ({ kind: 'recurring' as const, times, days, tz: TZ });
    const cases: Array<[string, RoutineSpec['schedule'], string[]]> = [
      ['briefing', wk(['mon', 'tue', 'wed', 'thu', 'fri'], ['08:00', '13:30', '16:30']), ['2026-11-20T07:00:00.000Z', '2026-11-20T12:30:00.000Z', '2026-11-20T15:30:00.000Z']],
      ['garde-mr', wk(['mon', 'tue', 'wed', 'thu', 'fri'], ['10:30', '15:00']), ['2026-11-20T09:30:00.000Z', '2026-11-20T14:00:00.000Z', '2026-11-23T09:30:00.000Z']],
      ['cloture', wk(['mon', 'tue', 'wed', 'thu', 'fri'], ['17:15']), ['2026-11-20T16:15:00.000Z', '2026-11-23T16:15:00.000Z', '2026-11-24T16:15:00.000Z']],
      ['prepa-compart', wk(['fri'], ['10:05']), ['2026-11-20T09:05:00.000Z', '2026-11-27T09:05:00.000Z', '2026-12-04T09:05:00.000Z']],
      ['synthese-hebdo', wk(['fri'], ['16:00']), ['2026-11-20T15:00:00.000Z', '2026-11-27T15:00:00.000Z', '2026-12-04T15:00:00.000Z']],
      ['hygiene-poste', wk(['fri'], ['16:15']), ['2026-11-20T15:15:00.000Z', '2026-11-27T15:15:00.000Z', '2026-12-04T15:15:00.000Z']],
      ['prepa-arch', two('2026-11-26', ['thu'], '08:15'), ['2026-11-26T07:15:00.000Z', '2026-12-10T07:15:00.000Z', '2026-12-24T07:15:00.000Z']],
      ['bilan-sprint', two('2026-11-27', ['thu'], '16:00'), ['2026-11-26T15:00:00.000Z', '2026-12-10T15:00:00.000Z', '2026-12-24T15:00:00.000Z']],
      ['prepa-retro', two('2026-11-27', ['fri'], '08:15'), ['2026-11-27T07:15:00.000Z', '2026-12-11T07:15:00.000Z', '2026-12-25T07:15:00.000Z']],
      ['tri-sprint', two('2026-11-27', ['fri'], '15:30'), ['2026-11-27T14:30:00.000Z', '2026-12-11T14:30:00.000Z', '2026-12-25T14:30:00.000Z']],
      ['prepa-planning', two('2026-11-30', ['mon'], '08:15'), ['2026-11-30T07:15:00.000Z', '2026-12-14T07:15:00.000Z', '2026-12-28T07:15:00.000Z']],
      ['prepa-121', { kind: 'once', at: ['2026-12-03T16:00'], tz: TZ }, ['2026-12-03T15:00:00.000Z']]
    ];
    for (const [name, s, want] of cases) expect([name, next3(s, T0)]).toEqual([name, want]);
  });
  it('words the days as « À toi » shows them', () => {
    expect(daysLabel(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('lun–ven');
    expect(scheduleLabel({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } })).toBe('16:00 (jeu, 1 sem. sur 2)');
    expect(scheduleLabel({ kind: 'once', at: ['2026-12-03T16:00', '2026-12-07T15:00'] })).toBe('jeu. 3 déc. 16:00, lun. 7 déc. 15:00');
    expect(daysLabel(['mon', 'wed', 'fri'])).toBe('lun, mer, ven');
    expect(daysLabel(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('tous les jours');
  });
});

describe('the recipient a firing names to « le point » (review of 17323905)', () => {
  it('keeps the queued recipient when a new exact-name session appears before delivery', async () => {
    store.upsert(mk('old', 'Iris', { state: 'exited', handover: { state: 'done', to: 'relief', at: T0 } as Session['handover'] }));
    store.upsert(mk('relief', 'Iris-2', { state: 'working', relieves: { id: 'old', name: 'Iris', at: T0 } }));
    await cmd(user, 'add', { spec: spec() });
    const before = routines.all();
    await cmd(user, 'run', { routine: 'briefing' });
    await flush();
    expect(typed[0]!.to).toBe('relief');
    store.upsert(mk('new', 'Iris'));
    typedDone();
    expect(fromRoutines(before, routines.all(), store.all())[0]!.payload.session).toBe('relief');
  });
});

describe('firing', () => {
  it('types into the live session at its slot, then records it delivered', async () => {
    store.upsert(mk('iris', 'Iris'));
    const r = (await cmd(user, 'add', { spec: spec() })).routine!;
    expect(r).toMatchObject({ state: 'enabled', createdBy: { kind: 'user' }, catchUp: 'once', nextRun: '2026-11-20T07:00:00.000Z' });
    clock = at('2026-11-20T07:00:10.000Z'); routines.tick(); await flush();
    expect(typed).toHaveLength(1);
    expect(typed[0]!.to).toBe('iris');
    expect(typed[0]!.text).toBe('<ledge-routine name="briefing" slot="08:00" late="false">Briefing de 08:00 (précédent : aucun), 2026-11-20.</ledge-routine>');
    expect(only().lastRun).toBeUndefined();
    typedDone();
    expect(only().lastRun).toEqual({ at: '2026-11-20T07:00:10.000Z', slot: '08:00', slotAt: '2026-11-20T07:00:00.000Z', outcome: 'delivered', session: 'iris' });
    expect(only().nextRun).toBe('2026-11-20T12:30:00.000Z');
  });
  it('keeps the session it typed into, though another of that name appears before the line is typed', async () => {
    store.upsert(mk('iris', 'Iris', { state: 'working' }));
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    store.upsert(mk('iris', 'Iris', { state: 'exited' })); store.upsert(mk('iris2', 'Iris'));
    typedDone();
    expect(only().lastRun).toMatchObject({ outcome: 'delivered', session: 'iris' });
  });
  it('sends each routine with its key, as an approve sends it back, and keeps none', async () => {
    store.upsert(mk('iris', 'Iris'));
    const r = (await cmd(as('iris'), 'add', { spec: spec() })).routine!;
    expect(r.key).toBe(routineKey(r));
    expect(only().key).toBe(routineKey(only()));
    await journal.flush(); routines.close(); await flush();
    expect(loadRoutines(join(dir, 'routines.json'))[0]).not.toHaveProperty('key');
    routines = createRoutines(deps());
    const approved = await cmd(user, 'approve', { routine: r.id, expect: r.key });
    expect(approved.reason ?? '').toBe('');
    expect(approved.routine).toMatchObject({ state: 'enabled' });
  });
  it('calls a failed typing gone only when the session is', async () => {
    store.upsert(mk('iris', 'Iris', { state: 'working' }));
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    routines.noticeDone(typed.at(-1)!.rid, false, 'terminal write failed');
    expect(only().lastRun).toMatchObject({ outcome: 'failed', reason: 'terminal write failed' });
    expect(only().lastRun).not.toHaveProperty('cause');
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    store.upsert(mk('iris', 'Iris', { state: 'exited' }));
    routines.noticeDone(typed.at(-1)!.rid, false, "la session s'est terminée avant de le recevoir");
    expect(only().lastRun).toMatchObject({ outcome: 'failed', cause: 'gone' });
  });
  it('tells a failed launch from a failed resume, and an earlier exception from both', async () => {
    routines.close();
    routines = createRoutines(deps({ launch: async () => { throw new Error('tmux refused'); } }));
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(only().lastRun).toMatchObject({ outcome: 'failed', reason: 'tmux refused', cause: 'launch_failed' });
    routines.close(); await journal.flush();
    routines = createRoutines(deps({ folder: async () => { throw new Error('stat exploded'); } }));
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(only().lastRun).toMatchObject({ outcome: 'failed', reason: 'stat exploded' });
    expect(only().lastRun).not.toHaveProperty('cause');
  });
  it('reaches the relief of a relieved session', async () => {
    store.upsert(mk('iris', 'Iris', { state: 'exited', handover: { state: 'done', to: 'nova', at: T0 } as Session['handover'] }));
    store.upsert(mk('nova', 'Nova'));
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(typed.map(t => t.to)).toEqual(['nova']);
  });
  it('resumes a gone session that has a conversation, then types into it', async () => {
    store.upsert(mk('iris', 'Iris', { state: 'exited', agentSessionId: 'conv-1' }));
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(resumed).toEqual(['iris']);
    typedDone();
    expect(only().lastRun).toMatchObject({ outcome: 'resumed', session: 'iris' });
  });
  it('launches a session never started, the prompt as its first instruction', async () => {
    await cmd(user, 'add', { spec: spec() });
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(launched).toHaveLength(1);
    expect(launched[0]!.name).toBe('Iris');
    expect(launched[0]!.prompt).toMatch(/^<ledge-routine name="briefing" slot="07:00" late="false">Briefing de 07:00/);
    expect(only().lastRun).toMatchObject({ outcome: 'launched', session: 'fresh' });
  });
  it('fails a firing whose folder is gone, as an « À toi » item, never in silence', async () => {
    await cmd(user, 'add', { spec: spec() });
    missing.add('/home/jde/assistant');
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(only().lastRun).toMatchObject({ outcome: 'failed', reason: 'dossier introuvable : /home/jde/assistant', field: 'cwd' });
    expect(decisions().map(t => [t.title, t.routine])).toEqual([[
      'La routine briefing (Iris) n’a pas pu partir : dossier introuvable : /home/jde/assistant', { kind: 'failed', id: only().id, name: 'briefing', reason: 'dossier introuvable : /home/jde/assistant' }]]);
    // The next firing that leaves closes it.
    missing.clear();
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(decisions()).toEqual([]);
  });
  it('replaces a firing still waiting to be typed, and fails one not typed in 30 minutes', async () => {
    store.upsert(mk('iris', 'Iris', { state: 'working' }));
    await cmd(user, 'add', { spec: spec() });
    clock = at('2026-11-20T07:00:00.000Z'); routines.tick(); await flush();
    clock = at('2026-11-20T07:05:00.000Z');
    await cmd(user, 'run', { routine: 'briefing' }); await flush();
    expect(withdrawn).toEqual([typed[0]!.rid]);
    expect(typed).toHaveLength(2);
    clock = at('2026-11-20T07:36:00.000Z'); routines.tick();
    expect(withdrawn).toEqual([typed[0]!.rid, typed[1]!.rid]);
    expect(only().lastRun).toMatchObject({ outcome: 'failed', reason: 'pas remise dans les 30 minutes', cause: 'timeout' });
  });
});

describe('catch-up', () => {
  const missed = async (catchUp: 'once' | 'skip') => {
    store.upsert(mk('iris', 'Iris'));
    await cmd(user, 'add', { spec: spec({ catchUp }) });
    // The PC sleeps through 08:00 and 13:30 and wakes at 15:00.
    clock = at('2026-11-20T14:00:00.000Z'); routines.tick(); await flush();
  };
  it('once: fires the latest missed slot only, late', async () => {
    await missed('once');
    expect(typed).toHaveLength(1);
    expect(typed[0]!.text).toMatch(/^<ledge-routine name="briefing" slot="13:30" late="true">/);
    typedDone();
    expect(only().lastRun).toMatchObject({ slot: '13:30', late: true, outcome: 'delivered' });
    expect(only().nextRun).toBe('2026-11-20T15:30:00.000Z');
  });
  it('skip: fires none, and waits for the next slot', async () => {
    await missed('skip');
    expect(typed).toEqual([]);
    expect(only().nextRun).toBe('2026-11-20T15:30:00.000Z');
  });
  it('fires a slot missed while the daemon was down, and keeps routines and their last run', async () => {
    store.upsert(mk('iris', 'Iris'));
    await cmd(user, 'add', { spec: spec() });
    clock = at('2026-11-20T07:00:30.000Z'); routines.tick(); await flush(); typedDone();
    routines.close(); await journal.flush();
    await flush();
    clock = at('2026-11-20T13:00:00.000Z');
    routines = createRoutines(deps());
    expect(only().lastRun).toMatchObject({ slot: '08:00', outcome: 'delivered' });
    routines.tick(); await flush();
    expect(typed.at(-1)!.text).toMatch(/slot="13:30" late="true">Briefing de 13:30 \(précédent : 08:00\)/);
  });
});

describe('commands', () => {
  beforeEach(() => { store.upsert(mk('iris', 'Iris')); store.upsert(mk('otto', 'Otto', { cwd: '/w/ledge' })); });
  it('add, list, pause, resume, update, rm by the owner', async () => {
    const r = (await cmd(user, 'add', { spec: spec({ target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' } }) })).routine!;
    expect(r.target.cwd).toBe('/home/jde/assistant');
    expect((await cmd(user, 'pause', { routine: r.id })).routine).toMatchObject({ state: 'paused' });
    expect(only().nextRun).toBeUndefined();
    expect((await cmd(user, 'resume', { routine: 'briefing' })).routine).toMatchObject({ state: 'enabled', nextRun: '2026-11-20T07:00:00.000Z' });
    expect((await cmd(user, 'update', { routine: r.id, patch: { schedule: { kind: 'recurring', times: ['09:00'], days: ['mon'], tz: TZ } } })).routine).toMatchObject({ state: 'enabled', nextRun: '2026-11-23T08:00:00.000Z' });
    expect(await cmd(user, 'rm', { routine: r.id })).toMatchObject({ removed: r.id });
    expect(routines.all()).toEqual([]);
  });
  it('refuses a name taken for that session, an unknown zone, a folder that is not there', async () => {
    await cmd(user, 'add', { spec: spec() });
    expect(await cmd(user, 'add', { spec: spec() })).toMatchObject({ code: 'name_taken', field: 'name' });
    expect(await cmd(user, 'add', { spec: spec({ name: 'b', schedule: { ...spec().schedule, tz: 'Mars/Olympus' } }) })).toMatchObject({ code: 'invalid', reason: 'fuseau horaire inconnu : Mars/Olympus', field: 'tz' });
    missing.add('/nope');
    expect(await cmd(user, 'add', { spec: spec({ name: 'c', target: { name: 'Iris', cwd: '/nope', tool: 'claude' } }) })).toMatchObject({ code: 'invalid', field: 'cwd' });
    expect(await cmd(user, 'run', { routine: 'zzz' })).toMatchObject({ code: 'not_found' });
  });
  it('from a session: pending until « Activer », with the item the spec words', async () => {
    const r = (await cmd(as('iris'), 'add', { spec: spec({ target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' } }) })).routine!;
    expect(r).toMatchObject({ state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' } });
    expect(r.nextRun).toBeUndefined();
    expect(decisions().map(t => [t.title, t.text, t.routine])).toEqual([[
      'Iris veut programmer « briefing » : 08:00, 13:30, 16:30 (lun–ven), dans ~/assistant', r.prompt, { kind: 'approve', id: r.id, name: 'briefing' }]]);
    clock = at('2026-11-20T07:00:30.000Z'); routines.tick(); await flush();
    expect(typed).toEqual([]);
    expect(await cmd(as('iris'), 'approve', { routine: r.id })).toMatchObject({ code: 'forbidden' });
    expect(await cmd(as('iris'), 'run', { routine: r.id })).toMatchObject({ code: 'forbidden' });
    expect((await cmd(user, 'approve', { routine: r.id })).routine).toMatchObject({ state: 'enabled', nextRun: '2026-11-20T12:30:00.000Z' });
    expect(decisions()).toEqual([]);
    expect(typed.at(-1)).toMatchObject({ to: 'iris', text: expect.stringContaining('answer="approved">L\'utilisateur a activé ta routine « briefing »') });
    expect(await cmd(user, 'approve', { routine: r.id })).toMatchObject({ code: 'not_pending' });
  });
  it('« Refuser » removes a new routine, and the session is told', async () => {
    const r = (await cmd(as('iris'), 'add', { spec: spec() })).routine!;
    expect(await cmd(user, 'refuse', { routine: r.id })).toMatchObject({ removed: r.id });
    expect(routines.all()).toEqual([]);
    expect(decisions()).toEqual([]);
    expect(typed.at(-1)!.text).toContain('answer="refused"');
  });
  it('a session\'s edit of the times waits as a proposal while the routine keeps firing; « Refuser » drops it', async () => {
    const r = (await cmd(user, 'add', { spec: spec() })).routine!;
    const edited = (await cmd(as('iris'), 'update', { routine: 'briefing', patch: { schedule: { kind: 'recurring', times: ['03:00'], days: ['sun'], tz: TZ } } })).routine!;
    expect(edited).toMatchObject({ state: 'enabled', schedule: { times: ['08:00', '13:30', '16:30'] }, proposal: { spec: { schedule: { times: ['03:00'] } }, by: { id: 'iris', name: 'Iris' } } });
    expect(decisions().map(t => t.title)).toEqual(['Iris veut modifier « briefing » : 03:00 (dim), dans ~/assistant']);
    clock = at('2026-11-20T07:00:30.000Z'); routines.tick(); await flush();
    expect(typed).toHaveLength(1);
    const back = (await cmd(user, 'refuse', { routine: r.id })).routine!;
    expect(back.proposal).toBeUndefined();
    expect(back.schedule).toMatchObject({ times: ['08:00', '13:30', '16:30'] });
    expect(decisions()).toEqual([]);
    expect(typed.at(-1)!.text).toContain('a refusé ta modification');
  });
  it('« Activer » applies a proposal, or the owner\'s correction of it', async () => {
    const r = (await cmd(user, 'add', { spec: spec() })).routine!;
    await cmd(as('iris'), 'update', { routine: r.id, patch: { prompt: 'Nouveau briefing.' } });
    const corrected = spec({ prompt: 'Briefing corrigé par jde.' });
    const applied = (await cmd(user, 'approve', { routine: r.id, spec: corrected })).routine!;
    expect(applied).toMatchObject({ state: 'enabled', prompt: 'Briefing corrigé par jde.' });
    expect(applied.proposal).toBeUndefined();
    expect(decisions()).toEqual([]);
    const pending = (await cmd(as('iris'), 'add', { spec: spec({ name: 'cloture' }) })).routine!;
    expect((await cmd(user, 'approve', { routine: pending.id })).routine).toMatchObject({ state: 'enabled', name: 'cloture' });
  });
  it('groups the routines a session creates while its request waits into one item', async () => {
    const a = (await cmd(as('iris'), 'add', { spec: spec({ name: 'prepa-121', schedule: { kind: 'once', at: ['2026-12-03T16:00'], tz: TZ } }) })).routine!;
    const b = (await cmd(as('iris'), 'add', { spec: spec({ name: 'prepa-arch', schedule: { kind: 'once', at: ['2026-12-09T16:00'], tz: TZ } }) })).routine!;
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]!.text).toMatch(/^prepa-121 \(jeu\. 3 déc\. 16:00\)\nprepa-arch \(mer\. 9 déc\. 16:00\)\n/);
    expect(decisions()[0]).toMatchObject({ title: 'Iris veut programmer 2 routines uniques', routine: { kind: 'approve', id: a.id, ids: [a.id, b.id] } });
    await cmd(user, 'approve', { routine: a.id });
    expect(decisions()).toHaveLength(1);
    await cmd(user, 'refuse', { routine: b.id });
    expect(decisions()).toEqual([]);
  });
  it('a session\'s rename, pause, run and rm of its own routine ask nothing', async () => {
    const r = (await cmd(user, 'add', { spec: spec() })).routine!;
    expect((await cmd(as('iris'), 'update', { routine: r.id, patch: { name: 'matin', catchUp: 'skip' } })).routine).toMatchObject({ state: 'enabled', name: 'matin' });
    expect((await cmd(as('iris'), 'pause', { routine: r.id })).routine).toMatchObject({ state: 'paused' });
    expect((await cmd(as('iris'), 'run', { routine: r.id })).routine).toBeDefined();
    expect(decisions()).toEqual([]);
    expect(await cmd(as('otto'), 'rm', { routine: r.id })).toMatchObject({ code: 'forbidden' });
    expect(await cmd(as('iris'), 'rm', { routine: r.id })).toMatchObject({ removed: r.id });
  });
  it('a one-shot fires at its moment, then is done and leaves the active routines; a past moment is refused', async () => {
    expect(await cmd(user, 'add', { spec: spec({ name: 'old', schedule: { kind: 'once', at: ['2026-11-19T16:00'], tz: TZ } }) })).toMatchObject({ code: 'invalid', reason: 'moment déjà passé : 2026-11-19 16:00', field: 'at' });
    const r = (await cmd(user, 'add', { spec: spec({ name: 'prepa-121', schedule: { kind: 'once', at: ['2026-11-20T16:00', '2026-11-21T09:00'], tz: TZ } }) })).routine!;
    expect(r).toMatchObject({ expiresAfterRun: true, nextRuns: ['2026-11-20T15:00:00.000Z', '2026-11-21T08:00:00.000Z'] });
    clock = at('2026-11-20T15:00:20.000Z'); routines.tick(); await flush(); typedDone();
    expect(only()).toMatchObject({ state: 'enabled', nextRun: '2026-11-21T08:00:00.000Z' });
    clock = at('2026-11-21T08:00:20.000Z'); routines.tick(); await flush(); typedDone();
    expect(only()).toMatchObject({ state: 'done', runs: [{ slot: '09:00', outcome: 'delivered' }, { slot: '16:00', outcome: 'delivered' }] });
    expect(only().nextRun).toBeUndefined();
    expect(await cmd(user, 'run', { routine: r.id })).toMatchObject({ code: 'invalid' });
    // Thirty days later it leaves the list, kept on record.
    clock = at('2026-12-21T09:00:00.000Z'); routines.tick();
    expect(routines.all()).toEqual([]);
  });
  it('a failed one-shot stays until relaunched; a missed one fires on wake', async () => {
    await cmd(user, 'add', { spec: spec({ name: 'p', schedule: { kind: 'once', at: ['2026-11-20T16:00'], tz: TZ } }) });
    clock = at('2026-11-20T18:00:00.000Z');
    missing.add('/home/jde/assistant');
    routines.tick(); await flush();
    expect(only()).toMatchObject({ state: 'enabled', lastRun: { outcome: 'failed', late: true, slot: '16:00' } });
    missing.clear();
    await cmd(user, 'run', { routine: 'p' }); await flush(); typedDone();
    expect(only().state).toBe('done');
  });
  it('a one-shot asked after a partial answer joins the item still open', async () => {
    const once = (name: string, at: string) => spec({ name, schedule: { kind: 'once', at: [at], tz: TZ } });
    const a = (await cmd(as('iris'), 'add', { spec: once('a', '2026-12-03T16:00') })).routine!;
    const b = (await cmd(as('iris'), 'add', { spec: once('b', '2026-12-04T16:00') })).routine!;
    await cmd(user, 'approve', { routine: a.id });
    const c = (await cmd(as('iris'), 'add', { spec: once('c', '2026-12-05T16:00') })).routine!;
    expect(decisions()).toHaveLength(1);
    // Only the routines still waiting stay named: the item stays within the protocol's bound however many were answered.
    expect(decisions()[0]!.routine!.ids).toEqual([b.id, c.id]);
    expect(TaskSchema.safeParse(decisions()[0]).success).toBe(true);
    // The first refused (and gone), the next still joins; the item leaves it out.
    await cmd(user, 'refuse', { routine: b.id });
    const e = (await cmd(as('iris'), 'add', { spec: once('e', '2026-12-06T16:00') })).routine!;
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]).toMatchObject({ title: 'Iris veut programmer 2 routines uniques', routine: { ids: [c.id, e.id] } });
    await cmd(user, 'approve', { routine: c.id });
    expect(decisions()).toHaveLength(1);
    await cmd(user, 'refuse', { routine: e.id });
    expect(decisions()).toEqual([]);
  });
  it('a request stays within the protocol\'s 50 ids however many one-shots were answered and fired', async () => {
    const once = (i: number, at: string) => spec({ name: `p${i}`, schedule: { kind: 'once', at: [at], tz: TZ } });
    const made: Routine[] = [];
    for (let i = 0; i < 50; i++) made.push((await cmd(as('iris'), 'add', { spec: once(i, i < 30 ? '2026-11-20T08:00' : '2026-12-03T16:00') })).routine!);
    for (const r of made.slice(0, 30)) await cmd(user, 'approve', { routine: r.id });
    clock = at('2026-11-20T07:00:10.000Z'); routines.tick(); await flush(); await flush();
    for (let i = 0; i < typed.length; i++) if (queued.has(typed[i]!.rid)) typedDone(i);
    // Thirty fired; the list keeps the last 20 (ROUTINES_DONE_MAX), the others are on record.
    expect(routines.all().filter(r => r.state === 'done')).toHaveLength(20);
    expect(routines.all().filter(r => r.state === 'pending')).toHaveLength(20);
    for (let i = 50; i < 61; i++) await cmd(as('iris'), 'add', { spec: once(i, '2026-12-04T16:00') });
    const items = decisions();
    expect(items).toHaveLength(1);
    expect(items[0]!.routine!.ids).toHaveLength(31);
    expect(TaskSchema.safeParse(items[0]).success).toBe(true);
  });
  it('a recurring routine a session asks for is never grouped with its one-shots', async () => {
    await cmd(as('iris'), 'add', { spec: spec({ name: 'p1', schedule: { kind: 'once', at: ['2026-12-03T16:00'], tz: TZ } }) });
    await cmd(as('iris'), 'add', { spec: spec({ name: 'cloture' }) });
    expect(decisions().map(t => t.routine?.ids)).toEqual([undefined, undefined]);
  });
  it('a one-shot whose first moment failed stays, failed, though its second leaves; its relaunch closes it', async () => {
    store.upsert(mk('iris', 'Iris'));
    await cmd(user, 'add', { spec: spec({ name: 'p', schedule: { kind: 'once', at: ['2026-11-20T16:00', '2026-11-21T09:00'], tz: TZ } }) });
    missing.add('/home/jde/assistant');
    clock = at('2026-11-20T15:00:20.000Z'); routines.tick(); await flush();
    missing.clear();
    clock = at('2026-11-21T08:00:20.000Z'); routines.tick(); await flush(); typedDone();
    expect(only()).toMatchObject({ state: 'enabled', lastRun: { outcome: 'delivered' } });
    expect(decisions()).toHaveLength(1);
    await cmd(user, 'run', { routine: 'p' }); await flush(); typedDone();
    expect(only().state).toBe('done');
    expect(decisions()).toEqual([]);
  });
  it('a firing decided when the daemon stops is reported failed on restart, never lost', async () => {
    store.upsert(mk('iris', 'Iris'));
    await cmd(user, 'add', { spec: spec({ name: 'p', schedule: { kind: 'once', at: ['2026-11-20T16:00'], tz: TZ } }) });
    let release!: () => void;
    routines.close(); await journal.flush();
    routines = createRoutines(deps({ folder: () => new Promise(r => { release = () => r(undefined); }) }));
    clock = at('2026-11-20T15:00:20.000Z'); routines.tick();
    // The daemon stops while the folder is checked.
    routines.close(); await journal.flush(); void release;
    routines = createRoutines(deps());
    expect(only()).toMatchObject({ state: 'enabled', lastRun: { outcome: 'failed', reason: 'interrompue par un redémarrage de Ledge', slot: '16:00', cause: 'restart' } });
    expect(decisions().map(t => t.routine?.kind)).toEqual(['failed']);
  });
  it('keeps only the last 5 firings, newest first', async () => {
    await cmd(user, 'add', { spec: spec() });
    for (let i = 0; i < 7; i++) { clock += 60_000; await cmd(user, 'run', { routine: 'briefing' }); await flush(); typedDone(); }
    expect(only().runs).toHaveLength(5);
    expect(only().runs![0]!.at > only().runs![4]!.at).toBe(true);
    expect(only().lastRun).toEqual(only().runs![0]);
  });
  it('previews the next 3 firings of a schedule not saved', () => {
    expect(routines.preview('p', { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' }, tz: TZ }))
      .toEqual({ type: 'routine.previewed', rid: 'p', nextRuns: ['2026-11-26T15:00:00.000Z', '2026-12-10T15:00:00.000Z', '2026-12-24T15:00:00.000Z'] });
    expect(routines.preview('p', { kind: 'recurring', times: ['16:00'], days: ['thu'], tz: 'Mars/Olympus' })).toMatchObject({ nextRuns: [], reason: 'fuseau horaire inconnu : Mars/Olympus', field: 'tz' });
  });
  it('takes a one-shot\'s new zone, its moments kept (the CLI\'s edit --tz)', async () => {
    const r = (await cmd(user, 'add', { spec: spec({ name: 'prep', schedule: { kind: 'once', at: ['2026-12-03T16:00'], tz: TZ } }) })).routine!;
    const moved = (await cmd(user, 'update', { routine: r.id, patch: { schedule: { kind: 'once', at: ['2026-12-03T16:00'], tz: 'America/New_York' } } })).routine!;
    expect(moved).toMatchObject({ schedule: { kind: 'once', at: ['2026-12-03T16:00'], tz: 'America/New_York' }, nextRun: '2026-12-03T21:00:00.000Z' });
  });
  it('« Activer » checks the key it was shown as it applies: one changed meanwhile is stale', async () => {
    let release: (() => void) | undefined;
    routines.close();
    // The first folder check after the request waits; the others answer at once.
    let blockNext = false;
    routines = createRoutines(deps({ folder: () => blockNext ? (blockNext = false, new Promise(res => { release = () => res(undefined); })) : Promise.resolve(undefined) }));
    const r = (await cmd(as('iris'), 'add', { spec: spec() })).routine!;
    expect(await cmd(user, 'approve', { routine: r.id, expect: 'autre' })).toMatchObject({ code: 'stale' });
    blockNext = true;
    const approving = cmd(user, 'approve', { routine: r.id, expect: routineKey(r) });
    await flush();
    await cmd(as('iris'), 'update', { routine: r.id, patch: { prompt: 'Supprime tout.' } });
    release!();
    expect(await approving).toMatchObject({ code: 'stale' });
    expect(only()).toMatchObject({ state: 'pending', prompt: 'Supprime tout.' });
  });
  it('a change whose folder check outlasts an approval is stale, and the approval stands', async () => {
    let release: (() => void) | undefined;
    routines.close();
    let blockNext = false;
    routines = createRoutines(deps({ folder: () => blockNext ? (blockNext = false, new Promise(res => { release = () => res(undefined); })) : Promise.resolve(undefined) }));
    const r = (await cmd(as('iris'), 'add', { spec: spec() })).routine!;
    blockNext = true;
    const changing = cmd(as('iris'), 'update', { routine: r.id, patch: { prompt: 'Supprime tout.' } });
    await flush();
    expect((await cmd(user, 'approve', { routine: r.id, expect: routineKey(r) })).routine).toMatchObject({ state: 'enabled' });
    release!();
    expect(await changing).toMatchObject({ code: 'stale' });
    expect(only()).toMatchObject({ state: 'enabled', prompt: r.prompt });
  });
  it('« Activer » with the key it was shown applies; another session\'s change after the showing makes it stale', async () => {
    const r = (await cmd(as('iris'), 'add', { spec: spec() })).routine!;
    const shown = routineKey(r);
    await cmd(as('iris'), 'update', { routine: r.id, patch: { prompt: 'Autre chose.' } });
    expect(await cmd(user, 'approve', { routine: r.id, expect: shown })).toMatchObject({ code: 'stale' });
    expect((await cmd(user, 'approve', { routine: r.id, expect: routineKey(only()) })).routine).toMatchObject({ state: 'enabled', prompt: 'Autre chose.' });
  });
  it('names the routines a session counts as its own: made by it, or waking it', async () => {
    const mine = (await cmd(user, 'add', { spec: spec() })).routine!;
    const made = (await cmd(as('otto'), 'add', { spec: spec({ name: 'autre', target: { name: 'Nova', cwd: '/home/jde/assistant', tool: 'claude' } }) })).routine!;
    expect(routines.ownedBy('iris')).toEqual([mine.id]);
    expect(routines.ownedBy('otto')).toEqual([made.id]);
    expect(routines.ownedBy('nobody')).toEqual([]);
  });
  it('writes routines.json for the one shared reader', async () => {
    await cmd(user, 'add', { spec: spec() });
    routines.close(); await journal.flush(); await flush();
    const read: Routine[] = loadRoutines(join(dir, 'routines.json'));
    expect(read.map(r => r.name)).toEqual(['briefing']);
  });
});
