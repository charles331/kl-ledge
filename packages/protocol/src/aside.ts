import { z } from 'zod';

/**
 * An aside (#41): a question put to a Claude Code session with its own `/btw`, answered with the session's context while the
 * session goes on. It is no thread item: nothing of it reaches the session's transcript, and the fronts show it apart.
 *
 *   client → daemon  `session.aside`  { id, rid, question }   ask session `id`; `rid` is the front's id for this aside
 *   daemon → fronts  `session.aside`  { id, aside }           every change of it, to every front: asking, then answered or failed
 *
 * A daemon says it takes asides with `DaemonInfo.aside`. Claude Code only: any other harness's aside fails `unsupported`.
 */
export const ASIDE_QUESTION_MAX = 4_000;
/** The longest answer a front is sent; a longer one is cut and says so (`truncated`). */
export const ASIDE_ANSWER_MAX = 50_000;
/** The asides a daemon keeps per session (in memory) and replays after a snapshot, newest last. */
export const ASIDES_KEPT = 10;

export const AsideStateSchema = z.enum(['asking', 'answered', 'failed']);
export type AsideState = z.infer<typeof AsideStateSchema>;

/**
 * Why an aside failed, read tolerantly so a cause added later never makes an older front drop the aside:
 * - `unsupported`: not a Claude Code session; `read_only`: Ledge cannot type into it (no terminal, a seat it only follows);
 * - `busy`: another aside of the session is under way; `not_empty`: something is typed at the prompt and not sent;
 * - `no_panel`: the `/btw` panel never came up (Ledge could not type it, or this Claude Code does not answer it);
 * - `timeout`: the panel did not finish in time; `unreadable`: the panel finished but its copy could not be read;
 * - `interrupted`: something else came on screen (a request) or the session ended before the answer was read;
 * - `invalid`: any other cause, a front shows its generic text.
 * Every failure but `unsupported` and `read_only` points the person to the Terminal view.
 */
export const AsideCauseSchema = z.enum(['unsupported', 'read_only', 'busy', 'not_empty', 'no_panel', 'timeout', 'unreadable', 'interrupted', 'invalid']).catch('invalid');
export type AsideCause = z.infer<typeof AsideCauseSchema>;

export const AsideSchema = z.object({
  rid: z.string().min(1).max(100),
  question: z.string().max(ASIDE_QUESTION_MAX),
  askedAt: z.string().datetime(),
  state: AsideStateSchema,
  /** The answer as Claude Code copies it: Markdown. */
  answer: z.string().max(ASIDE_ANSWER_MAX).optional(),
  truncated: z.literal(true).optional(),
  answeredAt: z.string().datetime().optional(),
  cause: AsideCauseSchema.optional()
});
export type Aside = z.infer<typeof AsideSchema>;

export const SessionAsideAskSchema = z.object({ type: z.literal('session.aside'), id: z.string().min(1), rid: z.string().min(1).max(100), question: z.string().trim().min(1).max(ASIDE_QUESTION_MAX) });
export const SessionAsideSchema = z.object({ type: z.literal('session.aside'), id: z.string().min(1), aside: AsideSchema });

/** `/btw <question>` as typed in a reply field: the question, or null when the text is not an aside. */
export function asideQuestion(text: string): string | null {
  const m = /^\/btw(?:\s+([\s\S]*))?$/.exec(text.trim());
  const q = m?.[1]?.trim();
  return q ? q : null;
}
