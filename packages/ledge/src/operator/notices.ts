import { openDecision, type ChatPoint, type HumanAsk, type OperatorNotice, type PushPayload, type Task } from '@ledge/protocol';
import { cut, safeTag } from '../mobile/push/triggers.js';

const TEXT_MAX = 300;
const OPTIONS_MAX = 3;
const BODY_MAX = 120;
/** A time that never changes, for an ask whose own times are unreadable: a notice must not differ between two calls. */
const EPOCH = '1970-01-01T00:00:00.000Z';

const validAt = (s: string): boolean => Number.isFinite(Date.parse(s)) && /^\d{4}-\d\d-\d\dT.*Z$/.test(s);

/** A rig ask with every question answered has nothing left to put to the user. */
const settledAsk = (a: HumanAsk): boolean => a.questions.length > 0 && a.questions.every(q => q.answer !== null);

/**
 * What the notch is told (spec §7): every urgent or critical rig ask not settled, with its first open question's options, and the qid
 * of the newest point holding it (none: the front answers it in « À toi »); and every open decision put to the user (`tasks`). The
 * point itself left the notch with the dynamic island (#27): it stays in the chat, and the phone has its own push (`pointPush`).
 * Session requests are not notices: the notch's request cards stay fed by the sessions. `points` are oldest first.
 */
export function noticesOf(points: Array<{ qid: string; point: ChatPoint }>, asks: readonly HumanAsk[], tasks: readonly Task[] = []): OperatorNotice[] {
  const out: OperatorNotice[] = [];
  /** The newest point holding a rig ask's unsettled row, set aside or not: the notch answers the ask through that point. */
  const holder = (askId: string): string | undefined =>
    points.filter(({ point }) => point.items.some(i => i.id === `rig.ask:${askId}` && !i.settled)).at(-1)?.qid;
  for (const a of asks) {
    if ((a.priority !== 'urgent' && a.priority !== 'critical') || settledAsk(a)) continue;
    const qid = holder(a.id);
    const q = a.questions.find(x => x.answer === null) ?? a.questions[0];
    const options = (q?.options ?? []).slice(0, OPTIONS_MAX).map(o => ({ id: o.id, label: cut(o.label, 60) }));
    out.push({
      id: `rig.ask:${a.id}`, kind: 'rig.ask', ...(qid ? { qid } : {}), text: cut(a.summary, TEXT_MAX), who: cut(a.from.seat, 100), ...(a.from.rig ? { rig: a.from.rig } : {}),
      qitem: a.id, ...(options.length ? { options } : {}), priority: a.priority, at: [a.createdAt, a.updatedAt].find(validAt) ?? EPOCH
    });
  }
  // A decision put to the user is immediate (spec §2): the notch says it as soon as the task exists, not at the next point.
  for (const t of tasks) {
    if (!openDecision(t) || t.brain) continue;
    out.push({ id: `decision:${t.id}`, kind: 'decision', text: cut(t.title, TEXT_MAX), who: cut(t.giverName, 100), priority: 'routine', at: [t.at, t.updatedAt].find(validAt) ?? EPOCH });
  }
  return out;
}

/**
 * The one push of a point: titled « Ledge », the lead as its body. The phone has no route per point (`apps/mobile/src/router.ts` knows
 * `#/chat` only), so the url is the chat tab, where the point is the last turn.
 */
export function pointPush(lead: string, badge: number): PushPayload {
  return { v: 1, kind: 'point', title: 'Ledge', body: cut(lead.trim(), BODY_MAX), url: '/#/chat', badge: Math.max(0, Math.min(999, badge)), tag: safeTag('point') };
}

/** The notices the notch last got: told again only when they change, and replayed to a client that connects later. */
export function createNoticeFeed(send: (n: OperatorNotice[]) => void): { tell(n: OperatorNotice[]): void; current(): OperatorNotice[] | undefined } {
  let last: OperatorNotice[] | undefined;
  return {
    tell(n) { if (last !== undefined && JSON.stringify(n) === JSON.stringify(last)) return; last = n; send(n); },
    current: () => last
  };
}
