import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatPoint, PointItem, Routine, RoutineRun, Session, Task } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import { createChat, type ChatDeps } from '../../src/chat/service.js';
import { fromRoutines, fromTasks } from '../../src/operator/detect.js';
import type { JournalEvent } from '../../src/operator/journal.js';
import { buildPoint, type LiveState } from '../../src/operator/point.js';
import { createPointActor, type Fail, type PointActDeps } from '../../src/operator/act.js';

vi.mock('../../src/log.js', () => ({ log: () => {} }));

/** Monday 23 November 2026, local time: the mockup's morning (briefing of 08:00 sent late at 08:42, the 13:30 one under way). */
const at = (h: number, m: number): string => new Date(2026, 10, 23, h, m).toISOString();
const hhmm = (iso: string): string => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const run = (slot: string, when: string, over: Partial<RoutineRun> = {}): RoutineRun => ({ at: when, slot, outcome: 'delivered', ...over });
const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1a2b3c', name: 'briefing', target: { name: 'Iris', cwd: '/home/u/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  prompt: 'Briefing de {slot}', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: at(7, 0), ...over
});
const session = (over: Partial<Session> = {}): Session => ({
  id: 'iris1', name: 'Iris', tool: 'claude', cwd: '/home/u/assistant', project: 'assistant', title: 't', tmuxSession: 'l-iris1', state: 'working', helpers: [],
  startedAt: at(7, 0), lastActivityAt: at(13, 33), source: 'launcher', ...over
});
let n = 0;
const fired = (d: ReturnType<typeof fromRoutines>[number]): JournalEvent => ({ ...d, id: ++n, at: String(d.payload.firedAt), machine: 'm', settledAt: null });
const live = (over: Partial<LiveState> = {}): LiveState => ({ sessions: [session()], asks: [], tasks: [], lang: 'fr', now: Date.parse(at(13, 34)), ...over });
const lead = { text: '', by: 'daemon' as const };

describe('fromRoutines', () => {
  it('a new firing that reached its session is one event; the same last run, a failure or no run is none', () => {
    const before = [routine({ lastRun: run('08:00', at(8, 42), { late: true, outcome: 'resumed' }) })];
    expect(fromRoutines(before, before)).toEqual([]);
    expect(fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30), { outcome: 'failed', reason: 'x' }) })])).toEqual([]);
    expect(fromRoutines([], [routine()])).toEqual([]);
    const [e, ...rest] = fromRoutines(before, [routine({ lastRun: run('13:30', at(13, 30)) })]);
    expect(rest).toEqual([]);
    expect(e).toEqual({ kind: 'routine.fired', subjectKind: 'routine.run', subjectId: `r1a2b3c@${at(13, 30)}`, subjectName: 'briefing', urgency: 'grouped',
      payload: { routine: 'r1a2b3c', name: 'briefing', target: 'Iris', cwd: '/home/u/assistant', slot: '13:30', firedAt: at(13, 30), outcome: 'delivered' } });
  });
});

describe('« Le point »: a routine’s line (mockup card 16)', () => {
  const late = fired(fromRoutines([routine()], [routine({ lastRun: run('08:00', at(8, 42), { late: true, outcome: 'resumed' }) })])[0]!);
  const now = fired(fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30)) })])[0]!);

  it('in progress while the session works on the latest firing, « routine · depuis n min »; the earlier one is done, late, at the time it ended', () => {
    const p = buildPoint([late, now], live({ routines: [routine({ lastRun: run('13:30', at(13, 30)) })] }), at(8, 0), lead);
    const ongoing = p.items.find(i => i.group === 'ongoing')!;
    expect(ongoing).toMatchObject({ who: 'Iris', text: 'briefing de 13:30', sub: 'routine · depuis 4 min', tone: 'work', nav: [{ kind: 'session', id: 'iris1' }] });
    const done = p.items.find(i => i.group === 'done')!;
    expect(done).toMatchObject({ who: 'Iris', text: `briefing de 08:00, lancé à ${hhmm(at(8, 42))} au réveil`, sub: 'routine', tone: 'idle' });
    // No « À toi » badge for a normal firing.
    expect(p.items.some(i => i.group === 'atoi')).toBe(false);
  });

  it('done at the end of the turn it started (its « a terminé » folded in); without a known end, at its firing; English words', () => {
    const ended: JournalEvent = { id: ++n, at: at(13, 51), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null };
    const p = buildPoint([now, ended], live({ lang: 'en', sessions: [session({ state: 'idle', lastActivityAt: at(13, 51) })] }), at(8, 0), lead);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ group: 'done', text: '13:30 briefing', sub: 'routine', at: at(13, 51) });
    // Later activity is not the routine's: with no end in the journal, the row keeps its firing's time.
    expect(buildPoint([now], live({ sessions: [session({ state: 'idle', lastActivityAt: at(15, 0) })] }), at(8, 0), lead).items[0]!.at).toBe(at(13, 30));
    const pl = buildPoint([late], live({ lang: 'en', sessions: [session({ state: 'idle' })] }), at(8, 0), lead);
    expect(pl.items[0]!.text).toBe(`08:00 briefing, sent at ${hhmm(at(8, 42))} on wake`);
  });

  it('follows the session through its relief, and keeps the target’s name when no session holds it', () => {
    const relief = session({ id: 'iris2', name: 'Iris-2', relieves: { id: 'iris1', name: 'Iris', at: at(12, 0) } });
    const p = buildPoint([now], live({ sessions: [relief] }), at(8, 0), lead);
    expect(p.items[0]).toMatchObject({ group: 'ongoing', who: 'Iris-2', nav: [{ kind: 'session', id: 'iris2' }] });
    const gone = buildPoint([now], live({ sessions: [] }), at(8, 0), lead);
    expect(gone.items[0]).toMatchObject({ group: 'done', who: 'Iris' });
    expect(gone.items[0]!.nav).toBeUndefined();
  });

  const failure = (over: Partial<Task> = {}): Task => ({
    id: 'tf1', title: 'La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge',
    state: 'open', at: at(18, 0), updatedAt: at(18, 0), log: [], routine: { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, ...over
  });
  const veille = routine({ id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '/home/u/veille', tool: 'claude' } });
  const asked = (t: Task): JournalEvent => ({ ...fromTasks([], [t], Date.now(), () => undefined, new Set())[0]!, id: ++n, at: t.at, machine: 'm', settledAt: null });

  it('a failure is in « À toi »: « Nova : la routine veille n’a pas pu partir », its reason below, Relancer, no words to answer it', () => {
    const t = failure();
    const nova = session({ id: 'nova1', name: 'Nova', cwd: '/home/u/veille', state: 'idle' });
    const p = buildPoint([asked(t)], live({ tasks: [t], routines: [veille], sessions: [nova] }), at(8, 0), lead);
    expect(p.items[0]).toMatchObject({ group: 'atoi', tone: 'perm', who: 'Nova', text: ': la routine veille n’a pas pu partir', sub: 'dossier introuvable : ~/veille',
      answers: [{ id: 'retry', label: 'Relancer', style: 'primary' }], nav: [{ kind: 'routine', id: 'r81c0d4' }], ref: { kind: 'task', task: 'tf1' } });
    expect(p.items[0]!.freeText).toBeUndefined();
    const en = buildPoint([asked(t)], live({ lang: 'en', tasks: [t], routines: [veille], sessions: [] }), at(8, 0), lead);
    expect(en.items[0]).toMatchObject({ who: 'Nova', text: ': routine veille could not run', answers: [{ label: 'Run again' }] });
  });

  it('a failure that left (relaunched, or the next firing went) is settled, without its button', () => {
    const t = failure({ state: 'done', result: 'la routine est repartie' });
    const p = buildPoint([asked(failure())], live({ tasks: [t], routines: [veille] }), at(8, 0), lead);
    expect(p.items[0]!.settled).toBeDefined();
    expect(p.items[0]!.answers).toBeUndefined();
  });

  it('an activation request: who asks, the request in the owner’s words, « Voir » alone (the routine’s page), no words to answer it', () => {
    const t = failure({ id: 'ta1', title: 'daemon words', routine: { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' } });
    const hebdo = routine({ id: 'r3f9a12', name: 'point-hebdo', schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending', createdBy: { kind: 'session', id: 'iris1', name: 'Iris' } });
    const p = buildPoint([asked(t)], live({ tasks: [t], routines: [hebdo] }), at(8, 0), lead);
    expect(p.items[0]).toMatchObject({ group: 'atoi', tone: 'ask', who: 'Iris', text: 'veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant', nav: [{ kind: 'routine', id: 'r3f9a12' }] });
    expect(p.items[0]!.freeText).toBeUndefined();
    expect(p.items[0]!.answers).toBeUndefined();
    expect(p.items[0]!.sub).toBeUndefined();
    // The owner's words for a two-week routine and for one-shots, in English too.
    const sprint = { ...hebdo, name: 'bilan-sprint', schedule: { kind: 'recurring' as const, times: ['16:00'], days: ['thu' as const], every: { weeks: 2 as const, anchor: '2026-11-27' } } };
    expect(buildPoint([asked(t)], live({ lang: 'en', tasks: [t], routines: [sprint] }), at(8, 0), lead).items[0]!.text).toBe('wants to schedule “bilan-sprint”: 16:00 (Thu, every 2 wks), in ~/assistant');
    const once = (id: string, day: string) => ({ ...hebdo, id, schedule: { kind: 'once' as const, at: [`2026-12-0${day}`] } });
    const group = failure({ id: 'ta2', title: 'daemon words', routine: { kind: 'approve', id: 'r000003', name: 'a', ids: ['r000003', 'r000007', 'r000008'] } });
    const rs = [once('r000003', '3T16:00'), once('r000007', '7T15:00'), once('r000008', '8T09:30')];
    expect(buildPoint([asked(group)], live({ tasks: [group], routines: rs }), at(8, 0), lead).items[0]).toMatchObject({ who: 'Iris', text: 'veut programmer 3 routines uniques : 3, 7 et 8 déc.' });
    // Not read yet: its name in the point's language, never the daemon's French title.
    expect(buildPoint([asked(t)], live({ tasks: [t] }), at(8, 0), lead).items[0]).toMatchObject({ who: '', text: '« point-hebdo » attend ton accord' });
    expect(buildPoint([asked(t)], live({ lang: 'en', tasks: [t] }), at(8, 0), lead).items[0]).toMatchObject({ who: '', text: '“point-hebdo” awaits your approval' });
  });

  it('a session’s change to its routine reads « veut modifier » with the asked settings (card 29), in English too', () => {
    const t = failure({ id: 'ta3', title: 'Iris veut modifier « briefing » : …', routine: { kind: 'approve', id: 'r1a2b3c', name: 'briefing' } });
    const asked2 = routine({ proposal: { spec: { name: 'briefing', target: { name: 'Iris', cwd: '/home/u/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, prompt: 'p' }, by: { id: 'iris1', name: 'Iris' }, at: at(2, 0) } });
    expect(buildPoint([asked(t)], live({ tasks: [t], routines: [asked2] }), at(8, 0), lead).items[0]).toMatchObject({ who: 'Iris', text: 'veut modifier « briefing » : 07:30, 13:30, 16:30 (lun-ven)', nav: [{ kind: 'routine', id: 'r1a2b3c' }] });
    expect(buildPoint([asked(t)], live({ lang: 'en', tasks: [t], routines: [asked2] }), at(8, 0), lead).items[0]).toMatchObject({ who: 'Iris', text: 'wants to change “briefing”: 07:30, 13:30, 16:30 (Mon-Fri)' });
  });

  it('a session’s end after a firing is one line: the routine’s, at the end’s time; an end with no firing keeps its row', () => {
    const end = (when: string): JournalEvent => ({ id: ++n, at: when, machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null });
    const idle = live({ sessions: [session({ state: 'idle', lastActivityAt: at(13, 52) })] });
    const p = buildPoint([now, end(at(13, 52))], idle, at(8, 0), lead);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ group: 'done', who: 'Iris', text: 'briefing de 13:30', sub: 'routine', at: at(13, 52) });
    const before = buildPoint([end(at(12, 0)), now], idle, at(8, 0), lead);
    expect(before.items.map(i => i.id).sort()).toEqual(['routine.run:r1a2b3c@' + at(13, 30), 'session:iris1']);
  });

  it('keeps a later unrelated session finish separate from a previous completed routine', () => {
    const firstEnd: JournalEvent = { id: ++n, at: at(13, 52), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null };
    const secondEnd: JournalEvent = { ...firstEnd, id: ++n, at: at(15, 0), payload: { text: 'Unrelated manual work' } };
    const idle = live({ sessions: [session({ state: 'idle', lastActivityAt: at(15, 0) })], routines: [routine({ lastRun: run('13:30', at(13, 30)) })] });
    const p = buildPoint([now, firstEnd, secondEnd], idle, at(8, 0), lead);
    expect(p.items.map(i => i.id)).toContain('session:iris1');
    expect(p.items.find(i => i.id.startsWith('routine.run:'))?.at).toBe(at(13, 52));
  });

  it('does not say an earlier routine is ongoing when the session starts unrelated work', () => {
    const end: JournalEvent = { id: ++n, at: at(13, 52), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null };
    const working = live({ sessions: [session({ state: 'working', lastActivityAt: at(15, 0) })], routines: [routine({ lastRun: run('13:30', at(13, 30)) })] });
    const p = buildPoint([now, end], working, at(8, 0), lead);
    expect(p.items.find(i => i.id.startsWith('routine.run:'))?.group).toBe('done');
  });

  it('keeps the previous session end when the firing waited for that turn to finish', () => {
    const previousEnd: JournalEvent = { id: 200, at: at(13, 50), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: { text: 'Previous work' }, settledAt: null };
    const delivered: JournalEvent = { ...now, id: 201, at: at(13, 51) };
    const working = live({ sessions: [session({ state: 'working', lastActivityAt: at(13, 52) })], routines: [routine({ lastRun: run('13:30', at(13, 30)) })] });
    const p = buildPoint([previousEnd, delivered], working, at(8, 0), lead);
    expect({ group: p.items.find(i => i.id.startsWith('routine.run:'))?.group, previousEndVisible: p.items.some(i => i.id === 'session:iris1') }).toEqual({ group: 'ongoing', previousEndVisible: true });
  });
});

describe('a routine’s firing keeps the session it reached (review of 8b9e5ed0)', () => {
  it('uses the recorded recipient finish even when that session has been removed (review of ef977eb3)', () => {
    const r = routine({ lastRun: { ...run('13:30', at(13, 30)), session: 'iris1' } });
    const draft = fromRoutines([routine()], [r], [session()])[0]!;
    const sent = fired(draft);
    const end: JournalEvent = { id: ++n, at: at(13, 52), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null };
    const p = buildPoint([sent, end], live({ sessions: [], routines: [r] }), at(8, 0), lead);
    expect(p.items.map(x => ({ id: x.id, at: x.at }))).toEqual([{ id: sent.subjectKind + ':' + sent.subjectId, at: at(13, 52) }]);
  });
  it('records the recipient as the scheduler finds it: the exact name before an older relief, never an archived session (review of 069e5d5a)', () => {
    const relief = session({ id: 'relief', name: 'Iris-2', relieves: { id: 'old', name: 'Iris', at: at(12, 0) } });
    const actual = session({ id: 'new-iris', name: 'Iris' });
    expect(fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30)) })], [relief, actual])[0]!.payload.session).toBe('new-iris');
    const archived = session({ id: 'archived', archivedAt: at(12, 0) });
    const active = session({ id: 'active' });
    expect(fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30)) })], [archived, active])[0]!.payload.session).toBe('active');
  });
  it('records the live recipient’s id, and a later session of the same name and folder does not take the firing over', () => {
    const iris1 = session({ id: 'iris1' });
    const [d] = fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30)) })], [iris1]);
    expect(d!.payload.session).toBe('iris1');
    const end: JournalEvent = { id: ++n, at: at(13, 52), machine: 'm', kind: 'session.finished', subjectKind: 'session', subjectId: 'iris1', subjectName: 'Iris', urgency: 'grouped', payload: {}, settledAt: null };
    const iris2 = session({ id: 'iris2', state: 'working', startedAt: at(14, 50), lastActivityAt: at(15, 0) });
    const p = buildPoint([fired(d!), end], live({ sessions: [iris2], routines: [routine({ lastRun: run('13:30', at(13, 30)) })], now: Date.parse(at(15, 1)) }), at(8, 0), lead);
    const row = p.items.find(i => i.id.startsWith('routine.run:'));
    expect(row?.group).toBe('done');
    expect(row?.nav?.some(n => n.kind === 'session' && n.id === 'iris2')).not.toBe(true);
    // The session that ended keeps its own end: the routine row took it, no « a terminé » row for iris2.
    expect(p.items.some(i => i.group === 'ongoing')).toBe(false);
  });
  it('an event recorded before the id was kept is not given to a session started after its delivery', () => {
    const [d] = fromRoutines([routine()], [routine({ lastRun: run('13:30', at(13, 30)) })]);
    const iris2 = session({ id: 'iris2', state: 'working', startedAt: at(14, 50), lastActivityAt: at(15, 0) });
    const p = buildPoint([fired(d!)], live({ sessions: [iris2], routines: [routine({ lastRun: run('13:30', at(13, 30)) })], now: Date.parse(at(15, 1)) }), at(8, 0), lead);
    expect(p.items.find(i => i.id.startsWith('routine.run:'))?.group).toBe('done');
  });
});

describe('point.act on a routine’s failure', () => {
  const AT = '2026-11-23T17:00:00.000Z';
  const item: PointItem = { id: 'task:tf1', event: 1, group: 'atoi', tone: 'perm', who: 'Nova', text: ': la routine veille n’a pas pu partir', at: AT,
    ref: { kind: 'task', task: 'tf1' }, answers: [{ id: 'retry', label: 'Relancer', style: 'primary' }] };
  function setup(over: Partial<PointActDeps> = {}) {
    const home = mkdtempSync(join(tmpdir(), 'ledge-proutine-'));
    const store = new Store({ journalPath: join(home, 'j.json') });
    const chat = createChat({ store, tmux: { async capture() { return null; } } as never, home, env: async () => ({ ...process.env }) } as ChatDeps);
    const point: ChatPoint = { since: AT, lead: 'lead', leadBy: 'daemon', items: [item] };
    const qid = chat.postPoint(point, [], () => {});
    const calls: string[] = []; const settled: unknown[][] = [];
    const ok = async (): Promise<Fail> => undefined;
    const actor = createPointActor({
      chatOf: () => ({ chat, emit: () => {} }), session: () => undefined, asks: () => [],
      decide: ok, reply: ok, answerAsk: async () => ({ ok: true }),
      answerTask: async (t, a) => { calls.push(`task ${t} ${a}`); return undefined; },
      applySuggestion: ok, answerBrain: () => undefined, isBrain: () => false,
      operator: { settle: (...a) => { settled.push(a); } }, ...over
    });
    return { actor, qid, calls, settled };
  }

  it('Relancer fires the routine again (`routine.cmd` run), never answers the task, and settles the row', async () => {
    const runs: string[] = [];
    const a = setup({ routine: { of: id => (id === 'tf1' ? { kind: 'failed', id: 'r81c0d4', name: 'veille' } : undefined), run: async id => { runs.push(id); return undefined; } } });
    expect(await a.actor.act('desktop', { qid: a.qid, item: item.id, answer: { id: 'retry' } })).toEqual({ ok: true });
    expect(runs).toEqual(['r81c0d4']);
    expect(a.calls).toEqual([]);
    expect(a.settled).toEqual([['task', 'tf1', 'chat', 'Relancer']]);
  });

  it('a refused run shows on the row; words, or a daemon without routines, send nothing', async () => {
    const a = setup({ routine: { of: () => ({ kind: 'failed', id: 'r81c0d4', name: 'veille' }), run: async () => ({ message: 'not_found' }) } });
    expect(await a.actor.act('desktop', { qid: a.qid, item: item.id, answer: { id: 'retry' } })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await a.actor.act('desktop', { qid: a.qid, item: item.id, answer: { text: 'vas-y' } })).toMatchObject({ ok: false, code: 'invalid' });
    const b = setup();
    expect(await b.actor.act('desktop', { qid: b.qid, item: item.id, answer: { id: 'retry' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect([...a.calls, ...b.calls]).toEqual([]);
  });
});
