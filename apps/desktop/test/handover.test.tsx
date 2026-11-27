import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { nearLimit } from '../src/tasks/useTasksApi';

const AT = '2026-10-26T08:00:00.000Z';
const ctx = (used: number) => ({ used, window: 200_000, at: AT });

beforeEach(() => localStorage.clear());

/** The tree's gauge on a session past the threshold (its row in « Projects »). */
const gauge = (name: RegExp) => screen.getAllByRole('button', { name }).map(b => b.closest('.st-row')).find(Boolean)?.querySelector('.st-ctx') ?? null;
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('a session near its context limit (context handover spec §3.2)', () => {
  it('the tree shows its gauge; the session page shows the gauge, the « … » menu hands over (« À toi » left, #40 PR 3)', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', context: ctx(170_000) }),
      fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', context: ctx(60_000) })
    ] });
    await waitFor(() => expect(gauge(/^Otto/)).toHaveTextContent('85 %'));
    expect(gauge(/^Pim/)).toBeNull();
    d.onMessage(m => { if (m.type === 'session.handover') d.push({ type: 'session.handover.result', rid: m.rid, ok: true }); });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    // The IDE's session bar carries the gauge; « Hand over » is in the session's « … » menu (its seat's, in the Atelier).
    await waitFor(() => expect(document.querySelector('.ide-bar .ugauge')).not.toBeNull());
    expect(document.querySelector('.ide-bar')!.textContent).toContain('85\u00a0%');
    expect(document.querySelector('.ide-bar')!.textContent).not.toContain('Hand over');
    await user.click(screen.getByRole('button', { name: 'Atelier (tab)' }));
    await user.click(screen.getByRole('button', { name: 'Manage Otto' }));
    const item = await screen.findByRole('menuitem', { name: 'Hand over' });
    expect(item).toHaveTextContent('context 85 %');
    await user.click(item);
    await waitFor(() => expect(d.received).toContainEqual({ type: 'session.handover', rid: expect.any(String), id: 'otto' }));
    // Under way: the page says so.
    d.push({ type: 'session.updated', session: fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', context: ctx(170_000), handover: { state: 'briefing', at: AT } }) });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    expect(await screen.findByText('relief: brief asked')).toBeVisible();
  });

  it('« Max context » in Settings › General: the daemon\'s threshold, set there; the tree\'s gauge follows it', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', context: ctx(150_000) })] });
    d.push({ type: 'context.prefs', prefs: { near: 0.8 } });
    await screen.findAllByRole('button', { name: /^Otto/ });
    expect(gauge(/^Otto/)).toBeNull();
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const select = screen.getByRole('combobox', { name: 'Max context' });
    expect(select).toHaveValue('80');
    await user.selectOptions(select, '70');
    await waitFor(() => expect(d.received).toContainEqual({ type: 'context.set', prefs: { near: 0.7 } }));
    d.push({ type: 'context.prefs', prefs: { near: 0.7 } });
    // 75 % is past 70 %: the tree shows its gauge.
    await waitFor(() => expect(gauge(/^Otto/)).toHaveTextContent('75 %'));
  });

  it('« Later » puts it away until it grows by 5 points; a failed relief is listed with its reason', () => {
    const s = (id: string, used: number, extra = {}) => fakeSession(id, { name: id, context: ctx(used), ...extra });
    expect(nearLimit([s('a', 170_000), s('b', 100_000), s('c', 170_000, { handover: { state: 'briefing', at: AT } }), s('d', 170_000, { state: 'exited' })]).map(x => x.id)).toEqual(['a']);
    expect(nearLimit([s('a', 175_000)], new Map([['a', 0.85]]))).toEqual([]);
    expect(nearLimit([s('a', 182_000)], new Map([['a', 0.85]])).map(x => x.id)).toEqual(['a']);
    expect(nearLimit([s('e', 10_000, { handover: { state: 'failed', at: AT, reason: 'dossier introuvable' } })]).map(x => x.id)).toEqual(['e']);
  });
});
