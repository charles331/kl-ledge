import { WEEKDAYS, type RoutineSchedule, type Weekday } from '@ledge/protocol';
import type { Lang, Messages } from '../i18n/messages';

/**
 * How a routine's schedule reads on Desktop (docs/mockups/ledge-routines.html): the one module that reads a schedule's `times`,
 * `days`, `every` and `at`, for the sidebar, the page, « À toi » and the explorer's clock, and that turns the form's draft back
 * into a schedule. Instants (`nextRuns`, a run's `at`) are shown in this PC's zone; nothing here computes a firing: the daemon does.
 */

type R = Messages['routines'];
const locale = (lang: Lang): string => (lang === 'fr' ? 'fr-FR' : 'en-GB');
const two = (n: number): string => String(n).padStart(2, '0');

/** A local wall-clock « HH:MM » of an instant; empty for a date that does not parse. */
export function hhmm(iso: string | number | Date): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The local calendar day of an instant, « YYYY-MM-DD », as the prompt's {date} reads it. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Calendar days from `now` to `d` (0 today, 1 tomorrow, -1 yesterday), in the local zone. */
export function dayOffset(d: Date, now: Date): number {
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

const fmt = (lang: Lang, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(lang), o);
/** « jeu. 26 nov. » / « Thu 26 Nov ». */
export const dateLong = (d: Date, lang: Lang): string => fmt(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');
/** « jeu. 26 » / « Thu 26 ». */
export const dateShort = (d: Date, lang: Lang): string => fmt(lang, { weekday: 'short', day: 'numeric' }).format(d).replace(',', '');
/** « 3 déc. » / « 3 Dec ». */
export const dayMonth = (d: Date, lang: Lang): string => fmt(lang, { day: 'numeric', month: 'short' }).format(d);

/** The day of a run on the page (« Tirs », the preview, the banners; cards 3, 4 as fixed by 274bbbc7): « aujourd’hui »,
 *  « demain », « hier », else always the weekday, the day and the month (« ven. 20 nov. »). */
export function runDay(iso: string, now: Date, lang: Lang, r: R): string {
  const d = new Date(iso);
  const off = dayOffset(d, now);
  return off === 0 ? r.today : off === 1 ? r.tomorrow : off === -1 ? r.yesterday : dateLong(d, lang);
}

/** The next run at a sidebar row's right (the TUI's rule, design-ux point 7): the time alone today, « demain 09:00 », within six
 *  days « jeu. 26 16:00 », beyond « 4 déc. 09:00 ». */
export function nextLabel(iso: string, now: Date, lang: Lang, r: R): string {
  const d = new Date(iso);
  const off = dayOffset(d, now);
  if (off === 0) return hhmm(d);
  if (off === 1) return `${r.tomorrow} ${hhmm(d)}`;
  return `${off > 1 && off <= 6 ? dateShort(d, lang) : dayMonth(d, lang)} ${hhmm(d)}`;
}

/** The next run in a tooltip (the explorer's clock, card 12): « aujourd’hui 13:30 », « demain 09:00 », « jeu. 26 16:00 ». */
export function whenLabel(iso: string, now: Date, lang: Lang, r: R): string {
  const d = new Date(iso);
  const off = dayOffset(d, now);
  return `${off === 0 ? r.today : off === 1 ? r.tomorrow : dateShort(d, lang)} ${hhmm(d)}`;
}

const order = (days: readonly Weekday[]): Weekday[] => WEEKDAYS.filter(d => days.includes(d));
const WEEK: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** « lun–ven », « tous les jours », else the days, Monday first (« ven », « lun, mer, ven »). */
export function daysLabel(days: readonly Weekday[], r: R): string {
  const ds = order(days);
  if (ds.length === 7) return r.daily;
  if (ds.length === 5 && WEEK.every(d => ds.includes(d))) return r.monfri;
  return ds.map(d => r.days[d]).join(', ');
}

export const isOnce = (s: RoutineSchedule): boolean => s.kind === 'once';

/** A schedule's line under a routine's name (cards 2, 21): « 08:00 13:30 16:30 · lun–ven », « jeu. 16:00 · 1 sem. sur 2 »,
 *  « unique ». */
export function scheduleLine(s: RoutineSchedule, r: R): string {
  if (s.kind === 'once') return r.oneShot;
  const times = s.times.join(' ');
  const lead = s.days.length === 1 ? r.dayLead[s.days[0]!] : daysLabel(s.days, r);
  return s.every?.weeks === 2 ? `${lead} ${times} · ${r.every2}` : `${times} · ${daysLabel(s.days, r)}`;
}

/** A one-shot's moment, « 2026-12-03T16:00 », as a date: the local instant it names. */
export const momentDate = (at: string): Date => new Date(`${at}:00`);

/** A one-shot's chip (card 19): « jeu. 3 déc. · 16:00 ». */
export const momentLabel = (at: string, lang: Lang): string => `${dateLong(momentDate(at), lang)} · ${at.slice(11, 16)}`;

/** A one-shot's earliest moment, for a grouped request's short line (card 23); none for a recurring schedule. */
export const firstMoment = (s: RoutineSchedule): string | null => (s.kind === 'once' ? [...s.at].sort()[0] ?? null : null);

/** The ISO week of a local date and its Monday. */
export function isoWeek(d: Date): { week: number; monday: Date } {
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const firstMonday = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7));
  return { week: 1 + Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)), monday };
}

/** The reference week a date names (card 19): « semaine 48, du 23 au 29 novembre » / « week 48, 23–29 Nov ». */
export function anchorWeek(anchor: string, lang: Lang, r: R): string {
  const d = new Date(`${anchor}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const { week, monday } = isoWeek(d);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const month = lang === 'fr' ? 'long' : 'short';
  const same = monday.getMonth() === sunday.getMonth();
  const from = same ? String(monday.getDate()) : fmt(lang, { day: 'numeric', month }).format(monday);
  return r.week(week, from, fmt(lang, { day: 'numeric', month }).format(sunday));
}

/** What the form edits of a schedule: both kinds' fields at once, so switching kind keeps what was typed (card 19). */
export interface ScheduleDraft {
  kind: 'recurring' | 'once'; times: string[]; days: Weekday[]; weeks: 1 | 2; anchor: string; at: string[]; tz?: string;
}

/** A schedule as the form edits it; none (a new routine): an empty recurring one, every week. */
export function draftOf(s?: RoutineSchedule): ScheduleDraft {
  if (!s) return { kind: 'recurring', times: [], days: [], weeks: 1, anchor: '', at: [] };
  const tz = s.tz ? { tz: s.tz } : {};
  if (s.kind === 'once') return { kind: 'once', times: [], days: [], weeks: 1, anchor: '', at: [...s.at].sort(), ...tz };
  return { kind: 'recurring', times: [...s.times].sort(), days: order(s.days), weeks: s.every?.weeks ?? 1, anchor: s.every?.anchor ?? '', at: [], ...tz };
}

/** The form's draft as a schedule: times sorted, days Monday first, `every` only for two weeks. */
export function scheduleOf(d: ScheduleDraft): RoutineSchedule {
  const tz = d.tz ? { tz: d.tz } : {};
  if (d.kind === 'once') return { kind: 'once', at: [...new Set(d.at)].sort(), ...tz };
  return {
    kind: 'recurring', times: [...new Set(d.times)].sort(), days: order(d.days),
    ...(d.weeks === 2 ? { every: { weeks: 2 as const, anchor: d.anchor } } : {}), ...tz
  };
}

/** Two schedules fire alike: same kind, times, days, frequency and moments, whatever their order. */
export function sameSchedule(a: RoutineSchedule, b: RoutineSchedule): boolean {
  return JSON.stringify(scheduleOf(draftOf(a))) === JSON.stringify(scheduleOf(draftOf(b)));
}

/** What the draft lacks before it can be saved (card 5): a recurring one needs a time, a day and, every two weeks, its reference
 *  date; a one-shot a moment, none of them past. */
export interface ScheduleErrors { times?: true; days?: true; anchor?: true; at?: true; past?: string[] }
export function scheduleErrors(d: ScheduleDraft, now: Date): ScheduleErrors {
  if (d.kind === 'once') {
    const past = d.at.filter(a => momentDate(a).getTime() <= now.getTime());
    return { ...(d.at.length ? {} : { at: true as const }), ...(past.length ? { past } : {}) };
  }
  return {
    ...(d.times.length ? {} : { times: true as const }), ...(d.days.length ? {} : { days: true as const }),
    ...(d.weeks === 2 && !/^\d{4}-\d{2}-\d{2}$/.test(d.anchor) ? { anchor: true as const } : {})
  };
}

/** A draft complete enough to ask the daemon for its next runs (the form's preview). */
export const previewable = (d: ScheduleDraft): boolean => {
  const e = scheduleErrors(d, new Date(0));
  return !e.times && !e.days && !e.anchor && !e.at;
};

/** One changed part of a schedule, before → asked (card 7): its label and both readings. */
export interface ScheduleChange { label: string; before: string; after: string }
export function scheduleChanges(a: RoutineSchedule, b: RoutineSchedule, lang: Lang, r: R): ScheduleChange[] {
  const f = r.form;
  const x = draftOf(a), y = draftOf(b);
  if (x.kind !== y.kind) return [{ label: f.kind, before: x.kind === 'once' ? f.once : f.recurring, after: y.kind === 'once' ? f.once : f.recurring }];
  const out: ScheduleChange[] = [];
  if (x.kind === 'once') {
    if (x.at.join() !== y.at.join()) out.push({ label: f.dates, before: x.at.map(m => momentLabel(m, lang)).join(', '), after: y.at.map(m => momentLabel(m, lang)).join(', ') });
    return out;
  }
  if (x.times.join() !== y.times.join()) out.push({ label: f.times, before: x.times.join(', '), after: y.times.join(', ') });
  if (x.days.join() !== y.days.join()) out.push({ label: f.days, before: daysLabel(x.days, r), after: daysLabel(y.days, r) });
  const freq = (d: ScheduleDraft) => (d.weeks === 2 ? `${f.biweekly} · ${d.anchor}` : f.weekly);
  if (freq(x) !== freq(y)) out.push({ label: f.frequency, before: freq(x), after: freq(y) });
  return out;
}

/** The prompt as it will be typed at `slot` (the form's « Aperçu, tir de … »): {slot} its time, {date} its day, {last} the
 *  previous run's slot, left as written when there is none. */
export function fillPrompt(prompt: string, slot: string, last: string | null): string {
  const d = new Date(slot);
  return prompt.replaceAll('{slot}', hhmm(d)).replaceAll('{date}', ymd(d)).replaceAll('{last}', last ?? '{last}');
}

/** This PC's zone, for the sidebar's foot (« Heures de ce PC · Europe/Brussels »). */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
