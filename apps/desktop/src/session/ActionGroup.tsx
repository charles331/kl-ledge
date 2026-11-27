import { useEffect, useLayoutEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { ToolItem } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { elapsedMs, SPINNER, SPINNER_STILL, target } from '@ledge/ui/thread/tools';
import type { DaemonClient } from '@ledge/fleet';
import { Thumbs } from '../images/Thumbs';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { parseDiff } from './diff';
import { clock, fmtDur, kindOf, summarize, verbOf, type ToolKind } from './exchanges';

const KINDS: readonly ToolKind[] = ['read', 'search', 'command', 'edit'];
export const KIND_ICON: Record<ToolKind, readonly string[]> = { read: SHELL_ICONS.file, search: SHELL_ICONS.search, command: SHELL_ICONS.terminal, edit: SHELL_ICONS.pencil };

/** A running action's spinner in text (the work plan's bar): it turns on its own (an image every 80 ms), so its ticks render
 *  nothing else; still with reduced motion, or when nothing runs live (offline). */
export function Spinner({ live }: { live: boolean }): JSX.Element {
  const { reduced } = useMotionPreferences();
  const turning = live && !reduced;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!turning) return;
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [turning]);
  return <>{turning ? SPINNER[frame] : SPINNER_STILL}</>;
}

/** The thread's spinner (the mockup's `.spin`): a turning ring, still with reduced motion (the app's setting; the OS one is
 *  the stylesheet's) or when nothing runs live. */
export function Spin({ live }: { live: boolean }): JSX.Element {
  const { reduced } = useMotionPreferences();
  return <span className={cls('spin', (!live || reduced) && 'still')} aria-hidden="true" />;
}

/** One action, as a line of an unfolded run: what it did, on what, its lines added and removed, and how long it took; a failed
 *  one shows its output until the reader hides it, the others on a click of their target. */
function Step({ tool, now, live, flash, onChange }: { tool: ToolItem; now: number; live: boolean; flash: boolean; onChange(path: string): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(tool.status === 'failed');
  const f = tool.files[0];
  const delta = useMemo(() => (f?.diff ? parseDiff(f.diff) : null), [f?.diff]);
  const running = tool.status === 'running';
  const detail = running ? undefined : tool.error || tool.output || undefined;
  const failed = tool.status === 'failed';
  const change = f !== undefined && tool.status === 'success';
  return (
    <li className={cls('cw-step action-row', `status-${tool.status}`, failed && 'failed', change && 'is-change', flash && 'flash')} data-tool={tool.id} {...(running && live && { role: 'status', 'aria-label': th.liveAction })}>
      <div className="cw-step-line">
        <span className="cw-step-ico">
          {running ? <span className="action-mark mark-running" role="img" aria-label={th.marks.running}><Spin live={live} /></span>
            : failed ? <span className="action-mark mark-failed" role="img" aria-label={th.marks.failed}><Icon d={ICONS.close.d} size={13} /></span>
            : tool.status === 'unknown' ? <span className="action-mark mark-unknown" role="img" aria-label={th.marks.unknown}>·</span>
            : <Icon d={KIND_ICON[kindOf(tool.tool)]} size={13} />}
        </span>
        <span className="cw-step-verb action-verb">{th.verbs[verbOf(tool)]}</span>
        <button type="button" className="cw-step-target action-target mono" title={tool.label} disabled={!detail} aria-expanded={detail ? open : undefined} onClick={() => setOpen(o => !o)}>{target(tool) || tool.tool}</button>
        {failed && <span className="cw-tag danger">{th.marks.failed}</span>}
        {tool.byClose && <span className="cw-tag danger">{th.questionByClose}</span>}
        {delta && <span className="cw-delta mono"><b>+{delta.plus}</b>{delta.minus > 0 && <i>−{delta.minus}</i>}</span>}
        {change && <button type="button" className="cw-link action-link" data-short={th.seeChangeShort} onClick={() => onChange(f.path)}>{th.seeChange}</button>}
        <span className="cw-step-time action-time mono" aria-hidden={running || undefined}>{tool.status === 'unknown' ? th.interrupted : fmtDur(elapsedMs(tool, now), lang)}</span>
      </div>
      {open && detail && <pre className={cls('cw-out action-output mono', !!tool.error && 'is-error')}>{detail}</pre>}
    </li>
  );
}

/**
 * A run of consecutive actions (issue #41, docs/mockups/ledge-thread-cowork.html), folded to one line that says how many, of
 * which kinds, the ones interrupted and failed, and how long; it opens on the list. A failed, interrupted or running action stays
 * in sight under the line, and what the actions captured too. A run reached from the Changes view opens and lights its action.
 * The work plan's updates in it are no actions: the summary beside the thread says where the plan stands. `live` false
 * (offline): nothing runs live, and `now` is the instant the thread froze.
 */
export function ActionGroup({ client, sessionId, who, onCapture, tools, todos, now, live, marker, flash = null, onChange }: {
  client: DaemonClient; sessionId: string;
  /** The session's name, in its captures' lightbox title. */
  who: string;
  /** A capture clicked, by its action and place: the page's own viewer. Absent, the thumbnail opens its own lightbox. */
  onCapture?(toolId: string, index: number): void;
  tools: ToolItem[];
  /** The work plan's updates that fell in this run (the segment's `todos`). */
  todos: ToolItem[];
  now: number; live: boolean;
  /** The unread marker's row, when the run opens what is new. */
  marker?: ReactNode;
  /** One of these actions, reached from the Changes view: the run opens and the action lights up. */
  flash?: string | null;
  onChange(path: string): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(() => flash !== null);
  // Before the page looks for the action to scroll it into view.
  useLayoutEffect(() => { if (flash !== null) setOpen(true); }, [flash]);
  const s = summarize(tools, now, live, todos);
  const kinds = KINDS.filter(k => s.kinds[k] > 0).map(k => th.kinds[k](s.kinds[k])).join(', ');
  const step = (x: ToolItem) => <Step key={x.id} tool={x} now={now} live={live} flash={x.id === flash} onChange={onChange} />;
  const inSight = tools.filter(x => x.status !== 'success');
  return <>
    {marker}
    <li className={cls('cw-steps', open && 'open')}>
      <button type="button" className="cw-steps-head action-summary" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon d={ICONS.chevronRight.d} size={13} />
        <strong>{th.actions(s.count)}</strong>
        <span className="cw-steps-kinds">{kinds}{s.cut > 0 && ` ${th.cut(s.cut)}`}</span>
        {s.failed > 0 && <span className="cw-tag danger">{th.failed(s.failed).replace(/^[\s·]+/, '')}</span>}
        <span className="cw-step-time mono">{fmtDur(s.ms, lang)}</span>
      </button>
      {open ? <ol className="cw-steps-list">{tools.map(step)}</ol>
        : inSight.length > 0 && <ol className="cw-steps-list">{inSight.map(step)}</ol>}
      {/* What the actions captured (a browser screenshot) stays in sight under the line, folded or not. */}
      {tools.filter(x => x.images?.length || x.imagesDropped).map(x => <div key={x.id} className="cw-shots" data-shots={x.id}>
        {x.images?.length ? <Thumbs className="cw-images action-captures" client={client} refs={x.images} route={{ id: sessionId }} max={{ w: 420, h: 260 }} who={who} at={clock(x.at)} alt={t.images.capture} tag
          onOpen={onCapture && (i => onCapture(x.id, i))} /> : null}
        {x.imagesDropped && <p className="action-dropped">{th.captureDropped}</p>}
      </div>)}
    </li>
  </>;
}
