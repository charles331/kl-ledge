import { useEffect, useSyncExternalStore } from 'react';
import { useMachines, type DaemonClient } from '@ledge/fleet';
import type { Aside, Session } from '@ledge/protocol';

/**
 * The asides (« /btw », #41) this window asked, by session: shown under the thread, outside it, until closed. Only the ones asked
 * here are kept: a daemon replays its last asides after each snapshot, which serves a reconnection while one is under way, not a
 * history (they do not outlive the session's tab: `forgetAsides`).
 */
const bySession = new Map<string, readonly Aside[]>();
const listeners = new Set<() => void>();
const NONE: readonly Aside[] = [];
let next = 0;
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const asidesOf = (id: string): readonly Aside[] => bySession.get(id) ?? NONE;

/** Asks `question` aside of session `id` (its qualified id). The aside shows at once, « asking », until the daemon answers. */
export function askAside(client: DaemonClient, id: string, question: string): void {
  const rid = `${Date.now().toString(36)}-${++next}`;
  bySession.set(id, [...asidesOf(id), { rid, question, askedAt: new Date().toISOString(), state: 'asking' }]);
  emit();
  client.send({ type: 'session.aside', id, rid, question });
}

/** Closes an aside: gone from under the thread (the daemon is not told: it has nothing to undo). */
export function closeAside(id: string, rid: string): void {
  bySession.set(id, asidesOf(id).filter(a => a.rid !== rid));
  emit();
}

/** Forgets a session's asides: its tab closed. */
export function forgetAsides(id: string): void {
  if (bySession.delete(id)) emit();
}

/** A session's asides, kept up to date with what its daemon says of the ones asked here. */
export function useAsides(client: DaemonClient, id: string): readonly Aside[] {
  useEffect(() => client.onMessage(m => {
    if (m.type !== 'session.aside' || m.id !== id || !('aside' in m)) return;
    const list = asidesOf(id);
    if (!list.some(a => a.rid === m.aside.rid)) return;
    bySession.set(id, list.map(a => (a.rid === m.aside.rid ? m.aside : a)));
    emit();
  }), [client, id]);
  return useSyncExternalStore(subscribe, () => asidesOf(id), () => asidesOf(id));
}

const NO_CLIENT = {} as DaemonClient;
/** Whether a « /btw » typed in this session's field is an aside: a Claude Code session whose daemon takes them (DaemonInfo.aside). */
export function useTakesAsides(client: DaemonClient | undefined, session: Pick<Session, 'tool' | 'machineId'>): boolean {
  // Without a client, no machine: useMachines reads none.
  const daemon = useMachines(client ?? NO_CLIENT).find(m => m.id === (session.machineId ?? 'local'))?.daemon;
  return !!client && session.tool === 'claude' && daemon?.aside === true;
}

/** Whether an aside of session `id` asked here still waits for its answer: the daemon refuses a reply meanwhile (busy). */
export const useAsking = (id: string): boolean => useSyncExternalStore(subscribe, () => asidesOf(id).some(a => a.state === 'asking'), () => false);

/** For tests. */
export const resetAsidesForTests = (): void => { bySession.clear(); emit(); };
