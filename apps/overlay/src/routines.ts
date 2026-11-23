import { WEEKDAYS, type OperatorNotice, type Routine, type RoutineField, type RoutineSchedule, type Task, type Weekday } from '@ledge/protocol';
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

type ERRS = Messages['atoi']['routine']['err'];

/**
 * A field's words (card 28) for a run or a refusal about `r`, or null when the card gives none for it. The contract names the field,
 * not which of a session's two cases: the daemon's reason says « hors de Ledge » for a session Ledge does not follow. A stored routine
 * always has times and days, so `schedule` keeps the daemon's reason.
 */
function fieldText(field: RoutineField | undefined, r: Pick<Routine, 'name' | 'target' | 'schedule'>, reason: string | undefined, E: ERRS): string | null {
  switch (field) {
    case 'cwd': return E.cwd;
    case 'at': return E.at;
    case 'prompt': return E.prompt;
    case 'name': return E.name(r.target.name, r.name);
    case 'tz': return r.schedule.tz ? E.tz(r.schedule.tz) : null;
    case 'session': return /hors de Ledge/.test(reason ?? '') ? E.notLedge : E.unreachable;
    case 'tool': return E.tool(r.target.tool);
    case 'model': return r.target.model ? E.model(r.target.tool, r.target.model) : null;
    default: return null;
  }
}

/** A routine's item as the island's bubble shows it. */
export interface RoutineNotice {
  kind: 'approve' | 'failed';
  /** The machine holding the routines, and those the buttons answer: the ones still waiting for a request, the routine for a failure. */
  machine: string;
  ids: string[];
  /** Who the head names (the session that asks, or the one a failed run was for), and the item's words. */
  who: string;
  text: string;
  /** The routine « Voir » opens: the first one. */
  first: { id: string; name: string };
}

/**
 * A `decision` notice's routine item, from its task and the routines its machine holds; null when the task carries no routine
 * (a plain decision). The words fall back on the task's own title while the routine is not listed yet.
 */
export function routineNotice(notice: OperatorNotice, machine: string, task: Task | undefined, routines: readonly FleetRoutine[], m: Messages): RoutineNotice | null {
  const r = task?.routine;
  if (!task || !r) return null;
  const R = m.atoi.routine;
  const find = (id: string) => routines.find(x => x.machineId === machine && x.id === id);
  const one = find(r.id);
  if (r.kind === 'failed') {
    const who = one?.target.name ?? task.giverName;
    // The daemon's reasons are French: card 28's words for the field it names, else its reason.
    const run = one?.lastRun?.outcome === 'failed' ? one.lastRun : undefined;
    const reason = r.reason ?? run?.reason;
    const why = (one && run && fieldText(run.field, one, reason, R.err)) ?? reason ?? '';
    return { kind: 'failed', machine, ids: [r.id], who, text: R.failed(one?.name ?? r.name, who, why), first: { id: r.id, name: one?.name ?? r.name } };
  }
  const covered = r.ids ?? [r.id];
  const listed = covered.map(find).filter((x): x is FleetRoutine => !!x);
  // The ones still waiting: a routine answered elsewhere leaves the count of « Activer les 3 ».
  const waiting = listed.filter(x => x.state === 'pending' || !!x.proposal).map(x => x.id);
  const ids = listed.length ? waiting : covered;
  const first = { id: r.id, name: one?.name ?? r.name };
  // The daemon raises the item itself (its giver is Ledge): the session that asks is the routine's own.
  const asker = (x: FleetRoutine | undefined) => x?.proposal?.by.name ?? (x?.createdBy.kind === 'session' ? x.createdBy.name : undefined);
  const who = asker(one) ?? asker(listed[0]) ?? notice.who ?? task.giverName;
  if (covered.length > 1) {
    const list = listed.map(x => `${x.name} (${routineWhen(x.schedule, m).moments[0] ?? routineWhen(x.schedule, m).ask})`).join(', ');
    return { kind: 'approve', machine, ids, who, text: listed.length ? R.groupAsk(who, ids.length, list) : notice.text, first };
  }
  if (!one) return { kind: 'approve', machine, ids, who, text: notice.text, first };
  // What « Activer » applies: a session's change waiting on the user, else the routine as it is.
  const spec = one.proposal?.spec ?? one;
  return { kind: 'approve', machine, ids, who, text: R.ask(who, spec.name, routineWhen(spec.schedule, m).ask, spec.target.cwd), first };
}
