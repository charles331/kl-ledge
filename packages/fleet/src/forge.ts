/** The pull and merge requests as every front shows them (IDE lot 8, docs/mockups/ledge-ide-interactive.html): Desktop, the TUI. */
import { PR_ROLE_ORDER, type FollowedSession, type ForgeStatus, type PullRequest } from '@ledge/protocol';

// Issue #3: the filter of « MR et PR », shared with the phone, lives in @ledge/protocol.
export { CLOSED_KEEP_DAYS, CLOSED_KEEP_MS, closedPrs, filterPrs, PR_ROLE_FILTERS, prRoleCounts, type PrRoleFilter } from '@ledge/protocol';

/** A request across the fleet: its sessions qualified `machine:id`, and the machine that read it (the one to ask for its detail). */
export type FleetPullRequest = PullRequest & { machineId: string };
export type FleetForgeStatus = ForgeStatus & { machineId: string };
/** A followed session, qualified `machine:id`, with the machine whose daemon follows it. */
export type FleetFollowedSession = FollowedSession & { machineId: string };

const OPEN = new Set<PullRequest['state']>(['draft', 'open', 'review']);
const isOpen = (p: Pick<PullRequest, 'state'>): boolean => OPEN.has(p.state);

/** The requests still open (draft, open, in review), most recently updated first. */
export const openPrs = <T extends PullRequest>(prs: readonly T[]): T[] => prs.filter(isOpen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** The merged ones, most recently updated first. */
export const mergedPrs = <T extends PullRequest>(prs: readonly T[]): T[] => prs.filter(p => p.state === 'merged').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/**
 * The list of « MR et PR » (issue #3): the followed requests and the account's own, one row per request (its forge address, #11) however many machines read it or under however many titles. The row kept for a request read twice is the one to ask
 * for its detail and actions: a fresh one over a stale one (a machine down cannot act, review C2), then a followed one (its agent, its
 * pipeline), then the latest read;
 * its roles and sessions are the union of all. Order: as given (the callers sort).
 */
/** One request whatever its id: the forge's address (#11), as two machines whose remotes name its repository otherwise (case, old
 *  name) give it under two ids; the id when there is no address. */
const requestKey = (p: Pick<PullRequest, 'id' | 'url'>): string => (p.url ?? '').trim().replace(/\/+$/, '').toLowerCase() || p.id;
export function listedPrs<T extends FleetPullRequest & { stale?: boolean }>(prs: readonly T[], mine: readonly T[]): T[] {
  const rank = (p: T) => (p.stale ? 0 : 2) + (p.sessions.length > 0 ? 1 : 0);
  const byId = new Map<string, T[]>();
  for (const p of [...prs, ...mine]) { const k = requestKey(p); const l = byId.get(k); if (l) l.push(p); else byId.set(k, [p]); }
  return [...byId.values()].map(all => {
    const best = all.reduce((a, b) => (rank(b) > rank(a) || (rank(b) === rank(a) && b.updatedAt > a.updatedAt) ? b : a));
    if (all.length === 1) return best;
    const roles = new Set(all.flatMap(p => p.roles ?? []));
    const sessions = [...new Set(all.flatMap(p => p.sessions))];
    return { ...best, sessions, ...(roles.size ? { roles: PR_ROLE_ORDER.filter(r => roles.has(r)) } : {}) };
  });
}

/** The badge of the activity bar: open requests whose pipeline failed. */
export const prsFailing = (prs: readonly PullRequest[]): number => prs.filter(p => isOpen(p) && p.pipeline === 'fail').length;
/** A session's request (its id qualified): the open one first, else the latest. */
export const prOfSession = <T extends PullRequest>(prs: readonly T[], sessionId: string): T | undefined => {
  const mine = prs.filter(p => p.sessions.includes(sessionId));
  return openPrs(mine)[0] ?? [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
};

/**
 * The chip « PR ? » (lot 8b, state 2): a session followed on a forge that cannot be read on its machine, and with no request known.
 * Gives that forge's status (its CLI, host and why), or undefined: the session has a request, is not followed, or its forge reads.
 */
export const sessionForge = (prs: readonly PullRequest[], forges: readonly FleetForgeStatus[], followed: readonly FleetFollowedSession[], sessionId: string): FleetForgeStatus | undefined => {
  if (prs.some(p => p.sessions.includes(sessionId))) return undefined;
  const f = followed.find(x => x.session === sessionId);
  if (!f) return undefined;
  return forges.find(s => s.machineId === f.machineId && s.forge === f.forge && s.host === f.host && s.status !== 'ok');
};
