import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import WebSocket from 'ws';
import { DEFAULT_ISLAND_PREFS, type IslandPrefs, type Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { resetSoundPrefsForTests } from '../src/sounds/preferences';
import { subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';
import { localIslandPrefs } from '../src/island';
import { setFrame } from '../src/tauri/bridge';
import { App } from '../src/App';

const monitors = [
  { id: '\\\\.\\DISPLAY1', name: null, width: 1920, height: 1080, workH: 1032, primary: true },
  { id: '\\\\.\\DISPLAY2', name: null, width: 2560, height: 1440, workH: 1400, primary: false }
];
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), setFrame: vi.fn(async () => true), listMonitors: vi.fn(async () => monitors) }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const surface = () => document.querySelector('[data-surface]') as HTMLElement | null;
const island = () => document.querySelector('.di-island') as HTMLElement | null;
const card = () => document.querySelector('.di-card') as HTMLElement;
const prefs = (extra: Partial<IslandPrefs> = {}, shows: Partial<IslandPrefs['shows']> = {}): IslandPrefs => ({ ...DEFAULT_ISLAND_PREFS, ...extra, shows: { ...DEFAULT_ISLAND_PREFS.shows, ...shows } });

describe('the island on a daemon (issue #27)', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>; let detach: () => void;
  const pim = (extra: Partial<Session> = {}) => fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', branch: 'chore/deps', ...extra });
  const pimAsks = (extra: Partial<Session> = {}) => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm up --latest && pnpm test', tool: 'Bash', source: 'hook' }, ...extra });
  const pimQuestion = () => pim({ state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
  const draw = (p: Partial<Parameters<typeof Surface>[0]> = {}) => <Surface screenH={1080} screenW={1920} client={client} dnd={false} {...p} />;
  /** The daemon says something, then the island opens (the unit suite runs with reduced motion: `VITE_LEDGE_MOTION=0`). */
  const say = async (s: Session) => { await act(async () => { mock.upsert(s); await sleep(50); }); await act(async () => { vi.advanceTimersByTime(300); await sleep(10); }); };
  const sent = (type: string) => mock.received.filter(m => m.type === type);
  let opened: LedgeTarget[] = []; let off = () => {};
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear(); resetSoundPrefsForTests(); vi.mocked(setFrame).mockClear();
    opened = []; off = subscribeOpenInLedge(t => opened.push(t));
    daemonStore.reset(); mock = await createMockDaemon();
    mock.sessions.set('b', pim());
    client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    await sleep(100);
  });
  afterEach(async () => { off(); cleanup(); detach(); client.close(); await mock.close(); vi.useRealTimers(); });

  it('rests with nothing on screen', () => {
    render(draw());
    expect(island()).toBeNull();
    expect(surface()).toHaveAttribute('data-phase', 'gone');
  });

  it('a finished turn: the provider’s logo, « Done », the sentence, project and branch, the start of the last reply, a ring that empties; a click opens it in Ledge', async () => {
    render(draw());
    await say(pim({ state: 'idle', lastReply: { text: 'All **14 tests** pass,\n\nthe PR is ready.', at: '2026-10-09T18:00:00.000Z' } }));
    expect(island()).toHaveAttribute('data-phase', 'open');
    expect(island()).toHaveAttribute('data-kind', 'finished');
    expect(card()).toHaveTextContent('DonePim finished');
    expect(card()).toHaveTextContent('speos-api · chore/deps');
    expect(card().querySelector('.di-preview')).toHaveTextContent('All 14 tests pass, the PR is ready.');
    expect(card().querySelector('.logo')).toHaveAttribute('title', 'OpenAI');
    expect(card().querySelector('[data-ring]')).toHaveAttribute('data-running', 'true');
    // The hover holds the ring.
    fireEvent.mouseEnter(island()!);
    expect(card().querySelector('[data-ring]')).not.toHaveAttribute('data-running');
    fireEvent.click(screen.getByRole('button', { name: 'Open Pim in Ledge' }));
    expect(opened).toEqual([{ kind: 'session', id: 'b' }]);
    expect(surface()).toHaveAttribute('data-closing', 'true');
  });

  it('a notice closes on its own after 6 s, then leaves', async () => {
    render(draw());
    await say(pim({ state: 'idle' }));
    await act(async () => { vi.advanceTimersByTime(5500); await sleep(10); });
    expect(island()).toHaveAttribute('data-phase', 'open');
    await act(async () => { vi.advanceTimersByTime(1000); await sleep(10); });
    expect(island()).toBeNull();
  });

  it('finished off: a turn that ends opens nothing', async () => {
    render(draw({ shows: prefs({}, { finished: false }).shows }));
    await say(pim({ state: 'idle' }));
    expect(island()).toBeNull();
  });

  it('an error: « Error » and its message in mono; a refused decision is said on its request, not as an error', async () => {
    render(draw());
    await say(pim({ state: 'error', lastError: 'ECONNREFUSED 127.0.0.1:7317' }));
    expect(island()).toHaveAttribute('data-kind', 'error');
    expect(card()).toHaveTextContent('ErrorPim stopped on an error');
    expect(card().querySelector('.di-preview')).toHaveAttribute('data-mono', 'true');
    expect(card().querySelector('.di-preview')).toHaveTextContent('ECONNREFUSED 127.0.0.1:7317');
  });

  it('a permission: the coral card, its command under its tool, Allow (Y) sends the decision; « Sent, waiting for the terminal », then « Received », then it closes', async () => {
    render(draw());
    await say(pimAsks());
    expect(island()).toHaveAttribute('data-kind', 'permission');
    expect(card()).toHaveTextContent('ApprovalPim wants to run a command');
    expect(card().querySelector('.di-command')).toHaveTextContent('Bashpnpm up --latest && pnpm test');
    expect(screen.getByRole('button', { name: 'Open in Ledge O' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later Esc' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'y' });
    await act(async () => { await sleep(50); });
    expect(sent('session.decide')).toEqual([{ type: 'session.decide', id: 'b', decision: 'accept' }]);
    expect(card()).toHaveTextContent('Sent, waiting for the terminal');
    expect(screen.getByRole('button', { name: 'Allow Y' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Later Esc' })).toBeNull();
    // Nothing settles an unconfirmed decision: it waits for the terminal.
    await act(async () => { vi.advanceTimersByTime(2000); await sleep(10); });
    expect(island()).toHaveAttribute('data-phase', 'open');
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); });
    expect(card()).toHaveTextContent('Received');
    await act(async () => { vi.advanceTimersByTime(900); await sleep(10); });
    expect(surface()).toHaveAttribute('data-closing', 'true');
  });

  it('N denies; a refusal from the daemon says why in red, and the buttons unlock', async () => {
    render(draw());
    await say(pimAsks());
    fireEvent.keyDown(window, { key: 'n' });
    await act(async () => { await sleep(50); });
    expect(sent('session.decide')).toEqual([{ type: 'session.decide', id: 'b', decision: 'deny' }]);
    await act(async () => { mock.upsert(pimAsks({ state: 'error', lastError: 'injection not confirmed' })); await sleep(50); });
    const note = card().querySelector('.di-note[data-tone="bad"]');
    expect(note).toHaveTextContent('injection not confirmed. Try again or open the session.');
    expect(screen.getByRole('button', { name: 'Allow Y' })).toBeEnabled();
    expect(island()).toHaveAttribute('data-kind', 'permission');
  });

  it('a tool other than Bash names itself; a long name is cut, whole in its title', async () => {
    render(draw());
    await say(pimAsks({ pending: { kind: 'permission', text: 'notes/plan.md', tool: 'mcp__claude_ai_Notion__notion-update-page', source: 'hook' } }));
    const chip = card().querySelector('.di-chip-k')!;
    expect(chip).toHaveTextContent('mcp__claude_ai_Notion__notion-update-page');
    expect(chip).toHaveAttribute('title', 'mcp__claude_ai_Notion__notion-update-page');
  });

  it('a question: its text, the proposed answers (1-9), a field; Reply with nothing says so; a choice is sent', async () => {
    render(draw());
    await say(pimQuestion());
    expect(card()).toHaveTextContent('QuestionPim asks you a question');
    expect(card()).toHaveTextContent('Which strategy?');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an answer or write one.');
    expect(sent('session.reply')).toEqual([]);
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: '2 Shadow table' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await act(async () => { await sleep(50); });
    expect(sent('session.reply')).toEqual([{ type: 'session.reply', id: 'b', text: 'Shadow table' }]);
  });

  it('a question answered in a few words: Enter in the field sends them', async () => {
    render(draw());
    await say(pimQuestion());
    const field = screen.getByRole('textbox', { name: 'Or answer in a few words…' });
    fireEvent.change(field, { target: { value: 'Both, backfill first' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await act(async () => { await sleep(50); });
    expect(sent('session.reply')).toEqual([{ type: 'session.reply', id: 'b', text: 'Both, backfill first' }]);
  });

  it('a plan: « Plan to approve », its title after the sentence, Review in Ledge; a diff: « To review », its summary in mono', async () => {
    render(draw());
    await say(pim({ state: 'waiting_input', pending: { kind: 'plan', text: 'Relay queue\n\n1. …', source: 'hook' } }));
    expect(island()).toHaveAttribute('data-kind', 'plan');
    expect(card()).toHaveTextContent('Plan to approvePim proposes a plan · Relay queue');
    fireEvent.click(screen.getByRole('button', { name: 'Review in Ledge' }));
    expect(opened).toEqual([{ kind: 'session', id: 'b' }]);
    cleanup();
    render(draw());
    await say(pim({ state: 'waiting_input', pending: { kind: 'diff', text: '3 files · +42 −7', source: 'hook' } }));
    expect(card()).toHaveTextContent('To reviewPim has changes for you to review');
    expect(card().querySelector('.di-preview')).toHaveAttribute('data-mono', 'true');
    expect(card().querySelector('.di-preview')).toHaveTextContent('3 files · +42 −7');
  });

  it('quick off: a permission keeps its command, one Open in Ledge (O) and Later; Y sends nothing', async () => {
    render(draw({ shows: prefs({}, { quick: false }).shows }));
    await say(pimAsks());
    expect(card().querySelector('.di-command')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Deny/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Open in Ledge/ })).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'y' });
    await act(async () => { await sleep(50); });
    expect(sent('session.decide')).toEqual([]);
    fireEvent.keyDown(window, { key: 'o' });
    expect(opened).toEqual([{ kind: 'session', id: 'b' }]);
  });

  it('quick off: a question keeps its text, without answers nor field', async () => {
    render(draw({ shows: prefs({}, { quick: false }).shows }));
    await say(pimQuestion());
    expect(card()).toHaveTextContent('Which strategy?');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('read only: the reason under the content; Allow and Deny off, Open in Ledge and Later still work', async () => {
    render(draw());
    await say(pimAsks({ source: 'hook_only' }));
    expect(card().querySelector('.di-note')).toHaveTextContent('Read only: started without Ledge, answer in its terminal');
    expect(screen.getByRole('button', { name: 'Allow Y' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny N' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Later Esc' }));
    expect(surface()).toHaveAttribute('data-closing', 'true');
  });

  it('others waiting: « +1 more » after the branch, « Later, next », and the island reopens on the next', async () => {
    mock.sessions.set('c', fakeSession('c', { name: 'Bix', state: 'working' }));
    render(draw());
    await say(pimAsks());
    await act(async () => { mock.upsert(fakeSession('c', { name: 'Bix', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', source: 'hook' } })); await sleep(50); });
    expect(card()).toHaveTextContent('speos-api · chore/deps · +1 more');
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(320); await sleep(10); vi.advanceTimersByTime(300); await sleep(10); });
    expect(island()).toHaveAttribute('data-phase', 'open');
    expect(card()).toHaveTextContent('Bix wants to run a command');
  });

  it('Do not disturb: nothing opens', async () => {
    render(draw({ dnd: true }));
    await say(pimAsks());
    expect(island()).toBeNull();
  });

  it('hidden: nothing drawn and no region; a request that came meanwhile opens once it is shown again', async () => {
    const { rerender } = render(draw({ visible: false }));
    expect(surface()).toBeNull();
    expect(vi.mocked(setFrame).mock.calls.at(-1)?.[0]).toEqual({ left: 0, top: 0, w: 0, h: 0 });
    await say(pimAsks());
    expect(surface()).toBeNull();
    rerender(draw());
    await act(async () => { vi.advanceTimersByTime(300); await sleep(10); });
    expect(island()).toHaveAttribute('data-phase', 'open');
    expect(within(card()).getByText('Pim')).toBeInTheDocument();
  });
});

/** The local daemon's socket, driven by the test: it opens at once and records what the island sends. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0; sent: { type: string; prefs?: IslandPrefs }[] = [];
  constructor(readonly url: string) { FakeSocket.all.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const local = () => FakeSocket.all.find(s => s.url.includes('47831'))!;
const islandSets = () => local().sent.filter(m => m.type === 'island.set');
async function boot() {
  render(<App />);
  await act(async () => { await sleep(20); });
  await act(async () => { local().push({ type: 'snapshot', sessions: [] }); await sleep(20); });
}
const speak = async (p: IslandPrefs | null) => { await act(async () => { local().push({ type: 'island', prefs: p }); await sleep(20); }); };

describe('App and the daemon’s island settings', () => {
  beforeEach(() => { FakeSocket.all = []; vi.stubGlobal('WebSocket', FakeSocket); localStorage.clear(); localStorage.setItem('desktop.lang', 'en'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('the island’s own values, a chosen monitor by its id', () => {
    localStorage.setItem('ledge.islandPosition', 'left'); localStorage.setItem('ledge.monitor', 'X');
    localStorage.setItem('ledge.handleScale', '1.5'); localStorage.setItem('ledge.panelScale', '2');
    expect(localIslandPrefs()).toEqual(prefs({ position: 'left', screen: 'X', islandScale: 1.5, panelScale: 2 }));
    localStorage.clear();
    expect(localIslandPrefs()).toEqual(DEFAULT_ISLAND_PREFS);
  });

  it('a daemon that holds none gets the island’s own values, once', async () => {
    localStorage.setItem('ledge.islandPosition', 'right'); localStorage.setItem('ledge.handleScale', '1.25');
    await boot();
    await speak(null);
    expect(islandSets()).toEqual([{ type: 'island.set', prefs: prefs({ position: 'right', islandScale: 1.25 }) }]);
    await speak(null);
    expect(islandSets()).toHaveLength(1);
  });

  it('a daemon that holds some gets nothing; they apply and are kept for an offline start', async () => {
    localStorage.setItem('ledge.monitor', 'X');
    await boot();
    await speak(prefs({ position: 'left', islandScale: 2, panelScale: 1.25, screen: 'primary' }));
    expect(islandSets()).toHaveLength(0);
    expect(localStorage.getItem('ledge.islandPosition')).toBe('left');
    expect(localStorage.getItem('ledge.monitor')).toBeNull();
    // The island takes its size; the panels' size no longer has anything to apply to.
    expect(surface()!.style.zoom).toBe('2');
    expect(JSON.parse(localStorage.getItem('ledge.island')!)).toMatchObject({ position: 'left', panelScale: 1.25 });
    await speak(prefs({ screen: 'second' }));
    await act(async () => { await sleep(20); });
    expect(localStorage.getItem('ledge.monitor')).toBe(monitors[1]!.id);
    expect(localStorage.getItem('ledge.islandPosition')).toBe('center');
    // Any monitor by its id, a third one too.
    await speak(prefs({ screen: '\\\\.\\DISPLAY3' }));
    expect(localStorage.getItem('ledge.monitor')).toBe('\\\\.\\DISPLAY3');
    await speak(prefs({ visible: false }));
    expect(surface()).toBeNull();
    await speak(prefs());
    expect(surface()).not.toBeNull();
  });

  it('an offline start applies the last settings kept', () => {
    localStorage.setItem('ledge.island', JSON.stringify(prefs({ visible: false })));
    render(<App />);
    expect(surface()).toBeNull();
  });
});
