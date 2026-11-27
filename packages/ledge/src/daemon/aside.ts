// An aside (#41): Claude Code's own `/btw`, typed into the session's pane, its answer taken from the copy its panel makes.
// Claude Code 2.1.332, seen in tmux on 2026-11-27: `/btw <question>` opens a panel under the screen; while the answer is
// written its foot reads « ⇧←/→ to browse · x to clear history · Esc to close », and « c to copy » joins it once the answer
// is whole. `c` copies the whole answer as Markdown through OSC 52, which a tmux control client gets in the pane's `%output`,
// and the foot then says « Copied to clipboard ». Esc closes the panel without touching a running turn. Nothing of it reaches
// the transcript and no hook fires: the pane is the only place the answer is.
// The copy also leaves the pane: Claude Code, seeing it runs in tmux, hands the answer to tmux too, which keeps it as a paste
// buffer and sends it to the clipboard of every real terminal attached to the session (`ledge attach` in Windows Terminal;
// Ledge Desktop's terminal views are control clients and get nothing). `set-clipboard off` does not stop it. The owner accepted
// it (2026-11-27, #41): with the session open in a terminal, the person's clipboard takes the aside's answer. Ledge deletes the
// paste buffer afterwards, and sessions are launched as before.
import { ASIDE_ANSWER_MAX, ASIDES_KEPT, type Aside, type AsideCause, type Session } from '@ledge/protocol';
import { claudeDraft } from '../adapters/claude.js';
import { openControl, spawnControl, type ControlClient, type ControlEvent, type SpawnControl } from '../mobile/terminal.js';

/** The panel's foot once the answer is whole; read on the bottom lines joined, so a foot wrapped by a narrow pane still reads. */
const READY = /\bc to copy\b/;
/** The panel is on screen, whatever its state: what Esc may be sent to, and nothing else. */
const PANEL = /\bEsc to close\b/;
const FOOT_LINES = 6;
/** The lines read to find the input box (with a long draft) or the panel's foot. */
const SCREEN_LINES = 40;
/** Claude Code reads a long burst of keys as a paste, and a pasted `/btw …` goes to the agent as an ordinary message (seen
 *  on 2.1.332 with a 2 700-character question: it entered the thread). The question is typed in pieces this long, this far
 *  apart, which it reads as typing (the same question then opened the panel). */
const TYPE_CHUNK = 48;
const TYPE_GAP_MS = 12;
/** What Claude Code shows in its input for a text it took as a paste. */
const PASTED = /\[Pasted text #\d+/;
/** Claude Code reads a fast burst of keys as a paste: Enter goes after it (REPLY_ENTER_DELAY_MS, #76). */
const ENTER_DELAY_MS = 300;
const POLL_MS = 200;
/** How long the panel may take to come up after Enter. */
const PANEL_MS = 10_000;
/** How long the answer may take to be whole once the panel is up. */
const ANSWER_MS = 120_000;
/** How long the copy may take to arrive in the pane's output after `c`. */
const COPY_MS = 3_000;
/** The sessions' typing lock is waited for at most this long. */
const LOCK_MS = 5_000;
/** The output kept while the copy is awaited: the longest answer in base64, with room for the screen drawn meanwhile. */
const OUTPUT_MAX = 1_000_000;

/** The answer an OSC 52 sequence of `output` carries (the first one), or null. Claude Code writes it bare and wrapped for tmux. */
export function osc52Text(output: string): string | null {
  const m = /\x1b\]52;[a-z]*;([A-Za-z0-9+/=]*)(?:\x07|\x1b\\)/.exec(output);
  if (!m) return null;
  try { return Buffer.from(m[1]!, 'base64').toString('utf8'); } catch { return null; }
}

/** The panel's foot, as one line: the bottom lines joined, spaces squeezed. */
export function footOf(screen: string): string {
  return screen.split('\n').map(l => l.trim()).filter(Boolean).slice(-FOOT_LINES).join(' ').replace(/\s+/g, ' ');
}

export interface AsideTmux {
  sendText(name: string, text: string): Promise<void>;
  sendKeys(name: string, keys: string[]): Promise<void>;
  controlArgs?(name: string): string[] | null;
}

export interface AsideDeps {
  tmux: AsideTmux;
  /** Every change of an aside, for the fronts. */
  emit(id: string, aside: Aside): void;
  /** The sessions something is typing into (the mailbox, the relay, a terminal watcher): held for the whole aside. */
  typing: Set<string>;
  /** The session as it is now: its pending request or its end interrupt the aside. */
  session(id: string): Session | undefined;
  log(line: string): void;
  now?: () => string;
  spawn?: SpawnControl;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  /** Test seams for the timings above. */
  timings?: Partial<{ panelMs: number; answerMs: number; copyMs: number; lockMs: number; pollMs: number; enterDelayMs: number; typeGapMs: number }>;
}

export interface Asides {
  /** Starts an aside; what follows comes through `emit`. */
  ask(id: string, rid: string, question: string): void;
  /** The asides kept for each session, oldest first: replayed after a snapshot. */
  all(): Array<[string, Aside[]]>;
  drop(id: string): void;
  /** An aside of the session is under way: its keys own the pane, nothing else may type into it. */
  running(id: string): boolean;
  /** Stops the session's aside, if one is under way: it closes its panel when the panel is up (no key otherwise), fails
   *  `interrupted`, and resolves once it has let the pane go. What stops the agent waits for it: Esc on the panel only
   *  closes the panel. */
  cancel(id: string): Promise<void>;
}

class Failed extends Error { constructor(readonly cause: AsideCause) { super(cause); } }

export function createAsides(deps: AsideDeps): Asides {
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const clock = deps.clock ?? Date.now;
  const t = { panelMs: PANEL_MS, answerMs: ANSWER_MS, copyMs: COPY_MS, lockMs: LOCK_MS, pollMs: POLL_MS, enterDelayMs: ENTER_DELAY_MS, typeGapMs: TYPE_GAP_MS, ...deps.timings };
  const kept = new Map<string, Aside[]>();
  const running = new Map<string, { cancelled: boolean; done: Promise<void> }>();

  /** Told to the fronts; kept for the replay only while the session exists (one removed meanwhile leaves nothing behind). */
  const keep = (id: string, a: Aside) => {
    if (deps.session(id)) {
      const list = (kept.get(id) ?? []).filter(x => x.rid !== a.rid);
      list.push(a);
      kept.set(id, list.slice(-ASIDES_KEPT));
    }
    deps.emit(id, a);
  };

  async function run(s: Session, base: Aside, job: { cancelled: boolean }): Promise<void> {
    const name = s.tmuxSession!;
    const argv = deps.tmux.controlArgs?.(name) ?? null;
    if (!argv) throw new Failed('read_only');
    let out = '';
    let pane: string | null = null;
    const client: ControlClient = openControl(argv, deps.spawn ?? spawnControl, (e: Exclude<ControlEvent, { kind: 'reply' }>) => {
      if (e.kind === 'output' && (pane === null || e.pane === pane)) out = (out + e.data.toString('latin1')).slice(-OUTPUT_MAX);
    });
    const target = `'=${name}:'`;
    const screen = async (styled = false): Promise<string> => {
      const r = await client.command(`capture-pane -p${styled ? ' -e' : ''} -S -${SCREEN_LINES} -t ${target}`);
      if (!r.ok) throw new Failed('interrupted');
      return r.lines.join('\n');
    };
    /** A request that came up, the session's end, or `cancel` stops the aside: no more `/btw` keys, only the panel's Esc. */
    const still = () => {
      if (job.cancelled) throw new Failed('interrupted');
      const cur = deps.session(s.id);
      if (!cur || cur.state === 'exited' || cur.pending) throw new Failed('interrupted');
    };
    /**
     * Esc to the panel, and only while its foot is on screen. A request that comes up while the panel is open stays behind
     * it until it closes (2.1.332, seen in tmux: the permission dialog only showed once the panel was gone), and that Esc
     * closes the panel without cancelling the dialog: so the panel goes, or the person's decision would find no dialog.
     */
    const closePanel = async () => {
      if (PANEL.test(footOf(await screen()))) await deps.tmux.sendKeys(name, ['Escape']);
    };
    try {
      const info = await client.command(`display-message -p -t ${target} '#{pane_id}'`);
      if (!info.ok) throw new Failed('read_only');
      pane = info.lines[0]?.trim() || null;
      // Typed only on an empty prompt: a draft left in the input would take `/btw` as part of it.
      const draft = claudeDraft(await screen(true));
      if (draft === null) throw new Failed('busy');
      if (draft !== '') throw new Failed('not_empty');
      still();
      const text = `/btw ${base.question.replace(/[\r\n]+/g, ' ')}`;
      for (let i = 0; i < text.length; i += TYPE_CHUNK) {
        if (i > 0) { await sleep(t.typeGapMs); still(); }
        await deps.tmux.sendText(name, text.slice(i, i + TYPE_CHUNK));
      }
      await sleep(t.enterDelayMs);
      // Taken as a paste after all, Enter would send it to the agent: it is cleared instead.
      if (PASTED.test(await screen())) { await deps.tmux.sendKeys(name, ['C-u']); throw new Failed('no_panel'); }
      still();
      await deps.tmux.sendKeys(name, ['Enter']);
      // The panel comes up, then its answer is whole.
      let seen = false;
      const upBy = clock() + t.panelMs;
      let doneBy = Infinity;
      for (;;) {
        still();
        const foot = footOf(await screen());
        if (READY.test(foot)) break;
        if (PANEL.test(foot)) { if (!seen) { seen = true; doneBy = clock() + t.answerMs; } }
        else if (seen) throw new Failed('interrupted');
        if (!seen && clock() >= upBy) {
          // No panel: `/btw …` may still sit in the input (Enter read as part of a paste, a Claude Code without /btw). It is
          // Ledge's own text, so it goes; anything else there is left alone.
          if ((claudeDraft(await screen(true)) ?? '').startsWith('/btw ')) await deps.tmux.sendKeys(name, ['C-u']);
          throw new Failed('no_panel');
        }
        if (seen && clock() >= doneBy) { await closePanel(); throw new Failed('timeout'); }
        await sleep(t.pollMs);
      }
      // `c` only while the foot still offers it; the copy is what the pane writes from then.
      still();
      if (!READY.test(footOf(await screen()))) throw new Failed('interrupted');
      out = '';
      await deps.tmux.sendKeys(name, ['c']);
      let answer: string | null = null;
      const copyBy = clock() + t.copyMs;
      while ((answer = osc52Text(out)) === null && clock() < copyBy && !job.cancelled) await sleep(t.pollMs);
      await closePanel();
      if (answer === null) throw new Failed('unreadable');
      // tmux keeps the copy as a paste buffer too (Claude Code hands it to tmux): the newest one, when it is this answer, goes.
      const newest = await client.command(`list-buffers -F '#{buffer_name}'`);
      const buffer = newest.ok ? newest.lines[0]?.trim() : undefined;
      if (buffer && /^buffer\d+$/.test(buffer)) {
        const shown = await client.command(`show-buffer -b ${buffer}`);
        if (shown.ok && shown.lines.join('\n') === answer.replace(/\n$/, '')) await client.command(`delete-buffer -b ${buffer}`);
      }
      const cut = answer.length > ASIDE_ANSWER_MAX;
      keep(s.id, { ...base, state: 'answered', answer: cut ? answer.slice(0, ASIDE_ANSWER_MAX) : answer, ...(cut ? { truncated: true as const } : {}), answeredAt: now() });
    } catch (e) {
      // Stopped by `cancel` (the person stops the agent): the panel goes first, so that their Esc reaches the turn. Stopped
      // by a request: the panel goes, so that the dialog it hides shows. A session that ended gets no key.
      const cur = deps.session(s.id);
      if (job.cancelled || (cur && cur.state !== 'exited' && cur.pending)) await closePanel().catch(() => undefined);
      throw e;
    } finally {
      client.kill();
    }
  }

  return {
    ask(id, rid, question) {
      const base: Aside = { rid, question, askedAt: now(), state: 'asking' };
      const fail = (cause: AsideCause) => keep(id, { ...base, state: 'failed', cause });
      const s = deps.session(id);
      if (!s) return fail('interrupted');
      if (s.tool !== 'claude') return fail('unsupported');
      if (!s.tmuxSession || s.source === 'hook_only') return fail('read_only');
      if (running.has(id)) return fail('busy');
      if (s.state === 'exited') return fail('interrupted');
      if (s.pending) return fail('busy');
      const job = { cancelled: false, done: Promise.resolve() };
      running.set(id, job);
      keep(id, base);
      job.done = (async () => {
        // The session's typing lock, as the mailbox and the terminal take it: nothing else types into the pane meanwhile.
        const lockBy = clock() + t.lockMs;
        while (deps.typing.has(id) && clock() < lockBy && !job.cancelled) await sleep(20);
        if (deps.typing.has(id) || job.cancelled) { running.delete(id); return fail(job.cancelled ? 'interrupted' : 'busy'); }
        deps.typing.add(id);
        try { await run(s, base, job); }
        catch (e) {
          const cause = e instanceof Failed ? e.cause : 'invalid';
          if (!(e instanceof Failed)) deps.log(`aside of ${id} failed: ${(e as Error).message}`);
          fail(cause);
        } finally { deps.typing.delete(id); running.delete(id); }
      })();
    },
    all: () => [...kept],
    drop(id) { kept.delete(id); },
    running: id => running.has(id),
    cancel(id) {
      const job = running.get(id);
      if (!job) return Promise.resolve();
      job.cancelled = true;
      return job.done;
    }
  };
}
