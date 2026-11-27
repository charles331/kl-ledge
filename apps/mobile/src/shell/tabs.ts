import type { HumanAsk } from '@ledge/protocol';
import type { InboxItem } from '../model/requests';
import { href, type Route } from '../router';

/**
 * The app's tabs (#40 D6, docs/mockups/ledge-remove-chat-d1-d3-d6.html, cards 7 and 10): three on the phone, always shown, in this
 * order (« À toi » and Ledge's chat left them); the tablet's rail adds the Atelier after Rigs.
 */
export type Tab = 'sessions' | 'prs' | 'rigs' | 'atelier';
export const PHONE_TABS = ['sessions', 'prs', 'rigs'] as const satisfies readonly Tab[];

/** The tab a screen belongs to: a session's request, a thread, a terminal or « Nouvelle session » to Sessions, an OpenRig ask to
 *  Rigs; none for Réglages. */
export function tabOf(r: Route): Tab | null {
  switch (r.name) {
    case 'sessions': case 'routines': case 'thread': case 'terminal': case 'launch': case 'request': return 'sessions';
    case 'prs': case 'rigs': return r.name;
    // An OpenRig ask is one of the Rigs tab's « Demandes » (#40 D1, card 3).
    case 'ask': return 'rigs';
    // A rig, the kernel and Max belong to the Rigs tab, even opened from Sessions (m4-rigs.html, §11, Q48).
    case 'rig': case 'kernel': case 'max': return 'rigs';
    // A request belongs to the MR/PR tab, even opened from a session's foot (Q60).
    case 'pr': return 'prs';
    case 'atelier': return 'atelier';
    case 'connection': return null;
  }
}

export const rootOf = (t: Tab): Route => ({ name: t });

/** The screen is its tab's first one, nothing opened over or beside it. */
export const isRoot = (r: Route): boolean => tabOf(r) === r.name && !(r.name === 'atelier' && r.sessionId);

/** Where each tab was left, since the page loaded: a tap on a tab goes back there. */
const left = new Map<Tab, string>();

/** The Atelier is not remembered: a session's panel opened over its floor closes once left, and the tab finds the floor. */
export function remember(r: Route): void {
  const t = tabOf(r);
  if (t && t !== 'atelier') left.set(t, href(r));
}

/** The address a tab's button leads to: the screen the tab was left on, or its root. */
export const tabHref = (t: Tab): string => left.get(t) ?? href(rootOf(t));

/** For the tests: forgets where the tabs were left. */
export const forgetTabs = (): void => left.clear();

const count = (n: number): string => (n > 99 ? '99+' : String(n));

/**
 * The Sessions tab's badge (#40 D7, docs/mockups/ledge-remove-chat-p2.html, card 6): the sessions' permissions in red; without one,
 * their questions and the decisions they put to Ledge (D2, answered in their thread) in amber; past 99, « 99+ ».
 */
export function sessionsBadge(items: readonly InboxItem[], decisions = 0): { text: string; tone: 'red' | 'amber' } | null {
  const perm = items.filter(i => i.filter === 'permission').length;
  if (perm) return { text: count(perm), tone: 'red' };
  const ask = items.length - perm + decisions;
  return ask ? { text: count(ask), tone: 'amber' } : null;
}

/** The Rigs tab's badge (D7, card 6): what OpenRig asks the person and is still open (a piece of news is no ask), in amber. */
export function rigsBadge(asks: readonly Pick<HumanAsk, 'kind'>[]): { text: string; tone: 'amber' } | null {
  const n = asks.filter(a => a.kind !== 'update').length;
  return n ? { text: count(n), tone: 'amber' } : null;
}
