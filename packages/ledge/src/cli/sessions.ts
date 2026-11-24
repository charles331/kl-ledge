import { isArchived, isStoppedOmpSeat, projectOf, type Projects, type Session } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { callerOf, DAEMON_DOWN, resultLine, runOnClient, type ActionResult } from './action.js';

// Desktop's « Gérer la session » from a shell (issue « gestion des sessions en CLI »): list the sessions with their ids, then
// archive, restore, resume, rename, file or delete them through `action.run`, so the daemon applies its own rules (#93).

export const SESSIONS_USAGE = `ledge status [--all] [--json]                    les sessions, avec leur id ; --all : les archivées aussi
ledge who [--json]                               les sessions en vie que les agents joignent
ledge archive <session>… [--close] [--json]      archiver (--close : fermer proprement d'abord une session en cours)
ledge unarchive <session>… [--json]              sortir de l'archive
ledge resume <session>… [--json]                 relancer l'agent d'une session terminée sur sa conversation
ledge rename <session> "<sujet>" [--json]        changer le sujet d'une session ("" : sujet automatique) ; son nom ne change pas
ledge move <session> <projet> [--json]           ranger une session dans un projet (son id ou son nom)
ledge delete <session>… --yes [--json]           supprimer pour de bon (toi seul, pas une session agent)`;

/** A session as `--json` gives it: what an agent needs to pick one and act on it by its id. */
export interface SessionRow {
  id: string; name: string; tool: string; state: string;
  /** The daemon's project (its id and name) when the session is in one, else null. */
  projectId: string | null; project: string | null;
  repo: string | null; cwd: string; branch: string | null; topic: string | null;
  archived: boolean; readOnly: boolean; startedAt: string; lastActivityAt: string;
}

export function sessionRow(s: Session, projects?: Projects): SessionRow {
  const projectId = projects ? projectOf(s, projects) ?? null : null;
  return {
    id: s.id, name: s.name, tool: s.tool, state: s.state,
    projectId, project: projectId ? projects!.projects.find(p => p.id === projectId)?.name ?? null : null,
    repo: s.repo ?? null, cwd: s.cwd, branch: s.branch ?? null, topic: s.topic ?? null,
    archived: isArchived(s), readOnly: s.source === 'hook_only', startedAt: s.startedAt, lastActivityAt: s.lastActivityAt
  };
}

/** The sessions an agent can reach, as `ledge who` lists them: live and not archived, plus OpenRig's stopped OMP seats. */
export const reachable = (sessions: readonly Session[]): Session[] => sessions.filter(s => (s.state !== 'exited' && !isArchived(s)) || isStoppedOmpSeat(s));

/** How long ago, in a few characters: « 3 min », « 2 h », « 5 j ». */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} j`;
}

/** `ledge status`: every session but the archived ones (all with `all`), the most recently active first, each with its id. */
export function formatStatus(sessions: readonly Session[], projects?: Projects, opts: { all?: boolean; now?: number } = {}): string {
  const shown = sessions.filter(s => opts.all || !isArchived(s)).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  if (shown.length === 0) return 'aucune session';
  const rows = shown.map(s => {
    const r = sessionRow(s, projects);
    const state = `${s.state}${r.archived ? ' · archivée' : ''}${r.readOnly ? ' · lecture seule' : ''}`;
    const ask = s.pending ? ` · ${s.pending.kind} : ${s.pending.text.replace(/\s+/g, ' ').slice(0, 60)}` : '';
    return [s.id, s.name, s.tool, state, r.project ?? `${s.repo ?? s.project}`, ago(s.lastActivityAt, opts.now), `${s.topic ?? '-'}${ask}`];
  });
  const head = ['ID', 'NOM', 'OUTIL', 'ÉTAT', 'PROJET', 'ACTIVITÉ', 'SUJET'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  return [head, ...rows].map(r => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join('  ')).join('\n');
}

/** The snapshot and the projects (none from an older daemon) of a connected client. */
export async function sessionsOnClient(client: Client, timeoutMs = 1500): Promise<{ sessions: Session[]; projects?: Projects }> {
  const sessions = (await client.next('snapshot', timeoutMs)).sessions;
  const projects = await client.next('projects', Math.min(timeoutMs, 500)).then(m => m.projects, () => undefined);
  return { sessions, ...(projects ? { projects } : {}) };
}

/** `ledge status [--all] [--json]`. */
export async function runStatus(args: string[], opts: { port?: number } = {}): Promise<{ line: string; code: number }> {
  if (args.some(a => a !== '--all' && a !== '--json')) return { line: SESSIONS_USAGE, code: 1 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  try {
    const { sessions, projects } = await sessionsOnClient(client);
    const all = args.includes('--all');
    if (args.includes('--json')) return { line: JSON.stringify(sessions.filter(s => all || !isArchived(s)).map(s => sessionRow(s, projects))), code: 0 };
    return { line: formatStatus(sessions, projects, { all }), code: 0 };
  } finally { await client.close(); }
}

/** What each command runs: its registry action, and how its words become the action's args (undefined: they do not fit). */
type Command = 'archive' | 'unarchive' | 'resume' | 'rename' | 'move' | 'delete';
const MANY: Record<'archive' | 'unarchive' | 'resume' | 'delete', 'session.archive' | 'session.restore' | 'session.resume' | 'session.delete'> = {
  archive: 'session.archive', unarchive: 'session.restore', resume: 'session.resume', delete: 'session.delete'
};

/** The words of a command once its flags are taken out, or undefined when an unknown flag is there. */
export function commandArgs(cmd: Command, args: string[]): { words: string[]; json: boolean; yes: boolean; close: boolean } | undefined {
  const flags = new Set(['--json', ...(cmd === 'delete' ? ['--yes'] : []), ...(cmd === 'archive' ? ['--close'] : [])]);
  const words = args.filter(a => !flags.has(a));
  if (words.some(w => w.startsWith('--'))) return undefined;
  const fits = cmd === 'rename' || cmd === 'move' ? words.length === 2 && words[0]!.trim() !== '' && (cmd === 'rename' || words[1]!.trim() !== '') : words.length > 0 && words.every(w => w.trim() !== '');
  return fits ? { words, json: args.includes('--json'), yes: args.includes('--yes'), close: args.includes('--close') } : undefined;
}

/** One session's run of a command, each step's result: archive closes it first when asked (a session already ended skips that). */
async function runOne(client: Client, cmd: Command, words: string[], o: { yes: boolean; close: boolean; by?: ReturnType<typeof callerOf> }): Promise<ActionResult[]> {
  const by = o.by;
  if (cmd === 'rename') return [await runOnClient(client, 'session.topic', { session: words[0], topic: words[1] }, { by })];
  if (cmd === 'move') return [await runOnClient(client, 'session.move', { session: words[0], project: words[1] }, { by })];
  const session = words[0]!;
  const steps: ActionResult[] = [];
  if (cmd === 'archive' && o.close) {
    const closed = await runOnClient(client, 'session.close', { session }, { by });
    const ended = closed.reason !== undefined && /has exited/.test(closed.reason);
    if (!ended) steps.push(closed);
    if (closed.reason !== undefined && !ended) return steps;
  }
  steps.push(await runOnClient(client, MANY[cmd as keyof typeof MANY], { session }, { by, ...(cmd === 'delete' && o.yes ? { confirmed: true } : {}) }));
  return steps;
}

/** `ledge archive|unarchive|resume|rename|move|delete …`: each session in turn; stops at the first that cannot be. */
export async function runSessionCommand(cmd: Command, args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const parsed = commandArgs(cmd, args);
  if (!parsed) return { line: SESSIONS_USAGE, code: args.length ? 1 : 0 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  const by = callerOf(opts.env ?? process.env);
  const targets = cmd === 'rename' || cmd === 'move' ? [parsed.words] : parsed.words.map(w => [w]);
  const lines: string[] = [];
  try {
    for (const words of targets) {
      for (const step of await runOne(client, cmd, words, { yes: parsed.yes, close: parsed.close, by })) {
        const r = resultLine(step, parsed.json);
        lines.push(r.line);
        if (r.code) return { line: lines.join('\n'), code: 1 };
      }
    }
    return { line: lines.join('\n'), code: 0 };
  } catch (e) {
    return { line: [...lines, `pas de réponse de Ledge : ${(e as Error).message}`].join('\n'), code: 1 };
  } finally { await client.close(); }
}
