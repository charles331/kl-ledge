import { backgroundOf, helperAtWork, type BackgroundCommand, type Session } from '@ledge/protocol';

/**
 * Issue #1 (docs/mockups/ledge-background-work.html): a session available (at rest, reachable) whose agent still has work going on
 * in the background: subagents at work, or commands it left running (Claude Code). Undefined when it has none, or is not at rest:
 * at work, waiting on the user, in error, ended or offline. Only what its harness reports (nothing for Codex or Cursor Agent).
 */
export function restingWithWork(s: Pick<Session, 'state' | 'helpers' | 'background'> & { offline?: boolean }): { subagents: number; commands: BackgroundCommand[] } | undefined {
  if (s.offline || s.state !== 'idle') return undefined;
  return backgroundOf(s);
}

/** The subagents at work of a session, whatever its own state. */
export const kidsAtWork = (s: Pick<Session, 'helpers'>): number => s.helpers.filter(helperAtWork).length;

/** The command line under the task: the newest command and how many others run (the fiche: « Plusieurs : la plus récente, +n »). */
export function newestCommand(commands: readonly BackgroundCommand[]): { label: string; others: number } | undefined {
  const last = commands.at(-1);
  return last ? { label: last.label, others: commands.length - 1 } : undefined;
}
