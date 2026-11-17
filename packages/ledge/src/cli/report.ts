// `ledge report` (issue #9): an agent reports a bug of Ledge or proposes an idea. Nothing reaches GitHub from here: the report is a
// decision put to the user (« À toi › Décisions » on every front), who creates the issue, edits it first, or ignores it; the agent
// reads what came of it with `ledge report status <id>`.
import { randomUUID } from 'node:crypto';
import { REPORT_REPO, ReportRequestSchema, RigSeatNameSchema, type ReportKind } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';
import { SESSION_KEY_VAR } from '../auth.js';

export const REPORT_USAGE = `ledge report bug "<titre>" "<détail>"       signaler un bug de Ledge (l'utilisateur crée l'issue, ou non)
ledge report feature "<titre>" "<détail>"   proposer une idée pour Ledge (idem)
ledge report status <id>                    ce qu'il est advenu de ton signalement`;
const REPORT_MS = 4000;
const ID = /^t[0-9a-f]{6}$/;

/** What `ledge report …` asks, or a usage line. */
export function reportArgs(args: string[]): { op: 'give'; kind: ReportKind; title: string; detail: string } | { op: 'status'; task: string } | string {
  const [op, a, b, ...rest] = args;
  if (op === 'status') return a && ID.test(a) && b === undefined ? { op: 'status', task: a } : REPORT_USAGE;
  if ((op !== 'bug' && op !== 'feature') || a === undefined || b === undefined || rest.length) return REPORT_USAGE;
  const r = ReportRequestSchema.safeParse({ kind: op, title: a, detail: b });
  if (!r.success) return `refusé : un titre de 1 à 200 caractères et un détail de 1 à 8000\n${REPORT_USAGE}`;
  return { op: 'give', kind: r.data.kind, title: r.data.title, detail: r.data.detail };
}

/** Who reports: a session Ledge launched (its id and key), or an OpenRig seat (its name). */
export type Reporter = { by: string; key?: string } | { seat: string };

const stateLine = (t: { id: string; state: string; result?: string }): string => {
  if (t.state === 'open' || t.state === 'taken') return `signalement ${t.id} : en attente de l'utilisateur`;
  if (t.state === 'done') return `signalement ${t.id} : ${t.result ?? 'traité'}`;
  return `signalement ${t.id} : ${t.result ?? 'ignoré par l\'utilisateur'}`;
};

/** Sends `ledge report …` as `who` on `client`, and says what happens next. */
export async function reportOnClient(client: Client, args: string[], who: Reporter, ms: number): Promise<{ line: string; code: number }> {
  const p = reportArgs(args);
  if (typeof p === 'string') return { line: p, code: 1 };
  try {
    client.send({ type: 'report.agent', rid: randomUUID(), ...who, ...(p.op === 'give' ? { op: 'give', report: { kind: p.kind, title: p.title, detail: p.detail } } : { op: 'status', task: p.task }) });
    const r = await client.next('report.agent.result', ms);
    if (r.reason !== undefined || !r.task) return { line: `refusé : ${r.reason ?? 'pas de réponse'}`, code: 1 };
    if (p.op === 'status') return { line: stateLine(r.task), code: 0 };
    return { line: `signalement ${r.task.id} posé à l'utilisateur : rien ne part sur ${REPORT_REPO} sans son clic ; « ledge report status ${r.task.id} » dira ce qu'il en est`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}

/** Who this shell is: a session Ledge launched, else the OpenRig seat it runs in. */
export function reporterOf(env: NodeJS.ProcessEnv): Reporter | undefined {
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  if (by) return { by, ...(env[SESSION_KEY_VAR] ? { key: env[SESSION_KEY_VAR] } : {}) };
  const seat = RigSeatNameSchema.safeParse(env.OPENRIG_SESSION_NAME);
  return seat.success ? { seat: seat.data } : undefined;
}

/** `ledge report …` from an agent's shell. */
export async function runReport(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const p = reportArgs(args);
  if (typeof p === 'string') return { line: p, code: 1 };
  const who = reporterOf(opts.env ?? process.env);
  if (!who) return { line: 'ledge report marche dans une session lancée par Ledge ou un siège OpenRig : sinon, utilise le bouton « Signaler » de Ledge', code: 1 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: REPORT_MS }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await reportOnClient(client, args, who, REPORT_MS); }
  finally { await client.close(); }
}
