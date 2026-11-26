import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Projects, Session } from '@ledge/protocol';
import { dropIndex, moveTo, orderIds, ordinalFr, sessionGroup, target } from '../src/shell/sidebar/reorder';
import type { ProjectGroup } from '../src/shell/sidebar/model';
import { boot, closeDaemons, PROJECTS } from './helpers';

// Issue #16 (docs/mockups/ledge-reorder.html): projects and sessions in the order the person chooses, kept by the daemon.
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 9, min)).toISOString();
/** As the fleet shows them (`local:ada`) for the pure logic; `raw` as a daemon sends them, for the app. */
const ses = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, machineId: 'local', name: id[0]!.toUpperCase() + id.slice(1), cwd: '/w/ledge', state: 'working', startedAt: at(0), ...extra });

describe('the reorder logic', () => {
  it('a move up, down, to the top; nothing past the ends', () => {
    expect(target(1, 3, 'up')).toBe(0);
    expect(target(1, 3, 'down')).toBe(2);
    expect(target(2, 3, 'top')).toBe(0);
    expect(target(0, 3, 'up')).toBeNull();
    expect(target(2, 3, 'down')).toBeNull();
    expect(target(0, 3, 'top')).toBeNull();
    expect(moveTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('a drop before or after a row lands where the line shows', () => {
    // a b c d: b dropped after d ends last; d dropped before b ends second.
    expect(dropIndex(1, 3, true)).toBe(3);
    expect(dropIndex(3, 1, false)).toBe(1);
    expect(dropIndex(0, 1, false)).toBe(0);
  });
  it('the daemon gets the whole project, the group reordered, the others in place', () => {
    const a = ses('a'), b = ses('b', { branch: 'x' }), c = ses('c'), d = ses('d', { branch: 'x' });
    // Branch x (b, d) swapped; a and c keep their places.
    expect(orderIds([a, b, c, d], [d, b])).toEqual(['local:a', 'local:d', 'local:c', 'local:b']);
  });
  it('a session moves within its branch when the tree is grouped by branch, else within its project', () => {
    const a = ses('a', { branch: 'main' }), b = ses('b', { branch: 'feat' }), c = ses('c', { branch: 'feat' });
    const g: ProjectGroup = { id: 'ledge', name: 'Ledge', flatten: false, sessions: [a, b, c], branches: [{ branch: 'main', worktree: false, sessions: [a] }, { branch: 'feat', worktree: false, sessions: [b, c] }] };
    expect(sessionGroup([g], true, 'local:c', 'No project')).toMatchObject({ project: 'ledge', label: 'feat', sessions: [b, c] });
    expect(sessionGroup([g], false, 'local:c', 'No project')).toMatchObject({ project: 'ledge', label: 'Ledge', sessions: [a, b, c] });
  });
  it('French ordinals: « 1re » for a session, « 1er » for a project, then « 2e » (design-ux)', () => {
    expect(ordinalFr(1, true)).toBe('1re');
    expect(ordinalFr(1, false)).toBe('1er');
    expect(ordinalFr(2, true)).toBe('2e');
    expect(ordinalFr(3, false)).toBe('3e');
  });
});

describe('the tree, by the keyboard and the menus', () => {
  const raw = (id: string, extra: Partial<Session>) => fakeSession(id, { name: id[0]!.toUpperCase() + id.slice(1), cwd: '/w/ledge', state: 'working', ...extra });
  const sessions = [raw('ada', { startedAt: at(1) }), raw('bob', { startedAt: at(2) }), raw('cy', { startedAt: at(3) }), raw('nova', { cwd: '/w/pay', startedAt: at(4) })];
  const rows = (side: ReturnType<typeof within>, project: RegExp) => {
    const tree = side.getByRole('tree', { name: 'Projects, branches and sessions' });
    const items = [...(tree as HTMLElement).querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const start = items.findIndex(x => x.classList.contains('st-project') && project.test(x.querySelector('.st-main strong')?.textContent ?? ''));
    const out: string[] = [];
    for (const x of items.slice(start + 1)) { if (x.classList.contains('st-project')) break; if (x.classList.contains('st-agent')) out.push(x.querySelector('strong')!.textContent!.trim()); }
    return out;
  };
  const sent = (d: { received: unknown[] }) => d.received.filter(m => (m as { type: string }).type === 'sessions.order' || (m as { type: string }).type === 'projects.set');

  it('Alt+↑ moves a session one place up in its project, Alt+Début puts it first; the daemon keeps the order, it is said', async () => {
    const { d, side } = await boot({ sessions, projects: PROJECTS });
    expect(rows(side, /^Ledge/)).toEqual(['Ada', 'Bob', 'Cy']);
    const cy = side.getByRole('button', { name: /^Cy/ });
    cy.focus();
    fireEvent.keyDown(cy, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(rows(side, /^Ledge/)).toEqual(['Ada', 'Cy', 'Bob']));
    expect(sent(d).at(-1)).toEqual({ type: 'sessions.order', project: 'ledge', ids: ['local:ada', 'local:cy', 'local:bob'] });
    expect(document.querySelector('.st-said')).toHaveTextContent('Cy is now 2 of 3 in Ledge.');
    // The row keeps the focus once redrawn.
    await waitFor(() => expect(document.activeElement).toBe(side.getByRole('button', { name: /^Cy/ })));
    fireEvent.keyDown(side.getByRole('button', { name: /^Bob/ }), { key: 'Home', altKey: true });
    await waitFor(() => expect(rows(side, /^Ledge/)).toEqual(['Bob', 'Ada', 'Cy']));
    expect(document.querySelector('.st-said')).toHaveTextContent('Bob is now 1 of 3 in Ledge.');
    // A session never leaves its project by the keys: Nova is alone in its own.
    const before = sent(d).length;
    fireEvent.keyDown(side.getByRole('button', { name: /^Nova/ }), { key: 'ArrowUp', altKey: true });
    expect(sent(d)).toHaveLength(before);
  });

  it('the session menu offers Move up, Move down, To the top of the project, greyed when they would not move', async () => {
    const { d, side } = await boot({ sessions, projects: PROJECTS });
    fireEvent.contextMenu(side.getByRole('button', { name: /^Ada/ }));
    const menu = await screen.findByRole('menu', { name: 'Manage Ada' });
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'To the top of the project' })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(rows(side, /^Ledge/)).toEqual(['Bob', 'Ada', 'Cy']));
    expect(sent(d).at(-1)).toMatchObject({ type: 'sessions.order', project: 'ledge' });
  });

  it('a project moves among the projects (Alt+↓, its menu): projects.set keeps the rest, the order is said', async () => {
    const { d, side } = await boot({ sessions, projects: PROJECTS });
    const ledge = side.getByRole('button', { name: /^Ledge/ });
    ledge.focus();
    fireEvent.keyDown(ledge, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(sent(d).at(-1)).toMatchObject({ type: 'projects.set' }));
    const next = (sent(d).at(-1) as { projects: Projects }).projects;
    expect(next.projects.map(p => p.id)).toEqual(['pay', 'ledge', 'docs']);
    expect(next.rules).toEqual(PROJECTS.rules);
    expect(document.querySelector('.st-said')).toHaveTextContent('Ledge is now 2 of 3 projects.');
    fireEvent.contextMenu(side.getByRole('button', { name: /^Payment/ }));
    const menu = await screen.findByRole('menu', { name: /Payment/ });
    expect(within(menu).getByRole('menuitem', { name: 'To the top of the list' })).toBeDisabled();
  });

  it('a daemon that cannot be reached: nothing moves, and the notice says so', async () => {
    const { d, side } = await boot({ sessions, projects: PROJECTS });
    await d.close();
    await waitFor(() => expect(document.querySelector('.ide')?.getAttribute('data-readonly')).toBe('true'));
    fireEvent.keyDown(side.getByRole('button', { name: /^Cy/ }), { key: 'ArrowUp', altKey: true });
    expect(await screen.findByText('Could not move Cy: the local Ledge daemon is not reachable.')).toBeInTheDocument();
    expect(rows(side, /^Ledge/)).toEqual(['Ada', 'Bob', 'Cy']);
  });
});
