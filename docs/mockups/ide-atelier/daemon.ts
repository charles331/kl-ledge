import type { Session, ThreadItem } from '@ledge/protocol';

/* The daemon, simulated in the page: a WebSocket that answers what the IDE asks with this file's fixtures. Nothing leaves
   the page. The shapes are those of apps/desktop/e2e/daemon.ts, which the app's own specs run on. */

const T0 = Date.now() - 5 * 60_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const session = (id: string, extra: Partial<Session>): Session =>
  ({ id, name: id, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: id, tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: at(-3600), lastActivityAt: at(0), source: 'launcher', ...extra }) as Session;

const sessions: Session[] = [
  session('pim', { name: 'Pim', state: 'waiting_permission', branch: 'feat/ide-shell', model: 'claude-opus-5-5', effort: 'high', context: { used: 124_000, window: 200_000, at: at(0) },
    pending: { kind: 'permission', text: 'pnpm --filter desktop exec playwright test e2e/workspace.spec.ts', tool: 'Bash', source: 'hook' } }),
  session('nova', { name: 'Nova', tool: 'codex', state: 'working', branch: 'fix/term-webgl', context: { used: 168_000, window: 200_000, at: at(0) } }),
  session('ida', { name: 'Ida', state: 'idle', branch: 'docs/ide-workspace-mockup', topic: 'Maquette de l\'espace de travail' }),
  session('tom', { name: 'Tom', tool: 'omp', project: 'synapse', cwd: '/w/synapse', state: 'waiting_input', branch: 'main', pending: { kind: 'question', text: 'Quel port pour le relais ?', source: 'hook' } }),
  session('echo', { name: 'Echo', project: 'synapse', cwd: '/w/synapse', state: 'working', branch: 'test/notifications' })
] as Session[];

const tool = (id: string, s: number, name: string, label: string, extra: Record<string, unknown> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra }) as ThreadItem;
const threads: Record<string, ThreadItem[]> = {
  pim: [
    { kind: 'prompt', id: 'p1', at: at(-600), turn: 1, text: 'Monte la coque : barre d\'activité, zone à onglets, et les écrans actuels dedans tels quels.' },
    { kind: 'message', id: 'm1', at: at(-595), turn: 1, text: 'Je pose `WorkspaceShell` autour de `App.tsx` et je migre l\'atelier en premier onglet.' },
    tool('t1', -590, 'Read', '/w/ledge/apps/desktop/src/App.tsx', { durationMs: 400 }),
    tool('t2', -580, 'Write', '/w/ledge/apps/desktop/src/shell/WorkspaceShell.tsx', { durationMs: 900, files: [{ path: '/w/ledge/apps/desktop/src/shell/WorkspaceShell.tsx', change: 'write', diff: '+ export function WorkspaceShell() {\n+   return <IdeFrame />;\n+ }' }] }),
    tool('t3', -570, 'Edit', '/w/ledge/apps/desktop/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/apps/desktop/src/App.tsx', change: 'edit', diff: '- <Shell />\n+ <WorkspaceShell />' }] }),
    tool('t4', -560, 'Bash', 'pnpm --filter desktop typecheck', { durationMs: 6800 }),
    { kind: 'reply', id: 'r1', at: at(-520), turn: 1, text: 'Le typecheck passe. Il reste le scénario Playwright de l\'espace de travail.' },
    { kind: 'prompt', id: 'p2', at: at(-20), turn: 2, text: 'Lance-le.' },
    { kind: 'permission', id: 'perm', at: at(-9), turn: 2, tool: 'Bash', text: 'pnpm --filter desktop exec playwright test e2e/workspace.spec.ts' }
  ] as ThreadItem[],
  nova: [
    { kind: 'prompt', id: 'p1', at: at(-300), turn: 1, text: 'Les terminaux masqués doivent lâcher leur contexte WebGL.' },
    tool('t1', -290, 'Grep', 'WebglAddon', { durationMs: 300 }),
    tool('t2', -280, 'Edit', '/w/ledge/apps/desktop/src/term/Term.tsx', { durationMs: 200, files: [{ path: '/w/ledge/apps/desktop/src/term/Term.tsx', change: 'edit', diff: '- addon.activate(term)\n+ if (visible) addon.activate(term)' }] }),
    { kind: 'message', id: 'm1', at: at(-270), turn: 1, text: 'Un terminal caché passe sur le rendu DOM ; il reprend WebGL quand son onglet redevient visible.' },
    tool('t3', -8, 'Bash', 'pnpm --filter desktop test term', { status: 'running' })
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
    if (m.type === 'session.commands') this.push({ type: 'session.commands.listing', requestId: m.requestId, id: m.id, tool: 'claude', commands: [] });
    if (m.type === 'repos.info') this.push({ type: 'repos.info', requestId: m.requestId, repos: m.paths.map((path: string) => ({ path, exists: true, branch: 'main' })) });
    if (m.type === 'chat.history') this.push({ type: 'chat.history', turns: [] });
    if (m.type === 'chat.ask') {
      const text = '**Pim** attend ton accord pour lancer Playwright (projet ledge). **Tom** a une question sur synapse : « Quel port pour le relais ? ». Nova et Echo travaillent, Ida est au repos.';
      this.push({ type: 'chat.step', qid: m.qid, step: { kind: 'sessions' } }); this.push({ type: 'chat.delta', qid: m.qid, text }); this.push({ type: 'chat.done', qid: m.qid, text, at: new Date().toISOString() });
    }
    if (m.type === 'session.decide') { const i = sessions.findIndex(s => s.id === m.id); if (i >= 0) { const { pending: _p, ...rest } = sessions[i] as Msg; sessions[i] = { ...rest, state: 'working' } as Session; this.push({ type: 'session.updated', session: sessions[i] }); } }
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
