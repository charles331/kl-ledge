import { describe, expect, it, vi } from 'vitest';
import type { Aside, Session } from '@ledge/protocol';
import { createAsides, footOf, osc52Text, typingPieces, type AsideDeps } from '../src/daemon/aside.js';
import { claudeDraft, withoutFaint } from '../src/adapters/claude.js';
import type { ControlProcess } from '../src/mobile/terminal.js';

const RULE = '─'.repeat(60);
const T0 = '2026-11-27T10:00:00.000Z';
/** The input box as Claude Code 2.1.332 draws it, `inside` after the ❯ (styled, as `capture-pane -e` gives it). */
const promptScreen = (inside: string) => ['', `\x1b[38;5;244m${RULE}`, `\x1b[39m❯ ${inside}`, `\x1b[38;5;244m${RULE}`, '\x1b[39m  ⏵⏵ auto mode on (shift+tab to cycle)', '', ''];
/** Control mode writes a pane's output octal-escaped. */
const escaped = (s: string) => [...s].map(c => (c < ' ' || c === '\\' ? `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}` : c)).join('');

type Stage = 'prompt' | 'streaming' | 'ready' | 'copied';

/**
 * Claude Code's `/btw` in a pane, as seen in tmux on 2.1.332: the panel comes up after Enter, its foot offers « c to copy » once
 * the answer is whole (`readyAfter` screen reads later), `c` writes the answer as OSC 52 (bare, then wrapped for tmux) and makes a
 * paste buffer, Esc closes the panel. `copy: false`: `c` writes nothing.
 */
function fakeClaude(o: { answer?: string; draft?: string; panel?: boolean; stuck?: boolean; paste?: boolean; readyAfter?: number; copy?: boolean; onRead?: (stage: Stage, reads: number) => void } = {}) {
  const answer = o.answer ?? 'The capital of Belgium is Brussels.\n\n1. alpha\n2. beta';
  let stage: Stage = 'prompt'; let reads = 0; let typed = o.draft ?? '';
  const keys: string[] = [];
  const buffers: Array<{ name: string; text: string }> = [{ name: 'buffer0', text: 'older copy' }];
  const procs: Array<ControlProcess & { written: string[]; emit(s: string): void }> = [];
  const screen = (): string[] => {
    reads++;
    o.onRead?.(stage, reads);
    if (stage === 'streaming' && reads >= (o.readyAfter ?? 2)) stage = 'ready';
    const asked = '  /btw what is the capital of Belgium?';
    if (stage === 'prompt') return promptScreen(typed && o.paste ? '[Pasted text #1 +2 lines]' : typed || '\x1b[2mTry\x1b[0m \x1b[2m"refactor <filepath>"\x1b[0m');
    const body = ['❯ /btw what is the capital of Belgium?', asked, '    The capital of Belgium is'];
    if (stage === 'streaming') return [...body, '  ⇧←/→ to browse · x to clear history · Esc to', '  close', ''];
    if (stage === 'ready') return [...body, '    Brussels.', '  c to', '  copy · f to fork · Esc to close', ''];
    return [...body, '    Brussels.', '  Copied to clipboard · f to fork · Esc to close', ''];
  };
  const spawn = vi.fn((_argv: string[]) => {
    let onData: (b: Buffer) => void = () => {};
    let onExit: () => void = () => {};
    let n = 0;
    const reply = (lines: string[]) => { n++; const k = n; setTimeout(() => onData(Buffer.from(`%begin 1 ${k} 1\n${lines.map(l => `${l}\n`).join('')}%end 1 ${k} 1\n`)), 0); };
    const p = {
      written: [] as string[],
      write(text: string) {
        const line = text.trim(); p.written.push(line);
        if (line.startsWith('display-message')) reply(['%3']);
        else if (line.startsWith('capture-pane')) reply(line.includes(' -e') ? screen() : screen().map(withoutFaint));
        else if (line.startsWith('list-buffers')) reply([...buffers].reverse().map(b => b.name));
        else if (line.startsWith('show-buffer')) reply((buffers.find(b => line.endsWith(b.name))?.text ?? '').split('\n'));
        else if (line.startsWith('delete-buffer')) { const i = buffers.findIndex(b => line.endsWith(b.name)); if (i >= 0) buffers.splice(i, 1); reply([]); }
        else reply([]);
      },
      kill() { onExit(); },
      emit(s: string) { onData(Buffer.from(s)); },
      onData(fn: (b: Buffer) => void) { onData = fn; },
      onExit(fn: () => void) { onExit = fn; }
    };
    setTimeout(() => onData(Buffer.from('%begin 1 0 0\n%end 1 0 0\n')), 0);
    procs.push(p);
    return p;
  });
  const tmux: AsideDeps['tmux'] = {
    controlArgs: name => ['-L', 'x', '-C', 'attach-session', '-t', `=${name}`],
    async sendText(_n, text) { keys.push(text); if (stage === 'prompt') typed += text; },
    async sendKeys(_n, k) {
      keys.push(...k);
      for (const key of k) {
        if (key === 'Enter' && stage === 'prompt' && typed.startsWith('/btw ') && !o.stuck) { typed = ''; if (o.panel !== false) { stage = 'streaming'; reads = 0; } }
        else if (key === 'C-u' && stage === 'prompt') typed = '';
        else if (key === 'c' && stage === 'ready') {
          stage = 'copied';
          if (o.copy !== false) {
            const b64 = Buffer.from(answer).toString('base64');
            // Split across two %output lines, as a long sequence comes.
            const seq = escaped(`\x1b]52;c;${b64}\x07\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
            const cut = Math.floor(seq.length / 2);
            procs.at(-1)!.emit(`%output %3 ${seq.slice(0, cut)}\n%output %3 ${seq.slice(cut)}\n`);
            buffers.push({ name: `buffer${buffers.length + 1}`, text: answer });
          }
        } else if (key === 'Escape' && stage !== 'prompt') stage = 'prompt';
      }
    }
  };
  return { tmux, spawn, keys, buffers, procs, stageOf: () => stage };
}

/** An open request, as the store holds one. */
const request = { kind: 'permission', text: 'Bash: ls', source: 'hook' } as NonNullable<Session['pending']>;
const claude: Session = { id: 's1', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'ledge-s1', state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' };

function setup(fake: ReturnType<typeof fakeClaude>, session: () => Session | undefined = () => claude) {
  const seen: Aside[] = [];
  const typing = new Set<string>();
  const asides = createAsides({
    tmux: fake.tmux, spawn: fake.spawn, typing, session: () => session(), log: () => {}, now: () => T0,
    emit: (_id, a) => seen.push(a), timings: { pollMs: 1, enterDelayMs: 0, typeGapMs: 0, panelMs: 200, answerMs: 300, copyMs: 100 }
  });
  const last = () => seen.at(-1)!;
  const settled = () => vi.waitFor(() => expect(last().state).not.toBe('asking'), { timeout: 3000 });
  return { asides, seen, typing, last, settled };
}

describe('osc52Text, footOf, claudeDraft', () => {
  it('reads the first OSC 52 copy, bare or wrapped for tmux', () => {
    const b64 = Buffer.from('é **md**').toString('base64');
    expect(osc52Text(`junk\x1b]52;c;${b64}\x07more`)).toBe('é **md**');
    expect(osc52Text(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x1b\\`)).toBe('é **md**');
    expect(osc52Text('\x1b]52;c;abc')).toBeNull(); // not ended yet: more is coming
  });
  it('cuts a long question into pieces without splitting a character (an emoji at the 48th place stays whole)', () => {
    const text = `/btw ${'a'.repeat(42)}😀 fin`;
    const pieces = typingPieces(text);
    expect(pieces.join('')).toBe(text);
    expect(pieces[0]!.endsWith('😀')).toBe(true);
    expect(pieces.every(p => !/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p))).toBe(true);
    expect(typingPieces('é'.repeat(100)).map(p => Array.from(p).length)).toEqual([48, 48, 4]);
  });
  it('joins a foot a narrow pane wrapped', () => {
    expect(footOf('  answer\n  c to\n  copy · f to fork · Esc to\n  close\n\n')).toContain('c to copy · f to fork · Esc to close');
  });
  it('tells an empty prompt from a draft: the faint « Try … » suggestion is no draft', () => {
    expect(claudeDraft(promptScreen('\x1b[2mTry\x1b[0m \x1b[2m"refactor"\x1b[0m').join('\n'))).toBe('');
    expect(claudeDraft(promptScreen('').join('\n'))).toBe('');
    // A faint run that ends on the next line (seen on 2.1.332, « Try "how do I log an error?" »): the line end stays.
    const carried = ['', `\x1b[38;5;244m${RULE}`, '\x1b[39m❯\u00a0\x1b[2mTry\x1b[0m \x1b[2m"log an error?"', `\x1b[0m\x1b[38;5;244m${RULE}`, '\x1b[39m  ⏸ manual mode on'].join('\n');
    expect(claudeDraft(carried)).toBe('');
    expect(claudeDraft(promptScreen('draft text').join('\n'))).toBe('draft text');
    expect(claudeDraft('  1. Yes\n  2. No\n  Esc to cancel')).toBeNull();
  });
});

describe('an aside (#41, Claude Code 2.1.332 /btw)', () => {
  it('types /btw on an empty prompt, waits for « c to copy », copies, closes, and answers with the Markdown; the paste buffer goes', async () => {
    const fake = fakeClaude();
    const { asides, seen, typing, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'what is the capital of Belgium?');
    expect(seen[0]).toEqual({ rid: 'r1', question: 'what is the capital of Belgium?', askedAt: T0, state: 'asking' });
    await settled();
    expect(last()).toEqual({ rid: 'r1', question: 'what is the capital of Belgium?', askedAt: T0, state: 'answered', answer: 'The capital of Belgium is Brussels.\n\n1. alpha\n2. beta', answeredAt: T0 });
    expect(fake.keys).toEqual(['/btw what is the capital of Belgium?', 'Enter', 'c', 'Escape']);
    expect(fake.stageOf()).toBe('prompt');
    // Its own paste buffer deleted, an older one kept.
    expect(fake.buffers.map(b => b.name)).toEqual(['buffer0']);
    expect(typing.size).toBe(0);
    // Kept and replayed: the last state of each aside.
    expect(asides.all()).toEqual([['s1', [last()]]]);
  });

  it('a long question is typed in pieces (a long burst is a paste, and a pasted /btw goes to the agent); the whole text arrives', async () => {
    const fake = fakeClaude();
    const { asides, settled } = setup(fake);
    const question = 'x'.repeat(3_990);
    asides.ask('s1', 'r1', question);
    await settled();
    const typed = fake.keys.slice(0, fake.keys.indexOf('Enter'));
    expect(typed.length).toBe(Math.ceil((question.length + 5) / 48));
    expect(typed.every(k => k.length <= 48)).toBe(true);
    expect(typed.join('')).toBe(`/btw ${question}`);
  });

  it('a question Claude Code folded as a paste anyway: cleared, never sent, no_panel', async () => {
    const fake = fakeClaude({ paste: true });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'no_panel' });
    expect(fake.keys).toEqual(['/btw q', 'C-u']);
  });

  it('a question over several lines is typed on one line', async () => {
    const fake = fakeClaude();
    const { asides, settled } = setup(fake);
    asides.ask('s1', 'r1', 'one\ntwo');
    await settled();
    expect(fake.keys[0]).toBe('/btw one two');
  });

  it('a draft at the prompt: nothing is typed, the aside fails not_empty', async () => {
    const fake = fakeClaude({ draft: 'half a sentence' });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'not_empty' });
    expect(fake.keys).toEqual([]);
  });

  it('no panel comes up (a Claude Code without /btw): no_panel, no other key', async () => {
    const fake = fakeClaude({ panel: false });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'no_panel' });
    expect(fake.keys).toEqual(['/btw q', 'Enter']);
  });

  it('no panel and its own `/btw …` left in the input (Enter read as a paste): it is cleared, nothing else', async () => {
    const fake = fakeClaude({ stuck: true });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'no_panel' });
    expect(fake.keys).toEqual(['/btw q', 'Enter', 'C-u']);
  });

  it('cancel (the person stops the agent): the aside closes its panel, fails interrupted, and lets the pane go before resolving', async () => {
    const fake = fakeClaude({ readyAfter: 1_000_000 });
    const { asides, last, typing } = setup(fake);
    await asides.cancel('s1'); // nothing under way: resolves at once
    asides.ask('s1', 'r1', 'q');
    expect(asides.running('s1')).toBe(true);
    await vi.waitFor(() => expect(fake.stageOf()).toBe('streaming'), { timeout: 3000 });
    await asides.cancel('s1');
    expect(asides.running('s1')).toBe(false);
    expect(typing.size).toBe(0);
    expect(last()).toMatchObject({ state: 'failed', cause: 'interrupted' });
    // One Esc, its own, to the panel: the person's Esc that follows reaches the turn.
    expect(fake.keys).toEqual(['/btw q', 'Enter', 'Escape']);
    expect(fake.stageOf()).toBe('prompt');
  });

  it('stopped while typing (before Enter): its partial `/btw …` is cleared; a session being closed takes no aside', async () => {
    const fake = fakeClaude();
    let typedSoFar = 0;
    const orig = fake.tmux.sendText;
    const { asides, last, settled } = setup(fake);
    fake.tmux.sendText = async (n, t) => { typedSoFar++; await orig(n, t); if (typedSoFar === 2) void asides.cancel('s1'); };
    asides.ask('s1', 'r1', 'x'.repeat(200));
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'interrupted' });
    expect(fake.keys.at(-1)).toBe('C-u');
    expect(fake.keys).not.toContain('Enter');
    const closing = fakeClaude();
    const seen: Aside[] = [];
    createAsides({ tmux: closing.tmux, spawn: closing.spawn, typing: new Set(), session: () => claude, closing: () => true, log: () => {}, now: () => T0, emit: (_i, a) => seen.push(a) }).ask('s1', 'r2', 'q');
    expect(seen.at(-1)).toMatchObject({ state: 'failed', cause: 'interrupted' });
    expect(closing.keys).toEqual([]);
  });

  it('a session removed while its aside runs leaves nothing to replay', async () => {
    let gone = false;
    const fake = fakeClaude({ readyAfter: 5, onRead: (_s, reads) => { if (reads === 3) gone = true; } });
    const { asides, seen } = setup(fake, () => (gone ? undefined : claude));
    asides.ask('s1', 'r1', 'q');
    asides.drop('s1');
    await vi.waitFor(() => expect(seen.at(-1)!.state).not.toBe('asking'), { timeout: 3000 });
    expect(asides.all()).toEqual([]);
  });

  it('a request that comes up while the answer is written: no c; one Esc closes the panel that hides its dialog; interrupted', async () => {
    let pending = false;
    const fake = fakeClaude({ readyAfter: 50, onRead: (stage, reads) => { if (stage === 'streaming' && reads === 3) pending = true; } });
    const { asides, last, settled } = setup(fake, () => (pending ? { ...claude, pending: request } : claude));
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'interrupted' });
    expect(fake.keys).toEqual(['/btw q', 'Enter', 'Escape']);
  });

  it('an answer that never finishes: Esc to the panel, timeout', async () => {
    const fake = fakeClaude({ readyAfter: 1_000_000 });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'timeout' });
    expect(fake.keys).toEqual(['/btw q', 'Enter', 'Escape']);
  });

  it('a copy that never shows in the output: the panel is still closed, unreadable', async () => {
    const fake = fakeClaude({ copy: false });
    const { asides, last, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    await settled();
    expect(last()).toMatchObject({ state: 'failed', cause: 'unreadable' });
    expect(fake.keys).toEqual(['/btw q', 'Enter', 'c', 'Escape']);
  });

  it('refuses at once: another harness, no terminal, a second aside meanwhile, an open request', async () => {
    const fake = fakeClaude({ readyAfter: 20 });
    const cases: Array<[Session, string]> = [[{ ...claude, tool: 'codex' }, 'unsupported'], [{ ...claude, source: 'hook_only' }, 'read_only'], [{ ...claude, tmuxSession: undefined } as unknown as Session, 'read_only'],
      [{ ...claude, pending: request }, 'busy']];
    for (const [s, cause] of cases) {
      const { asides, last } = setup(fake, () => s);
      asides.ask('s1', 'r1', 'q');
      expect(last()).toMatchObject({ state: 'failed', cause });
    }
    expect(fake.keys).toEqual([]);
    const { asides, seen, settled } = setup(fake);
    asides.ask('s1', 'r1', 'q');
    asides.ask('s1', 'r2', 'q2');
    expect(seen.find(a => a.rid === 'r2')).toMatchObject({ state: 'failed', cause: 'busy' });
    await vi.waitFor(() => expect(seen.filter(a => a.rid === 'r1').at(-1)!.state).toBe('answered'), { timeout: 3000 });
    void settled;
  });

  it('waits for the typing lock, then gives up busy', async () => {
    const fake = fakeClaude();
    const seen: Aside[] = [];
    const typing = new Set(['s1']);
    const asides = createAsides({ tmux: fake.tmux, spawn: fake.spawn, typing, session: () => claude, log: () => {}, now: () => T0, emit: (_id, a) => seen.push(a), timings: { lockMs: 30, pollMs: 1 } });
    asides.ask('s1', 'r1', 'q');
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ state: 'failed', cause: 'busy' }), { timeout: 3000 });
    expect(fake.keys).toEqual([]);
  });

  it('keeps the last ten asides of a session', async () => {
    const fake = fakeClaude();
    const { asides } = setup(fake, () => ({ ...claude, tool: 'codex' }));
    for (let i = 0; i < 12; i++) asides.ask('s1', `r${i}`, 'q');
    expect(asides.all()[0]![1].map(a => a.rid)).toEqual(['r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11']);
    asides.drop('s1');
    expect(asides.all()).toEqual([]);
  });
});
