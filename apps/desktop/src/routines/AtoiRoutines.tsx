import { useState, type JSX } from 'react';
import type { FleetRoutine } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { AlarmIcon } from './icons';
import { lastRunOf, type AtoiRoutineItem } from './model';
import { askParts, dayMonth, firstMoment, momentDate, momentLabel } from './schedule';
import '../styles/routines.css';

/** What an « À toi » routine item does (cards 13, 14, 23): « Activer » / « Refuser » a request (or each routine of a grouped one),
 *  « Relancer » a failure, « Voir » its page; « × » takes one routine out of a grouped request (refuses it alone). */
export interface AtoiRoutineHandlers {
  dirLabel(r: FleetRoutine): string;
  onActivate(rs: readonly FleetRoutine[]): void; onRefuse(rs: readonly FleetRoutine[]): void;
  onRetry(r: FleetRoutine): void; onSee(r: FleetRoutine): void;
  /** The local daemon down: the buttons wait. */
  offline?: boolean;
}

const reasonOf = (i: AtoiRoutineItem): string => i.task.routine?.reason ?? lastRunOf(i.routines[0]!)?.reason ?? '';

/** The page « À toi »'s block « Routines » (cards 13, 23), after Décisions; hidden when nothing waits. A request: « ? », the
 *  spec's line, « Voir le prompt » unfolding it, Activer / Refuser. Several one-shots asked together: one item, a line per routine
 *  with its « × », Activer les n / Refuser les n. A failure: « ! », its reason, Relancer / Voir. */
export function AtoiRoutinesBlock({ items, ...h }: AtoiRoutineHandlers & { items: readonly AtoiRoutineItem[] }): JSX.Element | null {
  const { t, lang } = useI18n();
  const r = t.routines;
  const a = r.atoi;
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  if (!items.length) return null;
  const flip = (id: string) => setUnfolded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const off = h.offline;
  const seeBtn = (id: string) => (
    <button type="button" className="fg-btn ghost" aria-expanded={unfolded.has(id)} onClick={() => flip(id)}>{unfolded.has(id) ? `▾ ${a.hidePrompt}` : `▸ ${a.seePrompt}`}</button>
  );
  const prompts = (rs: readonly FleetRoutine[]) => [...new Set(rs.map(x => x.prompt))];
  return (
    <div className="fg-blk" data-block="routines">
      <div className="fg-blk-h"><span className="fg-mut rt-ico" aria-hidden="true"><AlarmIcon size={14} /></span><b>{a.block}</b><span className="fg-sub">{items.length} · {a.blockSub}</span></div>
      <div className="fg-blk-b">{items.map(i => {
        const id = i.task.id;
        const first = i.routines[0]!;
        if (i.kind === 'failed') return (
          <div key={id} className="atoi-line" data-routine-item={id}>
            <span className="atoi-mk bad" aria-hidden="true">!</span>
            <span className="grow">{a.failed(first.name, first.target.name, reasonOf(i))}</span>
            <button type="button" className="fg-btn pri" disabled={off} onClick={() => h.onRetry(first)}>{r.retry}</button>
            <button type="button" className="fg-btn" onClick={() => h.onSee(first)}>{r.see}</button>
          </div>
        );
        if (i.routines.length > 1) {
          const ps = prompts(i.routines);
          return (
            <div key={id} className="rt-atoi-group" data-routine-item={id}>
              <div className="atoi-line"><span className="atoi-mk asked" aria-hidden="true">?</span>
                <span className="grow wrap"><b>{i.task.giverName}</b> {a.groupAsk(i.routines.length)}{i.task.text ? <span className="fg-mut"> · {i.task.text}</span> : null}</span></div>
              <div className="rt-glist">{i.routines.map(x => {
                const m = firstMoment(x.schedule);
                return (
                  <div key={x.id} className="atoi-line">
                    <span className="rt-mono rt-gwhen">{m ? momentLabel(m, lang) : ''}</span><b className="rt-gname">{x.name}</b><span className="grow" />
                    <button type="button" className="fg-btn ghost rt-icon" disabled={off} title={r.drop} aria-label={`${r.drop} · ${x.name}`} onClick={() => h.onRefuse([x])}>×</button>
                  </div>
                );
              })}</div>
              <div className="atoi-line rt-end">{seeBtn(id)}
                <button type="button" className="fg-btn pri" disabled={off} onClick={() => h.onActivate(i.routines)}>{r.activateAll(i.routines.length)}</button>
                <button type="button" className="fg-btn" disabled={off} onClick={() => h.onRefuse(i.routines)}>{r.refuseAll(i.routines.length)}</button></div>
              {unfolded.has(id) && ps.map((x, k) => <div key={k} className="rt-unfold">{x}</div>)}
            </div>
          );
        }
        const parts = askParts(first.proposal?.spec.schedule ?? first.schedule, lang, r);
        return (
          <div key={id} data-routine-item={id}>
            <div className="atoi-line"><span className="atoi-mk asked" aria-hidden="true">?</span>
              <span className="grow"><b>{i.task.giverName}</b> {a.ask(first.name, parts.times, parts.days, h.dirLabel(first))}</span>
              {seeBtn(id)}
              <button type="button" className="fg-btn pri" disabled={off} onClick={() => h.onActivate([first])}>{r.activate}</button>
              <button type="button" className="fg-btn" disabled={off} onClick={() => h.onRefuse([first])}>{r.refuse}</button></div>
            {unfolded.has(id) && <div className="rt-unfold">{first.proposal?.spec.prompt ?? first.prompt}</div>}
          </div>
        );
      })}</div>
    </div>
  );
}

/** The sidebar's « À toi » (card 14): the same items, short: who · routine, the text on two lines at most, the buttons below.
 *  « Voir » opens the routine's page (a grouped request: its first). */
export function AtoiRoutineCards({ items, ...h }: AtoiRoutineHandlers & { items: readonly AtoiRoutineItem[] }): JSX.Element {
  const { t, lang } = useI18n();
  const r = t.routines;
  const a = r.atoi;
  const off = h.offline;
  return <>{items.map(i => {
    const first = i.routines[0]!;
    const failed = i.kind === 'failed';
    const text = failed ? a.failedShort(first.name, reasonOf(i))
      : i.routines.length > 1 ? a.groupShort(i.routines.length, i.routines.map(x => { const m = firstMoment(x.schedule); return m ? dayMonth(momentDate(m), lang) : ''; }).filter(Boolean).join(', '))
      : (() => { const parts = askParts(first.proposal?.spec.schedule ?? first.schedule, lang, r); return a.ask(first.name, parts.times, parts.days, h.dirLabel(first)); })();
    return (
      <div key={i.task.id} className="st-card st-task rt-st-card" data-routine-item={i.task.id}>
        <span className={`st-bot st-task-mark rt-mk ${failed ? 'bad' : 'ask'}`} aria-hidden="true">{failed ? '!' : '?'}</span>
        <div className="st-card-body">
          <div className="st-l1"><span className="st-req"><strong>{failed ? first.target.name : i.task.giverName}</strong> · {a.kind}</span></div>
          <span className="rt-st-text" title={text}>{text}</span>
          <div className="rt-st-acts">
            {failed
              ? <button type="button" className="st-qa pri" disabled={off} onClick={() => h.onRetry(first)}>{r.retry}</button>
              : <>
                <button type="button" className="st-qa pri" disabled={off} onClick={() => h.onActivate(i.routines)}>{i.routines.length > 1 ? r.activateAll(i.routines.length) : r.activate}</button>
                <button type="button" className="st-qa" disabled={off} onClick={() => h.onRefuse(i.routines)}>{r.refuse}</button>
              </>}
            <button type="button" className="st-qa ghost" onClick={() => h.onSee(first)}>{r.see}</button>
          </div>
        </div>
      </div>
    );
  })}</>;
}
