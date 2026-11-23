import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Routine, Session } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet';
import { LangProvider } from '../../src/i18n/lang';
import { RoutinesView, sessionLook } from '../../src/routines/RoutinesView';
import { RoutinePage } from '../../src/routines/RoutinePage';
import { RoutineForm } from '../../src/routines/RoutineForm';
import { AtoiRoutineCards, AtoiRoutinesBlock } from '../../src/routines/AtoiRoutines';
import type { Task } from '@ledge/protocol';
import { specDraft } from '../../src/routines/model';
import { MESSAGES } from '../../src/i18n/messages';
import type { RoutineActions } from '../../src/routines/useRoutineActions';

// The designer's answers to the Desktop points and card 28 (docs/mockups/ledge-routines.html), confirmed by the owner on 2026-11-23.
afterEach(cleanup);
const fr = (ui: React.ReactElement) => render(<LangProvider lang="fr">{ui}</LangProvider>);
const routine = (id: string, machineId: string, extra: Partial<Routine> = {}): FleetRoutine => ({
  id, name: `r-${id}`, target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00'], days: ['mon'] },
  prompt: 'p', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: '2026-11-20T08:00:00.000Z', machineId, ...extra
});
const view = { proposals: [], sessionOf: () => undefined, current: null, running: new Map(), connecting: false, offline: false,
  onOpen: vi.fn(), onNew: vi.fn(), onRun: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onOpenSession: vi.fn(), onDelete: vi.fn() };
const actions = { running: new Map(), refusedBy: vi.fn() } as unknown as RoutineActions;

describe('Routines on Desktop, card 28', () => {
  it('a title per machine above its groups when there are several; none with one', () => {
    const machines = [{ id: 'local', label: 'PC du bureau', up: true }, { id: 'lap', label: 'Portable', up: false }];
    const { unmount } = fr(<RoutinesView {...view} machines={machines} routines={[routine('r000001', 'local'), routine('r000002', 'lap')]} />);
    expect([...document.querySelectorAll('.rtn-mach')].map(e => e.textContent)).toEqual(['PC du bureau', 'Portable']);
    expect(document.querySelectorAll('.rtn-grp-h')).toHaveLength(2);
    unmount();
    fr(<RoutinesView {...view} machines={machines.slice(0, 1)} routines={[routine('r000001', 'local')]} />);
    expect(document.querySelectorAll('.rtn-mach')).toHaveLength(0);
  });

  it('a routine deleted elsewhere: the sentence and « Fermer l’onglet »', () => {
    const onClose = vi.fn();
    fr(<RoutinePage routine={null} gone machine="local" others={[]} sessions={[]} dirLabel={d => d} fleet={{ routinePreview: vi.fn() }} actions={actions}
      onDirt={vi.fn()} onOpenSession={vi.fn()} onOpenRoutine={vi.fn()} onCreated={vi.fn()} onClose={onClose} onAgain={vi.fn()} offline={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cette routine n’existe plus : elle a été supprimée ailleurs.');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer l’onglet' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a text under each field in error, and the daemon’s refusal under the field it names', () => {
    const d = { ...specDraft(), name: 'brief ing!', schedule: { ...specDraft().schedule, kind: 'once' as const } };
    const { unmount } = fr(<RoutineForm draft={d} onChange={vi.fn()} errors={{ name: 'invalid', session: true, prompt: true, at: true }} sessions={[]} dirLabel={x => x} preview={null} lastSlot={null} />);
    const hints = [...document.querySelectorAll('.rtn-hint.err')].map(e => e.textContent);
    expect(hints).toEqual(['Nom invalide : lettres, chiffres, point, tiret et tiret bas seulement.', 'Choisis une session.', 'Au moins une date.', 'Le prompt est vide.']);
    unmount();
    const two = { ...specDraft(), schedule: { ...specDraft().schedule, times: ['16:00'], days: ['thu' as const], weeks: 2 as const } };
    const { unmount: u2 } = fr(<RoutineForm draft={two} onChange={vi.fn()} errors={{ anchor: true }} sessions={[]} dirLabel={x => x} preview={null} lastSlot={null} />);
    expect(document.querySelector('.rtn-hint.err')).toHaveTextContent('Choisis la semaine de référence.');
    u2();
    fr(<RoutineForm draft={{ ...specDraft(), mode: 'new' }} onChange={vi.fn()} errors={{}} sessions={[]} dirLabel={x => x} preview={null} lastSlot={null}
      refusal={{ part: 'dir', text: 'Ce dossier n’existe pas sur ce PC.' }} machines={{ choices: [{ id: 'local', label: 'PC du bureau', up: true }, { id: 'lap', label: 'Portable', up: true }], value: 'local', onChange: vi.fn() }} />);
    expect(screen.getByLabelText('Machine')).toHaveValue('local');
    expect(document.querySelector('.rtn-hint.err')).toHaveTextContent('Ce dossier n’existe pas sur ce PC.');
  });

  it('the session states the mockup does not draw, in the phone’s words', () => {
    const s = (state: Session['state'], extra: Partial<Session> = {}) => ({ id: 'a', name: 'Iris', cwd: '/x', tool: 'claude', state, ...extra }) as Session;
    const t = MESSAGES.fr;
    expect(sessionLook(s('starting'), t).label).toBe('Démarrage');
    expect(sessionLook(s('error'), t).label).toBe('Erreur');
    expect(t.routines.toastLaunched('briefing', 'Iris')).toBe('Iris lancée, « briefing » remise.');
    expect(MESSAGES.en.routines.toastLaunched('briefing', 'Iris')).toBe('Iris launched, “briefing” delivered.');
  });

  it('« À toi »: a session’s change reads « veut modifier », built from the routine, never the daemon’s French title (card 29)', () => {
    const r = routine('r000001', 'local', { schedule: { kind: 'recurring', times: ['08:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] } });
    r.proposal = { spec: { ...r, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] } }, by: { id: 's', name: 'Iris' }, at: '2026-11-23T01:00:00.000Z' };
    const task: Task = { id: 't1', title: 'Iris veut modifier « r-r000001 » : 07:30, 13:30, 16:30 (lun-ven)', text: 'préparations trouvées dans l’agenda', giver: 's', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge',
      state: 'open', at: r.createdAt, updatedAt: r.createdAt, log: [], routine: { kind: 'approve', id: r.id, name: r.name } };
    const h = { items: [{ task, kind: 'approve' as const, routines: [r] }], dirLabel: () => '~/assistant', onActivate: vi.fn(), onRefuse: vi.fn(), onRetry: vi.fn(), onSee: vi.fn() };
    const en = (ui: React.ReactElement) => render(<LangProvider lang="en">{ui}</LangProvider>);
    const { unmount } = en(<AtoiRoutinesBlock {...h} />);
    expect(document.querySelector('[data-routine-item]')).toHaveTextContent('Iris wants to change “r-r000001”: 07:30, 13:30, 16:30 (Mon–Fri)');
    expect(document.body.textContent).not.toMatch(/veut|programmer|agenda/);
    unmount();
    const { unmount: u2 } = en(<div className="st"><AtoiRoutineCards {...h} /></div>);
    expect(document.querySelector('.rtn-st-text')).toHaveTextContent('wants to change “r-r000001”: 07:30, 13:30, 16:30 (Mon–Fri)');
    expect(document.body.textContent).not.toMatch(/veut|programmer/);
    u2();
    fr(<AtoiRoutinesBlock {...h} />);
    expect(document.querySelector('[data-routine-item]')).toHaveTextContent('Iris veut modifier « r-r000001 » : 07:30, 13:30, 16:30 (lun–ven)');
  });

  it('« À toi »: a request a session changed since it was shown says so in amber above its buttons (card 32)', () => {
    const r = routine('r000001', 'local');
    const task: Task = { id: 't1', title: 'x', giver: 's', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: r.createdAt, updatedAt: r.createdAt, log: [], routine: { kind: 'approve', id: r.id, name: r.name } };
    const h = { items: [{ task, kind: 'approve' as const, routines: [r] }], dirLabel: () => '~/assistant', onActivate: vi.fn(), onRefuse: vi.fn(), onRetry: vi.fn(), onSee: vi.fn(), stale: new Set(['local:r000001']) };
    const { unmount } = fr(<AtoiRoutinesBlock {...h} />);
    expect(document.querySelector('.rtn-stale')).toHaveTextContent(`« ${r.name} » a changé depuis que tu l’as ouverte : relis-la avant d’activer.`);
    unmount();
    render(<LangProvider lang="en"><div className="st"><AtoiRoutineCards {...h} /></div></LangProvider>);
    expect(document.querySelector('.rtn-stale')).toHaveTextContent(`${r.name} changed since you opened it: read it again before activating.`);
  });
});

describe('the « Tâches » tab', () => {
  it('leaves a routine’s « À toi » item to « À toi » (its title is the daemon’s French)', async () => {
    const { shownTasks } = await import('../../src/chat/RightTabs');
    const base = { giver: 's', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open' as const, at: '2026-11-23T01:00:00.000Z', updatedAt: '2026-11-23T01:00:00.000Z', log: [] };
    const tasks = [{ ...base, id: 'a', title: 'Une décision' }, { ...base, id: 'b', title: 'Iris veut programmer « x »', routine: { kind: 'approve' as const, id: 'r000001', name: 'x' } }];
    expect(shownTasks(tasks).map(x => x.id)).toEqual(['a']);
  });
});
