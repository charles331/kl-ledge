import type { Session, ThreadItem } from '@ledge/protocol';

/* The daemon, simulated in the page: a WebSocket that answers what the IDE asks with this file's fixtures. Nothing leaves
   the page. The shapes are those of apps/desktop/e2e/daemon.ts, which the app's own specs run on. Three sessions tell the
   thread's three moments: Pim waits for an agreement, Nova works, Ida is done. */

const T0 = Date.now();
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const session = (id: string, extra: Partial<Session>): Session =>
  ({ id, name: id, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: id, tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: at(-7200), lastActivityAt: at(-300), source: 'launcher', ...extra }) as Session;

const PLAYWRIGHT = 'pnpm --filter desktop exec playwright test e2e/workspace.spec.ts';
const sessions: Session[] = [
  session('pim', { name: 'Pim', state: 'waiting_permission', branch: 'feat/ide-shell', model: 'claude-opus-5-5', effort: 'high', context: { used: 124_000, window: 200_000, at: at(0) },
    pending: { kind: 'permission', text: PLAYWRIGHT, tool: 'Bash', source: 'hook' } }),
  session('nova', { name: 'Nova', tool: 'codex', state: 'working', branch: 'fix/term-webgl', context: { used: 168_000, window: 200_000, at: at(0) } }),
  session('ida', { name: 'Ida', state: 'idle', branch: 'docs/ide-workspace-mockup', topic: 'Maquette de l\'espace de travail' }),
  session('tom', { name: 'Tom', tool: 'omp', project: 'synapse', cwd: '/w/synapse', state: 'waiting_input', branch: 'main', pending: { kind: 'question', text: 'Quel port pour le relais ?', source: 'hook' } }),
  session('echo', { name: 'Echo', project: 'synapse', cwd: '/w/synapse', state: 'working', branch: 'test/notifications' })
] as Session[];

const D = '/w/ledge/apps/desktop/';
const tool = (id: string, s: number, turn: number, name: string, label: string, extra: Record<string, unknown> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: at(s), turn, tool: name, label, status: 'success', files: [], ...extra }) as ThreadItem;
const edit = (id: string, s: number, turn: number, name: 'Edit' | 'Write', file: string, diff: string, ms = 300): ThreadItem =>
  tool(id, s, turn, name, D + file, { durationMs: ms, files: [{ path: D + file, change: name === 'Write' ? 'add' : 'edit', diff }] });
const PLAN = ['Lire la coque actuelle', 'Créer WorkspaceShell', 'Monter les écrans dans les onglets', 'Écrire le scénario Playwright', 'Vérifier le rechargement'];
const ACTIVE = ['Lecture de la coque actuelle', 'Création de WorkspaceShell', 'Montage des écrans dans les onglets', 'Écriture du scénario Playwright', 'Vérification du rechargement'];
/** Claude Code's work plan with its first `done` tasks completed and the next one in progress. */
const todo = (id: string, s: number, turn: number, done: number): ThreadItem => tool(id, s, turn, 'TodoWrite', '', { durationMs: 10,
  input: JSON.stringify({ todos: PLAN.map((content, i) => ({ content, activeForm: ACTIVE[i], status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' })) }) });
const codexPlan = (id: string, s: number, done: number): ThreadItem => tool(id, s, 1, 'update_plan', '', { durationMs: 10,
  input: JSON.stringify({ plan: ['Trouver où WebGL est activé', 'Lâcher le contexte d\'un terminal masqué', 'Lancer les tests du terminal', 'Vérifier seize onglets ouverts'].map((step, i) => ({ step, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' })) }) });

const threads: Record<string, ThreadItem[]> = {
  pim: [
    { kind: 'prompt', id: 'p1', at: at(-2400), turn: 1, text: 'Monte la coque de l\'IDE : barre d\'activité, zone à onglets, et les écrans actuels dedans tels quels. Garde l\'Atelier comme premier onglet.' },
    { kind: 'message', id: 'm1', at: at(-2395), turn: 1, text: 'Je commence par lire `App.tsx` pour voir où la coque actuelle est montée.' },
    todo('td1', -2392, 1, 0),
    tool('t1', -2390, 1, 'Read', D + 'src/App.tsx', { durationMs: 400 }),
    tool('t2', -2386, 1, 'Grep', '<Shell', { durationMs: 300 }),
    tool('t3', -2382, 1, 'Read', D + 'src/shell/Shell.tsx', { durationMs: 300 }),
    { kind: 'helper', id: 'h1', at: at(-2378), turn: 1, task: 'Recenser les écrans montés par Shell et leurs raccourcis clavier', agentType: 'Explore', state: 'exited' },
    tool('h1a', -2376, 1, 'Grep', 'useScreenKeys', { durationMs: 500, helperId: 'h1' }),
    tool('h1b', -2372, 1, 'Read', D + 'src/nav/screenKeys.ts', { durationMs: 300, helperId: 'h1' }),
    { kind: 'reply', id: 'h1r', at: at(-2360), turn: 1, helperId: 'h1', text: 'Sept écrans sont montés par `Shell`. Leurs raccourcis passent tous par `useScreenKeys`.' },
    { kind: 'message', id: 'm2', at: at(-2350), turn: 1, text: 'La coque tient en un composant. Je crée `WorkspaceShell` et j\'y déplace les écrans.' },
    todo('td2', -2348, 1, 1),
    edit('t4', -2340, 1, 'Write', 'src/shell/WorkspaceShell.tsx', '+ export function WorkspaceShell() {\n+   return (\n+     <IdeFrame activity={<ActivityBar />}>\n+       <DockHost />\n+     </IdeFrame>\n+   );\n+ }', 900),
    edit('t5', -2330, 1, 'Edit', 'src/App.tsx', '- <Shell />\n+ <WorkspaceShell />', 200),
    edit('t6', -2322, 1, 'Edit', 'src/nav/screenKeys.ts', '- const order = SCREENS;\n- const first = order[0];\n+ const order = tabsOf(workspace);\n+ const first = order[0] ?? \'atelier\';\n+ // Ctrl+1…9 follow the tabs\' order.\n+ export const tabAt = (n: number) => order[n - 1];', 250),
    tool('t7', -2310, 1, 'Bash', 'pnpm --filter desktop typecheck', { durationMs: 6800, output: '> desktop@0.63.0 typecheck\n> tsc --noEmit\n' }),
    todo('td3', -2300, 1, 3),
    { kind: 'reply', id: 'r1', at: at(-2296), turn: 1, text: 'La coque est en place et le typecheck passe.\n\n- **`WorkspaceShell`** porte la barre d\'activité et la zone à onglets.\n- Les écrans actuels y sont montés tels quels, l\'Atelier en premier onglet.\n- Les raccourcis `Ctrl+1…9` suivent l\'ordre des onglets.\n\nIl reste le scénario Playwright de l\'espace de travail.' },

    { kind: 'prompt', id: 'p2', at: at(-900), turn: 2, text: 'Ajoute le scénario Playwright, et vérifie que les onglets survivent à un rechargement.' },
    tool('t8', -895, 2, 'Read', D + 'e2e/ide-shell.spec.ts', { durationMs: 300 }),
    edit('t9', -885, 2, 'Write', 'e2e/workspace.spec.ts', '+ test(\'tabs survive a reload\', async ({ page }) => {\n+   await openTab(page, \'Réglages\');\n+   await page.reload();\n+   await expect(tab(page, \'Réglages\')).toBeVisible();\n+ });', 700),
    { kind: 'permission', id: 'perm1', at: at(-880), turn: 2, tool: 'Bash', text: 'pnpm --filter desktop exec playwright install chromium', decision: 'accept' },
    tool('t10', -870, 2, 'Bash', 'pnpm --filter desktop exec playwright install chromium', { durationMs: 41_000 }),
    tool('t11', -825, 2, 'Bash', PLAYWRIGHT, { durationMs: 12_400, status: 'failed', error: '  1) workspace.spec.ts:12 › tabs survive a reload\n     Error: expect(locator).toBeVisible()\n     Locator: getByRole(\'tab\', { name: \'Réglages\' })\n  1 failed' }),
    { kind: 'message', id: 'm3', at: at(-810), turn: 2, text: 'Le rechargement perd l\'onglet actif : l\'espace de travail est lu avant d\'être restauré. Je corrige l\'ordre.' },
    edit('t12', -800, 2, 'Edit', 'src/workspace/store.ts', '- const state = read();\n+ await restore();\n+ const state = read();\n+ if (state.focus === undefined) state.focus = state.groups[0]?.id;', 300),
    todo('td4', -795, 2, 4),
    { kind: 'reply', id: 'r2', at: at(-790), turn: 2, text: 'Le scénario est écrit et la cause de l\'échec est corrigée : l\'onglet actif était lu **avant** la restauration de l\'espace de travail.\n\nJe n\'ai pas relancé le test après le correctif.' },

    { kind: 'prompt', id: 'p3', at: at(-320), turn: 3, text: 'Lance-le.' },
    { kind: 'message', id: 'm4', at: at(-316), turn: 3, text: 'Je relance le scénario Playwright sur le correctif.' },
    { kind: 'permission', id: 'perm', at: at(-312), turn: 3, tool: 'Bash', text: PLAYWRIGHT }
  ] as ThreadItem[],
  nova: [
    { kind: 'prompt', id: 'p1', at: at(-420), turn: 1, text: 'Les terminaux masqués gardent leur contexte WebGL : au bout de seize onglets, Chromium en ferme. Fais-les le lâcher.' },
    codexPlan('pl1', -415, 0),
    tool('t1', -410, 1, 'Grep', 'WebglAddon', { durationMs: 300 }),
    tool('t2', -404, 1, 'Read', D + 'src/term/Term.tsx', { durationMs: 300 }),
    { kind: 'message', id: 'm1', at: at(-390), turn: 1, text: 'Un terminal caché n\'a pas besoin de WebGL. Je le fais passer sur le rendu DOM ; il reprend WebGL quand son onglet redevient visible.' },
    codexPlan('pl2', -388, 1),
    edit('t3', -380, 1, 'Edit', 'src/term/Term.tsx', '- addon.activate(term);\n+ if (visible) addon.activate(term);\n+ else addon.dispose();', 200),
    edit('t4', -372, 1, 'Edit', 'src/term/useTerms.ts', '+ useEffect(() => { for (const t of terms) t.setVisible(t.id === front); }, [terms, front]);', 200),
    codexPlan('pl3', -60, 2),
    tool('t5', -48, 1, 'Bash', 'pnpm --filter desktop test term', { status: 'running' })
  ] as ThreadItem[],
  ida: [
    { kind: 'prompt', id: 'p1', at: at(-7200), turn: 1, text: 'Prépare la maquette de l\'espace de travail : groupes d\'onglets, glisser-déposer et fenêtres détachées.' },
    tool('pl', -7150, 1, 'ExitPlanMode', '', { durationMs: 20, input: JSON.stringify({ plan: '# Maquette de l\'espace de travail\n\n1. **Inventaire** — les écrans qui deviennent des onglets.\n2. **Groupes** — scinder, déplacer un onglet d\'un groupe à l\'autre.\n3. **Fenêtres détachées** — un groupe sorti de la fenêtre.\n4. **Captures** — les états en sombre et en clair.' }) }),
    tool('t1', -7100, 1, 'Read', '/w/ledge/docs/mockups/ledge-ide-interactive.html', { durationMs: 500 }),
    tool('t2', -7000, 1, 'Write', '/w/ledge/docs/mockups/ledge-ide-workspace.html', { durationMs: 2400, files: [{ path: '/w/ledge/docs/mockups/ledge-ide-workspace.html', change: 'add', diff: '+ <!doctype html>\n+ <title>Ledge · espace de travail</title>' }] }),
    tool('t3', -6900, 1, 'Bash', 'node docs/mockups/shots.mjs workspace', { durationMs: 38_000 }),
    { kind: 'reply', id: 'r1', at: at(-6850), turn: 1, text: 'La maquette de l\'espace de travail est prête, avec ses captures en sombre et en clair.\n\n1. Un onglet se glisse d\'un groupe à l\'autre ou sur un bord pour scinder.\n2. Un groupe sort de la fenêtre par son menu ; il garde ses onglets.\n\nDis-moi si le repère du groupe actif te convient.' }
  ] as ThreadItem[]
};

const snapshot = () => ({ type: 'snapshot', sessions, launcher: ['ledge'], daemon: { version: '0.63.0', install: 'npm', systemd: true, routing: true } });
const projects = { projects: [
  { id: 'ledge', name: 'ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'synapse', name: 'synapse', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/synapse' }] }
], rules: [] };
const usage = { harnesses: [
  { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: inMin(-1), windows: [{ kind: 'five_hour', pct: 84, resetsAt: inMin(65) }, { kind: 'seven_day', pct: 41, resetsAt: inMin(4000) }] },
  { harness: 'codex', account: null, status: 'ok', readAt: inMin(-2), windows: [{ kind: 'five_hour', pct: 22, resetsAt: inMin(170) }, { kind: 'seven_day', pct: 63, resetsAt: inMin(4000) }] }
], alerts: [], prefs: { alert: 0.8 } };

type Msg = Record<string, any>;
class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    // Only the local daemon answers: another machine stays unreachable.
    const local = /127\.0\.0\.1:47831\/?$/.test(url);
    setTimeout(() => {
      if (!local) { this.readyState = 3; this.onclose?.(); return; }
      this.readyState = 1; this.onopen?.();
      this.push(snapshot()); this.push({ type: 'machines', machines: [{ id: 'local', label: 'WSL' }] }); this.push({ type: 'projects', projects });
      this.push({ type: 'island', prefs: null }); this.push({ type: 'usage.state', ...usage });
    }, 0);
  }
  push(m: Msg) { queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) }); }); }
  send(data: string) {
    let m: Msg; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'ping') this.push({ type: 'pong', requestId: m.requestId });
    if (m.type === 'session.thread' && threads[m.id]) this.push({ type: 'session.thread', id: m.id, items: threads[m.id] });
    if (m.type === 'term.watch') this.push({ type: 'term.opened', id: m.id, cols: m.cols, rows: m.rows, screen: `${m.id} $ `, cursor: { x: m.id.length + 3, y: 0 } });
    if (m.type === 'models.list') this.push({ type: 'models.listing', requestId: m.requestId, tool: m.tool, models: [] });
    if (m.type === 'session.commands') this.push({ type: 'session.commands.listing', requestId: m.requestId, id: m.id, tool: 'claude', commands: [{ name: 'btw', description: 'Question en aparté : la session répond sans interrompre son travail, hors du fil', argumentHint: '<question>', source: 'builtin' }] });
    if (m.type === 'repos.info') this.push({ type: 'repos.info', requestId: m.requestId, repos: m.paths.map((path: string) => ({ path, exists: true, branch: 'main' })) });
    if (m.type === 'chat.history') this.push({ type: 'chat.history', turns: [] });
    if (m.type === 'chat.ask') {
      const text = '**Pim** attend ton accord pour lancer Playwright (projet ledge). **Tom** a une question sur synapse : « Quel port pour le relais ? ». Nova et Echo travaillent, Ida est au repos.';
      this.push({ type: 'chat.step', qid: m.qid, step: { kind: 'sessions' } }); this.push({ type: 'chat.delta', qid: m.qid, text }); this.push({ type: 'chat.done', qid: m.qid, text, at: new Date().toISOString() });
    }
    // An answer to Pim's request: the session goes back to work, its decision joins the thread, and when it is a yes the command runs.
    if (m.type === 'session.decide') {
      const i = sessions.findIndex(s => s.id === m.id); if (i < 0) return;
      const { pending: _p, ...rest } = sessions[i] as Msg; sessions[i] = { ...rest, state: 'working' } as Session; this.push({ type: 'session.updated', session: sessions[i] });
      if (m.id !== 'pim') return;
      const now = new Date().toISOString();
      const decided = { kind: 'permission', id: 'perm', at: now, turn: 3, tool: 'Bash', text: PLAYWRIGHT, decision: m.decision === 'deny' ? 'deny' : m.decision === 'always' ? 'always' : 'accept' } as ThreadItem;
      threads.pim = threads.pim!.map(x => (x.id === 'perm' ? decided : x)); this.push({ type: 'session.thread.item', id: 'pim', item: decided });
      if (m.decision !== 'deny') { const run = tool('t13', 0, 3, 'Bash', PLAYWRIGHT, { status: 'running', at: now }); threads.pim.push(run); this.push({ type: 'session.thread.item', id: 'pim', item: run }); }
    }
  }
  close() { this.readyState = 3; }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

// The free shell of the bottom panel: a stand-in that prints a prompt and echoes what is typed (as the e2e build's).
const enc = new TextEncoder();
const w = window as unknown as Record<string, unknown>;
w.__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
w.__ledgeFakePty = { open: async (_argv: string[], _size: unknown, on: { data: (d: Uint8Array) => void }) => {
  queueMicrotask(() => on.data(enc.encode('\x1b[2m~/Workspace/ledge\x1b[0m\r\n\x1b[32m$\x1b[0m pnpm --filter desktop test:e2e ide-shell\r\n\x1b[32m  ✓\x1b[0m ide-shell.spec.ts \x1b[2m(14 tests) 9.2 s\x1b[0m\r\n\x1b[32m$\x1b[0m ')));
  return { write: (d: string) => on.data(enc.encode(d)), resize: () => {}, close: () => {} };
} };
