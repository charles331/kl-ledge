import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { OperatorNotice, Task } from '@ledge/protocol';
import type { FleetRoutine, RoutineAsk } from '@ledge/fleet/routines';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { MESSAGES } from '../src/i18n/messages';
import { routineNotice, routineWhen } from '../src/routines';
import { Surface } from '../src/surface/Surface';
import { subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';

const T = '2026-11-23T01:10:00.000Z';
const base = { catchUp: 'once' as const, createdAt: T, createdBy: { kind: 'session' as const, id: 'iris', name: 'Iris' }, prompt: 'Point de la semaine du {date}.' };
const iris = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
/** The mockup's examples (docs/mockups/ledge-routines.html, cards 15 and 23), on the local machine. */
const pointHebdo: FleetRoutine = { ...base, machineId: 'local', key: 'k-point', id: 'r3f9a12', name: 'point-hebdo', target: iris, schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending' };
const veille: FleetRoutine = { ...base, machineId: 'local', id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, createdBy: { kind: 'user' },
  schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, state: 'enabled', lastRun: { at: T, slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille', field: 'cwd' } };
const once = (id: string, name: string, at: string): FleetRoutine => ({ ...base, machineId: 'local', key: `k-${id}`, id, name, target: iris, schedule: { kind: 'once', at: [at] }, state: 'pending' });
const group = [once('r000001', 'prepa-121', '2026-12-03T16:00'), once('r000002', 'prepa-comite-archi', '2026-12-07T15:00'), once('r000003', 'prepa-demo-compart', '2026-12-08T09:30')];
const task = (id: string, routine: Task['routine'], extra: Partial<Task> = {}): Task => ({
  id, title: 'Iris veut programmer « point-hebdo »', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T, updatedAt: T, log: [], routine, ...extra
});
const decision = (taskId: string): OperatorNotice => ({ id: `decision:${taskId}`, kind: 'decision', text: 'Iris veut programmer « point-hebdo »', who: 'Iris', priority: 'routine', at: T });

describe('the island’s words for a routine (cards 15 and 23)', () => {
  const fr = MESSAGES.fr, en = MESSAGES.en;
  it('a schedule: its times, then its days in brackets; every other week said; a one-shot by its day and month', () => {
    expect(routineWhen(pointHebdo.schedule, fr).ask).toBe('17:00 (ven)');
    expect(routineWhen(pointHebdo.schedule, en).ask).toBe('17:00 (Fri)');
    expect(routineWhen({ kind: 'recurring', times: ['16:30', '08:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, fr).ask).toBe('08:00, 16:30 (lun–ven)');
    expect(routineWhen(veille.schedule, fr).ask).toBe('18:00 (tous les jours)');
    expect(routineWhen({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, fr).ask).toBe('16:00 (jeu, 1 sem. sur 2)');
    expect(routineWhen(group[0]!.schedule, fr).moments).toEqual(['3 déc. 16:00']);
    expect(routineWhen(group[0]!.schedule, en).moments).toEqual(['3 Dec 16:00']);
    // A single one-off's and every other week's request words, approved by the owner (2026-11-23).
    expect(routineWhen(group[0]!.schedule, fr).ask).toBe('jeu. 3 déc. 16:00');
    expect(routineWhen(group[0]!.schedule, en).ask).toBe('Thu 3 Dec 16:00');
    expect(routineWhen({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, en).ask).toBe('16:00 (Thu, every 2 wks)');
  });

  it('a request, a group and a failure, as the mockup says them; a plain decision is none', () => {
    // The French words hold non-breaking spaces before « : » and inside « » (the island's catalogue): read here as plain spaces.
    const n = (t: Task, list: FleetRoutine[] = [pointHebdo, veille, ...group]) => {
      const r = routineNotice(decision(t.id), 'local', t, list, fr);
      return r && { ...r, text: r.text.replace(/\u00a0/g, ' ') };
    };
    expect(n(task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }))).toMatchObject({ kind: 'approve', who: 'Iris', ids: ['r3f9a12'], text: 'Iris veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant' });
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }))).toMatchObject({
      ids: ['r000001', 'r000002', 'r000003'], text: 'Iris veut programmer 3 routines uniques : prepa-121 (3 déc. 16:00), prepa-comite-archi (7 déc. 15:00), prepa-demo-compart (8 déc. 09:30)'
    });
    expect(n(task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { giverName: 'Ledge' }))).toMatchObject({ kind: 'failed', who: 'Nova', ids: ['r81c0d4'], text: 'La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille' });
    expect(n(task('t5', { kind: 'approve', id: 'r000009', name: 'point-121' }), [{ ...group[0]!, id: 'r000009', name: 'point-121', schedule: { kind: 'once', at: ['2026-12-03T16:00', '2026-12-10T16:00', '2026-12-17T16:00', '2026-12-24T16:00', '2026-12-31T16:00'] } }])?.text)
      .toBe('Iris veut programmer « point-121 » : jeu. 3 déc. 16:00, jeu. 10 déc. 16:00, jeu. 17 déc. 16:00 et 2 autres, dans ~/assistant');
    // A routine answered elsewhere leaves the count; one not listed yet keeps the task's title.
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }), [{ ...group[0]!, state: 'enabled' }, group[1]!, group[2]!])?.ids).toEqual(['r000002', 'r000003']);
    // Not read yet: card 30's words, never the task's French title; nothing to activate without the routine's key.
    expect(n(task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }), [])).toMatchObject({ text: '« point-hebdo » attend ton accord', keys: { r3f9a12: undefined } });
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002'] }), [])?.text).toBe('« prepa-121 » attend ton accord');
    expect(n(task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'pas remise dans les 30 minutes' }), [])?.text).toBe('La routine veille n’a pas pu partir : pas remise dans les 30 minutes');
    // A run not typed in time says card 8's words (`cause`), the daemon's French reason only without one.
    const late = { ...veille, lastRun: { at: T, slot: '18:00', outcome: 'failed' as const, reason: 'pas remise dans les 30 minutes', cause: 'timeout' as const } };
    expect(routineNotice(decision('t3'), 'local', task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'pas remise dans les 30 minutes' }), [late], en)?.text)
      .toBe('The routine veille (Nova) could not run: not typed within 30 min (session busy)');
    // Each routine's key, as listed: what an approval sends back as `expect`.
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }))?.keys).toEqual({ r000001: 'k-r000001', r000002: 'k-r000002', r000003: 'k-r000003' });
    // A session's change (card 29): « veut modifier », with the settings it asks for.
    const asked = { name: 'point-hebdo', target: iris, schedule: { kind: 'recurring' as const, times: ['16:00'], days: ['fri' as const] }, prompt: 'p' };
    expect(n(task('t6', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }), [{ ...pointHebdo, state: 'enabled', proposal: { spec: asked, by: { id: 'iris', name: 'Iris' }, at: T } }])?.text)
      .toBe('Iris veut modifier « point-hebdo » : 16:00 (ven)');
    expect(n(task('t4', { kind: 'approve', id: 'r000001', name: 'prepa-121' }))?.text).toBe('Iris veut programmer « prepa-121 » : jeu. 3 déc. 16:00, dans ~/assistant');
    expect(routineNotice(decision('t9'), 'local', task('t9', undefined), [pointHebdo], fr)).toBeNull();
  });
});

/** A one-machine fleet whose notices, tasks and routines the test sets; every routine command is recorded. */
function fleetClient(tasks: Task[], routines: FleetRoutine[]) {
  const cmds: Array<{ machine: string; ask: RoutineAsk }> = [];
  let notices: ReadonlyMap<string, OperatorNotice[]> = new Map();
  const listeners = new Set<() => void>();
  const machines = [{ id: 'local', label: 'Local', status: 'open', ready: true }];
  let fail: { code: string; message: string } | null = null;
  const fleet = {
    selected: () => 'local', select() {}, terminal: () => null, turnMachine: () => machines[0], configure() {}, probe: async () => ({}), retry() {},
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    machines: () => machines, operator: () => notices, tasks: () => tasks, routines: () => routines, onRoutines: () => () => {},
    sendTo: () => true,
    routineCmd: async (machine: string, ask: RoutineAsk) => {
      cmds.push({ machine, ask });
      if (fail) throw fail;
      return { type: 'routine.result', rid: 'x' };
    }
  };
  const client = { connect() {}, close() {}, send: () => {}, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {}, fleet } as unknown as DaemonClient;
  const set = (next: Record<string, OperatorNotice[]>) => act(() => { notices = new Map(Object.entries(next)); listeners.forEach(fn => fn()); });
  return { client, cmds, set, failWith: (message: string, code = 'not_pending') => { fail = { code, message }; } };
}

const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const bubble = () => document.querySelector('[data-layer="bubble"]') as HTMLElement;
let opened: LedgeTarget[];
let off: () => void;
beforeEach(() => {
  vi.useFakeTimers(); daemonStore.reset(); opened = [];
  off = subscribeOpenInLedge((target, outcome) => { if (outcome === 'opening') opened.push(target); });
});
afterEach(() => { off(); vi.useRealTimers(); });
const mount = (f: ReturnType<typeof fleetClient>) => {
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [] }); });
  render(<Surface screenH={1080} theme="dark" client={f.client} dnd={false} onToggleDnd={() => {}} />);
};

describe('the island’s routine items (card 15)', () => {
  it('an activation request: who and « routine », its words, then Activate and Refuse on its machine; no prompt unfolded', async () => {
    const f = fleetClient([task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })], [pointHebdo]);
    mount(f);
    f.set({ local: [decision('t1')] });
    tick(540);
    expect(bubble()).toHaveAttribute('data-routine', 'approve');
    expect(bubble()).toHaveTextContent('Iris · routine ·');
    expect(bubble()).toHaveTextContent('Iris wants to schedule “point-hebdo”: 17:00 (Fri), in ~/assistant');
    expect(bubble()).not.toHaveTextContent('Point de la semaine');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate' })); });
    // Bound to the routine the bubble showed: its key, as listed, comes back as `expect`.
    expect(f.cmds).toEqual([{ machine: 'local', ask: { op: 'approve', routine: 'r3f9a12', expect: 'k-point' } }]);
  });

  it('several one-shots: « Activate all 3 » answers each in turn; a refusal says why', async () => {
    const f = fleetClient([task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] })], group);
    mount(f);
    f.set({ local: [decision('t2')] });
    tick(540);
    expect(bubble()).toHaveTextContent('Iris wants to schedule 3 one-shot routines: prepa-121 (3 Dec 16:00), prepa-comite-archi (7 Dec 15:00), prepa-demo-compart (8 Dec 09:30)');
    f.failWith('nothing pending');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refuse' })); });
    expect(f.cmds.map(c => c.ask)).toEqual([{ op: 'refuse', routine: 'r000001' }]);
    expect(bubble()).toHaveTextContent('nothing pending');
    // A machine down is said in the island's own words, never the fleet's French « hors ligne ».
    f.failWith('hors ligne', 'offline');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refuse' })); });
    expect(bubble()).toHaveTextContent('Offline: reconnecting to the daemon');
  });

  it('« Activate all 3 » binds each routine to its own key; a routine not read yet cannot be activated', async () => {
    const f = fleetClient([task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] })], group);
    mount(f);
    f.set({ local: [decision('t2')] });
    tick(540);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate all 3' })); });
    expect(f.cmds.map(c => c.ask)).toEqual(group.map(r => ({ op: 'approve', routine: r.id, expect: r.key })));
  });

  it('an approval refused as stale (card 32): the amber words, never the daemon’s reason; nothing more sent, Activate again', async () => {
    const f = fleetClient([task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] })], group);
    mount(f);
    f.set({ local: [decision('t2')] });
    tick(540);
    f.failWith('la demande a changé', 'stale');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate all 3' })); });
    expect(f.cmds).toHaveLength(1);
    const note = bubble().querySelector('[data-stale]')!;
    expect(note).toHaveTextContent('“prepa-121” changed since you opened it: read it again before activating.');
    expect(note).toHaveStyle({ color: 'var(--warning)' });
    expect(bubble()).not.toHaveTextContent('la demande a changé');
    expect(screen.getByRole('button', { name: 'Activate all 3' })).toBeEnabled();
  });

  it('without the routine’s key (not read yet) Activate waits; Refuse stays', () => {
    const f = fleetClient([task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })], [{ ...pointHebdo, key: undefined }]);
    mount(f);
    f.set({ local: [decision('t1')] });
    tick(540);
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuse' })).toBeEnabled();
  });

  it('a failure: Run again fires it, View opens its page in Desktop', async () => {
    // The daemon's reason is French; the English island says the folder with the mockup's words, from `field`.
    const f = fleetClient([task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { giverName: 'Ledge' })], [veille]);
    mount(f);
    f.set({ local: [decision('t3')] });
    tick(540);
    expect(bubble()).toHaveAttribute('data-routine', 'failed');
    expect(bubble()).toHaveTextContent('Nova · routine ·');
    expect(bubble()).toHaveTextContent('The routine veille (Nova) could not run: folder not found: ~/veille');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run again' })); });
    expect(f.cmds).toEqual([{ machine: 'local', ask: { op: 'run', routine: 'r81c0d4' } }]);
  });

  it('View opens the routine’s page in Desktop', () => {
    const f = fleetClient([task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })], [pointHebdo]);
    mount(f);
    f.set({ local: [decision('t1')] });
    tick(540);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(opened).toEqual([{ kind: 'routine', machine: 'local', id: 'r3f9a12' }]);
    expect(f.cmds).toEqual([]);
    // The island says what opens (card 29), as its other openings do.
    expect(document.body).toHaveTextContent('Opening the routine “point-hebdo” in Ledge Desktop…');
  });
});
