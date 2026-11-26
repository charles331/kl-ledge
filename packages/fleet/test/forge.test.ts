import { describe, expect, it } from 'vitest';
import type { PullRequest } from '@ledge/protocol';
import { closedPrs, filterPrs, listedPrs, mergedPrs, openPrs, prOfSession, prRoleCounts, prsFailing, prsWaitingForYou, sessionForge, type FleetFollowedSession, type FleetForgeStatus, type FleetPullRequest } from '../src/forge';

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({ id: `github.com/o/r#${n}`, forge: 'github', host: 'github.com', repo: 'o/r', number: n, ref: `#${n}`,
  url: `https://github.com/o/r/pull/${n}`, title: 't', state: 'open', branch: `b${n}`, target: 'main', headSha: 'a'.repeat(40), pipeline: 'ok', approvals: { given: 1 },
  mergeable: true, openThreads: 0, updatedAt: `2026-11-08T10:0${n % 10}:00.000Z`, sessions: [], ...extra });

/** The mockup's list: gh-226 draft running, gh-222 in review green not mergeable, gh-225 green and approved, gl-41 failed, gh-219 merged. */
const MOCKUP = [pr(6, { state: 'draft', pipeline: 'run', mergeable: false }), pr(2, { state: 'review', mergeable: false, sessions: ['local:front'] }),
  pr(5, { sessions: ['local:back'] }), pr(1, { pipeline: 'fail', sessions: ['server:tom'] }), pr(9, { state: 'merged', sessions: ['local:ida'] }), pr(3, { state: 'closed', pipeline: 'fail' })];

describe('the view of the requests', () => {
  it('splits open and merged, most recent first', () => {
    expect(openPrs(MOCKUP).map(p => p.number)).toEqual([6, 5, 2, 1]);
    expect(mergedPrs(MOCKUP).map(p => p.number)).toEqual([9]);
  });
  it('counts the open requests whose pipeline failed, for the badge (a closed one does not count)', () => {
    expect(prsFailing(MOCKUP)).toBe(1);
  });
  it('waits for you: failed, or green and mergeable', () => {
    expect(prsWaitingForYou(MOCKUP).map(p => p.number)).toEqual([5, 1]);
    // R5: no CI at all and mergeable is ready to merge too; running is not.
    expect(prsWaitingForYou([pr(7, { pipeline: 'none' }), pr(8, { pipeline: 'run' }), pr(4, { pipeline: 'none', mergeable: false })]).map(p => p.number)).toEqual([7]);
  });
  it('finds a session\'s request, the open one first', () => {
    expect(prOfSession(MOCKUP, 'server:tom')?.number).toBe(1);
    expect(prOfSession(MOCKUP, 'local:ida')?.number).toBe(9);
    expect(prOfSession([pr(9, { state: 'merged', sessions: ['s'] }), pr(4, { sessions: ['s'] })], 's')?.number).toBe(4);
    expect(prOfSession(MOCKUP, 'nobody')).toBeUndefined();
  });
});

// Lot 8b, state 2: the chip « PR ? » for a session followed on a forge that cannot be read on its machine.
describe('sessionForge', () => {
  const st = (machineId: string, status: FleetForgeStatus['status'], host = 'github.com'): FleetForgeStatus => ({ forge: 'github', host, status, at: '2026-11-08T10:00:00.000Z', machineId });
  const fol = (session: string, machineId: string, host = 'github.com'): FleetFollowedSession => ({ session, forge: 'github', host, repo: 'o/r', machineId });
  it('gives the unreadable forge of a followed session without request, nothing otherwise', () => {
    const forges = [st('local', 'unauthenticated'), st('server', 'ok'), st('local', 'ok', 'gitlab.com')];
    const followed = [fol('local:a', 'local'), fol('server:b', 'server'), fol('local:c', 'local', 'gitlab.com'), fol('local:d', 'local')];
    expect(sessionForge([], forges, followed, 'local:a')).toMatchObject({ status: 'unauthenticated', host: 'github.com', machineId: 'local' });
    expect(sessionForge([], forges, followed, 'server:b')).toBeUndefined();
    expect(sessionForge([], forges, followed, 'local:c')).toBeUndefined();
    expect(sessionForge([pr(4, { sessions: ['local:d'] })], forges, followed, 'local:d')).toBeUndefined();
    expect(sessionForge([], forges, followed, 'local:nobody')).toBeUndefined();
  });
});

describe('all my requests (issue #3)', () => {
  const on = (machineId: string, p: PullRequest, stale?: boolean): FleetPullRequest & { stale?: boolean } => ({ ...p, machineId, ...(stale ? { stale } : {}) });
  it('keeps one row per request, its roles and sessions joined, the followed one answering for it', () => {
    const followed = on('wsl', pr(1, { sessions: ['wsl:tom'], roles: ['assignee'], updatedAt: '2026-11-08T10:00:00.000Z' }));
    const sameOnServer = on('srv', pr(1, { roles: ['reviewer', 'author'], updatedAt: '2026-11-08T11:00:00.000Z' }));
    const once = on('srv', pr(2, { roles: ['reviewer'] }));
    const list = listedPrs([followed], [sameOnServer, once]);
    expect(list.map(p => p.number)).toEqual([1, 2]);
    expect(list[0]).toMatchObject({ machineId: 'wsl', sessions: ['wsl:tom'], roles: ['author', 'assignee', 'reviewer'] });
    expect(list[1]).toBe(once);
  });
  it('one row for a request two machines read under two ids, their remotes naming its repository in another case (#11)', () => {
    const a = on('wsl', pr(7, { sessions: ['wsl:a'] }));
    const b = on('srv', pr(7, { id: 'github.com/O/R#7', repo: 'O/R', url: 'https://github.com/O/R/pull/7/', sessions: ['srv:b'] }));
    const list = listedPrs([a, b], []);
    expect(list).toHaveLength(1);
    expect(list[0]!.sessions).toEqual(['wsl:a', 'srv:b']);
  });
  it('prefers a fresh read to a stale one, then the latest', () => {
    const stale = on('wsl', pr(3, { roles: ['author'], updatedAt: '2026-11-08T12:00:00.000Z' }), true);
    const fresh = on('srv', pr(3, { roles: ['author'], updatedAt: '2026-11-08T10:00:00.000Z' }));
    expect(listedPrs([], [stale, fresh])[0]!.machineId).toBe('srv');
    const later = on('pc2', pr(3, { roles: ['author'], updatedAt: '2026-11-08T13:00:00.000Z' }));
    expect(listedPrs([], [fresh, later])[0]!.machineId).toBe('pc2');
    // A followed copy from a machine now down gives way to a fresh one of another machine, its sessions kept (review C2).
    const followedDown = on('wsl', pr(5, { sessions: ['wsl:tom'], roles: ['author'] }), true);
    const freshOther = on('srv', pr(5, { roles: ['reviewer'] }));
    expect(listedPrs([followedDown], [freshOther])[0]).toMatchObject({ machineId: 'srv', sessions: ['wsl:tom'], roles: ['author', 'reviewer'] });
    expect(listedPrs([followedDown], [freshOther])[0]!.stale).toBeUndefined();
    // No role anywhere: none invented.
    expect(listedPrs([on('a', pr(4)), on('b', pr(4))], [])[0]!.roles).toBeUndefined();
  });
  it('filters by role and by a search on ref, title and repository, case and accents aside', () => {
    const list = [pr(1, { roles: ['author'], title: 'Délai S3', repo: 'synapse' }), pr(2, { roles: ['reviewer'], title: 'PDF', repo: 'paper-rendering' }),
      pr(3, { roles: ['author', 'assignee'], title: 'Cache', repo: 'ledge' }), pr(4, { title: 'suivie', sessions: ['x'] })];
    expect(filterPrs(list, 'all', '').map(p => p.number)).toEqual([1, 2, 3, 4]);
    expect(filterPrs(list, 'author', '').map(p => p.number)).toEqual([1, 3]);
    expect(filterPrs(list, 'reviewer', '').map(p => p.number)).toEqual([2]);
    expect(filterPrs(list, 'all', 'delai').map(p => p.number)).toEqual([1]);
    expect(filterPrs(list, 'all', ' PAPER ').map(p => p.number)).toEqual([2]);
    expect(filterPrs(list, 'all', '#3').map(p => p.number)).toEqual([3]);
    expect(filterPrs(list, 'author', 'pdf')).toEqual([]);
  });
  it('counts the open ones per role, whatever the search', () => {
    expect(prRoleCounts([pr(1, { roles: ['author'] }), pr(2, { roles: ['reviewer', 'assignee'] }), pr(3, { roles: ['reviewer'], state: 'merged' }), pr(4)]))
      .toEqual({ all: 3, author: 1, assignee: 1, reviewer: 1 });
  });
  it('keeps the merged and closed ones of the last 7 days, most recent first', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z');
    const list = [pr(1, { state: 'merged', updatedAt: '2026-11-16T12:00:00.000Z' }), pr(2, { state: 'closed', updatedAt: '2026-11-17T08:00:00.000Z' }),
      pr(3, { state: 'merged', updatedAt: '2026-11-09T12:00:00.000Z' }), pr(4, { updatedAt: '2026-11-17T09:00:00.000Z' })];
    expect(closedPrs(list, now).map(p => p.number)).toEqual([2, 1]);
  });
});
