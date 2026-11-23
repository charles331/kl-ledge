import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Fleet, FleetRoutine } from '@ledge/fleet';

type RoutineSource = Pick<Fleet, 'routines' | 'onRoutines'>;

/** Every machine's routines, as one list kept between changes: `routines()` builds a new array on each call, which
 *  `useSyncExternalStore` would take for a change at every render. A fallen machine's are its last list (the fleet keeps them). */
export function useRoutines(fleet: RoutineSource | null | undefined): readonly FleetRoutine[] {
  const cache = useRef<{ from: RoutineSource; list: readonly FleetRoutine[] } | null>(null);
  const subscribe = useCallback((cb: () => void) => (fleet ? fleet.onRoutines(() => { cache.current = null; cb(); }) : () => {}), [fleet]);
  const get = useCallback((): readonly FleetRoutine[] => {
    if (!fleet) return NONE;
    if (cache.current?.from === fleet) return cache.current.list;
    const list = fleet.routines();
    cache.current = { from: fleet, list };
    return list;
  }, [fleet]);
  return useSyncExternalStore(subscribe, get, get);
}
const NONE: readonly FleetRoutine[] = [];
