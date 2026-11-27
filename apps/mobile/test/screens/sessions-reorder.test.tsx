import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PhoneProject, PhoneServerMessage } from '@ledge/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionGroups } from '../../src/model/sessions';
import { LONG_PRESS_MS } from '../../src/screens/longPress';
import { Sessions } from '../../src/screens/Sessions';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

// Issue #16 on the phone (docs/mockups/ledge-reorder.html, cards 6 and 7, design-ux d49d1c6e and effaa3f5): the PC's kept order
// replaces the order by state inside a project; a long press then a drag moves a row (e2e), a long press without moving opens the
// actions with Monter / Descendre; a project's heading does the same.
afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

const PROJECTS: PhoneProject[] = [{ id: 'ledge', name: 'ledge', color: 'blue' }, { id: 'synapse', name: 'synapse', color: 'green' }];
const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 9, min)).toISOString();
const fleet = (order: Record<string, string[]> = {}, caps = true): PhoneServerMessage => {
  const base = snapshot([
    session('pim', { name: 'Pim', project: 'ledge', projectId: 'ledge', state: 'waiting_permission', pending: pending({ key: 'kp' }), startedAt: at(1) }),
    session('ida', { name: 'Ida', project: 'ledge', projectId: 'ledge', startedAt: at(2) }),
    session('nova', { name: 'Nova', project: 'ledge', projectId: 'ledge', state: 'working', startedAt: at(3) }),
    session('echo', { name: 'Echo', project: 'synapse', projectId: 'synapse', startedAt: at(4) })
  ]);
  return { ...base, daemon: { version: '0.70.0', name: 'PC', atelier: true, projectEdit: true, ...(caps ? { sessionOrder: true } : {}) }, projects: PROJECTS, sessionOrder: order } as PhoneServerMessage;
};
const rows = (region: string) => within(screen.getByRole('region', { name: region })).getAllByRole('link').map(a => a.getAttribute('href')!.replace('#/thread/', ''));
const longPress = (el: Element) => {
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
  fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
};
const result = (t: ReturnType<typeof setup>, type: string, status: 'applied' | 'rejected' | 'failed', reason?: string) =>
  act(() => t.deliver({ type: 'operation.result', op: (t.of(type as never).at(-1) as unknown as { op: string }).op, status, ...(reason ? { reason } : {}) } as PhoneServerMessage));

describe('the kept order (card 7)', () => {
  it('a project group follows the PC\'s order, not the state; a session never listed comes last; rigs as before', () => {
    const kept = { projects: PROJECTS, order: { ledge: ['nova', 'ida'] } };
    const s = (fleet() as unknown as { sessions: Parameters<typeof sessionGroups>[0] }).sessions;
    expect(sessionGroups(s, 'all', kept).map(g => [g.name, g.sessions.map(x => x.id)])).toEqual([['ledge', ['nova', 'ida', 'pim']], ['synapse', ['echo']]]);
    // Without a kept order (an older PC), those waiting first, as before.
    expect(sessionGroups(s, 'all').find(g => g.name === 'ledge')!.sessions.map(x => x.id)).toEqual(['pim', 'nova', 'ida']);
  });

  it('the list shows that order; a PC without it keeps the order by state', () => {
    const t = setup();
    t.deliver(fleet({ ledge: ['ida', 'nova', 'pim'] }));
    const view = render(<Sessions store={t.store} />);
    expect(rows('ledge')).toEqual(['ida', 'nova', 'pim']);
    view.unmount();
    const old = setup();
    old.deliver(fleet({ ledge: ['ida', 'nova', 'pim'] }, false));
    render(<Sessions store={old.store} />);
    expect(rows('ledge')).toEqual(['pim', 'nova', 'ida']);
  });
});

describe('Monter / Descendre (card 6)', () => {
  it('a long press without moving opens the actions, which gain Monter and Descendre; Descendre sends the project\'s new order', () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    expect(rows('ledge')).toEqual(['pim', 'ida', 'nova']);
    const first = within(screen.getByRole('region', { name: 'ledge' })).getAllByRole('link')[0]!;
    longPress(first);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Monter' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Descendre' }));
    expect(t.of('session.order').map(m => [m.project, m.ids])).toEqual([['ledge', ['ida', 'pim', 'nova']]]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('once the PC applied it, the move is said for screen readers; refused as stale, it is said on screen', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    longPress(within(screen.getByRole('region', { name: 'ledge' })).getAllByRole('link')[0]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descendre' }));
    result(t, 'session.order', 'applied');
    await settle();
    expect(document.querySelector('[data-reorder-said]')).toHaveTextContent('Pim est maintenant 2e sur 3 dans ledge.');
    longPress(within(screen.getByRole('region', { name: 'ledge' })).getAllByRole('link')[0]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descendre' }));
    result(t, 'session.order', 'rejected', 'stale');
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Pim n\'a pas été déplacé : la liste a changé entre-temps. Réessaie.');
  });

  it('a project\'s heading, held without moving: its name, Monter and Descendre; Descendre sends project.order', () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(fleet());
    render(<Sessions store={t.store} />);
    const heading = screen.getByRole('region', { name: 'ledge' }).firstElementChild!;
    longPress(heading);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('ledge');
    expect(within(sheet).getByRole('button', { name: 'Monter' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Descendre' }));
    expect(t.of('project.order').map(m => m.ids)).toEqual([['synapse', 'ledge']]);
  });

  it('offline, or a PC without the kept order: the actions have no Monter', () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(fleet({}, false));
    render(<Sessions store={t.store} />);
    longPress(within(screen.getByRole('region', { name: 'ledge' })).getAllByRole('link')[0]!);
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Monter' })).toBeNull();
  });
});
