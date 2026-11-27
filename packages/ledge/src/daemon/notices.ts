import { openDecision, type HumanAsk, type OperatorNotice, type Task } from '@ledge/protocol';
import { cut } from '../mobile/push/triggers.js';

/*
 * The island's notices and the urgent asks' push, computed by the daemon from what it already holds (#40, D11): they no longer need
 * the operator, which may be off (no `node:sqlite`) and is to go with the chat.
 */

const TEXT_MAX = 300;
const OPTIONS_MAX = 3;
/** A time that never changes, for an ask whose own times are unreadable: a notice must not differ between two calls. */
const EPOCH = '1970-01-01T00:00:00.000Z';

const validAt = (s: string): boolean => Number.isFinite(Date.parse(s)) && /^\d{4}-\d\d-\d\dT.*Z$/.test(s);

/** A rig ask with every question answered has nothing left to put to the user. */
const settledAsk = (a: HumanAsk): boolean => a.questions.length > 0 && a.questions.every(q => q.answer !== null);

/**
 * What the island is told (spec §7): every urgent or critical rig ask not settled, with its first open question's options, and every
 * open decision put to the user. Session requests are not notices: the island's request cards stay fed by the sessions. `holder`, while
 * the operator runs, names the chat point that holds an ask (`qid`), for the islands that still answer through it; a notice carries its
 * `qitem` either way, which `openrig.answer` takes.
 */
export function noticesOf(asks: readonly HumanAsk[], tasks: readonly Task[] = [], holder?: (askId: string) => string | undefined): OperatorNotice[] {
  const out: OperatorNotice[] = [];
  for (const a of asks) {
    if ((a.priority !== 'urgent' && a.priority !== 'critical') || settledAsk(a)) continue;
    const qid = holder?.(a.id);
    const q = a.questions.find(x => x.answer === null) ?? a.questions[0];
    const options = (q?.options ?? []).slice(0, OPTIONS_MAX).map(o => ({ id: o.id, label: cut(o.label, 60) }));
    out.push({
      id: `rig.ask:${a.id}`, kind: 'rig.ask', ...(qid ? { qid } : {}), text: cut(a.summary, TEXT_MAX), who: cut(a.from.seat, 100), ...(a.from.rig ? { rig: a.from.rig } : {}),
      qitem: a.id, ...(options.length && q ? { options, questionId: q.id } : {}), priority: a.priority, at: [a.createdAt, a.updatedAt].find(validAt) ?? EPOCH
    });
  }
  // A decision put to the user is immediate (spec §2): the island says it as soon as the task exists.
  for (const t of tasks) {
    if (!openDecision(t) || t.brain) continue;
    out.push({ id: `decision:${t.id}`, kind: 'decision', text: cut(t.title, TEXT_MAX), who: cut(t.giverName, 100), priority: 'routine', at: [t.at, t.updatedAt].find(validAt) ?? EPOCH });
  }
  return out;
}

/** The notices the island last got: told again only when they change, and replayed to a client that connects later. */
export function createNoticeFeed(send: (n: OperatorNotice[]) => void): { tell(n: OperatorNotice[]): void; current(): OperatorNotice[] | undefined } {
  let last: OperatorNotice[] | undefined;
  return {
    tell(n) { if (last !== undefined && JSON.stringify(n) === JSON.stringify(last)) return; last = n; send(n); },
    current: () => last
  };
}

/** One read of OpenRig's human channel, as `HumanChannelService.start` gives it. */
export interface AsksRead { channel?: { state: string }; asks: HumanAsk[]; partial?: boolean; truncated?: boolean }

/**
 * OpenRig's asks as the notices and the push see them, read after read. `read` returns the asks that are new and not routine: the
 * phone's push says them at once. The first list read is the baseline (what waited before the daemon started is not news); a channel
 * that is not ready lists nothing, so it changes nothing (the asks are not gone); a partial list keeps the rows it misses until a whole
 * one leaves them out, so a row read again is never new twice. `asks` is the list kept.
 */
export function createAskWatch(): { read(l: AsksRead): HumanAsk[]; asks(): HumanAsk[] } {
  let kept: HumanAsk[] | undefined;
  return {
    read(l) {
      if (l.channel && l.channel.state !== 'ready') return [];
      const before = kept;
      kept = before && (l.partial || l.truncated) ? [...l.asks, ...before.filter(a => !l.asks.some(x => x.id === a.id))] : l.asks;
      if (!before) return [];
      return l.asks.filter(a => a.priority !== 'routine' && !before.some(x => x.id === a.id));
    },
    asks: () => kept ?? []
  };
}
