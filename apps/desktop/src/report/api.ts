import type { DaemonClient } from '@ledge/fleet';
import type { ReportFields, ReportItem, ReportItemKey, ReportKind } from '@ledge/protocol';

/**
 * Issue #9 (docs/mockups/ledge-report.html): what the « Signaler » form and an agent's report ask the local daemon. Each request
 * carries its `requestId` and waits for its own answer; past its delay, it says so (`silent`).
 */

/** What a report is about: its kind, the session in front (its tool is attached), or the agent's report it answers (`task`). */
export interface ReportContext { kind: ReportKind; session?: string; task?: string; desktop?: string; log?: boolean }
export interface ReportPreview { items: ReportItem[]; log?: string }
export type ReportOutcome =
  | { ok: true; number: number; url?: string }
  | { ok: false; code: 'no_gh' | 'refused' | 'stale' | 'invalid' | 'silent'; url?: string; message?: string };

/** How long a preview is waited for, and a creation (`gh issue create` may take its time). */
export const PREVIEW_MS = 8000;
export const CREATE_MS = 30_000;
let seq = 0;
const rid = (what: string) => `report-${what}-${Date.now()}-${++seq}`;
const clean = (c: ReportContext) => ({ kind: c.kind, ...(c.session ? { session: c.session } : {}), ...(c.task ? { task: c.task } : {}), ...(c.desktop ? { desktop: c.desktop } : {}), ...(c.log ? { log: true } : {}) });

export function previewReport(client: DaemonClient, c: ReportContext): Promise<ReportPreview | null> {
  return new Promise(resolve => {
    const requestId = rid('preview');
    const done = (r: ReportPreview | null) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'report.preview.reply' && m.requestId === requestId) done({ items: m.items, ...(m.log !== undefined ? { log: m.log } : {}) }); });
    const timer = setTimeout(() => done(null), PREVIEW_MS);
    try { client.send({ type: 'report.preview', requestId, ...clean(c) }); } catch { done(null); }
  });
}

export function createReport(client: DaemonClient, c: ReportContext & { title: string; fields: ReportFields; omit?: ReportItemKey[] }): Promise<ReportOutcome> {
  return new Promise(resolve => {
    const requestId = rid('create');
    const done = (r: ReportOutcome) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => {
      if (m.type !== 'report.created' || m.requestId !== requestId) return;
      if (m.ok && m.number) done({ ok: true, number: m.number, ...(m.url ? { url: m.url } : {}) });
      else done({ ok: false, code: m.code ?? 'invalid', ...(m.url ? { url: m.url } : {}), ...(m.message ? { message: m.message } : {}) });
    });
    const timer = setTimeout(() => done({ ok: false, code: 'silent' }), CREATE_MS);
    try {
      client.send({ type: 'report.create', requestId, ...clean(c), title: c.title, fields: c.fields, ...(c.omit?.length ? { omit: c.omit } : {}) });
    } catch { done({ ok: false, code: 'silent' }); }
  });
}

/** « Ignorer » an agent's report: undefined once closed, else why not. */
export function ignoreReport(client: DaemonClient, task: string): Promise<'stale' | 'silent' | undefined> {
  return new Promise(resolve => {
    const requestId = rid('ignore');
    const done = (r: 'stale' | 'silent' | undefined) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'report.ignored' && m.requestId === requestId) done(m.ok ? undefined : m.code ?? 'stale'); });
    const timer = setTimeout(() => done('silent'), PREVIEW_MS);
    try { client.send({ type: 'report.ignore', requestId, task }); } catch { done('silent'); }
  });
}

/**
 * The user's own report while it is written (choice 5A): kept until it is sent or Ledge closes, whatever closes the window between.
 * One draft; an agent's report opened with « Modifier avant » does not touch it.
 */
export interface ReportDraft { kind: ReportKind; title: string; fields: ReportFields; omit: ReportItemKey[]; log: boolean }
export const EMPTY_DRAFT: ReportDraft = { kind: 'bug', title: '', fields: {}, omit: [], log: false };
let draft: ReportDraft = EMPTY_DRAFT;
export const reportDraft = (): ReportDraft => draft;
export const keepReportDraft = (d: ReportDraft): void => { draft = d; };
export const clearReportDraft = (): void => { draft = EMPTY_DRAFT; };
