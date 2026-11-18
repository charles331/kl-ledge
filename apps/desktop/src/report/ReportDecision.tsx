import { useEffect, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { ReportItem, Task } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { createReport, ignoreReport, previewReport } from './api';
import '../styles/report.css';

/**
 * An agent's report to approve (issue #9, card 5): who reports (its session and project), the title, its words, what would be
 * attached; « Créer l'issue » sends it as it is, « Modifier avant » opens the form prefilled, « Ignorer » puts it away. The agent
 * is told what came of it. Nothing reaches GitHub without the click.
 */
export function ReportDecision({ task, client, desktop, onEdit, onCreated, onOpenUrl }: {
  task: Task & { report: NonNullable<Task['report']> }; client: DaemonClient; desktop: string | null;
  onEdit(task: string): void; onCreated(n: number, url: string | undefined): void; onOpenUrl(url: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.report;
  const r = task.report;
  const [items, setItems] = useState<ReportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void previewReport(client, { kind: r.kind, task: task.id, ...(desktop ? { desktop } : {}) }).then(p => { if (live && p) setItems(p.items); });
    return () => { live = false; };
  }, [client, task.id, r.kind, desktop]);
  const create = async () => {
    setBusy(true); setError(null);
    const o = await createReport(client, { kind: r.kind, task: task.id, ...(desktop ? { desktop } : {}), title: r.title, fields: { detail: r.detail } });
    setBusy(false);
    if (o.ok) { onCreated(o.number, o.url); return; }
    if (o.url && (o.code === 'no_gh' || o.code === 'refused')) { setError(o.message ?? c.noGh); onOpenUrl(o.url); return; }
    setError(c.failed(o.code === 'silent' ? c.silent : o.code === 'stale' ? c.stale : o.message ?? c.invalid));
  };
  const ignore = async () => {
    setBusy(true); setError(null);
    const why = await ignoreReport(client, task.id);
    setBusy(false);
    if (why) setError(c.failed(why === 'silent' ? c.silent : c.stale));
  };
  // Shown items: the session's and project's are already said in the head.
  const shown = items.filter(it => it.key !== 'session' && it.key !== 'project');
  return (
    <div className="rd" data-report={task.id}>
      <div className="rd-h">
        <b>{r.kind === 'bug' ? c.agentBug(task.giverName) : c.agentIdea(task.giverName)}</b>
        {(r.session || r.project) && <small>{[r.session && `${c.from} ${r.session}`, r.project && `${c.proj} ${r.project}`].filter(Boolean).join(' · ')}</small>}
        <span className="rd-pill">{c.pill}</span>
      </div>
      <div className="rd-title">{r.title}</div>
      <p className="rd-detail">{r.detail}</p>
      {shown.length > 0 && <div className="rp-chips">{shown.map(it => <span key={it.key} className="rp-chip" data-item={it.key}><span className="k">{c.items[it.key]}</span> <span className="v">{it.value}</span></span>)}</div>}
      {error && <p className="decision-error" role="alert">{error}</p>}
      <div className="rd-acts">
        <button type="button" className="fg-btn pri" disabled={busy} onClick={() => { void create(); }}><Icon d={SHELL_ICONS.github} size={14} />{busy ? c.creating : c.approve}</button>
        <button type="button" className="fg-btn" disabled={busy} onClick={() => onEdit(task.id)}>{c.edit}</button>
        <button type="button" className="fg-btn ghost" disabled={busy} onClick={() => { void ignore(); }}>{c.ignore}</button>
      </div>
      <p className="rd-why">{c.agentWhy}</p>
    </div>
  );
}
