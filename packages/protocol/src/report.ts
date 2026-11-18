import { z } from 'zod';
import { RigSeatNameSchema } from './openrig.js';

/**
 * Reports (issue #9, docs/mockups/ledge-report.html): a bug or an idea about Ledge, sent as an issue on `REPORT_REPO`. The user's
 * own, from the « Signaler » form: the daemon creates the issue with the machine's `gh` (`report.create`), or, without it (or when
 * GitHub refuses), answers the prefilled « new issue » address the front opens. An agent's (`ledge report`): a decision put to the
 * user (a task given to Ledge, carrying `report`), and nothing reaches GitHub before the user's click.
 */

/** Where every report goes. */
export const REPORT_REPO = 'kl-ledge/ledge';
export const ReportKindSchema = z.enum(['bug', 'feature']);
export type ReportKind = z.infer<typeof ReportKindSchema>;
/** The label each kind gets on GitHub. */
export const REPORT_LABEL: Record<ReportKind, string> = { bug: 'bug', feature: 'enhancement' };

export const REPORT_TITLE_MAX = 200;
export const REPORT_TEXT_MAX = 8000;
/** A Desktop version as the front gives it. */
export const REPORT_VERSION_MAX = 40;
const text = z.string().max(REPORT_TEXT_MAX);

/** What an agent reports (`ledge report bug|feature "<titre>" "<détail>"`). `session` and `project`: the daemon's, where it comes from. */
export const ReportRequestSchema = z.object({
  kind: ReportKindSchema,
  title: z.string().trim().min(1).max(REPORT_TITLE_MAX),
  detail: z.string().trim().min(1).max(REPORT_TEXT_MAX),
  session: z.string().max(200).optional(),
  project: z.string().max(200).optional()
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

/**
 * The form's fields (mockup card 2 and 3): a bug's (what happened, what was expected, how to reproduce it) or an idea's (the need,
 * its context, a proposal); `detail`: an agent's own words. Each one left out or empty is left out of the issue.
 */
export const ReportFieldsSchema = z.object({
  happened: text.optional(), expected: text.optional(), repro: text.optional(),
  need: text.optional(), context: text.optional(), proposal: text.optional(),
  detail: text.optional()
}).strict();
export type ReportFields = z.infer<typeof ReportFieldsSchema>;

/** What is attached, each one the user may take out (« Joint au signalement »). */
export const ReportItemKeySchema = z.enum(['desktop', 'daemon', 'system', 'tool', 'session', 'project']);
export type ReportItemKey = z.infer<typeof ReportItemKeySchema>;
export const ReportItemSchema = z.object({ key: ReportItemKeySchema, value: z.string().max(300) });
export type ReportItem = z.infer<typeof ReportItemSchema>;

/**
 * What the report is about, the same for a preview and a creation: its kind; the session in front (its tool is attached), or the
 * agent's report it answers (`task`: its session and project are attached, its tool too); the Desktop's version (`desktop`); the
 * daemon's log excerpt or not (`log`, a bug only).
 */
const ReportContext = {
  requestId: z.string().min(1).max(100),
  kind: ReportKindSchema,
  session: z.string().min(1).max(200).optional(),
  task: z.string().min(1).max(40).optional(),
  desktop: z.string().min(1).max(REPORT_VERSION_MAX).optional(),
  log: z.boolean().optional()
};

/**
 * What would be attached, as the daemon reads it now: the items, and the log excerpt as it would go (redacted) with its `logId`,
 * which the creation sends back so the excerpt the user saw is the one that goes (never a reread log). `login`: the GitHub account
 * `gh` creates the issue with, absent when gh is not signed in to github.com or cannot tell.
 */
export const ReportPreviewSchema = z.object({ type: z.literal('report.preview'), ...ReportContext }).strict();
export const ReportPreviewReplySchema = z.object({
  type: z.literal('report.preview.reply'), requestId: z.string(), items: z.array(ReportItemSchema), log: z.string().optional(),
  logId: z.string().optional(), login: z.string().max(100).optional()
});

/**
 * Creates the issue: the title and fields as the user wrote them, without the items they took out (`omit`). With `log` (a bug),
 * `logId` is the preview's: that very excerpt goes. Without `logId` no excerpt goes (none was shown); unknown or expired, nothing is
 * created (`log_stale`, preview again).
 */
export const ReportCreateSchema = z.object({
  type: z.literal('report.create'), ...ReportContext, logId: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(REPORT_TITLE_MAX),
  fields: ReportFieldsSchema,
  omit: z.array(ReportItemKeySchema).max(6).optional()
}).strict();
/**
 * Created: its number and address; the agent's report it answered is closed, the agent told. Not created: `no_gh` (gh is missing
 * or not signed in to github.com), `refused` (GitHub or gh refused it, `message` redacted), `stale` (the agent's report is no longer
 * open), `log_stale` (the excerpt shown is unknown or expired: preview again), `invalid`; with `url`, the prefilled « new issue » page the front opens for the user to validate there.
 */
export const ReportCreatedSchema = z.object({
  type: z.literal('report.created'), requestId: z.string(), ok: z.boolean(),
  number: z.number().int().positive().optional(), url: z.string().url().optional(),
  code: z.enum(['no_gh', 'refused', 'stale', 'log_stale', 'invalid']).optional(), message: z.string().max(500).optional()
});

/** « Ignorer » on an agent's report: closed without an issue, the agent told. */
export const ReportIgnoreSchema = z.object({ type: z.literal('report.ignore'), requestId: z.string().min(1).max(100), task: z.string().min(1).max(40) }).strict();
export const ReportIgnoredSchema = z.object({ type: z.literal('report.ignored'), requestId: z.string(), ok: z.boolean(), code: z.enum(['stale']).optional() });

/**
 * `ledge report …` from an agent: `give` puts its report to the user, `status` reads what came of it. The agent is a session Ledge
 * launched (`by` with its `key`), or an OpenRig seat (`seat`, its OPENRIG_SESSION_NAME: a report only asks the user, who sees where
 * it comes from).
 */
export const ReportAgentSchema = z.object({
  type: z.literal('report.agent'), rid: z.string().min(1).max(100), op: z.enum(['give', 'status']),
  by: z.string().min(1).max(200).optional(), key: z.string().min(1).max(128).optional(), seat: RigSeatNameSchema.optional(),
  report: ReportRequestSchema.pick({ kind: true, title: true, detail: true }).optional(),
  task: z.string().min(1).max(40).optional()
}).strict();
/** The task its report became, or why not. */
export const ReportAgentResultSchema = z.object({
  type: z.literal('report.agent.result'), rid: z.string(),
  task: z.object({ id: z.string(), state: z.enum(['open', 'taken', 'done', 'refused', 'dropped']), result: z.string().optional() }).optional(),
  reason: z.string().optional()
});
