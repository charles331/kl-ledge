import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, PROJECTS, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
const archives = (d: MockDaemon) => sent(d).filter(m => m.type === 'session.archive');

const treeOf = (side: ReturnType<typeof within>) => within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));

/** What the live regions say: the IDE has several (the toast's among them). */
const said = () => screen.getAllByRole('status').map(x => x.textContent ?? '').join(' | ');
/** The IDE's tab in front of its group (the old top bar named the place: the IDE's tabs do). */
const activeTab = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true');

const menuLabels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'));

describe('archive and delete from the sidebar tree', () => {
  it('the … button and a right click open the same session menu; E archives a finished principal', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();

    // A subagent row has no archive and no delete: E and Suppr on Explore send nothing and ask nothing.
    await user.click(tree.getByRole('button', { name: /Show Otto.s subagents/ }));
    tree.getByRole('button', { name: /^Explore/ }).focus();
    await user.keyboard('e');
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(archives(d)).toEqual([]);
    expect(sent(d).some(m => m.type === 'session.delete')).toBe(false);

    // Suppr asks before it deletes a principal, and sends nothing until the dialog is confirmed.
    tree.getByRole('button', { name: /^Rio/ }).focus();
    await user.keyboard('{Delete}');
    expect(await screen.findByRole('alertdialog', { name: 'Delete Rio?' })).toBeVisible();
    expect(sent(d).some(m => m.type === 'session.delete')).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    tree.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('e');
    await waitFor(() => expect(archives(d)).toEqual([{ type: 'session.archive', id: 'bix' }]));
    await waitFor(() => expect(said()).toContain('Bix is archived.'));
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument();

    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    const fromPointer = await screen.findByRole('menu', { name: 'Manage Otto' });
    const labels = menuLabels(fromPointer);
    // The IDE's session menu (ideSessionMenu): open here or to the right, its terminal, the editor, then the old entries.
    expect(labels).toEqual(['Open', 'Open to the right', 'Its terminal', 'Open in Cursor', 'Rename', 'Move to…', 'Move up', 'Move down', 'To the top of the project', 'Hand over', 'End session', 'End and archive…', 'Delete…']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.click(tree.getByRole('button', { name: /Manage Otto.s session/ }));
    const fromDots = await screen.findByRole('menu', { name: 'Manage Otto' });
    expect(menuLabels(fromDots)).toEqual(labels);
    await user.keyboard('{Escape}');
  });

  it('F2 on a principal\'s row opens its nickname as a field in place, its name beside it, as the menu\'s « Rename F2 » (docs/mockups/ledge-sidebar-names.html, card 2)', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: { ...CAN, sessionLabel: true } });
    const tree = treeOf(side);
    const field = () => tree.queryByRole('textbox', { name: /^Nickname for/ });
    const labels = () => sent(d).filter(m => m.type === 'session.label');

    // A subagent row, a finished session and an offline one: F2 opens nothing (the menu greys Rename for the last two).
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    await user.click(tree.getByRole('button', { name: /Show Otto.s subagents/ }));
    for (const name of [/^Explore/, /^Bix/, /^Rio/]) {
      tree.getByRole('button', { name }).focus();
      await user.keyboard('{F2}');
      expect(field()).toBeNull();
    }
    expect(screen.queryByRole('dialog')).toBeNull();

    // F2: an empty field, « Nickname for Otto » greyed, « (Otto) » beside it, the keys under it; the tree's own keys stay in the field.
    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('{F2}');
    const f = await waitFor(() => tree.getByRole('textbox', { name: 'Nickname for Otto' }));
    expect(f).toHaveValue('');
    expect(f).toHaveAttribute('placeholder', 'Nickname for Otto');
    expect(f).toHaveFocus();
    expect(f.parentElement).toHaveTextContent('(Otto)');
    expect(tree.getByText(/rename · /)).toBeInTheDocument();
    await user.keyboard('e');
    expect(f).toHaveValue('e');
    expect(archives(d)).toEqual([]);
    // Escape leaves it as it was, nothing sent, the row focused again.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(field()).toBeNull());
    expect(labels()).toEqual([]);
    await waitFor(() => expect(tree.getByRole('button', { name: /^Otto/ })).toHaveFocus());

    // From the menu: « Rename » opens the same field; Enter sends the nickname, trimmed.
    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(within(await screen.findByRole('menu', { name: 'Manage Otto' })).getByRole('menuitem', { name: 'Rename' }));
    await waitFor(() => tree.getByRole('textbox', { name: 'Nickname for Otto' }));
    await user.keyboard('  KB Projet 1 {Enter}');
    await waitFor(() => expect(labels()).toEqual([{ type: 'session.label', id: 'otto', label: 'KB Projet 1' }]));
    expect(field()).toBeNull();
  });

  it('a nickname shows before the name, « KB Projet 1 (Otto) »; F2 selects it, an emptied field removes it', async () => {
    const sessions = listSessions().map(s => (s.id === 'otto' ? { ...s, label: 'KB Projet 1' } : s));
    const { d, side, user } = await boot({ projects: PROJECTS, sessions, daemon: { ...CAN, sessionLabel: true } });
    const tree = treeOf(side);
    // Its row reads « KB Projet 1 (Otto) », for the screen reader as for the eye.
    const row = tree.getByRole('button', { name: /^KB Projet 1 \(Otto\)/ });
    expect(row.querySelector('.st-aname')).toHaveTextContent('KB Projet 1 (Otto)');
    expect(row.querySelector('.st-aname .sn-name')).toHaveTextContent('(Otto)');
    row.focus();
    await user.keyboard('{F2}');
    const f = await waitFor(() => tree.getByRole('textbox', { name: 'Nickname for Otto' }));
    expect(f).toHaveValue('KB Projet 1');
    expect([(f as HTMLInputElement).selectionStart, (f as HTMLInputElement).selectionEnd]).toEqual([0, 11]);
    await user.keyboard('{Backspace}{Enter}');
    await waitFor(() => expect(sent(d).filter(m => m.type === 'session.label')).toEqual([{ type: 'session.label', id: 'otto', label: '' }]));
  });

  it('a machine whose Ledge does not take session.label: the field says to update it and sends nothing', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('{F2}');
    await waitFor(() => tree.getByRole('textbox', { name: 'Nickname for Otto' }));
    expect(tree.getByRole('alert')).toHaveTextContent(/^Update Ledge on .+ to give this session a nickname\.$/);
    await user.keyboard('Revue{Enter}');
    expect(sent(d).some(m => m.type === 'session.label')).toBe(false);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(tree.queryByRole('textbox', { name: /^Nickname for/ })).toBeNull());
  });

  it('the row\'s terminal button is the menu\'s: Otto\'s page with its terminal pane, no external terminal', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.click(tree.getByRole('button', { name: /Open Otto.s terminal/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
    expect(sent(d).some(m => m.type === 'session.focus')).toBe(false);
  });

  it('the +N finished row only shows the finished sessions: no group Archive button', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    const more = tree.getByRole('button', { name: '+1 finished' }).closest('.st-more');
    expect(more).not.toBeNull();
    expect(within(more as HTMLElement).queryByRole('button', { name: /Archive/ })).toBeNull();
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();
    // Once shown, the row has nothing left to offer: it goes, and nothing was archived on the way.
    expect(tree.queryByRole('button', { name: '+1 finished' })).toBeNull();
    expect(side.getByRole('tree').querySelector('.st-more:not(.st-more-projects)')).toBeNull();
    expect(archives(d)).toEqual([]);
  });

  it('a machine without daemon.archive sends nothing', async () => {
    const { d, side, user } = await boot({
      projects: PROJECTS, sessions: listSessions(),
      daemon: { version: '0.7.0', install: 'npm', systemd: true }
    });
    const tree = treeOf(side);
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    tree.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('e');
    expect(archives(d)).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(said()).not.toMatch(/archived/);
  });
});
