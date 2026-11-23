import { z } from 'zod';
import { ToolSchema } from './session.js';
import { ModelIdSchema } from './models.js';
import { NAME_MAX } from './names.js';

/**
 * Routines (spec 2026-11-23-routines-design): Ledge's clock types a prompt into a standing session at set times. The daemon
 * owns them (`~/.ledge/routines.json`); every front reads them through `routine.list` and keeps in sync through `routine.changed`.
 */

/** The days a routine fires on, Monday first, as the CLI's `--days` and the screens name them. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** A routine's id: « r » and six hex digits. */
export const RoutineIdSchema = z.string().regex(/^r[0-9a-f]{6}$/, 'not a routine id');
/** A routine's name, unique per target session name: one word, as the CLI types it (`ledge routine run briefing`). */
export const ROUTINE_NAME_MAX = 40;
export const RoutineNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'not a routine name').max(ROUTINE_NAME_MAX);
/** A local wall-clock time, « HH:MM » on 24 hours. */
export const RoutineTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'not a time');
/** The most times a day and the longest prompt a routine holds. */
export const ROUTINE_TIMES_MAX = 24;
export const ROUTINE_PROMPT_MAX = 8000;
/** The longest reason a failed firing carries, and the most routines the daemon keeps (a list then fits the phone's frame). */
export const ROUTINE_REASON_MAX = 500;
export const ROUTINES_MAX = 50;
/** The longest folder the phone's list carries (clipped, with `cut`), and a routine's key: what an approval is bound to. */
export const PHONE_ROUTINE_CWD_MAX = 512;
export const RoutineKeySchema = z.string().min(1).max(64);

const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length;

/** When a routine fires: local times on some days of the week; `tz` (an IANA zone) defaults to the machine's, and a DST
 *  change keeps 08:00 at 08:00. */
export const RoutineScheduleSchema = z.object({
  times: z.array(RoutineTimeSchema).min(1).max(ROUTINE_TIMES_MAX).refine(unique, 'a time twice'),
  days: z.array(WeekdaySchema).min(1).max(7).refine(unique, 'a day twice'),
  tz: z.string().min(1).max(64).optional()
}).strict();
export type RoutineSchedule = z.infer<typeof RoutineScheduleSchema>;

/** The standing session a routine wakes, known by its Ledge name and its folder; `tool` and `model` start it when it is gone. */
export const RoutineTargetSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX), cwd: z.string().min(1).max(4096), tool: ToolSchema, model: ModelIdSchema.optional()
}).strict();
export type RoutineTarget = z.infer<typeof RoutineTargetSchema>;

/** `once` fires the latest missed slot once, on wake or restart; `skip` drops missed slots. */
export const RoutineCatchUpSchema = z.enum(['once', 'skip']);
export type RoutineCatchUp = z.infer<typeof RoutineCatchUpSchema>;
/** `pending`: created (or changed) by a session, waiting for the owner's « Activer » in « À toi ». */
export const RoutineStateSchema = z.enum(['enabled', 'paused', 'pending']);
export type RoutineState = z.infer<typeof RoutineStateSchema>;
/** How a firing reached its session: typed into it alive (`delivered`), after resuming it (`resumed`), in a new session (`launched`), or not at all. */
export const RoutineOutcomeSchema = z.enum(['delivered', 'launched', 'resumed', 'failed']);
export type RoutineOutcome = z.infer<typeof RoutineOutcomeSchema>;

/** A routine's last firing: when, for which slot (« HH:MM »), how it went; `late` for a slot fired on wake (§3.2). */
export const RoutineRunSchema = z.object({
  at: z.string().datetime(), slot: RoutineTimeSchema, outcome: RoutineOutcomeSchema,
  reason: z.string().max(ROUTINE_REASON_MAX).optional(), late: z.literal(true).optional()
}).strict();
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

/** Who made a routine: the owner (a terminal outside Ledge's sessions, or a screen), or a session (`pending` until « Activer »). */
export const RoutineCreatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('session'), id: z.string().min(1).max(100), name: z.string().max(NAME_MAX) }).strict()
]);
export type RoutineCreator = z.infer<typeof RoutineCreatorSchema>;

/** What a routine is made of, as `add` takes it and `update` changes it. The prompt's placeholders: {slot} {date} {last}. */
export const RoutineSpecSchema = z.object({
  name: RoutineNameSchema, target: RoutineTargetSchema, schedule: RoutineScheduleSchema,
  prompt: z.string().trim().min(1).max(ROUTINE_PROMPT_MAX), catchUp: RoutineCatchUpSchema.optional()
}).strict();
export type RoutineSpec = z.infer<typeof RoutineSpecSchema>;

/** A routine as the daemon keeps it. `nextRun` is the daemon's, computed on every change, never taken from a front. */
export const RoutineSchema = RoutineSpecSchema.extend({
  id: RoutineIdSchema, catchUp: RoutineCatchUpSchema, state: RoutineStateSchema, createdBy: RoutineCreatorSchema,
  createdAt: z.string().datetime(), lastRun: RoutineRunSchema.optional(), nextRun: z.string().datetime().optional()
}).strict();
export type Routine = z.infer<typeof RoutineSchema>;

/** What `routine.cmd` asks. `approve` and `refuse` answer a `pending` routine (« Activer » / « Refuser »): the owner's alone. */
export const ROUTINE_OPS = ['add', 'update', 'pause', 'resume', 'run', 'rm', 'approve', 'refuse'] as const;
export const RoutineOpSchema = z.enum(ROUTINE_OPS);
export type RoutineOp = z.infer<typeof RoutineOpSchema>;

/** Why the daemon refused a `routine.cmd`: no such routine, the name already taken for that session, a bad schedule or zone,
 *  not allowed (a session approving, or touching another's routine), or nothing pending to answer. */
export const RoutineRefusalSchema = z.enum(['not_found', 'name_taken', 'invalid', 'forbidden', 'not_pending']);
export type RoutineRefusal = z.infer<typeof RoutineRefusalSchema>;

/** The routines, newest first. */
export const RoutineListSchema = z.object({ type: z.literal('routine.list'), rid: z.string().min(1).max(100) });
export const RoutineListedSchema = z.object({ type: z.literal('routine.listed'), rid: z.string(), routines: z.array(RoutineSchema).max(ROUTINES_MAX) });

/**
 * A change to the routines. `add` takes `spec`; `update` takes `routine` (id or name) and `patch`; the others take `routine`.
 * A name is found among the caller's routines when it is a session. `by` and `key` name the calling session (`LEDGE_SESSION`,
 * `LEDGE_SESSION_KEY`): its `add`, and an `update` of the times, days, target or prompt, make the routine `pending`.
 */
export const RoutineCmdSchema = z.object({
  type: z.literal('routine.cmd'), rid: z.string().min(1).max(100), op: RoutineOpSchema,
  routine: z.string().min(1).max(ROUTINE_NAME_MAX).optional(),
  spec: RoutineSpecSchema.optional(), patch: RoutineSpecSchema.partial().optional(),
  by: z.string().min(1).max(100).optional(), key: z.string().min(1).max(128).optional()
});
export type RoutineCmd = z.infer<typeof RoutineCmdSchema>;
/** The answer to a `routine.cmd`: the routine as it now is, `removed` (its id) after `rm` or `refuse`, or why it was refused. */
export const RoutineResultSchema = z.object({
  type: z.literal('routine.result'), rid: z.string(), routine: RoutineSchema.optional(), removed: RoutineIdSchema.optional(),
  reason: z.string().max(ROUTINE_REASON_MAX).optional(), code: RoutineRefusalSchema.optional()
});
/** Every change of every routine, to every local front: the routine as it now is, or `removed` (its id). Exactly one of the two. */
export const RoutineChangedSchema = z.object({ type: z.literal('routine.changed'), routine: RoutineSchema.optional(), removed: RoutineIdSchema.optional() });

/** The two « À toi » items a routine makes, as a task given to Ledge carries them: `approve` asks to activate a session's routine
 *  (« Activer » / « Refuser »), `failed` says a firing could not leave (« Relancer » / « Voir »). */
export const TaskRoutineSchema = z.object({
  kind: z.enum(['approve', 'failed']), id: RoutineIdSchema, name: RoutineNameSchema,
  reason: z.string().max(ROUTINE_REASON_MAX).optional()
}).strict();
export type TaskRoutine = z.infer<typeof TaskRoutineSchema>;

/** What the phone may do to a routine: read the list, fire one now, pause or resume it, answer a pending one. `approve`
 *  carries the key of the routine the phone showed whole (`routine.detail`) and a device assertion, purpose `routine`, bound to both. */
export const PHONE_ROUTINE_ACTIONS = ['run', 'pause', 'resume', 'approve', 'refuse'] as const;
export const PhoneRoutineActionSchema = z.enum(PHONE_ROUTINE_ACTIONS);
export type PhoneRoutineAction = z.infer<typeof PhoneRoutineActionSchema>;
