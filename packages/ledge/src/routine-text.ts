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

/** « 08:00, 13:30, 16:30 (lun-ven) », the times sorted, the zone named when the routine has one. */
export function scheduleText(s: RoutineSchedule, lang: 'fr' | 'en'): string {
  return `${[...s.times].sort().join(', ')} (${daysText(s.days, lang)}${s.tz ? `, ${s.tz}` : ''})`;
}
