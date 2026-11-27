import { useEffect, useState } from 'react';
import type { FleetRoutine } from '@ledge/fleet/routines';
import type { DaemonClient } from '../daemon/client';

const none: FleetRoutine[] = [];

/** Every machine's routines, as the fleet keeps them: read again at each change it announces (`onRoutines`). */
export function useRoutines(client: DaemonClient): FleetRoutine[] {
  const fleet = client.fleet;
  const [list, setList] = useState<FleetRoutine[]>(() => fleet?.routines() ?? none);
  useEffect(() => {
    if (!fleet) { setList(none); return; }
    setList(fleet.routines());
    return fleet.onRoutines(() => setList(fleet.routines()));
  }, [fleet]);
  return list;
}
