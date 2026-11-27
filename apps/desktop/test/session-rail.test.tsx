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
});
