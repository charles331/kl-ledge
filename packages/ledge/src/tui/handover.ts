import { randomUUID } from 'node:crypto';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import type { Toast } from './actions.js';
import type { Messages } from './i18n/lang.js';

/** Asks the daemon to hand a session over (context handover spec §3.3): H on the overview, and on a session whose relief failed
 *  (#40, D10). The toast says it started, or why the daemon refused it. */
export function handOver(client: DaemonClient, s: Session, t: Messages, toast: (x: Toast) => void): void {
  const rid = randomUUID();
  const off = client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) { off(); toast(m.ok ? { text: t.toast.handover(s.name), tone: 'ok' } : { text: t.toast.handoverRefused(m.reason ?? '?'), tone: 'info' }); } });
  setTimeout(off, 5000);
  client.send({ type: 'session.handover', rid, id: s.id });
}
