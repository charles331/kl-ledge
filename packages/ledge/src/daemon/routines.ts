import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import {
  RoutineSchema, RoutineSpecSchema, ROUTINES_ACTIVE_MAX, ROUTINES_DONE_MAX, ROUTINE_NEXT_MAX, ROUTINE_REASON_MAX, ROUTINE_RUNS_MAX, TASK_TEXT_MAX, TASK_TITLE_MAX, WEEKDAYS, taskClosed,
  type ClientMessage, type Routine, type RoutineCause, type RoutineField, type RoutineRun, type RoutineSchedule, type RoutineSpec, type ServerMessage, type Session, type Tool, type Weekday
} from '@ledge/protocol';
import type { Store } from './store.js';
import type { Mailbox } from './mailbox.js';
import type { Tasks } from './tasks.js';
import { reachable, sessionNamed } from './mailbox.js';
import { formatLedgeRoutine } from './crossSession.js';
import { routineKey } from '../routineKey.js';
import { jsonJournal, type Journal } from './journal.js';
import { log } from '../log.js';

type RoutineCmd = Extract<ClientMessage, { type: 'routine.cmd' }>;
type RoutineResult = Extract<ServerMessage, { type: 'routine.result' }>;
type RoutineChanged = Extract<ServerMessage, { type: 'routine.changed' }>;
type RoutinePreviewed = Extract<ServerMessage, { type: 'routine.previewed' }>;
/** Why a routine cannot be kept, and the field it is about. */
interface Problem { reason: string; field?: RoutineField }

/** A firing typed into a live (or resumed) session, waiting for the mailbox to type it: `outcome` is what it becomes once typed. */
export interface RoutineWaiting { id: string; rid: string; slot: string; slotAt: string; at: string; late: boolean; outcome: 'delivered' | 'resumed'; session: string; manual?: true }
/** A firing decided and not yet typed or recorded (a folder checked, a session resumed or launched): written before the routine
 *  moves to its next slot, so a daemon stopped meanwhile reports it as failed instead of losing it. */
export interface RoutineStarting { id: string; slot: string; slotAt: string; at: string; late: boolean }
/** What `~/.ledge/routines.json` holds: the routines listed (the fired one-shots among them, `done`, for 30 days), the firings
 *  still to type, and the fired one-shots out of the list, kept for the record. */
export interface RoutinesState { routines: Routine[]; waiting: RoutineWaiting[]; starting?: RoutineStarting[]; archived?: Routine[] }
export type RoutinesJournal = Journal<RoutinesState>;

/** Who sends a command: the owner (a terminal outside Ledge's sessions, a screen, the phone), or a session, its key checked. */
export type RoutineCaller = { kind: 'user' } | { kind: 'session'; session: Session };

export interface RoutinesDeps {
  store: Pick<Store, 'get' | 'all'>;
  mailbox: Pick<Mailbox, 'notify' | 'waiting' | 'withdraw'>;
  tasks: Pick<Tasks, 'raise' | 'settle' | 'amend' | 'all'>;
  /** Starts a gone session again on its conversation (server `respawn`): null once spawned, the reason otherwise. */
  resume: (s: Session) => Promise<string | null>;
  /** Whether a gone session can be resumed: its conversation's key is known and it is not a seat. */
  resumable: (s: Session) => boolean;
  /** Launches a session as `session.launch` does, the prompt as its first instruction; throws the reason. */
  launch: (req: { tool: Tool; cwd: string; name: string; model?: string; prompt: string }) => Promise<Session>;
  /** Why a folder cannot hold a routine's session, or undefined when it can. */
  folder?: (cwd: string) => Promise<string | undefined>;
  journal?: RoutinesJournal;
  /** Every change of every routine, for the local fronts and the phone. */
  onChange?: (m: RoutineChanged) => void;
  home?: string;
  /** The machine's zone, for a routine that names none. */
  tz?: string;
  now?: () => number;
  /** How often the clock is checked against the slots (WSL sleeps with Windows: a timer alone is not trusted). */
  checkMs?: number;
  /** How long a firing may wait to be typed before it counts as failed. */
  deliverMs?: number;
  /** Past this after its slot, a firing is late (fired on wake or restart). */
  lateMs?: number;
  /** How long after start the first check waits, for the sessions to settle. */
  startMs?: number;
}
export interface Routines {
  run(cmd: RoutineCmd, caller: RoutineCaller): Promise<RoutineResult>;
  /** The next firings of a schedule not saved yet: the form's preview. */
  preview(rid: string, schedule: RoutineSchedule): RoutinePreviewed;
  /** The routines, newest first, the fired one-shots of the last 30 days among them, with their next firings. */
  all(): Routine[];
  /** The ids of the routines a session counts as its own (made by it, or waking it or the session it relieves). */
  ownedBy(sessionId: string): string[];
  /** The mailbox typed (or gave up on) Ledge's line of that rid. */
  noticeDone(rid: string, typed: boolean, reason?: string): void;
  /** Checks the clock now (tests; the timer does it otherwise). */
  tick(): void;
  close(): void;
}

export const CHECK_MS = 60_000;
export const DELIVER_MS = 30 * 60_000;
export const LATE_MS = 90_000;
/** How long a fired one-shot stays in the list (owner's decision, 2026-11-23), and how many are kept for the record past it. */
export const DONE_LISTED_MS = 30 * 24 * 3600_000;
const ARCHIVED_MAX = 500;
const START_MS = 5_000;
const WEEK_MS = 7 * 24 * 3600_000;

// ── Time: local wall-clock slots in an IANA zone ──

const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(tz, f);
  }
  return f;
}
/** Whether `tz` is a zone this machine knows. */
export function validZone(tz: string): boolean {
  try { formatFor(tz); return true; } catch { return false; }
}
export const machineZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }
function wallOf(ms: number, tz: string): Wall {
  const p = Object.fromEntries(formatFor(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second! };
}
/** How far the zone's wall clock is ahead of UTC at `ms`. */
const offsetAt = (ms: number, tz: string): number => {
  const w = wallOf(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
};
/** The instant a wall-clock time falls on in `tz`. A time skipped by a DST change lands just after the change; one met twice, on one of the two. */
function instantOf(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - offsetAt(wall, tz);
  const again = wall - offsetAt(t, tz);
  if (again !== t) t = again;
  return t;
}
const WEEKDAY_OF_UTC: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** The week a calendar day (as UTC midnight) falls in, counted in ISO weeks (Monday first) from a fixed Monday: two days are
 *  in weeks of the same parity when the difference is even, across a year's end (ISO week 53 included). */
const isoWeek = (dayUtc: number): number => {
  const monday = dayUtc - ((new Date(dayUtc).getUTCDay() + 6) % 7) * 864e5;
  return Math.round((monday - Date.UTC(1970, 0, 5)) / WEEK_MS);
};
const dayOf = (date: string): number => { const [y, m, d] = date.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
/** A one-shot's moment « YYYY-MM-DDTHH:MM » as an instant in `tz`. */
const momentOf = (a: string, tz: string): number => {
  const [date, time] = a.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  return instantOf(y, m, d, h, mi, tz);
};

/** A slot: its instant, its local « HH:MM ». */
export interface Slot { at: number; slot: string }
/** The slots of a schedule, in time order from the calendar day `from` to `to` around `ms` (ascending), or the reverse. */
function* slots(schedule: RoutineSchedule, ms: number, tz: string, from: number, to: number, step: 1 | -1): Generator<Slot> {
  if (schedule.kind === 'once') {
    const all = schedule.at.map(a => ({ at: momentOf(a, tz), slot: a.slice(11) })).sort((a, b) => a.at - b.at);
    yield* step > 0 ? all : all.reverse();
    return;
  }
  const today = wallOf(ms, tz);
  const times = [...schedule.times].sort();
  if (step < 0) times.reverse();
  const anchor = schedule.every?.weeks === 2 ? isoWeek(dayOf(schedule.every.anchor)) : undefined;
  for (let k = from; step > 0 ? k <= to : k >= to; k += step) {
    const day = Date.UTC(today.y, today.m - 1, today.d + k);
    const date = new Date(day);
    if (!schedule.days.includes(WEEKDAY_OF_UTC[date.getUTCDay()]!)) continue;
    if (anchor !== undefined && (isoWeek(day) - anchor) % 2 !== 0) continue;
    for (const slot of times) {
      const [h, mi] = slot.split(':').map(Number) as [number, number];
      yield { at: instantOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, mi, tz), slot };
    }
  }
}
/** The next `n` slots strictly after `after`. */
export function nextSlots(schedule: RoutineSchedule, after: number, tz: string, n = 1): Slot[] {
  const out: Slot[] = [];
  // Three firings of a two-week routine on one day a week span five weeks: 50 days always hold them.
  for (const s of slots(schedule, after, tz, -1, 50, 1)) { if (s.at > after) out.push(s); if (out.length >= n) break; }
  return out;
}
export const nextSlot = (schedule: RoutineSchedule, after: number, tz: string): Slot | undefined => nextSlots(schedule, after, tz, 1)[0];
/** The latest slot at or before `at` and after `since`: the one a late firing is for. */
export function latestSlot(schedule: RoutineSchedule, at: number, tz: string, since: number): Slot | undefined {
  for (const s of slots(schedule, at, tz, 1, -15, -1)) if (s.at <= at) return s.at > since ? s : undefined;
  return undefined;
}

// ── Words the owner reads ──

const DAY_WORDS: Record<Weekday, string> = { mon: 'lun', tue: 'mar', wed: 'mer', thu: 'jeu', fri: 'ven', sat: 'sam', sun: 'dim' };
/** « lun-ven », « lun, mer, ven », « tous les jours »: the days as « À toi » shows them. */
export function daysLabel(days: readonly Weekday[]): string {
  const idx = WEEKDAYS.map((d, i) => (days.includes(d) ? i : -1)).filter(i => i >= 0);
  if (idx.length === 7) return 'tous les jours';
  const runs: number[][] = [];
  for (const i of idx) { const last = runs.at(-1); if (last && last.at(-1) === i - 1) last.push(i); else runs.push([i]); }
  return runs.map(r => (r.length >= 3 ? `${DAY_WORDS[WEEKDAYS[r[0]!]!]}–${DAY_WORDS[WEEKDAYS[r.at(-1)!]!]}` : r.map(i => DAY_WORDS[WEEKDAYS[i]!]).join(', '))).join(', ');
}
const MOMENT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
/** A one-shot's moment as « À toi » words it (mockup cards 23, 25): « jeu. 3 déc. 16:00 », never ISO. */
export function momentLabel(a: string): string {
  const [y, m, d] = a.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${MOMENT.format(new Date(Date.UTC(y, m - 1, d)))} ${a.slice(11)}`;
}
/** When a schedule fires, as « À toi » words it (mockup card 13): « 08:00, 13:30 (lun–ven) », « 16:00 (jeu, 1 sem. sur 2) », « jeu. 3 déc. 16:00 ». */
export function scheduleLabel(s: RoutineSchedule): string {
  if (s.kind === 'once') return [...s.at].sort().map(momentLabel).join(', ');
  return `${s.times.join(', ')} (${daysLabel(s.days)}${s.every?.weeks === 2 ? ', 1 sem. sur 2' : ''})`;
}
const title = (s: string) => (s.length > TASK_TITLE_MAX ? `${s.slice(0, TASK_TITLE_MAX - 1)}…` : s);
const reasonOf = (s: string) => (s.length > ROUTINE_REASON_MAX ? `${s.slice(0, ROUTINE_REASON_MAX - 1)}…` : s);
const specOf = (r: Routine): RoutineSpec => {
  const { name, target, schedule, prompt, catchUp, expiresAfterRun } = r;
  return { name, target, schedule, prompt, catchUp, ...(expiresAfterRun ? { expiresAfterRun } : {}) };
};
/** The fields an owner approves: a session's change to any of them waits for « Activer ». */
const material = (a: RoutineSpec, b: RoutineSpec): boolean =>
  JSON.stringify([a.target, a.schedule, a.prompt]) !== JSON.stringify([b.target, b.schedule, b.prompt]);

// ── The store ──

const routinesIn = (xs: unknown): Routine[] =>
  (Array.isArray(xs) ? xs : []).flatMap(x => { const p = RoutineSchema.safeParse(x); return p.success ? [p.data] : []; });
function readState(raw: unknown): RoutinesState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<RoutinesState>;
  const waiting = Array.isArray(r.waiting) ? r.waiting.filter((w): w is RoutineWaiting => !!w && typeof w === 'object' && typeof (w as RoutineWaiting).rid === 'string') : [];
  const starting = Array.isArray(r.starting) ? r.starting.filter((w): w is RoutineStarting => !!w && typeof w === 'object' && typeof (w as RoutineStarting).id === 'string' && typeof (w as RoutineStarting).slotAt === 'string') : [];
  return { routines: routinesIn(r.routines), waiting, starting, archived: routinesIn(r.archived) };
}
export function routinesJournal(path: string): RoutinesJournal & { flush(): Promise<void> } {
  return jsonJournal<RoutinesState>(path, 'routines', readState);
}
/** The routines listed, as the daemon last wrote them, newest first: the one reader of `routines.json` outside the daemon. */
export function loadRoutines(path: string): Routine[] {
  return [...(routinesJournal(path).load()?.routines ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Routines (spec 2026-11-23-routines-design): one scheduler keeps a timer on the next due slot, checked against the wall
 * clock every minute, and fires each routine into its standing session: typed into it alive, after resuming it, or as the
 * first instruction of a new one. A failure is an « À toi » item, never silence; a session's routine, or its change to one,
 * waits for the owner's « Activer ».
 */
export function createRoutines(d: RoutinesDeps): Routines {
  const now = d.now ?? Date.now;
  const iso = (ms = now()) => new Date(ms).toISOString();
  const home = d.home ?? homedir();
  const defaultTz = d.tz ?? machineZone();
  const checkMs = d.checkMs ?? CHECK_MS, deliverMs = d.deliverMs ?? DELIVER_MS, lateMs = d.lateMs ?? LATE_MS;
  const folder = d.folder ?? (async (cwd: string) => {
    try { return (await stat(cwd)).isDirectory() ? undefined : `${cwd} n'est pas un dossier`; } catch { return `dossier introuvable : ${cwd}`; }
  });

  const loaded = d.journal?.load();
  const routines = new Map<string, Routine>((loaded?.routines ?? []).map(r => [r.id, r]));
  const waiting = new Map<string, RoutineWaiting>((loaded?.waiting ?? []).filter(w => routines.has(w.id)).map(w => [w.id, w]));
  const starting = new Map<string, RoutineStarting>((loaded?.starting ?? []).filter(w => routines.has(w.id)).map(w => [w.id, w]));
  let archived: Routine[] = loaded?.archived ?? [];
  /** Routines being fired (a resume or a launch in flight): a second firing meanwhile is dropped. */
  const firing = new Set<string>();

  const save = () => d.journal?.save({ routines: [...routines.values()], waiting: [...waiting.values()], starting: [...starting.values()], archived });
  /** A routine as it leaves the daemon: with its key (never kept). */
  const shownAs = (r: Routine): Routine => ({ ...r, key: routineKey(r) });
  const put = (r: Routine): Routine => { const { key: _k, ...kept } = r; routines.set(r.id, kept); save(); d.onChange?.({ type: 'routine.changed', routine: shownAs(kept) }); return kept; };
  const drop = (id: string) => {
    routines.delete(id);
    const w = waiting.get(id);
    if (w) { d.mailbox.withdraw(w.rid); waiting.delete(id); }
    save(); d.onChange?.({ type: 'routine.changed', removed: id });
  };
  const zone = (s: RoutineSchedule) => s.tz ?? defaultTz;
  /** The routine with its next firings, as of `from`: none unless it is enabled. */
  const scheduled = (r: Routine, from = now()): Routine => {
    const { nextRun: _n, nextRuns: _x, ...rest } = r;
    const next = r.state === 'enabled' ? nextSlots(r.schedule, from, zone(r.schedule), ROUTINE_NEXT_MAX) : [];
    return next.length ? { ...rest, nextRun: iso(next[0]!.at), nextRuns: next.map(s => iso(s.at)) } : rest;
  };
  const newId = (): string => { for (;;) { const id = `r${randomBytes(3).toString('hex')}`; if (!routines.has(id) && !archived.some(a => a.id === id)) return id; } };
  const absolute = (cwd: string): string => {
    const t = cwd.trim();
    const expanded = t === '~' ? home : t.startsWith('~/') ? `${home}${t.slice(1)}` : t;
    return isAbsolute(expanded) ? resolve(expanded) : resolve(home, expanded);
  };
  const shown = (cwd: string) => (cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd);
  const sameDir = (a: string, b: string) => resolve(a) === resolve(b);
  const active = () => [...routines.values()].filter(r => r.state !== 'done');
  /** Fired one-shots leave the list after 30 days, or past `ROUTINES_DONE_MAX`, the oldest first; they stay on record. */
  const keepDone = () => {
    const t = now();
    const done = [...routines.values()].filter(r => r.state === 'done').sort((a, b) => (b.lastRun?.at ?? b.createdAt).localeCompare(a.lastRun?.at ?? a.createdAt));
    const out = done.filter((r, i) => i >= ROUTINES_DONE_MAX || t - Date.parse(r.lastRun?.at ?? r.createdAt) > DONE_LISTED_MS);
    if (!out.length) return;
    archived = [...out, ...archived].slice(0, ARCHIVED_MAX);
    for (const r of out) { log(`routine ${r.name} (${r.id}): fired one-shot out of the list, kept on record`); drop(r.id); }
  };

  // ── « À toi » ──

  /** The open approval items covering a routine, and the open failure items of one. */
  const approvals = (id: string) => d.tasks.all().filter(t => t.routine?.kind === 'approve' && !taskClosed(t) && (t.routine.id === id || !!t.routine.ids?.includes(id)));
  const failures = (id: string) => d.tasks.all().filter(t => t.routine?.kind === 'failed' && t.routine.id === id && !taskClosed(t));
  const waitsForOwner = (id: string) => { const r = routines.get(id); return !!r && (r.state === 'pending' || !!r.proposal); };
  /** Closes the approval items that no longer cover a routine waiting for the owner. */
  const settleApprovals = (id: string, result: string) => {
    for (const t of approvals(id)) if (!(t.routine!.ids ?? [t.routine!.id]).some(waitsForOwner)) d.tasks.settle(t.id, result);
  };
  const settleFailures = (id: string, result: string) => { for (const t of failures(id)) d.tasks.settle(t.id, result); };
  /** Asks the owner about a routine (new, or its proposal). A new routine of a session whose new routines already wait joins that item. */
  const askOwner = (r: Routine) => {
    const spec = r.proposal?.spec ?? specOf(r);
    const asker = r.proposal?.by.name ?? (r.createdBy.kind === 'session' ? r.createdBy.name : 'Ledge');
    for (const t of approvals(r.id)) if (!t.routine!.ids) d.tasks.settle(t.id, 'remplacée par une nouvelle demande');
    const by = r.createdBy.kind === 'session' ? r.createdBy.id : undefined;
    // An open item of this session's one-shots: its members already answered (activated, or refused and gone) do not keep the
    // next one out, as long as one still waits; they leave the item when it is reworded.
    const ofSession = (o: Routine | undefined) => !!o && o.schedule.kind === 'once' && o.createdBy.kind === 'session' && o.createdBy.id === by;
    const joinable = (t: (ReturnType<Tasks['all']>)[number]) => {
      if (t.routine?.kind !== 'approve' || taskClosed(t)) return false;
      const ids = t.routine.ids ?? [t.routine.id];
      if (ids.includes(r.id)) return false;
      const members = ids.map(id => routines.get(id)).filter((o): o is Routine => !!o);
      return members.every(ofSession) && members.some(o => o.state === 'pending' && !o.proposal);
    };
    // Only one-shots group (spec §3.1.1: a session's meetings found in the calendar); a recurring routine is asked on its own.
    const group = !r.proposal && r.state === 'pending' && r.schedule.kind === 'once' && by ? d.tasks.all().find(joinable) : undefined;
    if (group) {
      // The item names the routines still waiting, the new one last: those answered leave it, so it never holds more than the
      // active routines can (ROUTINES_ACTIVE_MAX, the protocol's bound on `ids`).
      const ids = [...(group.routine!.ids ?? [group.routine!.id]).filter(id => waitsForOwner(id)), r.id];
      const all = ids.map(id => routines.get(id)!);
      // The title as the mockup words it; the routines follow one per line, name and moment, then their prompts.
      const text = [...all.map(o => `${o.name} (${scheduleLabel(o.schedule)})`), '', ...all.map(o => `« ${o.name} » : ${o.prompt}`)].join('\n');
      d.tasks.amend(group.id, { title: title(`${asker} veut programmer ${ids.length} routines uniques`),
        text: text.length > TASK_TEXT_MAX ? `${text.slice(0, TASK_TEXT_MAX - 1)}…` : text, routine: { kind: 'approve', id: ids[0]!, name: all[0]!.name, ids } });
      return;
    }
    // A session's change reads « veut modifier » (owner's decision, 2026-11-23); a new routine « veut programmer ».
    d.tasks.raise({ title: title(`${asker} veut ${r.proposal ? 'modifier' : 'programmer'} « ${spec.name} » : ${scheduleLabel(spec.schedule)}, dans ${shown(spec.target.cwd)}`), text: spec.prompt,
      routine: { kind: 'approve', id: r.id, name: spec.name } });
  };
  /** The session that asked (or its relief) is told the owner's answer. */
  const tellAsker = (r: Routine, who: { id: string; name: string } | undefined, answer: 'approved' | 'refused', change: boolean) => {
    if (!who) return;
    const to = sessionNamed(d.store, who.name)?.id ?? who.id;
    const text = answer === 'approved'
      ? `L'utilisateur a activé ${change ? 'ta modification de la routine' : 'ta routine'} « ${r.name} » : ${scheduleLabel(r.schedule)}.`
      : change ? `L'utilisateur a refusé ta modification de la routine « ${r.name} » : elle reste telle qu'elle était.`
        : `L'utilisateur a refusé ta routine « ${r.name} » : elle n'est pas programmée.`;
    d.mailbox.notify(to, formatLedgeRoutine({ name: r.name, answer, text }), `routine:${r.id}:${answer}:${now()}`);
  };

  // ── Firing ──

  /** A firing's outcome: kept among the last ones; a failure is an « À toi » item. A success closes the earlier failure, but
   *  for a one-shot only when it is the relaunch (`manual`): another moment that leaves does not make up for a missed one
   *  (spec §3.1.1). A one-shot whose last moment has left, with no failure open, is done. */
  const record = (id: string, run: RoutineRun, manual = false) => {
    const r = routines.get(id);
    if (!r) return;
    log(`routine ${r.name} (${r.target.name}) ${run.slot}${run.late ? ' late' : ''}: ${run.outcome}${run.reason ? ` (${run.reason})` : ''}`);
    const once = r.schedule.kind === 'once';
    const success = run.outcome !== 'failed';
    if (success && (!once || manual)) settleFailures(id, 'la routine est repartie');
    if (!success) settleFailures(id, 'remplacée par un nouvel échec');
    const runs = [run, ...(r.runs ?? [])].slice(0, ROUTINE_RUNS_MAX);
    const over = once && success && r.state === 'enabled' && !failures(id).length && !nextSlot(r.schedule, now(), zone(r.schedule));
    put(scheduled({ ...r, runs, lastRun: run, ...(over ? { state: 'done' as const } : {}) }));
    if (!success) d.tasks.raise({ title: title(`La routine ${r.name} (${r.target.name}) n’a pas pu partir : ${run.reason ?? ''}`), routine: { kind: 'failed', id, name: r.name, ...(run.reason ? { reason: run.reason } : {}) } });
    if (over) keepDone();
  };
  const fail = (id: string, s: { slot: string; slotAt: string }, at: string, late: boolean, reason: string, cause?: RoutineCause) =>
    record(id, { at, slot: s.slot, slotAt: s.slotAt, outcome: 'failed', reason: reasonOf(reason), ...(cause ? { cause } : {}), ...(late ? { late: true as const } : {}) });

  /** The prompt with its placeholders filled: {slot}, {date} (the firing's local day) and {last} (the previous firing's local time). */
  const expand = (r: Routine, slot: string, at: number): string => {
    const tz = zone(r.schedule); const w = wallOf(at, tz);
    const date = `${w.y}-${pad2(w.m)}-${pad2(w.d)}`;
    let last = 'aucun';
    if (r.lastRun) {
      const l = wallOf(Date.parse(r.lastRun.at), tz); const day = `${l.y}-${pad2(l.m)}-${pad2(l.d)}`;
      last = `${day === date ? '' : `${day} `}${pad2(l.h)}:${pad2(l.mi)}`;
    }
    return r.prompt.replaceAll('{slot}', slot).replaceAll('{date}', date).replaceAll('{last}', last);
  };

  /** The session a routine wakes: the live one of that name in that folder (or its relief), else the last one of that name there. */
  const findTarget = (r: Routine): { live?: Session; gone?: Session } => {
    const live = sessionNamed(d.store, r.target.name);
    if (live && live.state !== 'exited' && sameDir(live.cwd, r.target.cwd)) return { live };
    const mine = d.store.all().filter(s => s.name === r.target.name && sameDir(s.cwd, r.target.cwd) && s.source === 'launcher')
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    // A relieved session's conversation went on in its relief: the end of the chain is the one to resume.
    let gone = mine[0];
    for (let hops = 0; gone?.handover?.state === 'done' && hops < 50; hops++) { const to = gone.handover.to; const next = to ? d.store.get(to) : undefined; if (!next) break; gone = next; }
    return gone ? { gone } : {};
  };

  /** Writes a firing down before anything moves (the routine's next slot included); false when one is already under way. */
  const begin = (id: string, s: Slot, late: boolean): boolean => {
    if (firing.has(id)) { log(`routine ${routines.get(id)?.name ?? id}: a firing is already under way, ${s.slot} dropped`); return false; }
    firing.add(id);
    starting.set(id, { id, slot: s.slot, slotAt: iso(s.at), at: iso(), late });
    return true;
  };

  /** Fires a routine `begin` wrote down. */
  async function fire(id: string, s: Slot, late: boolean, manual = false): Promise<void> {
    const r = routines.get(id);
    const at = now(); const atIso = iso(at);
    const slot = { slot: s.slot, slotAt: iso(s.at) };
    const record_ = (run: RoutineRun) => record(id, run, manual);
    const fail = (sl: typeof slot, a: string, l: boolean, reason: string, field?: RoutineField, cause?: RoutineCause) =>
      record_({ at: a, slot: sl.slot, slotAt: sl.slotAt, outcome: 'failed', reason: reasonOf(reason), ...(field ? { field } : {}), ...(cause ? { cause } : {}), ...(l ? { late: true as const } : {}) });
    if (!r) { firing.delete(id); starting.delete(id); save(); return; }
    // The step under way, so an exception is told by what failed: none known before the session is resumed or launched.
    let step: RoutineCause | undefined;
    try {
      // Two firings never pile up: one still waiting to be typed gives way to this one.
      const before = waiting.get(id);
      if (before) { d.mailbox.withdraw(before.rid); waiting.delete(id); save(); log(`routine ${r.name}: the ${before.slot} firing, never typed, replaced by ${s.slot}`); }
      const text = formatLedgeRoutine({ name: r.name, slot: s.slot, late, text: expand(r, s.slot, at) });
      const why = await folder(r.target.cwd);
      if (why) return fail(slot, atIso, late, why, 'cwd');
      const { live, gone } = findTarget(r);
      const deliver = (target: Session, outcome: RoutineWaiting['outcome']) => {
        const rid = `routine:${id}:${at}`;
        if (!d.mailbox.notify(target.id, text, rid)) return fail(slot, atIso, late, `${target.name} ne peut pas recevoir de texte de Ledge`, 'session');
        waiting.set(id, { id, rid, ...slot, at: atIso, late, outcome, session: target.id, ...(manual ? { manual: true as const } : {}) }); save();
      };
      if (live) {
        if (!reachable(live)) return fail(slot, atIso, late, `${r.target.name} tourne hors de Ledge : impossible de lui écrire`, 'session_untracked');
        return deliver(live, 'delivered');
      }
      if (gone && d.resumable(gone)) {
        step = 'resume_failed';
        const refused = await d.resume(gone);
        step = undefined;
        if (refused) return fail(slot, atIso, late, `reprise impossible : ${refused}`, undefined, 'resume_failed');
        const back = d.store.get(gone.id);
        return back ? deliver(back, 'resumed') : fail(slot, atIso, late, 'la session reprise a disparu', undefined, 'gone');
      }
      step = 'launch_failed';
      const launched = await d.launch({ tool: r.target.tool, cwd: r.target.cwd, name: r.target.name, ...(r.target.model ? { model: r.target.model } : {}), prompt: text });
      log(`routine ${r.name}: launched ${launched.name} as ${launched.id}`);
      record_({ at: atIso, ...slot, outcome: 'launched', session: launched.id, ...(late ? { late: true as const } : {}) });
    } catch (e) {
      fail(slot, atIso, late, (e as Error).message, undefined, step);
    } finally { firing.delete(id); starting.delete(id); save(); }
  }

  function noticeDone(rid: string, typed: boolean, reason?: string): void {
    const w = [...waiting.values()].find(x => x.rid === rid);
    if (!w) return;
    waiting.delete(w.id); save();
    if (typed) record(w.id, { at: w.at, slot: w.slot, slotAt: w.slotAt, outcome: w.outcome, session: w.session, ...(w.late ? { late: true as const } : {}) }, !!w.manual);
    // `gone` only when the session is: a typing the terminal refused, the session still there, has no cause a front can word.
    else {
      const s = d.store.get(w.session);
      fail(w.id, w, w.at, w.late, reason ?? 'non remise', !s || s.state === 'exited' ? 'gone' : undefined);
    }
  }

  // ── The clock ──

  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const arm = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    const t = now();
    const next = Math.min(...[...routines.values()].filter(r => r.state === 'enabled' && r.nextRun).map(r => Date.parse(r.nextRun!)), t + checkMs);
    timer = setTimeout(tick, Math.max(0, Math.min(next - t, checkMs)));
    timer.unref?.();
  };
  function tick(): void {
    const t = now();
    for (const r of [...routines.values()]) {
      if (r.state !== 'enabled' || !r.nextRun || Date.parse(r.nextRun) > t) continue;
      const tz = zone(r.schedule);
      const due = latestSlot(r.schedule, t, tz, Date.parse(r.nextRun) - 1)
        ?? { at: Date.parse(r.nextRun), slot: (() => { const w = wallOf(Date.parse(r.nextRun!), tz); return `${pad2(w.h)}:${pad2(w.mi)}`; })() };
      const late = t - due.at > lateMs;
      // Missed slots (sleep, PC off, daemon down) fire once, for the latest; `skip` drops them. A firing is written down in
      // the same save that moves the routine to its next slot.
      const skip = late && r.catchUp === 'skip';
      const go = !skip && begin(r.id, due, late);
      put(scheduled(r, t));
      if (skip) { log(`routine ${r.name}: the ${due.slot} slot was missed, skipped`); continue; }
      if (go) void fire(r.id, due, late);
    }
    for (const w of [...waiting.values()]) {
      if (t - Date.parse(w.at) <= deliverMs) continue;
      d.mailbox.withdraw(w.rid); waiting.delete(w.id); save();
      fail(w.id, w, w.at, w.late, `pas remise dans les ${Math.round(deliverMs / 60_000)} minutes`, 'timeout');
    }
    keepDone();
    arm();
  }

  // What the last daemon left: a firing it had decided but not typed or recorded failed with it, never silently.
  for (const w of [...starting.values()]) {
    starting.delete(w.id);
    fail(w.id, w, w.at, w.late, 'interrompue par un redémarrage de Ledge', 'restart');
  }
  // A firing whose line is no longer in the mailbox was lost with it.
  for (const w of [...waiting.values()]) {
    if (d.mailbox.waiting(w.rid)) continue;
    waiting.delete(w.id);
    fail(w.id, w, w.at, w.late, 'perdue au redémarrage de Ledge', 'restart');
  }
  // A routine without its next firing (new, or written by hand) gets one now; one past due fires at the first check.
  for (const r of [...routines.values()]) if (r.state === 'enabled' && !r.nextRun) routines.set(r.id, scheduled(r));
  save();
  timer = setTimeout(tick, d.startMs ?? START_MS);
  timer.unref?.();

  // ── Commands ──

  const ownedBy = (r: Routine, s: Session) =>
    (r.createdBy.kind === 'session' && r.createdBy.id === s.id) || sessionNamed(d.store, r.target.name)?.id === s.id;

  /** Why a schedule cannot be kept, or undefined: an unknown zone; for a new one-shot, a moment already past. */
  const scheduleProblem = (s: RoutineSchedule, fresh: boolean): Problem | undefined => {
    if (s.tz !== undefined && !validZone(s.tz)) return { reason: `fuseau horaire inconnu : ${s.tz}`, field: 'tz' };
    if (fresh && s.kind === 'once') {
      const past = s.at.filter(a => momentOf(a, zone(s)) <= now());
      if (past.length) return { reason: `moment déjà passé : ${past.map(a => a.replace('T', ' ')).join(', ')}`, field: 'at' };
    }
    return undefined;
  };

  function preview(rid: string, schedule: RoutineSchedule): RoutinePreviewed {
    const problem = scheduleProblem(schedule, false);
    if (problem) return { type: 'routine.previewed', rid, nextRuns: [], ...problem };
    return { type: 'routine.previewed', rid, nextRuns: nextSlots(schedule, now(), zone(schedule), ROUTINE_NEXT_MAX).map(s => iso(s.at)) };
  }

  async function run(cmd: RoutineCmd, caller: RoutineCaller): Promise<RoutineResult> {
    const refuse = (code: RoutineResult['code'], reason: string, field?: RoutineField): RoutineResult => ({ type: 'routine.result', rid: cmd.rid, code, reason, ...(field ? { field } : {}) });
    const refused = (p: Problem): RoutineResult => refuse('invalid', p.reason, p.field);
    const ok = (routine: Routine): RoutineResult => ({ type: 'routine.result', rid: cmd.rid, routine: shownAs(routine) });
    const removed = (id: string): RoutineResult => ({ type: 'routine.result', rid: cmd.rid, removed: id });
    const session = caller.kind === 'session' ? caller.session : undefined;

    /** A spec as the daemon keeps it: the folder absolute and there, the zone known, a new one-shot's moments ahead, a one-shot marked as such. */
    const checked = async (spec: RoutineSpec, fresh: boolean): Promise<RoutineSpec | Problem> => {
      const problem = scheduleProblem(spec.schedule, fresh);
      if (problem) return problem;
      const cwd = absolute(spec.target.cwd);
      const why = await folder(cwd);
      if (why) return { reason: why, field: 'cwd' };
      const { expiresAfterRun: _e, ...rest } = spec;
      return { ...rest, target: { ...spec.target, cwd }, ...(spec.schedule.kind === 'once' ? { expiresAfterRun: true as const } : {}) };
    };
    const taken = (spec: RoutineSpec, except?: string) =>
      active().some(r => r.id !== except && r.target.name.toLowerCase() === spec.target.name.toLowerCase() && r.name.toLowerCase() === spec.name.toLowerCase());

    if (cmd.op === 'add') {
      if (!cmd.spec) return refuse('invalid', 'il faut la routine à ajouter');
      if (active().length >= ROUTINES_ACTIVE_MAX) return refuse('invalid', `${ROUTINES_ACTIVE_MAX} routines actives au plus`);
      const spec = await checked(cmd.spec, true);
      if ('reason' in spec) return refused(spec);
      // Others may have been added while the folder was checked.
      if (active().length >= ROUTINES_ACTIVE_MAX) return refuse('invalid', `${ROUTINES_ACTIVE_MAX} routines actives au plus`);
      if (taken(spec)) return refuse('name_taken', `${spec.target.name} a déjà une routine « ${spec.name} »`, 'name');
      const r = put(scheduled({ ...spec, id: newId(), catchUp: spec.catchUp ?? 'once', state: session ? 'pending' : 'enabled',
        createdBy: session ? { kind: 'session', id: session.id, name: session.name } : { kind: 'user' }, createdAt: iso() }));
      if (session) askOwner(r);
      arm();
      return ok(r);
    }

    if (!cmd.routine) return refuse('invalid', "il faut l'id ou le nom de la routine");
    const named = [...routines.values()].filter(r => r.id === cmd.routine || r.name.toLowerCase() === cmd.routine!.toLowerCase());
    // A name means an active routine before a fired one-shot of the same name; a session's, its own first.
    const live = named.filter(r => r.id === cmd.routine || r.state !== 'done');
    const candidates = live.length ? live : named;
    const mine = session ? candidates.filter(r => ownedBy(r, session)) : [];
    const pool = mine.length ? mine : candidates;
    if (!pool.length) return refuse('not_found', `aucune routine ${cmd.routine}`);
    if (pool.length > 1) return refuse('invalid', `plusieurs routines nommées ${cmd.routine} : donne son id (${pool.map(r => r.id).join(', ')})`);
    const r = pool[0]!;
    if (session && !ownedBy(r, session)) return refuse('forbidden', `la routine ${r.name} n'est pas à toi`);
    if (r.state === 'done' && cmd.op !== 'rm') return refuse('invalid', `la routine ${r.name} est passée : programme-la à nouveau`);

    switch (cmd.op) {
      case 'update': {
        if (!cmd.patch || !Object.keys(cmd.patch).length) return refuse('invalid', 'rien à changer');
        const merged = RoutineSpecSchema.safeParse({ ...specOf(r), ...cmd.patch });
        if (!merged.success) return refuse('invalid', 'routine invalide');
        const what = material(merged.data, specOf(r));
        const next = await checked(merged.data, what);
        if ('reason' in next) return refused(next);
        // Changed while its folder was checked (an approval, another change): this change was made on what is no longer there.
        if (routines.get(r.id) !== r) return refuse('stale', `la routine ${r.name} a changé pendant la modification`);
        if (taken(next, r.id)) return refuse('name_taken', `${next.target.name} a déjà une routine « ${next.name} »`, 'name');
        // A session's change to what runs, when or where: the routine keeps firing as it is until the owner answers (spec §3.4).
        if (session && what && r.state !== 'pending') {
          const proposed = put({ ...r, proposal: { spec: next, by: { id: session.id, name: session.name }, at: iso() } });
          askOwner(proposed);
          return ok(proposed);
        }
        const updated = put(scheduled({ ...r, ...next, catchUp: next.catchUp ?? r.catchUp }));
        // A request still waiting is asked again as it now reads.
        if (updated.state === 'pending' && what) askOwner(updated);
        arm();
        return ok(updated);
      }
      case 'pause':
        if (r.state === 'pending') return refuse('not_pending', `la routine ${r.name} attend encore l'accord de l'utilisateur`);
        return ok(r.state === 'paused' ? r : put(scheduled({ ...r, state: 'paused' })));
      case 'resume': {
        if (r.state === 'pending') return refuse('forbidden', `la routine ${r.name} attend encore l'accord de l'utilisateur`);
        // Slots missed while paused are not fired: the next one is from now.
        const resumed = r.state === 'enabled' ? r : put(scheduled({ ...r, state: 'enabled' }));
        arm();
        return ok(resumed);
      }
      case 'run': {
        if (r.state === 'pending') return refuse('forbidden', `la routine ${r.name} attend encore l'accord de l'utilisateur`);
        const t = now(); const w = wallOf(t, zone(r.schedule));
        const slot = { at: t, slot: `${pad2(w.h)}:${pad2(w.mi)}` };
        if (begin(r.id, slot, false)) { save(); void fire(r.id, slot, false, true); }
        return ok(r);
      }
      case 'rm': {
        // Of a fired one-shot: « Retirer de l'historique ».
        drop(r.id);
        settleApprovals(r.id, 'routine supprimée'); settleFailures(r.id, 'routine supprimée');
        arm();
        return removed(r.id);
      }
      case 'approve':
      case 'refuse': {
        if (session) return refuse('forbidden', "seul l'utilisateur active ou refuse une routine");
        if (r.state !== 'pending' && !r.proposal) return refuse('not_pending', `la routine ${r.name} n'attend pas de réponse`);
        if (cmd.expect !== undefined && cmd.expect !== routineKey(r)) return refuse('stale', `la routine ${r.name} a changé depuis qu'elle a été montrée`);
        const change = !!r.proposal;
        const asker = r.proposal?.by ?? (r.createdBy.kind === 'session' ? { id: r.createdBy.id, name: r.createdBy.name } : undefined);
        if (cmd.op === 'refuse') {
          if (change) {
            const { proposal: _p, ...kept } = r;
            const same = put(kept);
            settleApprovals(r.id, 'refusée'); tellAsker(same, asker, 'refused', true);
            return ok(same);
          }
          drop(r.id);
          settleApprovals(r.id, 'refusée'); tellAsker(r, asker, 'refused', false);
          return removed(r.id);
        }
        // « Activer » saves the request, or the owner's correction of it.
        const spec = await checked(cmd.spec ?? r.proposal?.spec ?? specOf(r), true);
        if ('reason' in spec) return refused(spec);
        // Changed while its folder was checked: what was shown is no longer what would be saved.
        if (routines.get(r.id) !== r) return refuse('stale', `la routine ${r.name} a changé pendant l'activation`);
        if (taken(spec, r.id)) return refuse('name_taken', `${spec.target.name} a déjà une routine « ${spec.name} »`, 'name');
        const { proposal: _p, expiresAfterRun: _e, ...base } = r;
        const approved = put(scheduled({ ...base, ...spec, catchUp: spec.catchUp ?? r.catchUp, state: r.state === 'pending' ? 'enabled' : r.state }));
        settleApprovals(r.id, 'activée'); tellAsker(approved, asker, 'approved', change);
        arm();
        return ok(approved);
      }
    }
    return refuse('invalid', 'opération inconnue');
  }

  return {
    run, preview, noticeDone, tick,
    ownedBy: id => { const s = d.store.get(id); return s ? [...routines.values()].filter(r => ownedBy(r, s)).map(r => r.id) : []; },
    all: () => [...routines.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(shownAs),
    close: () => { closed = true; if (timer) clearTimeout(timer); }
  };
}
