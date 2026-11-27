import type { FleetRoutine } from '@ledge/fleet';
import type { Routine, RoutineRun } from '@ledge/protocol';
import { askScheduleText, daysText, momentOnce } from '../../routine-text.js';
import type { Glyphs } from '../glyphs.js';
import type { Lang, Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cut, lineCells, pad, type Line, type Seg } from './cells.js';

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

/** Why a firing failed, in the screen's language where the daemon gives a cause without a field (its `reason` is French). */
export function runReason(run: Pick<RoutineRun, 'reason' | 'field' | 'cause'>, t: Messages): string {
  if (!run.field && run.cause === 'timeout') return t.routines.causes.timeout;
  return run.reason ?? t.routines.out.failed;
}

/** A routine's last firing failed: it says so in red, and `r` runs it again. */
export const failedLast = (r: Pick<Routine, 'lastRun'>): boolean => r.lastRun?.outcome === 'failed';

/**
 * The routines the screen lists, in its order: the recurring ones, then the one-shots (card 25); in each, those awaiting the
 * owner's approval, then those whose last firing failed, then by next firing, the paused ones last. A one-shot already fired
 * (`done`) is the PC's history, not listed here.
 */
export function routineOrder(routines: readonly FleetRoutine[], machines: readonly string[] = []): FleetRoutine[] {
  const rank = (r: Routine) => (r.state === 'pending' ? 0 : r.state === 'paused' ? 3 : failedLast(r) ? 1 : 2);
  const last = '\uffff';
  const by = (a: FleetRoutine, b: FleetRoutine) => rank(a) - rank(b) || (a.nextRun ?? last).localeCompare(b.nextRun ?? last) || a.name.localeCompare(b.name);
  const live = routines.filter(r => r.state !== 'done');
  // Machine by machine, in the fleet's order (card 27); one machine is one group.
  const ids = [...machines, ...live.map(r => r.machineId)].filter((id, i, all) => all.indexOf(id) === i);
  return ids.flatMap(id => {
    const mine = live.filter(r => r.machineId === id);
    return [...mine.filter(r => r.schedule.kind === 'recurring').sort(by), ...mine.filter(r => r.schedule.kind === 'once').sort(by)];
  });
}

/** A machine as the list's group title names it (card 27): its label, and whether its daemon is up. */
export interface RoutineMachine { id: string; label: string; up: boolean; /** Its daemon does not know routines. */ old?: boolean }

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

/** The days of a list line: French days alone keep their dot (« jeu. », « lun.,mer. »), a range stays « lun-ven »; English ones
 *  take a capital (« Thu », « Mon-Fri »). */
function listDays(days: Parameters<typeof daysText>[0], lang: Lang): string {
  const text = daysText(days, lang);
  if (lang === 'en') return text.replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g, d => d[0]!.toUpperCase() + d.slice(1));
  return text.split(',').map(p => (/^(lun|mar|mer|jeu|ven|sam|dim)$/.test(p) ? `${p}.` : p)).join(',');
}

/**
 * A routine's schedule as the TUI says it, the only code of the TUI that reads `schedule.times/days/every/at`: in the list
 * (`list`) « 08:00 13:30 16:30 · lun-ven », « jeu. 16:00 · 1 sem./2 », a one-shot « unique » or its moments (`dated`, when the
 * line's right side does not already give its date); in a request of « À toi » (`ask`) « 17:00 (ven) », « 16:00 (jeu, 1 sem. sur
 * 2) », a one-shot « jeu. 3 déc. 16:00 » (the owner's words of 2026-11-23, shared with « le point » through `askScheduleText`).
 */
export function whenText(r: Pick<Routine, 'schedule'>, mode: 'list' | 'ask', lang: Lang, t: Messages, o: { dated?: boolean } = {}): string {
  const s = r.schedule;
  if (mode === 'ask') return askScheduleText(s, lang);
  if (s.kind === 'once') return o.dated ? [...s.at].sort().map(a => momentOnce(a, lang)).join(', ') : t.routines.oneShot;
  const days = listDays(s.days, lang), times = [...s.times].sort();
  if (s.every?.weeks === 2) return `${days} ${times.join(' ')} · ${t.routines.every2}`;
  return `${times.join(' ')} · ${days}`;
}

/** A routine the owner has to answer on the Routines screen (#40, D4): a new one waiting (`pending`), or a session's change to it
 *  (`proposal`), paused or not. a activates it (the change), x refuses it. */
export const awaitsOwner = (r: Pick<Routine, 'state' | 'proposal'>): boolean => r.state === 'pending' || r.proposal !== undefined;

/** The right side of a routine's first line: what it waits for, its failure, its pause, or its next firing and last outcome. A
 *  change waiting says « attend votre accord » too, before its pause (design-ux, #40 D4). */
function stateSegs(r: Routine, now: number, lang: Lang, t: Messages, g: Glyphs): Line {
  const x = t.routines;
  if (awaitsOwner(r)) return [{ text: `${g.question} ${x.pending}`, color: C.yellow }];
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
  if (!quiet && r.lastRun) parts.push(failedLast(r) ? runReason(r.lastRun, t) : t.routines.out[r.lastRun.outcome]);
  return parts.join(' · ');
}

/**
 * The list's lines: per routine its name in bold and its state on the right, then a grey line below; the chosen one on the
 * selection's background with the coral bar on its left; a paused one dimmed; « UNIQUES » above the one-shots.
 */
export function routineLines(rows: readonly FleetRoutine[], o: { sel: number; width: number; now: number; lang: Lang; machines?: readonly RoutineMachine[] }, t: Messages, g: Glyphs): { lines: Line[]; selLine: number } {
  const lines: Line[] = [];
  let selLine = 0;
  // With several machines, each one's title, then its routines; one whose daemon is too old says so under its title.
  const groups = (o.machines?.length ?? 0) > 1 ? o.machines! : [];
  const title = (m: RoutineMachine) => {
    if (lines.length) lines.push([]);
    lines.push([{ text: ` ${m.label} `, color: C.coral, bold: true }, { text: m.up ? g.machine : '○', color: m.up ? C.green : C.faint }]);
    if (m.old) lines.push(cut([{ text: `   ${t.routines.oldDaemon}`, color: C.yellow }], o.width));
  };
  for (const m of groups) if (m.old && !rows.some(r => r.machineId === m.id)) title(m);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const newMachine = groups.length > 0 && prev?.machineId !== r.machineId;
    if (newMachine) { const m = groups.find(x => x.id === r.machineId); if (m) title(m); }
    if (r.schedule.kind === 'once' && (newMachine || prev?.schedule.kind !== 'once')) {
      if (i > 0 && !newMachine) lines.push([]);
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
    // Chosen, a session's change waiting says who asks it and what it asks (design-ux, #40 D4), in grey under it.
    if (on && r.proposal) lines.push(cut([{ text: `   ${t.routines.change(r.proposal.by.name, r.proposal.spec.name, whenText(r.proposal.spec, 'ask', o.lang, t))}`, color: C.dim }], o.width));
  });
  return { lines, selLine };
}
