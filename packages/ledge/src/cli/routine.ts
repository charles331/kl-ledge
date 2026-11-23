import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import {
  ROUTINE_PROMPT_MAX, RoutineDateSchema, RoutineDateTimeSchema, RoutineNameSchema, RoutineTimeSchema, ToolSchema, WEEKDAYS,
  type ClientMessage, type Routine, type RoutineCatchUp, type RoutineRun, type RoutineSchedule, type RoutineSpec, type Tool, type Weekday
} from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';
import { SESSION_KEY_VAR } from '../auth.js';
import { defaultLang, loadSettings, type Settings } from '../tui/settings.js';
import type { Lang } from '../tui/i18n/lang.js';

/** The language of `ledge routine`'s words: the TUI's own setting (`~/.ledge/tui.json`), else the locale, as `ledge tui` picks it,
 *  so the user has one setting for both. */
export type { Lang };
export function langOf(env: NodeJS.ProcessEnv, settings: Pick<Settings, 'lang'> = loadSettings()): Lang {
  return settings.lang ?? defaultLang(env);
}

const TEXT = {
  fr: {
    usage: `ledge routine add <nom> --session <nom> --cwd <dossier> --at 08:00,13:30 --days mon-fri [--every 1w|2w --anchor <AAAA-MM-JJ>]
                  [--tool claude] [--model <m>] [--catch-up once|skip] [--tz <zone>] -- "<prompt>"
ledge routine once <nom> --session <nom> --cwd <dossier> --on 2026-12-03T16:00[,…] [--tool …] [--model …] [--tz …] -- "<prompt>"
ledge routine list                       les routines, leur état, les 3 prochains tirs, le dernier
ledge routine show <id|nom>              une routine, ses prochains et derniers tirs, son prompt
ledge routine run <id|nom>               la lancer maintenant
ledge routine pause|resume <id|nom>      la mettre en pause, la reprendre
ledge routine edit <id|nom> [options de add ou de once] [-- "<prompt>"]
ledge routine rm <id|nom>                la supprimer (une unique passée : la retirer de l'historique)
ledge routine approve|refuse <id|nom>    activer ou refuser une routine (ou sa modification) qu'une session demande
--days : mon-fri, mon,wed,fri, daily. Le prompt peut contenir {slot} {date} {last}.
Depuis une session Ledge, une routine (ou sa modification) attend l'accord de l'utilisateur dans « À toi ».`,
    noDaemon: "Ledge ne tourne pas (lance une session avec `ledge claude`, ou `ledge daemon`)",
    noAnswer: (why: string) => `pas de réponse de Ledge : ${why}`,
    refused: (why: string) => `refusé : ${why}`,
    none: 'aucune routine',
    states: { enabled: 'active', paused: 'en pause', pending: 'attend ton accord', done: 'passée' } as Record<Routine['state'], string>,
    outcomes: { delivered: 'remise', resumed: 'reprise', launched: 'lancée', failed: 'échec' } as Record<RoutineRun['outcome'], string>,
    late: 'en retard', next: 'prochains', last: 'dernier', never: 'jamais', every2: 'toutes les deux semaines', anchor: 'ancre',
    daily: 'tous les jours', once: 'unique',
    added: (r: Routine) => r.state === 'pending' ? `routine ${r.name} (${r.id}) proposée : elle attend l'accord de l'utilisateur dans « À toi »` : `routine ${r.name} (${r.id}) programmée`,
    proposed: (r: Routine) => `modification de ${r.name} proposée : la routine continue comme avant jusqu'à l'accord de l'utilisateur dans « À toi »`,
    edited: (r: Routine) => `routine ${r.name} modifiée`,
    paused: (r: Routine) => `routine ${r.name} en pause`, resumed: (r: Routine) => `routine ${r.name} reprise`,
    ran: (r: Routine) => `routine ${r.name} lancée : son issue sera dans ledge routine show ${r.id}`,
    removed: (id: string) => `routine ${id} supprimée`,
    approved: (r: Routine) => `routine ${r.name} activée : la session est prévenue`,
    refusedChange: (r: Routine) => `modification de ${r.name} refusée : la routine reste telle quelle, la session est prévenue`,
    labels: { session: 'session', folder: 'dossier', tool: 'outil', schedule: 'horaire', catchUp: 'rattrapage', by: 'créée par', you: "l'utilisateur", proposal: 'modification demandée par', runs: 'derniers tirs', prompt: 'prompt' }
  },
  en: {
    usage: `ledge routine add <name> --session <name> --cwd <dir> --at 08:00,13:30 --days mon-fri [--every 1w|2w --anchor <YYYY-MM-DD>]
                  [--tool claude] [--model <m>] [--catch-up once|skip] [--tz <zone>] -- "<prompt>"
ledge routine once <name> --session <name> --cwd <dir> --on 2026-12-03T16:00[,…] [--tool …] [--model …] [--tz …] -- "<prompt>"
ledge routine list                       the routines, their state, their next 3 firings, the last one
ledge routine show <id|name>             one routine, its next and last firings, its prompt
ledge routine run <id|name>              fire it now
ledge routine pause|resume <id|name>     pause it, resume it
ledge routine edit <id|name> [add or once options] [-- "<prompt>"]
ledge routine rm <id|name>               remove it (a fired one-shot: take it out of the history)
ledge routine approve|refuse <id|name>   approve or refuse a routine (or a change to one) a session asks for
--days: mon-fri, mon,wed,fri, daily. The prompt may hold {slot} {date} {last}.
From a Ledge session, a routine (or a change to one) waits for the user's approval in « À toi ».`,
    noDaemon: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)',
    noAnswer: (why: string) => `no answer from Ledge: ${why}`,
    refused: (why: string) => `refused: ${why}`,
    none: 'no routines',
    states: { enabled: 'active', paused: 'paused', pending: 'awaiting your approval', done: 'fired' } as Record<Routine['state'], string>,
    outcomes: { delivered: 'delivered', resumed: 'resumed', launched: 'launched', failed: 'failed' } as Record<RoutineRun['outcome'], string>,
    late: 'late', next: 'next', last: 'last', never: 'never', every2: 'every two weeks', anchor: 'anchor',
    daily: 'every day', once: 'one-shot',
    added: (r: Routine) => r.state === 'pending' ? `routine ${r.name} (${r.id}) proposed: it waits for the user's approval in « À toi »` : `routine ${r.name} (${r.id}) scheduled`,
    proposed: (r: Routine) => `change to ${r.name} proposed: the routine goes on as before until the user approves it in « À toi »`,
    edited: (r: Routine) => `routine ${r.name} changed`,
    paused: (r: Routine) => `routine ${r.name} paused`, resumed: (r: Routine) => `routine ${r.name} resumed`,
    ran: (r: Routine) => `routine ${r.name} fired: its outcome will be in ledge routine show ${r.id}`,
    removed: (id: string) => `routine ${id} removed`,
    approved: (r: Routine) => `routine ${r.name} approved: the session is told`,
    refusedChange: (r: Routine) => `change to ${r.name} refused: the routine stays as it was, the session is told`,
    labels: { session: 'session', folder: 'folder', tool: 'tool', schedule: 'schedule', catchUp: 'catch-up', by: 'created by', you: 'the user', proposal: 'change asked by', runs: 'last firings', prompt: 'prompt' }
  }
};

type Cmd = Extract<ClientMessage, { type: 'routine.cmd' }>;
/** What `ledge routine` asks, parsed: `edit` keeps its flags apart, for they are merged with the routine as it is. */
export type RoutineArgs =
  | { op: 'list' }
  | { op: 'show' | 'run' | 'pause' | 'resume' | 'rm' | 'approve' | 'refuse'; routine: string }
  | { op: 'add'; spec: RoutineSpec }
  | { op: 'edit'; routine: string; flags: Flags };

interface Flags { session?: string; cwd?: string; at?: string[]; days?: Weekday[]; every?: 1 | 2; anchor?: string; on?: string[]; tool?: Tool; model?: string; catchUp?: RoutineCatchUp; tz?: string; prompt?: string; name?: string }

const DAY_OF: Record<string, Weekday> = Object.fromEntries(WEEKDAYS.map(d => [d, d]));
/** `mon-fri`, `mon,wed,fri`, `tue-thu,sat`, `daily`. */
export function parseDays(s: string): Weekday[] | undefined {
  if (s === 'daily') return [...WEEKDAYS];
  const out = new Set<Weekday>();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-');
    const i = WEEKDAYS.indexOf(DAY_OF[a ?? ''] as Weekday), j = b === undefined ? i : WEEKDAYS.indexOf(DAY_OF[b] as Weekday);
    if (i < 0 || j < 0 || j < i) return undefined;
    for (let k = i; k <= j; k++) out.add(WEEKDAYS[k]!);
  }
  return out.size ? WEEKDAYS.filter(d => out.has(d)) : undefined;
}

/** The flags after the name; undefined when one is unknown or malformed. A relative folder is resolved against `cwd` (`~` is the daemon's). */
function parseFlags(rest: string[], cwd: string): Flags | undefined {
  const f: Flags = {};
  const dash = rest.indexOf('--');
  const words = dash >= 0 ? rest.slice(0, dash) : rest;
  if (dash >= 0) { const p = rest.slice(dash + 1).join(' ').trim(); if (!p || p.length > ROUTINE_PROMPT_MAX) return undefined; f.prompt = p; }
  for (let i = 0; i < words.length; i += 2) {
    const k = words[i]!, v = words[i + 1];
    if (v === undefined || v.trim() === '') return undefined;
    const list = () => v.split(',').map(x => x.trim()).filter(Boolean);
    switch (k) {
      case '--session': f.session = v; break;
      case '--name': if (!RoutineNameSchema.safeParse(v).success) return undefined; f.name = v; break;
      case '--cwd': f.cwd = v.startsWith('~') || isAbsolute(v) ? v : resolve(cwd, v); break;
      case '--at': f.at = list(); if (!f.at.length || !f.at.every(t => RoutineTimeSchema.safeParse(t).success)) return undefined; break;
      case '--days': { const d = parseDays(v); if (!d) return undefined; f.days = d; break; }
      case '--every': if (v !== '1w' && v !== '2w') return undefined; f.every = v === '2w' ? 2 : 1; break;
      case '--anchor': if (!RoutineDateSchema.safeParse(v).success) return undefined; f.anchor = v; break;
      case '--on': f.on = list(); if (!f.on.length || !f.on.every(t => RoutineDateTimeSchema.safeParse(t).success)) return undefined; break;
      case '--tool': { const t = ToolSchema.safeParse(v); if (!t.success) return undefined; f.tool = t.data; break; }
      case '--model': f.model = v; break;
      case '--catch-up': if (v !== 'once' && v !== 'skip') return undefined; f.catchUp = v; break;
      case '--tz': f.tz = v; break;
      default: return undefined;
    }
  }
  return f;
}

/** The schedule the flags say, over `base` (an edit's routine as it is); undefined when they do not make one. */
function scheduleOf(f: Flags, base?: RoutineSchedule): RoutineSchedule | undefined {
  const tz = f.tz ?? base?.tz;
  if (f.on) return f.at || f.days || f.every || f.anchor ? undefined : { kind: 'once', at: f.on, ...(tz ? { tz } : {}) };
  const was = base?.kind === 'recurring' ? base : undefined;
  if (!f.at && !f.days && !f.every && !f.anchor) {
    if (!f.tz) return base;
    // A new zone alone keeps the schedule's moments or times, whichever kind it is.
    if (base) return { ...base, tz: f.tz };
  }
  const times = f.at ?? was?.times, days = f.days ?? was?.days;
  if (!times || !days) return undefined;
  const weeks = f.every ?? (f.anchor ? 2 : was?.every?.weeks ?? 1);
  const anchor = f.anchor ?? was?.every?.anchor;
  // Every two weeks says which weeks: without its anchor it is not a schedule.
  if (weeks === 2 && !anchor) return undefined;
  return { kind: 'recurring', times, days, ...(weeks === 2 ? { every: { weeks: 2, anchor: anchor! } } : {}), ...(tz ? { tz } : {}) };
}

/** The arguments of `ledge routine`, or undefined when they do not fit its usage. */
export function routineArgs(args: string[], cwd = process.cwd()): RoutineArgs | undefined {
  const [op, name, ...rest] = args;
  switch (op) {
    case 'list': return name === undefined ? { op } : undefined;
    case 'show': case 'run': case 'pause': case 'resume': case 'rm': case 'approve': case 'refuse': return name && rest.length === 0 ? { op, routine: name } : undefined;
    case 'add': case 'once': {
      if (!name || !RoutineNameSchema.safeParse(name).success) return undefined;
      const f = parseFlags(rest, cwd);
      if (!f || f.name || !f.session || !f.cwd || !f.prompt || (op === 'once') !== !!f.on) return undefined;
      const schedule = scheduleOf(f);
      if (!schedule || (op === 'add' && (!f.at || !f.days))) return undefined;
      return { op: 'add', spec: { name, target: { name: f.session, cwd: f.cwd, tool: f.tool ?? 'claude', ...(f.model ? { model: f.model } : {}) }, schedule, prompt: f.prompt, ...(f.catchUp ? { catchUp: f.catchUp } : {}) } };
    }
    case 'edit': {
      if (!name) return undefined;
      const f = parseFlags(rest, cwd);
      return f && Object.keys(f).length ? { op: 'edit', routine: name, flags: f } : undefined;
    }
    default: return undefined;
  }
}

/** An edit's patch: the flags over the routine as it is (its schedule completed by them); undefined when they do not make one. */
export function patchOf(f: Flags, r: Routine): Partial<RoutineSpec> | undefined {
  const schedule = scheduleOf(f, r.schedule);
  if (!schedule) return undefined;
  const target = f.session || f.cwd || f.tool || f.model ? { ...r.target, ...(f.session ? { name: f.session } : {}), ...(f.cwd ? { cwd: f.cwd } : {}), ...(f.tool ? { tool: f.tool } : {}), ...(f.model ? { model: f.model } : {}) } : undefined;
  return { ...(f.name ? { name: f.name } : {}), ...(target ? { target } : {}), ...(schedule !== r.schedule ? { schedule } : {}), ...(f.prompt ? { prompt: f.prompt } : {}), ...(f.catchUp ? { catchUp: f.catchUp } : {}) };
}

// ── Printing ──

const localeOf = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');
/** An instant as the user reads it, in the routine's zone: « jeu. 26/11 16:00 ». */
function when(isoAt: string, lang: Lang, tz?: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) })
    .formatToParts(new Date(isoAt)).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}
/** « libellé : » in French, “label:” in English. */
const colon = (lang: Lang) => (lang === 'fr' ? ' : ' : ': ');
const DAY_WORDS: Record<Lang, Record<Weekday, string>> = {
  fr: { mon: 'lun', tue: 'mar', wed: 'mer', thu: 'jeu', fri: 'ven', sat: 'sam', sun: 'dim' },
  en: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
};
function daysText(days: readonly Weekday[], lang: Lang): string {
  const idx = WEEKDAYS.map((d, i) => (days.includes(d) ? i : -1)).filter(i => i >= 0);
  if (idx.length === 7) return TEXT[lang].daily;
  const runs: number[][] = [];
  for (const i of idx) { const last = runs.at(-1); if (last && last.at(-1) === i - 1) last.push(i); else runs.push([i]); }
  const w = DAY_WORDS[lang];
  return runs.map(r => (r.length >= 3 ? `${w[WEEKDAYS[r[0]!]!]}–${w[WEEKDAYS[r.at(-1)!]!]}` : r.map(i => w[WEEKDAYS[i]!]).join(', '))).join(', ');
}
export function scheduleText(s: RoutineSchedule, lang: Lang): string {
  const t = TEXT[lang];
  const zone = s.tz ? ` (${s.tz})` : '';
  if (s.kind === 'once') return `${t.once}${colon(lang)}${[...s.at].sort().map(a => a.replace('T', ' ')).join(', ')}${zone}`;
  return `${s.times.join(', ')} · ${daysText(s.days, lang)}${s.every?.weeks === 2 ? ` · ${t.every2} (${t.anchor} ${s.every.anchor})` : ''}${zone}`;
}
const runText = (r: RoutineRun, lang: Lang, tz?: string) => {
  const t = TEXT[lang];
  return `${when(r.slotAt ?? r.at, lang, tz)} ${t.outcomes[r.outcome]}${r.late ? ` (${t.late}, ${when(r.at, lang, tz)})` : ''}${r.reason ? `${colon(lang)}${r.reason}` : ''}`;
};

/** One line per routine: id, state, name, session, schedule, next firings, last one. */
export function formatList(rs: readonly Routine[], lang: Lang): string {
  const t = TEXT[lang];
  if (!rs.length) return t.none;
  return rs.map(r => {
    const tz = r.schedule.tz;
    const next = r.nextRuns?.length ? `${t.next}${colon(lang)}${r.nextRuns.map(n => when(n, lang, tz)).join(', ')}` : '';
    const last = `${t.last}${colon(lang)}${r.lastRun ? runText(r.lastRun, lang, tz) : t.never}`;
    return [`${r.id}  ${r.name}  ${t.states[r.state]}${r.proposal ? ' *' : ''}  ${r.target.name}  ${scheduleText(r.schedule, lang)}`, ...(next ? [`         ${next}`] : []), `         ${last}`].join('\n');
  }).join('\n');
}
/** One routine whole. */
export function formatRoutine(r: Routine, lang: Lang): string {
  const t = TEXT[lang]; const l = t.labels; const tz = r.schedule.tz; const c = colon(lang);
  return [
    `${r.name} (${r.id}) · ${t.states[r.state]}`,
    `${l.session}${c}${r.target.name} · ${l.folder}${c}${r.target.cwd} · ${l.tool}${c}${r.target.tool}${r.target.model ? ` (${r.target.model})` : ''}`,
    `${l.schedule}${c}${scheduleText(r.schedule, lang)} · ${l.catchUp}${c}${r.catchUp}`,
    `${l.by}${c}${r.createdBy.kind === 'user' ? l.you : r.createdBy.name}`,
    ...(r.proposal ? [`${l.proposal} ${r.proposal.by.name}${c}${scheduleText(r.proposal.spec.schedule, lang)}${r.proposal.spec.prompt !== r.prompt ? ` · ${l.prompt}${c}${r.proposal.spec.prompt}` : ''}`] : []),
    ...(r.nextRuns?.length ? [`${t.next}${colon(lang)}${r.nextRuns.map(n => when(n, lang, tz)).join(', ')}`] : []),
    `${l.runs}${c.trimEnd()}`, ...(r.runs?.length ? r.runs.map(x => `  ${runText(x, lang, tz)}`) : [`  ${t.never}`]),
    '', `${l.prompt}${c.trimEnd()}`, r.prompt
  ].join('\n');
}

// ── Running ──

const ROUTINE_MS = 8000;

/** The routines `ref` names, by the daemon's own rule (routines.ts `run`): its id, else its name among the active routines before
 *  the fired one-shots, a session's own first (`owned`, as the daemon counts them). */
export function pick(all: readonly Routine[], ref: string, owned?: readonly string[]): Routine[] {
  const named = all.filter(r => r.id === ref || r.name.toLowerCase() === ref.toLowerCase());
  const live = named.filter(r => r.id === ref || r.state !== 'done');
  const candidates = live.length ? live : named;
  const mine = owned ? candidates.filter(r => owned.includes(r.id)) : [];
  return mine.length ? mine : candidates;
}

/** `ledge routine …` over a connected client, as session `by` (with its key) or as the user. */
export async function routineOnClient(client: Client, args: string[], o: { by?: string; key?: string; ms: number; lang: Lang; cwd?: string }): Promise<{ line: string; code: number }> {
  const t = TEXT[o.lang];
  const parsed = routineArgs(args, o.cwd);
  if (!parsed) return { line: t.usage, code: 1 };
  const who = o.by ? { by: o.by, ...(o.key ? { key: o.key } : {}) } : {};
  const list = async (): Promise<{ routines: Routine[]; owned?: string[] }> => {
    const rid = randomUUID();
    client.send({ type: 'routine.list', rid, ...(o.by ? { by: o.by } : {}) });
    const listed = await client.next('routine.listed', o.ms);
    return { routines: listed.routines, ...(listed.owned ? { owned: listed.owned } : {}) };
  };
  const ambiguous = (ref: string, found: Routine[]) => t.refused(found.length ? `${ref} : ${found.map(r => r.id).join(', ')}` : ref);
  const send = async (cmd: Omit<Cmd, 'type' | 'rid' | 'by' | 'key'>) => {
    const rid = randomUUID();
    client.send({ type: 'routine.cmd', rid, ...who, ...cmd });
    return client.next('routine.result', o.ms);
  };
  try {
    if (parsed.op === 'list') return { line: formatList((await list()).routines, o.lang), code: 0 };
    if (parsed.op === 'show') {
      const { routines, owned } = await list();
      const found = pick(routines, parsed.routine, owned);
      if (found.length !== 1) return { line: ambiguous(parsed.routine, found), code: 1 };
      return { line: formatRoutine(found[0]!, o.lang), code: 0 };
    }
    let cmd: Omit<Cmd, 'type' | 'rid' | 'by' | 'key'>;
    if (parsed.op === 'add') cmd = { op: 'add', spec: parsed.spec };
    else if (parsed.op === 'edit') {
      const { routines, owned } = await list();
      const found = pick(routines, parsed.routine, owned);
      const base = found.length === 1 ? found[0]! : undefined;
      const patch = base && patchOf(parsed.flags, base);
      if (!patch) return { line: base ? t.usage : ambiguous(parsed.routine, found), code: 1 };
      cmd = { op: 'update', routine: base.id, patch };
    } else cmd = { op: parsed.op, routine: parsed.routine };
    const r = await send(cmd);
    if (r.code || r.reason) return { line: t.refused(r.reason ?? r.code ?? ''), code: 1 };
    if (r.removed) return { line: t.removed(r.removed), code: 0 };
    const routine = r.routine!;
    switch (cmd.op) {
      case 'add': return { line: t.added(routine), code: 0 };
      case 'update': return { line: routine.proposal ? t.proposed(routine) : t.edited(routine), code: 0 };
      case 'pause': return { line: t.paused(routine), code: 0 };
      case 'resume': return { line: t.resumed(routine), code: 0 };
      case 'run': return { line: t.ran(routine), code: 0 };
      case 'approve': return { line: t.approved(routine), code: 0 };
      case 'refuse': return { line: t.refusedChange(routine), code: 0 };
      default: return { line: formatRoutine(routine, o.lang), code: 0 };
    }
  } catch (e) {
    return { line: t.noAnswer((e as Error).message), code: 1 };
  }
}

/** `ledge routine …`: from a Ledge session, in its name (its routines wait for the user); from any other terminal, as the user. */
export async function runRoutine(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string } = {}): Promise<{ line: string; code: number }> {
  const env = opts.env ?? process.env;
  const lang = langOf(env);
  if (!routineArgs(args, opts.cwd)) return { line: TEXT[lang].usage, code: args.length && !args.every(a => a === '--help' || a === '-h') ? 1 : 0 };
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION || undefined;
  const deadline = Date.now() + (opts.timeoutMs ?? ROUTINE_MS);
  const left = () => Math.max(0, deadline - Date.now());
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: left() }); }
  catch { return { line: TEXT[lang].noDaemon, code: 1 }; }
  try { return await routineOnClient(client, args, { ...(by ? { by } : {}), ...(env[SESSION_KEY_VAR] ? { key: env[SESSION_KEY_VAR] } : {}), ms: left(), lang, ...(opts.cwd ? { cwd: opts.cwd } : {}) }); }
  finally { await client.close(); }
}
