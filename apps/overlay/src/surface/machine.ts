/**
 * The island's one movement (issue #27, docs/mockups/ledge-dynamic-island.html): nothing on screen; a pill comes out of the
 * top edge; it opens on a notification; it closes back to the pill, reopening at once on the next one if another waits;
 * it leaves. Pure: no timers, no clock. The controller runs the effects; delayed events stamped with a stale `rev` drop.
 */

/** What the island can show. `ask`: a session's request (permission, question, plan, diff); `ledge`: one of Ledge's own
 *  (a rig's question, a decision, a routine), its id prefixed `ledge:`. Both wait for the person. `finished`, `error` (a
 *  session's) and `offline` (a machine dropped) are notices, on a 6 s clock. */
export type ItemKind = 'ask' | 'ledge' | 'finished' | 'error' | 'offline';
/** The prefix of a Ledge request's id in the queue. */
export const LEDGE_PREFIX = 'ledge:';
/** A request's kind, read from its id: Ledge's own, or a session's. */
const requestOf = (id: string): Item => ({ id, kind: id.startsWith(LEDGE_PREFIX) ? 'ledge' : 'ask' });
/** A request waits for the person; a notice runs on its clock. */
export const isRequestKind = (kind: ItemKind) => kind === 'ask' || kind === 'ledge';
export interface Item { id: string; kind: ItemKind }
/** Where the island is: nothing on screen, the small pill it passes through on the way in and out, or open. */
export type Phase = 'gone' | 'seed' | 'open';
/** A decision taken on the island: « Envoyé, en attente du terminal » until the daemon confirms it, then « Reçu » for 900 ms,
 *  then the island closes (design-ux, states of an agent's card). No timer ever settles an unconfirmed decision. */
export interface Ack { id: string; confirmed: boolean }

export interface SurfaceState {
  phase: Phase;
  /** What the island shows, or is about to show (phase `seed`), or is leaving with (closing). */
  current: Item | null;
  /** On the way back: the pill is closing (or, from it, leaving), not coming out. */
  closing: boolean;
  /** Every request waiting (a session's or Ledge's), oldest first, the one shown included until it is cleared. */
  queue: string[];
  /** Requests set aside with « Plus tard », or that came in while quiet: they open again only through Ctrl+Alt+L. */
  deferred: string[];
  /** Notices waiting their turn, oldest first. Requests always pass before them. */
  notices: Item[];
  /** Do not disturb: nothing opens; requests wait set aside, notices are dropped. */
  quiet: boolean;
  /** Hidden from Ledge Desktop: nothing on screen and nothing opens; the requests wait and open once it is shown again. */
  off: boolean;
  /** Reduced motion: no trip through the pill, the island fades in open and fades out. */
  reduced: boolean;
  /** What holds a notice's clock: the pointer over the island, focus inside it, a hidden document. */
  hovering: boolean; focusWithin: boolean; hidden: boolean;
  ack: Ack | null;
  /** The request whose decision ended in a terminal error: its actions are unlocked again. */
  failed: string | null;
  /** The island was opened from Ctrl+Alt+L: it took the focus, and gives it back when it leaves. */
  openedBy: 'keyboard' | null;
  /** The request Ctrl+Alt+L asked for: it is the next one shown, even during Do not disturb. */
  forced: string | null;
  /** Bumped whenever what is shown or its phase changes: delayed events carrying an older rev are ignored. */
  rev: number;
}

export type TimerName = 'appear' | 'notice' | 'hold' | 'close' | 'leave';
export type Effect =
  | { type: 'startTimer'; name: TimerName; ms: number } | { type: 'cancelTimer'; name: TimerName }
  | { type: 'pauseTimer'; name: 'notice' } | { type: 'resumeTimer'; name: 'notice' };
/** `rev` is stamped by the controller on timer events; omitted, the event is accepted. */
type Elapsed<T extends string> = { type: T; rev?: number };
export type SurfaceEvent =
  | { type: 'ask'; id: string; /** It comes back where it was, at the head of the line (a refused answer). */ first?: boolean } | { type: 'askCleared'; id: string } | { type: 'askReplaced'; id: string } | { type: 'removed'; id: string }
  | { type: 'notice'; id: string; kind: 'finished' | 'error' | 'offline' }
  | Elapsed<'appearElapsed'> | Elapsed<'noticeElapsed'> | Elapsed<'holdElapsed'> | Elapsed<'closeElapsed'> | Elapsed<'leaveElapsed'>
  | { type: 'surfaceEnter' } | { type: 'surfaceLeave' } | { type: 'focusWithin'; on: boolean } | { type: 'visibility'; hidden: boolean }
  | { type: 'decided' } | { type: 'decisionFailed'; id: string } | { type: 'defer' } | { type: 'dismiss' }
  | { type: 'shortcut' } | { type: 'dnd'; on: boolean } | { type: 'reduced'; on: boolean } | { type: 'visible'; on: boolean };

/** The movement's times (ms): out of the edge, open, back to the pill, gone. The CSS transitions use the same. */
export const MOTION_MS = { appear: 260, open: 420, close: 320, leave: 240 } as const;
/** How long a notice stays open, and how long « Reçu » shows after a decision (today's, kept). */
export const NOTICE_MS = 6000;
export const ACK_MS = 900;
export const ELAPSED: Record<TimerName, 'appearElapsed' | 'noticeElapsed' | 'holdElapsed' | 'closeElapsed' | 'leaveElapsed'> =
  { appear: 'appearElapsed', notice: 'noticeElapsed', hold: 'holdElapsed', close: 'closeElapsed', leave: 'leaveElapsed' };

export const initialSurface = (): SurfaceState => ({
  phase: 'gone', current: null, closing: false, queue: [], deferred: [], notices: [], quiet: false, off: false, reduced: false,
  hovering: false, focusWithin: false, hidden: false, ack: null, failed: null, openedBy: null, forced: null, rev: 0
});

type Result = { state: SurfaceState; effects: Effect[] };
const start = (name: TimerName, ms: number): Effect => ({ type: 'startTimer', name, ms });
const cancel = (name: TimerName): Effect => ({ type: 'cancelTimer', name });
const ALL: TimerName[] = ['appear', 'notice', 'hold', 'close', 'leave'];
const same = (s: SurfaceState): Result => ({ state: s, effects: [] });
const held = (s: SurfaceState) => s.hovering || s.focusWithin || s.hidden;
/** A notice runs on a clock; a request waits for the person. */
export const timed = (kind: ItemKind) => !isRequestKind(kind);
const without = (list: string[], id: string) => list.filter(x => x !== id);

/** The next thing to show: the oldest request not set aside, then the oldest notice. Never during quiet. */
function nextItem(s: SurfaceState): Item | null {
  if (s.off) return null;
  if (s.forced !== null && s.queue.includes(s.forced)) return requestOf(s.forced);
  if (s.quiet) return null;
  const ask = s.queue.find(id => !s.deferred.includes(id) && id !== s.current?.id);
  if (ask !== undefined) return requestOf(ask);
  return s.notices[0] ?? null;
}

/** What waits behind the item shown: « +2 autres », and « Plus tard » turning into « Plus tard, suivante ». */
export function waitingCount(s: SurfaceState): number {
  if (s.quiet) return 0;
  return s.queue.filter(id => !s.deferred.includes(id) && id !== s.current?.id).length + s.notices.length;
}

/** A notice's clock once its card is open: paused at once when something already holds it. */
const openEffects = (s: SurfaceState, item: Item): Effect[] =>
  timed(item.kind) ? [start('notice', NOTICE_MS), ...(held(s) ? [{ type: 'pauseTimer', name: 'notice' } as Effect] : [])] : [];

/** Takes `item` as the one shown. From the pill it opens after `appear`; with reduced motion it fades in open at once. */
function show(s: SurfaceState, item: Item, extra: Effect[] = []): Result {
  const next: SurfaceState = { ...s, current: item, closing: false, ack: null, failed: null, notices: s.notices.filter(n => n.id !== item.id), forced: s.forced === item.id ? null : s.forced };
  if (s.reduced) return { state: { ...next, phase: 'open' }, effects: [...extra, cancel('close'), cancel('leave'), ...openEffects(next, item)] };
  return { state: { ...next, phase: 'seed' }, effects: [...extra, cancel('close'), cancel('leave'), start('appear', MOTION_MS.appear)] };
}

/** Starts the island off the screen when it rests and something waits. */
function pump(r: Result): Result {
  const s = r.state;
  if (s.current !== null || s.phase !== 'gone') return r;
  const item = nextItem(s);
  return item ? show(s, item, r.effects) : r;
}

/** Back to the pill (or, with reduced motion, straight to the fade out). Whatever clock ran stops. */
function close(s: SurfaceState): Result {
  if (s.current === null || s.closing) return same(s);
  const stop = [cancel('appear'), cancel('notice'), cancel('hold')];
  if (s.reduced) return { state: { ...s, phase: 'gone', closing: true, ack: null }, effects: [...stop, start('leave', MOTION_MS.leave)] };
  return { state: { ...s, phase: 'seed', closing: true, ack: null }, effects: [...stop, start('close', MOTION_MS.close)] };
}

/** Pause or resume a notice's clock when the set of holds flips (never during an acknowledgement or on the way out). */
function holdEffects(before: SurfaceState, after: SurfaceState): Effect[] {
  if (after.phase !== 'open' || after.closing || !after.current || !timed(after.current.kind) || held(before) === held(after)) return [];
  return [{ type: held(after) ? 'pauseTimer' : 'resumeTimer', name: 'notice' }];
}

/** The daemon confirmed the decision: « Reçu » for 900 ms, then the island closes. */
function confirm(s: SurfaceState): Result {
  if (s.ack!.confirmed) return same(s);
  return { state: { ...s, ack: { ...s.ack!, confirmed: true } }, effects: [start('hold', ACK_MS)] };
}

function step(s: SurfaceState, e: SurfaceEvent): Result {
  switch (e.type) {
    case 'ask': {
      const queue = e.first ? [e.id, ...without(s.queue, e.id)] : s.queue.includes(e.id) ? s.queue : [...s.queue, e.id];
      // During Do not disturb a request waits set aside: Ctrl+Alt+L opens it, nothing else does.
      const deferred = s.quiet && !s.deferred.includes(e.id) ? [...s.deferred, e.id] : s.deferred;
      return pump(same({ ...s, queue, deferred }));
    }
    case 'notice': {
      // The same notice already open is not shown twice; a session's notice after its own request (a turn that ends right
      // after an answer) waits behind it.
      if (s.quiet || (s.current?.id === e.id && !isRequestKind(s.current.kind))) return same(s);
      const item: Item = { id: e.id, kind: e.kind };
      const notices = s.notices.some(n => n.id === e.id) ? s.notices.map(n => (n.id === e.id ? item : n)) : [...s.notices, item];
      return pump(same({ ...s, notices }));
    }
    case 'askCleared': {
      const next = { ...s, queue: without(s.queue, e.id), deferred: without(s.deferred, e.id) };
      if (s.current && isRequestKind(s.current.kind) && s.current.id === e.id && !s.closing) return s.ack?.id === e.id ? confirm(next) : close(next);
      return same(next);
    }
    /* The session's request was replaced in place. A decision in progress is confirmed (the old request is gone) and the new
       one comes next; without one, the card shows the new request where it is. */
    case 'askReplaced': {
      if (!s.current || !isRequestKind(s.current.kind) || s.current.id !== e.id || s.closing) return same(s);
      const queue = s.queue.includes(e.id) ? s.queue : [e.id, ...s.queue];
      const deferred = without(s.deferred, e.id);
      if (s.ack?.id === e.id) return confirm({ ...s, queue, deferred });
      return same({ ...s, queue, deferred, failed: null });
    }
    case 'removed': {
      const next = { ...s, queue: without(s.queue, e.id), deferred: without(s.deferred, e.id), notices: s.notices.filter(n => n.id !== e.id) };
      if (s.current?.id === e.id && !s.closing) return s.ack?.id === e.id ? confirm(next) : close(next);
      return same(next);
    }
    case 'appearElapsed': {
      if (s.phase !== 'seed' || s.closing || !s.current) return same(s);
      return { state: { ...s, phase: 'open' }, effects: openEffects(s, s.current) };
    }
    case 'noticeElapsed':
      return s.phase === 'open' && s.current && timed(s.current.kind) ? close(s) : same(s);
    case 'holdElapsed': return s.ack?.confirmed ? close(s) : same(s);
    // Back on the pill: the next notification takes its place at once, or the island leaves.
    case 'closeElapsed': {
      if (!s.closing) return same(s);
      const item = nextItem({ ...s, current: null });
      if (item) return show(s, item);
      return { state: { ...s, phase: 'gone' }, effects: [start('leave', MOTION_MS.leave)] };
    }
    // Gone: nothing on screen. Something that came meanwhile starts the movement again.
    case 'leaveElapsed': {
      if (!s.closing) return same(s);
      return pump(same({ ...s, phase: 'gone', current: null, closing: false, ack: null, failed: null, openedBy: s.forced !== null ? s.openedBy : null }));
    }
    case 'surfaceEnter': { const next = { ...s, hovering: true }; return { state: next, effects: holdEffects(s, next) }; }
    case 'surfaceLeave': { const next = { ...s, hovering: false }; return { state: next, effects: holdEffects(s, next) }; }
    case 'focusWithin': { const next = { ...s, focusWithin: e.on }; return { state: next, effects: holdEffects(s, next) }; }
    case 'visibility': { const next = { ...s, hidden: e.hidden }; return { state: next, effects: holdEffects(s, next) }; }
    case 'decided': {
      if (s.phase !== 'open' || s.closing || !s.current || !isRequestKind(s.current.kind) || s.ack) return same(s);
      return same({ ...s, ack: { id: s.current.id, confirmed: false }, failed: null });
    }
    /* A terminal error for the decision: the actions unlock again, never a success. */
    case 'decisionFailed': {
      if (!s.current || !isRequestKind(s.current.kind) || s.current.id !== e.id || s.closing) return same(s);
      return { state: { ...s, ack: null, failed: e.id }, effects: [cancel('hold')] };
    }
    // « Plus tard » (or Esc) on a request: set aside, the island moves on.
    case 'defer': {
      if (!s.current || !isRequestKind(s.current.kind) || s.closing || s.ack) return same(s);
      const id = s.current.id;
      return close({ ...s, deferred: s.deferred.includes(id) ? s.deferred : [...s.deferred, id] });
    }
    // A notice clicked (opened in Ledge) or dismissed with Esc; a request opened in Ledge (it stays waiting there).
    case 'dismiss': {
      if (s.current && isRequestKind(s.current.kind) && !s.closing && !s.ack) return close({ ...s, deferred: s.deferred.includes(s.current.id) ? s.deferred : [...s.deferred, s.current.id] });
      return close(s);
    }
    /* Ctrl+Alt+L: the oldest request still waiting (a session's or Ledge's), set aside or not. Without one it does nothing. */
    case 'shortcut': {
      const oldest = s.queue[0];
      if (s.off || oldest === undefined) return same(s);
      // Already open: the island takes the focus for its keys, so it must give it back once it leaves.
      if (s.current?.id === oldest && !s.closing) return same({ ...s, openedBy: 'keyboard' });
      const next = { ...s, deferred: without(s.deferred, oldest), forced: oldest, openedBy: 'keyboard' as const };
      if (s.current === null && s.phase === 'gone') return show(next, requestOf(oldest));
      // Something else shows: it closes, and the pill reopens on the request.
      return s.closing ? same(next) : close(next);
    }
    /* Do not disturb on: the island closes, the requests wait set aside, the notices are dropped. Off reopens nothing. */
    case 'dnd': {
      if (!e.on) return same({ ...s, quiet: false });
      const deferred = [...s.deferred, ...s.queue.filter(id => !s.deferred.includes(id))];
      return close({ ...s, quiet: true, deferred, notices: [] });
    }
    case 'reduced': return same({ ...s, reduced: e.on });
    /* Hidden from Desktop: nothing on screen at once, the notices are dropped, the requests wait. Shown again, the oldest
       request opens. */
    case 'visible': {
      if (e.on) return s.off ? pump(same({ ...s, off: false })) : same(s);
      return { state: { ...s, off: true, phase: 'gone', current: null, closing: false, notices: [], ack: null, failed: null, openedBy: null, forced: null }, effects: ALL.map(cancel) };
    }
  }
}

/** Pure: no timers, no clock. Delayed events stamped with a stale `rev` are dropped. */
export function transition(s: SurfaceState, e: SurfaceEvent): Result {
  if ('rev' in e && e.rev !== undefined && e.rev !== s.rev) return same(s);
  const r = step(s, e);
  const n = r.state;
  if (n !== s && (n.phase !== s.phase || n.current?.id !== s.current?.id || n.current?.kind !== s.current?.kind || n.closing !== s.closing)) return { state: { ...n, rev: s.rev + 1 }, effects: r.effects };
  return r;
}
