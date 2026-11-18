import { describe, it, expect } from 'vitest';
import { backgroundOf, SessionSchema } from '../src/index.js';

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
