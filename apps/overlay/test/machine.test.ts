import { describe, it, expect } from 'vitest';
import { transition, initialSurface, waitingCount, MOTION_MS, NOTICE_MS, ACK_MS, type SurfaceEvent, type SurfaceState, type Effect } from '../src/surface/machine';

/** Runs events from rest (or `from`), returning the last state and the effects of the last event. */
function run(events: SurfaceEvent[], from: SurfaceState = initialSurface()) {
  let s = from; let effects: Effect[] = [];
  for (const e of events) { const r = transition(s, e); s = r.state; effects = r.effects; }
  return { s, effects };
}
const started = (effects: Effect[]) => effects.filter(e => e.type === 'startTimer').map(e => (e as { name: string; ms: number }).name + ':' + (e as { ms: number }).ms);
const has = (effects: Effect[], type: Effect['type'], name: string) => effects.some(e => e.type === type && e.name === name);
/** From rest to an open card: out of the edge, then open. */
const opened = (first: SurfaceEvent): SurfaceEvent[] => [first, { type: 'appearElapsed' }];

describe('the island’s movement (issue #27)', () => {
  it('rests with nothing on screen', () => {
    const s = initialSurface();
    expect(s.phase).toBe('gone'); expect(s.current).toBeNull();
  });

  it('a notice comes out of the edge (260 ms), opens with a 6 s clock, closes back to the pill (320 ms), then leaves (240 ms)', () => {
    let r = run([{ type: 'notice', id: 'otto', kind: 'finished' }]);
    expect(r.s.phase).toBe('seed'); expect(r.s.current).toEqual({ id: 'otto', kind: 'finished' }); expect(r.s.closing).toBe(false);
    expect(started(r.effects)).toEqual([`appear:${MOTION_MS.appear}`]);
    r = run([{ type: 'appearElapsed' }], r.s);
    expect(r.s.phase).toBe('open'); expect(started(r.effects)).toEqual([`notice:${NOTICE_MS}`]);
    r = run([{ type: 'noticeElapsed' }], r.s);
    expect(r.s.phase).toBe('seed'); expect(r.s.closing).toBe(true); expect(started(r.effects)).toEqual([`close:${MOTION_MS.close}`]);
    r = run([{ type: 'closeElapsed' }], r.s);
    expect(r.s.phase).toBe('gone'); expect(r.s.current).not.toBeNull(); expect(started(r.effects)).toEqual([`leave:${MOTION_MS.leave}`]);
    r = run([{ type: 'leaveElapsed' }], r.s);
    expect(r.s.phase).toBe('gone'); expect(r.s.current).toBeNull();
  });

  it('a request has no clock: it stays open until an answer or « Plus tard »', () => {
    const r = run(opened({ type: 'ask', id: 'pim' }));
    expect(r.s.phase).toBe('open'); expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' });
    expect(started(r.effects)).toEqual([]);
    expect(run([{ type: 'noticeElapsed' }], r.s).s.phase).toBe('open');
  });

  it('the hover holds a notice’s clock and lets it go; a card opening under the pointer starts held', () => {
    const open = run(opened({ type: 'notice', id: 'otto', kind: 'finished' })).s;
    const enter = transition(open, { type: 'surfaceEnter' });
    expect(has(enter.effects, 'pauseTimer', 'notice')).toBe(true);
    const leave = transition(enter.state, { type: 'surfaceLeave' });
    expect(has(leave.effects, 'resumeTimer', 'notice')).toBe(true);
    const r = run([{ type: 'surfaceEnter' }, { type: 'notice', id: 'otto', kind: 'finished' }, { type: 'appearElapsed' }]);
    expect(has(r.effects, 'startTimer', 'notice') && has(r.effects, 'pauseTimer', 'notice')).toBe(true);
  });

  it('one at a time, requests before notices: back on the pill it reopens at once on the next, without leaving', () => {
    let s = run(opened({ type: 'notice', id: 'otto', kind: 'finished' })).s;
    s = run([{ type: 'notice', id: 'iris', kind: 'error' }, { type: 'ask', id: 'pim' }], s).s;
    expect(s.current?.id).toBe('otto');
    expect(waitingCount(s)).toBe(2);
    const r = run([{ type: 'noticeElapsed' }, { type: 'closeElapsed' }], s);
    expect(r.s.phase).toBe('seed'); expect(r.s.closing).toBe(false); expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' });
    expect(started(r.effects)).toEqual([`appear:${MOTION_MS.appear}`]);
    expect(waitingCount(r.s)).toBe(1);
  });

  it('a decision shows « Envoyé » until the terminal confirms it, then « Reçu » for 900 ms, then the island closes', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'decided' }]);
    expect(r.s.ack).toEqual({ id: 'pim', confirmed: false }); expect(started(r.effects)).toEqual([]);
    r = run([{ type: 'holdElapsed' }], r.s);
    expect(r.s.phase).toBe('open');
    r = run([{ type: 'askCleared', id: 'pim' }], r.s);
    expect(r.s.ack).toEqual({ id: 'pim', confirmed: true }); expect(started(r.effects)).toEqual([`hold:${ACK_MS}`]);
    expect(r.s.queue).toEqual([]);
    r = run([{ type: 'holdElapsed' }], r.s);
    expect(r.s.phase).toBe('seed'); expect(r.s.closing).toBe(true);
  });

  it('a refused decision unlocks the card, which stays open', () => {
    const r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'decided' }, { type: 'decisionFailed', id: 'pim' }]);
    expect(r.s.ack).toBeNull(); expect(r.s.failed).toBe('pim'); expect(r.s.phase).toBe('open');
  });

  it('a request answered elsewhere closes the island', () => {
    const r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'askCleared', id: 'pim' }]);
    expect(r.s.closing).toBe(true);
  });

  it('a request replaced in place stays open on the new one; one replaced after a decision is confirmed and comes back next', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'askReplaced', id: 'pim' }]);
    expect(r.s.phase).toBe('open'); expect(r.s.closing).toBe(false);
    r = run([{ type: 'decided' }, { type: 'askReplaced', id: 'pim' }], r.s);
    expect(r.s.ack?.confirmed).toBe(true); expect(r.s.queue).toEqual(['pim']);
    r = run([{ type: 'holdElapsed' }, { type: 'closeElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' }); expect(r.s.closing).toBe(false);
  });

  it('« Plus tard » sets the request aside: the island leaves and does not reopen on it', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'defer' }]);
    expect(r.s.closing).toBe(true); expect(r.s.deferred).toEqual(['pim']);
    r = run([{ type: 'closeElapsed' }, { type: 'leaveElapsed' }], r.s);
    expect(r.s.current).toBeNull(); expect(r.s.queue).toEqual(['pim']);
    // Something else that comes opens; the request set aside does not come with it.
    r = run([{ type: 'notice', id: 'otto', kind: 'finished' }], r.s);
    expect(r.s.current?.id).toBe('otto'); expect(waitingCount(r.s)).toBe(0);
  });

  it('« Plus tard, suivante »: with another request waiting, the island reopens on it', () => {
    const r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'ask', id: 'bix' }, { type: 'defer' }, { type: 'closeElapsed' }]);
    expect(r.s.current).toEqual({ id: 'bix', kind: 'ask' }); expect(r.s.phase).toBe('seed');
  });

  it('Ctrl+Alt+L reopens the oldest request still waiting; without one it does nothing', () => {
    expect(run([{ type: 'shortcut' }]).s).toEqual(initialSurface());
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'defer' }, { type: 'closeElapsed' }, { type: 'leaveElapsed' }, { type: 'shortcut' }]);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' }); expect(r.s.phase).toBe('seed'); expect(r.s.openedBy).toBe('keyboard');
    expect(r.s.deferred).toEqual([]);
    // Over a notice: it closes, and the pill reopens on the request.
    r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'defer' }, { type: 'closeElapsed' }, { type: 'leaveElapsed' }, ...opened({ type: 'notice', id: 'otto', kind: 'finished' }), { type: 'shortcut' }]);
    expect(r.s.closing).toBe(true);
    r = run([{ type: 'closeElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' });
  });

  it('Ctrl+Alt+L on the request already open marks it opened from the keyboard, so the focus is given back once it leaves (review 575f5fb8, 1)', () => {
    const open = run(opened({ type: 'ask', id: 'pim' })).s;
    expect(open.openedBy).toBeNull();
    let r = run([{ type: 'shortcut' }], open);
    expect(r.s.openedBy).toBe('keyboard'); expect(r.s.phase).toBe('open'); expect(r.effects).toEqual([]);
    // Still coming out of the edge: the same.
    expect(run([{ type: 'ask', id: 'pim' }, { type: 'shortcut' }]).s.openedBy).toBe('keyboard');
    r = run([{ type: 'decided' }, { type: 'askCleared', id: 'pim' }, { type: 'holdElapsed' }, { type: 'closeElapsed' }], r.s);
    expect(r.s.openedBy).toBe('keyboard');
    r = run([{ type: 'leaveElapsed' }], r.s);
    expect(r.s.current).toBeNull(); expect(r.s.openedBy).toBeNull();
  });

  it('a session’s finish right after its own request is answered waits behind it, then opens (review 575f5fb8, 2)', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'decided' }, { type: 'notice', id: 'pim', kind: 'finished' }, { type: 'askCleared', id: 'pim' }]);
    expect(r.s.notices).toEqual([{ id: 'pim', kind: 'finished' }]);
    r = run([{ type: 'holdElapsed' }, { type: 'closeElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'finished' }); expect(r.s.closing).toBe(false);
    // The same notice while it is open is not queued twice.
    r = run([{ type: 'appearElapsed' }, { type: 'notice', id: 'pim', kind: 'finished' }], r.s);
    expect(r.s.notices).toEqual([]);
  });

  it('a request that comes back first takes the head of the line', () => {
    const r = run([{ type: 'visible', on: false }, { type: 'ask', id: 'a' }, { type: 'ask', id: 'b' }, { type: 'ask', id: 'b', first: true }]);
    expect(r.s.queue).toEqual(['b', 'a']);
  });

  it('a notice clicked closes the island', () => {
    expect(run([...opened({ type: 'notice', id: 'otto', kind: 'finished' }), { type: 'dismiss' }]).s.closing).toBe(true);
  });

  it('Do not disturb: the island closes, requests wait set aside, notices are dropped; nothing opens; off reopens nothing; Ctrl+Alt+L still does', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'notice', id: 'otto', kind: 'finished' }, { type: 'dnd', on: true }]);
    expect(r.s.closing).toBe(true); expect(r.s.notices).toEqual([]); expect(r.s.deferred).toEqual(['pim']);
    r = run([{ type: 'closeElapsed' }, { type: 'leaveElapsed' }, { type: 'ask', id: 'bix' }, { type: 'notice', id: 'iris', kind: 'error' }], r.s);
    expect(r.s.current).toBeNull(); expect(r.s.deferred).toEqual(['pim', 'bix']); expect(r.s.notices).toEqual([]);
    r = run([{ type: 'dnd', on: false }], r.s);
    expect(r.s.current).toBeNull();
    r = run([{ type: 'dnd', on: true }, { type: 'shortcut' }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' }); expect(r.s.quiet).toBe(true);
  });

  it('reduced motion: no trip through the pill, a fade in open and a fade out', () => {
    let r = run([{ type: 'reduced', on: true }, { type: 'notice', id: 'otto', kind: 'finished' }]);
    expect(r.s.phase).toBe('open'); expect(started(r.effects)).toEqual([`notice:${NOTICE_MS}`]);
    r = run([{ type: 'noticeElapsed' }], r.s);
    expect(r.s.phase).toBe('gone'); expect(r.s.closing).toBe(true); expect(started(r.effects)).toEqual([`leave:${MOTION_MS.leave}`]);
    r = run([{ type: 'ask', id: 'pim' }, { type: 'leaveElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' }); expect(r.s.phase).toBe('open');
  });

  it('a session removed while shown closes the island; removed while waiting, it is forgotten', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'notice', id: 'otto', kind: 'finished' }, { type: 'removed', id: 'otto' }]);
    expect(r.s.notices).toEqual([]); expect(r.s.closing).toBe(false);
    r = run([{ type: 'removed', id: 'pim' }], r.s);
    expect(r.s.closing).toBe(true); expect(r.s.queue).toEqual([]);
  });

  it('hidden from Desktop: nothing on screen at once, nothing opens; shown again, the oldest request opens', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'notice', id: 'otto', kind: 'finished' }, { type: 'visible', on: false }]);
    expect(r.s.phase).toBe('gone'); expect(r.s.current).toBeNull(); expect(r.s.notices).toEqual([]);
    expect(r.effects.every(e => e.type === 'cancelTimer')).toBe(true);
    r = run([{ type: 'ask', id: 'bix' }, { type: 'notice', id: 'iris', kind: 'error' }, { type: 'shortcut' }], r.s);
    expect(r.s.current).toBeNull();
    r = run([{ type: 'visible', on: true }], r.s);
    expect(r.s.current).toEqual({ id: 'pim', kind: 'ask' }); expect(r.s.phase).toBe('seed');
  });

  it('a timer from an earlier card is ignored', () => {
    const first = run([{ type: 'notice', id: 'otto', kind: 'finished' }]);
    const staleRev = first.s.rev;
    const later = run([{ type: 'appearElapsed' }, { type: 'dismiss' }], first.s);
    expect(transition(later.s, { type: 'closeElapsed', rev: staleRev }).state).toBe(later.s);
  });

  it('Ledge’s own requests wait in the same line as the sessions’, in their order, before the notices; « Plus tard » and Ctrl+Alt+L work alike', () => {
    let r = run([...opened({ type: 'ask', id: 'pim' }), { type: 'notice', id: 'otto', kind: 'finished' }, { type: 'ask', id: 'ledge:local|rig.ask:q1' }]);
    expect(waitingCount(r.s)).toBe(2);
    r = run([{ type: 'defer' }, { type: 'closeElapsed' }, { type: 'appearElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'ledge:local|rig.ask:q1', kind: 'ledge' }); expect(started(r.effects)).toEqual([]);
    r = run([{ type: 'decided' }, { type: 'askCleared', id: 'ledge:local|rig.ask:q1' }], r.s);
    expect(r.s.ack?.confirmed).toBe(true);
    r = run([{ type: 'holdElapsed' }, { type: 'closeElapsed' }], r.s);
    expect(r.s.current).toEqual({ id: 'otto', kind: 'finished' });
  });
});
