import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Text, type Key } from 'ink';
import { randomUUID } from 'node:crypto';
import { useTasks } from '@ledge/fleet';
import type { Task } from '@ledge/protocol';
import { useTui } from './context.js';
import { openDecisions } from './model/overview.js';
import { wrap } from './model/thread.js';
import { C } from './theme.js';
import { Field, fieldRows } from './ui/Field.js';
import { TitledBox } from './ui/TitledBox.js';

/*
 * The decisions sessions put to the user (`ledge task give ledge …`), answered in the TUI where the session is (#40, PR 3, design-ux's
 * answer, the owner's validation pending): the Session screen of the session that asked says it in its header, and D answers it, the
 * oldest first; on the overview, D answers the selected session's. The flow is the one « À toi » had: the answer written, read again
 * whole, then confirmed (y), sent through `action.run task.answer` only, since an answer cannot be taken back. Kept in this one module
 * so the place can change without touching the screens.
 */

/** The open decisions, oldest first, without a routine's items (answered on the Routines screen). */
export function useDecisions(): Task[] {
  const tui = useTui();
  const tasks = useTasks(tui.client);
  return useMemo(() => openDecisions(tasks).filter(x => !x.routine), [tasks]);
}

/** The oldest open decision a session put to the user, if any. */
export const decisionOf = (decisions: readonly Task[], sessionId: string | undefined): Task | undefined =>
  sessionId === undefined ? undefined : decisions.find(x => x.giver === sessionId);

/** The ids of the sessions a decision waits on: the tree marks them, tab reaches them. */
export const askingIds = (decisions: readonly Task[]): Set<string> => new Set(decisions.map(x => x.giver));

export interface DecisionFlow {
  /** Writing or reading the answer again: the screen's own keys are off meanwhile. */
  active: boolean;
  /** The field holds the keys (its own editing). */
  editing: boolean;
  /** Starts answering this decision. */
  start(task: Task): void;
  /** The flow's keys while it is active: true when it took the key. */
  onKey(input: string, key: Key): boolean;
  /** The key bar while it is active. */
  keys: Array<readonly [string, string]>;
  /** The rows it takes under the screen, for a screen of `columns` × `rows`. */
  height(columns: number, rows: number): number;
  /** The field, or the answer read again whole, across the screen. */
  view(columns: number, rows: number): ReactElement | null;
}

/** The answer's flow: write it (↵ reads it again), y sends it, n or esc goes back to the field, esc in the field drops it. */
export function useDecisionFlow(decisions: readonly Task[]): DecisionFlow {
  const tui = useTui();
  const { t } = tui;
  const [deciding, setDeciding] = useState<{ id: string; draft: string; confirm: boolean } | null>(null);
  const decision = deciding ? decisions.find(x => x.id === deciding.id) : undefined;
  // Answered elsewhere meanwhile (the phone, Desktop, the CLI): the field goes with it.
  useEffect(() => { if (deciding && !decision) setDeciding(null); }, [deciding, decision]);
  const answer = (x: Task, text: string) => {
    const rid = randomUUID();
    const off = tui.client.onMessage(m => {
      if (m.type !== 'action.result' || m.rid !== rid) return;
      off();
      tui.toast(m.reason === undefined ? { text: t.toast.reply(x.giverName), tone: 'ok' } : { text: t.toast.answerFailed(m.reason), tone: 'error' });
    });
    setTimeout(off, 10_000);
    tui.client.send({ type: 'action.run', rid, action: 'task.answer', args: { task: x.id, answer: text }, confirmed: true });
  };
  const lines = (columns: number) => (deciding?.confirm ? wrap(deciding.draft.trim(), Math.max(10, columns - 4)) : []);
  const height = (columns: number, rows: number) => (!deciding || !decision ? 0
    : deciding.confirm ? Math.min(lines(columns).length, Math.max(1, rows - 12)) + 2 : fieldRows(columns, rows) + 2);
  return {
    active: !!deciding && !!decision,
    editing: !!deciding && !deciding.confirm,
    start: task => setDeciding({ id: task.id, draft: '', confirm: false }),
    onKey(input, key) {
      if (!deciding) return false;
      // The field has the keys while it is open; esc there drops the answer.
      if (!deciding.confirm) { if (key.escape) setDeciding(null); return true; }
      if (input === 'y' && decision) { setDeciding(null); answer(decision, deciding.draft.trim()); return true; }
      if (input === 'n' || key.escape) { setDeciding({ ...deciding, confirm: false }); return true; }
      return true;
    },
    keys: deciding?.confirm ? [['y', t.keys.sendAnswer], ['n esc', t.keys.edit]] : [['↵', t.keys.review], ['alt+↵', t.keys.newLine], ['esc', t.keys.cancel]],
    height,
    view(columns, rows) {
      if (!deciding || !decision) return null;
      const h = height(columns, rows);
      return deciding.confirm
        ? <TitledBox title={t.overview.confirmAnswer(decision.giverName)} color={C.red} titleColor={C.red} height={h} flexShrink={0}>
          {lines(columns).slice(0, h - 2).map((l, i) => <Text key={i} color={C.fg} wrap="truncate">{l || ' '}</Text>)}
        </TitledBox>
        : <Field title={t.overview.decisionTitle(decision.giverName, decision.title)} value={deciding.draft} onChange={v => setDeciding(x => (x ? { ...x, draft: v } : x))}
          onSubmit={v => { if (!v.trim()) return false; setDeciding(x => (x ? { ...x, draft: v, confirm: true } : x)); }} onEscape={() => setDeciding(null)} active placeholder={t.overview.decisionHint} />;
    }
  };
}
