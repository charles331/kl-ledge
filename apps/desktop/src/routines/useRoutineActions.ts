import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Routine, RoutineSpec } from '@ledge/protocol';
import type { Fleet, FleetRoutine, RoutineFailure } from '@ledge/fleet';
import type { Messages } from '../i18n/messages';
import type { ToastAction } from '../shell/Toast';
import { lastRunOf, routineRef, whyText } from './model';

type R = Messages['routines'];
type Source = Pick<Fleet, 'routineCmd'> & Partial<Pick<Fleet, 'rereadRoutines' | 'machines'>>;

/** What the Routines screens ask the daemons (spec §3.4): every button of the sidebar, a page and « À toi » goes through here. */
export interface RoutineActions {
  /** « Lancer maintenant » in flight, by tab ref: what the row and the page head say meanwhile (card 9). */
  running: ReadonlyMap<string, string>;
  run(r: FleetRoutine, session: string, alive: boolean): void;
  pause(r: FleetRoutine): void; resume(r: FleetRoutine): void;
  /** « Activer », with the request as the owner corrected it (`spec`), bound to the version read (`expect`, its key by default).
   *  `stale`: a session changed the routine since; nothing applied, its machine's routines read again, no toast (card 32). */
  approve(r: FleetRoutine, spec?: RoutineSpec, expect?: string): Promise<boolean | 'stale'>;
  /** « Activer les N »: one command for the whole group, all or nothing (dev-back ccfa3df6); `stale` as `approve`. */
  approveAll(rs: readonly FleetRoutine[]): Promise<boolean | 'stale'>;
  refuse(r: FleetRoutine): Promise<boolean>;
  /** « Refuser les N »: one command for the whole group. */
  refuseAll(rs: readonly FleetRoutine[]): Promise<boolean>;
  remove(r: FleetRoutine): Promise<boolean>;
  update(r: FleetRoutine, patch: Partial<RoutineSpec>): Promise<Routine | null>;
  add(machine: string, spec: RoutineSpec): Promise<Routine | null>;
  /** A page saving its form hears a refusal first (« name_taken » goes under its name field). */
  refusedBy(fn: Refused | null): void;
}

/** The daemon's word for a refusal, kept for the form (« name_taken » goes under the name field). */
export type Refused = (failure: RoutineFailure) => boolean;

/** Each command answered by a toast when it fails (its message); « Lancer maintenant » by the toast of its outcome, whose « Voir »
 *  opens the routine's page (card 9). The daemon answers `run` at once and tells the firing's outcome later, in a `routine.changed`
 *  whose last run is new: « attend que X soit libre… » stays until then. `refused` sees a refusal first: true when it says it
 *  where it belongs. */
export function useRoutineActions(fleet: Source | null | undefined, t: R, notify: (text: string, action?: ToastAction) => void, onSee: (ref: string) => void, routines: readonly FleetRoutine[] = [], dirLabel: (r: FleetRoutine, path: string) => string = (_r, path) => path): RoutineActions {
  const [running, setRunning] = useState<ReadonlyMap<string, string>>(new Map());
  // A firing asked for, by ref: the last run it started from (its `at`), and the session named in the toast.
  const asked = useRef(new Map<string, { before: string | undefined; session: string; name: string; r: FleetRoutine }>());
  const told = useCallback((ref: string, r: Routine): boolean => {
    const a = asked.current.get(ref);
    const last = lastRunOf(r);
    if (!a || !last || last.at === a.before) return false;
    asked.current.delete(ref);
    setRunning(m => { const n = new Map(m); n.delete(ref); return n; });
    if (last.outcome === 'failed') notify(t.toastFailed(a.name, whyText(last, a.r.target, path => dirLabel(a.r, path), t)), { label: t.see, run: () => onSee(ref), undo: false, tone: 'warn' });
    else notify(last.outcome === 'resumed' ? t.toastResumed(a.name, a.session) : last.outcome === 'launched' ? t.toastLaunched(a.name, a.session) : t.toastRun(a.name, a.session));
    return true;
  }, [notify, onSee, t, dirLabel]);
  useEffect(() => {
    for (const ref of [...asked.current.keys()]) {
      const r = routines.find(x => routineRef(x) === ref);
      if (r) told(ref, r);
      else { asked.current.delete(ref); setRunning(m => { const n = new Map(m); n.delete(ref); return n; }); }
    }
  }, [routines, told]);
  const refused = useRef<Refused | null>(null);
  const fail = useCallback((e: unknown) => {
    const f = e as RoutineFailure;
    if (refused.current?.(f)) return;
    // The daemon's reason is French: a folder or a moment past, which the mockup words, read in the screen's language.
    notify(f?.field === 'cwd' ? t.err.dir : f?.field === 'at' ? t.err.past : f?.message || String(e));
  }, [notify, t]);
  const cmd = useCallback(async (machine: string, ask: Parameters<Source['routineCmd']>[1]): Promise<Routine | null | false> => {
    if (!fleet) return false;
    try { const res = await fleet.routineCmd(machine, ask); return res.routine ?? null; } catch (e) { fail(e); return false; }
  }, [fleet, fail]);
  return useMemo(() => ({
    running,
    refusedBy(fn: Refused | null) { refused.current = fn; },
    run(r, session, alive) {
      const ref = routineRef(r);
      if (running.has(ref)) return;
      setRunning(m => new Map(m).set(ref, alive ? t.waiting(session) : t.starting(session)));
      asked.current.set(ref, { before: lastRunOf(r)?.at, session, name: r.name, r });
      void cmd(r.machineId, { op: 'run', routine: r.id }).then(out => {
        if (out === false) { asked.current.delete(ref); setRunning(m => { const n = new Map(m); n.delete(ref); return n; }); return; }
        if (out) told(ref, out);
      });
    },
    pause(r) { void cmd(r.machineId, { op: 'pause', routine: r.id }); },
    resume(r) { void cmd(r.machineId, { op: 'resume', routine: r.id }); },
    // Bound to the routine as shown (its daemon-computed key): one a session changed since is refused `stale`, never applied unseen.
    approve: async (r, spec, expect) => {
      if (!fleet) return false;
      const key = expect ?? r.key;
      try { await fleet.routineCmd(r.machineId, { op: 'approve', routine: r.id, ...(key ? { expect: key } : {}), ...(spec ? { spec } : {}) }); return true; }
      catch (e) { if ((e as RoutineFailure)?.code === 'stale') { fleet.rereadRoutines?.(r.machineId); return 'stale'; } fail(e); return false; }
    },
    approveAll: async rs => {
      const [head, ...rest] = rs;
      if (!fleet || !head) return false;
      // A daemon that does not announce grouped commands (dev-back 4e04e476) would apply the first only: one approval each, the
      // first stale one stopping the rest.
      if (!fleet.machines?.().find(m => m.id === head.machineId)?.daemon?.routineGroups) {
        for (const r of rs) {
          try { await fleet.routineCmd(r.machineId, { op: 'approve', routine: r.id, ...(r.key ? { expect: r.key } : {}) }); }
          catch (e) { if ((e as RoutineFailure)?.code === 'stale') { fleet.rereadRoutines?.(r.machineId); return 'stale'; } fail(e); return false; }
        }
        return true;
      }
      const others = rest.map(o => ({ routine: o.id, expect: o.key ?? '' })).filter(o => o.expect);
      try { await fleet.routineCmd(head.machineId, { op: 'approve', routine: head.id, ...(head.key ? { expect: head.key } : {}), ...(others.length ? { others } : {}) }); return true; }
      catch (e) { if ((e as RoutineFailure)?.code === 'stale') { fleet.rereadRoutines?.(head.machineId); return 'stale'; } fail(e); return false; }
    },
    refuseAll: async rs => {
      const [head, ...rest] = rs;
      if (!head) return false;
      if (!fleet?.machines?.().find(m => m.id === head.machineId)?.daemon?.routineGroups) {
        for (const r of rs) if ((await cmd(r.machineId, { op: 'refuse', routine: r.id })) === false) return false;
        return true;
      }
      const others = rest.map(o => ({ routine: o.id, expect: o.key ?? '' })).filter(o => o.expect);
      return (await cmd(head.machineId, { op: 'refuse', routine: head.id, ...(head.key ? { expect: head.key } : {}), ...(others.length ? { others } : {}) })) !== false;
    },
    refuse: async r => (await cmd(r.machineId, { op: 'refuse', routine: r.id })) !== false,
    remove: async r => (await cmd(r.machineId, { op: 'rm', routine: r.id })) !== false,
    update: async (r, patch) => { const out = await cmd(r.machineId, { op: 'update', routine: r.id, patch }); return out || null; },
    add: async (machine, spec) => { const out = await cmd(machine, { op: 'add', spec }); return out || null; }
  }), [running, cmd, told, t, fleet, fail]);
}
