import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Task } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { decisionOptions } from '../src/tasks/useTasksApi';

const T0 = new Date().toISOString();
/** A decision Otto put to the user (`ledge task give ledge …`): giver the session, owner Ledge. */
const decision = (extra: Partial<Task> = {}): Task => ({ id: 't00000d', title: 'Fusionner feat/roles ?', text: '- Oui, fusionne\n- Non, attends la revue', giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Otto', what: 'confiée à Ledge' }], ...extra });
const given = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [], ...extra });
/** The Tasks view (#40 D3): where a decision is answered on Desktop since « À toi » left (#40 PR 3). */
const view = () => within(screen.getByRole('complementary', { name: 'Tasks' }));
/** What « Répondre » may send: the registry action, never a task command. */
const answers = (received: readonly ClientMessage[]) => received.filter(m => m.type === 'action.run' || (m.type === 'task.cmd' && m.op !== 'list'));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

/** The IDE with Otto's decision, the Tasks view open on it. */
async function openDecision() {
  const env = await boot({ machines: [{ id: 'local', label: 'Local' }], projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })] });
  env.d.push({ type: 'task.updated', task: decision() });
  await env.user.click(within(screen.getByRole('navigation', { name: 'Activity bar' })).getByRole('button', { name: 'Tasks (Ctrl+/)' }));
  await env.user.click(await view().findByText('Fusionner feat/roles ?'));
  return env;
}

describe('a decision a session puts to the user', () => {
  it('« Answer » shows the answer whole, asks for a confirmation, then sends task.answer and nothing else', async () => {
    const { d, user } = await openDecision();
    const detail = within(view().getByRole('region', { name: 'Fusionner feat/roles ?' }));
    expect(detail.getByText('Otto needs your decision')).toBeVisible();
    await user.click(detail.getByRole('button', { name: 'Answer' }));
    const form = within(detail.getByRole('form', { name: 'Answer to “Fusionner feat/roles ?”' }));
    const field = form.getByRole('textbox', { name: 'Your answer' });
    expect(field).toHaveValue('');
    expect(form.getByRole('button', { name: 'Send the answer' })).toBeDisabled();
    // An option fills the field; the user still writes what goes.
    await user.click(form.getByRole('button', { name: 'Oui, fusionne' }));
    expect(field).toHaveValue('Oui, fusionne');
    await user.type(field, ' après la CI');
    await user.click(form.getByRole('button', { name: 'Send the answer' }));
    expect(form.getByText('Oui, fusionne après la CI')).toBeVisible();
    expect(form.getByText(/cannot be taken back/)).toBeVisible();
    expect(answers(d.received)).toEqual([]);
    d.onMessage(m => { if (m.type === 'action.run') d.push({ type: 'action.result', rid: m.rid, action: m.action, reason: 'task t00000d is closed', code: 'closed' }); });
    await user.click(form.getByRole('button', { name: 'Confirm and send' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Answer refused: task t00000d is closed');
    expect(answers(d.received)).toEqual([{ type: 'action.run', rid: expect.any(String), action: 'task.answer', args: { task: 't00000d', answer: 'Oui, fusionne après la CI' }, confirmed: true }]);
  });

  it('answered and closed by the daemon: it leaves the Tasks view\'s badge and turns done', async () => {
    const { d } = await openDecision();
    const icon = screen.getByRole('button', { name: 'Tasks (Ctrl+/)' });
    await waitFor(() => expect(icon.querySelector('.ide-badge.amber')).toHaveTextContent('1'));
    d.push({ type: 'task.updated', task: decision({ state: 'done', result: 'Non' }) });
    await waitFor(() => expect(icon.querySelector('.ide-badge')).toBeNull());
    expect(view().queryByRole('button', { name: 'Answer' })).toBeNull();
  });

  it('the Tasks view (#40 D3): « Decisions » keeps the decisions alone, « The sessions » no longer has them; an open one offers « Answer »; its icon counts it', async () => {
    const { d, user } = await boot({ machines: [{ id: 'local', label: 'Local' }], projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })] });
    d.push({ type: 'task.updated', task: decision() });
    d.push({ type: 'task.updated', task: given('t000001') });
    d.push({ type: 'task.updated', task: given('t000002', { giver: 'pim', giverName: 'Pim' }) });
    const icon = screen.getByRole('button', { name: 'Tasks (Ctrl+/)' });
    await waitFor(() => expect(icon.querySelector('.ide-badge.amber')).toHaveTextContent('1'));
    await user.click(icon);
    const view = () => within(screen.getByRole('complementary', { name: 'Tasks' }));
    const giver = view().getByRole('combobox', { name: 'Giver' });
    const titles = () => [...document.querySelectorAll('.rt-trow b')].map(b => b.textContent);
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.selectOptions(giver, 'decisions');
    expect(titles()).toEqual(['Fusionner feat/roles ?']);
    await user.selectOptions(giver, 'sessions');
    expect(titles()).toEqual(['Tâche t000002']);
    await user.selectOptions(giver, 'ledge');
    expect(titles()).toEqual(['Tâche t000001']);
    await user.selectOptions(giver, 'decisions');
    await user.click(view().getByText('Fusionner feat/roles ?'));
    const detail = within(await view().findByRole('region', { name: 'Fusionner feat/roles ?' }));
    await user.click(detail.getByRole('button', { name: 'Answer' }));
    expect(detail.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
  });
});

describe('decisionOptions', () => {
  it('reads one option per line, list marks left out; a single line offers none', () => {
    expect(decisionOptions('1. Oui\n2) Non\n\n* Plus tard')).toEqual(['Oui', 'Non', 'Plus tard']);
    expect(decisionOptions('Oui ou non ?')).toEqual([]);
    expect(decisionOptions(undefined)).toEqual([]);
  });
});
