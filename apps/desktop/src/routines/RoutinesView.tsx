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

/** How the session a routine wakes is doing (« Réveille Iris ● Au travail », the row's dot): working, available, stopped; a
 *  session that waits for the user keeps the app's own word for it. */
export function sessionLook(s: Session | undefined, t: Messages): { dot: 'work' | 'idle' | 'off' | 'perm' | 'ask'; label: string } {
  const r = t.routines.st;
  if (!s || s.offline || s.state === 'exited') return { dot: 'off', label: r.off };
  const d = dotOf(s);
  if (d === 'working') return { dot: 'work', label: r.working };
  if (d === 'done') return { dot: 'idle', label: r.idle };
  if (d === 'offline') return { dot: 'off', label: r.off };
  return { dot: d === 'question' ? 'ask' : 'perm', label: t.stateLabel[d === 'question' ? 'question' : d === 'approval' ? 'approval' : 'error'] };
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
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({ recurring: true, once: true, paused: false, past: false });
  const [menu, setMenu] = useState<{ r: FleetRoutine; at: { x: number; y: number } } | null>(null);
  const groups = sideGroups(p.routines, p.proposals, now);
  const off = p.offline;

  const mark = (x: FleetRoutine) => {
    if (x.state === 'done') return <span className="rt-mk ok" aria-hidden="true">✓</span>;
    if (waitsForOwner(x)) return <span className="rt-mk ask" aria-hidden="true">?</span>;
    if (failedLast(x)) return <span className="rt-mk bad" aria-hidden="true">!</span>;
    if (x.state === 'paused') return <span className="rt-mk" aria-hidden="true"><Icon d={SHELL_ICONS.pause} size={11} /></span>;
    return <span className={`rt-dot ${sessionLook(p.sessionOf(x), t).dot}`} aria-hidden="true" />;
  };
  const right = (x: FleetRoutine): string => {
    const once = x.schedule.kind === 'once';
    if (x.state === 'done') { const l = lastRunOf(x); return l ? dayMonth(new Date(l.at), lang) : ''; }
    if (x.state === 'paused') return '';
    if (x.state === 'pending') { const m = once ? firstMoment(x.schedule) : null; return m ? nextLabel(momentDate(m).toISOString(), today, lang, r, true) : ''; }
    const next = x.nextRuns?.[0] ?? x.nextRun;
    return next ? nextLabel(next, today, lang, r, once) : '';
  };
  const third = (x: FleetRoutine, of?: { i: number; n: number }) => {
    const ref = routineRef(x);
    const run = p.running.get(ref);
    if (run) return <span className="rt-x3"><span className="rt-spin" aria-hidden="true" /><span className="rt-mut">{run}</span></span>;
    if (x.state === 'done') return null;
    if (waitsForOwner(x)) return <span className="rt-x3"><span className="rt-pill ask">{r.pending}</span>{of && <span className="rt-mut">{r.ofN(of.i, of.n)}</span>}</span>;
    const last = lastRunOf(x);
    if (last?.outcome === 'failed') { const why = whyText(last, x.target, path => p.dirLabel?.(x, path) ?? path, r); return <span className="rt-x3 rt-reason" title={why}>{why}</span>; }
    if (last?.late) return <span className="rt-x3"><span className="rt-pill late">{r.late}</span><span className="rt-mut">{r.lateLong(last.slot, hhmm(last.at))}</span></span>;
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
      <div key={ref} className={`rt-row${lit ? ' sel' : ''}${x.state === 'done' ? ' dim' : ''}`} data-routine={ref} onContextMenu={ctx}>
        <button type="button" className="rt-hit" aria-label={x.name} aria-current={p.current === ref || undefined} onClick={() => p.onOpen(x)} />
        {mark(x)}
        <b>{x.name}</b>
        <span className={`rt-right${quick ? ' has-qa' : ''}`}>
          <span className="rt-nx">{right(x)}</span>
          {quick && <span className="rt-qa">
            <button type="button" className="rt-ib" disabled={off || busy} title={failedLast(x) ? r.retry : r.runNow} aria-label={`${failedLast(x) ? r.retry : r.runNow} · ${x.name}`} onClick={() => p.onRun(x)}><Icon d={SHELL_ICONS.play} size={12} /></button>
            <button type="button" className="rt-ib" disabled={off || busy} title={paused ? r.resume : r.pause} aria-label={`${paused ? r.resume : r.pause} · ${x.name}`} onClick={() => (paused ? p.onResume(x) : p.onPause(x))}><Icon d={paused ? SHELL_ICONS.play : SHELL_ICONS.pause} size={12} /></button>
          </span>}
        </span>
        <small title={sub(x)}><ProviderLogo provider={providerOf(x.target.tool)} size={11} /><span>{sub(x)}</span></small>
        {third(x, of)}
      </div>
    );
  };

  let body: JSX.Element;
  if (p.connecting && !p.routines.length) body = <div className="rt-empty"><span className="rt-line"><span className="rt-spin" aria-hidden="true" />{r.connecting}</span></div>;
  else if (!p.routines.length && !off) body = (
    <div className="rt-empty"><AlarmIcon size={22} /><b>{r.emptyTitle}</b><span>{r.emptySide}</span>
      <button type="button" className="fg-btn pri" onClick={p.onNew}><Icon d={ICONS.plus.d} size={12} />{r.add}</button></div>
  );
  else body = (
    <>
      {off && <div className="rt-banner" role="status"><span className="rt-dot off" aria-hidden="true" />{r.offlineShort}</div>}
      <div className={off ? 'rt-faded' : undefined}>
        {groups.map(g => (
          <div key={g.key} className="rt-grp" role="group" aria-label={r.groups[g.key]}>
            <button type="button" className="rt-grp-h" aria-expanded={open[g.key]} onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))}>
              <span className={open[g.key] ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={11} /></span>{r.groupHead(r.groups[g.key], g.count)}
            </button>
            {open[g.key] && g.rows.map(x => (x.kind === 'proposed'
              ? <div key={`p:${x.key}`} className="rt-prop">{r.proposed(x.who, x.n)}</div>
              : row(x.r, x.of)))}
          </div>
        ))}
      </div>
    </>
  );

  const m = menu?.r;
  return (
    <div className="rt-side" role="region" aria-label={r.view}>
      <div className="rt-side-h"><span>{r.view}</span>
        <button type="button" className="rt-hb" title={r.add} aria-label={r.add} onClick={p.onNew}><Icon d={ICONS.plus.d} size={14} /></button></div>
      <div className="rt-side-b">{body}</div>
      <div className="rt-foot">{r.tzFoot(localZone())}</div>
      {m && (
        <Menu open onOpenChange={o => { if (!o) setMenu(null); }} label={m.name} className="session-menu-wrap" menuClassName="session-menu" at={menu.at} trigger={() => null}>
          {m.state !== 'pending' && <MenuItem disabled={off} onSelect={() => { setMenu(null); p.onRun(m); }}><span><Icon d={SHELL_ICONS.play} size={14} />{failedLast(m) ? r.retry : r.runNow}</span></MenuItem>}
          {m.state !== 'pending' && <MenuItem disabled={off} onSelect={() => { setMenu(null); if (m.state === 'paused') p.onResume(m); else p.onPause(m); }}><span><Icon d={m.state === 'paused' ? SHELL_ICONS.play : SHELL_ICONS.pause} size={14} />{m.state === 'paused' ? r.resume : r.pause}</span></MenuItem>}
          <MenuItem onSelect={() => { setMenu(null); p.onOpenSession(m); }}><span><Icon d={ROUTINE_ICONS.open} size={14} />{r.openSession}</span></MenuItem>
          <hr />
          <MenuItem className="rt-danger" disabled={off} onSelect={() => { setMenu(null); p.onDelete(m); }}><span><Icon d={SHELL_ICONS.trash} size={14} />{r.del}</span></MenuItem>
        </Menu>
      )}
    </div>
  );
}
