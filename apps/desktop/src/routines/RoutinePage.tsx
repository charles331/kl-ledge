import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { RoutineSpec, Session } from '@ledge/protocol';
import type { DaemonClient, Fleet, FleetRoutine } from '@ledge/fleet';
import { useModels } from '../launch/useModels';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { ProviderLogo } from '../ide/ProviderLogo';
import { providerOf } from '../workspace/sessionTab';
import { AlarmIcon, ROUTINE_ICONS } from './icons';
import {
  draftErrors, failedLast, faultOf, hasErrors, refusalOf, whyText, type FormFault, type Refusal, isDirty, lastRunOf, proposalChanges, proposalFields, routineRef, specDraft, specOf, specPatch,
  type DraftErrors, type Proposal, type SpecDraft
} from './model';
import { RoutineForm, type PreviewState } from './RoutineForm';
import { sessionLook } from './RoutinesView';
import type { RoutineActions } from './useRoutineActions';
import { hhmm, localZone, previewable, runDay, sameSchedule, scheduleOf, dateLong } from './schedule';
import '../styles/routines.css';

/** What a page tells the app while its form differs from what is saved: the tab's « • » and the close question (card 4). */
export interface PageDirt { dirty: boolean; save(): Promise<boolean>; discard(): void }

export interface RoutinePageProps {
  /** The routine; null for « Nouvelle routine ». */
  routine: FleetRoutine | null;
  /** « Nouvelle routine »: what it starts from (« Programmer à nouveau… »: a one-shot with its name, session and prompt). */
  prefill?: SpecDraft | null;
  /** Where a new routine is created. */
  machine: string;
  /** The machines that keep routines, when there are several (card 28): the page names its machine, a new routine picks one. */
  machines?: readonly { id: string; label: string; up: boolean }[];
  onMachine?(id: string): void;
  /** The client « Nouvelle session » asks its models with: the new session's Modèle lists them (design-ux point 6). */
  client?: DaemonClient;
  /** The routine was deleted elsewhere while its tab was open (card 28): a sentence and « Fermer l’onglet » in place of the page. */
  gone?: boolean;
  /** The other routines of its machine: a name is unique per session. */
  others: readonly FleetRoutine[];
  /** The session it wakes, and the sessions the form offers (its machine's). */
  session?: Session | undefined; sessions: readonly Session[];
  dirLabel(path: string): string;
  /** Several routines a session proposed together that this one is part of (card 24), and how to reach the others. */
  group?: { proposal: Proposal; routines: readonly FleetRoutine[] } | null;
  /** The local daemon down: readable, every button and Enregistrer off (card 11). */
  offline: boolean;
  /** Bumped by « Supprimer… » from the sidebar: the page opens on its confirmation (card 10). */
  askDelete?: number;
  fleet: Pick<Fleet, 'routinePreview'>;
  actions: RoutineActions;
  onDirt(d: PageDirt): void;
  onOpenSession(): void; onOpenRoutine(r: FleetRoutine): void;
  /** A routine just created: its page replaces this one. */
  onCreated(r: FleetRoutine): void;
  /** Its tab closes (deleted, refused, created, « Annuler » of a new one). */
  onClose(): void;
  /** « Programmer à nouveau… »: a « Nouvelle routine » from this one, its date empty. */
  onAgain(prefill: SpecDraft): void;
  onBrowse?(): Promise<string | null>;
  now?(): number;
}

/** No client (a test): no models are asked. */
const NO_CLIENT = { send: () => {}, onMessage: () => () => {} } as unknown as DaemonClient;

const specOfRoutine = (r: FleetRoutine): RoutineSpec => ({ name: r.name, target: r.target, schedule: r.schedule, prompt: r.prompt, catchUp: r.catchUp });

/** The fields an error points to, in the form's order: the first is focused when Enregistrer meets one (card 4). */
const ORDER: readonly (keyof DraftErrors)[] = ['name', 'session', 'dir', 'times', 'days', 'anchor', 'at', 'past', 'prompt'];

/** A routine's page in its tab (cards 3-10, 19, 20, 22, 24): its head (name, state, Lancer maintenant / Relancer, Pause /
 *  Reprendre, ⋯), « Réveille X (état) dans dossier », the banner it calls for (a request, a session's change, a failure, the
 *  delete question, a past one-shot), its runs (the next 3, the last 5), then its configuration, editable in place: a change
 *  brings the « Modifications non enregistrées » bar, Ctrl+S saves. « Nouvelle routine » is the same page, empty, without runs. */
export function RoutinePage(p: RoutinePageProps): JSX.Element {
  const { t } = useI18n();
  if (p.gone) return (
    <div className="rtn-page rtn-gone" role="status"><span className="rtn-mut"><AlarmIcon size={22} /></span><span>{t.routines.gone}</span>
      <button type="button" className="fg-btn" onClick={p.onClose}>{t.routines.closeTab}</button></div>
  );
  return <RoutineBody {...p} />;
}

function RoutineBody(p: RoutinePageProps): JSX.Element {
  const { t, lang } = useI18n();
  const r = t.routines;
  const x = p.routine;
  const now = (p.now ?? Date.now)();
  // What the form compares with: a session's change shows the version asked (card 7), a request the routine as asked.
  const saved: RoutineSpec | null = x ? (x.proposal?.spec ?? specOfRoutine(x)) : null;
  const blank = useMemo(() => p.prefill ?? specDraft(), [p.prefill]);
  const [draft, setDraft] = useState<SpecDraft>(() => (saved ? specDraft(saved) : blank));
  const [shown, setShown] = useState<DraftErrors | null>(null);
  const [focus, setFocus] = useState<{ field: string; n: number } | null>(null);
  // The part a daemon's refusal names (its `field`): outlined, its error under it when the mockup has one.
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const savedKey = saved ? JSON.stringify(saved) : '';
  const dirty = isDirty(saved, draft, blank);
  // A change from elsewhere (the daemon, another front) replaces an untouched form.
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    lastSaved.current = savedKey;
    if (saved && !dirtyRef.current) setDraft(specDraft(saved));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => { if (p.askDelete) setDeleting(true); }, [p.askDelete]);
  useEffect(() => { setRefused(null); }, [draft]);

  // The models of the new session's tool on its machine, as « Nouvelle session » asks them; none until they answer.
  const models = useModels(p.client ?? NO_CLIENT, p.client && draft.mode === 'new' && (p.machines?.find(m => m.id === (x?.machineId ?? p.machine))?.up ?? true) ? (x?.machineId ?? p.machine) : null, draft.target.tool);
  const others = p.others.filter(o => !x || o.id !== x.id);
  const errors = draftErrors(draft, others, new Date(now));
  const shownErrors: DraftErrors = shown ?? {};

  // The next 3 runs: the daemon's for what is saved; asked again for a schedule changed or not saved yet (card 20).
  const schedKey = JSON.stringify(scheduleOf(draft.schedule));
  useEffect(() => {
    const sched = scheduleOf(draft.schedule);
    if (x && sameSchedule(sched, x.schedule) && x.nextRuns?.length) { setPreview({ runs: x.nextRuns, shift: false }); return; }
    if (!previewable(draft.schedule)) { setPreview(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      p.fleet.routinePreview(x?.machineId ?? p.machine, sched).then(res => {
        if (!live) return;
        const shift = !!x?.nextRuns?.length && res.nextRuns.join() !== x.nextRuns.join();
        setPreview({ runs: res.nextRuns, shift, ...(res.reason ? { reason: res.reason } : {}) });
      }, () => { if (live) setPreview(null); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [schedKey, x?.nextRuns?.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (): Promise<boolean> => {
    if (p.offline || busy) return false;
    if (hasErrors(errors)) {
      setShown(errors);
      const first = ORDER.find(k => errors[k] !== undefined);
      if (first) setFocus(f => ({ field: first === 'past' ? 'at' : first, n: (f?.n ?? 0) + 1 }));
      return false;
    }
    setBusy(true);
    // Every refusal of the form is said under its field, in the front's words (card 28); offline and outdated stay toasts.
    p.actions.refusedBy(fail => {
      if (fail.code === 'offline' || fail.code === 'outdated') return false;
      const said = refusalOf(fail, draft, r);
      setRefused(said);
      const part = said.part;
      const at = part === 'dir' ? (draft.mode === 'new' ? 'dir' : 'session') : part === 'at' || part === 'schedule' ? (draft.schedule.kind === 'once' ? 'at' : 'times') : part;
      if (at) setFocus(f => ({ field: at, n: (f?.n ?? 0) + 1 }));
      return true;
    });
    try {
      if (!x) {
        const made = await p.actions.add(p.machine, specOf(draft));
        if (made) { setDraft(blank); p.onCreated({ ...made, machineId: p.machine }); }
        return !!made;
      }
      const patch = specPatch(specOfRoutine(x), draft);
      if (!Object.keys(patch).length) return true;
      const done = await p.actions.update(x, patch);
      if (done) { setShown(null); lastSaved.current = ''; setDraft(specDraft(done)); }
      return !!done;
    } finally { setBusy(false); p.actions.refusedBy(null); }
  };
  const discard = () => { setDraft(saved ? specDraft(saved) : blank); setShown(null); setRefused(null); };
  const latest = useRef({ save, discard });
  latest.current = { save, discard };
  useEffect(() => { p.onDirt({ dirty, save: () => latest.current.save(), discard: () => latest.current.discard() }); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    else if (e.key === 'Escape' && deleting) { e.preventDefault(); e.stopPropagation(); setDeleting(false); }
  };

  const off = p.offline;
  const ref = x ? routineRef(x) : null;
  const running = ref ? p.actions.running.get(ref) : undefined;
  const look = sessionLook(p.session, t);
  const who = x ? (x.createdBy.kind === 'session' ? x.createdBy.name : x.proposal?.by.name ?? '') : '';
  const last = x ? lastRunOf(x) : undefined;
  const failed = !!x && x.state !== 'done' && failedLast(x);
  const fault: FormFault | null = failed ? faultOf(last) : null;
  const done = x?.state === 'done';
  const pending = x?.state === 'pending';
  const run = () => { if (x) p.actions.run(x, x.target.name, !!p.session && look.dot !== 'off'); };
  const activate = async (which: FleetRoutine) => {
    const own = which.id === x?.id;
    const ok = await p.actions.approve(which, own && dirty ? specOf(draft) : undefined);
    if (ok && own) { lastSaved.current = ''; }
  };
  const refuse = async (which: FleetRoutine) => {
    const ok = await p.actions.refuse(which);
    if (ok && which.id === x?.id && pending) p.onClose();
    else if (ok && which.id === x?.id) discard();
  };

  const btn = (label: ReactNode, onClick: () => void, o: { pri?: boolean; disabled?: boolean; title?: string } = {}) => (
    <button type="button" className={`fg-btn${o.pri ? ' pri' : ''}`} disabled={o.disabled} title={o.title} onClick={onClick}>{label}</button>
  );
  const banner = (kind: 'ask' | 'bad' | 'plain', head: ReactNode, body: ReactNode, go: ReactNode, role: 'status' | 'alert' = 'status') => (
    <div className={`rtn-bn ${kind}`} role={role}><div className="rtn-bn-t"><b>{head}</b>{body && <p>{body}</p>}</div>{go && <div className="rtn-bn-go">{go}</div>}</div>
  );

  let top: ReactNode = null;
  if (x && deleting) {
    top = banner('bad', r.delQ(x.name), r.delWhy(x.target.name), <>
      <button type="button" className="fg-btn" autoFocus onClick={() => setDeleting(false)}>{r.cancel}</button>
      <button type="button" className="fg-btn rtn-dangerfill" disabled={off} onClick={() => { void p.actions.remove(x).then(ok => { if (ok) p.onClose(); }); }}>{r.delGo}</button>
    </>, 'alert');
  } else if (x && pending && p.group && p.group.routines.length > 1) {
    const g = p.group;
    top = banner('ask', r.groupBanner(g.proposal.who, g.proposal.ids.length, hhmm(g.proposal.task.at)), <>
      <span className="rtn-links">{g.routines.map((o, i) => <span key={o.id}>{i > 0 && ' · '}<button type="button" className="rtn-link" aria-current={o.id === x.id || undefined} onClick={() => p.onOpenRoutine(o)}>{o.id === x.id ? <b>{o.name}</b> : o.name}</button></span>)}</span><br />{r.groupBannerHint}
    </>, <>
      {btn(r.activateAll(g.routines.length), () => { for (const o of g.routines) void activate(o); }, { pri: true, disabled: off })}
      {btn(r.activateThis, () => { void activate(x); }, { disabled: off })}
      {btn(r.refuseThis, () => { void refuse(x); }, { disabled: off })}
    </>);
  } else if (x && pending) {
    top = banner('ask', r.pendBanner(who, hhmm(x.createdAt)), r.pendEditHint, <>{btn(r.activate, () => { void activate(x); }, { pri: true, disabled: off })}{btn(r.refuse, () => { void refuse(x); }, { disabled: off })}</>);
  } else if (x?.proposal) {
    const changes = proposalChanges(x, lang, r);
    top = banner('ask', r.editAsk(x.proposal.by.name), <>
      {changes.map(c => <span key={c.label} className="rtn-change">{c.label} : <span className="rtn-mono"><s>{c.before}</s> → {c.after}</span></span>)}
      <span>{r.editOld}</span>
    </>, <>{btn(r.activate, () => { void activate(x); }, { pri: true, disabled: off })}{btn(r.refuse, () => { void refuse(x); }, { disabled: off })}</>);
  } else if (x && failed && last) {
    top = banner('bad', r.failBanner(hhmm(last.slotAt ?? last.at), whyText(last, x.target, p.dirLabel, r)), fault ? r.failHint : null,
      btn(<><Icon d={SHELL_ICONS.play} size={12} />{r.retry}</>, run, { pri: true, disabled: off || !!running }), 'alert');
  } else if (x && done && last) {
    top = banner('plain', r.ranOn(`${dateLong(new Date(last.at), lang)} ${hhmm(last.at)}`, r.out[last.outcome]), r.readonly, null);
  }

  const pill = !x ? null : <span className={`rtn-pill ${x.state === 'pending' ? 'ask' : x.state === 'enabled' ? 'ok' : ''}`}>{r.state[x.state]}</span>;
  const more = x && (
    <Menu open={menu} onOpenChange={setMenu} label={r.more} className="session-menu-wrap rtn-more" menuClassName="session-menu"
      trigger={tr => <button type="button" ref={tr.ref} aria-haspopup="menu" aria-expanded={tr['aria-expanded']} onClick={tr.onClick} className="fg-btn rtn-icon" title={r.more} aria-label={r.more}><Icon d={[]} fill={SHELL_ICONS.dots} size={14} /></button>}>
      <MenuItem onSelect={() => { setMenu(false); p.onOpenSession(); }}><span><Icon d={ROUTINE_ICONS.open} size={14} />{r.openSession}</span></MenuItem>
      <hr />
      {done
        ? <MenuItem className="rtn-danger" disabled={off} onSelect={() => { setMenu(false); void p.actions.remove(x).then(ok => { if (ok) p.onClose(); }); }}><span><Icon d={SHELL_ICONS.trash} size={14} />{r.forget}</span></MenuItem>
        : <MenuItem className="rtn-danger" disabled={off} onSelect={() => { setMenu(false); setDeleting(true); }}><span><Icon d={SHELL_ICONS.trash} size={14} />{r.del}</span></MenuItem>}
    </Menu>
  );
  const actions = !x ? null : done
    ? <>{btn(r.again, () => p.onAgain({ ...specDraft(specOfRoutine(x)), schedule: { ...specDraft().schedule, kind: 'once' } }))}{more}</>
    : pending ? more
    : <>
      {btn(<><Icon d={SHELL_ICONS.play} size={12} />{failed ? r.retry : r.runNow}</>, run, { pri: failed, disabled: off || !!running })}
      {btn(<><Icon d={x.state === 'paused' ? SHELL_ICONS.play : SHELL_ICONS.pause} size={12} />{x.state === 'paused' ? r.resume : r.pause}</>, () => (x.state === 'paused' ? p.actions.resume(x) : p.actions.pause(x)), { disabled: off || !!running })}
      {more}
    </>;

  const nextList = !x ? null : pending ? <li className="rtn-mut">{r.noneUntil}</li> : x.state === 'paused' ? <li className="rtn-mut">{r.noneWhilePaused}</li>
    : (x.nextRuns ?? []).map(n => <li key={n}><span className="rtn-mono">{hhmm(n)}</span><span className="rtn-mut">{runDay(n, new Date(now), lang, r)}</span></li>);
  const runs = x?.runs ?? (x?.lastRun ? [x.lastRun] : []);
  const pastList = !runs.length ? <li className="rtn-mut">{r.never}</li> : runs.map((u, i) => (
    <li key={`${u.at}:${i}`}>
      <span className={`rtn-mk ${u.outcome === 'failed' ? 'bad' : 'ok'}`} aria-hidden="true">{u.outcome === 'failed' ? '!' : '✓'}</span>
      <span className="rtn-mono">{u.slot}</span><span className="rtn-mut">{runDay(u.slotAt ?? u.at, new Date(now), lang, r)}</span><span>{r.out[u.outcome]}</span>
      {u.late && <><span className="rtn-pill late">{r.late}</span><span className="rtn-mut">{r.lateLong(u.slot, hhmm(u.at))}</span></>}
      {u.outcome === 'failed' && (u.reason || u.field) && <span className="rtn-reason">{whyText(u, x!.target, p.dirLabel, r)}</span>}
    </li>
  ));

  return (
    <div className="rtn-page" data-keep-scroll onKeyDown={onKey}>
      <div className="rtn-hd">
        <AlarmIcon size={18} /><h3>{x ? x.name : r.newTitle}</h3>{pill}
        {running && <span className="rtn-line rtn-mut"><span className="rtn-spin" aria-hidden="true" />{running}</span>}
        <span className="rtn-sp" />{actions}
      </div>
      {x ? (
        <div className="rtn-wakes">{r.wakes} <ProviderLogo provider={providerOf(x.target.tool)} size={12} /><b>{x.target.name}</b>
          <span className={`rtn-dot ${look.dot}`} aria-hidden="true" /><span className="rtn-mut">{look.label}</span><span className="rtn-mut">{r.inDir}</span>
          <span className="rtn-mono">{p.dirLabel(x.target.cwd)}</span>
          {p.machines && p.machines.length > 1 && <span className="rtn-mut">· {p.machines.find(m => m.id === x.machineId)?.label ?? x.machineId}</span>}
          <button type="button" className="fg-btn ghost" onClick={p.onOpenSession}><Icon d={ROUTINE_ICONS.open} size={12} />{r.openSession}</button></div>
      ) : <span className="rtn-lede">{r.sub} <span className="rtn-mut">({localZone()})</span></span>}
      {top}
      {x && (
        <section className="rtn-sect" aria-label={r.runs}><h4>{r.runs}</h4>
          <div className={`rtn-runs${done ? ' one' : ''}`}>
            {!done && <div><div className="rtn-lbl">{r.nextRuns}</div><ul>{nextList}</ul></div>}
            <div><div className="rtn-lbl">{r.pastRuns}</div><ul>{pastList}</ul></div>
          </div>
        </section>
      )}
      <section className={`rtn-sect${done ? ' ro' : ''}`} aria-label={r.config}><h4>{r.config}</h4>
        <RoutineForm draft={draft} onChange={setDraft} errors={shownErrors} focus={focus} fault={fault} refusal={refused}
          machines={!x && p.machines && p.machines.length > 1 && p.onMachine ? { choices: p.machines, value: p.machine, onChange: p.onMachine } : null}
          models={models.models.map(m => ({ id: m.id, label: m.label }))} asked={x?.proposal ? new Set(proposalFields(x)) : undefined}
          readOnly={done} sessions={p.sessions} dirLabel={p.dirLabel} preview={preview} lastSlot={last?.slot ?? null} {...(p.onBrowse ? { onBrowse: p.onBrowse } : {})} />
      </section>
      {!x ? (
        <div className="rtn-dirtybar"><span className="rtn-sp" />
          {btn(r.cancel, p.onClose)}{btn(r.create, () => { void save(); }, { pri: true, disabled: off || busy })}</div>
      ) : dirty && !done ? (
        <div className="rtn-dirtybar" role="status"><span className="rtn-dot ask" aria-hidden="true" /><span>{r.dirty}</span><span className="rtn-sp" />
          {btn(r.discard, discard)}{btn(r.save, () => { void save(); }, { pri: true, disabled: off || busy })}</div>
      ) : null}
    </div>
  );
}
