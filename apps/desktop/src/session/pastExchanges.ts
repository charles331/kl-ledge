import { useSyncExternalStore } from 'react';

/**
 * How the thread shows a past exchange (issue #41, the owner's choice of 2026-11-27): its texts and actions folded under « Travail »,
 * its request and its answer kept in sight (default), or everything open. Kept on this machine under its own key. Its place in
 * Settings waits for its mockup; until then only this module sets it.
 */
export type PastExchanges = 'folded' | 'open';
export const PAST_EXCHANGES_KEY = 'desktop.pastExchanges';

const read = (): PastExchanges => { try { return localStorage.getItem(PAST_EXCHANGES_KEY) === 'open' ? 'open' : 'folded'; } catch { return 'folded'; } };
let value: PastExchanges = read();
const subscribers = new Set<() => void>();

export const getPastExchanges = (): PastExchanges => value;

export function setPastExchanges(v: PastExchanges): void {
  value = v;
  try { localStorage.setItem(PAST_EXCHANGES_KEY, v); } catch { /* not kept: still applied */ }
  subscribers.forEach(f => f());
}

export const usePastExchanges = (): PastExchanges => useSyncExternalStore(f => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => value);

/** For tests: read the key again (a test that writes localStorage before mounting). */
export const reloadPastExchanges = (): void => { value = read(); };
