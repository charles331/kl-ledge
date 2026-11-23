import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneRoutine, PhoneTask } from '@ledge/protocol';
import { setLang } from '../../src/copy';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { Inbox } from '../../src/screens/Inbox';
import { Routines } from '../../src/screens/Routines';
import { Sessions } from '../../src/screens/Sessions';
import { atoiBadge } from '../../src/shell/tabs';
import { session } from '../model/fixtures';
import { detail, NOW, oneShot, pointHebdo, routine, routineTask, veille } from '../model/routine-fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); vi.mocked(platformAvailable).mockResolvedValue(true); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const sessions = () => [session('iris', { name: 'Iris', state: 'working' }), session('otto', { name: 'Otto', tool: 'codex' }), session('lu', { name: 'Lu' })];

/** A PC with a passkey on this phone, its sessions, its routines and its tasks. */
function pc(routines: PhoneRoutine[] | null, tasks: PhoneTask[] = []) {
  const t = setup();
  t.deliver(snapshot(sessions(), 'PC-Desan', undefined, { confirm: true }));
  if (routines) t.deliver({ type: 'routines', routines });
  t.deliver({ type: 'tasks', tasks });
  return t;
}

describe('the phone’s routines, as the PC sends them', () => {
  it('are asked once per link after the snapshot, then follow each change; a routine shown whole is read again once it changed', () => {
    const t = setup();
    t.deliver(snapshot(sessions()));
    t.deliver(snapshot(sessions()));
    expect(t.of('routine.list')).toEqual([{ type: 'routine.list' }]);
    expect(t.store.getState().routines).toBeNull();
    t.deliver({ type: 'routines', routines: [routine()] });
    t.deliver({ type: 'routine.changed', routine: veille() });
    expect(t.store.getState().routines!.map(r => r.name)).toEqual(['veille', 'briefing']);
    t.store.showRoutine('r1a2b3c');
    t.store.showRoutine('r1a2b3c');
    expect(t.of('routine.show')).toEqual([{ type: 'routine.show', routine: 'r1a2b3c' }]);
    t.deliver({ type: 'routine.detail', id: 'r1a2b3c', routine: detail(routine(), 'Briefing de {slot}.') });
    expect(t.store.getState().routineDetails.r1a2b3c).toMatchObject({ prompt: 'Briefing de {slot}.' });
    t.deliver({ type: 'routine.changed', routine: routine({ key: 'k-new' }) });
    expect(t.store.getState().routineDetails.r1a2b3c).toBeUndefined();
    t.deliver({ type: 'routine.changed', removed: 'r81c0d4' });
    expect(t.store.getState().routines!.map(r => r.name)).toEqual(['briefing']);
  });
});

describe('Sessions: the entry and the clock (card 17)', () => {
  it('« Routines » at the top: how many, the next run, the red count of those waiting or failed; it opens the Routines screen', () => {
    const t = pc([routine(), veille(), pointHebdo()]);
    render(<Sessions store={t.store} />);
    const entry = screen.getByRole('link', { name: /Routines/ });
    expect(entry).toHaveAttribute('href', '#/routines');
    expect(within(entry).getByText('3 routines · prochain tir 13:30')).toBeInTheDocument();
    expect(within(entry).getByText('2')).toHaveAttribute('data-pill', 'perm');
  });

  it('the small clock on a session a routine wakes, none on the others; no entry from a PC that sends no routines', () => {
    const t = pc([routine()]);
    const { unmount } = render(<Sessions store={t.store} />);
    const iris = screen.getByRole('link', { name: /Iris/ });
    expect(iris.querySelector('[data-woken]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Lu/ }).querySelector('[data-woken]')).toBeNull();
    unmount();
    const older = pc(null);
    render(<Sessions store={older.store} />);
    expect(screen.queryByRole('link', { name: /Routines/ })).toBeNull();
  });
});

describe('the Routines screen (cards 17 and 25)', () => {
  it('lists them read-only: recurring then one-shots, those waiting first, each with its session, schedule, next and last run', () => {
    const once = oneShot('r000001', 'rappel-conges', '2026-12-04T09:00', { state: 'enabled', nextRun: new Date(2026, 11, 4, 9, 0).toISOString() });
    const t = pc([routine(), once, veille(), pointHebdo()]);
    render(<Routines store={t.store} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Récurrentes', 'Uniques']);
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['point-hebdo', 'veille', 'briefing', 'rappel-conges']);
    const [hebdo, veilleCard, briefing, conges] = screen.getAllByRole('article');
    expect(within(hebdo!).getByText('Iris · 17:00 · ven')).toBeInTheDocument();
    expect(within(hebdo!).getByText('Attend ton accord')).toBeInTheDocument();
    expect(within(hebdo!).getByRole('link', { name: 'Voir dans À toi' })).toHaveAttribute('href', '#/');
    expect(within(hebdo!).queryByRole('button')).toBeNull();
    expect(within(veilleCard!).getByText('Nova · 18:00 · tous les jours')).toBeInTheDocument();
    expect(within(veilleCard!).getByText('Prochain tir aujourd’hui 18:00')).toBeInTheDocument();
    expect(within(veilleCard!).getByText('18:00 · échouée')).toBeInTheDocument();
    expect(within(veilleCard!).getByText('dossier introuvable : ~/veille')).toBeInTheDocument();
    expect(within(veilleCard!).getByRole('button', { name: 'Relancer' })).toBeInTheDocument();
    expect(within(briefing!).getByText('Iris · 08:00, 13:30, 16:30 · lun–ven')).toBeInTheDocument();
    expect(within(briefing!).getByText('08:00 · reprise, puis remise')).toBeInTheDocument();
    expect(within(briefing!).getByText('en retard')).toBeInTheDocument();
    expect(within(conges!).getByText('Iris · unique')).toBeInTheDocument();
    expect(within(conges!).getByText('Prochain : ven. 4 déc. 09:00')).toBeInTheDocument();
    expect(screen.getByText('Créer ou modifier une routine : sur le PC, ou en le demandant à Ledge.')).toBeInTheDocument();
  });

  it('« Lancer maintenant » and « Pause » send their command, no device check; a paused one offers « Reprendre »', async () => {
    const t = pc([routine(), routine({ id: 'r9d8e7f', name: 'nettoyage-branches', state: 'paused', nextRun: undefined })]);
    render(<Routines store={t.store} />);
    const [briefing, cleaning] = screen.getAllByRole('article');
    expect(within(cleaning!).getByText('en pause')).toBeInTheDocument();
    fireEvent.click(within(briefing!).getByRole('button', { name: 'Lancer maintenant' }));
    const [run] = t.of('routine.cmd');
    expect(run).toMatchObject({ action: 'run', routine: 'r1a2b3c' });
    expect(run).not.toHaveProperty('assertion');
    await act(async () => { t.deliver({ type: 'operation.result', op: run!.op, status: 'applied' }); });
    fireEvent.click(within(cleaning!).getByRole('button', { name: 'Reprendre' }));
    await waitFor(() => expect(t.of('routine.cmd')).toHaveLength(2));
    expect(t.of('routine.cmd')[1]).toMatchObject({ action: 'resume', routine: 'r9d8e7f' });
    expect(t.of('confirm.prepare')).toEqual([]);
  });

  it('opened from a failure’s « Voir », it scrolls to that routine and rings it for 1.5 s (card 29)', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const t = pc([routine(), veille()]);
    render(<Routines store={t.store} focus="r81c0d4" />);
    const ring = () => screen.getByRole('article', { name: 'veille' }).parentElement!;
    expect(ring()).toHaveAttribute('data-focused');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('article', { name: 'briefing' }).parentElement).not.toHaveAttribute('data-focused');
    await waitFor(() => expect(ring()).not.toHaveAttribute('data-focused'), { timeout: 2500 });
  });

  it('a refused command says so on its card', async () => {
    const t = pc([routine()]);
    render(<Routines store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const [cmd] = t.of('routine.cmd');
    await act(async () => { t.deliver({ type: 'operation.result', op: cmd!.op, status: 'failed' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas envoyé : réessaie.');
  });
});

describe('« À toi »: the routines’ items (cards 17 and 25)', () => {
  it('an activation request reads the routine whole, unfolds its prompt, and « Activer » signs that routine and its key', async () => {
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const t = pc([pointHebdo()], [routineTask('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })]);
    render(<Inbox store={t.store} />);
    expect(t.of('routine.show')).toEqual([{ type: 'routine.show', routine: 'r3f9a12' }]);
    const card = screen.getByRole('article', { name: 'Demande · point-hebdo' });
    expect(within(card).getByRole('button', { name: 'Activer' })).toBeDisabled();
    act(() => t.deliver({ type: 'routine.detail', id: 'r3f9a12', routine: detail(pointHebdo(), 'Point de la semaine du {date}.') }));
    expect(card).toHaveTextContent('Iris veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant');
    expect(within(card).getByText('Point de la semaine du {date}.')).toBeInTheDocument();
    expect(await within(card).findByText(/Activer demande la vérification de cet appareil/)).toBeInTheDocument();
    expect(within(card).getByText('Routine ·', { exact: false })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Activer' }));
    const prepared = () => t.of('confirm.prepare').filter(m => m.purpose === 'routine');
    await waitFor(() => expect(prepared()).toHaveLength(1));
    expect(prepared()[0]).toEqual({ type: 'confirm.prepare', purpose: 'routine', routine: 'r3f9a12', routineKey: 'k-point' });
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'routine', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('routine.cmd')).toHaveLength(1));
    expect(t.of('routine.cmd')[0]).toMatchObject({ action: 'approve', routine: 'r3f9a12', routineKey: 'k-point', assertion: ASSERTION });
  });

  it('a single one-off asks with its dated moment, the session that asked named (the item itself is Ledge’s)', () => {
    const r = oneShot('r000001', 'prepa-121', '2026-12-03T16:00');
    const t = pc([r], [routineTask('t1', { kind: 'approve', id: 'r000001', name: 'prepa-121' })]);
    render(<Inbox store={t.store} />);
    act(() => t.deliver({ type: 'routine.detail', id: 'r000001', routine: detail(r, 'Prépare le 121.') }));
    expect(screen.getByRole('article', { name: 'Demande · prepa-121' })).toHaveTextContent('Iris veut programmer « prepa-121 » : jeu. 3 déc. 16:00, dans ~/assistant');
  });

  it('on an English screen an item never shows the daemon’s French task title: its words come from the routine, through the catalogue', () => {
    setLang('en');
    try {
      const t = pc([pointHebdo(), veille()], [
        routineTask('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }, { title: 'Iris veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant' }),
        routineTask('t2', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { title: 'La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille' })
      ]);
      render(<Inbox store={t.store} />);
      // The request's words before its detail even comes: a new routine is the listed one.
      expect(screen.getByRole('article', { name: 'Request · point-hebdo' })).toHaveTextContent('Iris wants to schedule “point-hebdo”: 17:00 (Fri), in ~/assistant');
      expect(screen.getByRole('article', { name: 'Failure · veille' })).toHaveTextContent('The routine veille (Nova) could not run: folder not found: ~/veille');
      expect(document.body).not.toHaveTextContent('veut programmer');
      expect(document.body).not.toHaveTextContent('n’a pas pu partir');
    } finally { setLang('fr'); }
  });

  it('a change waits for its detail before it says anything: the listed routine holds the old settings', () => {
    const t = pc([routine({ proposed: true })], [routineTask('t1', { kind: 'approve', id: 'r1a2b3c', name: 'briefing' }, { title: 'Iris veut modifier « briefing »' })]);
    render(<Inbox store={t.store} />);
    const card = screen.getByRole('article', { name: 'Demande · briefing' });
    expect(card).not.toHaveTextContent('briefing »');
    expect(within(card).getByRole('button', { name: 'Activer' })).toBeDisabled();
  });

  it('« Refuser » needs no check', () => {
    const t = pc([pointHebdo()], [routineTask('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })]);
    render(<Inbox store={t.store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(t.of('routine.cmd')[0]).toMatchObject({ action: 'refuse', routine: 'r3f9a12' });
    expect(t.of('confirm.prepare')).toEqual([]);
  });

  it('several one-shots proposed together: their lines; « Activer les 3 » is ONE device check over the three, « Refuser les 3 » one command', async () => {
    vi.mocked(getAssertion).mockClear().mockResolvedValue(ASSERTION);
    const group = [oneShot('r000001', 'prepa-121', '2026-12-03T16:00'), oneShot('r000002', 'prepa-comite-archi', '2026-12-07T15:00'), oneShot('r000003', 'prepa-demo-compart', '2026-12-08T09:30')];
    const t = pc(group, [routineTask('t1', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }, { at: new Date(2026, 10, 23, 2, 58).toISOString() })]);
    render(<Inbox store={t.store} />);
    const card = screen.getByRole('article', { name: 'Demande · prepa-121' });
    expect(card).toHaveTextContent('Iris veut programmer 3 routines uniques');
    expect(within(card).getAllByRole('listitem').map(li => li.textContent)).toEqual(['prepa-121 · jeu. 3 déc. 16:00', 'prepa-comite-archi · lun. 7 déc. 15:00', 'prepa-demo-compart · mar. 8 déc. 09:30']);
    expect(within(card).getByRole('button', { name: 'Activer les 3' })).toBeEnabled();
    const others = [{ routine: 'r000002', routineKey: 'k-prepa-comite-archi' }, { routine: 'r000003', routineKey: 'k-prepa-demo-compart' }];
    fireEvent.click(within(card).getByRole('button', { name: 'Activer les 3' }));
    const prepared = () => t.of('confirm.prepare').filter(m => m.purpose === 'routine');
    await waitFor(() => expect(prepared()).toHaveLength(1));
    expect(prepared()[0]).toEqual({ type: 'confirm.prepare', purpose: 'routine', routine: 'r000001', routineKey: 'k-prepa-121', routineOthers: others });
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'routine', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('routine.cmd')).toHaveLength(1));
    expect(t.of('routine.cmd')[0]).toMatchObject({ action: 'approve', routine: 'r000001', routineKey: 'k-prepa-121', others, assertion: ASSERTION });
    expect(vi.mocked(getAssertion)).toHaveBeenCalledTimes(1);
    await act(async () => { t.deliver({ type: 'operation.result', op: t.of('routine.cmd')[0]!.op, status: 'rejected', reason: 'stale' }); });
    fireEvent.click(within(card).getByRole('button', { name: 'Refuser les 3' }));
    await waitFor(() => expect(t.of('routine.cmd')).toHaveLength(2));
    expect(t.of('routine.cmd')[1]).toMatchObject({ action: 'refuse', routine: 'r000001', others });
    expect(t.of('routine.cmd')[1]).not.toHaveProperty('assertion');
    expect(prepared()).toHaveLength(1);
  });

  it('a session’s change to a routine says « veut modifier » with the settings it asks for and its prompt (card 29)', () => {
    const briefing = routine({ proposed: true });
    const t = pc([briefing], [routineTask('t1', { kind: 'approve', id: 'r1a2b3c', name: 'briefing' })]);
    render(<Inbox store={t.store} />);
    const asked = { name: 'briefing', target: briefing.target, schedule: { kind: 'recurring' as const, times: ['07:30', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] as ('mon' | 'tue' | 'wed' | 'thu' | 'fri')[] }, prompt: 'Briefing de {slot}.', catchUp: 'once' as const };
    act(() => t.deliver({ type: 'routine.detail', id: 'r1a2b3c', routine: { ...detail(briefing, 'Briefing de {slot}.'), proposal: { spec: asked, by: { id: 'iris', name: 'Iris' }, at: '2026-11-23T02:40:00.000Z' } } }));
    const card = screen.getByRole('article', { name: 'Demande · briefing' });
    expect(card).toHaveTextContent('Iris veut modifier « briefing » : 07:30, 13:30, 16:30 (lun–ven)');
    expect(card).not.toHaveTextContent('veut programmer');
    expect(within(card).getByText('Briefing de {slot}.')).toBeInTheDocument();
  });

  it('a run that could not leave: « Relancer » fires it again, « Voir » opens the Routines screen; both counted in the badge', () => {
    const failed = routineTask('t2', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { giver: 'ledge', giverName: 'Ledge' });
    const t = pc([veille()], [failed]);
    render(<Inbox store={t.store} />);
    const card = screen.getByRole('article', { name: 'Échec · veille' });
    expect(card).toHaveTextContent('La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille');
    expect(within(card).getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '#/routines/r81c0d4');
    fireEvent.click(within(card).getByRole('button', { name: 'Relancer' }));
    expect(t.of('routine.cmd')[0]).toMatchObject({ action: 'run', routine: 'r81c0d4' });
    expect(atoiBadge([], [], [failed])).toEqual({ text: '1', tone: 'red' });
    expect(atoiBadge([], [], [routineTask('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })])).toEqual({ text: '1', tone: 'amber' });
  });
});
