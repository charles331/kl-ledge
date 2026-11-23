import { createHash } from 'node:crypto';
import type { Routine } from '@ledge/protocol';

/** The digest of what an « Activer » applies: a routine's proposal when a session's change waits, else the routine itself.
 *  An approval is bound to it, so it never covers a prompt, a folder or a schedule the phone did not show. */
export function routineKey(r: Pick<Routine, 'name' | 'target' | 'schedule' | 'prompt' | 'catchUp'> & Pick<Partial<Routine>, 'proposal' | 'expiresAfterRun'>): string {
  const { name, target, schedule, prompt, catchUp, expiresAfterRun } = r.proposal?.spec ?? r;
  const what = { name, target: { name: target.name, cwd: target.cwd, tool: target.tool, model: target.model ?? null }, schedule, prompt, catchUp: catchUp ?? null,
    once: expiresAfterRun ?? null, proposal: !!r.proposal };
  return createHash('sha256').update(JSON.stringify(what)).digest('base64url').slice(0, 43);
}
