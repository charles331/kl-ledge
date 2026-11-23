import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { DaemonClient, FleetRoutine, RoutineFailure } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { targetNames } from '../../routine-text.js';
import { useScreenKeys, useScreenSize, useTui } from '../context.js';
import { step } from '../model/openrig.js';
import { machineOf } from '../model/overview.js';
import { routineLines, routineOrder } from '../model/routines.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { LineText } from '../ui/Lines.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Every machine's routines, kept up to date as their daemons tell each change (`routine.changed`). */
export function useRoutines(client: DaemonClient): FleetRoutine[] {
  const fleet = client.fleet;
  const [list, setList] = useState<FleetRoutine[]>(() => fleet?.routines() ?? []);
  useEffect(() => {
    if (!fleet) return;
    setList(fleet.routines());
    return fleet.onRoutines(() => setList(fleet.routines()));
  }, [fleet]);
  return list;
}

const keyOf = (r: Pick<FleetRoutine, 'machineId' | 'id'>) => `${r.machineId}/${r.id}`;

/** The live session a routine wakes on its machine: one of its names (its own or one it relieves), in its folder. */
export function sessionOf(r: FleetRoutine, sessions: readonly Session[]): Session | undefined {
  const get = (id: string) => sessions.find(s => s.id === id);
  return sessions.find(s => s.state !== 'exited' && machineOf(s) === r.machineId && s.cwd === r.target.cwd && targetNames(s, get).includes(r.target.name));
}

/**
 * Screen 7, Routines (docs/mockups/ledge-routines.html, cards 18 and 25): every routine in two lines, the one-shots under their
 * own title. j k choose, r runs the chosen one now (again, after a failure), p pauses or resumes it, ↵ opens its session. A
 * routine awaiting the owner's approval is read here and activated in « À toi ». What a run became comes as a toast.
 */
export function RoutinesScreen() {
  const tui = useTui();
  const { t, g, lang, d } = tui;
  const x = t.routines;
  const { columns, rows: height } = useScreenSize();
  const rows = routineOrder(useRoutines(tui.client));
  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = Math.max(0, rows.findIndex(r => keyOf(r) === selKey));
  const chosen = rows[sel];
  // A run asked here, by routine: its last firing then, so the next one says how it went.
  const runs = useRef(new Map<string, string | undefined>());
  useEffect(() => {
    for (const r of rows) {
      const k = keyOf(r);
      if (!runs.current.has(k) || r.lastRun?.at === runs.current.get(k) || !r.lastRun) continue;
      runs.current.delete(k);
      const run = r.lastRun;
      tui.toast(run.outcome === 'failed' ? { text: x.toast.failed(r.name, run.reason ?? x.out.failed), tone: 'error' }
        : { text: `${g.ok} ${run.outcome === 'resumed' ? x.toast.resumed(r.name, r.target.name) : x.toast.delivered(r.name, r.target.name)}`, tone: 'ok' });
    }
  });

  const refused = (r: FleetRoutine, run: boolean) => (e: RoutineFailure) => {
    runs.current.delete(keyOf(r));
    tui.toast({ text: run ? x.toast.failed(r.name, e.message || e.code) : e.message || e.code, tone: 'error' });
  };
  useScreenKeys((input, key) => {
    if (key.downArrow || input === 'j') { const n = rows[step(sel, 1, rows.length)]; if (n) setSelKey(keyOf(n)); return true; }
    if (key.upArrow || input === 'k') { const n = rows[step(sel, -1, rows.length)]; if (n) setSelKey(keyOf(n)); return true; }
    if (!chosen) return false;
    if (input === 'r') {
      if (chosen.state === 'pending') return true;
      runs.current.set(keyOf(chosen), chosen.lastRun?.at);
      tui.fleet.routineCmd(chosen.machineId, { op: 'run', routine: chosen.id }).catch(refused(chosen, true));
      return true;
    }
    if (input === 'p') {
      if (chosen.state !== 'enabled' && chosen.state !== 'paused') return true;
      tui.fleet.routineCmd(chosen.machineId, { op: chosen.state === 'paused' ? 'resume' : 'pause', routine: chosen.id }).catch(refused(chosen, false));
      return true;
    }
    if (key.return) {
      const s = sessionOf(chosen, d.sessions);
      if (s) { tui.select(s.id); tui.go('session'); }
      return true;
    }
    return false;
  });

  // Inside the box: its borders and padding; the status bar, the toast, the usage and key bars around it.
  const width = Math.max(20, columns - 4);
  const room = Math.max(2, height - 6);
  const list = routineLines(rows, { sel, width, now: Date.now(), lang }, t, g);
  const top = Math.max(0, Math.min(list.lines.length - room, list.selLine - Math.floor(room / 2)));
  const keys: Array<[string, string]> = [['j k', x.keys.nav], ['r', x.keys.runNow], ['p', x.keys.pauseResume], ['↵', x.keys.openSession]];
  return (
    <Frame crumb={`7 · ${t.tabs.routines}`} crumbShort={t.tabs.routines} keys={keys}>
      <TitledBox title={`${x.title} · ${rows.length}`} flexGrow={1} paddingX={0} titleColor={C.fg} titleBold>
        {rows.length === 0 ? <Text color={C.faint}> {x.empty}</Text>
          : list.lines.slice(top, top + room).map((l, i) => <Box key={top + i} flexShrink={0}><LineText line={l} /></Box>)}
      </TitledBox>
    </Frame>
  );
}
