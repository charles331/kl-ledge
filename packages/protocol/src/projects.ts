import { z } from 'zod';
import { MachineIdSchema } from './machines.js';
import type { Session } from './session.js';

/** The eight project colours of the mockup, stored by key so a front may restyle them. */
export const PROJECT_COLORS = { blue: '#3b82f6', green: '#10b981', amber: '#f59e0b', violet: '#8b5cf6', teal: '#14b8a6', pink: '#ec4899', red: '#ef4444', slate: '#64748b' } as const;
export const ProjectColorSchema = z.enum(['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate']);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

export const ProjectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** An absolute POSIX path as the projects store it: trimmed, no repeated slash, no trailing slash but for `/`. */
export function normalizePath(raw: string): string {
  const p = raw.trim().replace(/\/+/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
const PathSchema = z.string().max(4096).refine(p => p.startsWith('/') && p === normalizePath(p), 'an absolute, normalized path');
/** A folder as a project holds it: absolute, normalized (`normalizePath`), at most 4096 characters. */
export const FolderPathSchema = PathSchema;

/** A folder on one machine: a Git repository or a plain folder (the branch is detected when shown, never stored). */
export const RepoSchema = z.object({ machine: MachineIdSchema, path: PathSchema });
export type Repo = z.infer<typeof RepoSchema>;

/** A project's name: trimmed, 1 to 80 characters. */
export const ProjectNameSchema = z.string().trim().min(1).max(80);
/** A project name as two names are compared for « already taken » (the editor's and the phone's): case and accents aside.
 *  projectsProblems ignores case only. */
export const projectNameKey = (name: string): string => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: ProjectNameSchema,
  color: ProjectColorSchema,
  description: z.string().max(500).default(''),
  repos: z.array(RepoSchema).max(50)
});
export type Project = z.infer<typeof ProjectSchema>;

/** « Dossier → projet », remembered when an agent is put away: that folder and what is under it, on that machine. */
export const RuleSchema = z.object({ machine: MachineIdSchema, path: PathSchema, project: ProjectIdSchema });
export type Rule = z.infer<typeof RuleSchema>;

export type ProjectsProblemCode = 'duplicate_id' | 'duplicate_name' | 'duplicate_repo' | 'duplicate_rule' | 'unknown_project';
export interface ProjectsProblem { code: ProjectsProblemCode; path: (string | number)[] }

/** What makes a set of projects inconsistent as a whole; the editor shows them, the daemon refuses on them. */
export function projectsProblems(p: { projects: readonly Project[]; rules: readonly Rule[] }): ProjectsProblem[] {
  const out: ProjectsProblem[] = [];
  const ids = new Set<string>(), names = new Set<string>(), repos = new Set<string>(), rules = new Set<string>();
  p.projects.forEach((project, i) => {
    if (ids.has(project.id)) out.push({ code: 'duplicate_id', path: ['projects', i, 'id'] });
    ids.add(project.id);
    const name = project.name.trim().toLocaleLowerCase();
    if (names.has(name)) out.push({ code: 'duplicate_name', path: ['projects', i, 'name'] });
    names.add(name);
    project.repos.forEach((repo, j) => {
      const key = `${repo.machine}\n${repo.path}`;
      if (repos.has(key)) out.push({ code: 'duplicate_repo', path: ['projects', i, 'repos', j] });
      repos.add(key);
    });
  });
  p.rules.forEach((rule, i) => {
    const key = `${rule.machine}\n${rule.path}`;
    if (rules.has(key)) out.push({ code: 'duplicate_rule', path: ['rules', i] });
    rules.add(key);
    if (!ids.has(rule.project)) out.push({ code: 'unknown_project', path: ['rules', i, 'project'] });
  });
  return out;
}

/**
 * Issue #2: a project has at least one folder, wherever the change comes from (Desktop, phone, CLI). Between the projects as they
 * are (`before`) and as a change would leave them (`after`): a project with no folder is refused when it is new or changed
 * (`folder_required`), or when the change removed its last folder (`last_folder`). One that already had none and is left as it was
 * passes: existing projects without a folder stay, and can still be deleted.
 */
export type FolderProblem = { code: 'folder_required' | 'last_folder'; project: string };
export function folderProblems(before: { projects: readonly Project[] }, after: { projects: readonly Project[] }): FolderProblem[] {
  const was = new Map(before.projects.map(p => [p.id, p] as const));
  const out: FolderProblem[] = [];
  for (const p of after.projects) {
    if (p.repos.length) continue;
    const old = was.get(p.id);
    if (old?.repos.length) out.push({ code: 'last_folder', project: p.id });
    else if (!old || old.name !== p.name || old.color !== p.color || old.description !== p.description) out.push({ code: 'folder_required', project: p.id });
  }
  return out;
}

/**
 * Issue #16 (docs/mockups/ledge-reorder.html): the sessions' order the user chose, per project (its id; `NO_PROJECT` for « Sans
 * projet »), as a list of session keys (sessionOrderKey). A session not listed comes after those listed, oldest first: a new one
 * arrives at the bottom of its project. Kept by the local daemon, the same on every front; written by `sessions.order` only.
 */
export const NO_PROJECT = '';
export const SESSION_ORDER_MAX = 500;
export const SessionOrderSchema = z.record(z.string().max(64), z.array(z.string().min(1).max(300)).max(SESSION_ORDER_MAX));
export type SessionOrder = z.infer<typeof SessionOrderSchema>;

export const ProjectsSchema = z.object({ projects: z.array(ProjectSchema).max(100), rules: z.array(RuleSchema).max(1000), order: SessionOrderSchema.optional() }).superRefine((p, ctx) => {
  for (const problem of projectsProblems(p)) ctx.addIssue({ code: 'custom', message: problem.code, path: problem.path });
});
export type Projects = z.infer<typeof ProjectsSchema>;

export const DEFAULT_PROJECTS: Projects = { projects: [], rules: [] };

/** The order kept once the projects change (#16): the lists of the projects still there and of « Sans projet »; undefined when none is left. */
export function sessionOrderFor(next: Pick<Projects, 'projects'>, order: SessionOrder | undefined): SessionOrder | undefined {
  if (!order) return undefined;
  const ids = new Set([NO_PROJECT, ...next.projects.map(p => p.id)]);
  const kept = Object.fromEntries(Object.entries(order).filter(([k, v]) => ids.has(k) && v.length > 0));
  return Object.keys(kept).length ? kept : undefined;
}

/** A session's key in the order (#16): its machine and id as the fleet qualifies them (`local:abc`); a session as its own daemon
 *  gives it (no machineId) is the local machine's. */
export const sessionOrderKey = (s: Pick<Session, 'id' | 'machineId'>): string => (s.machineId ? s.id : `local:${encodeURIComponent(s.id)}`);

/**
 * The one order of the sessions (#16), for Desktop, the phone and the TUI: by project in the projects' order, « Sans projet »
 * last; within a project, the order kept for it, then the sessions it does not list, oldest first, then by id. `projectOf`: the
 * session's project id or null; `keyOf`: its key in the order (sessionOrderKey by default).
 */
export function sortSessions<T extends Pick<Session, 'id' | 'startedAt'>>(sessions: readonly T[], o: {
  projectIds: readonly string[]; order?: SessionOrder; projectOf: (s: T) => string | null; keyOf?: (s: T) => string;
}): T[] {
  const keyOf = o.keyOf ?? ((s: T) => sessionOrderKey(s as unknown as Pick<Session, 'id' | 'machineId'>));
  const rank = new Map(o.projectIds.map((id, i) => [id, i]));
  const places = new Map<string, Map<string, number>>();
  const placeIn = (p: string): Map<string, number> => {
    let m = places.get(p);
    if (!m) { m = new Map((o.order?.[p] ?? []).map((k, i) => [k, i])); places.set(p, m); }
    return m;
  };
  const groupOf = (s: T): string => { const p = o.projectOf(s); return p !== null && rank.has(p) ? p : NO_PROJECT; };
  const rankOf = (g: string): number => (g === NO_PROJECT ? o.projectIds.length : rank.get(g)!);
  const at = (s: T): number => Date.parse(s.startedAt) || 0;
  const items = sessions.map(s => { const g = groupOf(s); return { s, g, place: placeIn(g).get(keyOf(s)) ?? Infinity }; });
  items.sort((x, y) => rankOf(x.g) - rankOf(y.g) || (x.place === y.place ? 0 : x.place < y.place ? -1 : 1) || at(x.s) - at(y.s) || (x.s.id < y.s.id ? -1 : x.s.id > y.s.id ? 1 : 0));
  return items.map(i => i.s);
}

/** sortSessions with the local daemon's projects: each session's project as projectOf places it. */
export const orderedSessions = <T extends Pick<Session, 'id' | 'startedAt' | 'machineId' | 'cwd'>>(sessions: readonly T[], projects: Projects | null): T[] =>
  projects ? sortSessions(sessions, { projectIds: projects.projects.map(p => p.id), order: projects.order, projectOf: s => projectOf(s, projects) }) : [...sessions];

/**
 * A project's order once some of its sessions are put in a new order (#16): `current`, the keys of all its sessions in their
 * shown order; `wanted`, some of them in the new order (one branch's sessions, 2A, or the phone's own). The others keep their
 * places, and those moved fill the places theirs had. A wanted key not in `current` is dropped. What `sessions.order` sends.
 */
export function placeSessions(current: readonly string[], wanted: readonly string[]): string[] {
  const inCurrent = new Set(current);
  const moved = [...new Set(wanted)].filter(k => inCurrent.has(k));
  const set = new Set(moved);
  let i = 0;
  return current.map(k => (set.has(k) ? moved[i++]! : k));
}

const under = (cwd: string, path: string) => path === '/' || cwd === path || cwd.startsWith(`${path}/`);

/**
 * The project a session belongs to (build spec §5): among the repos and rules of the session's machine whose folder holds its
 * `cwd`, the deepest wins; on the same folder a rule (the user put the agent away) wins over a repo. `null`: no project.
 */
export function projectOf(session: Pick<Session, 'machineId' | 'cwd'>, state: Projects): string | null {
  const machine = session.machineId ?? 'local';
  const cwd = normalizePath(session.cwd);
  const known = new Set(state.projects.map(p => p.id));
  const candidates = [
    ...state.projects.flatMap(p => p.repos.filter(r => r.machine === machine).map(r => ({ project: p.id, path: r.path, rule: false }))),
    ...state.rules.filter(r => r.machine === machine && known.has(r.project)).map(r => ({ project: r.project, path: r.path, rule: true }))
  ].filter(c => under(cwd, c.path));
  candidates.sort((x, y) => y.path.length - x.path.length || Number(y.rule) - Number(x.rule));
  return candidates[0]?.project ?? null;
}
