import { WEEKDAYS, type OperatorNotice, type RoutineSchedule, type Task, type Weekday } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet/routines';
import type { Messages } from './i18n/lang';

/*
 * The routines' items of « À toi » as the island says them (docs/mockups/ledge-routines.html, cards 15 and 23): an activation
 * request, several one-shots proposed together, a run that could not leave. Each reaches the island as the operator's
 * `decision` notice of the task that carries it (`Task.routine`).
 */

/** How a schedule reads in the island: an activation request's words, « 17:00 (ven) », « 16:00 (jeu, 1 sem. sur 2) » or
 *  « jeu. 3 déc. 16:00 » (the last two approved by the owner on 2026-11-23); and a one-shot's moments in a grouped request,
 *  « 3 déc. 16:00 » (card 23). */
export interface RoutineWhen { ask: string; moments: string[] }

/** The days as the island writes them: every day, runs of three or more as a range (« lun–ven »), the others listed. */
function daysText(days: readonly Weekday[], m: Messages): string {
  const R = m.atoi.routine;
  const idx = WEEKDAYS.map((d, i) => (days.includes(d) ? i : -1)).filter(i => i >= 0);
  if (idx.length === WEEKDAYS.length) return R.daily;
  const parts: string[] = [];
  for (let k = 0; k < idx.length;) {
    let end = k;
    while (end + 1 < idx.length && idx[end + 1] === idx[end]! + 1) end++;
    const run = idx.slice(k, end + 1).map(i => R.days[WEEKDAYS[i]!]);
    parts.push(run.length >= 3 ? `${run[0]}–${run[run.length - 1]}` : run.join(', '));
    k = end + 1;
  }
  return parts.join(', ');
}

/** A one-shot's local moment, « 2026-12-03T16:00 », as « 3 déc. 16:00 », or with its weekday « jeu. 3 déc. 16:00 »: a wall-clock
 *  time, never moved to another zone. */
function momentText(at: string, m: Messages, weekday = false): string {
  const [date = '', time = ''] = at.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y!, mo! - 1, d!));
  const month = day.toLocaleDateString(m.time.locale, { month: 'short', timeZone: 'UTC' });
  const wd = weekday ? `${day.toLocaleDateString(m.time.locale, { weekday: 'short', timeZone: 'UTC' })} ` : '';
  return `${wd}${d} ${month} ${time}`;
}

/** The one place the island reads a schedule's fields (`times`, `days`, `every`, `at`). */
export function routineWhen(s: RoutineSchedule, m: Messages): RoutineWhen {
  if (s.kind === 'once') {
    const at = [...s.at].sort();
    const dated = at.map(x => momentText(x, m, true));
    // Past three moments, the rest is counted (card 28).
    return { ask: dated.length > 3 ? m.atoi.routine.more(dated.slice(0, 3).join(', '), dated.length - 3) : dated.join(', '), moments: at.map(x => momentText(x, m)) };
  }
  const every = s.every?.weeks === 2 ? `, ${m.atoi.routine.every2}` : '';
  return { ask: `${[...s.times].sort().join(', ')} (${daysText(s.days, m)}${every})`, moments: [] };
}

/** A routine's item as the island's bubble shows it. */
export interface RoutineNotice {
  kind: 'approve' | 'failed';
  /** The machine holding the routines, and those the buttons answer: the ones still waiting for a request, the routine for a failure. */
  machine: string;
  ids: string[];
  /** What « Activer » applies for each id, as the daemon last listed it (`Routine.key`): sent back as `expect`, so a routine changed
   *  since the bubble showed it is refused. Missing for a routine not read yet, which cannot be activated. */
  keys: Record<string, string | undefined>;
  /** Who the head names (the session that asks, or the one a failed run was for), and the item's words. */
  who: string;
  text: string;
  /** The routine « Voir » opens: the first one. */
  first: { id: string; name: string };
}

/**
 * Why a run did not leave, in the island's language (the daemon's reasons are French): a missing folder or tool in the words cards
 * 8, 13-16 and 29 draw, a run not typed in time in card 8's (`cause`); any other as the daemon gave it.
 */
export function runWhy(r: Pick<FleetRoutine, 'lastRun' | 'target'> | undefined, fallback: string | undefined, m: Messages): string {
  const W = m.atoi.routine.why;
  const run = r?.lastRun?.outcome === 'failed' ? r.lastRun : undefined;
  if (r && run?.field === 'cwd') return W.cwd(r.target.cwd);
  if (r && run?.field === 'tool') return W.tool(r.target.tool);
  if (run?.cause === 'timeout') return W.timeout;
  return fallback ?? run?.reason ?? '';
}

/**
 * A `decision` notice's routine item, from its task and the routines its machine holds; null when the task carries no routine
 * (a plain decision). Never the task's title (the daemon writes it in French only): a routine not read yet says card 30's words.
 */
export function routineNotice(notice: OperatorNotice, machine: string, task: Task | undefined, routines: readonly FleetRoutine[], m: Messages): RoutineNotice | null {
  const r = task?.routine;
  if (!task || !r) return null;
  const R = m.atoi.routine;
  const find = (id: string) => routines.find(x => x.machineId === machine && x.id === id);
  const one = find(r.id);
  const first = { id: r.id, name: one?.name ?? r.name };
  if (r.kind === 'failed') {
    const why = runWhy(one, one?.lastRun?.outcome === 'failed' && (one.lastRun.field || one.lastRun.cause) ? undefined : r.reason, m);
    if (!one) return { kind: 'failed', machine, ids: [r.id], keys: {}, who: task.giverName, text: R.fallbackFailed(r.name, why), first };
    return { kind: 'failed', machine, ids: [r.id], keys: {}, who: one.target.name, text: R.failed(one.name, one.target.name, why), first };
  }
  const covered = r.ids ?? [r.id];
  const listed = covered.map(find).filter((x): x is FleetRoutine => !!x);
  // The ones still waiting: a routine answered elsewhere leaves the count of « Activer les 3 ».
  const waiting = listed.filter(x => x.state === 'pending' || !!x.proposal);
  const ids = listed.length ? waiting.map(x => x.id) : covered;
  const keys = Object.fromEntries(ids.map(id => [id, find(id)?.key]));
  // The daemon raises the item itself (its giver is Ledge): the session that asks is the routine's own.
  const asker = (x: FleetRoutine | undefined) => x?.proposal?.by.name ?? (x?.createdBy.kind === 'session' ? x.createdBy.name : undefined);
  const who = asker(one) ?? asker(listed[0]) ?? notice.who ?? task.giverName;
  if (covered.length > 1) {
    if (!listed.length) return { kind: 'approve', machine, ids, keys, who, text: R.fallbackAsk(r.name), first };
    const list = listed.map(x => `${x.name} (${routineWhen(x.schedule, m).moments[0] ?? routineWhen(x.schedule, m).ask})`).join(', ');
    return { kind: 'approve', machine, ids, keys, who, text: R.groupAsk(who, ids.length, list), first };
  }
  if (!one) return { kind: 'approve', machine, ids, keys, who, text: R.fallbackAsk(r.name), first };
  // What « Activer » applies: a session's change waiting on the user (« veut modifier », card 29), else the routine as it is.
  const when = routineWhen((one.proposal?.spec ?? one).schedule, m).ask;
  const text = one.proposal ? R.editAsk(who, one.proposal.spec.name, when) : R.ask(who, one.name, when, one.target.cwd);
  return { kind: 'approve', machine, ids, keys, who, text, first };
}
