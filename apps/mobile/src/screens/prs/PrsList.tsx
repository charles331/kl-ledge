import { useState } from 'react';
import { closedPrs, filterPrs, PR_ROLE_FILTERS, prRoleCounts, type PhoneForgeStatus, type PrRoleFilter, type PullRequest } from '@ledge/protocol';
import { copy } from '../../copy';
import { isReady, signInCommand, splitPrs, unreadable } from '../../model/prs';
import { href, useRoute } from '../../router';
import { TabPage, hostName, useShell } from '../../shell/Shell';
import { useForge, type ForgeStore } from '../../state/forge';
import { useMobile, type MobileStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { EmptyState } from '../../ui/kit/Box';
import { useWide } from '../../ui/layout';
import { clock } from '../../clock';
import { Att, Frame, Lbl, Strip, rigButtonClass } from '../rigs/kit';
import { PipeChip, PrRow, dayWord, forgeWords, repoName } from './parts';

/*
 * The MR/PR tab (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html, §1 and §2): the PC's open requests, newest change first, each
 * with its pipeline's dot and what matters in words; the merged and closed ones folded at the bottom. Above them, a strip for each
 * forge the PC cannot read (its CLI missing, not signed in, or failing reads). Offline: the last list, greyed, without links.
 */

const C = copy.prs;

/** A forge that cannot be read, in a strip above the list: only the case, never the CLI's text (Q61). */
export function ForgeStrip({ status, pc }: { status: PhoneForgeStatus; pc: string }) {
  const [copied, setCopied] = useState(false);
  const w = forgeWords(status);
  const lead = <Icon name="warning" className="mt-px size-4 text-attention" />;
  if (status.status === 'missing') {
    return <Strip warn role="alert" lead={lead}><span data-forge-strip="missing">{C.missing(w.cli, pc, status.host, w.kind)}</span></Strip>;
  }
  if (status.status === 'unauthenticated') {
    const cmd = signInCommand(status);
    return (
      <Strip warn role="alert" lead={lead}>
        <b data-forge-strip="unauthenticated" className="font-semibold">{C.unauth(w.cli, status.host, pc)}</b>
        <code className="block rounded-md bg-raised px-2 py-1.5 font-mono text-[12px] break-all">{cmd}</code>
        <button
          type="button" className={rigButtonClass({ size: 'sm', className: 'self-start' })}
          onClick={() => { void navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => undefined); }}
        >
          {copied ? C.copied : C.copy}
        </button>
      </Strip>
    );
  }
  const since = status.since ?? status.at;
  const later = [status.retryAt ? C.retryAt(clock(status.retryAt)) : '', status.readAt ? C.readAt(w.kind, clock(status.readAt)) : ''].filter(Boolean).join(' ');
  return (
    <Strip warn role="alert" lead={lead}>
      <div className="flex flex-col gap-0.5">
        <b data-forge-strip="error" className="font-semibold">{C.error(w.host, pc, clock(since))}</b>
        {later && <span className="text-muted">{later}</span>}
      </div>
    </Strip>
  );
}

/** The skeleton of the list while the first `forge.state` comes. */
function Reading() {
  const sk = 'block animate-[ledge-pulse_1.6s_ease-in-out_infinite] rounded-[5px] bg-raised';
  return (
    <div role="status" data-list-state="" className="flex flex-col gap-3">
      <Frame><div aria-hidden="true" className="flex flex-col gap-2.5 p-2.5"><span className={`${sk} h-3.5 w-[70%]`} /><span className={`${sk} h-3 w-[45%]`} /><span className={`${sk} h-3.5 w-[60%]`} /><span className={`${sk} h-3 w-1/2`} /></div></Frame>
      <span className="text-[12px] text-muted">{C.loading}</span>
    </div>
  );
}

/** An open request's line: forge, repository, the branch's agent, then its state, or, its forge failing, when it was read. */
function openSub(pr: PullRequest, agent: string | null, failing: PhoneForgeStatus | undefined): string {
  const last = failing?.readAt ? C.asOf(clock(failing.readAt)) : C.state[pr.state];
  return [C.host[pr.forge], repoName(pr.repo), ...(agent ? [agent] : []), last].join(' · ');
}

/** The filter (issue #3): a role and a search, kept while the app's tab lives, whichever screen is shown meanwhile. */
let kept: { role: PrRoleFilter; q: string } = { role: 'all', q: '' };
/** For the tests: the filter back to « Toutes », empty. */
export function resetPrsFilter(): void { kept = { role: 'all', q: '' }; }

/** The account's roles and « branche suivie » under a row's title (docs/mockups/ledge-prs-mine.html, card 3). */
function Pills({ pr }: { pr: PullRequest }) {
  const roles = pr.roles ?? [];
  if (!roles.length && !pr.sessions.length) return null;
  const pill = 'rounded-[7px] border px-1.5 text-[11px] leading-4';
  return (
    <>
      {roles.map(r => <span key={r} data-role-pill={r} className={`${pill} ${r === 'reviewer' ? 'border-attention/50 text-attention' : 'border-line text-muted'}`}>{C.pill[r]}</span>)}
      {pr.sessions.length > 0 && <span data-role-pill="tracked" className={`${pill} border-task/45 text-task`}>{C.pill.tracked}</span>}
    </>
  );
}

/** The MR/PR tab of a PC that sends its requests (`daemon.forge`). */
export function PrsList({ forge, store }: { forge: ForgeStore; store: MobileStore }) {
  const f = useForge(forge);
  const m = useMobile(store);
  const { pc, look } = useShell();
  const route = useRoute();
  const wide = useWide();
  const [folded, setFolded] = useState(true);
  // Only closed ones match the filter (design-ux, #3 review C1): the fold opens by itself while the filter is on; a tap closes it for
  // that filter only, and the user's own state comes back once the filter is cleared.
  const [shut, setShut] = useState<string | null>(null);
  const [filter, setFilterState] = useState(kept);
  const setFilter = (x: typeof kept) => { kept = x; setFilterState(x); };
  const offline = look === 'offline';
  const name = hostName(pc);
  const state = f.state;
  const agentOf = (pr: PullRequest) => { const id = pr.sessions[0]; return id ? m.sessions.get(id)?.name ?? null : null; };
  const offlineBody = (since: string) => C.offlineBody(f.at ? clock(f.at) : since);

  const body = (() => {
    if (!state) return <Reading />;
    const failing = unreadable(state.forges);
    const failingOf = (pr: PullRequest) => failing.find(s => s.forge === pr.forge && s.host === pr.host);
    // Issue #3: the followed requests and the account's own (never both), the merged and closed of the last days.
    const every = [...state.prs, ...(state.mine ?? [])];
    const all = { open: splitPrs(every).open.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), closed: closedPrs(every, Date.now()) };
    const counts = prRoleCounts(every);
    const open = filterPrs(all.open, filter.role, filter.q);
    const closed = filterPrs(all.closed, filter.role, filter.q);
    const filtered = filter.role !== 'all' || filter.q.trim() !== '';
    const filterKey = `${filter.role}\n${filter.q.trim()}`;
    const forced = filtered && open.length === 0 && closed.length > 0;
    const shown = forced ? shut !== filterKey : !folded;
    const none = state.forges.length > 0 && failing.length === state.forges.length;
    const chip = 'flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px]';
    return (
      <>
        {!offline && failing.map(s => <ForgeStrip key={`${s.forge}:${s.host}`} status={s} pc={name} />)}
        <div className={`flex flex-col gap-3 ${offline ? 'opacity-50' : ''}`}>
          {all.open.length + all.closed.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <label className="flex h-9 items-center gap-2 rounded-[9px] border border-line px-2.5 text-muted focus-within:border-muted">
                <Icon name="search" className="size-3.5 shrink-0" />
                <input
                  type="search" aria-label={C.search} placeholder={C.search} value={filter.q}
                  onChange={e => setFilter({ ...filter, q: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted"
                />
              </label>
              <div role="group" aria-label={C.rolesLabel} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
                {PR_ROLE_FILTERS.map(r => (
                  <button
                    key={r} type="button" aria-pressed={filter.role === r} onClick={() => setFilter({ ...filter, role: r })}
                    className={`${chip} ${filter.role === r ? 'border-transparent bg-secondary text-fg' : 'border-line text-muted'}`}
                  >
                    {C.roles[r]}<span className={`font-mono text-[11px] ${r === 'reviewer' ? 'text-attention' : ''}`}>{counts[r]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {forced ? null : open.length === 0 && filtered ? (
            <Frame>
              <div data-list-state="none" className="flex flex-col items-center gap-2.5 px-4 py-6 text-center text-[13px] text-muted">
                <b className="font-medium text-fg">{C.none}</b>
                <button type="button" className={rigButtonClass({ size: 'sm' })} onClick={() => setFilter({ role: 'all', q: '' })}>{C.clear}</button>
              </div>
            </Frame>
          ) : open.length === 0 ? (
            <Frame>
              {none
                ? <EmptyState framed={false} glyph={null} title={C.emptyTitle} body={C.emptyUnread} list={closed.length === 0} />
                : <EmptyState glyph={<Icon name="pr" className="size-[22px]" />} title={C.emptyTitle} body={C.emptyBody} list={closed.length === 0} />}
            </Frame>
          ) : (
            <>
              <Lbl aside={!offline && f.at ? C.asOf(clock(f.at)) : undefined}>{C.openHead(open.length)}</Lbl>
              <Frame label={C.title}>
                {open.map(pr => {
                  const bad = failingOf(pr);
                  const ready = isReady(pr);
                  const chips = (
                    <>
                      <PipeChip pipeline={pr.pipeline} />
                      {!offline && !bad && pr.openThreads > 0 && <Att>{C.threads(pr.openThreads)}</Att>}
                      {!offline && !bad && ready && <Att ok>{C.ready}</Att>}
                    </>
                  );
                  return (
                    <PrRow
                      key={pr.id} pr={pr} sub={openSub(pr, agentOf(pr), bad)} chips={chips} pills={<Pills pr={pr} />}
                      {...(offline ? {} : { href: href({ name: 'pr', id: pr.id }) })} selected={wide && route.name === 'pr' && route.id === pr.id}
                    />
                  );
                })}
              </Frame>
            </>
          )}
          {closed.length > 0 && (
            <Frame>
              <button type="button" aria-expanded={shown} onClick={() => (forced ? setShut(x => (x === filterKey ? null : filterKey)) : setFolded(v => !v))} className="flex min-h-11 w-full items-center gap-[9px] px-3 py-1.5 text-left text-[13px] text-muted">
                <Icon name={shown ? 'down' : 'chevron'} className="size-3.5" />{C.closedGroup(closed.length)}
              </button>
              {shown && (
                <div className="border-t border-line">
                  {closed.map(pr => (
                    <PrRow
                      key={pr.id} pr={pr} dim pills={<Pills pr={pr} />} sub={[C.host[pr.forge], repoName(pr.repo), C.state[pr.state], dayWord(pr.updatedAt)].join(' · ')}
                      {...(offline ? {} : { href: href({ name: 'pr', id: pr.id }) })} selected={wide && route.name === 'pr' && route.id === pr.id}
                    />
                  ))}
                </div>
              )}
            </Frame>
          )}
        </div>
        <p className="text-[12px] leading-4 text-muted">{C.tracked}</p>
      </>
    );
  })();
  return <TabPage title={C.title} offlineBody={offlineBody} heading={false}>{body}</TabPage>;
}
