import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../../src/i18n/lang';
import type { Decisions } from '../../src/fleet/decisions';
import { createSessionMemory } from '../../src/session/memory';
import { Reply } from '../../src/session/Reply';
import { Thread } from '../../src/session/Thread';
import { failAsking, resetAsidesForTests } from '../../src/session/asides';

// Ledge Desktop or not, and what the voice command was asked.
const voice = vi.hoisted(() => ({ available: false, calls: 0 }));
vi.mock('../../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/tauri/bridge')>()),
  canVoiceType: () => voice.available,
  voiceTyping: async () => { voice.calls++; return true; }
}));

/** A client whose local daemon takes asides or not (DaemonInfo.aside). */
function fakeClient(aside: boolean) {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true, aside } }];
  const client = {
    send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; },
    fleet: { machines: () => machines, subscribe: () => () => {}, contextNear: () => 0.8 }
  } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => { fns.forEach(fn => fn(m)); }) };
}

/** The reply field of an IDE tab (with the session bar's stand-in in its bottom row) and, under `thread`, the thread with its asides. */
function shown(extra: Partial<Session> = {}, { aside = true, thread = false } = {}) {
  const env = fakeClient(aside);
  const session = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', ...extra });
  const decisions = { busy: () => false, reply: vi.fn(() => true), decide: vi.fn(() => true), answer: vi.fn() } as unknown as Decisions;
  const keys = { current: null };
  render(
    <LangProvider lang="en">
      {thread && <Thread client={env.client} session={session} helper={null} items={[]} xs={[]} now={Date.now()} unread={null} since="" dispatch={() => {}} flash={null}
        onChange={() => {}} onDocument={() => {}} planOpen={null} onPlan={() => {}} convOpen={null} onTerminal={onTerminal} />}
      <Reply session={session} helper={null} asker="Otto" since="" decisions={decisions} memory={createSessionMemory()} memoKey="otto" notify={() => {}} dispatch={() => {}}
        focusOnArrival={false} keys={keys} onReadPlan={() => {}} client={env.client} modelChip={false} ide bar={<span className="test-bar">Sonnet 5.5 · feat/x</span>} />
    </LangProvider>
  );
  return { ...env, decisions, user: userEvent.setup() };
}
const onTerminal = vi.fn();
const field = () => screen.getByRole('textbox', { name: 'Reply to the agent' });
const row = () => document.querySelector<HTMLElement>('.cw-tools')!;

afterEach(() => { cleanup(); localStorage.clear(); resetAsidesForTests(); onTerminal.mockReset(); voice.available = false; voice.calls = 0; });

describe('the reply field\'s bottom row (#41)', () => {
  it('carries the session bar, the voice and one round button that sends what is typed', async () => {
    const { user, decisions } = shown();
    expect(row().querySelector('.cw-bar-slot .test-bar')).toHaveTextContent('Sonnet 5.5 · feat/x');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(field(), 'Relis la PR');
    expect(send).toBeEnabled();
    await user.click(send);
    expect(decisions.reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'otto' }), 'Relis la PR', expect.any(Function), expect.anything());
  });

  it('with nothing typed, the round button interrupts the agent at work; typed, it sends', async () => {
    const { user, sent } = shown({ state: 'working' });
    await user.click(screen.getByRole('button', { name: 'Interrupt Otto' }));
    expect(sent).toContainEqual({ type: 'session.interrupt', id: 'otto' });
    await user.type(field(), 'x');
    expect(screen.queryByRole('button', { name: 'Interrupt Otto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('OMP keeps its own stop, which gives its queue back, also while it waits; « stop requested » meanwhile', async () => {
    const { user, sent } = shown({ tool: 'omp', backend: 'omp-rpc', state: 'waiting_input' } as Partial<Session>);
    await user.click(screen.getByRole('button', { name: 'Stop Otto' }));
    expect(sent).toContainEqual({ type: 'session.interrupt', id: 'otto', restoreQueue: true });
    expect(screen.getByRole('button', { name: 'Stop requested…' })).toBeDisabled();
  });

  it('a field shut (a question with options on Codex: the digits only) disables send and voice and keeps its hint', () => {
    shown({ tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Which one?', options: ['A', 'B'], source: 'pane' } } as Partial<Session>);
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeDisabled();
    expect(document.querySelector('.reply-hint')).toHaveTextContent('Choose one of the proposed answers (1–9).');
  });

  it('the voice button: outside Ledge Desktop greyed, and says why', () => {
    shown();
    const mic = screen.getByRole('button', { name: 'Dictate' });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute('title', 'Dictation is only available in Ledge Desktop.');
  });

  it('the voice button in Ledge Desktop toggles Windows\' voice typing and leaves the focus in the field (Windows writes there)', async () => {
    voice.available = true;
    const { user } = shown();
    const mic = screen.getByRole('button', { name: 'Dictate' });
    expect(mic).toHaveAttribute('title', 'Dictate (Win+H) · Windows voice typing');
    await user.click(field());
    await user.click(mic);
    expect(voice.calls).toBe(1);
    expect(field()).toHaveFocus();
    // No state of its own: Ledge cannot tell whether Windows listens.
    expect(mic).not.toHaveAttribute('aria-pressed');
  });
});

describe('a subagent\'s page (#41)', () => {
  it('no field: the note says replies go through the parent, beside the provider\'s flat logo, not the mascot', () => {
    const env = fakeClient(true);
    const session = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' });
    const decisions = { busy: () => false, reply: vi.fn(), decide: vi.fn(), answer: vi.fn() } as unknown as Decisions;
    render(
      <LangProvider lang="en">
        <Reply session={session} helper={{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'working' }} asker="Explore" since="" decisions={decisions} memory={createSessionMemory()} memoKey="otto"
          notify={() => {}} dispatch={() => {}} focusOnArrival={false} keys={{ current: null }} onReadPlan={() => {}} client={env.client} modelChip={false} ide />
      </LangProvider>
    );
    const note = document.querySelector<HTMLElement>('.reply-note')!;
    expect(note).toHaveTextContent('Replies to Explore go through Otto, who started it.');
    expect(note.querySelector('.logo-bot')).not.toBeNull();
    expect(note.querySelector('.bot:not(.logo-bot)')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Reply to the agent' })).toBeNull();
  });
});

describe('« /btw »: an aside (#41)', () => {
  it('on Claude Code, the frame says so; Enter asks the daemon; the answer shows under the thread, outside it', async () => {
    const { user, sent, emit } = shown({}, { thread: true });
    await user.type(field(), '/btw WebGL 1 or 2?');
    expect(row()).toHaveClass('btw');
    expect(row()).toHaveTextContent('btwAside: Otto answers without stopping, outside the thread');
    expect(row().querySelector('.cw-bar-slot')).toBeNull();
    await user.keyboard('{Enter}');
    const ask = sent.find(m => m.type === 'session.aside') as Extract<ClientMessage, { type: 'session.aside' }>;
    expect(ask).toMatchObject({ id: 'otto', question: 'WebGL 1 or 2?' });
    expect(field()).toHaveValue('');
    const card = () => document.querySelector<HTMLElement>('.cw-aside')!;
    expect(card()).toHaveTextContent('Aside · outside the thread, Otto keeps working');
    expect(card()).toHaveTextContent('Otto is answering aside…');
    // Meanwhile the daemon takes no other text: send waits.
    await user.type(field(), 'next');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    const askedAt = new Date().toISOString();
    emit({ type: 'session.aside', id: 'otto', aside: { rid: 'someone-else', question: 'x', askedAt, state: 'answered', answer: 'not ours' } } as ServerMessage);
    expect(card()).not.toHaveTextContent('not ours');
    emit({ type: 'session.aside', id: 'otto', aside: { rid: ask.rid, question: 'WebGL 1 or 2?', askedAt, state: 'answered', answer: 'WebGL **2**.' } } as ServerMessage);
    expect(card().querySelector('.cw-aside-a')).toHaveTextContent('WebGL 2.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Close the aside' }));
    expect(document.querySelector('.cw-aside')).toBeNull();
  });

  it('an aside Ledge could not read points to the Terminal view', async () => {
    const { user, sent, emit } = shown({}, { thread: true });
    await user.type(field(), '/btw why?{Enter}');
    const { rid } = sent.find(m => m.type === 'session.aside') as Extract<ClientMessage, { type: 'session.aside' }>;
    emit({ type: 'session.aside', id: 'otto', aside: { rid, question: 'why?', askedAt: new Date().toISOString(), state: 'failed', cause: 'unreadable' } } as ServerMessage);
    expect(document.querySelector('.cw-aside-failed')).toHaveTextContent('Ledge could not read the answer: it is in Otto’s terminal.');
    await user.click(screen.getByRole('button', { name: 'Open the Terminal view' }));
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('is no aside on another harness, on a daemon that takes none, or while a request is open: no dashed frame', async () => {
    const codex = shown({ tool: 'codex' });
    await codex.user.type(field(), '/btw why?');
    expect(row()).not.toHaveClass('btw');
    cleanup();
    const old = shown({}, { aside: false });
    await old.user.type(field(), '/btw why?');
    expect(row()).not.toHaveClass('btw');
    cleanup();
    const asked = shown({ state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } } as Partial<Session>);
    await asked.user.type(field(), '/btw why?');
    expect(row()).not.toHaveClass('btw');
    expect(asked.sent.some(m => m.type === 'session.aside')).toBe(false);
  });

  it('while an aside is answered, send waits and says why; stopping stays', async () => {
    const { user } = shown({ state: 'working' }, { thread: true });
    await user.type(field(), '/btw why?{Enter}');
    expect(document.querySelector('.reply-hint')).toHaveTextContent('Otto is answering aside: you can send once it has answered.');
    expect(screen.getByRole('button', { name: 'Interrupt Otto' })).toBeEnabled();
    await user.type(field(), 'next');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('title', 'Otto is answering aside: you can send once it has answered.');
  });

  it.each([
    ['not_empty', 'Unsent text is waiting in Otto’s terminal: the aside was not asked. Send or clear that text, then ask again.', true],
    ['busy', 'Otto cannot take an aside right now: ask again in a moment.', true],
    ['no_panel', 'Otto did not open the aside: nothing was answered. This Claude Code may not know /btw.', true],
    ['timeout', 'The answer took too long: it may be incomplete, in Otto’s terminal.', true],
    ['interrupted', 'The aside was cut off before the answer, by a request or by Otto stopping.', true],
    ['invalid', 'The aside did not go through.', true],
    ['read_only', 'The aside did not go through: Ledge cannot type /btw into this session.', false]
  ] as const)('a failed aside says why by its cause: %s', async (cause, text, link) => {
    const { user, sent, emit } = shown({}, { thread: true });
    await user.type(field(), '/btw why?{Enter}');
    const { rid } = sent.find(m => m.type === 'session.aside') as Extract<ClientMessage, { type: 'session.aside' }>;
    emit({ type: 'session.aside', id: 'otto', aside: { rid, question: 'why?', askedAt: new Date().toISOString(), state: 'failed', cause } } as ServerMessage);
    expect(document.querySelector('.cw-aside-failed')).toHaveTextContent(text);
    expect(screen.queryByRole('button', { name: 'Open the Terminal view' }) !== null).toBe(link);
  });

  it('an answer cut short says the rest is in the terminal', async () => {
    const { user, sent, emit } = shown({}, { thread: true });
    await user.type(field(), '/btw why?{Enter}');
    const { rid } = sent.find(m => m.type === 'session.aside') as Extract<ClientMessage, { type: 'session.aside' }>;
    emit({ type: 'session.aside', id: 'otto', aside: { rid, question: 'why?', askedAt: new Date().toISOString(), state: 'answered', answer: 'Because…', truncated: true } } as ServerMessage);
    expect(document.querySelector('.cw-aside-cut')).toHaveTextContent('Answer cut short: the rest is in Otto’s terminal.');
  });

  it('an aside still waiting when its machine goes offline fails, without the Terminal link', async () => {
    const { user } = shown({}, { thread: true });
    await user.type(field(), '/btw why?{Enter}');
    act(() => failAsking('otto'));
    expect(document.querySelector('.cw-aside-failed')).toHaveTextContent(/^The connection to .+ dropped before the answer: check Otto’s terminal once reconnected\.$/);
    expect(screen.queryByRole('button', { name: 'Open the Terminal view' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('title');
  });
});
