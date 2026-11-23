import { useCallback, useMemo, useRef, useState } from 'react';
import type { Routine, RoutineSpec } from '@ledge/protocol';
import type { Fleet, FleetRoutine, RoutineFailure } from '@ledge/fleet';
import type { Messages } from '../i18n/messages';
import type { ToastAction } from '../shell/Toast';
import { lastRunOf, routineRef } from './model';

type R = Messages['routines'];
type Source = Pick<Fleet, 'routineCmd'>;

/** What the Routines screens ask the daemons (spec §3.4): every button of the sidebar, a page and « À toi » goes through here. */
export interface RoutineActions {
  /** « Lancer maintenant » in flight, by tab ref: what the row and the page head say meanwhile (card 9). */
  running: ReadonlyMap<string, string>;
  run(r: FleetRoutine, session: string, alive: boolean): void;
  pause(r: FleetRoutine): void; resume(r: FleetRoutine): void;
  /** « Activer », with the request as the owner corrected it (`spec`). */
  approve(r: FleetRoutine, spec?: RoutineSpec): Promise<boolean>;
  refuse(r: FleetRoutine): Promise<boolean>;
  remove(r: FleetRoutine): Promise<boolean>;
  update(r: FleetRoutine, patch: Partial<RoutineSpec>): Promise<Routine | null>;
  add(machine: string, spec: RoutineSpec): Promise<Routine | null>;
  /** A page saving its form hears a refusal first (« name_taken » goes under its name field). */
  refusedBy(fn: Refused | null): void;
}

/** The daemon's word for a refusal, kept for the form (« name_taken » goes under the name field). */
export type Refused = (failure: RoutineFailure) => boolean;

/** Each command answered by a toast when it fails (its message); « Lancer maintenant » by the toast of its outcome, whose « Voir »
 *  opens the routine's page (card 9). `refused` sees a refusal first: true when it says it where it belongs. */
export function useRoutineActions(fleet: Source | null | undefined, t: R, notify: (text: string, action?: ToastAction) => void, onSee: (ref: string) => void): RoutineActions {
  const [running, setRunning] = useState<ReadonlyMap<string, string>>(new Map());
  const refused = useRef<Refused | null>(null);
  const fail = useCallback((e: unknown) => {
    const f = e as RoutineFailure;
    if (refused.current?.(f)) return;
    notify(f?.message || String(e));
  }, [notify]);
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
      void cmd(r.machineId, { op: 'run', routine: r.id }).then(out => {
        setRunning(m => { const n = new Map(m); n.delete(ref); return n; });
        if (!out) return;
        const last = lastRunOf(out);
        if (last?.outcome === 'failed') notify(t.toastFailed(r.name, last.reason ?? ''), { label: t.see, run: () => onSee(ref), undo: false, tone: 'warn' });
        else notify(last?.outcome === 'resumed' ? t.toastResumed(r.name, session) : t.toastRun(r.name, session));
      });
    },
    pause(r) { void cmd(r.machineId, { op: 'pause', routine: r.id }); },
    resume(r) { void cmd(r.machineId, { op: 'resume', routine: r.id }); },
    approve: async (r, spec) => (await cmd(r.machineId, { op: 'approve', routine: r.id, ...(spec ? { spec } : {}) })) !== false,
    refuse: async r => (await cmd(r.machineId, { op: 'refuse', routine: r.id })) !== false,
    remove: async r => (await cmd(r.machineId, { op: 'rm', routine: r.id })) !== false,
    update: async (r, patch) => { const out = await cmd(r.machineId, { op: 'update', routine: r.id, patch }); return out || null; },
    add: async (machine, spec) => { const out = await cmd(machine, { op: 'add', spec }); return out || null; }
  }), [running, cmd, notify, onSee, t]);
}
