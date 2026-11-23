import { resolve } from 'node:path';
import { WEEKDAYS, type Routine, type RoutineSchedule, type Session, type Weekday } from '@ledge/protocol';

/**
 * How Ledge's agents are told of routines (spec 2026-11-23-routines-design §3.3, §3.5, §3.6): which routines wake a
 * session, and each one's times and days in one line. Shared by the SessionStart hook, the chat's `routines.md` and the
 * relief's first instruction, so the three say the same thing.
 */

/** The most reliefs followed back from a session, as `reliefOf` follows them forward. */
const CHAIN_MAX = 50;

/** A session as a routine's target: its folder, and every name it answers to (`targetNames`). */
export interface RoutineHolder { cwd: string; names: readonly string[] }

/**
 * The names a session answers to as a routine's target: its own, then those of every session it relieves, down the whole
 * chain of reliefs (Iris → Iris-2 → Iris-3: Iris-3 holds Iris's routines), as the scheduler reaches the live end of that
 * chain through `reliefOf`. A predecessor no longer known still gives the name its relief recorded.
 */
export function targetNames(s: Pick<Session, 'name' | 'relieves'>, get: (id: string) => Pick<Session, 'name' | 'relieves'> | undefined): string[] {
  const names = [s.name];
  let cur: Pick<Session, 'name' | 'relieves'> | undefined = s;
  for (let hops = 0; cur?.relieves && hops < CHAIN_MAX; hops++) {
    const prev: Pick<Session, 'name' | 'relieves'> | undefined = get(cur.relieves.id);
    if (!names.includes(cur.relieves.name)) names.push(cur.relieves.name);
    cur = prev;
  }
  return names;
}

/** The routines whose target is this session: one of its names and the same folder, as the scheduler finds it (§3.2).
 *  The daemon stores the target's folder absolute. */
export function routinesOf(routines: readonly Routine[], s: RoutineHolder): Routine[] {
  const names = new Set(s.names);
  const cwd = resolve(s.cwd);
  return routines.filter(r => names.has(r.target.name) && resolve(r.target.cwd) === cwd);
}

const DAY: Record<'fr' | 'en', Record<Weekday, string>> = {
  fr: { mon: 'lun', tue: 'mar', wed: 'mer', thu: 'jeu', fri: 'ven', sat: 'sam', sun: 'dim' },
  en: { mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun' }
};
const EVERY_DAY = { fr: 'tous les jours', en: 'every day' } as const;

/** The days as the CLI's `--days` reads them: runs of three days or more as a range (« lun-ven »), the others listed. */
export function daysText(days: readonly Weekday[], lang: 'fr' | 'en'): string {
  const set = new Set(days);
  if (set.size === 7) return EVERY_DAY[lang];
  const idx = WEEKDAYS.map((d, i) => (set.has(d) ? i : -1)).filter(i => i >= 0);
  const parts: string[] = [];
  for (let k = 0; k < idx.length;) {
    let end = k;
    while (end + 1 < idx.length && idx[end + 1] === idx[end]! + 1) end++;
    const run = idx.slice(k, end + 1).map(i => DAY[lang][WEEKDAYS[i]!]);
    parts.push(run.length >= 3 ? `${run[0]}-${run[run.length - 1]}` : run.join(','));
    k = end + 1;
  }
  return parts.join(',');
}

const EVERY_OTHER = { fr: (anchor: string) => `une semaine sur deux, semaine du ${anchor}`, en: (anchor: string) => `every other week, week of ${anchor}` } as const;
const ONCE = { fr: 'une fois', en: 'once' } as const;

/** A schedule in one line, the only place that reads its fields (§3.1.1): « 08:00, 13:30, 16:30 (lun-ven) », « 16:00 (jeu, une
 *  semaine sur deux, semaine du 2026-11-27) », « une fois : 2026-12-03 16:00 », the zone named when the routine has one. */
export function scheduleText(s: RoutineSchedule, lang: 'fr' | 'en'): string {
  const tz = s.tz ? `, ${s.tz}` : '';
  if (s.kind === 'once') return `${ONCE[lang]}${lang === 'fr' ? ' : ' : ': '}${[...s.at].sort().map(a => a.replace('T', ' ')).join(', ')}${s.tz ? ` (${s.tz})` : ''}`;
  const every = s.every?.weeks === 2 ? `, ${EVERY_OTHER[lang](s.every.anchor)}` : '';
  return `${[...s.times].sort().join(', ')} (${daysText(s.days, lang)}${every}${tz})`;
}

/** Whether a routine can still fire: a one-off that has fired (`done`) is kept for its history only. */
export const routineLive = (r: Pick<Routine, 'state'>): boolean => r.state !== 'done';

const LOCALE = { fr: 'fr-FR', en: 'en-GB' } as const;
const EVERY_TWO = { fr: '1 sem. sur 2', en: 'every 2 wks' } as const;
/** English names its days with a capital on a screen (« Thu », « Mon-Fri »), as the mockup writes them. */
const shownDays = (days: readonly Weekday[], lang: 'fr' | 'en'): string =>
  lang === 'en' ? daysText(days, lang).replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g, d => d[0]!.toUpperCase() + d.slice(1)) : daysText(days, lang);
/** A one-shot's local moment (« 2026-12-03T16:00 ») as a screen writes it: « jeu. 3 déc. 16:00 », « Thu 3 Dec 16:00 ». */
export function momentOnce(at: string, lang: 'fr' | 'en'): string {
  const [date, time] = at.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  return `${new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y!, m! - 1, d!))} ${time}`;
}

/** A schedule as an activation request says it on a screen and in « le point » (owner's words, 2026-11-23): « 17:00 (ven) »,
 *  « 16:00 (jeu, 1 sem. sur 2) », a one-shot « jeu. 3 déc. 16:00 ». */
export function askScheduleText(s: RoutineSchedule, lang: 'fr' | 'en'): string {
  if (s.kind === 'once') return [...s.at].sort().map(a => momentOnce(a, lang)).join(', ');
  return `${[...s.times].sort().join(', ')} (${shownDays(s.days, lang)}${s.every?.weeks === 2 ? `, ${EVERY_TWO[lang]}` : ''})`;
}

/** The days of several one-shots, month by month (mockup card 27): « 3, 7 et 8 déc. », « 3, 7 and 8 Dec ». */
export function onceDaysText(ats: readonly string[], lang: 'fr' | 'en'): string {
  const list = new Intl.ListFormat(LOCALE[lang], { type: 'conjunction' });
  const months: Array<{ key: string; label: string; days: number[] }> = [];
  for (const at of [...ats].sort()) {
    const [y, m, d] = at.slice(0, 10).split('-').map(Number);
    const key = `${y}-${m}`;
    let g = months.find(x => x.key === key);
    if (!g) { g = { key, label: new Intl.DateTimeFormat(LOCALE[lang], { month: 'short' }).format(new Date(y!, m! - 1, 1)), days: [] }; months.push(g); }
    if (!g.days.includes(d!)) g.days.push(d!);
  }
  return list.format(months.map(g => `${list.format(g.days.map(String))} ${g.label}`));
}
