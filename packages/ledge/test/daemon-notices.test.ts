// The island's notices and the urgent asks' push, the daemon's own (#40, D11): pure, operator or not.
import { describe, it, expect } from 'vitest';
import type { HumanAsk, Task } from '@ledge/protocol';
import { createAskWatch, createNoticeFeed, noticesOf } from '../src/daemon/notices.js';

const T = (m: number): string => new Date(Date.UTC(2026, 10, 13, 10, m)).toISOString();
const ask = (id: string, over: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'max', rig: 'kernel', role: null }, summary: 'Which team?', body: '', bodyTruncated: false, detail: null,
  evidenceRef: null, createdAt: T(0), updatedAt: T(0),
  questions: [{ id: 'k', question: 'Which?', options: ['a', 'b', 'c', 'd'].map(o => ({ id: o, label: o.toUpperCase(), recommended: false })), answer: null }], ...over
});
const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: 'Fusionner #309 ?', giver: 's1', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'given', at: T(4), updatedAt: T(4), log: [], ...over } as Task);

describe('noticesOf', () => {
  it('an open decision put to Ledge is a notice at once, a proposal or a closed one is not', () => {
    const n = noticesOf([], [task('t1'), task('t2', { state: 'done' }), task('t3', { brain: { note: 'n' } } as Partial<Task>), task('t4', { owner: 'other' })]);
    expect(n).toEqual([{ id: 'decision:t1', kind: 'decision', text: 'Fusionner #309 ?', who: 'Nova', priority: 'routine', at: T(4) }]);
  });

  it('only urgent and critical rig asks not settled, with their qitem and the first open question\'s three options', () => {
    const n = noticesOf([ask('r1'), ask('r2', { priority: 'urgent' }), ask('r3', { priority: 'critical', from: { seat: 'max', rig: null, role: null } })]);
    expect(n.map(x => x.id)).toEqual(['rig.ask:r2', 'rig.ask:r3']);
    expect(noticesOf([])).toEqual([]);
    expect(n[0]).toEqual({ id: 'rig.ask:r2', kind: 'rig.ask', text: 'Which team?', who: 'max', rig: 'kernel', qitem: 'r2', priority: 'urgent', at: T(0),
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], questionId: 'k' });
    expect(n[1]).not.toHaveProperty('rig');
    const answered = ask('r4', { priority: 'urgent', questions: [{ id: 'k', question: '?', options: [], answer: { kind: 'option', id: 'a' } }] });
    expect(noticesOf([answered])).toEqual([]);
  });

  it('the options are the first open question\'s, named by its questionId; an ask without options has neither', () => {
    const two = ask('r5', { priority: 'urgent', questions: [
      { id: 'k1', question: '?', options: [{ id: 'x', label: 'X', recommended: false }], answer: { kind: 'option', id: 'x' } },
      { id: 'k2', question: '?', options: [{ id: 'y', label: 'Y', recommended: true }], answer: null }
    ] });
    expect(noticesOf([two])[0]).toMatchObject({ options: [{ id: 'y', label: 'Y' }], questionId: 'k2' });
    const bare = noticesOf([ask('r6', { priority: 'urgent', questions: [] })])[0]!;
    expect(bare).not.toHaveProperty('options');
    expect(bare).not.toHaveProperty('questionId');
  });

  it('without the operator an ask carries no qid; with it, the qid of the point holding it', () => {
    const asks = [ask('r1', { priority: 'urgent' }), ask('r2', { priority: 'urgent' })];
    expect(noticesOf(asks).every(n => !('qid' in n))).toBe(true);
    const n = noticesOf(asks, [], id => (id === 'r1' ? 'q2' : undefined));
    expect(n.find(x => x.id === 'rig.ask:r1')).toMatchObject({ qid: 'q2', qitem: 'r1' });
    expect(n.find(x => x.id === 'rig.ask:r2')).not.toHaveProperty('qid');
  });

  it('an ask with an unreadable createdAt takes its updatedAt, else a fixed time, so two calls agree', () => {
    const a = ask('r1', { priority: 'urgent', createdAt: 'x', updatedAt: T(4) });
    expect(noticesOf([a])[0]!.at).toBe(T(4));
    const b = ask('r2', { priority: 'urgent', createdAt: 'x', updatedAt: 'y' });
    expect(noticesOf([b])).toEqual(noticesOf([b]));
  });
});

describe('createNoticeFeed', () => {
  const n = { id: 'decision:t1', kind: 'decision' as const, text: 't', priority: 'routine' as const, at: T(1) };
  it('sends a change once, not an unchanged list, and replays the last to a later client', () => {
    const sent: unknown[] = [];
    const feed = createNoticeFeed(x => sent.push(x));
    expect(feed.current()).toBeUndefined();
    feed.tell([]); feed.tell([]);
    expect(sent).toHaveLength(1);
    feed.tell([n]); feed.tell([{ ...n }]);
    expect(sent).toHaveLength(2);
    expect(feed.current()).toEqual([n]);
    feed.tell([]);
    expect(sent).toHaveLength(3);
  });
});

describe('createAskWatch', () => {
  const ready = { state: 'ready' };
  it('the first list is the baseline; then a new urgent or critical ask is fresh once, a routine one never', () => {
    const w = createAskWatch();
    expect(w.read({ channel: ready, asks: [ask('q0', { priority: 'urgent' })] })).toEqual([]);
    const fresh = w.read({ channel: ready, asks: [ask('q0', { priority: 'urgent' }), ask('q1', { priority: 'critical' }), ask('q2')] });
    expect(fresh.map(a => a.id)).toEqual(['q1']);
    expect(w.read({ channel: ready, asks: [ask('q0', { priority: 'urgent' }), ask('q1', { priority: 'critical' }), ask('q2')] })).toEqual([]);
    expect(w.asks().map(a => a.id)).toEqual(['q0', 'q1', 'q2']);
  });

  it('a channel not ready changes nothing: the asks stay, and none comes back as new', () => {
    const w = createAskWatch();
    w.read({ channel: ready, asks: [ask('q1', { priority: 'urgent' })] });
    expect(w.read({ channel: { state: 'openrig_stopped' }, asks: [] })).toEqual([]);
    expect(w.asks().map(a => a.id)).toEqual(['q1']);
    expect(w.read({ channel: ready, asks: [ask('q1', { priority: 'urgent' })] })).toEqual([]);
  });

  it('a partial list keeps the rows it misses, so a row read again is not new twice; a whole list drops them', () => {
    const w = createAskWatch();
    w.read({ asks: [] });
    expect(w.read({ asks: [ask('q1', { priority: 'urgent' })] }).map(a => a.id)).toEqual(['q1']);
    expect(w.read({ asks: [ask('q2', { priority: 'urgent' })], partial: true }).map(a => a.id)).toEqual(['q2']);
    expect(w.asks().map(a => a.id)).toEqual(['q2', 'q1']);
    expect(w.read({ asks: [ask('q1', { priority: 'urgent' }), ask('q2', { priority: 'urgent' })] })).toEqual([]);
    w.read({ asks: [ask('q2', { priority: 'urgent' })] });
    expect(w.asks().map(a => a.id)).toEqual(['q2']);
  });
});
