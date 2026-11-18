import { open, readFile } from 'node:fs/promises';
import { release, type as osType } from 'node:os';
import { REPORT_LABEL, REPORT_REPO, type ReportFields, type ReportItem, type ReportItemKey, type ReportKind } from '@ledge/protocol';
import { redact, type ForgeRun } from './forge/run.js';

/**
 * Reports (issue #9, docs/mockups/ledge-report.html): what is attached to one, the issue it becomes, and its creation with the
 * machine's `gh`, or the prefilled « new issue » page when `gh` cannot. Never a secret, a token or a conversation: the items are
 * versions and names, the log excerpt (asked for, a bug only) is redacted and loses the user's home.
 */

/** The daemon log's last lines a bug may carry. */
export const REPORT_LOG_LINES = 50;
/** The longest « new issue » address: GitHub refuses much longer ones; the body is cut to fit. */
export const NEW_ISSUE_URL_MAX = 7000;

const ITEM_LABEL: Record<ReportItemKey, string> = {
  desktop: 'Ledge Desktop', daemon: 'daemon', system: 'Système', tool: 'Outil de la session', session: 'Session', project: 'Projet'
};

/** The system as one line: Windows and WSL with the distribution and its kernel, or the OS otherwise. */
export async function systemLine(read: (f: string) => Promise<string> = f => readFile(f, 'utf8')): Promise<string> {
  const kernel = release();
  const os = await read('/etc/os-release').then(t => /^PRETTY_NAME="?([^"\n]*)"?/m.exec(t)?.[1], () => undefined);
  if (/microsoft/i.test(kernel)) return ['Windows · WSL2', os, `noyau ${kernel}`].filter(Boolean).join(' · ');
  return [osType(), os, kernel].filter(Boolean).join(' · ');
}

/**
 * Text without what points at the user: their home (`~`), a Windows profile (`C:\Users\…`, `/mnt/c/Users/…`), an email address, and
 * anything that looks like a token or a credential (`redact`).
 */
export function scrub(text: string, home: string): string {
  let t = redact(text);
  if (home && home !== '/') t = t.split(home).join('~');
  return t
    .replace(/\/mnt\/([a-z])\/Users\/[^/\s'"]+/gi, '/mnt/$1/Users/…')
    .replace(/\b([A-Za-z]):\\+Users\\+[^\\\s'"]+/g, '$1:\\Users\\…')
    .replace(/\/home\/[^/\s'"]+/g, '/home/…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

/** The daemon log's last `n` lines, scrubbed; '' when it cannot be read. Reads its end only, whatever its size. */
export async function logExcerpt(file: string, home: string, n = REPORT_LOG_LINES): Promise<string> {
  let fh;
  try {
    fh = await open(file, 'r');
    const size = (await fh.stat()).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // A first line cut in its middle is dropped.
    return scrub(lines.slice(len < size ? 1 : 0).slice(-n).join('\n'), home);
  } catch { return ''; } finally { await fh?.close(); }
}

const SECTIONS: Array<[keyof ReportFields, string]> = [
  ['detail', 'Détail'], ['happened', 'Ce qui s’est passé'], ['expected', 'Ce qui était attendu'], ['repro', 'Comment le reproduire'],
  ['need', 'Le besoin'], ['context', 'Le contexte'], ['proposal', 'Une proposition']
];

/** The issue's body: its sections as written (the empty ones left out), the items kept, the log excerpt when asked for. */
export function issueBody(fields: ReportFields, items: readonly ReportItem[], logText?: string, from?: string): string {
  const parts: string[] = [];
  for (const [k, title] of SECTIONS) { const v = fields[k]?.trim(); if (v) parts.push(`## ${title}\n\n${v}`); }
  if (items.length) parts.push(`## Joint au signalement\n\n${items.map(i => `- ${ITEM_LABEL[i.key]} : ${i.value}`).join('\n')}`);
  if (logText) parts.push(`## Extrait du journal du daemon\n\n\`\`\`\n${logText.replace(/```/g, '`\u200b``')}\n\`\`\``);
  parts.push(`---\n_Signalé depuis Ledge${from ? ` par ${from}` : ''}._`);
  return parts.join('\n\n');
}

/** The prefilled « new issue » page: title, body and label, the body cut (with « … ») so the address stays under NEW_ISSUE_URL_MAX. */
export function newIssueUrl(kind: ReportKind, title: string, body: string): string {
  const base = `https://github.com/${REPORT_REPO}/issues/new?labels=${encodeURIComponent(REPORT_LABEL[kind])}&title=${encodeURIComponent(title)}&body=`;
  // Cut by code points, never inside a character (half an emoji makes encodeURIComponent throw).
  let points = Array.from(body), b = body;
  while (base.length + encodeURIComponent(b).length > NEW_ISSUE_URL_MAX && points.length > 0) {
    points = points.slice(0, Math.floor(points.length * 0.9));
    b = `${points.join('')}…`;
  }
  return base + encodeURIComponent(b);
}

export type IssueOutcome = { ok: true; number: number; url: string } | { ok: false; code: 'no_gh' | 'refused'; message?: string; url: string };

/**
 * Creates the issue on REPORT_REPO with the machine's `gh` (signed in to github.com), its label set; its number from the address
 * `gh` prints. `gh` missing or signed out: `no_gh`; any refusal: `refused` with its (redacted) message. Either way the prefilled
 * page, for the user to validate on GitHub.
 */
export async function createIssue(deps: { run: ForgeRun; ready: () => Promise<boolean> }, kind: ReportKind, title: string, body: string): Promise<IssueOutcome> {
  // The prefilled page only when gh does not create the issue.
  const fallback = (): string => newIssueUrl(kind, title, body);
  if (!(await deps.ready().catch(() => false))) return { ok: false, code: 'no_gh', url: fallback() };
  // `--title=`: a title starting with « - » is never read as a flag.
  const r = await deps.run('gh', ['issue', 'create', '-R', REPORT_REPO, `--title=${title}`, '--label', REPORT_LABEL[kind], '--body-file', '-'], { input: body, timeoutMs: 30_000 });
  const m = /https:\/\/github\.com\/[^\s]+\/issues\/(\d+)/.exec(r.stdout);
  if (r.code === 0 && m) return { ok: true, number: Number(m[1]), url: m[0] };
  if (r.code === null) return { ok: false, code: 'no_gh', url: fallback() };
  const message = redact(r.stderr.trim().split('\n').filter(Boolean).slice(0, 3).join(' ')).slice(0, 400);
  return { ok: false, code: 'refused', ...(message ? { message } : {}), url: fallback() };
}
