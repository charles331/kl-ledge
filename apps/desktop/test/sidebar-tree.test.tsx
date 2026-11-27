import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

/** The IDE's tab in front of its group (the old top bar named the place: the IDE's tabs do). */
const activeTab = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true');
const abar = () => within(screen.getByRole('toolbar', { name: 'Atelier' }));

describe('the sidebar tree', () => {
  it('lists projects, folds a single branch, and hides Bix behind +1 finished', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    expect(tree.getByRole('button', { name: /^Ledge/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Payment/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^No project/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Otto/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Nova/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Rio/ })).toBeVisible();
    expect(tree.queryByRole('button', { name: /^Bix/ })).toBeNull();
    // Payment and No project have one branch, so the session sits on the project (level 2). Ledge has desktop and main, so Otto sits under a branch (level 3).
    expect(tree.getByRole('treeitem', { name: /Nova/ })).toHaveAttribute('aria-level', '2');
    expect(tree.getByRole('treeitem', { name: /Otto/ })).toHaveAttribute('aria-level', '3');
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(tree.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('a stored list preference opens the atelier', async () => {
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
    await boot({ projects: PROJECTS, sessions: listSessions() });
    expect(screen.queryByRole('tab', { name: 'List' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.overview')!).view).toBe('atelier');
  });

  it('opens a session from its row and filters the atelier from the project row', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    // The project row: the Atelier tab, filtered on that project (its bar names it).
    await user.click(side.getByRole('button', { name: /^Payment/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    expect(abar().getByText('Payment Service Platform Migration Europe')).toBeVisible();
  });

  it('unfolds two branches of the same project', async () => {
    const sessions = [...listSessions(), fakeSession('wren', { name: 'Wren', cwd: '/w/ledge', state: 'working', branch: 'release-0.6', worktree: true })];
    const { side } = await boot({ projects: PROJECTS, sessions });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    expect(tree.getByRole('button', { name: 'desktop' })).toBeVisible();
    expect(tree.getByRole('button', { name: 'release-0.6' })).toBeVisible();
    expect(tree.getByText('wt')).toBeVisible();
  });

  it('a right click on Otto opens the session menu', async () => {
    const { side } = await boot({ projects: PROJECTS, sessions: listSessions() });
    fireEvent.contextMenu(side.getByRole('button', { name: /^Otto/ }));
    expect((await screen.findAllByRole('menuitem', { name: /^Open/ }))[0]).toBeVisible();
  });

  it('the tree tab stop is the open session, or the first row when none is open', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const stops = () => [...side.getByRole('tree').querySelectorAll('[data-tree-key]')]
      .flatMap(el => el instanceof HTMLElement && el.tabIndex === 0 ? [el.dataset.treeKey] : []);
    expect(stops()).toEqual(['p:ledge']);
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(stops()).toEqual(['local:otto']);
  });

  it('the subagents pill unfolds the open session in the tree and scrolls to its row', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(side.queryByRole('button', { name: /^Explore/ })).toBeNull();
    const row = side.getByRole('button', { name: /^Otto/ });
    const scrolled = vi.fn();
    row.scrollIntoView = scrolled;
    await user.click(await screen.findByRole('button', { name: '1 subagent' }));
    expect(await side.findByRole('button', { name: /^Explore/ })).toBeVisible();
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });

  it('the Projects heading has hide, compact, fold-all and new-project', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const projects = within(side.getByRole('region', { name: 'Projects' }));
    const hide = projects.getByRole('button', { name: 'Only projects with a live agent (H)' });
    const compact = projects.getByRole('button', { name: 'Compact mode (D)' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(compact).toHaveAttribute('aria-pressed', 'false');
    expect(projects.getByRole('button', { name: 'Fold all' })).toBeVisible();
    expect(projects.getByRole('button', { name: 'New project' })).toBeVisible();

    await user.click(hide);
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(hide).toHaveAttribute('aria-pressed', 'false');

    await user.click(compact);
    expect(screen.getByRole('complementary', { name: /sidebar/i })).toHaveClass('st-dense');
    expect(compact).toHaveAttribute('aria-pressed', 'true');

    await user.click(projects.getByRole('button', { name: 'Fold all' }));
    expect(side.queryByRole('button', { name: /^Otto/ })).toBeNull();
    expect(side.getByRole('button', { name: /^Ledge/ })).toBeVisible();

    await user.click(projects.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });

  it('released, « Group by branch » lists the agents flat, each with its branch as a tag', async () => {
    const sessions = [...listSessions(), fakeSession('wren', { name: 'Wren', cwd: '/w/ledge', state: 'working', branch: 'main', topic: 'Ranger la release' })];
    const { side, user } = await boot({ projects: PROJECTS, sessions });
    const projects = within(side.getByRole('region', { name: 'Projects' }));
    const group = projects.getByRole('button', { name: 'Group by branch (B)' });
    expect(group).toHaveAttribute('aria-pressed', 'true');
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    expect(tree.getByRole('button', { name: 'desktop' })).toBeVisible();
    expect(tree.queryByTitle('Branch desktop')).toBeNull();

    await user.click(group);
    expect(group).toHaveAttribute('aria-pressed', 'false');
    expect(tree.queryByRole('button', { name: 'desktop' })).toBeNull();
    expect(tree.queryByRole('button', { name: 'main' })).toBeNull();
    // Every agent sits on its project (level 2), its branch on its row: the other branches stand out, the default one stays quiet.
    const otto = tree.getByRole('treeitem', { name: /Otto/ });
    expect(otto).toHaveAttribute('aria-level', '2');
    expect(within(otto).getByTitle('Branch desktop')).toHaveClass('st-btag');
    expect(within(otto).getByTitle('Branch desktop')).not.toHaveClass('default');
    expect(within(tree.getByRole('treeitem', { name: /Wren/ })).getByTitle('Branch main')).toHaveClass('default');
    // No branch known (no repository): no tag.
    expect(within(tree.getByRole('treeitem', { name: /Nova/ })).queryByTitle(/^Branch /)).toBeNull();
    expect(JSON.parse(localStorage.getItem('desktop.sidebar')!).byBranch).toBe(false);
  });

  it('B in the tree switches between the agents list and the branches', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('b');
    expect(tree.getByRole('treeitem', { name: /Otto/ })).toHaveAttribute('aria-level', '2');
    await user.keyboard('b');
    expect(tree.getByRole('treeitem', { name: /Otto/ })).toHaveAttribute('aria-level', '3');
  });

  it('+N finished shows them with no link to hide them; H hides them again', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: '+1 finished' }));
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(side.queryByRole('button', { name: '+1 finished' })).toBeNull();
    expect(side.queryByRole('button', { name: /^Hide (the finished one|finished)$/ })).toBeNull();
    side.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('hh');
    expect(side.queryByRole('button', { name: /^Bix/ })).toBeNull();
    expect(side.getByRole('button', { name: '+1 finished' })).toBeVisible();
  });

  it('H hides finished ones; the open session stays in view', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    expect(side.queryByRole('button', { name: /^Bix/ })).toBeNull();
    side.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('h');
    await user.click(side.getByRole('button', { name: /^Bix/ }));
    const row = side.getByRole('treeitem', { name: /Bix/ });
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-current', 'true');
    side.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('h');
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(side.getByRole('treeitem', { name: /Bix/ })).toHaveAttribute('aria-selected', 'true');
  });

  // Issue #28, the « Atelier » skin (spec 2026-11-26-ide-atelier-skin §5): a principal that waits says « À toi » in place of its time.
  it('under the skin, a waiting principal says Your turn in place of its time; the others keep their time or offline', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    const time = (name: RegExp) => tree.getByRole('treeitem', { name }).querySelector(':scope > .st-time')!;
    // Otto waits for an authorisation (coral), Kit for an answer (amber, by the question's class).
    expect(time(/^Otto/).querySelector('.at-tag')).toHaveTextContent('Your turn');
    expect(time(/^Otto/)).toHaveClass('t-approval');
    expect(time(/^Kit/).querySelector('.at-tag')).toHaveTextContent('Your turn');
    expect(time(/^Kit/)).toHaveClass('t-question');
    // A session at work keeps its time; an offline one says so, even though its state was a wait's.
    expect(time(/^Nova/).querySelector('.at-tag')).toBeNull();
    expect(time(/^Nova/)).toHaveTextContent('3 min');
    expect(time(/^Rio/).querySelector('.at-tag')).toBeNull();
    expect(time(/^Rio/)).toHaveTextContent('offline');
    // A sub-agent row is unchanged: its time, never the pill (the session page's « 1 subagent » unfolds it in the tree).
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await user.click(await screen.findByRole('button', { name: '1 subagent' }));
    const explore = (await side.findByRole('button', { name: /^Explore/ })).closest('[role=treeitem]')!;
    expect(explore.querySelector(':scope > .st-time')).toHaveTextContent(/min/);
    expect(explore.querySelector('.at-tag')).toBeNull();
  });

  it('under the skin, a sub-agent that waits for an authorisation keeps its time, coloured, not the pill', async () => {
    const otto = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', branch: 'desktop', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_permission' }] });
    const { side } = await boot({ projects: PROJECTS, sessions: [otto] });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    const helper = tree.getByRole('treeitem', { name: /^Explore/ }).querySelector(':scope > .st-time')!;
    expect(helper).toHaveClass('t-approval');
    expect(helper.querySelector('.at-tag')).toBeNull();
    expect(tree.getByRole('treeitem', { name: /^Otto/ }).querySelector('.at-tag')).toBeNull();
  });

  it('under the skin, a session in error says Your turn too, with the error class (the outlined pill, the owner\'s choice A)', async () => {
    const zed = fakeSession('zed', { name: 'Zed', cwd: '/w/ledge', state: 'error', branch: 'desktop', topic: 'Corriger le build' });
    const { side } = await boot({ projects: PROJECTS, sessions: [...listSessions(), zed] });
    const time = within(side.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('treeitem', { name: /^Zed/ }).querySelector(':scope > .st-time')!;
    expect(time).toHaveClass('t-error');
    expect(time.querySelector('.at-tag')).toHaveTextContent('Your turn');
  });

  // Issues #31 and #32: the name in its own span (it gives way with « … »), the branch tag's name in its own (it gives way first).
  it('a session row carries its name and its branch tag\'s name in their own spans', async () => {
    localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: true, dense: false, byBranch: false }));
    const { side } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const otto = within(side.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('treeitem', { name: /Otto/ });
    expect(otto.querySelector('.st-main strong > .st-aname')).toHaveTextContent(/^Otto$/);
    expect(otto.querySelector('.st-main strong > .st-btag > .st-btag-name')).toHaveTextContent(/^desktop$/);
  });
});
