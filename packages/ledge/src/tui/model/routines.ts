import type { FleetRoutine } from '@ledge/fleet';
import type { Routine, Task } from '@ledge/protocol';
import { daysText } from '../../routine-text.js';
import type { Glyphs } from '../glyphs.js';
import type { Lang, Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cut, lineCells, pad, type Line, type Seg } from './cells.js';
import { tilde } from './roles.js';

/*
 * The Routines screen's model (docs/mockups/ledge-routines.html, cards 18 and 25): the list as the TUI orders it, each routine in two
 * lines, and the two « À toi » items of a routine. Pure: the screen gives it the routines, the time and the width.
 */

/** The column the state starts at, after the routine's name (the mockup's 22 cells). */
const NAME_W = 22;
const DAY_MS = 24 * 3600_000;
const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayStart = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** A routine's last firing failed: it says so in red, and `r` runs it again. */
export const failedLast = (r: Pick<Routine, 'lastRun'>): boolean => r.lastRun?.outcome === 'failed';

/**
 * The routines the screen lists, in its order: the recurring ones, then the one-shots (card 25); in each, those awaiting the
 * owner's approval, then those whose last firing failed, then by next firing, the paused ones last. A one-shot already fired
 * (`done`) is the PC's history, not listed here.
 */
export function routineOrder(routines: readonly FleetRoutine[]): FleetRoutine[] {
  const rank = (r: Routine) => (r.state === 'pending' ? 0 : r.state === 'paused' ? 3 : failedLast(r) ? 1 : 2);
  const by = (a: FleetRoutine, b: FleetRoutine) => rank(a) - rank(b) || (a.nextRun ?? '￿').localeCompare(b.nextRun ?? '￿') || a.name.localeCompare(b.name);
  const live = routines.filter(r => r.state !== 'done');
  return [...live.filter(r => r.schedule.kind === 'recurring').sort(by), ...live.filter(r => r.schedule.kind === 'once').sort(by)];
}

/** A moment as the list names it: « 13:30 » today, « demain 09:00 », « jeu. 26 16:00 » within the week, else « 4 déc. 09:00 ». */
export function momentText(iso: string, now: number, lang: Lang, t: Messages, o: { today?: 'bare' | 'next' } = {}): string {
  const at = new Date(iso), days = Math.round((dayStart(at.getTime()) - dayStart(now)) / DAY_MS), h = hhmm(at);
  if (days === 0) return o.today === 'next' ? t.routines.next(h) : h;
  if (days === 1) return t.routines.tomorrow(h);
  const date = days > 1 && days < 7
    ? new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric' }).format(at)
    : new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(at);
  return `${date} ${h}`;
}

/** A one-shot's moment written whole (« jeu. 3 déc. 16:00 »): its `at` is a local date-time without a zone. */
const onceText = (at: string, lang: Lang): string => {
  const [date, time] = at.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  return `${new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y!, m! - 1, d!))} ${time}`;
};

/**
 * A routine's schedule as the TUI says it, the only code of the TUI that reads `schedule.times/days/every/at`: in the list
 * (`list`) « 08:00 13:30 16:30 · lun-ven », « jeu 16:00 · 1 sem./2 », a one-shot « unique » or its moments (`dated`, when the
 * line's right side does not already give its date); in a request of « À toi » (`ask`) « 17:00 (ven) », as Desktop says it.
 */
export function whenText(r: Pick<Routine, 'schedule'>, mode: 'list' | 'ask', lang: Lang, t: Messages, o: { dated?: boolean } = {}): string {
  const s = r.schedule;
  if (s.kind === 'once') {
    const moments = [...s.at].sort().map(a => onceText(a, lang)).join(', ');
    return mode === 'ask' || o.dated ? moments : t.routines.oneShot;
  }
  const times = [...s.times].sort(), days = daysText(s.days, lang);
  if (mode === 'ask') return `${times.join(', ')} (${days})`;
  if (s.every?.weeks === 2) return `${days} ${times.join(' ')} · ${t.routines.every2}`;
  return `${times.join(' ')} · ${days}`;
}

/** The right side of a routine's first line: what it waits for, its failure, its pause, or its next firing and last outcome. */
function stateSegs(r: Routine, now: number, lang: Lang, t: Messages, g: Glyphs): Line {
  const x = t.routines;
  if (r.state === 'pending') return [{ text: `${g.question} ${x.pending}`, color: C.yellow }];
  if (r.state === 'paused') return [{ text: `‖ ${x.paused}`, color: C.dim }];
  if (failedLast(r)) return [{ text: `! ${r.lastRun!.slot} ${x.out.failed}`, color: C.red }];
  const out: Line = [];
  if (r.nextRun) out.push({ text: `${g.working} `, color: C.green }, { text: momentText(r.nextRun, now, lang, t, { today: r.schedule.kind === 'recurring' ? 'next' : 'bare' }), color: C.fg });
  if (r.lastRun) {
    out.push(...(out.length ? [pad(2)] : []), { text: `${g.ok} `, color: C.green }, { text: r.lastRun.slot, color: C.fg });
    if (r.lastRun.late) out.push({ text: ` ${x.late}`, color: C.yellow });
  }
  return out;
}

/** The second line: the session it wakes, its schedule, and how its last firing went (with a failure's reason). */
function subText(r: Routine, lang: Lang, t: Messages): string {
  const quiet = r.state === 'pending' || r.state === 'paused';
  const dated = r.schedule.kind === 'once' && (quiet || failedLast(r) || !r.nextRun);
  const parts = [r.target.name, whenText(r, 'list', lang, t, { dated })];
  if (!quiet && r.lastRun) parts.push(failedLast(r) ? r.lastRun.reason ?? t.routines.out.failed : t.routines.out[r.lastRun.outcome]);
  return parts.join(' · ');
}

/**
 * The list's lines: per routine its name in bold and its state on the right, then a grey line below; the chosen one on the
 * selection's background with the coral bar on its left; a paused one dimmed; « UNIQUES » above the one-shots.
 */
export function routineLines(rows: readonly Routine[], o: { sel: number; width: number; now: number; lang: Lang }, t: Messages, g: Glyphs): { lines: Line[]; selLine: number } {
  const lines: Line[] = [];
  let selLine = 0;
  rows.forEach((r, i) => {
    if (r.schedule.kind === 'once' && rows[i - 1]?.schedule.kind !== 'once') {
      if (i > 0) lines.push([]);
      lines.push([{ text: ` ${t.routines.groupOnce}`, color: C.dim }]);
    }
    const on = i === o.sel, dim = r.state === 'paused';
    const right = stateSegs(r, o.now, o.lang, t, g);
    const name = cut([{ text: r.name, color: dim ? C.dim : C.fg, bold: true }], NAME_W - 1);
    const head: Line = [{ text: on ? '▌' : ' ', color: C.coral }, ...name, pad(NAME_W - lineCells(name)), ...right];
    const first = cut(head, o.width);
    if (on) selLine = lines.length;
    lines.push(on ? [...first, pad(o.width - lineCells(first))].map((s: Seg) => ({ ...s, bg: C.sel })) : first);
    lines.push(cut([{ text: `   ${subText(r, o.lang, t)}`, color: C.dim }], o.width));
  });
  return { lines, selLine };
}

/** A routine's « À toi » item in the overview: what it says, and its mark (? a request, ! a failure). */
export interface RoutineItem { id: string; mark: 'ask' | 'fail'; text: string }

/**
 * The open items of « À toi » a routine made (an activation request, a failure), in words the TUI writes from the routine
 * itself; the daemon's own title when the routine is not listed (another machine's, or not read yet).
 */
export function routineItems(tasks: readonly Task[], routines: readonly Routine[], lang: Lang, t: Messages): RoutineItem[] {
  return tasks.flatMap((task): RoutineItem[] => {
    const rt = task.routine;
    if (!rt) return [];
    const r = routines.find(x => x.id === rt.id);
    if (rt.kind === 'failed') return [{ id: task.id, mark: 'fail' as const, text: r ? t.routines.failed(rt.name, r.target.name, rt.reason ?? t.routines.out.failed) : task.title }];
    const who = r?.proposal?.by.name ?? (r?.createdBy.kind === 'session' ? r.createdBy.name : r?.target.name);
    let text = task.title;
    if (r && who && rt.ids) {
      const all = rt.ids.map(id => routines.find(x => x.id === id));
      if (all.every(x => x?.schedule.kind === 'once')) text = t.routines.groupAsk(who, rt.ids.length);
    } else if (r && who && r.state === 'pending' && !r.proposal) text = t.routines.ask(who, r.name, whenText(r, 'ask', lang, t), tilde(r.target.cwd));
    return [{ id: task.id, mark: 'ask' as const, text }];
  });
}
