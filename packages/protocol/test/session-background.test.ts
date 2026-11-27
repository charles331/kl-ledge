import { describe, it, expect } from 'vitest';
import { backgroundOf, helperAtWork, liveHelpers, SessionSchema } from '../src/index.js';

const T = '2026-11-17T20:00:00.000Z';
const base = { id: 's', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto', tmuxSession: null, state: 'idle', startedAt: T, lastActivityAt: T, source: 'launcher' };

describe('background work (issue #1)', () => {
  it('a snapshot from an older daemon (no background, no helper lastAt) still parses, and has no background', () => {
    const s = SessionSchema.parse({ ...base, helpers: [{ id: 'h', kind: 'Explore', task: '', state: 'exited' }] });
    expect(s).not.toHaveProperty('background');
    expect(backgroundOf(s)).toBeUndefined();
  });
  it('counts the helpers at work and lists the commands, at rest too; nothing once the session exited', () => {
    const s = SessionSchema.parse({ ...base, background: [{ id: 'toolu_1', label: 'pnpm install', since: T }],
      helpers: [{ id: 'a', kind: 'Explore', task: '', state: 'working', lastAt: T }, { id: 'b', kind: 'Plan', task: '', state: 'waiting_permission' },
        { id: 'c', kind: 'Explore', task: '', state: 'exited', finishedAt: T }, { id: 'd', kind: 'Explore', task: '', state: 'idle' }] });
    expect(backgroundOf(s)).toEqual({ subagents: 2, commands: [{ id: 'toolu_1', label: 'pnpm install', since: T }] });
    expect(backgroundOf({ ...s, state: 'exited' })).toBeUndefined();
  });
});

describe('the helpers a list shows (issue #47)', () => {
  const h = (id: string, state: string) => ({ id, kind: 'Explore', task: '', state, ...(state === 'exited' ? { finishedAt: T } : {}) });
  it('keeps the ones at work, waiting or in error; leaves out the finished and the stopped ones, in order', () => {
    const s = SessionSchema.parse({ ...base, helpers: [h('a', 'exited'), h('b', 'working'), h('c', 'idle'), h('d', 'waiting_permission'), h('e', 'waiting_input'), h('f', 'error'), h('g', 'exited')] });
    expect(liveHelpers(s).map(x => x.id)).toEqual(['b', 'd', 'e', 'f']);
    // Every helper the background ring counts (#1) stays listed.
    expect(s.helpers.filter(helperAtWork).every(x => liveHelpers(s).includes(x))).toBe(true);
  });
  it('twelve finished helpers: none listed; a session without helpers (a phone row from an older PC) lists none', () => {
    const s = SessionSchema.parse({ ...base, helpers: Array.from({ length: 12 }, (_, i) => h(`x${i}`, 'exited')) });
    expect(liveHelpers(s)).toEqual([]);
    expect(liveHelpers({})).toEqual([]);
  });
});
