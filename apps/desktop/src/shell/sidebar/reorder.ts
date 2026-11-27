import { NO_PROJECT, placeSessions, sessionOrderKey, type Projects, type Session } from '@ledge/protocol';
import type { ProjectGroup } from './model';

/**
 * Issue #16 (docs/mockups/ledge-reorder.html): putting projects and sessions in the order the person chooses. A session moves
 * within its group only: its project, or its branch when the tree is grouped by branch (2A). The daemon keeps the order
 * (`sessions.order`, `projects.set` for the projects); nothing moves on screen before its `projects` broadcast.
 */
export type How = 'up' | 'down' | 'top';

/** Where a session can move: its project (null: « Sans projet »), what the announcement names, and the sessions it moves among. */
export interface SessionGroup { project: string | null; label: string; sessions: readonly Session[]; /** The branch, when the group is one (by branch). */ branch?: string }

/** The group of session `id` as the tree shows it. */
export function sessionGroup(groups: readonly ProjectGroup[], byBranch: boolean, id: string, unassigned: string): SessionGroup | null {
  for (const g of groups) {
    const label = g.id === null ? unassigned : g.name;
    if (byBranch && !g.flatten) {
      for (const b of g.branches) if (b.sessions.some(s => s.id === id)) return { project: g.id, label: b.branch, sessions: b.sessions, branch: b.branch };
    } else if (g.sessions.some(s => s.id === id)) return { project: g.id, label, sessions: g.sessions };
  }
  return null;
}

/** The index `how` takes an item at `i` to among `n`, or null when it would not move. */
export function target(i: number, n: number, how: How): number | null {
  const to = how === 'up' ? i - 1 : how === 'down' ? i + 1 : 0;
  return to < 0 || to >= n || to === i ? null : to;
}

/** `list` with the item at `from` put at `to` (the index it ends at). */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/** Where a drop lands: before or after row `over` of the same list, as the index the dragged item ends at. */
export function dropIndex(from: number, over: number, after: boolean): number {
  const at = over + (after ? 1 : 0);
  return at > from ? at - 1 : at;
}

/**
 * What `sessions.order` sends for a group put in a new order: the project's whole list (`all`, every session of the project in
 * its shown order, the ones the tree does not show included), the group's sessions in their new order, the others in place.
 */
export function orderIds(all: readonly Session[], moved: readonly Session[]): string[] {
  return placeSessions(all.map(sessionOrderKey), moved.map(sessionOrderKey));
}

export const projectKeyOf = (project: string | null): string => project ?? NO_PROJECT;

/** The projects' list with project `id` at index `to`. */
export function movedProjects(projects: Projects, id: string, to: number): Projects {
  const from = projects.projects.findIndex(p => p.id === id);
  return from < 0 ? projects : { ...projects, projects: moveTo(projects.projects, from, to) };
}

/** French ordinals as design-ux spelled them (2026-11-26): « 1re » (une session), « 1er » (un projet), then « 2e », « 3e »… */
export const ordinalFr = (i: number, feminine: boolean): string => (i === 1 ? (feminine ? '1re' : '1er') : `${i}e`);
