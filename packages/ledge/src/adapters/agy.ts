import type { Pending } from '@ledge/protocol';
import { NO_ALWAYS, NO_NOTE, Refusal, assertDialogIs, bottomLines, flatten, type Adapter, type KeyPlan, type PanePromptMatch } from './types.js';

const rtrim = (l: string) => l.replace(/\s+$/, '');
const isBlank = (l: string) => l.trim() === '';
const toLines = (pane: string) => pane.split('\n').map(rtrim);

function lastNonBlank(lines: string[], from = lines.length - 1): number {
  let i = from;
  while (i >= 0 && isBlank(lines[i]!)) i--;
  return i;
}

// Antigravity CLI 1.5.17 ends its pane with a footer line: `? for shortcuts` at rest, `esc to cancel` while a turn runs
// or a dialog waits, the mode and model at its right edge. At rest the input line sits between two rules above it:
//
//   ──────────────────────────────────
//   > Auto mode: edits & safe commands auto-approved (shift+tab to cycle)    the mode's hint, a draft, or nothing
//   ──────────────────────────────────
//   ? for shortcuts                                        auto · Gemini 4 Hydrogen · medium
const RULE = /^─{10,}$/;
const REST_FOOTER = /^\? for shortcuts\b/;
const BUSY_FOOTER = /^esc to cancel\b/;

// A dialog replaces the input box: a title (`Command`, `Pending edit`, `Question`), one rule, its body, numbered
// options with `>` on the focused one, a hint line, then the `esc to cancel` footer:
//
//   Command
//   ──────────────────────────────────
//   Requesting permission for:
//      date +%Y
//   Run this command?
//   > 1. Yes, run command
//     2. Yes, and always allow in this conversation for commands that start with 'date'
//     3. Yes, and always allow for commands that start with 'date' (Persist to settings.json)
//     4. No, cancel
//     ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
//   esc to cancel
//
// A number key answers at once. Tab on the focused option opens a note under it (`4. No, and tell Antigravity CLI what
// to do differently`, hint `enter Submit`); Tab again closes it and puts the focus back on 1.
const HINT = /^↑\/↓ Navigate · /;
const NOTE_HINT = /^enter Submit$/;
const OPTION = /^(>\s*)?(\d+)\.\s+(.*)$/;
const COMMAND_TITLE = 'Command';
const EDIT_TITLE = 'Pending edit';
const QUESTION_TITLE = 'Question';
/** The titles of the dialogs Ledge reads: the line right above a dialog's rule. */
const TITLES: ReadonlySet<string> = new Set([COMMAND_TITLE, EDIT_TITLE, QUESTION_TITLE]);
/** How far above the hint a dialog's rule can be: a long command or diff takes many lines. */
const DIALOG_MAX = 60;

type Dialog = { title: string; body: string[]; options: string[]; focus: number; hint: string; noteOpen: boolean };

/** The dialog that ends the pane, or null. */
function parseDialog(lines: string[]): Dialog | null {
  const end = lastNonBlank(lines);
  if (end < 0 || !BUSY_FOOTER.test(lines[end]!.trim())) return null;
  const h = lastNonBlank(lines, end - 1);
  if (h < 0) return null;
  const hint = lines[h]!.trim();
  const noteOpen = NOTE_HINT.test(hint);
  if (!HINT.test(hint) && !noteOpen) return null;
  // The dialog's own rule is the one under a title it draws, both at the pane's left edge: the lines of a command or a
  // diff are indented, so a rule or a title among them is not the dialog's.
  let rule = h - 1;
  const titled = (i: number) => RULE.test(lines[i]!) && TITLES.has(lines[lastNonBlank(lines, i - 1)] ?? '');
  while (rule > 0 && h - rule <= DIALOG_MAX && !titled(rule)) rule--;
  if (rule <= 0 || !titled(rule)) return null;
  const title = lines[lastNonBlank(lines, rule - 1)]!.trim();
  const inside = lines.slice(rule + 1, h);
  const first = inside.findIndex(l => OPTION.test(l.trim()));
  if (first < 0) return null;
  const options: string[] = []; let focus = -1;
  for (const l of inside.slice(first)) {
    const m = l.trim().match(OPTION);
    if (!m) continue; // the note's own input line, under its option
    if (m[1]) focus = options.length;
    options.push(m[3]!.trim());
  }
  return { title, body: inside.slice(0, first), options, focus, hint, noteOpen };
}

/** The lines between two markers of the body, blank edges dropped. */
function between(body: string[], from: RegExp, to: RegExp): string[] {
  const a = body.findIndex(l => from.test(l.trim()));
  if (a < 0) return [];
  const b = body.findIndex((l, i) => i > a && to.test(l.trim()));
  const out = body.slice(a + 1, b < 0 ? body.length : b);
  while (out.length && isBlank(out[0]!)) out.shift();
  while (out.length && isBlank(out.at(-1)!)) out.pop();
  return out;
}

/** The question's last option opens a field to write the answer in: Ledge leaves it out of the options it offers. */
const WRITE_IN = /^Write-in\.\.\.$/;

const ASKS = /^Requesting permission for:$/;
const RUN = /^Run this command\?$/;
/**
 * The command a command dialog asks to run, its lines joined back (the dialog indents them): everything between its
 * one `Requesting permission for:` and its one `Run this command?`. A command whose own lines repeat a marker or draw a
 * rule cannot be told from the dialog around it: null, and the request is answered in the terminal, never on a
 * reading that could show only part of it.
 */
function commandText(d: Dialog): string | null {
  const body = d.body.map(l => l.trim());
  if (body.filter(l => ASKS.test(l)).length !== 1 || body.filter(l => RUN.test(l)).length !== 1 || body.some(l => RULE.test(l))) return null;
  const from = body.findIndex(l => ASKS.test(l)); const to = body.findIndex(l => RUN.test(l));
  if (to < from || body.slice(to + 1).some(l => l !== '')) return null; // the question ends the body, right above the options
  return between(d.body, ASKS, RUN).map(l => l.trim()).join('\n') || null;
}

/** The file an edit dialog shows (`/home/dev/demo/math.js  +1`), and its diff. */
function editOf(d: Dialog): { path: string; diff: string } {
  const lines = between(d.body, /^$/, /^Accept this file edit\?$/);
  const head = lines.findIndex(l => !isBlank(l));
  const path = head < 0 ? '' : lines[head]!.trim().replace(/\s+[+-]\d+(\s+-\d+)?$/, '');
  const diff = lines.slice(head + 1).filter(l => !/^\s*shift\+tab to auto-approve file edits$/.test(l)).join('\n').replace(/\n+$/, '');
  return { path, diff };
}

const questionText = (d: Dialog) => d.body.map(l => l.trim()).find(l => /^Question \d+\/\d+: /.test(l))?.replace(/^Question \d+\/\d+: /, '') ?? '';

// The trust dialog, shown before anything else in a folder agy does not trust yet: no title nor rule, an unnumbered menu.
//
//   Do you trust the contents of this project?
//   Antigravity CLI requires permission to read, edit, and execute files here.
//   > Yes, I trust this folder
//     No, exit
//     ↑/↓ Navigate · enter Confirm
const TRUST_ASK = /^Do you trust the contents of this project\?$/;
const TRUST_YES = /^(>\s*)?Yes, I trust this folder$/;
const TRUST_NO = /^(>\s*)?No, exit$/;
const TRUST_HINT = /^↑\/↓ Navigate · enter Confirm$/;

function parseTrust(lines: string[]): { path: string; onYes: boolean } | null {
  const h = lines.findLastIndex(l => TRUST_HINT.test(l.trim()));
  if (h < 0 || lastNonBlank(lines) - h > 1) return null; // the hint, then the footer at most
  const ask = lines.findLastIndex((l, i) => i < h && TRUST_ASK.test(l.trim()));
  if (ask < 0) return null;
  const yes = lines.findIndex((l, i) => i > ask && i < h && TRUST_YES.test(l.trim()));
  const no = lines.findIndex((l, i) => i > ask && i < h && TRUST_NO.test(l.trim()));
  if (yes < 0 || no < 0) return null;
  const at = lines.findLastIndex((l, i) => i < ask && /^Accessing workspace:$/.test(l.trim()));
  const path = at < 0 ? '' : lines.slice(at + 1, ask).map(l => l.trim()).filter(Boolean)[0] ?? '';
  return { path, onYes: lines[yes]!.trim().startsWith('>') };
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const lines = toLines(pane);
  const t = parseTrust(lines);
  if (t) return { kind: 'permission', text: `Trust this folder? ${t.path}`.trim(), options: ['Yes, I trust this folder', 'No, exit'] };
  const d = parseDialog(lines);
  if (!d) return null;
  if (d.title === QUESTION_TITLE) return { kind: 'question', text: questionText(d), options: d.options.filter(o => !WRITE_IN.test(o)) };
  if (d.title === EDIT_TITLE) {
    const e = editOf(d);
    return { kind: 'diff', text: `Edit ${e.path}`, ...(e.diff ? { body: e.diff } : {}) };
  }
  if (d.title === COMMAND_TITLE) { const text = commandText(d); return text ? { kind: 'permission', text } : null; }
  return null;
}

/** The kind of request on screen, the open note field being still its dialog's. */
function shownKind(lines: string[]): PanePromptMatch['kind'] | null {
  return detectPrompt(lines.join('\n'))?.kind ?? null;
}

/** A dialog Ledge reads ends the pane: its hint (or the open note's) then the `esc to cancel` footer, or the trust menu. */
function promptStillVisible(lastLines: string): boolean {
  const lines = bottomLines(lastLines).split('\n').map(l => l.trim());
  const end = lines.length - 1;
  if (end >= 0 && TRUST_HINT.test(lines[end]!)) return true;
  if (end >= 1 && TRUST_HINT.test(lines[end - 1]!) && !BUSY_FOOTER.test(lines[end]!)) return true;
  return end >= 1 && BUSY_FOOTER.test(lines[end]!) && (HINT.test(lines[end - 1]!) || NOTE_HINT.test(lines[end - 1]!));
}

/** After keys were sent: the request answered is no longer the one on screen (an open note field is still it). */
function promptGone(pane: string, pending: Pending): boolean {
  const lines = toLines(pane);
  const d = parseDialog(lines);
  if (d?.noteOpen) return false;
  const m = detectPrompt(pane);
  return !m || m.kind !== pending.kind || m.text !== pending.text;
}

/** The index of the input box's top rule, when the pane ends with the input box and a footer; else -1. */
function inputTop(lines: string[]): number {
  const end = lastNonBlank(lines);
  if (end < 0 || !(REST_FOOTER.test(lines[end]!.trim()) || BUSY_FOOTER.test(lines[end]!.trim()))) return -1;
  const bottom = lastNonBlank(lines, end - 1);
  if (bottom < 0 || !RULE.test(lines[bottom]!.trim())) return -1;
  let top = bottom - 1;
  while (top >= 0 && !RULE.test(lines[top]!.trim())) top--;
  return top;
}

/** At rest: the input box and `? for shortcuts` end the pane, with no dialog on it. */
function atRest(pane: string): boolean {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines)) return false;
  const end = lastNonBlank(lines);
  return end >= 0 && REST_FOOTER.test(lines[end]!.trim()) && inputTop(lines) >= 0;
}

/** The conversation without the input box and footer under it; a dialog is shown whole. */
function previewLines(pane: string): string[] {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines)) return lines;
  const top = inputTop(lines);
  return top < 0 ? lines : lines.slice(0, top);
}

const compact = (s: string) => s.replace(/\s+/g, '');

/** The input box holds exactly `text` (wrapped as it takes): not the mode's hint it shows when empty, nor an older draft. */
const typed = (text: string) => (lastLines: string) => {
  const lines = toLines(lastLines);
  const top = inputTop(lines);
  if (top < 0) return false;
  const end = lastNonBlank(lines);
  const box = lines.slice(top + 1, lastNonBlank(lines, end - 1)).join('');
  return compact(box) === compact(`> ${text}`);
};

/** The open note field holds `text`: it sits under the focused option. */
const noted = (text: string) => (lastLines: string) => {
  const d = parseDialog(toLines(lastLines));
  if (!d?.noteOpen) return false;
  const lines = toLines(lastLines);
  return compact(lines.join('')).includes(compact(`> ${text}`));
};

const focusOn = (i: number) => (lastLines: string) => parseDialog(toLines(lastLines))?.focus === i;
const noteOpen = (lastLines: string) => !!parseDialog(toLines(lastLines))?.noteOpen;

/** The option whose text starts with `start`, as its number key; a refusal when the dialog has none. */
function optionKey(d: Dialog, start: RegExp, missing: string): string {
  const i = d.options.findIndex(o => start.test(o));
  if (i < 0) throw new Refusal(missing, 'not_offered');
  return String(i + 1);
}

/**
 * Refuses with a note: the focus goes down to « No, … » (number keys would answer at once), Tab opens its note, the
 * note goes in once the field is there and Enter once the field holds it.
 */
function notePlan(d: Dialog, note: string): KeyPlan {
  if (d.title !== COMMAND_TITLE) throw new Refusal(NO_NOTE, 'not_offered');
  if (d.noteOpen) throw new Refusal(NO_NOTE, 'not_offered'); // a note already open in the terminal: answered there
  const no = d.options.findIndex(o => /^No\b/.test(o));
  if (no < 0) throw new Refusal(NO_NOTE, 'not_offered');
  const from = d.focus < 0 ? 0 : d.focus;
  const moves = Array<string>(Math.abs(no - from)).fill(no > from ? 'Down' : 'Up');
  const text = flatten(note);
  return [
    ...(moves.length ? [{ keys: moves }, { until: focusOn(no) }] : []),
    { keys: ['Tab'] }, { until: noteOpen },
    { text }, { until: noted(text) }, { keys: ['Enter'] }
  ];
}

/** Pause between Esc and the next key: a key read right after Esc is taken as Alt+key (the `R` of a prompt was lost). */
const AFTER_ESC_MS = 300;
/** Pause between the typed `/exit` and its Enter, so the Enter is not taken as part of a paste. */
const EXIT_ENTER_DELAY_MS = 300;

export const agyAdapter: Adapter = {
  tool: 'agy',
  detectPrompt,
  promptStillVisible,
  promptGone,
  previewLines,
  atRest,
  keysFor(decision, pending, pane, note) {
    const lines = pane ? toLines(pane) : [];
    if (pane) assertDialogIs(pending, shownKind(lines));
    const t = parseTrust(lines);
    if (t) {
      if (decision === 'always') throw new Refusal(NO_ALWAYS, 'not_offered');
      if (note) throw new Refusal(NO_NOTE, 'not_offered');
      // Enter takes the focused choice: Yes is focused when the dialog opens.
      if (decision === 'accept') return t.onYes ? [{ keys: ['Enter'] }] : [{ keys: ['Up'] }, { until: p => !!parseTrust(toLines(p))?.onYes }, { keys: ['Enter'] }];
      return t.onYes ? [{ keys: ['Down'] }, { until: p => parseTrust(toLines(p))?.onYes === false }, { keys: ['Enter'] }] : [{ keys: ['Enter'] }];
    }
    const d = parseDialog(lines);
    if (!d) {
      // No dialog read (a pane taller than the capture): the request's own first and last answers.
      if (decision === 'always' || note) throw new Refusal(decision === 'always' ? NO_ALWAYS : NO_NOTE, 'not_offered');
      return [{ text: decision === 'accept' ? '1' : pending.kind === 'diff' ? '2' : '4' }];
    }
    if (decision === 'deny' && note) return notePlan(d, note);
    if (d.title === QUESTION_TITLE) return decision === 'accept' ? [{ text: '1' }] : [{ keys: ['Escape'] }];
    if (decision === 'always') {
      // « always allow in this conversation »; the next option would write the user's own settings: never picked.
      if (d.title !== COMMAND_TITLE) throw new Refusal(NO_ALWAYS, 'not_offered');
      return [{ text: optionKey(d, /^Yes, and always allow in this conversation\b/, NO_ALWAYS) }];
    }
    if (decision === 'accept') return [{ text: '1' }];
    return [{ text: optionKey(d, /^No\b/, 'no refusal in this dialog, answer in the terminal') }];
  },
  replyPlan(text: string, pending?: Pending, pane?: string): KeyPlan {
    // A question's option by its number: the key answers at once.
    if (pending?.kind === 'question' && /^[1-9]$/.test(text.trim()) && pane && parseDialog(toLines(pane))?.title === QUESTION_TITLE) return [{ text: text.trim() }];
    // An Enter that comes with the text in one read is taken as part of a paste: it waits for the text in the input box.
    const flat = flatten(text);
    return [{ text: flat }, { until: typed(flat) }, { keys: ['Enter'] }];
  },
  // Esc stops a running turn (the footer says `esc to cancel`).
  interruptKeys: () => ['Escape'],
  exitText: () => '/exit',
  // Esc first (a turn running or a menu open), a pause so `/` is not read as Alt+/, then the command and its Enter.
  exitPlan: () => [{ keys: ['Escape'] }, { waitMs: AFTER_ESC_MS }, { text: '/exit' }, { waitMs: EXIT_ENTER_DELAY_MS }, { keys: ['Enter'] }]
};
