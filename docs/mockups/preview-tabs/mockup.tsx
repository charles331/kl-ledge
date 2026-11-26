// Spec 2026-11-26-preview-tabs-design.md §5.5: the preview tab of Ledge Desktop. A single click opens a tab the next single
// click replaces in place; a double click keeps it; its title is in italic. The real DockHost (dockview, PanelTab, the
// strip's tools) and SessionTabLabel on mockup workspaces; the preview itself (one per group, §5.1) is kept by the mockup,
// since the model does not have it yet, and drawn as a class on the tab's label.
import { useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@ledge/protocol';
import { LangProvider, useI18n } from '../../../apps/desktop/src/i18n/lang';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { DockHost } from '../../../apps/desktop/src/ide/DockHost';
import { SessionTabLabel } from '../../../apps/desktop/src/ide/SessionTabLabel';
import { tabTitle } from '../../../apps/desktop/src/ide/tabs';
import { activate, find, focused, keyOf, MAIN, open, type Group, type Tab, type Workspace } from '../../../apps/desktop/src/workspace/model';
import { createWorkspaceStore } from '../../../apps/desktop/src/workspace/store';

type Lang = 'fr' | 'en';
const q = new URLSearchParams(location.search);

const S = (id: string, name: string, tool: Session['tool'], state: Session['state'], rig?: string): Session =>
  ({ id, name, tool, state, machineId: 'local', cwd: '~/Workspace/ledge', source: 'ledge', ...(rig ? { rig: { name: rig } } : {}) }) as unknown as Session;
const SESSIONS: Session[] = [
  S('pim', 'Pim', 'claude', 'working'), S('nova', 'Nova', 'claude', 'idle'), S('sol', 'Sol', 'cursor', 'waiting_input'),
  S('iris', 'Iris', 'codex', 'waiting_permission'), S('kai', 'Kai', 'codex', 'working'), S('dev-front', 'dev-front', 'claude', 'idle', 'ledge-dev')
];
const PRS: Record<string, string> = { p226: '#226', p41: '!41' };
const ROUTINES: Record<string, string> = { r1: 'point-du-matin' };

const T = {
  pim: { kind: 'session', ref: 'pim' }, nova: { kind: 'session', ref: 'nova' }, sol: { kind: 'session', ref: 'sol' },
  iris: { kind: 'session', ref: 'iris' }, kai: { kind: 'session', ref: 'kai' }, front: { kind: 'seat', ref: 'dev-front' },
  atoi: { kind: 'atoi', ref: 'main' }, p226: { kind: 'pr', ref: 'p226' }, p41: { kind: 'pr', ref: 'p41' }, r1: { kind: 'routine', ref: 'r1' }
} satisfies Record<string, Tab>;

/** A workspace of the main window: its groups left to right ([id, tabs, the one in front]), the first focused. */
const W = (groups: [string, Tab[], number][], focus = groups[0]![0]): Workspace =>
  ({ version: 1, windows: [MAIN], groups: groups.map(([id, tabs, active]) => ({ id, window: MAIN, tabs, active, link: null })), focus, next: 10 });
/** Each group's preview tab, by its key (the model's future `Group.preview`). */
type Prev = Record<string, string>;
const P = (...pairs: [string, Tab][]): Prev => Object.fromEntries(pairs.map(([g, t]) => [g, keyOf(t)]));

/** The mockup's words. */
const MK = {
  fr: {
    title: 'Onglets d’aperçu · un clic regarde, un double clic garde', spec: 'spec 2026-11-26, §5.5',
    lede: <>Un simple clic ouvre un <b>onglet d’aperçu</b>, que le clic suivant remplace à sa place ; un double clic le <b>garde</b>. Agir dans l’aperçu le garde aussi (§5.4). La seule marque décidée : <b>le titre de l’aperçu est en italique</b>, comme dans VS Code. Ce sont les vrais onglets de Desktop (dockview, <code>DockHost</code>, <code>SessionTabLabel</code>) ; seul l’italique est ajouté.</>,
    tryH: 'Essaie', list: 'Projets (simplifié)',
    help: <>Clic sur une ligne : <b>aperçu</b>, qui remplace l’aperçu du groupe. Double clic sur une ligne : onglet <b>gardé</b>. Double clic sur l’onglet d’aperçu : il est gardé. <kbd>Ctrl</kbd>+clic : l’aperçu du groupe de droite. Le bouton de split et le glisser-déposer sont ceux de Desktop.</>,
    reset: 'Recommencer',
    dblH: 'Double clic sur l’aperçu : il est gardé',
    dblBefore: 'Avant : Nova en aperçu', dblAfter: 'Après le double clic : Nova est gardé',
    dblNote: <>Le titre se redresse ; rien d’autre ne bouge. Le prochain simple clic ouvrira un nouvel aperçu à droite de Nova.</>,
    repH: 'Un nouveau simple clic remplace l’aperçu, à sa place',
    repBefore: 'Avant : Nova en aperçu, entre Pim et #226', repAfter: 'Après un clic sur Sol dans Projets',
    repNote: <>Sol prend <b>la place</b> de Nova, qui se ferme : il n’avait servi qu’à regarder. #226, ouvert gardé depuis la palette, ne bouge pas.</>,
    splitH: 'Deux groupes : un aperçu chacun',
    splitNote: <>À gauche, Nova est l’aperçu, en retrait : italique et gris. À droite, la routine est l’aperçu de ce groupe. Un clic ne remplace que l’aperçu du groupe actif ; <kbd>Ctrl</kbd>+clic, celui du groupe de droite.</>,
  },
  en: {
    title: 'Preview tabs · a click looks, a double click keeps', spec: 'spec 2026-11-26, §5.5',
    lede: <>A single click opens a <b>preview tab</b>, which the next click replaces in place; a double click <b>keeps</b> it. Acting in the preview keeps it too (§5.4). The one mark decided: <b>the preview’s title is in italic</b>, as in VS Code. These are Desktop’s real tabs (dockview, <code>DockHost</code>, <code>SessionTabLabel</code>); only the italic is added.</>,
    tryH: 'Try it', list: 'Projects (simplified)',
    help: <>Click a line: a <b>preview</b>, replacing the group’s preview. Double-click a line: a <b>kept</b> tab. Double-click the preview tab: it is kept. <kbd>Ctrl</kbd>+click: the right group’s preview. The split button and drag and drop are Desktop’s.</>,
    reset: 'Start again',
    dblH: 'Double-click the preview: it is kept',
    dblBefore: 'Before: Nova as the preview', dblAfter: 'After the double click: Nova is kept',
    dblNote: <>The title straightens; nothing else moves. The next single click opens a new preview right of Nova.</>,
    repH: 'Another single click replaces the preview, in its place',
    repBefore: 'Before: Nova as the preview, between Pim and #226', repAfter: 'After a click on Sol in Projects',
    repNote: <>Sol takes <b>Nova’s place</b>; Nova closes, it was only looked at. #226, opened kept from the palette, stays.</>,
    splitH: 'Two groups: one preview each',
    splitNote: <>On the left, Nova is the preview, behind: italic and grey. On the right, the routine is that group’s preview. A click replaces only the active group’s preview; <kbd>Ctrl</kbd>+click, the right group’s.</>,
  }
} as const;

/** One editing area: the real DockHost on its own store, and the previews (§5.1) the mockup keeps beside it. */
function Scene({ lang, ws: init, prev: initPrev, width, height = 132, list }: { lang: Lang; ws: Workspace; prev: Prev; width: number; height?: number; list?: boolean }): JSX.Element {
  const { t } = useI18n();
  const m = MK[lang];
  const [store, setStore] = useState(() => createWorkspaceStore(init));
  const [run, setRun] = useState(0);
  const ws = useSyncExternalStore(store.subscribe, store.get);
  const [prev, setPrev] = useState(initPrev);
  const reset = () => { setStore(createWorkspaceStore(init)); setPrev(initPrev); setRun(n => n + 1); };
  // A preview stays one while it sits in its group: closed, or dragged elsewhere, it is not one any more (§5.1, §5.4).
  const live = (w: Workspace, g: Group): string | undefined => (prev[g.id] && g.tabs.some(x => keyOf(x) === prev[g.id]) ? prev[g.id] : undefined);
  const isPreview = (key: string) => ws.groups.some(g => live(ws, g) === key);
  const pin = (key: string) => setPrev(p => Object.fromEntries(Object.entries(p).filter(([, k]) => k !== key)));

  /** §5.1 `open(w, tab, where, { preview: true })`: already open, brought forward; else it takes the place of the target
   *  group's preview, or is appended, and becomes the preview. `right`: the group right of the focused one (made if none). */
  const openPreview = (tab: Tab, right: boolean) => {
    const w = store.get();
    if (find(w, keyOf(tab))) { store.update(x => open(x, tab)); return; }
    const mains = w.groups.filter(g => g.window === MAIN);
    const target = right ? mains[mains.findIndex(g => g.id === focused(w).id) + 1] : focused(w);
    if (!target) {
      store.update(x => open(x, tab, 'right'));
      const g = focused(store.get());
      setPrev(p => ({ ...p, [g.id]: keyOf(tab) }));
      return;
    }
    const pk = live(w, target);
    const at = pk ? target.tabs.findIndex(x => keyOf(x) === pk) : -1;
    const tabs = at >= 0 ? target.tabs.map((x, i) => (i === at ? tab : x)) : [...target.tabs, tab];
    store.update(x => activate({ ...x, groups: x.groups.map(g => (g.id === target.id ? { ...g, tabs } : g)) }, target.id, at >= 0 ? at : tabs.length - 1));
    setPrev(p => ({ ...p, [target.id]: keyOf(tab) }));
  };
  /** §5.3: a double click opens kept; a preview opened kept is kept. */
  const openKept = (tab: Tab) => { pin(keyOf(tab)); store.update(x => open(x, tab)); };

  const ctx = { session: (id: string) => SESSIONS.find(s => s.id === id), t, pr: (id: string) => PRS[id], routine: (r: string) => ROUTINES[r] };
  const title = (tab: Tab) => tabTitle(tab, ctx);
  const label = (tab: Tab): ReactNode => {
    const k = keyOf(tab);
    const s = tab.kind === 'session' || tab.kind === 'seat' ? ctx.session(tab.ref) : undefined;
    return (
      <span className={`mk-pv${isPreview(k) ? ' on' : ''}`} data-k={k}>
        {s ? <SessionTabLabel session={s} tab={tab} title={title(tab)} /> : <span className="tab-name">{title(tab)}</span>}
      </span>
    );
  };
  const body = (tab: Tab): ReactNode => (
    <div className="mk-tab-body"><span><b>{title(tab)}</b></span><div className="mk-line" style={{ width: '62%' }} /><div className="mk-line" style={{ width: '44%' }} /><div className="mk-line" style={{ width: '53%' }} /></div>
  );

  const dock = (
    <div className="mk-ide" style={list ? { height: '100%' } : { width, height }}
      onDoubleClick={e => { const k = (e.target as HTMLElement).closest('.dv-tab')?.querySelector('[data-k]')?.getAttribute('data-k'); if (k) pin(k); }}>
      <div className="ide" style={{ height: '100%' }}>
        <section className="ide-editor"><div className="ide-dock-area">
          <DockHost key={run} ws={ws} store={store} title={title} body={body} label={label}
            alert={() => null} onTabMenu={() => {}} onNewSession={() => {}} emptyGroup={() => null} />
        </div></section>
      </div>
    </div>
  );
  if (!list) return dock;

  const rows: [Tab, string][] = [[T.pim, '●'], [T.nova, '●'], [T.sol, '●'], [T.iris, '●'], [T.kai, '●'], [T.front, '◆'], [T.atoi, '✦'], [T.p226, '⑂'], [T.p41, '⑂'], [T.r1, '⏰']];
  const openKeys = new Set(ws.groups.flatMap(g => g.tabs.map(keyOf)));
  // A double click also fires two clicks: the first opens the preview, the double click then keeps it (VS Code's way).
  return (
    <div className="mk-fig">
      <div className="mk-try" style={{ width }}>
        <nav className="mk-list" aria-label={m.list}>
          <h3>{m.list}</h3>
          {rows.map(([tab, ico]) => (
            <button key={keyOf(tab)} type="button" className={openKeys.has(keyOf(tab)) ? 'open' : undefined}
              onClick={e => openPreview(tab, e.ctrlKey || e.metaKey)} onDoubleClick={() => openKept(tab)}>
              <span className="mk-ico" aria-hidden="true">{ico}</span>{title(tab)}
            </button>
          ))}
        </nav>
        {dock}
      </div>
      <p className="mk-help">{m.help}</p>
      <button type="button" className="mk-reset" onClick={reset}>{m.reset}</button>
    </div>
  );
}

function Fig({ kicker, note, rec, children }: { kicker: string; note?: ReactNode; rec?: boolean; children: ReactNode }): JSX.Element {
  return <div className={`mk-fig${rec ? ' rec' : ''}`}><p className="mk-kicker">{kicker}</p>{children}{note && <p className="mk-note">{note}</p>}</div>;
}

function Page({ lang }: { lang: Lang }): JSX.Element {
  const m = MK[lang];
  return (
    <main className="mk-main">
      <p className="mk-lede">{m.lede}</p>

      <section className="mk-sect" id="try"><h2>{m.tryH}</h2>
        <Scene lang={lang} list width={1180} ws={W([['g1', [T.pim, T.atoi, T.nova], 2]])} prev={P(['g1', T.nova])} />
      </section>

      <section className="mk-sect" id="dbl"><h2>{m.dblH}</h2>
        <div className="mk-row">
          <Fig kicker={m.dblBefore}><div id="dbl-before"><Scene lang={lang} width={560} ws={W([['g1', [T.pim, T.atoi, T.p226, T.nova], 3]])} prev={P(['g1', T.nova])} /></div></Fig>
          <span className="mk-arrow" aria-hidden="true">→</span>
          <Fig kicker={m.dblAfter}><div id="dbl-after"><Scene lang={lang} width={560} ws={W([['g1', [T.pim, T.atoi, T.p226, T.nova], 3]])} prev={{}} /></div></Fig>
        </div>
        <p className="mk-note">{m.dblNote}</p>
      </section>

      <section className="mk-sect" id="rep"><h2>{m.repH}</h2>
        <div className="mk-row">
          <Fig kicker={m.repBefore}><div id="rep-before"><Scene lang={lang} width={560} ws={W([['g1', [T.pim, T.nova, T.p226], 1]])} prev={P(['g1', T.nova])} /></div></Fig>
          <span className="mk-arrow" aria-hidden="true">→</span>
          <Fig kicker={m.repAfter}><div id="rep-after"><Scene lang={lang} width={560} ws={W([['g1', [T.pim, T.sol, T.p226], 1]])} prev={P(['g1', T.sol])} /></div></Fig>
        </div>
        <p className="mk-note">{m.repNote}</p>
      </section>

      <section className="mk-sect" id="split"><h2>{m.splitH}</h2>
        <div id="split-fig"><Scene lang={lang} width={980} ws={W([['g1', [T.pim, T.atoi, T.nova], 0], ['g2', [T.iris, T.p41, T.r1], 2]])} prev={P(['g1', T.nova], ['g2', T.r1])} /></div>
        <p className="mk-note" style={{ maxWidth: 980 }}>{m.splitNote}</p>
      </section>

    </main>
  );
}

function App(): JSX.Element {
  const [lang, setLang] = useState<Lang>((q.get('lang') as Lang) ?? 'fr');
  const [theme, setTheme] = useState<'dark' | 'light'>((q.get('theme') as 'dark' | 'light') ?? 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = lang;
  const m = MK[lang];
  const seg = <V extends string>(v: V, set: (x: V) => void, opts: [V, string][]) => (
    <span className="mk-seg" role="radiogroup">{opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => set(k)}>{l}</button>)}</span>
  );
  return (
    <LangProvider lang={lang} key={lang}>
      <div className="mk-bar"><b>{m.title}</b><span className="mk-mut">{m.spec}</span><span className="mk-fill" />
        {seg(lang, setLang, [['fr', 'FR'], ['en', 'EN']])}{seg(theme, setTheme, [['dark', lang === 'fr' ? 'Sombre' : 'Dark'], ['light', lang === 'fr' ? 'Clair' : 'Light']])}</div>
      <Page lang={lang} />
    </LangProvider>
  );
}

await Promise.all([loadMessages('fr'), loadMessages('en')]);
createRoot(document.getElementById('root')!).render(<App />);
