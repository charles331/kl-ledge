import { isArchived, openDecision, RoutineNameSchema, type Routine, type RoutineField, type RoutineRun, type RoutineSpec, type Session, type Task, type Tool } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet';
import type { Lang, Messages } from '../i18n/messages';
import { draftOf, scheduleChanges, scheduleErrors, scheduleOf, type ScheduleChange, type ScheduleDraft } from './schedule';

/**
 * The Routines screens' rules (docs/mockups/ledge-routines.html, « Fiche de transmission »), pure: a routine's tab ref, its
 * sidebar groups and order, the badge, the session it wakes, the « À toi » items, the form's draft and what it changes.
 */

type R = Messages['routines'];

/** A routine's tab: `machine:id` (machine ids carry no `:`); « Nouvelle routine » has its own. */
export const NEW_ROUTINE_REF = 'new';
export const routineRef = (r: { machineId: string; id: string }): string => `${r.machineId}:${r.id}`;
export function parseRoutineRef(ref: string): { machine: string; id: string } | null {
  const i = ref.indexOf(':');
  return i < 0 ? null : { machine: ref.slice(0, i), id: ref.slice(i + 1) };
}
export const findRoutine = (rs: readonly FleetRoutine[], ref: string): FleetRoutine | undefined => {
  const p = parseRoutineRef(ref);
  return p ? rs.find(r => r.machineId === p.machine && r.id === p.id) : undefined;
};

/** A routine's last firing: `runs` newest first, else the older `lastRun`. */
export const lastRunOf = (r: Routine): RoutineRun | undefined => r.runs?.[0] ?? r.lastRun;
export const failedLast = (r: Routine): boolean => lastRunOf(r)?.outcome === 'failed';
/** Waits for the owner's « Activer » / « Refuser »: a session's request, or its change to a routine (`proposal`). */
export const waitsForOwner = (r: Routine): boolean => r.state === 'pending' || !!r.proposal;
/** The activity bar's red badge (card 1): the routines to activate and those whose last run failed. */
export const routinesBadge = (rs: readonly Routine[]): number => rs.filter(r => r.state !== 'done' && (waitsForOwner(r) || failedLast(r))).length;

/** Past one-shots stay in the list this many days after their last run (owner's decision, card 21); the journal keeps them. */
export const PAST_KEEP_DAYS = 30;

/** Several routines a session asked for while its request waited: one « À toi » item (`TaskRoutine.ids`, card 23). */
export interface Proposal { task: Task; who: string; ids: readonly string[] }
/** The machine the tasks come from: the fleet keeps the LOCAL daemon's tasks only, and a routine id is unique per machine, so a
 *  task's `routine.id` / `ids` name that machine's routines, never another's with the same id. */
export const TASKS_MACHINE = 'local';
/** The open « À toi » items of the routines (tasks given to Ledge that carry `routine`), oldest first. */
export const routineTasks = (tasks: readonly Task[]): Task[] => tasks.filter(t => !!t.routine && openDecision(t));
export const proposalsOf = (tasks: readonly Task[]): Proposal[] =>
  routineTasks(tasks).filter(t => t.routine!.kind === 'approve' && (t.routine!.ids?.length ?? 0) > 1).map(t => ({ task: t, who: t.giverName, ids: t.routine!.ids! }));

export type GroupKey = 'recurring' | 'once' | 'paused' | 'past';
export type SideRow = { kind: 'routine'; r: FleetRoutine; of?: { i: number; n: number } } | { kind: 'proposed'; who: string; n: number; key: string };
export interface SideGroup { key: GroupKey; count: number; rows: SideRow[] }

const rank = (r: Routine): number => (waitsForOwner(r) ? 0 : failedLast(r) ? 1 : 2);
const nextAt = (r: Routine): number => { const n = r.nextRuns?.[0] ?? r.nextRun; return n ? Date.parse(n) : Infinity; };
/** Card 2's order: to activate, failed, then by next run (the daemon's), then by name. */
export function byAttention(a: Routine, b: Routine): number {
  return rank(a) - rank(b) || nextAt(a) - nextAt(b) || a.name.localeCompare(b.name);
}
const lastAt = (r: Routine): number => { const l = lastRunOf(r); return Date.parse(l?.at ?? r.createdAt); };

/** The sidebar's groups (cards 2, 21): Récurrentes, Uniques, En pause, Passées (the one-shots gone, kept PAST_KEEP_DAYS). Empty
 *  groups are left out. In Uniques, the ones a session proposed together follow a thin line, « 1 sur 3 »… */
export function sideGroups(rs: readonly FleetRoutine[], proposals: readonly Proposal[], now: number): SideGroup[] {
  const past = rs.filter(r => r.state === 'done' && now - lastAt(r) <= PAST_KEEP_DAYS * 86_400_000).sort((a, b) => lastAt(b) - lastAt(a));
  const live = rs.filter(r => r.state !== 'done');
  const paused = live.filter(r => r.state === 'paused').sort(byAttention);
  const active = live.filter(r => r.state !== 'paused').sort(byAttention);
  const recurring = active.filter(r => r.schedule.kind === 'recurring');
  const once = active.filter(r => r.schedule.kind === 'once');
  const onceRows: SideRow[] = [];
  const placed = new Set<string>();
  for (const r of once) {
    // Keyed by machine and id: two machines may hold the same id.
    if (placed.has(routineRef(r))) continue;
    const p = r.machineId === TASKS_MACHINE ? proposals.find(x => x.ids.includes(r.id)) : undefined;
    const members = p ? p.ids.map(id => once.find(x => x.id === id && x.machineId === r.machineId)).filter((x): x is FleetRoutine => !!x && x.state === 'pending') : [];
    if (p && members.length > 1) {
      onceRows.push({ kind: 'proposed', who: p.who, n: p.ids.length, key: p.task.id });
      members.forEach(m => { placed.add(routineRef(m)); onceRows.push({ kind: 'routine', r: m, of: { i: p.ids.indexOf(m.id) + 1, n: p.ids.length } }); });
    } else { placed.add(routineRef(r)); onceRows.push({ kind: 'routine', r }); }
  }
  const row = (r: FleetRoutine): SideRow => ({ kind: 'routine', r });
  const groups: SideGroup[] = [
    { key: 'recurring', count: recurring.length, rows: recurring.map(row) },
    { key: 'once', count: once.length, rows: onceRows },
    { key: 'paused', count: paused.length, rows: paused.map(row) },
    { key: 'past', count: past.length, rows: past.map(row) }
  ];
  return groups.filter(g => g.count > 0);
}

/** `~/x` against a machine's home, so `~/assistant` and `/home/jde/assistant` name the same folder. */
export function expandHome(path: string, home?: string): string {
  const p = home && (path === '~' || path.startsWith('~/')) ? home + path.slice(1) : path;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}
/** A folder as the screens show it: under the machine's home, from `~`. */
export function homeLabel(path: string, home?: string): string {
  const p = expandHome(path, home);
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

/** The session a routine wakes (spec §3.2, step 1): its machine's, same name, same folder; a live one before an archived one. */
export function sessionOfRoutine(r: FleetRoutine, sessions: readonly Session[], home?: string): Session | undefined {
  const dir = expandHome(r.target.cwd, home);
  const same = sessions.filter(s => (s.machineId ?? 'local') === r.machineId && s.name === r.target.name && expandHome(s.cwd, home) === dir);
  return same.find(s => !isArchived(s) && !s.offline) ?? same.find(s => !isArchived(s)) ?? same[0];
}

/** The routines that wake a session, not past (the explorer's clock, card 12), the next to fire first. */
export function routinesOfSession(s: Session, rs: readonly FleetRoutine[], home?: string): FleetRoutine[] {
  const dir = expandHome(s.cwd, home);
  return rs.filter(r => r.state !== 'done' && r.machineId === (s.machineId ?? 'local') && r.target.name === s.name && expandHome(r.target.cwd, home) === dir)
    .sort((a, b) => nextAt(a) - nextAt(b));
}

/** A routine's « À toi » item (cards 13, 14, 23): the task, and the routines it covers that still wait (approve) or the failed one. */
export interface AtoiRoutineItem { task: Task; kind: 'approve' | 'failed'; routines: FleetRoutine[] }
export function atoiRoutineItems(tasks: readonly Task[], all: readonly FleetRoutine[], machine: string = TASKS_MACHINE): AtoiRoutineItem[] {
  const out: AtoiRoutineItem[] = [];
  const rs = all.filter(r => r.machineId === machine);
  for (const task of routineTasks(tasks)) {
    const tr = task.routine!;
    const ids = tr.ids ?? [tr.id];
    const found = ids.map(id => rs.find(r => r.id === id)).filter((r): r is FleetRoutine => !!r);
    if (tr.kind === 'approve') {
      const waiting = found.filter(waitsForOwner);
      if (waiting.length) out.push({ task, kind: 'approve', routines: waiting });
    } else if (found.length) out.push({ task, kind: 'failed', routines: found.slice(0, 1) });
  }
  return out;
}

/** What the form edits (cards 3-5, 19): the spec, its schedule as a draft, the target's mode. */
export interface SpecDraft {
  name: string; mode: 'existing' | 'new'; target: { name: string; cwd: string; tool: Tool; model: string };
  schedule: ScheduleDraft; catchUp: 'once' | 'skip'; prompt: string;
}
export function specDraft(spec?: RoutineSpec, mode: SpecDraft['mode'] = 'existing'): SpecDraft {
  return {
    name: spec?.name ?? '', mode,
    target: { name: spec?.target.name ?? '', cwd: spec?.target.cwd ?? '', tool: spec?.target.tool ?? 'claude', model: spec?.target.model ?? '' },
    schedule: draftOf(spec?.schedule), catchUp: spec?.catchUp ?? 'once', prompt: spec?.prompt ?? ''
  };
}
export function specOf(d: SpecDraft): RoutineSpec {
  const { model, ...target } = d.target;
  return { name: d.name.trim(), target: { ...target, ...(model.trim() ? { model: model.trim() } : {}) }, schedule: scheduleOf(d.schedule), prompt: d.prompt, catchUp: d.catchUp };
}
/** The fields the draft changes from `saved`, as an `update`'s patch: none when nothing changed. */
export function specPatch(saved: RoutineSpec, d: SpecDraft): Partial<RoutineSpec> {
  const next = specOf(d);
  const was = specOf(specDraft(saved));
  const out: Partial<RoutineSpec> = {};
  for (const k of ['name', 'target', 'schedule', 'prompt', 'catchUp'] as const) if (JSON.stringify(next[k]) !== JSON.stringify(was[k])) (out as Record<string, unknown>)[k] = next[k];
  return out;
}
/** `now` with, for each group of keys the owner changed from `was` (compared in `mine`, the owner's draft normalized), the
 *  owner's own values (taken from `raw`, the draft as typed). */
function overlay<T extends object>(was: T, mine: T, raw: T, now: T, groups: readonly (readonly (keyof T)[])[]): T {
  const out = { ...now };
  const same = (k: keyof T) => JSON.stringify(mine[k]) === JSON.stringify(was[k]);
  for (const g of groups) if (!g.every(same)) for (const k of g) { if (raw[k] === undefined) delete out[k]; else out[k] = raw[k]; }
  return out;
}

/** The owner's edits laid over `now`, a newer version read after a stale refusal (card 32), field by field down to a schedule's
 *  times, days and frequency and a target's parts: every part the owner did not touch shows the new version, so the next
 *  « Activer » never sends an old value the owner did not see. A part both changed keeps the owner's value, which is the one on
 *  screen; a schedule whose kind changed on either side is taken whole from the side that changed it last (the owner's when
 *  they edited it). `was` is the version the form was read from. */
export function rebaseDraft(was: RoutineSpec, d: SpecDraft, now: RoutineSpec): SpecDraft {
  const w = specDraft(was, d.mode);
  const mine = specDraft(specOf(d), d.mode);
  const n = specDraft(now, d.mode);
  const top = overlay(w, mine, d, n, [['name'], ['prompt'], ['catchUp']]);
  const target = overlay(w.target, mine.target, d.target, n.target, [['name'], ['cwd'], ['tool'], ['model']]);
  const scheduleEdited = JSON.stringify(mine.schedule) !== JSON.stringify(w.schedule);
  const schedule = mine.schedule.kind !== w.schedule.kind || n.schedule.kind !== w.schedule.kind
    ? (scheduleEdited ? d.schedule : n.schedule)
    : overlay(w.schedule, mine.schedule, d.schedule, n.schedule, [['times'], ['days'], ['weeks', 'anchor'], ['at'], ['tz']]);
  return { ...top, mode: d.mode, target, schedule };
}
export const isDirty = (saved: RoutineSpec | null, d: SpecDraft, blank: SpecDraft): boolean =>
  saved ? Object.keys(specPatch(saved, d)).length > 0 : JSON.stringify(d) !== JSON.stringify(blank);

/** What keeps a draft from being saved, field by field (cards 5, 19); `name` when another routine of that session has it. */
export interface DraftErrors { name?: 'invalid' | 'taken'; session?: true; dir?: true; prompt?: true; times?: true; days?: true; anchor?: true; at?: true; past?: string[] }
export function draftErrors(d: SpecDraft, others: readonly Routine[], now: Date): DraftErrors {
  const e: DraftErrors = { ...scheduleErrors(d.schedule, now) };
  const name = d.name.trim();
  if (!RoutineNameSchema.safeParse(name).success) e.name = 'invalid';
  else if (others.some(r => r.name === name && r.target.name === d.target.name)) e.name = 'taken';
  // A new session needs its name as much as an existing one does (issue #22, variant B approved by the owner).
  if (!d.target.name.trim()) e.session = true;
  if (d.mode === 'new' && !d.target.cwd.trim()) e.dir = true;
  if (!d.prompt.trim()) e.prompt = true;
  return e;
}
export const hasErrors = (e: DraftErrors): boolean => Object.keys(e).length > 0;

/** The form's part a daemon's `field` points to (ff7a19c2): outlined in red there (card 8), its error under it. */
export type FormFault = 'dir' | 'tool' | 'session' | 'model' | 'name' | 'schedule' | 'at' | 'prompt';
const FAULT: Record<RoutineField, FormFault | null> = { name: 'name', session: 'session', session_untracked: 'session', cwd: 'dir', tool: 'tool', model: 'model', schedule: 'schedule', tz: 'schedule', at: 'at', prompt: 'prompt' };
/** The part a refusal or a failed run is about: its `field`, else (an older daemon) the words of its reason. */
export function faultOf(x: { field?: RoutineField | undefined; reason?: string | undefined; message?: string | undefined } | undefined): FormFault | null {
  if (!x) return null;
  if (x.field) return FAULT[x.field];
  return faultyField(x.reason ?? x.message);
}

/** A refusal's or a failure's reason in the screen's language (the daemon's stays French): built from its `field` where the
 *  mockup gives a text (a folder, a tool), else the daemon's own words. */
export function whyText(x: { field?: RoutineField | undefined; reason?: string | undefined; cause?: RoutineRun['cause'] }, target: { cwd: string; tool: string }, dirLabel: (p: string) => string, t: R): string {
  if (x.field === 'cwd') return t.why.cwd(dirLabel(target.cwd));
  if (x.field === 'tool') return t.why.tool(target.tool);
  if (x.cause === 'timeout') return t.why.timeout;
  return x.reason ?? '';
}

/** A daemon's refusal of the form, as the page says it (card 28): the part it is about (none: the head of the configuration) and
 *  the front's text for its field, the daemon's own (French) words for a field or a cause the card does not word. */
export interface Refusal { part: FormFault | null; text: string }
export function refusalOf(f: { code: string; field?: RoutineField | undefined; message: string }, d: SpecDraft, t: R): Refusal {
  const part = f.code === 'name_taken' ? 'name' : faultOf(f);
  const e = t.err;
  const tz = d.schedule.tz ?? f.message.split(': ').pop() ?? '';
  const sched = d.schedule;
  const text = f.code === 'name_taken' ? e.name(d.target.name, d.name.trim())
    : f.field === 'cwd' ? e.dir
    : f.field === 'at' ? e.past
    : f.field === 'tz' ? e.tz(tz)
    // The daemon names `session_untracked` for a session Ledge does not follow, `session` for one it cannot reach; an older daemon
    // named both `session`, told apart by its words. For a new session, a `session` refusal is about the name typed (issue #22),
    // and so is one about an empty name in either mode: neither is a session out of reach.
    : f.field === 'session_untracked' ? e.notLedge
    : f.field === 'session' && d.mode === 'new' ? e.sessionName
    : f.field === 'session' && !d.target.name.trim() ? e.session
    : f.field === 'session' ? (/suivie|hors de ledge|outside|not followed/i.test(f.message) ? e.notLedge : e.unreachable)
    : f.field === 'tool' ? e.tool(d.target.tool)
    : f.field === 'model' ? e.model(d.target.tool, d.target.model)
    : f.field === 'schedule' ? (sched.kind === 'recurring' && !sched.times.length ? e.times : sched.kind === 'recurring' && !sched.days.length ? e.days
      : sched.kind === 'recurring' && sched.weeks === 2 && !sched.anchor ? e.anchor : f.message)
    : f.field === 'prompt' ? e.prompt
    : f.field === 'name' ? e.nameInvalid
    : f.message;
  return { part, text };
}

/** A failed run's reason that names a field (card 8), read from its words: the fallback when the daemon names no `field`. */
export function faultyField(reason: string | undefined): 'dir' | 'tool' | null {
  if (!reason) return null;
  if (/dossier|folder|directory|ENOENT|cwd/i.test(reason)) return 'dir';
  if (/outil|tool|not installed|command not found/i.test(reason)) return 'tool';
  return null;
}

/** A session's change, before → asked (card 7): the schedule's parts, the session, the prompt. */
export function proposalChanges(r: Routine, lang: Lang, t: R): ScheduleChange[] {
  const p = r.proposal?.spec;
  if (!p) return [];
  const out = scheduleChanges(r.schedule, p.schedule, lang, t);
  const who = (x: RoutineSpec) => `${x.target.name} · ${x.target.cwd}`;
  if (who(r) !== who(p)) out.push({ label: t.form.session, before: who(r), after: who(p) });
  const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
  if (r.prompt !== p.prompt) out.push({ label: t.form.prompt, before: clip(r.prompt), after: clip(p.prompt) });
  return out;
}

/** The parts of the configuration a proposal changes, outlined in amber (card 7). */
export function proposalFields(r: Routine): Set<'schedule' | 'session' | 'prompt' | 'name' | 'catchUp'> {
  const p = r.proposal?.spec;
  const out = new Set<'schedule' | 'session' | 'prompt' | 'name' | 'catchUp'>();
  if (!p) return out;
  if (JSON.stringify(scheduleOf(draftOf(p.schedule))) !== JSON.stringify(scheduleOf(draftOf(r.schedule)))) out.add('schedule');
  if (JSON.stringify(p.target) !== JSON.stringify(r.target)) out.add('session');
  if (p.prompt !== r.prompt) out.add('prompt');
  if (p.name !== r.name) out.add('name');
  if ((p.catchUp ?? 'once') !== r.catchUp) out.add('catchUp');
  return out;
}
