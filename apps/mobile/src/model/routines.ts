import { WEEKDAYS, type PhoneRoutine, type PhoneSession, type PhoneTask, type RoutineSchedule, type TaskRoutine, type Weekday } from '@ledge/protocol';
import { copy, locale } from '../copy';
import { taskClosed } from './tasks';

/*
 * The PC's routines as the phone shows them (docs/mockups/ledge-routines.html, cards 17 and 25): read-only, grouped into
 * recurring ones and one-shots, the ones waiting on the user or that failed first; and the items they put in « À toi ».
 */

/** How a schedule reads on the phone. */
export interface ScheduleView {
  /** A card's words after the session: « 08:00, 13:30, 16:30 · lun–ven », « jeu. 16:00 · 1 semaine sur 2 », « unique ». */
  card: string;
  /** An activation request's words: « 17:00 (ven) », « 16:00 (jeu, 1 sem. sur 2) », « jeu. 3 déc. 16:00 » (the last two approved
   *  by the owner on 2026-11-23). */
  ask: string;
  /** Every other week, or a one-shot: its next run says its date, never « aujourd’hui ». */
  dated: boolean;
  /** A one-shot's moments in order, « jeu. 3 déc. 16:00 »; none for a recurring one. */
  moments: string[];
}

/** A weekday's date in the week of Monday 23 November 2026, read in UTC: only its name is wanted. */
const dayDate = (d: Weekday) => new Date(Date.UTC(2026, 10, 23 + WEEKDAYS.indexOf(d)));
/** A weekday as a date names it: « jeu. », "Thu". */
const dayShort = (d: Weekday) => dayDate(d).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
/** A calendar day as the mockup writes it: « jeu. 3 déc. », "Thu 3 Dec". */
const dateShort = (d: Date, utc: boolean) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(utc ? { timeZone: 'UTC' } : {}) });

/** The days as the screens write them: every day, runs of three or more as a range (« lun–ven »), the others listed. */
function daysText(days: readonly Weekday[]): string {
  const R = copy.routines;
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

/** A one-shot's local moment, « 2026-12-03T16:00 », as « jeu. 3 déc. 16:00 »: a wall-clock time, never moved to the phone's zone. */
function momentText(at: string): string {
  const [date = '', time = ''] = at.split('T');
  const [y, m, d] = date.split('-').map(Number);
  return `${dateShort(new Date(Date.UTC(y!, m! - 1, d!)), true)} ${time}`;
}

/**
 * The one place the phone reads a schedule's fields (`times`, `days`, `every`, `at`): every card, request and line says a
 * schedule through what this returns.
 */
export function scheduleView(s: RoutineSchedule): ScheduleView {
  const R = copy.routines;
  if (s.kind === 'once') {
    const moments = [...s.at].sort().map(momentText);
    return { card: R.oneShot, ask: moments.join(', '), dated: true, moments };
  }
  const times = [...s.times].sort().join(', ');
  if (s.every?.weeks === 2) {
    // Every other week reads like a date (« jeu. 16:00 »): one day by its dated name, several as a list.
    const days = s.days.length === 1 ? dayShort(s.days[0]!) : daysText(s.days);
    return { card: `${days} ${times} · ${R.everyOther}`, ask: `${times} (${daysText(s.days)}, ${R.every2})`, dated: true, moments: [] };
  }
  const days = daysText(s.days);
  return { card: `${times} · ${days}`, ask: `${times} (${days})`, dated: false, moments: [] };
}

const timeOf = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** When a run leaves, on the phone's clock: « aujourd’hui 13:30 », « demain 09:00 », else « jeu. 26 nov. 16:00 »; always the
 *  date when `dated`. */
export function whenText(iso: string, now: number, dated = false): string {
  const d = new Date(iso);
  const time = timeOf(d);
  if (!dated) {
    const today = new Date(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dayKey(d) === dayKey(today)) return `${copy.routines.today} ${time}`;
    if (dayKey(d) === dayKey(tomorrow)) return `${copy.routines.tomorrow} ${time}`;
  }
  return `${dateShort(d, false)} ${time}`;
}

/** A routine's next-run line on its card: weekly ones by day (« Prochain tir aujourd’hui 13:30 »), dated ones by date. */
export function nextLine(r: Pick<PhoneRoutine, 'nextRun' | 'schedule'>, now: number): string | null {
  if (!r.nextRun) return null;
  const dated = scheduleView(r.schedule).dated;
  const when = whenText(r.nextRun, now, dated);
  return dated ? copy.routines.nextDated(when) : copy.routines.next(when);
}

/**
 * Why a routine's last run did not leave, in the screen's language: the daemon's reasons are French, so a run about the folder
 * (`field: 'cwd'`) is said with the mockup's words; any other reason is shown as the daemon gave it. `fallback`: an item's own.
 */
export function failureWhy(r: Pick<PhoneRoutine, 'lastRun' | 'target'> | undefined, fallback?: string): string {
  const run = r?.lastRun?.outcome === 'failed' ? r.lastRun : undefined;
  if (run?.field === 'cwd' && r) return copy.routines.why.cwd(r.target.cwd);
  return run?.reason ?? fallback ?? '';
}

/** A routine that may still fire: a fired one-shot (`done`) is history, read on the PC only. */
export const routineLive = (r: Pick<PhoneRoutine, 'state'>): boolean => r.state !== 'done';
/** Its last run did not leave. */
export const routineFailed = (r: Pick<PhoneRoutine, 'lastRun'>): boolean => r.lastRun?.outcome === 'failed';

/** Waiting on the user first, then those whose last run failed, then by their next run, the paused ones last. */
const rank = (r: PhoneRoutine) => (r.state === 'pending' ? 0 : routineFailed(r) ? 1 : r.state === 'paused' ? 3 : 2);
const byOrder = (a: PhoneRoutine, b: PhoneRoutine) => rank(a) - rank(b) || (a.nextRun ?? '￿').localeCompare(b.nextRun ?? '￿') || a.name.localeCompare(b.name);

/** The phone's two groups (card 25): recurring ones, then one-shots; no past one-shots. */
export function routineGroups(routines: readonly PhoneRoutine[]): { recurring: PhoneRoutine[]; once: PhoneRoutine[] } {
  const live = routines.filter(routineLive).sort(byOrder);
  return { recurring: live.filter(r => r.schedule.kind === 'recurring'), once: live.filter(r => r.schedule.kind === 'once') };
}

/** What the entry in Sessions says: how many routines, the next run of an active one, how many wait on the user or failed. */
export function routinesEntry(routines: readonly PhoneRoutine[], now: number): { count: number; next: string | null; flagged: number } {
  const live = routines.filter(routineLive);
  const next = live.filter(r => r.state === 'enabled' && r.nextRun).map(r => r.nextRun!).sort()[0];
  const nextText = next === undefined ? null : new Date(next).toDateString() === new Date(now).toDateString() ? timeOf(new Date(next)) : whenText(next, now);
  return { count: live.length, next: nextText, flagged: live.filter(r => r.state === 'pending' || routineFailed(r)).length };
}

/** The live session a routine wakes, found by its name as the phone knows no folder; undefined when it is gone. */
export function sessionOf(r: Pick<PhoneRoutine, 'target'>, sessions: Iterable<PhoneSession>): PhoneSession | undefined {
  const named = [...sessions].filter(s => s.name === r.target.name);
  return named.find(s => s.state !== 'exited') ?? named[0];
}

/** The sessions a routine that may still fire wakes: they carry the small clock in the list. */
export function wokenSessions(routines: readonly PhoneRoutine[] | null, sessions: Iterable<PhoneSession>): ReadonlySet<string> {
  const all = [...sessions];
  const out = new Set<string>();
  for (const r of routines ?? []) {
    if (!routineLive(r)) continue;
    const s = sessionOf(r, all);
    if (s) out.add(s.id);
  }
  return out;
}

/** The session that asks for a routine: its change's author, else its creator; the daemon raises the item itself (its giver is Ledge). */
export const askerOf = (r: Pick<PhoneRoutine, 'createdBy'> & { proposal?: { by: { name: string } } | undefined }): string | undefined =>
  r.proposal?.by.name ?? (r.createdBy.kind === 'session' ? r.createdBy.name : undefined);

/** A task that is a routine's item of « À toi ». */
export type RoutineTask = PhoneTask & { routine: TaskRoutine };

/** The routines' items of « À toi » still open: the activation requests, then the failures (card 17's order), each the oldest first. */
export function routineItems(tasks: Iterable<PhoneTask>): RoutineTask[] {
  const rank = (t: RoutineTask) => (t.routine.kind === 'approve' ? 0 : 1);
  return [...tasks].filter((t): t is RoutineTask => !!t.routine && !taskClosed(t)).sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at));
}

/** The routines an activation request covers, in its order: its `ids` when a session proposed several together, else its own. */
export const coveredIds = (r: TaskRoutine): string[] => r.ids ?? [r.id];
