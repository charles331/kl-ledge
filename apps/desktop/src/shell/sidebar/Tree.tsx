import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type DragEvent } from 'react';
import { contextShare, SESSION_LABEL_MAX, type Helper, type Projects, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import { useI18n } from '../../i18n/lang';
import { spanOf } from '../../list/time';
import { taskOf } from '../../nav/agents';
import { ProjectSwatch } from '../../projects/ProjectSwatch';
import { RigTag } from '../../openrig/RigTag';
import { cls } from '../cls';
import { ROUTINE_ICONS } from '../../routines/icons';
import { SHELL_ICONS } from '../icons';
import { ProviderLogo } from '../../ide/ProviderLogo';
import { providerOf } from '../../workspace/sessionTab';
import { kidsAtWork, newestCommand, restingWithWork } from '../../session/background';
import { AutoMark } from '../SessionBot';
import { useSkin } from '../theme';
import { useReorder, type OrderWriter } from './useReorder';
import type { MenuTarget } from '../../manage/useContextMenu';
import { isMenuKey, menuPoint } from './menuPoint';
import type { ProjectGroup } from './model';
import { SessionName } from '@ledge/ui/ui/SessionName';

const branchIcon = ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18 9a9 9 0 0 1-9 9'];

/** The branches a repository usually starts on: their tag stays quiet, the others stand out. */
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk']);

/** An agent's branch on its row, when the tree does not group by branch. None when the session knows no branch (no repository). */
function BranchTag({ session }: { session: Session }): JSX.Element | null {
  const { t } = useI18n();
  const b = session.branch?.trim();
  if (!b) return null;
  return (
    <span className={cls('st-btag', DEFAULT_BRANCHES.has(b) && 'default')} title={t.side.branchTag(b)}>
      <Icon d={branchIcon} size={9} /><span className="st-btag-name">{b}</span>{session.worktree && <i>wt</i>}
    </span>
  );
}

/** A row the keyboard walks: Left folds it (or goes to its parent), Right unfolds it. `session` is set only for a principal. */
interface Nav { toggle?: () => void; open?: boolean; parent?: string; session?: Session; target?: MenuTarget }

/** The six-dot grip a draggable row shows on hover: drawn dots, so it sits the same whatever the font (the « ⋮⋮ » glyphs did not). */
function Grip({ title }: { title: string }): JSX.Element {
  return <span className="st-grip" aria-hidden="true" title={title}><i /><i /><i /><i /><i /><i /></span>;
}

/** A session's nickname as a field, in place (docs/mockups/ledge-sidebar-names.html, card 2, v2): its name stays shown in brackets,
 *  the nickname selected at first (empty, « Surnom de Otto » greyed, when it has none). Enter or a click elsewhere keeps it, an emptied
 *  field removes it, Escape leaves it as it was. Nothing is refused, a nickname being only shown; the keys stay in the field (the
 *  tree's own E, Delete, H… would act on the row). */
function RenameField({ session, outdated, onDone }: { session: Session; outdated: string | null; onDone(label: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const r = t.side.rename;
  const [value, setValue] = useState(session.label ?? '');
  const touched = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  // Given elsewhere meanwhile (another window, the phone): the field follows as long as nothing was typed in it.
  useEffect(() => { if (!touched.current) setValue(session.label ?? ''); }, [session.label]);
  const finish = (label: string | null) => { if (done.current) return; done.current = true; onDone(label); };
  const keep = () => {
    const label = value.trim().slice(0, SESSION_LABEL_MAX);
    finish(outdated || label === (session.label ?? '') ? null : label);
  };
  return (
    <div className="st-main st-renaming">
      <strong><input ref={field} className={cls('st-rename', outdated && 'bad')} value={value} maxLength={SESSION_LABEL_MAX} spellCheck={false} autoComplete="off"
        placeholder={r.placeholder(session.name)} aria-label={r.placeholder(session.name)} aria-invalid={outdated ? true : undefined} aria-describedby={`rename-${session.id}`}
        onChange={e => { touched.current = true; setValue(e.target.value); }}
        onBlur={keep}
        onContextMenu={e => e.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); if (!outdated) keep(); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        }} /><span className="sn-name">({session.name})</span></strong>
      {outdated ? <span id={`rename-${session.id}`} className="st-rename-err" role="alert">{outdated}</span>
        : <span id={`rename-${session.id}`} className="st-rename-hint"><kbd>↵</kbd> {r.keep} · <kbd>{r.escKey}</kbd> {r.cancel}</span>}
    </div>
  );
}

/** Issue #32 (design-ux and the lead, 2026-11-26): each branch tag of `root` shows its name while the line leaves it room for its icon
 *  and three characters with « … »; with less, its icon alone (`data-fit="icon"`), so that room goes back to the session's name. The room
 *  is the name's line (its topic beside it in the compact view gives way) less the session's full name and its other marks: what the
 *  tag is now does not change it, so the choice never flips back and forth. */
export function fitBranchTags(root: HTMLElement): void {
  for (const tag of root.querySelectorAll<HTMLElement>('.st-agent .st-main strong > .st-btag')) {
    const line = tag.parentElement!;
    const main = line.parentElement!;
    const text = tag.querySelector<HTMLElement>('.st-btag-name');
    const icon = tag.querySelector('svg');
    if (!text || !icon) continue;
    const topic = main.querySelector(':scope > span');
    const dense = getComputedStyle(main).flexDirection === 'row';
    const room = main.clientWidth - (dense && topic ? parseFloat(getComputedStyle(main).columnGap) || 0 : 0);
    let others = 0;
    for (const el of line.children) {
      if (el === tag) continue;
      const cs = getComputedStyle(el);
      // The name at its full width (it is clipped when cut), the other marks as they are, with their margins.
      others += (el.classList.contains('st-aname') ? el.scrollWidth : el.getBoundingClientRect().width) + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
    }
    const cs = getComputedStyle(tag);
    const frame = ['marginLeft', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + (parseFloat(cs[k as 'marginLeft']) || 0), 0)
      + icon.getBoundingClientRect().width;
    // The tag's font is monospaced: one character's width is the name's width over its length; three of them and « … ».
    const name = text.textContent ?? '';
    const ch = name.length > 0 ? text.scrollWidth / name.length : 0;
    // Its other parts (« wt » for a worktree) at their full width, each after the tag's 3 px gap and its own 2 px margin (sidebar.css,
    // .st-btag and .st-btag i). Constants, not read: the icon state folds both to nothing, and the room needed must not depend on it.
    let extra = 0;
    for (const el of tag.children) if (el !== icon && el !== text) extra += 3 + 2 + (el as HTMLElement).scrollWidth;
    const need = frame + 3 + 4 * ch + extra;
    const fit = room - others >= need ? null : 'icon';
    if ((tag.dataset.fit ?? null) !== fit) { if (fit) tag.dataset.fit = fit; else delete tag.dataset.fit; }
  }
}

/** A project's fold key (« Sans projet »: `p:none`); a branch's is `p:<id>:<branch>`. */
export const projectKey = (id: string | null): string => `p:${id ?? 'none'}`;

function helperNeeds(s: Session, h: Helper): boolean {
  if (s.offline) return false;
  if (s.pending?.helperId === h.id) return true;
  return h.state === 'waiting_permission' || h.state === 'waiting_input' || h.state === 'error';
}

function placeOf(groups: readonly ProjectGroup[], id: string): { session: Session; pkey: string; bkey: string } | null {
  for (const g of groups) {
    const pkey = projectKey(g.id);
    for (const b of g.branches) {
      const session = b.sessions.find(s => s.id === id);
      if (session) return { session, pkey, bkey: `${pkey}:${b.branch}` };
    }
  }
  return null;
}

const flip = (set: ReadonlySet<string>, put: (n: Set<string>) => void, k: string) => {
  const n = new Set(set);
  if (n.has(k)) n.delete(k); else n.add(k);
  put(n);
};

/** « 12 min » / « 1 h » / « 3 d », or the list's « just now ». Same units as the List. */
function shortWhen(iso: string, units: { min: string; h: string; d: string }, nowLabel: string): string {
  const span = spanOf(Date.now() - (Date.parse(iso) || 0));
  return span === 'now' ? nowLabel : `${span.n} ${units[span.unit]}`;
}

/** A session that ended: with the eye pressed, it hides behind « +N terminées » until that row is opened. */
const isEnded = (s: Session): boolean => s.state === 'exited';

/** Project, then branch when the project has several, then session, then subagents.
 *  One branch folds into the project. The eye (docs/mockups/ledge-projects-eye.html): pressed, the projects with a live agent
 *  (`groups`, the others counted in `hiddenProjects`), their ended sessions behind « +N terminées »; released, every project, all open. */
const CTX_GAUGE = ['M12 14l4-4', 'M3.3 19a10 10 0 1 1 17.4 0'];
/** A session past « Contexte max »: the gauge and « 88 % », amber, its context in the title. Nothing below it. */
function CtxSignal({ session, near }: { session: Session; near: number }) {
  const { t } = useI18n();
  const share = contextShare(session.context);
  if (share === undefined || share < near) return null;
  const pct = Math.round(share * 100);
  return <span className="st-ctx" title={t.handover.gauge(pct)}><Icon d={CTX_GAUGE} size={11} />{pct} %</span>;
}

/** A routine's clock after a session's name (card 12): a click shows the Routines view and the routine's page, without opening
 *  the session (the row's own click). Inside the row's button, so it answers the mouse; the keyboard reaches routines in their view. */
export function RoutineClock({ of }: { of: { tip: string; onClick(): void } | null | undefined }): JSX.Element | null {
  if (!of) return null;
  return (
    <span className="rtn-clock" title={of.tip} aria-label={of.tip} role="img" data-routine-clock
      onClick={e => { e.stopPropagation(); e.preventDefault(); of.onClick(); }}><Icon d={ROUTINE_ICONS.clock} size={12} /></span>
  );
}

export function Tree(p: {
  groups: ProjectGroup[];
  /** « Contexte max »: past it a row says its context, compactly (docs/mockups/ledge-harness-usage.html, « ◔ 88 % »). */
  near?: number;
  /** What is folded (projects and branches, by `projectKey`): held by the sidebar, so its menus fold too. */
  closed: ReadonlySet<string>;
  onClosed: Dispatch<SetStateAction<Set<string>>>;
  sessions: readonly Session[];
  projects: Projects | null;
  current: string | null;
  filter: string;
  hideDone: boolean;
  /** The projects the pressed eye hides: « +N projets sans agent actif » under the tree, or « Aucun agent actif. » alone. */
  hiddenProjects: number;
  /** Some session is in the projects' tree, shown or not: without any, its box offers one (sidebar tidy, point 3). */
  anySession: boolean;
  dense: boolean;
  /** Project › branch › agent; false: each project lists its agents, their branch as a tag on the row. */
  byBranch: boolean;
  filing: Filing;
  revealCurrent: number;
  onHome(project?: string): void;
  onOpen(id: string, helper?: string): void;
  onLaunch(project?: string): void;
  /** « Écrire à tout le projet… »: the ✉ beside « + » on a project's row; none (a daemon that does not take it), no ✉. */
  onBroadcast?(project: string): void;
  /** The sessions picked with Ctrl/⌘ + click, to write to them together; a plain click still opens. No `onPick`, no picking. */
  picked: ReadonlySet<string>;
  onPick?(id: string): void;
  /** The IDE: Ctrl/⌘ + click opens the session in a group on the right; picking moves to Shift + click. */
  onOpenRight?(id: string): void;
  /** A row's menu (right click, its « … », the menu key): what it is on, where, and the control the focus goes back to. */
  onMenu(target: MenuTarget, at: { x: number; y: number }, opener: HTMLElement | null): void;
  onArchive(ids: string[]): void;
  onDelete(ids: string[]): void;
  /** F2 on a principal's row: its nickname becomes a field in place, as the menu's « Renommer F2 » (a finished or offline session is refused there). */
  onRename(s: Session): void;
  /** The session whose nickname is a field now (docs/mockups/ledge-sidebar-names.html, card 2), and why it cannot be given one when
   *  its machine's Ledge is too old; `onRenamed` gets the new nickname (empty: none), or null for « leave it as it was ». */
  renaming?: { session: Session; outdated: string | null } | null;
  /** True when the focus went back where the rename was asked; false: the row takes it. */
  onRenamed?(label: string | null): boolean;
  onTerminal(s: Session): void;
  onToggleHide(): void;
  onToggleDense(): void;
  onToggleBranches(): void;
  onNewProject(): void;
  /** The IDE's Projects view: no « +N projets sans agent actif » row (the user, 2026-11-09: a project without a live session stays out). */
  ide?: boolean;
  /** The small clock on a session a routine wakes (routines mockup, card 12): its tooltip and its click; null for none. */
  clock?(s: Session): { tip: string; onClick(): void } | null;
  paused: boolean;
  /** Issue #16: putting projects and sessions in order (drag, Alt+↑ / Alt+↓ / Alt+Début, the menus). None: nothing moves. */
  reorder?: { write?: OrderWriter; all(project: string | null): readonly Session[]; notify(text: string): void };
}): JSX.Element {
  const { t } = useI18n();
  // Issue #28: under the « Atelier » skin a session that waits says « À toi » in place of its time.
  const skin = useSkin();
  // What the eye shows of a group (its finished sessions may be hidden, unless « +N finished » showed them): a move steps over the rest.
  const shownIn = (s: Session, g: { project: string | null; branch?: string }) => {
    const key = g.branch !== undefined ? `${projectKey(g.project)}:${g.branch}` : projectKey(g.project);
    return !p.hideDone || shown.has(key) || !isEnded(s);
  };
  const ro = useReorder({ groups: p.groups, byBranch: p.byBranch, projects: p.projects, all: project => p.reorder?.all(project) ?? [], ...(p.reorder?.write ? { write: p.reorder.write } : {}), notify: text => p.reorder?.notify(text), active: !!p.reorder, shown: shownIn });
  const canDrag = !!p.reorder?.write;
  /** After a move by the keyboard, the row keeps the focus once the daemon's broadcast redraws the tree. */
  const keepFocus = (key: string) => requestAnimationFrame(() => requestAnimationFrame(() => {
    [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])].find(x => x.dataset.treeKey === key)?.focus();
  }));
  /** Before or after `el`'s middle: where a drop by the pointer lands. */
  const half = (e: DragEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  const { closed, onClosed: setClosed } = p;
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [kids, setKids] = useState<Set<string>>(() => new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const nav = useRef(new Map<string, Nav>());
  // #32: the branch tags fitted after each render (a name, a mark or the tree changed) and whenever the explorer's width does, or its
  // fonts arrive. Only the tree not grouped by branch has them.
  useLayoutEffect(() => { if (!p.byBranch && treeRef.current) fitBranchTags(treeRef.current); });
  useEffect(() => {
    const el = treeRef.current;
    if (p.byBranch || !el) return;
    const fit = () => fitBranchTags(el);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro?.disconnect();
  }, [p.byBranch]);
  const latest = useRef(p);
  latest.current = p;
  nav.current = new Map();

  const reveal = (key: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.st [data-tree-key]')].find(x => x.dataset.treeKey === key);
      el?.scrollIntoView?.({ block: 'nearest' });
    }));
  };
  const openTo = (id: string, kidsToo: boolean) => {
    if (!latest.current.sessions.some(s => s.id === id)) return;
    const found = placeOf(latest.current.groups, id);
    if (!found) return;
    setClosed(c => { const n = new Set(c); n.delete(found.pkey); n.delete(found.bkey); return n; });
    if (isEnded(found.session)) setShown(s => { const n = new Set(s); n.add(found.pkey); n.add(found.bkey); return n; });
    if (kidsToo && found.session.helpers.length > 0) {
      const s = found.session;
      setKids(k => {
        const n = new Set(k);
        if (s.helpers.some(h => helperNeeds(s, h))) n.delete(s.id); else n.add(s.id);
        return n;
      });
    }
    reveal(id);
  };
  useEffect(() => { if (p.current) openTo(p.current, false); }, [p.current]);
  useEffect(() => { if (p.revealCurrent && p.current) openTo(p.current, true); }, [p.revealCurrent]);
  // A rename asked from the session page or the atelier: its row is unfolded into view, so the field has a place to open.
  useEffect(() => { if (p.renaming) openTo(p.renaming.session.id, false); }, [p.renaming?.session.id]);
  // H hides every ended session again, the ones a « +N finished » showed included, but not the open one.
  useEffect(() => {
    if (!p.hideDone) return;
    setShown(new Set());
    if (p.current) openTo(p.current, false);
  }, [p.hideDone]);

  // Roving tabindex: the open session, or the first row when the atelier has none, is the tree's only tab stop.
  const tabKey = p.current && placeOf(p.groups, p.current) ? p.current : (p.groups[0] ? projectKey(p.groups[0].id) : '');
  const tabOf = (key: string) => key === tabKey ? 0 : -1;

  const menuOn = (target: MenuTarget, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    p.onMenu(target, menuPoint(e, el), el.querySelector<HTMLElement>('[data-tree-key]') ?? el);
  };

  const onTreeKey = (e: ReactKeyboardEvent) => {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-tree-key]') : null;
    // Issue #16: Alt+↑ / Alt+↓ move the row one place within its group, Alt+Début puts it first.
    if (el && e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home')) {
      const t0 = nav.current.get(el.dataset.treeKey!)?.target;
      const how = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : 'top';
      if (t0 && (t0.kind === 'session' || t0.kind === 'project')) {
        e.preventDefault(); e.stopPropagation();
        ro.controller.move(t0.kind, t0.id, how);
        keepFocus(el.dataset.treeKey!);
      }
      return;
    }
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = nav.current.get(el.dataset.treeKey!);
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
    const focusKey = (k: string | undefined) => items.find(x => x.dataset.treeKey === k)?.focus();
    const i = items.indexOf(el);
    const k = e.key.toLowerCase();
    let done = true;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowLeft') { if (n?.toggle && n.open) n.toggle(); else focusKey(n?.parent); }
    else if (e.key === 'ArrowRight') { if (n?.toggle && !n.open) n.toggle(); else items[i + 1]?.focus(); }
    else if (isMenuKey(e)) { if (n?.target) p.onMenu(n.target, menuPoint(e, el), el); }
    else if (k === 'e') { if (n?.session) p.onArchive([n.session.id]); }
    else if (e.key === 'Delete') { if (n?.session) p.onDelete([n.session.id]); }
    else if (e.key === 'F2') { if (n?.session) p.onRename(n.session); }
    else if (k === 'j' || k === 'k') { /* the atelier walks with these; the tree keeps them */ }
    else if (k === 'h') p.onToggleHide();
    else if (k === 'd') p.onToggleDense();
    else if (k === 'b') p.onToggleBranches();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  const Chevron = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
    <button type="button" tabIndex={-1} className="st-chev" aria-label={label} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
    </button>
  );

  const agentRows = (s: Session, depth: number, parentKey: string, helper?: Helper): ReactNode[] => {
    const subs = helper ? [] : (s.helpers ?? []);
    const auto = subs.some(h => helperNeeds(s, h));
    const open = subs.length > 0 && auto !== kids.has(s.id);
    const toggle = subs.length > 0 ? () => flip(kids, setKids, s.id) : undefined;
    const treeKey = helper ? `${s.id}:${helper.id}` : s.id;
    if (!helper) nav.current.set(s.id, { toggle, open, parent: parentKey, session: s, target: { kind: 'session', id: s.id } });
    else nav.current.set(treeKey, { parent: s.id });
    const selected = !helper && p.current === s.id;
    const name = helper ? helper.kind : s.name;
    const task = helper ? helper.task : taskOf(s);
    const waiting = helper ? helperNeeds(s, helper) : !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error');
    // Issue #1: an available session with work in the background (its ring, its tip), the subagents at work, its newest command.
    const bg = helper ? undefined : restingWithWork(s);
    const atWork = helper ? 0 : kidsAtWork(s);
    const cmd = helper || s.offline || isEnded(s) ? undefined : newestCommand(s.background ?? []);
    const bgTip = !bg ? undefined : bg.subagents > 0 ? t.side.bgTip.kids(bg.subagents) : bg.commands.length ? t.side.bgTip.command(bg.commands.at(-1)!.label) : undefined;
    const timeClass = s.offline ? undefined : helper
      ? (helper.state === 'waiting_permission' ? 't-approval' : helper.state === 'waiting_input' ? 't-question' : helper.state === 'error' ? 't-error' : undefined)
      : (s.state === 'waiting_permission' ? 't-approval' : s.state === 'waiting_input' ? 't-question' : s.state === 'error' ? 't-error' : undefined);
    const editing = !helper && p.renaming?.session.id === s.id ? p.renaming : null;
    const row = (
      <div key={treeKey} role="treeitem" aria-level={depth + 1} aria-expanded={subs.length > 0 ? open : undefined}
        aria-selected={selected} aria-current={selected ? 'true' : undefined}
        className={cls('st-row st-agent', (selected || !!editing) && 'sel', !helper && p.picked.has(s.id) && 'picked', !helper && isEnded(s) && 'done', s.offline && 'off', !!helper && 'helper',
          !helper && canDrag && 'st-grab', ro.dragged?.kind === 'session' && ro.dragged.id === s.id && 'st-lifted',
          !helper && ro.mark?.id === s.id && (ro.mark.after ? 'st-mark-after' : 'st-mark-before'))}
        style={{ '--d': depth } as CSSProperties}
        {...(!helper && canDrag && !editing ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; ro.setDragged({ kind: 'session', id: s.id }); },
          onDragEnd: () => { ro.setDragged(null); ro.setMark(null); ro.setFileOver(null); },
          onDragOver: (e: DragEvent<HTMLElement>) => { if (!ro.accepts('session', s.id)) { if (ro.mark) ro.setMark(null); return; } e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const after = half(e); if (ro.mark?.id !== s.id || ro.mark.after !== after) ro.setMark({ id: s.id, after }); },
          onDrop: (e: DragEvent<HTMLElement>) => { if (!ro.accepts('session', s.id) || !ro.mark) return; e.preventDefault(); ro.drop(ro.mark); }
        } : {})}
        onContextMenu={helper ? undefined : e => menuOn({ kind: 'session', id: s.id }, e)}>
        {!helper && canDrag && <Grip title={t.side.reorder.grip} />}
        {toggle ? <Chevron open={open} label={open ? t.side.foldKids(name) : t.side.unfoldKids(name)} onClick={toggle} /> : <span className="st-gap" />}
        <span className="st-bot"><ProviderLogo provider={providerOf(s.tool)} size={14} />{bg && <span className="st-bg-ring" aria-hidden="true" />}</span>
        {/* No « Name, » label: boot() and the title bar find the atelier seat with /^Name,/. */}
        {editing ? <RenameField session={s} outdated={editing.outdated} onDone={label => { if (!p.onRenamed?.(label)) keepFocus(treeKey); }} /> :
        <button type="button" className="st-main" data-tree-key={treeKey} tabIndex={tabOf(treeKey)} title={bgTip}
          onClick={e => { const mod = e.ctrlKey || e.metaKey; if (!helper && p.onOpenRight && mod) p.onOpenRight(s.id); else if (!helper && p.onPick && (p.onOpenRight ? e.shiftKey : mod)) p.onPick(s.id); else if (helper) p.onOpen(s.id, helper.id); else p.onOpen(s.id); }}>
          <strong><span className="st-aname">{helper ? name : <SessionName session={s} />}</span>{!helper && <RoutineClock of={p.clock?.(s)} />}{!helper && <AutoMark session={s} />}{!helper && <RigTag session={s} />}{!helper && !p.byBranch && <BranchTag session={s} />}{!helper && p.near !== undefined && <CtxSignal session={s} near={p.near} />}</strong>{task && <span>{task}</span>}
          {cmd && <span className="st-bgcmd"><Icon d={SHELL_ICONS.terminal} size={11} /><span>{cmd.label} · {t.side.background}{cmd.others > 0 ? ` +${cmd.others}` : ''}</span></span>}
        </button>}
        {subs.length > 0 && !open && <span className={cls('st-kids', atWork > 0 && 'on')} title={atWork > 0 ? t.side.kidsWorking(subs.length, atWork) : t.side.kids(subs.length)}>
          {atWork > 0 && <i className="st-kids-spin" aria-hidden="true" />}{subs.length}</span>}
        <span className={cls('st-time', waiting && timeClass)}>{skin && waiting && !helper && !s.offline ? <span className="at-tag">{t.side.yours}</span> : s.offline ? t.side.offline : shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span>
        <span className="st-acts">
          <button type="button" tabIndex={-1} aria-label={t.side.terminalOne(name)} title="Terminal · T" onClick={() => p.onTerminal(s)}><Icon d={SHELL_ICONS.terminal} size={13} /></button>
          {!helper && <button type="button" tabIndex={-1} aria-label={t.side.archiveOne(s.name)} title={`${t.manage.menu.archive} · E`} onClick={() => p.onArchive([s.id])}><Icon d={SHELL_ICONS.archive} size={13} /></button>}
          {!helper && <button type="button" tabIndex={-1} aria-label={t.side.manageOne(s.name)} aria-haspopup="menu" title={t.manage.menu.more} onClick={e => menuOn({ kind: 'session', id: s.id }, e)}><Icon d={[]} fill={SHELL_ICONS.dots} size={13} /></button>}
        </span>
      </div>
    );
    return [row, ...(open ? subs.flatMap(h => agentRows(s, depth + 1, s.id, h)) : [])];
  };

  const sessionRows = (list: readonly Session[], depth: number, key: string, parentKey: string): ReactNode[] => {
    const done = list.filter(isEnded);
    const all = !p.hideDone || shown.has(key);
    const rows = list.filter(s => all || !isEnded(s)).flatMap(s => agentRows(s, depth, parentKey));
    // Once shown, the finished ones stay until H hides them all again: no « Hide finished » link. Archiving stays per session.
    if (!all && done.length > 0) {
      const moreKey = `${key}:more`;
      nav.current.set(moreKey, { parent: parentKey });
      rows.push(
        <div key={moreKey} className="st-row st-more" style={{ '--d': depth } as CSSProperties}>
          <span className="st-gap" />
          <button type="button" data-tree-key={moreKey} tabIndex={tabOf(moreKey)} aria-expanded={false} onClick={() => flip(shown, setShown, key)}>
            {t.side.moreDone(done.length)}
          </button>
        </div>
      );
    }
    return rows;
  };

  const tally = (g: ProjectGroup) => {
    const sessions = g.branches.flatMap(b => b.sessions);
    let need = 0, work = 0, off = 0, done = 0, bg = 0;
    for (const s of sessions) {
      if (s.offline) off++;
      else if (isEnded(s)) done++;
      else if (s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error') need++;
      else if (s.state === 'working') work++;
      else if (restingWithWork(s)) bg++;
      if (s.offline) continue;
      for (const h of s.helpers ?? []) {
        if (helperNeeds(s, h)) need++;
        else if (h.state === 'working') work++;
      }
    }
    return [
      { n: need, c: 't-need', label: t.side.tallyNeed },
      { n: work, c: 't-work', label: t.side.tallyWork },
      { n: bg, c: 't-bg', label: t.side.tallyBackground },
      { n: off, c: 't-off', label: t.side.tallyOff },
      { n: p.hideDone ? 0 : done, c: 't-done', label: t.side.tallyDone }
    ].filter(x => x.n > 0);
  };

  const rows: ReactNode[] = [];
  // #16 review C2: « after » a project lands below its sessions, so its line is drawn there: before the next project's row, or at the
  // end of the tree for the last one, never between a project's heading and its first session.
  const projectMark = ro.dragged?.kind === 'project' ? ro.mark : null;
  const projectIds = p.groups.map(g => g.id);
  // « Sans projet » (null, always last) takes the line before it too: a project dropped after the last one lands above it.
  const lineBefore = (gid: string | null): boolean => {
    if (!projectMark) return false;
    if (gid !== null && projectMark.id === gid && !projectMark.after) return true;
    const i = projectIds.indexOf(gid);
    return i > 0 && projectMark.after && projectIds[i - 1] === projectMark.id;
  };
  // The tree's end only when nothing follows the last project.
  const lastProject = projectIds.at(-1) ?? null;
  for (const g of p.groups) {
    const label = g.id === null ? t.side.unassigned : g.name;
    const pkey = projectKey(g.id);
    // Issue #16: in the person's order (not branch by branch, which only the « by branch » view shows).
    const sessions = g.sessions;
    const has = sessions.length > 0;
    const open = has && !closed.has(pkey);
    const toggle = has ? () => flip(closed, setClosed, pkey) : undefined;
    const branch = g.branches.length === 1 ? g.branches[0]!.branch : undefined;
    const sub = p.byBranch && g.flatten && branch && g.repo ? `${g.repo} · ${branch}` : (g.repo ?? '');
    const project = g.id ? p.projects?.projects.find(x => x.id === g.id) ?? null : null;
    const target: MenuTarget = g.id ? { kind: 'project', id: g.id } : { kind: 'unassigned' };
    nav.current.set(pkey, { toggle, open, target });
    // Issue #16: a project row moves among the projects (drag, the keys); a session from another project dropped on it is filed
    // there (« Ranger dans… », 1A); its own project's row takes no session.
    const gid = g.id;
    const fileDrop = gid ? p.filing.dropProps(gid) : null;
    const ownSession = ro.dragged?.kind === 'session' && sessions.some(x => x.id === ro.dragged!.id);
    // A session of the tree over another project (1A), or one dragged from the Atelier (the filing's own drag).
    const draggedSession = ro.dragged?.kind === 'session' ? p.sessions.find(x => x.id === ro.dragged!.id) ?? null : null;
    const filingHere = gid !== null && ((draggedSession && ro.fileOver === gid) || (p.filing.over === gid && !!p.filing.dragging));
    const filedName = draggedSession?.name ?? p.filing.dragging?.name ?? '';
    const dnd = gid ? {
      ...(canDrag ? {
        draggable: true,
        onDragStart: (e: DragEvent<HTMLElement>) => { e.dataTransfer.setData('text/plain', gid); e.dataTransfer.effectAllowed = 'move'; ro.setDragged({ kind: 'project', id: gid }); },
        onDragEnd: () => { ro.setDragged(null); ro.setMark(null); }
      } : {}),
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (ro.dragged?.kind === 'project') {
          if (!ro.accepts('project', gid)) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          const after = half(e); if (ro.mark?.id !== gid || ro.mark.after !== after) ro.setMark({ id: gid, after });
        } else if (draggedSession) {
          if (ro.mark) ro.setMark(null);
          if (ownSession) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          if (ro.fileOver !== gid) ro.setFileOver(gid);
        } else fileDrop!.onDragOver(e);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (draggedSession) { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && ro.fileOver === gid) ro.setFileOver(null); }
        else fileDrop!.onDragLeave(e);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (ro.dragged?.kind === 'project') { if (ro.accepts('project', gid) && ro.mark) { e.preventDefault(); ro.drop(ro.mark); } }
        else if (draggedSession) { if (!ownSession) { e.preventDefault(); p.filing.file(draggedSession, gid); } ro.setDragged(null); ro.setFileOver(null); }
        else fileDrop!.onDrop(e);
      }
    } : {};
    rows.push(
      <div key={pkey} role="treeitem" aria-level={1} aria-expanded={has ? open : undefined}
        className={cls('st-row st-project', p.filter === (g.id ?? 'none') && !p.current && 'sel', filingHere && 'drop-over',
          gid !== null && canDrag && 'st-grab', ro.dragged?.kind === 'project' && ro.dragged.id === gid && 'st-lifted',
          lineBefore(gid) && 'st-mark-before')}
        style={{ '--d': 0 } as CSSProperties} {...dnd} onContextMenu={e => menuOn(target, e)}>
        {gid !== null && canDrag && <Grip title={t.side.reorder.grip} />}
        {filingHere && <span className="st-drop-tip" role="status">{t.side.reorder.fileInto(filedName, label)}</span>}
        {toggle ? <Chevron open={open} label={open ? t.side.fold(label) : t.side.unfold(label)} onClick={toggle} /> : <span className="st-gap" />}
        <ProjectSwatch project={project} />
        <button type="button" className="st-main" data-tree-key={pkey} tabIndex={tabOf(pkey)} title={t.side.filterProject(label)} onClick={() => p.onHome(g.id ?? 'none')}>
          <strong>{label}</strong>{sub && <span className="mono">{sub}</span>}
        </button>
        <span className="st-tally">{tally(g).map(x => <span key={x.c} className={x.c} title={`${x.n} ${x.label}`}><i />{x.n}</span>)}</span>
        {g.id && <span className="st-acts">
          {p.onBroadcast && <button type="button" tabIndex={-1} aria-label={t.broadcast.title(label)} title={t.broadcast.project} onClick={() => p.onBroadcast!(g.id!)}><Icon d={SHELL_ICONS.mail} size={13} /></button>}
          <button type="button" tabIndex={-1} aria-label={t.side.newHere(label)} title={t.side.newHere(label)} onClick={() => p.onLaunch(g.id!)}><Icon d={ICONS.plus.d} size={13} /></button>
        </span>}
      </div>
    );
    if (!open) continue;
    if (g.flatten || !p.byBranch) rows.push(...sessionRows(sessions, 1, pkey, pkey));
    else for (const b of g.branches) {
      const bkey = `${pkey}:${b.branch}`;
      const bopen = !closed.has(bkey);
      const btoggle = () => flip(closed, setClosed, bkey);
      const visible = b.sessions.filter(s => !p.hideDone || shown.has(bkey) || !isEnded(s)).length;
      nav.current.set(bkey, { toggle: btoggle, open: bopen, parent: pkey });
      rows.push(
        <div key={bkey} role="treeitem" aria-level={2} aria-expanded={bopen} className="st-row st-branch" style={{ '--d': 1 } as CSSProperties}>
          <Chevron open={bopen} label={bopen ? t.side.fold(b.branch) : t.side.unfold(b.branch)} onClick={btoggle} />
          <Icon d={branchIcon} size={13} />
          <button type="button" className="st-main mono" data-tree-key={bkey} tabIndex={tabOf(bkey)} onClick={btoggle}><span>{b.branch}</span></button>
          {b.worktree && <span className="st-wt" title={t.side.wt}>wt</span>}
          <span className="st-fill" />
          <span className="st-count">{visible}</span>
          <span className="st-acts">
            <button type="button" tabIndex={-1} aria-label={t.side.newOn(b.branch)} title={t.side.newOn(b.branch)} onClick={() => p.onLaunch(g.id ?? undefined)}><Icon d={ICONS.plus.d} size={13} /></button>
            <button type="button" tabIndex={-1} aria-label={t.side.terminalOne(b.branch)} title="Terminal" onClick={() => { const s = b.sessions[0]; if (s) p.onTerminal(s); }}><Icon d={SHELL_ICONS.terminal} size={13} /></button>
          </span>
        </div>
      );
      if (bopen) rows.push(...sessionRows(b.sessions, 2, bkey, bkey));
    }
  }

  // The pressed eye hides projects: a last row says how many, and opens them all (the eye released). Alone under the
  // « Aucune session » box, it is the tree's only tab stop.
  const moreKey = 'more-projects';
  const moreRow = p.hideDone && p.hiddenProjects > 0 && !p.ide ? (
    <div key={moreKey} className="st-row st-more st-more-projects" style={{ '--d': 0 } as CSSProperties}>
      <span className="st-gap" />
      <button type="button" data-tree-key={moreKey} tabIndex={p.groups.length === 0 ? 0 : tabOf(moreKey)} aria-expanded={false} onClick={p.onToggleHide}>{t.side.moreProjects(p.hiddenProjects)}</button>
    </div>
  ) : null;
  if (moreRow) { nav.current.set(moreKey, {}); if (p.groups.length > 0) rows.push(moreRow); }
  // H and D from the header's buttons and the « Aucun agent actif. » box too, as in the tree: that box has no tree to take them.
  const headKeys = (e: ReactKeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'h') p.onToggleHide(); else if (k === 'd') p.onToggleDense(); else if (k === 'b') p.onToggleBranches(); else return;
    e.preventDefault(); e.stopPropagation();
  };
  const header = (
    <div className="st-label" onKeyDown={headKeys}>
      <span>{t.side.projects}</span><span className="st-fill" />
      <button type="button" className={cls('st-icon', p.hideDone && 'on')} aria-pressed={p.hideDone} aria-label={t.side.hideDone} title={t.side.hideDone} onClick={p.onToggleHide}>
        <Icon d={SHELL_ICONS.eyeOff} size={14} />
      </button>
      <button type="button" className={cls('st-icon', p.byBranch && 'on')} aria-pressed={p.byBranch} aria-label={t.side.byBranch} title={t.side.byBranch} onClick={p.onToggleBranches}>
        <Icon d={branchIcon} size={14} />
      </button>
      <button type="button" className={cls('st-icon', p.dense && 'on')} aria-pressed={p.dense} aria-label={t.side.dense} title={t.side.dense} onClick={p.onToggleDense}>
        <Icon d={SHELL_ICONS.densityTight} size={14} />
      </button>
      <button type="button" className="st-icon" aria-label={t.side.foldAll} title={t.side.foldAll} onClick={() => setClosed(new Set(p.groups.map(g => projectKey(g.id))))}>
        <Icon d={SHELL_ICONS.foldAll} size={14} />
      </button>
      <button type="button" className="st-icon" aria-label={t.side.newProject} title={t.side.newProject} onClick={p.onNewProject}>
        <Icon d={ICONS.plus.d} size={14} />
      </button>
    </div>
  );
  // Projects, no session at all, the eye pressed: the header whole, the box that offers a session, and what the eye hides.
  const hides = p.hideDone && p.hiddenProjects > 0;
  if (p.groups.length === 0 && hides && !p.anySession) return (
    <>
      {header}
      <div className="st-empty" role="status" onKeyDown={headKeys}>
        <strong>{t.side.empty.sessions}</strong>
        <p>{t.side.empty.sessionsBody}</p>
        <button type="button" className="st-empty-btn" onClick={() => p.onLaunch()}><Icon d={ICONS.plus.d} size={13} />{t.side.empty.newSession}</button>
      </div>
      <div ref={treeRef} role="tree" aria-label={t.side.tree} className={cls('st-tree', p.dense && 'st-dense')} onKeyDown={onTreeKey}>{moreRow}</div>
    </>
  );
  // Sessions, but none live and the eye pressed: the header, and a box that releases the eye.
  if (p.groups.length === 0 && hides) return (
    <>
      {header}
      <div className="st-empty" role="status" onKeyDown={headKeys}>
        <strong>{t.side.empty.noActive}</strong>
        <p>{t.side.empty.noActiveBody}</p>
        <button type="button" className="st-empty-btn" onClick={p.onToggleHide}>{t.side.empty.showAll}</button>
      </div>
    </>
  );

  // No project and no session (docs/mockups/ledge-sidebar-tidy.html, point 3): the header keeps only « + », the box offers a session.
  if (p.groups.length === 0) return (
    <>
      <div className="st-label">
        <span>{t.side.projects}</span><span className="st-fill" />
        <button type="button" className="st-icon" aria-label={t.side.newProject} title={t.side.newProject} onClick={p.onNewProject}>
          <Icon d={ICONS.plus.d} size={14} />
        </button>
      </div>
      <div className="st-empty" role="status">
        <strong>{t.side.empty.sessions}</strong>
        <p>{t.side.empty.sessionsBody}</p>
        <button type="button" className="st-empty-btn" onClick={() => p.onLaunch()}><Icon d={ICONS.plus.d} size={13} />{t.side.empty.newSession}</button>
      </div>
    </>
  );

  return (
    <>
      {header}
      <div ref={treeRef} role="tree" aria-label={t.side.tree} className={cls('st-tree', p.dense && 'st-dense')} onKeyDown={onTreeKey}>{rows}{projectMark?.after && projectMark.id === lastProject && <div className="st-mark-end" aria-hidden="true" />}</div>
      {/* Issue #16: « Ida est maintenant 1re sur 3 dans feat/ide-shell. », for screen readers. */}
      {p.reorder && <div className="visually-hidden st-said" aria-live="polite" aria-atomic="true">{ro.said}</div>}
    </>
  );
}
