import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Projects, Session } from '@ledge/protocol';
import type { FileResult } from '../../atelier/filing';
import { useI18n } from '../../i18n/lang';
import type { ProjectGroup } from './model';
import { placeSessions, type Project } from '@ledge/protocol';
import { dropIndex, moveTo, orderIds, ordinalFr, projectKeyOf, sessionGroup, target, type How, type SessionGroup } from './reorder';

/** Writes the order to the local daemon (the app's fleet). Never throws: what went wrong is its result. */
export interface OrderWriter {
  sessions(project: string, ids: string[]): FileResult;
  projects(next: Projects): FileResult;
  /** A `sessions.order` the daemon refused, with its code: `stale` (the list changed), any other from a daemon too old to know it
   *  (#16 review C1: a daemon before #16 answers `invalid`). The notice names the session that was moved. */
  onRefused(fn: (code: string) => void): () => void;
}

/** What the menus offer (Monter, Descendre, En haut…): enabled when it would move something. */
export interface ReorderCtl {
  can(kind: 'session' | 'project', id: string, how: How): boolean;
  move(kind: 'session' | 'project', id: string, how: How): void;
}

// The tree's controller, for the session and project menus, which the app and the sidebar render elsewhere.
let ctl: ReorderCtl | null = null;
const listeners = new Set<() => void>();
const publish = (next: ReorderCtl | null) => { ctl = next; listeners.forEach(l => l()); };
export function useReorderCtl(): ReorderCtl | null {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => ctl, () => ctl);
}

/** A row being dragged: a session (its group's project) or a project. */
export type Dragged = { kind: 'session'; id: string } | { kind: 'project'; id: string };
/** Where it would land: before or after row `id`. */
export interface Mark { id: string; after: boolean }

export function useReorder(o: {
  groups: readonly ProjectGroup[];
  byBranch: boolean;
  projects: Projects | null;
  /** Every session of a project (null: « Sans projet ») in its order, the ones the tree does not show included. */
  all(project: string | null): readonly Session[];
  write?: OrderWriter;
  notify(text: string): void;
  /** Whether the tree shows a session of a group (the eye may hide the finished ones): a move steps over the hidden ones, which keep
   *  their places (the lead's call on #16 review C4). */
  shown(s: Session, g: SessionGroup): boolean;
  /** The tree is shown: its controller serves the menus. */
  active: boolean;
}) {
  const { t, lang } = useI18n();
  const r = t.side.reorder;
  const [said, setSaid] = useState('');
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  /** The other project a dragged session is over (1A: dropped there, it is filed there). */
  const [fileOver, setFileOver] = useState<string | null>(null);
  const latest = useRef(o);
  latest.current = o;
  const lastMoved = useRef('');
  const nth = (i: number, feminine: boolean) => (lang === 'fr' ? ordinalFr(i, feminine) : String(i));

  const failed = (res: FileResult, name: string): boolean => {
    if (res === 'sent') return false;
    latest.current.notify(res === 'offline' ? r.offline(name) : res === 'outdated' ? r.outdated(name) : r.stale(name));
    return true;
  };

  /** Session `id`'s group as the tree shows it: the sessions it hides are left out (they keep their places). */
  const visibleGroup = (id: string, unassigned = ''): SessionGroup | null => {
    const { groups, byBranch, shown } = latest.current;
    const g = sessionGroup(groups, byBranch, id, unassigned);
    return g ? { ...g, sessions: g.sessions.filter(s => s.id === id || shown(s, g)) } : null;
  };
  /** The projects the tree shows, in their order (the eye may hide some). */
  const visibleProjects = (): string[] => latest.current.groups.flatMap(g => (g.id === null ? [] : [g.id]));

  /** Session `id` at index `to` of its group as shown. */
  const placeSession = (id: string, to: number) => {
    const { write, all } = latest.current;
    const g = visibleGroup(id, t.side.unassigned);
    const from = g ? g.sessions.findIndex(s => s.id === id) : -1;
    if (!g || from < 0 || from === to || !write) return;
    const s = g.sessions[from]!;
    const next = moveTo(g.sessions, from, to);
    lastMoved.current = s.name;
    if (failed(write.sessions(projectKeyOf(g.project), orderIds(all(g.project), next)), s.name)) return;
    setSaid(r.moved(s.name, nth(to + 1, true), next.length, g.label));
  };
  /** Project `id` at index `to` among the projects shown; the hidden ones keep their places among the others. */
  const placeProject = (id: string, to: number) => {
    const { projects, write } = latest.current;
    if (!projects || !write) return;
    const shown = visibleProjects();
    const from = shown.indexOf(id);
    if (from < 0 || from === to) return;
    const byId = new Map(projects.projects.map(p => [p.id, p]));
    const name = byId.get(id)?.name ?? id;
    const ids = placeSessions(projects.projects.map(p => p.id), moveTo(shown, from, to));
    lastMoved.current = name;
    if (failed(write.projects({ ...projects, projects: ids.map(x => byId.get(x)!).filter((p): p is Project => !!p) }), name)) return;
    setSaid(r.movedProject(name, nth(to + 1, false), shown.length));
  };

  const where = (kind: 'session' | 'project', id: string): { i: number; n: number } | null => {
    if (kind === 'project') {
      const shown = visibleProjects();
      const i = latest.current.projects ? shown.indexOf(id) : -1;
      return i < 0 ? null : { i, n: shown.length };
    }
    const g = visibleGroup(id);
    const i = g ? g.sessions.findIndex(s => s.id === id) : -1;
    return i < 0 ? null : { i, n: g!.sessions.length };
  };
  const controller: ReorderCtl = {
    can: (kind, id, how) => { const w = where(kind, id); return !!latest.current.write && !!w && target(w.i, w.n, how) !== null; },
    move: (kind, id, how) => {
      const w = where(kind, id);
      const to = w ? target(w.i, w.n, how) : null;
      if (to === null) return;
      if (kind === 'session') placeSession(id, to); else placeProject(id, to);
    }
  };
  const ctlRef = useRef(controller);
  ctlRef.current = controller;
  useEffect(() => {
    if (!o.active) return;
    const proxy: ReorderCtl = { can: (...a) => ctlRef.current.can(...a), move: (...a) => ctlRef.current.move(...a) };
    publish(proxy);
    return () => { if (ctl === proxy) publish(null); };
  }, [o.active]);
  // The daemon refused a move: the list changed meanwhile, or it is too old to keep the order. Said; the row stays where it was.
  useEffect(() => o.write?.onRefused(code => latest.current.notify(code === 'stale' ? r.stale(lastMoved.current) : r.outdated(lastMoved.current))), [o.write, r]);

  /** The drop of `dragged` before or after row `over` (same group, or another project for a project). */
  const drop = (over: Mark) => {
    const d = dragged;
    setDragged(null); setMark(null); setFileOver(null);
    if (!d || d.id === over.id) return;
    if (d.kind === 'project') {
      const list = visibleProjects();
      const from = list.indexOf(d.id), at = list.indexOf(over.id);
      if (from >= 0 && at >= 0) placeProject(d.id, dropIndex(from, at, over.after));
      return;
    }
    const g = visibleGroup(d.id);
    if (!g) return;
    const from = g.sessions.findIndex(s => s.id === d.id), at = g.sessions.findIndex(s => s.id === over.id);
    if (from >= 0 && at >= 0) placeSession(d.id, dropIndex(from, at, over.after));
  };
  /** Whether `dragged` may land by row `id` (a session among its group's, a project among the projects). */
  const accepts = (kind: 'session' | 'project', id: string): boolean => {
    const d = dragged;
    if (!d || d.kind !== kind || d.id === id || !latest.current.write) return false;
    if (kind === 'project') return true;
    const g = visibleGroup(d.id);
    return !!g && g.sessions.some(s => s.id === id);
  };

  return { controller, said, dragged, setDragged, mark, setMark, drop, accepts, fileOver, setFileOver };
}
