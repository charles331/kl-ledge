import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { REPORT_LABEL, REPORT_REPO, REPORT_TEXT_MAX, REPORT_TITLE_MAX, type ReportFields, type ReportItem, type ReportItemKey, type ReportKind, type Task } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { SHELL_ICONS } from '../shell/icons';
import { clearReportDraft, createReport, keepReportDraft, previewReport, reportDraft, type ReportDraft, type ReportPreview } from './api';
import '../styles/report.css';

/** The fields of each kind, in the form's order (cards 2 and 3); `repro` is the only optional one shown as such. */
const FIELDS: Record<ReportKind, readonly ('happened' | 'expected' | 'repro' | 'need' | 'context' | 'proposal')[]> = {
  bug: ['happened', 'expected', 'repro'],
  feature: ['need', 'context', 'proposal']
};
/** A field one line high in the mockup (cards 2 and 3); the others are text areas. */
const ONE_LINE = new Set(['expected', 'repro', 'context', 'proposal']);
/** The fields marked « facultatif ». */
const OPTIONAL = new Set(['repro', 'proposal']);

/** An agent's report opened with « Modifier avant »: its kind and title, its words where the form asks what happened (a bug) or the need (an idea). */
export function draftOfTask(task: Task & { report: NonNullable<Task['report']> }): ReportDraft {
  const r = task.report;
  return { kind: r.kind, title: r.title, fields: r.kind === 'bug' ? { happened: r.detail } : { need: r.detail }, omit: [], log: false };
}

/**
 * « Signaler » (issue #9, docs/mockups/ledge-report.html, cards 2 to 4): Bug or Idée, the title and the kind's fields, what is
 * attached (each item removable, struck through until put back), the daemon log's excerpt (unchecked; checked, shown as it would
 * go), where it goes. « Créer l'issue » (Ctrl ↵) asks the daemon, which creates it with gh: the window closes and the toast says
 * its number. Without a title nothing is sent. gh not signed in or GitHub refusing: « Ouvrir sur GitHub » opens the prefilled
 * page; what was written stays (5A: the user's draft is kept until sent or Ledge closes).
 */
export function ReportDialog({ client, desktop, session, task, onClose, onCreated, onOpenUrl }: {
  client: DaemonClient; desktop: string | null;
  /** The session in front, on this machine: its tool is attached. */
  session?: string;
  /** An agent's report opened with « Modifier avant »: the form starts from it, and the issue answers it. */
  task?: Task & { report: NonNullable<Task['report']> };
  onClose(): void; onCreated(n: number, url: string | undefined): void; onOpenUrl(url: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.report;
  const ids = useId();
  const [d, setD] = useState<ReportDraft>(() => (task ? draftOfTask(task) : reportDraft()));
  // The user's own draft is kept as it is written (an agent's report is not).
  useEffect(() => { if (!task) keepReportDraft(d); }, [d, task]);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [fallback, setFallback] = useState<{ url: string; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const ctx = { kind: d.kind, ...(task ? { task: task.id } : session ? { session } : {}), ...(desktop ? { desktop } : {}) };
  // What would be attached, and the log excerpt as it would go when asked (a bug only).
  const wantLog = d.kind === 'bug' && d.log;
  useEffect(() => {
    let live = true;
    void previewReport(client, { ...ctx, log: wantLog }).then(p => { if (live && p) setPreview(p); });
    return () => { live = false; };
  }, [client, d.kind, wantLog, task?.id, session, desktop]);

  const set = (patch: Partial<ReportDraft>) => { setD(x => ({ ...x, ...patch })); setFallback(null); setError(null); };
  const setField = (k: keyof ReportFields, v: string) => set({ fields: { ...d.fields, [k]: v } });
  const toggleItem = (k: ReportItemKey) => set({ omit: d.omit.includes(k) ? d.omit.filter(x => x !== k) : [...d.omit, k] });
  const title = d.title.trim();
  const fields = Object.fromEntries(FIELDS[d.kind].map(k => [k, (d.fields[k] ?? '').trim()]).filter(([, v]) => v)) as ReportFields;
  const send = async () => {
    setTried(true);
    if (!title) { titleRef.current?.focus(); return; }
    if (fallback) { onOpenUrl(fallback.url); return; }
    if (sending) return;
    setSending(true); setError(null);
    const r = await createReport(client, { ...ctx, ...(wantLog ? { log: true } : {}), title, fields, omit: d.omit });
    setSending(false);
    if (r.ok) { if (!task) clearReportDraft(); onCreated(r.number, r.url); return; }
    if (r.url && (r.code === 'no_gh' || r.code === 'refused')) { setFallback({ url: r.url, ...(r.code === 'refused' && r.message ? { message: r.message } : {}) }); return; }
    setError(c.failed(r.code === 'silent' ? c.silent : r.code === 'stale' ? c.stale : r.message ?? c.invalid));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); void send(); }
    else if (e.target instanceof HTMLInputElement) e.preventDefault();
  };
  const items = (preview?.items ?? []) as ReportItem[];
  const kind = (k: ReportKind, label: string, sub: string) => (
    <button type="button" role="radio" aria-checked={d.kind === k} className={`rp-kind${d.kind === k ? ' on' : ''}`} onClick={() => set({ kind: k })}>
      <b>{label}</b><span>{sub}</span>
    </button>
  );
  const showTitleError = tried && !title;
  return (
    <Modal title={c.title} icon={SHELL_ICONS.flag} className="report-modal" onClose={onClose}>
      <form className="rp" onSubmit={e => { e.preventDefault(); void send(); }} onKeyDown={onKeyDown}>
        <div className="rp-body">
          <div className="rp-kinds" role="radiogroup" aria-label={c.kinds}>{kind('bug', c.bug, c.bugSub)}{kind('feature', c.idea, c.ideaSub)}</div>
          <label className="rp-field" htmlFor={`${ids}-title`}>{c.tTitle}</label>
          <input id={`${ids}-title`} ref={titleRef} autoFocus value={d.title} maxLength={REPORT_TITLE_MAX} placeholder={c.tTitlePh} aria-invalid={showTitleError || undefined}
            aria-describedby={showTitleError ? `${ids}-title-error` : undefined} onChange={e => set({ title: e.target.value })} />
          {showTitleError && <span id={`${ids}-title-error`} className="rp-error" role="alert">{c.titleEmpty}</span>}
          {FIELDS[d.kind].map(k => (
            <div key={k} className="rp-group">
              <label className="rp-field" htmlFor={`${ids}-${k}`}>{c[k]}{OPTIONAL.has(k) && <small>{c.optional}</small>}</label>
              {ONE_LINE.has(k)
                ? <input id={`${ids}-${k}`} value={d.fields[k] ?? ''} maxLength={REPORT_TEXT_MAX} placeholder={c[`${k}Ph`]} onChange={e => setField(k, e.target.value)} />
                : <textarea id={`${ids}-${k}`} rows={2} value={d.fields[k] ?? ''} maxLength={REPORT_TEXT_MAX} placeholder={c[`${k}Ph`]} onChange={e => setField(k, e.target.value)} />}
            </div>
          ))}
          <section className="rp-attached" aria-labelledby={`${ids}-att`}>
            <div className="rp-att-h"><b id={`${ids}-att`}>{c.attached}</b><small>{c.attachedSub}</small></div>
            <div className="rp-chips">
              {items.map(it => {
                const off = d.omit.includes(it.key);
                const name = c.items[it.key];
                return (
                  <span key={it.key} className={`rp-chip${off ? ' off' : ''}`} data-item={it.key}>
                    <span className="k">{name}</span> <span className="v">{it.value}</span>
                    <button type="button" aria-label={off ? c.putBack(name) : c.remove(name)} aria-pressed={off} onClick={() => toggleItem(it.key)}><Icon d={ICONS.close.d} size={11} /></button>
                  </span>
                );
              })}
            </div>
            {d.kind === 'bug' && <>
              <label className="rp-log">
                <input type="checkbox" checked={d.log} onChange={e => set({ log: e.target.checked })} />
                <span><b>{c.log}</b><small>{c.logSub} {c.logSee}</small></span>
              </label>
              {d.log && preview?.log !== undefined && <pre className="rp-excerpt" aria-label={c.logSee}>{preview.log}</pre>}
            </>}
            <p className="rp-never">{c.never}</p>
          </section>
          <p className="rp-dest">{c.dest} <b>{REPORT_REPO}</b> · {c.label} <span className={`rp-label ${d.kind}`}>{REPORT_LABEL[d.kind]}</span> · {c.destBy}{preview?.login && <> <b>{preview.login}</b></>}</p>
        </div>
        <footer className="rp-foot">
          {fallback && <p className="rp-fallback" role="alert">{fallback.message ?? c.noGh}</p>}
          {error && <p className="rp-error" role="alert">{error}</p>}
          <span className="grow" />
          <Button variant="ghost" type="button" onClick={onClose}>{c.cancel}</Button>
          <Button variant="primary" type="submit" aria-disabled={sending}>
            {fallback ? <><Icon d={SHELL_ICONS.github} size={14} />{c.openGh}</> : sending ? c.creating : c.create}<Kbd>Ctrl ↵</Kbd>
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
