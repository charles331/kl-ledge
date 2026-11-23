import { useState, type JSX, type MouseEvent } from 'react';
import type { Session } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { Messages } from '../i18n/messages';
import { dotOf } from '../nav/agents';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { ProviderLogo } from '../ide/ProviderLogo';
import { providerOf } from '../workspace/sessionTab';
import { AlarmIcon, ROUTINE_ICONS } from './icons';
import { failedLast, lastRunOf, routineRef, sideGroups, waitsForOwner, whyText, type GroupKey, type Proposal } from './model';
import { dayMonth, firstMoment, hhmm, localZone, momentDate, nextLabel, scheduleLine } from './schedule';
import '../styles/routines.css';

/** How the session a routine wakes is doing (« Réveille Iris ● Au travail », the row's dot): working, available, stopped; the
 *  states the mockup does not draw take the phone's words (design-ux, point 4). */
export function sessionLook(s: Session | undefined, t: Messages): { dot: 'work' | 'idle' | 'off' | 'perm' | 'ask'; label: string } {
  const r = t.routines.st;
  if (!s || s.offline || s.state === 'exited') return { dot: 'off', label: r.off };
  if (s.state === 'starting') return { dot: 'work', label: t.routines.stMore.starting };
  const d = dotOf(s);
  if (d === 'working') return { dot: 'work', label: r.working };
  if (d === 'done') return { dot: 'idle', label: r.idle };
  if (d === 'offline') return { dot: 'off', label: r.off };
  return { dot: d === 'question' ? 'ask' : 'perm', label: t.routines.stMore[d === 'question' ? 'question' : d === 'approval' ? 'approval' : 'error'] };
}

export interface RoutinesViewProps {
  routines: readonly FleetRoutine[];
  proposals: readonly Proposal[];
  /** The session each routine wakes, for its dot. */
  sessionOf(r: FleetRoutine): Session | undefined;
  /** A folder of a routine's machine, from `~` (a failure's reason names it). */
  dirLabel?(r: FleetRoutine, path: string): string;
  /** The routine in front of the focused group (its tab ref), lit; and those the explorer's clock asked to light (card 12). */
  current: string | null; lit?: ReadonlySet<string>;
  /** « Lancer maintenant » in flight, by ref (card 9). */
  running: ReadonlyMap<string, string>;
  /** The machines that keep routines: with more than one, a title per machine above its groups (card 28). */
  machines?: readonly { id: string; label: string; up: boolean }[];
  /** The local daemon: still connecting, or down (card 11). */
  connecting: boolean; offline: boolean;
  now?(): number;
  onOpen(r: FleetRoutine): void; onNew(): void;
  onRun(r: FleetRoutine): void; onPause(r: FleetRoutine): void; onResume(r: FleetRoutine): void;
  onOpenSession(r: FleetRoutine): void; onDelete(r: FleetRoutine): void;
}

/** The sidebar's « Routines » (cards 2, 11, 21): the routines in folding groups, Récurrentes, Uniques, En pause and Passées (the
 *  last two folded), each in card 2's order. A row: a mark (the session's dot, ?, !, ‖), the name and the next run, then
 *  logo · session · schedule, and a third line only when there is something to say. Hover: Lancer maintenant and Pause /
 *  Reprendre in place of the next run; right click: its menu. « + » opens a « Nouvelle routine » tab; the foot names the zone. */
export function RoutinesView(p: RoutinesViewProps): JSX.Element {
  const { t, lang } = useI18n();
  const r = t.routines;
  const now = (p.now ?? Date.now)();
  const today = new Date(now);
  // Folded groups, by machine and group (`machine/key`); En pause and Passées start folded.
  const [flip, setFlip] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (m: string, k: GroupKey) => (k === 'recurring' || k === 'once') !== flip.has(`${m}/${k}`);
  const toggle = (m: string, k: GroupKey) => setFlip(s => { const n = new Set(s); const id = `${m}/${k}`; if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [menu, setMenu] = useState<{ r: FleetRoutine; at: { x: number; y: number } } | null>(null);
  const several = (p.machines?.length ?? 0) > 1;
  const off = p.offline;

  const mark = (x: FleetRoutine) => {
    if (x.state === 'done') return <span className="rtn-mk ok" aria-hidden="true">✓</span>;
    if (waitsForOwner(x)) return <span className="rtn-mk ask" aria-hidden="true">?</span>;
    if (failedLast(x)) return <span className="rtn-mk bad" aria-hidden="true">!</span>;
    if (x.state === 'paused') return <span className="rtn-mk" aria-hidden="true"><Icon d={SHELL_ICONS.pause} size={11} /></span>;
    return <span className={`rtn-dot ${sessionLook(p.sessionOf(x), t).dot}`} aria-hidden="true" />;
  };
  const right = (x: FleetRoutine): string => {
    const once = x.schedule.kind === 'once';
    if (x.state === 'done') { const l = lastRunOf(x); return l ? dayMonth(new Date(l.at), lang) : ''; }
    if (x.state === 'paused') return '';
    if (x.state === 'pending') { const m = once ? firstMoment(x.schedule) : null; return m ? nextLabel(momentDate(m).toISOString(), today, lang, r) : ''; }
    const next = x.nextRuns?.[0] ?? x.nextRun;
    return next ? nextLabel(next, today, lang, r) : '';
  };
  const third = (x: FleetRoutine, of?: { i: number; n: number }) => {
    const ref = routineRef(x);
    const run = p.running.get(ref);
    if (run) return <span className="rtn-x3"><span className="rtn-spin" aria-hidden="true" /><span className="rtn-mut">{run}</span></span>;
    if (x.state === 'done') return null;
    if (waitsForOwner(x)) return <span className="rtn-x3"><span className="rtn-pill ask">{r.pending}</span>{of && <span className="rtn-mut">{r.ofN(of.i, of.n)}</span>}</span>;
    const last = lastRunOf(x);
    if (last?.outcome === 'failed') { const why = whyText(last, x.target, path => p.dirLabel?.(x, path) ?? path, r); return <span className="rtn-x3 rtn-reason" title={why}>{why}</span>; }
    if (last?.late) return <span className="rtn-x3"><span className="rtn-pill late">{r.late}</span><span className="rtn-mut">{r.lateLong(last.slot, hhmm(last.at))}</span></span>;
    return null;
  };
  const sub = (x: FleetRoutine): string => {
    const line = `${x.target.name} · ${scheduleLine(x.schedule, r)}`;
    const last = lastRunOf(x);
    return x.state === 'done' && last ? `${line} · ${r.out[last.outcome]}` : line;
  };
  const row = (x: FleetRoutine, of?: { i: number; n: number }) => {
    const ref = routineRef(x);
    const lit = p.current === ref || !!p.lit?.has(ref);
    const busy = p.running.has(ref);
    const quick = x.state !== 'pending' && x.state !== 'done';
    const paused = x.state === 'paused';
    const ctx = (e: MouseEvent) => { e.preventDefault(); if (x.state !== 'done') setMenu({ r: x, at: { x: e.clientX, y: e.clientY } }); };
    return (
      <div key={ref} className={`rtn-row${lit ? ' sel' : ''}${x.state === 'done' ? ' dim' : ''}`} data-routine={ref} onContextMenu={ctx}>
        <button type="button" className="rtn-hit" aria-label={x.name} aria-current={p.current === ref || undefined} onClick={() => p.onOpen(x)} />
        {mark(x)}
        <b>{x.name}</b>
        <span className={`rtn-right${quick ? ' has-qa' : ''}`}>
          <span className="rtn-nx">{right(x)}</span>
          {quick && <span className="rtn-qa">
            <button type="button" className="rtn-ib" disabled={off || busy} title={failedLast(x) ? r.retry : r.runNow} aria-label={`${failedLast(x) ? r.retry : r.runNow} · ${x.name}`} onClick={() => p.onRun(x)}><Icon d={SHELL_ICONS.play} size={12} /></button>
            <button type="button" className="rtn-ib" disabled={off || busy} title={paused ? r.resume : r.pause} aria-label={`${paused ? r.resume : r.pause} · ${x.name}`} onClick={() => (paused ? p.onResume(x) : p.onPause(x))}><Icon d={paused ? SHELL_ICONS.play : SHELL_ICONS.pause} size={12} /></button>
          </span>}
        </span>
        <small title={sub(x)}><ProviderLogo provider={providerOf(x.target.tool)} size={11} /><span>{sub(x)}</span></small>
        {third(x, of)}
      </div>
    );
  };

  const groupsOf = (m: string, rs: readonly FleetRoutine[]) => sideGroups(rs, p.proposals, now).map(g => (
    <div key={g.key} className="rtn-grp" role="group" aria-label={r.groups[g.key]}>
      <button type="button" className="rtn-grp-h" aria-expanded={isOpen(m, g.key)} onClick={() => toggle(m, g.key)}>
        <span className={isOpen(m, g.key) ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={11} /></span>{r.groupHead(r.groups[g.key], g.count)}
      </button>
      {isOpen(m, g.key) && g.rows.map(x => (x.kind === 'proposed'
        ? <div key={`p:${x.key}`} className="rtn-prop">{r.proposed(x.who, x.n)}</div>
        : row(x.r, x.of)))}
    </div>
  ));

  let body: JSX.Element;
  if (p.connecting && !p.routines.length) body = <div className="rtn-empty"><span className="rtn-line"><span className="rtn-spin" aria-hidden="true" />{r.connecting}</span></div>;
  else if (!p.routines.length && !off) body = (
    <div className="rtn-empty"><AlarmIcon size={22} /><b>{r.emptyTitle}</b><span>{r.emptySide}</span>
      <button type="button" className="fg-btn pri" onClick={p.onNew}><Icon d={ICONS.plus.d} size={12} />{r.add}</button></div>
  );
  else body = (
    <>
      {off && <div className="rtn-banner" role="status"><span className="rtn-dot off" aria-hidden="true" />{r.offlineShort}</div>}
      <div className={off ? 'rtn-faded' : undefined}>
        {several
          ? p.machines!.filter(m => p.routines.some(x => x.machineId === m.id)).map(m => (
            <div key={m.id} role="group" aria-label={m.label}>
              <div className="rtn-mach"><span className={`rtn-dot ${m.up ? 'idle' : 'off'}`} aria-hidden="true" />{m.label}</div>
              {groupsOf(m.id, p.routines.filter(x => x.machineId === m.id))}
            </div>))
          : groupsOf('all', p.routines)}
      </div>
    </>
  );

  const m = menu?.r;
  return (
    <div className="rtn-side" role="region" aria-label={r.view}>
      <div className="rtn-side-h"><span>{r.view}</span>
        <button type="button" className="rtn-hb" title={r.add} aria-label={r.add} onClick={p.onNew}><Icon d={ICONS.plus.d} size={14} /></button></div>
      <div className="rtn-side-b">{body}</div>
      <div className="rtn-foot">{r.tzFoot(localZone())}</div>
      {m && (
        <Menu open onOpenChange={o => { if (!o) setMenu(null); }} label={m.name} className="session-menu-wrap" menuClassName="session-menu" at={menu.at} trigger={() => null}>
          {m.state !== 'pending' && <MenuItem disabled={off} onSelect={() => { setMenu(null); p.onRun(m); }}><span><Icon d={SHELL_ICONS.play} size={14} />{failedLast(m) ? r.retry : r.runNow}</span></MenuItem>}
          {m.state !== 'pending' && <MenuItem disabled={off} onSelect={() => { setMenu(null); if (m.state === 'paused') p.onResume(m); else p.onPause(m); }}><span><Icon d={m.state === 'paused' ? SHELL_ICONS.play : SHELL_ICONS.pause} size={14} />{m.state === 'paused' ? r.resume : r.pause}</span></MenuItem>}
          <MenuItem onSelect={() => { setMenu(null); p.onOpenSession(m); }}><span><Icon d={ROUTINE_ICONS.open} size={14} />{r.openSession}</span></MenuItem>
          <hr />
          <MenuItem className="rtn-danger" disabled={off} onSelect={() => { setMenu(null); p.onDelete(m); }}><span><Icon d={SHELL_ICONS.trash} size={14} />{r.del}</span></MenuItem>
        </Menu>
      )}
    </div>
  );
}
