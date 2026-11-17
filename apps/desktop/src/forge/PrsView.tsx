import { useState, type JSX, type MouseEvent } from 'react';
import { CLOSED_KEEP_DAYS, closedPrs, filterPrs, openPrs, PR_ROLE_FILTERS, prRoleCounts, type FleetPullRequest } from '@ledge/fleet';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { SHELL_ICONS } from '../shell/icons';

const hhmm = (v: number | string): string => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };
import { useI18n } from '../i18n/lang';
import { PipeDot } from './PipeGraph';
import { cliOf, loginCommand, NO_PRS_FILTER, type ForgeLine, type PrsFilter } from './states';
import type { ShownPr } from './useForge';
import '../styles/forge.css';

export interface PrsViewProps {
  /** The followed requests and the account's own, one row per request (useForge's `listed`). */
  prs: readonly ShownPr[];
  /** The filter, held by the caller so it outlives the view; without it, the view holds its own. */
  filter?: PrsFilter; onFilter?(f: PrsFilter): void;
  /** Now (ms), for the merged and closed ones of the last days. */
  now?(): number;
  /** What cannot be read, at the head (states 1, 3, 4); `noneReadable`: no forge at all can be (state 10). */
  lines?: readonly ForgeLine[]; noneReadable?: boolean;
  /** A machine's name as the user knows it (« WSL », « srv-build »), and a time of day. */
  machineLabel?(id: string): string; time?(ms: number | string): string;
  /** « Copier » a sign-in command: to the clipboard, told by a toast. */
  onCopy?(command: string): void;
  /** The agent working on its branch (its session's or seat's name), null when none is known. */
  agentOf(pr: FleetPullRequest): string | null;
  /** The request in front of the focused group, lit in the list. */
  current: string | null;
  /** A click opens it in a tab; Ctrl+click, to the right. */
  onOpen(pr: FleetPullRequest, right: boolean): void;
}

/** The sidebar's « MR et PR » (mockup explorer `prs`; issue #3, docs/mockups/ledge-prs-mine.html): a search and the role filter
 *  with each role's count of open requests, the open requests most recently updated first, then the merged and closed ones of the
 *  last days, folded. A row: the pipeline's dot, its ref and title, the account's roles and « branche suivie » as pills, then forge ·
 *  repository · state · agent · pipeline · open threads. */
export function PrsView({ prs, agentOf, current, onOpen, lines = [], noneReadable = false, machineLabel = id => id, time = hhmm, onCopy, filter: held, onFilter, now = Date.now }: PrsViewProps): JSX.Element {
  const { t } = useI18n();
  const f = t.forge;
  const [own, setOwn] = useState<PrsFilter>(NO_PRS_FILTER);
  const filter = held ?? own;
  const setFilter = (x: PrsFilter) => { setOwn(x); onFilter?.(x); };
  const [unfold, setUnfold] = useState(false);
  // Only closed ones match the filter (design-ux, #3 review C1): the fold opens by itself while the filter is on; a click closes it
  // for that filter only, and the user's own state comes back once the filter is cleared.
  const filterKey = `${filter.role}\n${filter.q.trim()}`;
  const [shut, setShut] = useState<string | null>(null);
  const line = (l: ForgeLine, i: number) => {
    const m = machineLabel(l.machine);
    switch (l.kind) {
      case 'missing': return <div key={i} className="fg-line"><div className="h"><span className="fg-dot wait" aria-hidden="true" /><span>{f.missing(cliOf(l.forge), m, l.host, f.prKind[l.forge])}</span></div></div>;
      case 'unauthenticated': {
        const cmd = loginCommand(l.forge, l.host);
        return (
          <div key={i} className="fg-line"><div className="h"><span className="fg-dot wait" aria-hidden="true" /><span>{f.unauth(cliOf(l.forge), l.host, m)}</span></div>
            <div className="cmd"><code>{cmd}</code><button type="button" className="fg-btn sm" onClick={() => onCopy?.(cmd)}>{f.copy}</button></div></div>
        );
      }
      case 'error': return (
        <div key={i} className="fg-line err"><div className="h"><span className="fg-dot fail" aria-hidden="true" /><span>{f.error(f.host[l.forge], m, time(l.since))}{l.retryAt && ` ${f.retry_at(time(l.retryAt))}`}</span></div>
          {l.message && <small>{l.message}</small>}</div>
      );
      case 'offline': case 'daemonDown': return <div key={i} className="fg-line off"><div className="h"><span className="fg-dot" aria-hidden="true" /><span>{(l.kind === 'offline' ? f.offline : f.daemonDown)(m, l.at === null ? '' : time(l.at))}</span></div></div>;
      case 'outdated': return <div key={i} className="fg-line off"><div className="h"><span className="fg-dot" aria-hidden="true" /><span>{f.outdated(m)}</span></div></div>;
    }
  };
  // A forge in error keeps its last read, its time in the head (state 3).
  const errorAt = lines.find(l => l.kind === 'error');
  const row = (p: ShownPr) => (
    <button key={p.id} type="button" className={`fg-row${current === p.id ? ' on' : ''}${p.stale ? ' stale' : ''}`} title={f.rowTip} aria-current={current === p.id || undefined}
      onClick={(e: MouseEvent) => onOpen(p, e.ctrlKey || e.metaKey)}>
      <PipeDot status={p.pipeline} />
      <span className="fg-row-t">
        <span className="fg-row-l1"><b>{p.ref}</b> {p.title}</span>
        {(p.roles?.length || p.sessions.length > 0) ? <span className="fg-pills">
          {(p.roles ?? []).map(r => <span key={r} className={`fg-pill${r === 'reviewer' ? ' rev' : ''}`}>{f.pill[r]}</span>)}
          {p.sessions.length > 0 && <span className="fg-pill trk">{f.pill.tracked}</span>}
        </span> : null}
        <small>{f.rowMeta(f.host[p.forge], p.repo, f.state[p.state], agentOf(p), f.pipe[p.pipeline], p.openThreads)}</small>
      </span>
    </button>
  );
  const allOpen = openPrs(prs);
  const allClosed = closedPrs(prs, now());
  const counts = prRoleCounts(prs);
  const open = filterPrs(allOpen, filter.role, filter.q);
  const closed = filterPrs(allClosed, filter.role, filter.q);
  const filtered = filter.role !== 'all' || filter.q.trim() !== '';
  const forced = filtered && open.length === 0 && closed.length > 0;
  const shown = forced ? shut !== filterKey : unfold;
  const any = allOpen.length + allClosed.length > 0;
  return (
    <div className="fg-side" role="region" aria-label={f.view}>
      <div className="fg-side-h"><span>{f.view}</span><small>{errorAt?.kind === 'error' && errorAt.readAt ? f.asOf(time(errorAt.readAt)) : f.hosts}</small></div>
      {lines.length > 0 && <div className="fg-strip">{lines.map(line)}</div>}
      {any && <div className="fg-flt">
        <label className="fg-q">
          <Icon d={SHELL_ICONS.search} size={12} />
          <input type="search" aria-label={f.search} placeholder={f.search} value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape' && filter.q) { e.stopPropagation(); setFilter({ ...filter, q: '' }); } }} />
        </label>
        <div className="fg-roles" role="group" aria-label={f.rolesLabel}>
          {PR_ROLE_FILTERS.map(r => (
            <button key={r} type="button" className={`fg-role${filter.role === r ? ' on' : ''}${r === 'reviewer' ? ' rev' : ''}`} aria-pressed={filter.role === r}
              onClick={() => setFilter({ ...filter, role: r })}>
              {f.roles[r]}<span className="c">{counts[r]}</span>
            </button>
          ))}
        </div>
      </div>}
      {open.length ? <div className="fg-tree">{open.map(row)}</div> : forced ? null : filtered ? (
        <div className="fg-empty fg-none"><b>{f.none}</b>
          <button type="button" className="fg-btn sm" onClick={() => setFilter(NO_PRS_FILTER)}>{f.clear}</button></div>
      ) : (
        <div className="fg-empty"><b>{f.emptyTitle}</b><span>{noneReadable ? f.emptyUnread : f.emptyBody}</span></div>
      )}
      {closed.length > 0 && <>
        <button type="button" className="fg-fold" aria-expanded={shown} onClick={() => (forced ? setShut(x => (x === filterKey ? null : filterKey)) : setUnfold(u => !u))}>
          <Icon d={shown ? SHELL_ICONS.chevronDown : ICONS.chevronRight.d} size={12} />{f.closedFor(closed.length, CLOSED_KEEP_DAYS)}
        </button>
        {shown && <div className="fg-tree fg-closed">{closed.map(row)}</div>}
      </>}
      <div className="fg-foot">{f.foot}</div>
    </div>
  );
}
