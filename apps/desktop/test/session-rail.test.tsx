import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, ottoFolded, ottoThread } from './helpers';
import { PAST_EXCHANGES_KEY, reloadPastExchanges } from '../src/session/pastExchanges';
import { resetAvatarForTests, setAvatar } from '../src/shell/avatar';

afterEach(async () => { cleanup(); localStorage.clear(); resetAvatarForTests(); await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

/** Opens `name`'s page on `items`; `helpers`: its live subagents (the others in the thread are gone, finished). */
async function open(name: string, id: string, items: ThreadItem[], helpers?: Session['helpers']) {
  const env = await boot({ sessions: listSessions().map(s => (s.id === id && helpers ? { ...s, helpers } : s)), list: true });
  env.d.thread(id, items);
  await env.user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
  await thread().findAllByRole('listitem');
  return env;
}

describe('the thread (issues #34, #41)', () => {
  it('« Past exchanges » open (#41): a past exchange shows all its work, without a « Work » fold', async () => {
    localStorage.setItem(PAST_EXCHANGES_KEY, 'open'); reloadPastExchanges();
    try {
      await open('Otto', 'otto', ottoFolded());
      expect(document.querySelector('.cw-work')).toBeNull();
      expect(thread().getByText('Je lance les tests.')).toBeVisible();
      expect(thread().getByText('Deux tests échouent.')).toBeVisible();
    } finally { localStorage.removeItem(PAST_EXCHANGES_KEY); reloadPastExchanges(); }
  });

  it('a session that waits on you says so under its last exchange, and its exchange does not end', async () => {
    await open('Otto', 'otto', ottoThread());
    expect(await thread().findByText(/Otto is waiting for your approval of a command\./)).toHaveTextContent('The thread resumes after your answer.');
    expect(document.querySelector('.turn.current .end-row')).toBeNull();
  });

  it('an exchange that ended counts its actions and files; a failure caught up after is « recovered »', async () => {
    await open('Bix', 'bix', [
      { kind: 'prompt', id: 'p', at: ago(120), turn: 1, text: 'Relis la PR' },
      { kind: 'tool', id: 'a', at: ago(110), turn: 1, tool: 'Bash', label: 'npm test', status: 'failed', durationMs: 900, error: 'exit 1', files: [] },
      { kind: 'tool', id: 'b', at: ago(100), turn: 1, tool: 'Edit', label: '/w/ledge/src/a.ts', status: 'success', durationMs: 100, files: [{ path: '/w/ledge/src/a.ts', change: 'edit', diff: '- a\n+ b' }] },
      { kind: 'reply', id: 'r', at: ago(90), turn: 1, text: 'Corrigé.' }
    ]);
    const end = document.querySelector('.turn.current .end-row')!;
    expect(end.querySelector('.end-text')).toHaveTextContent('End of the exchange · 1 failed, recovered · 2 actions · 1 file changed');
    expect(end.querySelector('.end-failed')).toHaveTextContent(/^1 failed$/);
  });

  it('each subagent launched is a row of its own, with its state, that opens its thread (#41)', async () => {
    await open('Nova', 'nova', [
      { kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: 'Explore' },
      { kind: 'helper', id: 'h1', at: ago(50), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'exited' },
      { kind: 'helper', id: 'h2', at: ago(49), turn: 1, task: 'Lire les tests', agentType: 'Plan', state: 'working' }
    ], [{ id: 'h2', kind: 'Plan', task: 'Lire les tests', state: 'working' }]);
    const rows = [...document.querySelectorAll<HTMLElement>('.cw-col .cw-helper')];
    expect(rows.map(r => r.getAttribute('data-helper'))).toEqual(['h1', 'h2']);
    expect(rows[0]).toHaveTextContent('ExploreLire le code');
    expect(rows[0]!.querySelector('[data-badge]')).toHaveAttribute('data-badge', 'done');
    expect(rows[1]!.querySelector('[data-badge]')).not.toHaveAttribute('data-badge', 'done');
    expect(thread().getByRole('button', { name: "Open Plan's thread" })).toBe(rows[1]);
  });

  it('your prompt is a bubble with no disc, photo or user icon (#41: no avatar in the thread)', async () => {
    await open('Bix', 'bix', [{ kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: 'Relis la PR' }]);
    act(() => setAvatar('data:image/webp;base64,UklGRg=='));
    const prompt = thread().getByText('Relis la PR').closest<HTMLElement>('.prompt-row')!;
    expect(prompt.querySelector('img, .av, .n')).toBeNull();
  });

  it('a <task-notification> opens its exchange as a task card, its notification folded', async () => {
    const text = '<task-notification>\n<task-id>b7x</task-id>\n<status>killed</status>\n<summary>Agent "Explore" was stopped</summary>\n</task-notification>';
    await open('Nova', 'nova', [{ kind: 'prompt', id: 'p', at: ago(60), turn: 1, text }]);
    const card = document.querySelector<HTMLElement>('.task-card')!;
    expect(card.querySelector('[data-badge]')).toHaveTextContent('Stopped');
    expect(card.querySelector('.task-text')).toHaveTextContent('The agent Explore was stopped. It can resume if you write to it.');
    expect(card.querySelector('details.raw')).not.toHaveAttribute('open');
    expect(thread().queryByText('You')).toBeNull();
  });

  it('Story and Objective: tags on the prompt and the page heading; an agent that notes another objective gets a row', async () => {
    await open('Nova', 'nova', [
      { kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: '[synapse-obs] story=ST7-123 objectif=analyse\nRegarde le ticket' },
      { kind: 'reply', id: 'r', at: ago(50), turn: 1, text: '[synapse-obs] objectif=implementation\nJe m’y mets.' }
    ]);
    const prompt = thread().getByText('Regarde le ticket').closest<HTMLElement>('.prompt-block')!;
    expect(prompt).not.toHaveTextContent('synapse-obs');
    expect([...prompt.querySelectorAll('.tag')].map(t => t.textContent)).toEqual(['Story ST7-123', 'Objective Analysis']);
    expect(document.querySelector('.objective-row .objective')).toHaveTextContent('Session objectiveAnalysisImplementation· noted by Nova');
    // The IDE has no page heading (lot 12b): the tab's menu says the tags.
    fireEvent.contextMenu(screen.getAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === 'Nova')!);
    await waitFor(() => expect([...document.querySelectorAll('.session-menu-head small')].map(x => x.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('ST7-123'), expect.stringContaining('Implementation')])));
    expect(thread().getByText('Je m’y mets.')).toBeVisible();
  });

  it('a past exchange kept open by an action still running neither ends nor shows its files until it stops (#41 review)', async () => {
    const edit = { kind: 'tool' as const, id: 'e', at: ago(110), turn: 1, tool: 'Edit', label: '/w/ledge/a.ts', status: 'success' as const, durationMs: 100, files: [{ path: '/w/ledge/a.ts', change: 'edit' as const, diff: '- a\n+ b' }] };
    const bg = { kind: 'tool' as const, id: 'bg', at: ago(105), turn: 1, tool: 'Bash', label: 'npm run watch', status: 'running' as const, files: [] };
    const { d } = await open('Bix', 'bix', [
      { kind: 'prompt', id: 'p1', at: ago(120), turn: 1, text: 'Lance la veille' }, edit, bg,
      { kind: 'reply', id: 'r1', at: ago(100), turn: 1, text: 'Lancée.' },
      { kind: 'prompt', id: 'p2', at: ago(60), turn: 2, text: 'Et ensuite ?' }, { kind: 'reply', id: 'r2', at: ago(50), turn: 2, text: 'On attend.' }
    ]);
    const past = () => thread().getByText('Lance la veille').closest<HTMLElement>('.turn')!;
    expect(past().querySelector('.end-row')).toBeNull();
    expect(past().querySelector('.cw-files')).toBeNull();
    d.threadItem('bix', { ...bg, status: 'success', durationMs: 4000 });
    await waitFor(() => expect(past().querySelector('.cw-files')).not.toBeNull());
  });

  it('an action that fails after it showed opens its output (#41 review)', async () => {
    const run = { kind: 'tool' as const, id: 't', at: ago(30), turn: 1, tool: 'Bash', label: 'npm test', status: 'running' as const, files: [] };
    const { d } = await open('Bix', 'bix', [{ kind: 'prompt', id: 'p', at: ago(40), turn: 1, text: 'Teste' }, run, { kind: 'tool', id: 'u', at: ago(20), turn: 1, tool: 'Read', label: '/w/ledge/a.ts', status: 'running', files: [] }]);
    expect(document.querySelector('[data-tool="t"]')).not.toBeNull();
    d.threadItem('bix', { ...run, status: 'failed', durationMs: 900, error: 'exit 1' });
    await waitFor(() => expect(document.querySelector('[data-tool="t"] .action-output')).toHaveTextContent('exit 1'));
  });

  it('an exchange that ends on actions alone still shows the files it changed (#41 review)', async () => {
    await open('Bix', 'bix', [
      { kind: 'prompt', id: 'p', at: ago(40), turn: 1, text: 'Corrige' },
      { kind: 'tool', id: 'e', at: ago(30), turn: 1, tool: 'Edit', label: '/w/ledge/a.ts', status: 'success', durationMs: 100, files: [{ path: '/w/ledge/a.ts', change: 'edit', diff: '- a\n+ b' }] }
    ]);
    expect(document.querySelector('.turn.current .cw-files')).toHaveTextContent('a.ts+1−1');
  });

  it('a subagent at work shows its running action in place of its task; done, how many actions and how long (#41 review)', async () => {
    const { d } = await open('Nova', 'nova', [
      { kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: 'Explore' },
      { kind: 'helper', id: 'h1', at: ago(50), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'working' },
      { kind: 'tool', id: 'h-a', at: ago(45), turn: 1, helperId: 'h1', tool: 'Read', label: '/w/ledge/src/App.tsx', status: 'success', durationMs: 2000, files: [] },
      { kind: 'tool', id: 'h-b', at: ago(40), turn: 1, helperId: 'h1', tool: 'Grep', label: 'useKeys', status: 'running', files: [] }
    ], [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }]);
    const row = () => document.querySelector<HTMLElement>('.cw-helper[data-helper="h1"]')!;
    expect(row().querySelector('.cw-helper-doing')).toHaveTextContent('Search useKeys');
    expect(row()).toHaveAttribute('title', 'Lire le code');
    expect(row().querySelector('.cw-helper-tally')).toBeNull();
    d.threadItem('nova', { kind: 'tool', id: 'h-b', at: ago(40), turn: 1, helperId: 'h1', tool: 'Grep', label: 'useKeys', status: 'success', durationMs: 1000, files: [] });
    d.upsert({ ...listSessions().find(x => x.id === 'nova')!, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'exited' }] });
    await waitFor(() => expect(row().querySelector('.cw-helper-tally')).toHaveTextContent('2 actions · 3.0 s'));
    expect(row()).toHaveTextContent('Lire le code');
  });
});
