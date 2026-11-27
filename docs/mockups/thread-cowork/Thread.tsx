// The session thread redrawn as a conversation, in the manner of Claude Desktop's « Cowork »: one reading column, what the
// person wrote in a bubble on the right, what the agent says as plain prose, its work between two texts folded to one line, and
// beside the column what one keeps asking a thread: where the work plan stands, which files changed, which subagents ran.
// The build puts this file in the place of apps/desktop/src/session/Thread.tsx, with the same props: the page around it is the
// real one. New texts are written here in French; an implementation takes them to the i18n catalogue.
import { memo, useMemo, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { doneCount, latestTodos, type HelperItem, type ToolItem } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { elapsedMs, liveTool, target } from '@ledge/ui/thread/tools';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Thread as Today, type ThreadProps } from '../../../apps/desktop/src/session/Thread';
import { KIND_ICON, Spin } from '../../../apps/desktop/src/session/ActionGroup';
import { PlanCard } from '../../../apps/desktop/src/session/PlanCard';
import { changedFiles, nameOf, relativeTo } from '../../../apps/desktop/src/session/changedFiles';
import { parseDiff } from '../../../apps/desktop/src/session/diff';
import { clock, fmtDur, helperOf, kindOf, summarize, timeMark, verbOf, type Exchange, type Segment } from '../../../apps/desktop/src/session/exchanges';
import { helperState } from '../../../apps/desktop/src/atelier/layout';
import { useI18n } from '../../../apps/desktop/src/i18n/lang';
import { Thumbs } from '../../../apps/desktop/src/images/Thumbs';
import { cls } from '../../../apps/desktop/src/shell/cls';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';
import { StateBadge } from '../../../apps/desktop/src/shell/SessionBot';
import { asidesOf, closeAside, subscribeComposer } from './composer';
import { getPast, getVariant, subscribeVariant } from './variant';

export { Tags } from '../../../apps/desktop/src/session/Thread';
export type { ThreadProps, Waiting } from '../../../apps/desktop/src/session/Thread';

const KINDS = ['read', 'search', 'command', 'edit'] as const;
const DECIDED = { accept: 'Autorisé', always: 'Toujours autorisé', deny: 'Refusé', unknown: 'Répondu dans le terminal' } as const;

/** One action, as a line of an unfolded run: what it did, on what, its lines added and removed, and how long it took. */
function Step({ tool, now, onChange }: { tool: ToolItem; now: number; onChange(path: string): void }): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(tool.status === 'failed');
  const f = tool.files[0];
  const delta = useMemo(() => (f?.diff ? parseDiff(f.diff) : null), [f?.diff]);
  const detail = tool.error || tool.output || undefined;
  const failed = tool.status === 'failed';
  return (
    <li className={cls('cw-step', failed && 'failed')}>
      <div className="cw-step-line">
        <span className="cw-step-ico">{failed ? <Icon d={ICONS.close.d} size={13} /> : <Icon d={KIND_ICON[kindOf(tool.tool)]} size={13} />}</span>
        <span className="cw-step-verb">{th.verbs[verbOf(tool)]}</span>
        <button type="button" className="cw-step-target mono" title={tool.label} disabled={!detail} aria-expanded={detail ? open : undefined} onClick={() => setOpen(o => !o)}>{target(tool) || tool.tool}</button>
        {failed && <span className="cw-tag danger">{th.marks.failed}</span>}
        {delta && <span className="cw-delta mono"><b>+{delta.plus}</b>{delta.minus > 0 && <i>−{delta.minus}</i>}</span>}
        {f && tool.status === 'success' && <button type="button" className="cw-link" onClick={() => onChange(f.path)}>{th.seeChange}</button>}
        <span className="cw-step-time mono">{fmtDur(elapsedMs(tool, now), lang)}</span>
      </div>
      {open && detail && <pre className={cls('cw-out mono', !!tool.error && 'is-error')}>{detail}</pre>}
    </li>
  );
}

/** A run of actions, folded to one line that says how many, of which kinds, and how long; a failed one stays in sight under
 *  it. The action still running is not in it: the foot of the thread says it. */
function Steps({ tools, now, onChange, shots }: { tools: ToolItem[]; now: number; onChange(path: string): void; shots: Pick<ThreadProps, 'client' | 'onCapture'> & { id: string; who: string } }): JSX.Element | null {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [open, setOpen] = useState(false);
  const done = tools.filter(x => x.status !== 'running');
  if (done.length === 0) return null;
  const s = summarize(done, now, false);
  const kinds = KINDS.filter(k => s.kinds[k] > 0).map(k => th.kinds[k](s.kinds[k])).join(', ');
  return (
    <div className={cls('cw-steps', open && 'open')}>
      <button type="button" className="cw-steps-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon d={ICONS.chevronRight.d} size={13} />
        <strong>{th.actions(s.count)}</strong>
        <span className="cw-steps-kinds">{kinds}</span>
        {s.failed > 0 && <span className="cw-tag danger">{th.failed(s.failed).replace(/^[\s·]+/, '')}</span>}
        <span className="cw-step-time mono">{fmtDur(s.ms, lang)}</span>
      </button>
      {open
        ? <ol className="cw-steps-list">{done.map(x => <Step key={x.id} tool={x} now={now} onChange={onChange} />)}</ol>
        : s.failed > 0 && <ol className="cw-steps-list">{done.filter(x => x.status === 'failed').map(x => <Step key={x.id} tool={x} now={now} onChange={onChange} />)}</ol>}
      {/* What the actions captured (a browser screenshot) stays in sight under the line, folded or not. */}
      {tools.filter(x => x.images?.length).map(x => (
        <Thumbs key={x.id} className="cw-images" client={shots.client} refs={x.images!} route={{ id: shots.id }} max={{ w: 420, h: 260 }} who={shots.who} at={clock(x.at)} alt={t.images.capture} tag
          onOpen={shots.onCapture && (i => shots.onCapture!(x.id, i))} />
      ))}
    </div>
  );
}

/** The files an exchange changed, as chips under its answer: a click opens the change beside the thread. */
function FileChips({ tools, cwd, onChange }: { tools: ToolItem[]; cwd: string; onChange(path: string): void }): JSX.Element | null {
  const files = useMemo(() => {
    const by = new Map<string, { plus: number; minus: number }>();
    for (const x of tools) if (x.status === 'success') for (const f of x.files) {
      const d = f.diff ? parseDiff(f.diff) : { plus: 0, minus: 0 };
      const cur = by.get(f.path) ?? { plus: 0, minus: 0 };
      by.set(f.path, { plus: cur.plus + d.plus, minus: cur.minus + d.minus });
    }
    return [...by];
  }, [tools]);
  if (files.length === 0) return null;
  return (
    <div className="cw-files">
      {files.map(([path, d]) => (
        <button key={path} type="button" className="cw-file" title={relativeTo(path, cwd)} onClick={() => onChange(path)}>
          <Icon d={SHELL_ICONS.file} size={14} />
          <span>{nameOf(path)}</span>
          <span className="cw-delta mono"><b>+{d.plus}</b>{d.minus > 0 && <i>−{d.minus}</i>}</span>
        </button>
      ))}
    </div>
  );
}

interface TurnProps extends Pick<ThreadProps, 'client' | 'onCapture' | 'session' | 'items' | 'now' | 'dispatch' | 'onChange' | 'onDocument' | 'planOpen' | 'onPlan'> { x: Exchange; last: boolean; at: string; busy: boolean }

/** One exchange: the request, then what the agent said and did. A past exchange keeps its request and its answer in sight and
 *  folds everything between the two under « Travail »; the one under way shows each text as it comes. */
const Turn = memo(function Turn({ x, last, at, busy, client, onCapture, session, items, now, dispatch, onChange, onDocument, planOpen, onPlan }: TurnProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const [unfolded, setUnfolded] = useState(false);
  const tools = x.segments.flatMap(s => (s.kind === 'tools' ? s.tools : []));
  const sum = summarize(tools, now, false);
  // The answer: the last text of an exchange that is over.
  const answerAt = !busy ? x.segments.map(s => s.kind).lastIndexOf('say') : -1;
  const past = useSyncExternalStore(subscribeVariant, getPast, getPast);
  const fold = past === 'folded' && !last && answerAt > 0;
  const body = fold && !unfolded ? x.segments.slice(answerAt) : x.segments;

  const segment = (s: Segment, i: number): ReactNode => {
    if (s.kind === 'say') return s.item.text !== '' && <div key={s.item.id} className="cw-say agent-message"><div className="msg-body"><ThreadMarkdown text={s.item.text} onDocument={ref => onDocument(ref.path)} /></div><span className="cw-time mono">{clock(s.item.at)}</span></div>;
    if (s.kind === 'tools') return <Steps key={s.key} tools={s.tools} now={now} onChange={onChange} shots={{ client, onCapture, id: session.id, who: session.name }} />;
    if (s.kind === 'decision') return (
      <div key={s.item.id} className={cls('cw-decision', s.item.decision)}>
        <span className="cw-decision-chip"><b>{DECIDED[s.item.decision!]}</b><code className="mono">{s.item.text}</code></span>
        <span className="cw-time mono">{clock(s.item.at)}</span>
      </div>
    );
    if (s.kind === 'plan') return <div key={s.item.id} className="cw-plan"><PlanCard plan={s.plan} open={planOpen === s.plan.key} onOpen={onPlan} /></div>;
    if (s.kind === 'helper') {
      const h = helperOf(session, items, s.item.id, t.session.subagent)!;
      return (
        <button key={s.item.id} type="button" className="cw-helper" onClick={() => dispatch({ type: 'open', id: session.id, helper: s.item.id })}>
          <span className="cw-helper-ico"><Icon d={SHELL_ICONS.subagents} size={14} /></span>
          <span className="cw-helper-text"><strong>{h.kind}</strong><span>{(s.item as HelperItem).task}</span></span>
          <StateBadge state={helperState(h)} />
          <Icon d={ICONS.chevronRight.d} size={13} />
        </button>
      );
    }
    return <div key={i} className="cw-other mono">{s.kind}</div>;
  };

  return (
    <li className={cls('cw-turn', last && 'current')}>
      {x.prompt && (
        <div className={cls('cw-you', x.prompt.from === 'parent' && 'from-agent')}>
          {x.prompt.from === 'parent' && <span className="cw-you-who">{th.fromParent(session.name)}</span>}
          <p className="cw-bubble">{x.prompt.text}</p>
          {x.prompt.images && <Thumbs className="cw-images" client={client} refs={x.prompt.images} route={{ id: session.id }} max={{ w: 420, h: 260 }} who={th.you} at={clock(x.at)} align="end" />}
          <span className="cw-time mono">{at}</span>
        </div>
      )}
      {fold && (
        <button type="button" className={cls('cw-work', unfolded && 'open')} aria-expanded={unfolded} onClick={() => setUnfolded(o => !o)}>
          <Icon d={ICONS.chevronRight.d} size={13} />
          <strong>Travail</strong>
          <span>{th.actions(sum.count)}{sum.files > 0 && ` ${th.files(sum.files)}`}</span>
          {sum.failed > 0 && <span className="cw-tag danger">{th.failed(sum.failed).replace(/^[\s·]+/, '')}</span>}
          <span className="cw-step-time mono">{fmtDur(sum.ms, lang)}</span>
        </button>
      )}
      {body.map(segment)}
      {!busy && answerAt >= 0 && <FileChips tools={tools} cwd={session.cwd} onChange={onChange} />}
      {!busy && tools.length > 0 && (!fold || unfolded) && (
        <div className="cw-end"><span>{th.endOf} · {th.actions(sum.count)}{sum.files > 0 && ` ${th.files(sum.files)}`}</span></div>
      )}
    </li>
  );
});

/** A card of the column beside the thread: a title, a figure, and its rows; it folds to its title. */
function Card({ title, count, children }: { title: string; count?: string; children: ReactNode }): JSX.Element {
  return (
    <details className="cw-card" open>
      <summary><span>{title}</span>{count !== undefined && <span className="cw-count mono">{count}</span>}<Icon d={SHELL_ICONS.chevronDown} size={13} /></summary>
      <div className="cw-card-body">{children}</div>
    </details>
  );
}

function Cowork({ client, onCapture, session, helper, items, xs, now, dispatch, onChange, onDocument, planOpen, onPlan, waiting = null }: ThreadProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const state = (helper ?? session).state;
  const working = !offline && waiting === null && (state === 'working' || state === 'starting');
  const todos = useMemo(() => latestTodos(items, helper?.id), [items, helper?.id]);
  const files = useMemo(() => changedFiles(items, session.cwd, helper?.id), [items, session.cwd, helper?.id]);
  const kids = helper === null ? items.filter((i): i is HelperItem => i.kind === 'helper') : [];
  const lastTools = xs.at(-1)?.segments.flatMap(s => (s.kind === 'tools' ? s.tools : [])) ?? [];
  const run = working ? liveTool(lastTools) : undefined;
  const name = helper?.kind ?? session.name;
  const done = todos ? doneCount(todos) : 0;
  const asides = useSyncExternalStore(subscribeComposer, () => asidesOf(session.id), () => asidesOf(session.id));
  return (
    <div className="cw">
      <ol className="cw-col">
        {xs.map((x, i) => (
          <Turn key={x.key} x={x} last={i === xs.length - 1} at={timeMark(x.at, now, lang)} busy={i === xs.length - 1 && (working || waiting !== null)}
            client={client} onCapture={onCapture} session={session} items={items} now={now} dispatch={dispatch} onChange={onChange} onDocument={onDocument} planOpen={planOpen} onPlan={onPlan} />
        ))}
        {(working || waiting) && (
          <li key="foot" className={cls('cw-foot', waiting && 'waiting')} role="status">
            <span className="cw-foot-mark" aria-hidden="true">{waiting ? <i /> : <Spin live />}</span>
            {waiting ? <span className="cw-foot-text">{th.waits[waiting.kind](waiting.asker)} {th.resumes}</span>
              : run ? <><span className="cw-foot-text cw-shimmer">{th.verbs[verbOf(run)]} <code className="mono">{target(run) || run.tool}</code></span><span className="cw-step-time mono">{fmtDur(elapsedMs(run, now), lang)}</span></>
              : <span className="cw-foot-text cw-shimmer">{name} réfléchit…</span>}
          </li>
        )}
        {helper === null && asides.map(a => (
          <li key={`aside-${a.id}`} className="cw-aside">
            <div className="cw-aside-head"><span className="cw-aside-tag">btw</span><span>En aparté · hors du fil, {name} continue son travail</span><span className="cw-time mono">{clock(a.at)}</span>
              <button type="button" aria-label="Fermer l'aparté" title="Fermer l'aparté" onClick={() => closeAside(session.id, a.id)}><Icon d={ICONS.close.d} size={13} /></button></div>
            <p className="cw-aside-q">{a.question}</p>
            {a.answer !== null
              ? <div className="cw-aside-a agent-message"><div className="msg-body"><ThreadMarkdown text={a.answer} onDocument={ref => onDocument(ref.path)} /></div></div>
              : a.failed
              ? <div className="cw-aside-failed" role="status"><span>Ledge n'a pas pu lire la réponse : elle est dans le terminal de {name}.</span><button type="button" className="cw-link">Voir la vue Terminal</button></div>
              : <p className="cw-aside-wait cw-shimmer">{name} répond en aparté…</p>}
          </li>
        ))}
      </ol>
      <aside className="cw-side" aria-label="Résumé de la session">
        {todos && (
          <Card title="Progression" count={`${done}/${todos.length}`}>
            <span className="cw-bar" aria-hidden="true"><i style={{ width: `${(done / todos.length) * 100}%` }} /></span>
            <ol className="cw-todos">
              {todos.map((x, i) => (
                <li key={i} className={`is-${x.status}`}>
                  <span className="cw-box" aria-hidden="true">{x.status === 'completed' && <Icon d={ICONS.check.d} size={11} />}</span>
                  <span>{x.text}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
        {files.length > 0 && (
          <Card title="Fichiers modifiés" count={String(files.length)}>
            <ul className="cw-rows">
              {files.map(f => (
                <li key={f.path}>
                  <button type="button" title={f.shown} onClick={() => onChange(f.path)}>
                    <Icon d={SHELL_ICONS.file} size={14} />
                    <span className="cw-row-name">{nameOf(f.path)}</span>
                    <span className="cw-delta mono"><b>+{f.plus}</b>{f.minus > 0 && <i>−{f.minus}</i>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {kids.length > 0 && (
          <Card title="Sous-agents" count={String(kids.length)}>
            <ul className="cw-rows">
              {kids.map(k => {
                const h = helperOf(session, items, k.id, t.session.subagent)!;
                return (
                  <li key={k.id}>
                    <button type="button" title={k.task} onClick={() => dispatch({ type: 'open', id: session.id, helper: k.id })}>
                      <Icon d={SHELL_ICONS.subagents} size={14} />
                      <span className="cw-row-name">{h.kind}</span>
                      <StateBadge state={helperState(h)} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}

/** The thread the bar chose: today's rail, or the conversation. */
export const Thread = memo(function Thread(p: ThreadProps): JSX.Element {
  const variant = useSyncExternalStore(subscribeVariant, getVariant, getVariant);
  return variant === 'today' ? <Today {...p} /> : <Cowork {...p} />;
});
