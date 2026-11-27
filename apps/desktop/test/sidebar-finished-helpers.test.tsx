// Issue #47: a finished subagent (exited, or stopped by an interrupt) no longer stays listed under its session in the tree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Helper } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

const NOW = new Date().toISOString();
const helper = (id: string, state: Helper['state'], kind = 'Explore'): Helper => ({ id, kind, task: `Tâche ${id}`, state, ...(state === 'exited' ? { finishedAt: NOW } : {}) });
const finished = Array.from({ length: 12 }, (_, i) => helper(`done${i}`, 'exited', 'Finished'));

describe('the tree lists only the subagents still at work (#47)', () => {
  const OPS = fakeSession('ops', { name: 'Ops', cwd: '/w/ledge', state: 'idle', topic: 'Opérateur', helpers: [...finished, helper('stop', 'idle', 'Stopped'), helper('live', 'working', 'Planner')] });
  const OLD = fakeSession('old', { name: 'Old', cwd: '/w/ledge', state: 'idle', topic: 'Fini', helpers: finished });

  it('twelve finished and one stopped are hidden; the one at work stays, counted and listed; the ring of #1 is unchanged', async () => {
    const { side } = await boot({ projects: PROJECTS, sessions: [OPS, OLD] });
    const box = within(side.getByRole('region', { name: 'Projects' }));
    const row = (name: string) => box.getByRole('button', { name: new RegExp(`^${name}`) }).closest('.st-row') as HTMLElement;
    await waitFor(() => expect(row('Ops')).toBeTruthy());
    // Folded: the counter says one subagent, at work, and the session keeps its background ring.
    const kids = row('Ops').querySelector('.st-kids')!;
    expect(kids.textContent).toBe('1');
    expect(kids).toHaveAttribute('title', '1 subagent, 1 working');
    expect(row('Ops').querySelector('.st-bg-ring')).not.toBeNull();
    // Unfolded: the subagent at work alone.
    fireEvent.click(row('Ops').querySelector('.st-chev')!);
    await waitFor(() => expect(box.getByRole('button', { name: /^Planner/ })).toBeTruthy());
    expect(box.queryByRole('button', { name: /^Finished/ })).toBeNull();
    expect(box.queryByRole('button', { name: /^Stopped/ })).toBeNull();
    expect(document.querySelectorAll('.st-row.helper')).toHaveLength(1);
    // A session whose subagents all finished has nothing to unfold.
    expect(row('Old').querySelector('.st-chev')).toBeNull();
    expect(row('Old').querySelector('.st-kids')).toBeNull();
    expect(row('Old')).not.toHaveAttribute('aria-expanded');
  });
});
