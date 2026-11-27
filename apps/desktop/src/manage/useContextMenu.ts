import { useEffect, useRef, useState } from 'react';
import { splitId, useMachines, type DaemonClient } from '@ledge/fleet';
import type { Project, Session } from '@ledge/protocol';

/** What a menu was opened on: a session (its own menu, `SessionMenu`), or a place of the sidebar (`SidebarMenuHost`). */
export type MenuTarget =
  | { kind: 'session'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'unassigned' }
  | { kind: 'archives' }
  | { kind: 'archive'; id: string };

export interface ContextMenuOpen { target: MenuTarget; at: { x: number; y: number }; opener: HTMLElement | null }

export interface ContextMenuState {
  /** The menu open now (one at a time): what it was opened on, where, and what gets the focus back. */
  menu: ContextMenuOpen | null;
  /** The session of a `session` target while it is still listed, else null. */
  session: Session | null;
  /** The session whose nickname is a field in the sidebar now (docs/mockups/ledge-sidebar-names.html, card 2), while it is listed. */
  renaming: Session | null;
  /** The machine of `renaming` when its Ledge is too old to take `session.label` (the machine's label), else null. */
  renameOutdated: string | null;
  /** Shorthand for a session target (the seats, the tree, the session page's « … »). */
  open(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void;
  openOn(target: MenuTarget, at: { x: number; y: number }, opener: HTMLElement | null): void;
  /** Closes the menu; the focus goes back to the opener unless the menu's own button already has it. */
  close(): void;
  /** The session's page with its terminal pane, on the agent's tab; an offline session shows its frozen screen there. */
  terminal(s: Session): void;
  /** Rename is for a session that answers and has not finished: its nickname becomes a field in the sidebar's tree. */
  rename(s: Session): void;
  /** Closes the field. True when the focus went back where F2 was pressed (the atelier, the session page); false when the rename
   *  came from a menu, the tree then keeping it on the row. */
  closeRename(): boolean;
  /** The new nickname (empty: none), sent to the session's daemon, the field closed (the focus as for `closeRename`). */
  sendRename(label: string): boolean;
}

/** The target still exists: a menu on something gone closes rather than acting on a stale id. */
function present(t: MenuTarget, sessions: readonly Session[], archived: readonly Session[], projects: readonly Project[]): boolean {
  switch (t.kind) {
    case 'session': return sessions.some(s => s.id === t.id);
    case 'archive': return archived.some(s => s.id === t.id);
    case 'project': return projects.some(p => p.id === t.id);
    default: return true;
  }
}

/** The one context menu of a window: the atelier's seats, the sidebar's rows and the session page's header « … » open it on their target,
 *  the focus goes back to what opened it, and the rename in place and the terminal (the app's `showTerminal`) ride along. A session target is
 *  rendered by `SessionMenuHost`, the sidebar's by `SidebarMenuHost`. */
export function useContextMenu({ client, sessions, archived, projects, onShowTerminal, onRenameStart }: {
  client: DaemonClient; sessions: readonly Session[]; archived: readonly Session[]; projects: readonly Project[]; onShowTerminal(id: string): void;
  /** A rename asked from anywhere (the session page's F2, the atelier's): the sidebar's tree is brought into view, where the field is. */
  onRenameStart?(s: Session): void;
}): ContextMenuState {
  const [menu, setMenu] = useState<ContextMenuOpen | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameFrom = useRef<HTMLElement | null>(null);
  const back = () => {
    const el = renameFrom.current; renameFrom.current = null; setRenamingId(null);
    if (!el?.isConnected) return false;
    requestAnimationFrame(() => el.focus());
    return true;
  };
  // A session that ends, goes offline or leaves the list while its name is a field drops the field.
  const renaming = sessions.find(s => s.id === renamingId && s.state !== 'exited' && !s.offline) ?? null;
  const machines = useMachines(client);
  const machine = renaming ? machines.find(m => m.id === (splitId(renaming.id)?.machine ?? renaming.machineId ?? 'local')) : undefined;
  const renameOutdated = renaming && machine && !machine.daemon?.sessionLabel ? machine.label : null;
  const target = menu?.target;
  const session = target?.kind === 'session' ? sessions.find(s => s.id === target.id) ?? null : null;
  const gone = target !== undefined && !present(target, sessions, archived, projects);
  useEffect(() => { if (gone) setMenu(null); }, [gone]);
  return {
    menu: gone ? null : menu, session, renaming, renameOutdated,
    open: (id, at, opener) => setMenu({ target: { kind: 'session', id }, at, opener }),
    openOn: (t, at, opener) => setMenu({ target: t, at, opener }),
    close: () => {
      const opener = menu?.opener;
      setMenu(null);
      // The menu's own button (the « … ») is given the focus by the menu itself; a context menu has none: back to the row or the seat.
      const active = document.activeElement;
      if (opener?.isConnected && (active === null || active === document.body || active.closest('[role=menu]'))) opener.focus();
    },
    terminal: s => onShowTerminal(s.id),
    rename: s => {
      if (s.state === 'exited' || s.offline) return;
      // Where the keyboard was: a menu's item goes with the menu, so a rename from a menu leaves the focus to the tree's row.
      const at = document.activeElement;
      renameFrom.current = at instanceof HTMLElement && at !== document.body && !at.closest('[role=menu]') ? at : null;
      setRenamingId(s.id); onRenameStart?.(s);
    },
    closeRename: back,
    sendRename: label => { if (renaming && !renameOutdated) client.send({ type: 'session.label', id: renaming.id, label }); return back(); }
  };
}
