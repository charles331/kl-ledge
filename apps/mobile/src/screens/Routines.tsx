import { useState, type ReactNode } from 'react';
import type { PhoneRoutine, PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { failureWhy, nextLine, routineFailed, routineGroups, scheduleView, sessionOf } from '../model/routines';
import { goBack, href } from '../router';
import { TabPage } from '../shell/Shell';
import type { ChatAction } from '../state/chat';
import { useMobile, type MobileStore } from '../state/store';
import { Icon } from '../ui/icons';
import { Card } from '../ui/kit/Box';
import { Pill } from '../ui/kit/marks';
import { useWide } from '../ui/layout';
import { MobileBot } from '../ui/MobileBot';
import { useNow } from '../useNow';
import { Spin } from './atoi/SessionCard';

/** A routine card's 40 px buttons, side by side and sharing the width (card 17), in the kit's outline and primary colours. */
export const routineButton = (primary = false) => ['inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] border px-3 text-body font-medium whitespace-nowrap transition-colors duration-100 disabled:opacity-45',
  primary ? 'border-transparent bg-primary text-primary-fg active:bg-primary-hover' : 'border-input bg-surface dark:bg-transparent text-fg active:bg-raised'].join(' ');

/** What a routine command's end says when it did not go, with the words the phone already has for it; null when it went. */
export function routineError(r: ChatAction): string | null {
  switch (r.status) {
    case 'applied': return null;
    case 'cancelled': return copy.confirm.cancelled;
    case 'expired': return copy.confirm.expired;
    case 'failed': return copy.chat.point.note.failed;
    case 'rejected':
      if (r.reason === 'not_pending' || r.reason === 'stale' || r.reason === 'not_found') return copy.chat.point.note.stale;
      return copy.confirm.refused[r.reason] ?? copy.chat.point.note.failed;
  }
}

/** A session's mascot as a routine names it: its live session's, else the tool's, at rest. */
export function RoutineBot({ routine, session, frozen }: { routine: Pick<PhoneRoutine, 'id' | 'target'>; session: PhoneSession | undefined; frozen: boolean }) {
  return <MobileBot tool={session?.tool ?? routine.target.tool} seed={session?.id ?? routine.id} state={session?.state ?? 'exited'} frozen={frozen} />;
}

/** « en retard », outlined in dashes (the mockup's `.pill.late`). */
function Late() {
  return <span className="inline-flex h-5 flex-none items-center rounded-lg border border-dashed border-attention/50 px-[7px] text-[11.5px] whitespace-nowrap text-attention">{copy.routines.late}</span>;
}

/** One routine (card 17): who it wakes, when, its next and last run, then « Lancer maintenant » and « Pause » / « Reprendre »; a
 *  routine waiting on the user only leads to « À toi ». */
function RoutineCard({ store, routine: r, session, offline, now }: { store: MobileStore; routine: PhoneRoutine; session: PhoneSession | undefined; offline: boolean; now: number }) {
  const R = copy.routines;
  const [busy, setBusy] = useState<'run' | 'toggle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = r.state === 'pending';
  const failed = routineFailed(r);
  const paused = r.state === 'paused';
  const go = async (which: 'run' | 'toggle', action: 'run' | 'pause' | 'resume') => {
    setBusy(which); setError(null);
    setError(routineError(await store.routineCmd(r.id, action)));
    setBusy(null);
  };
  const next = pending || paused ? null : nextLine(r, now);
  const last = r.lastRun;
  const spin = (which: 'run' | 'toggle') => busy === which ? <Spin /> : null;
  let lastLine: ReactNode;
  if (pending) lastLine = <Pill tone="ask">{R.pending}</Pill>;
  else if (last) lastLine = <>
    <span aria-hidden="true" className={`w-3.5 text-center text-[11px] ${last.outcome === 'failed' ? 'text-approval' : 'text-ok'}`}>{last.outcome === 'failed' ? '!' : '✓'}</span>
    <span>{R.lastAt(last.slot, R.outcome[last.outcome])}</span>
    {last.late && <Late />}
  </>;
  else lastLine = <span>{R.never}</span>;
  return (
    <Card tone={pending ? 'ask' : failed ? 'perm' : 'plain'} label={r.name}>
      <div data-routine={r.id} className="flex min-w-0 items-center gap-[9px]">
        <RoutineBot routine={r} session={session} frozen={offline} />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[15px] font-semibold">{r.name}</b>
          <span className="truncate text-[13px] text-muted">{r.target.name} · {scheduleView(r.schedule).card}</span>
        </div>
      </div>
      {paused ? <div><Pill>{R.paused}</Pill></div> : next && <p className="text-[13px] text-muted">{next}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">{lastLine}</div>
      {failed && failureWhy(r) && <p className="text-[13px] [overflow-wrap:anywhere] text-muted">{failureWhy(r)}</p>}
      <div className="flex gap-2">
        {pending ? (
          <a href={href({ name: 'atoi' })} className={routineButton()}>{R.seeInAtoi}</a>
        ) : (
          <>
            <button type="button" disabled={offline || busy !== null} onClick={() => { void go('run', 'run'); }} className={routineButton()}>
              {spin('run') ?? <Icon name="play" className="size-3.5" />}<span className="truncate">{failed ? R.retry : R.runNow}</span>
            </button>
            <button type="button" disabled={offline || busy !== null} onClick={() => { void go('toggle', paused ? 'resume' : 'pause'); }} className={routineButton()}>
              {spin('toggle')}<span className="truncate">{paused ? R.resume : R.pause}</span>
            </button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-small text-destructive">{error}</p>}
    </Card>
  );
}

/** A group's title over its cards (card 25): « RÉCURRENTES », « UNIQUES ». */
function GroupTitle({ children }: { children: string }) {
  return <h2 className="mx-1 -mb-1 text-[10.5px] font-medium tracking-[.06em] text-muted uppercase">{children}</h2>;
}

/**
 * The Routines screen (docs/mockups/ledge-routines.html, cards 17 and 25), opened from the top of Sessions: the PC's routines,
 * read-only, recurring ones then one-shots, each with « Lancer maintenant » and « Pause » / « Reprendre »; a sentence at the foot
 * says where to create or change one.
 */
export function Routines({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const now = useNow();
  const wide = useWide();
  const R = copy.routines;
  const groups = routineGroups(state.routines ?? []);
  const offline = !state.fresh;
  const sessions = [...state.sessions.values()];
  const cards = (list: PhoneRoutine[]) => list.map(r => <RoutineCard key={r.id} store={store} routine={r} session={sessionOf(r, sessions)} offline={offline} now={now} />);
  return (
    <TabPage title={R.title} heading={false} bodyClassName="flex flex-col gap-2.5">
      {/* Beside the sessions on a wide screen, the pane's head already names it. */}
      {!wide && <>
        <a href={href({ name: 'sessions' })} onClick={e => { e.preventDefault(); goBack({ name: 'sessions' }); }} className="-mb-1 flex items-center gap-1 self-start text-body text-muted">
          <Icon name="back" className="size-4" />{R.back}
        </a>
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-.02em]">{R.title}</h1>
      </>}
      {groups.recurring.length > 0 && <><GroupTitle>{R.groups.recurring}</GroupTitle>{cards(groups.recurring)}</>}
      {groups.once.length > 0 && <><GroupTitle>{R.groups.once}</GroupTitle>{cards(groups.once)}</>}
      <p className="px-2 text-center text-[12.5px] text-muted">{R.readonly}</p>
    </TabPage>
  );
}
