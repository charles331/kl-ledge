import { useEffect, useState } from 'react';
import type { PhoneRoutine, PhoneRoutineDetail, PhoneSession } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import { askerOf, coveredIds, failureWhy, scheduleView, sessionOf, type RoutineTask } from '../../model/routines';
import { href } from '../../router';
import type { MobileState, MobileStore } from '../../state/store';
import { Card } from '../../ui/kit/Box';
import { Pill } from '../../ui/kit/marks';
import { RoutineBot, routineButton, routineError } from '../Routines';
import { Spin } from './SessionCard';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/** The head of a routine's item: what it is (« Demande », « Échec »), then « Routine · 02:10 ». */
function Head({ failed, at }: { failed: boolean; at: string }) {
  const A = copy.routines.atoi;
  return (
    <div className="flex items-center gap-2">
      <Pill tone={failed ? 'perm' : 'ask'}>{failed ? A.failed : A.ask}</Pill>
      <span className="text-[13px] text-muted">{A.kind} · <time dateTime={at}>{timeOf(at)}</time></span>
    </div>
  );
}

/** The mascot of the session an item speaks of, and its sentence beside it. */
function Said({ routine, session, frozen, children }: { routine: Pick<PhoneRoutine, 'id' | 'target'>; session: PhoneSession | undefined; frozen: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-[9px]">
      <RoutineBot routine={routine} session={session} frozen={frozen} />
      <p className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">{children}</p>
    </div>
  );
}

/** What « Activer » applies: a session's change waiting on the user, else the routine as it is. */
const asked = (d: PhoneRoutineDetail) => d.proposal?.spec ?? d;

export interface RoutineItemProps {
  store: MobileStore;
  task: RoutineTask;
  state: Pick<MobileState, 'routines' | 'routineDetails' | 'sessions' | 'fresh'>;
  /** This device can sign « Activer »; without it the PC would refuse, and the card says so on a tap. */
  canConfirm: boolean;
}

/**
 * A routine's item in « À toi » (docs/mockups/ledge-routines.html, cards 17 and 25): an activation request, its prompt unfolded and
 * « Activer » behind the device's check; several one-shots proposed together, « Activer les 3 » / « Refuser les 3 »; or a run that
 * could not leave, « Relancer » / « Voir ».
 */
export function RoutineItem(props: RoutineItemProps) {
  if (props.task.routine.kind === 'failed') return <FailedItem {...props} />;
  return coveredIds(props.task.routine).length > 1 ? <GroupItem {...props} /> : <AskItem {...props} />;
}

function AskItem({ store, task, state, canConfirm }: RoutineItemProps) {
  const A = copy.routines.atoi;
  const id = task.routine.id;
  const listed = state.routines?.find(r => r.id === id);
  const shown = state.routineDetails[id];
  const detail = shown && shown !== 'gone' ? shown : undefined;
  const [busy, setBusy] = useState<'approve' | 'refuse' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The prompt is read before « Activer » (card 17), and « Activer » covers what was read: the routine whole is asked for.
  useEffect(() => { if (state.fresh) store.showRoutine(id); }, [store, id, state.fresh, shown]);
  const spec = detail ? asked(detail) : undefined;
  const routine = detail ?? listed;
  const session = routine ? sessionOf(routine, state.sessions.values()) : undefined;
  const who = (routine && askerOf(routine)) ?? task.giverName ?? '';
  const go = async (which: 'approve' | 'refuse') => {
    setBusy(which); setError(null);
    setError(routineError(which === 'approve' ? await store.approveRoutine(id, detail!.key) : await store.routineCmd(id, 'refuse')));
    setBusy(null);
  };
  const off = !state.fresh || busy !== null;
  return (
    <Card tone="ask" label={`${A.ask} · ${task.routine.name}`}>
      <Head failed={false} at={task.at} />
      {routine
        ? <Said routine={routine} session={session} frozen={!state.fresh}>
            {spec ? <><b className="font-semibold">{who}</b> {detail?.proposal ? A.editAsks(spec.name, scheduleView(spec.schedule).ask) : A.asks(spec.name, scheduleView(spec.schedule).ask, spec.target.cwd)}</> : task.title}
          </Said>
        : <p className="text-body [overflow-wrap:anywhere]">{task.title}</p>}
      {spec && <pre data-prompt="" className="m-0 rounded-md border border-line bg-raised px-[9px] py-1.5 font-mono text-small leading-[17px] whitespace-pre-wrap [overflow-wrap:anywhere]">{spec.prompt}</pre>}
      <div className="flex gap-2">
        <button type="button" disabled={off || !detail} onClick={() => { void go('approve'); }} className={routineButton(true)}>{busy === 'approve' && <Spin />}{A.activate}</button>
        <button type="button" disabled={off} onClick={() => { void go('refuse'); }} className={routineButton()}>{busy === 'refuse' && <Spin />}{A.refuse}</button>
      </div>
      {error ? <p role="alert" className="text-small text-destructive">{error}</p> : <p className="text-[12px] text-muted">{canConfirm ? A.verify : copy.confirm.refused.confirm_required}</p>}
    </Card>
  );
}

function GroupItem({ store, task, state, canConfirm }: RoutineItemProps) {
  const A = copy.routines.atoi;
  const ids = coveredIds(task.routine);
  const listed = ids.map(id => state.routines?.find(r => r.id === id)).filter((r): r is PhoneRoutine => !!r);
  // The ones still waiting: « Activer les 3 » counts them, and a routine answered on the PC leaves the count.
  const waiting = state.routines ? listed.filter(r => r.state === 'pending' || r.proposed) : [];
  const n = state.routines ? waiting.length : ids.length;
  const first = listed[0];
  const session = first ? sessionOf(first, state.sessions.values()) : undefined;
  const [busy, setBusy] = useState<'approve' | 'refuse' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (which: 'approve' | 'refuse') => {
    setBusy(which); setError(null);
    // One command for the whole request: « Activer les N » is one device check over every routine and the key the phone showed.
    const [head, ...rest] = waiting;
    if (head) {
      const others = rest.map(r => ({ routine: r.id, routineKey: r.key }));
      setError(routineError(which === 'approve' ? await store.approveRoutine(head.id, head.key, others) : await store.routineCmd(head.id, 'refuse', others)));
    }
    setBusy(null);
  };
  const off = !state.fresh || busy !== null || waiting.length === 0;
  const who = (first && askerOf(first)) ?? task.giverName ?? '';
  return (
    <Card tone="ask" label={`${A.ask} · ${task.routine.name}`}>
      <Head failed={false} at={task.at} />
      {first
        ? <Said routine={first} session={session} frozen={!state.fresh}><b className="font-semibold">{who}</b> {A.groupAsks(n)}</Said>
        : <p className="text-body [overflow-wrap:anywhere]">{task.title}</p>}
      {listed.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-muted">
          {listed.map(r => {
            const v = scheduleView(r.schedule);
            return <li key={r.id}><span className="text-fg">{r.name}</span> · {v.moments[0] ?? v.card}</li>;
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={off} onClick={() => { void go('approve'); }} className={routineButton(true)}>{busy === 'approve' && <Spin />}{A.activateAll(n)}</button>
        <button type="button" disabled={off} onClick={() => { void go('refuse'); }} className={routineButton()}>{busy === 'refuse' && <Spin />}{A.refuseAll(n)}</button>
      </div>
      {error ? <p role="alert" className="text-small text-destructive">{error}</p> : <p className="text-[12px] text-muted">{canConfirm ? A.verify : copy.confirm.refused.confirm_required}</p>}
    </Card>
  );
}

function FailedItem({ store, task, state }: RoutineItemProps) {
  const A = copy.routines.atoi;
  const id = task.routine.id;
  const routine = state.routines?.find(r => r.id === id);
  const session = routine ? sessionOf(routine, state.sessions.values()) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const why = failureWhy(routine, task.routine.reason);
  const line = A.failedLine(routine?.name ?? task.routine.name, routine?.target.name ?? '', why);
  const retry = async () => {
    setBusy(true); setError(null);
    setError(routineError(await store.routineCmd(id, 'run')));
    setBusy(false);
  };
  return (
    <Card tone="perm" label={`${A.failed} · ${task.routine.name}`}>
      <Head failed at={task.at} />
      {routine ? <Said routine={routine} session={session} frozen={!state.fresh}>{line}</Said> : <p className="text-body [overflow-wrap:anywhere]">{line}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!state.fresh || busy} onClick={() => { void retry(); }} className={routineButton(true)}>{busy && <Spin />}{A.retry}</button>
        <a href={href({ name: 'routines', routine: id })} className={routineButton()}>{A.see}</a>
      </div>
      {error && <p role="alert" className="text-small text-destructive">{error}</p>}
    </Card>
  );
}
