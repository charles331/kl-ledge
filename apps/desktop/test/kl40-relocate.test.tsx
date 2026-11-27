// #40 PR 2a (docs/mockups/ledge-remove-chat-d1-d3-d6.html and ledge-remove-chat-p2.html): what the chat and « À toi » did, in its new
// place on Desktop. D1 « Demandes » at the top of Rigs, D3 the Tasks view, D5 a report in it, D7 the badges, D10 a failed handover.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import type { HumanAsk, Task } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { openRequests } from '../src/asks/model';
import { RigRequests, REQUEST_LIT_MS, requestOrder, requestsShown } from '../src/ide/rigs/RigRequests';
import { TasksPane, tasksBadge } from '../src/tasks/TasksView';
import type { TasksApi } from '../src/tasks/useTasksApi';
import { parseTarget } from '../src/open/target';
import { reliefFailedShown } from '../src/session/relief';
import { layoutReducer, loadLayout } from '../src/workspace/layout';
import { boot, closeDaemons, PROJECTS } from './helpers';

afterEach(async () => { vi.useRealTimers(); cleanup(); localStorage.clear(); await closeDaemons(); });

const T = (min: number) => new Date(Date.UTC(2026, 10, 27, 16, min)).toISOString();
const ask = (id: string, o: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: `Ask ${id}`, body: 'The body.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q1', question: `Question ${id}?`, options: [{ id: 'a', label: 'Merge', recommended: true }, { id: 'b', label: 'Wait', recommended: false }], answer: null }],
  createdAt: T(0), updatedAt: T(0), ...o
} as HumanAsk);
const view = (asks: HumanAsk[], o: Partial<OpenRigAsksView> = {}): OpenRigAsksView => ({
  channel: { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' } } as OpenRigAsksView['channel'], asks, truncated: false, partial: false,
  answer: vi.fn(() => Promise.resolve({ type: 'openrig.answered', requestId: 'r', qitemId: 'x', ok: true } as never)), refresh: vi.fn(), ...o
});
const requests = (v: OpenRigAsksView, focus: { id: string; n: number } | null = null, lang: 'fr' | 'en' = 'fr') =>
  <LangProvider lang={lang}><RigRequests view={v} sessions={[]} machineLabel="WSL" focus={focus} /></LangProvider>;

describe('D1 « Demandes » at the top of Rigs', () => {
  it('the most urgent first, then the most recent; the badge leaves the updates out', () => {
    const list = [ask('old', { createdAt: T(1) }), ask('new', { createdAt: T(9) }), ask('urgent', { priority: 'urgent', createdAt: T(2) }), ask('crit', { priority: 'critical', createdAt: T(0) }), ask('news', { kind: 'update', createdAt: T(5) })];
    expect(requestOrder(list).map(a => a.id)).toEqual(['crit', 'urgent', 'new', 'news', 'old']);
    expect(openRequests({ asks: list })).toBe(4);
    expect(openRequests(undefined)).toBe(0);
  });

  it('no request, a ready channel, a full read: no block; a banner or a partial read shows it', () => {
    expect(requestsShown(view([]))).toBe(false);
    expect(requestsShown(view([], { partial: true }))).toBe(true);
    expect(requestsShown(view([], { channel: { state: 'openrig_stopped', person: null } as OpenRigAsksView['channel'] }))).toBe(true);
    const { container } = render(requests(view([])));
    expect(container).toBeEmptyDOMElement();
  });

  it('every card whole under « Demandes · n »; « Replier » folds it, a new request opens it again', () => {
    const { rerender } = render(requests(view([ask('a'), ask('b', { kind: 'update' })])));
    const block = screen.getByRole('region', { name: 'Demandes' });
    expect(within(block).getByText('Demandes')).toBeVisible();
    expect(block.querySelector('.ide-rigs-req-n')).toHaveTextContent('1');
    expect(block.querySelectorAll('.ide-rigs-req-card')).toHaveLength(2);
    expect(within(block).getByRole('button', { name: /Merge · recommandé/ })).toBeVisible();
    fireEvent.click(within(block).getByRole('button', { name: 'Replier' }));
    expect(block.querySelectorAll('.ide-rigs-req-card')).toHaveLength(0);
    expect(within(block).getByRole('button', { name: 'Déplier' })).toHaveAttribute('aria-expanded', 'false');
    rerender(requests(view([ask('a'), ask('b', { kind: 'update' }), ask('c')])));
    expect(screen.getByRole('region', { name: 'Demandes' }).querySelectorAll('.ide-rigs-req-card')).toHaveLength(3);
  });

  it('« Ouvrir » from the island: the block unfolds, the card is ringed 1.5 s', () => {
    vi.useFakeTimers();
    const v = view([ask('a'), ask('b')]);
    const { rerender } = render(requests(v));
    fireEvent.click(screen.getByRole('button', { name: 'Replier' }));
    rerender(requests(v, { id: 'b', n: 1 }));
    const card = document.querySelector<HTMLElement>('.ide-rigs-req-card[data-ask="b"]')!;
    expect(card).toHaveClass('lit');
    act(() => { vi.advanceTimersByTime(REQUEST_LIT_MS); });
    expect(card).not.toHaveClass('lit');
  });

  it('a channel not ready: the existing banner, in « vous » on Desktop', () => {
    render(requests(view([], { channel: { state: 'openrig_stopped', person: null } as OpenRigAsksView['channel'] })));
    expect(document.querySelector('[data-channel="openrig_stopped"]')).toHaveTextContent('OpenRig est arrêté : les rigs ne peuvent pas vous écrire.');
  });

  it('the island\'s targets: a request, the requests, a task', () => {
    expect(parseTarget(JSON.stringify({ kind: 'ask', id: 'q1' }))).toEqual({ kind: 'ask', id: 'q1' });
    expect(parseTarget(JSON.stringify({ kind: 'requests' }))).toEqual({ kind: 'requests' });
    expect(parseTarget(JSON.stringify({ kind: 'task', id: 't7' }))).toEqual({ kind: 'task', id: 't7' });
    expect(parseTarget(JSON.stringify({ kind: 'task' }))).toBeNull();
  });
});

describe('D3 and D5: the Tasks view', () => {
  const T0 = T(0);
  const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [], ...extra });
  const report = task('r-4', { title: 'The island test fails under load', report: { kind: 'bug', title: 'The island test fails under load', detail: 'island.spec: the release comes after Esc.' } } as Partial<Task>);
  const api = (tasks: Task[]): TasksApi => ({ tasks, seen: vi.fn(), handover: vi.fn(), later: new Map(), near: 0.8, putLater: vi.fn(), answer: vi.fn(() => Promise.resolve(undefined)), answerNote: vi.fn() });

  it('the badge counts the decisions waiting, a report among them; not a routine\'s request, not a closed one', () => {
    const tasks = [task('t-13'), report, task('t-14', { owner: 'pim', ownerName: 'Pim' }), task('t-15', { state: 'done' }), task('r-1', { routine: { kind: 'approve', id: 'r000001', name: 'x' } } as Partial<Task>)];
    expect(tasksBadge(tasks)).toBe(2);
  });

  it('a report is a « ? » row with the « signalement » pill; its detail is the report card', () => {
    const onShow = vi.fn();
    const { rerender } = render(<LangProvider lang="fr"><TasksPane api={api([task('t-13'), report])} task={null} seen={0} state="ready" onShow={onShow} /></LangProvider>);
    const row = document.querySelector<HTMLElement>('[data-task="r-4"]')!;
    expect(row.querySelector('.mk')).toHaveTextContent('?');
    expect(row).toHaveTextContent('r-4 · Otto · signalement');
    fireEvent.click(row);
    expect(onShow).toHaveBeenCalledWith('r-4');
    const handlers = { client: { send: vi.fn(), onMessage: vi.fn(() => () => {}) } as never, desktop: '0.68.0', onEdit: vi.fn(), onCreated: vi.fn(), onOpenUrl: vi.fn() };
    rerender(<LangProvider lang="fr"><TasksPane api={api([task('t-13'), report])} task="r-4" seen={0} state="ready" onShow={onShow} report={handlers} /></LangProvider>);
    const detail = screen.getByRole('region', { name: 'The island test fails under load' });
    expect(within(detail).getByRole('button', { name: 'Créer l’issue' })).toBeVisible();
    expect(within(detail).getByRole('button', { name: 'Modifier avant' })).toBeVisible();
    expect(within(detail).getByRole('button', { name: 'Ignorer' })).toBeVisible();
    expect(within(detail).queryByRole('button', { name: 'Répondre' })).toBeNull();
  });

  it('a « Voir dans Tâches » shows the view and never folds it; the layout keeps « tasks » across a reload', () => {
    const l = { ...loadLayout(), sideOpen: true, sideView: 'tasks' as const };
    expect(layoutReducer(l, { type: 'showView', view: 'tasks' })).toBe(l);
    expect(layoutReducer({ ...l, sideOpen: false }, { type: 'showView', view: 'tasks' })).toMatchObject({ sideOpen: true, sideView: 'tasks' });
    localStorage.setItem('ledge.ide.layout', JSON.stringify({ ...l }));
    expect(loadLayout().sideView).toBe('tasks');
  });
});

describe('D7 and D10 in the app', () => {
  const ctx = (used: number) => ({ used, window: 200_000, at: T(0) });

  it('Projects carries the sessions\' badge (red for an approval, else amber), « À toi » none; Tasks its decisions', async () => {
    const { d } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf build', source: 'hook' } as never }),
      fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } as never })
    ] });
    const bar = within(screen.getByRole('navigation', { name: 'Activity bar' }));
    await waitFor(() => expect(bar.getByRole('button', { name: 'Projects' }).querySelector('.ide-badge')).toHaveTextContent('1'));
    expect(bar.getByRole('button', { name: 'Projects' }).querySelector('.ide-badge')).not.toHaveClass('amber');
    expect(bar.getByRole('button', { name: 'For you' }).querySelector('.ide-badge')).toBeNull();
    d.push({ type: 'task.updated', task: { id: 't-13', title: 'Pick the folder', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T(0), updatedAt: T(0), log: [] } });
    await waitFor(() => expect(bar.getByRole('button', { name: 'Tasks (Ctrl+/)' }).querySelector('.ide-badge.amber')).toHaveTextContent('1'));
  });

  it('Ctrl+/ after a « Voir dans Tâches »: back to the view shown before (review-qa2)', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })] });
    // A task Otto holds: pinned on its page, with « See in Tasks ».
    d.push({ type: 'task.updated', task: { id: 't-14', title: 'Review PR #36', giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'taken', at: T(0), updatedAt: T(0), log: [] } });
    await user.click((await screen.findAllByRole('button', { name: /^Otto/ })).find(b => b.closest('.st-row'))!);
    const see = await screen.findByRole('button', { name: 'See the tasks' });
    const bar = within(screen.getByRole('navigation', { name: 'Activity bar' }));
    await user.click(bar.getByRole('button', { name: 'OpenRig rigs' }));
    await waitFor(() => expect(bar.getByRole('button', { name: 'OpenRig rigs' })).toHaveClass('on'));
    await user.click(see);
    await waitFor(() => expect(bar.getByRole('button', { name: 'Tasks (Ctrl+/)' })).toHaveClass('on'));
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await user.keyboard('{Control>}/{/Control}');
    await waitFor(() => expect(bar.getByRole('button', { name: 'OpenRig rigs' })).toHaveClass('on'));
  });

  it('a failed handover: the tree row says it in red, the session page has its strip with « Retry », which hands over again', async () => {
    const handover = { state: 'failed' as const, at: T(0), reason: 'Codex offline' };
    expect(reliefFailedShown({ handover, context: ctx(180_000) }, 0.8)).toBe(true);
    expect(reliefFailedShown({ handover, context: ctx(20_000) }, 0.8)).toBe(false);
    expect(reliefFailedShown({ handover: { ...handover, state: 'launching' }, context: ctx(180_000) }, 0.8)).toBe(false);
    const { d, user } = await boot({ projects: PROJECTS, sessions: [fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'idle', context: ctx(182_000), handover })] });
    const treeNova = async () => (await screen.findAllByRole('button', { name: /^Nova/ })).find(b => b.closest('.st-row'))!;
    const row = (await treeNova()).closest('.st-row') as HTMLElement;
    // design-ux (track a): the ◔ in red, no label: the name stays whole.
    expect(row.querySelector('.st-ctx.failed')).toHaveTextContent('');
    expect(row.querySelector('.st-ctx.failed')).toHaveAttribute('aria-label', 'relief failed');
    expect(row.querySelector('.st-ctx.failed')).toHaveAttribute('title', 'Codex offline');
    await user.click(await treeNova());
    await waitFor(() => expect(document.querySelectorAll('.relief-failed')).toHaveLength(1));
    const strip = document.querySelector<HTMLElement>('.relief-failed')!;
    expect(strip).toHaveAttribute('role', 'alert');
    expect(strip).toHaveTextContent('Handover of Nova failed: Codex offline');
    await user.click(within(strip).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(d.received.some(m => m.type === 'session.handover' && m.id === 'nova')).toBe(true));
  });
});
