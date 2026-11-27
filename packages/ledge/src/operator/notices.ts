// The island's notices and the urgent asks' push left the operator (#40, D11): they are the daemon's own, `daemon/notices.ts`.
import type { PushPayload } from '@ledge/protocol';
import { cut, safeTag } from '../mobile/push/triggers.js';

const BODY_MAX = 120;

/**
 * The one push of a point: titled « Ledge », the lead as its body. The phone has no route per point (`apps/mobile/src/router.ts` knows
 * `#/chat` only), so the url is the chat tab, where the point is the last turn.
 */
export function pointPush(lead: string, badge: number): PushPayload {
  return { v: 1, kind: 'point', title: 'Ledge', body: cut(lead.trim(), BODY_MAX), url: '/#/chat', badge: Math.max(0, Math.min(999, badge)), tag: safeTag('point') };
}
