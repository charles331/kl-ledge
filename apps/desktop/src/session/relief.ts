import { contextNear, contextShare, type Handover } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';

/** A relief under way, failed, or done with no relief to open (context handover spec §3.3): its state, by whom, why. */
export const reliefText = (h: Handover, th: Messages['handover']): string =>
  `${th.state[h.state]}${h.auto ? ` · ${th.auto}` : ''}${h.reason ? ` : ${h.reason}` : ''}`;

/** The relief is done and names the session that took over: it opens; otherwise its state is said. */
export const reliefDone = (h: Handover): h is Handover & { to: string } => h.state === 'done' && !!h.to;

/** The session page's strip for a failed handover (#40 D10): shown while it is failed and the session is still near its limit
 *  (unmeasured counts as near); it closes once a retry is under way or done, or the session dropped under the threshold. */
export const reliefFailedShown = (s: { handover?: Handover | undefined; context?: Parameters<typeof contextNear>[0] }, near: number): boolean =>
  s.handover?.state === 'failed' && (contextShare(s.context) === undefined || contextNear(s.context, near));
