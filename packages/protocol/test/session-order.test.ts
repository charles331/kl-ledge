// Issue #16 (docs/mockups/ledge-reorder.html): the one order of the sessions, kept by the daemon, the same on every front.
import { describe, it, expect } from 'vitest';
import { NO_PROJECT, orderedSessions, placeSessions, sessionOrderFor, sessionOrderKey, sortSessions, type Projects } from '../src/projects.js';

const s = (id: string, cwd: string, startedAt: string, machineId?: string) => ({ id, cwd, startedAt, ...(machineId ? { machineId } : {}) });
const P: Projects = {
  projects: [
    { id: 'api', name: 'API', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/api' }] },
    { id: 'web', name: 'Web', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/web' }, { machine: 'srv', path: '/srv/web' }] }
  ],
  rules: []
};

describe('the sessions\' order (#16)', () => {
  it('a session\'s key is its fleet id; one as its own daemon gives it is the local machine\'s', () => {
    expect(sessionOrderKey({ id: 'local:a1', machineId: 'local' })).toBe('local:a1');
    expect(sessionOrderKey({ id: 'srv:b2', machineId: 'srv' })).toBe('srv:b2');
    expect(sessionOrderKey({ id: 'a1' })).toBe('local:a1');
  });

  it('by project in the projects\' order, « Sans projet » last; within one, the order kept, then the others oldest first', () => {
    const all = [
      s('local:w1', '/w/web', '2026-11-26T10:00:00Z', 'local'), s('local:a1', '/w/api', '2026-11-26T09:00:00Z', 'local'),
      s('local:x', '/tmp/x', '2026-11-26T08:00:00Z', 'local'), s('srv:w2', '/srv/web', '2026-11-26T11:00:00Z', 'srv'),
      s('local:w3', '/w/web/sub', '2026-11-26T12:00:00Z', 'local'), s('local:w0', '/w/web', '2026-11-26T07:00:00Z', 'local')
    ];
    // No order kept: oldest first in each project (what Desktop did).
    expect(orderedSessions(all, P).map(x => x.id)).toEqual(['local:a1', 'local:w0', 'local:w1', 'srv:w2', 'local:w3', 'local:x']);
    // The user put w2 (another machine's) then w3 on top of Web: those listed first, a new one (w0, w1 unlisted) at the bottom.
    const kept = { ...P, order: { web: ['srv:w2', 'local:w3'], [NO_PROJECT]: ['local:x'] } };
    expect(orderedSessions(all, kept).map(x => x.id)).toEqual(['local:a1', 'srv:w2', 'local:w3', 'local:w0', 'local:w1', 'local:x']);
    // A project's order moves its group, not its sessions' order.
    expect(orderedSessions(all, { ...kept, projects: [P.projects[1]!, P.projects[0]!] }).map(x => x.id)).toEqual(['srv:w2', 'local:w3', 'local:w0', 'local:w1', 'local:a1', 'local:x']);
  });

  it('the phone sorts its own sessions the same way, with its ids and its projectId', () => {
    const phone = [{ id: 'b', startedAt: '2026-11-26T10:00:00Z', projectId: 'web' }, { id: 'a', startedAt: '2026-11-26T09:00:00Z', projectId: 'web' }, { id: 'c', startedAt: '2026-11-26T08:00:00Z' }];
    expect(sortSessions(phone, { projectIds: ['api', 'web'], order: { web: ['b'] }, projectOf: x => x.projectId ?? null, keyOf: x => x.id }).map(x => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('putting some sessions in a new order (one branch\'s, the phone\'s own) leaves the others in place', () => {
    const current = ['local:a', 'srv:b', 'local:c', 'srv:d', 'local:e'];
    // The local ones reversed: the other machine's keep their places.
    expect(placeSessions(current, ['local:e', 'local:c', 'local:a'])).toEqual(['local:e', 'srv:b', 'local:c', 'srv:d', 'local:a']);
    // Moving one to the top of its branch (a, c, e) only.
    expect(placeSessions(current, ['local:c', 'local:a', 'local:e'])).toEqual(['local:c', 'srv:b', 'local:a', 'srv:d', 'local:e']);
    // A key it does not have, or one twice, is dropped.
    expect(placeSessions(current, ['local:zz', 'local:e', 'local:e', 'local:a'])).toEqual(['local:e', 'srv:b', 'local:c', 'srv:d', 'local:a']);
  });

  it('a project deleted takes its order with it; « Sans projet » keeps its own', () => {
    expect(sessionOrderFor({ projects: [P.projects[0]!] }, { api: ['local:a'], web: ['local:w'], [NO_PROJECT]: ['local:x'] })).toEqual({ api: ['local:a'], [NO_PROJECT]: ['local:x'] });
    expect(sessionOrderFor({ projects: [] }, { web: ['local:w'] })).toBeUndefined();
    expect(sessionOrderFor({ projects: [] }, undefined)).toBeUndefined();
  });
});
