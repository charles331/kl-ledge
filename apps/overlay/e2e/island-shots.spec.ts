import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DaemonInfo, IslandPrefs, OperatorNotice, Routine, Session, Task } from '@ledge/protocol';
import { test, expect, island, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/**
 * Zoomed captures of every card, to hold against the mockup (docs/mockups/ledge-dynamic-island.html, its complement's states
 * and Ledge's notices): the mockup's own examples, in French and English, dark and light. Each card is drawn open with its
 * ring held at 4 s left, as the mockup's still frames. The shots go to LEDGE_SHOTS (Playwright empties e2e/.results).
 */
const DIR = process.env.LEDGE_SHOTS ?? join(import.meta.dirname, '.results', 'shots');
const DAEMON = { version: '0.64.0', install: 'npm', systemd: false, routines: true, routineGroups: true } as DaemonInfo;
const T0 = new Date('2026-11-27T09:00:00.000Z');
const at = '2026-11-27T08:12:00.000Z';
const PREFS: IslandPrefs = { visible: true, screen: 'primary', position: 'center', discreet: true, islandScale: 1, panelScale: 1, shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L' };

type Lang = 'fr' | 'en';
type Two = Record<Lang, string>;
const two = (fr: string, en = fr): Two => ({ fr, en });
const agent = (id: string, name: string, tool: Session['tool'], project: string, branch: string, extra: Partial<Session> = {}) =>
  session(id, { name, tool, project, branch, cwd: `/w/${project}`, title: `${name} · ${project}`, ...extra });

/** The mockup's examples (docs/mockups/dynamic-island/island.tsx `N`). */
const otto = (extra: Partial<Session> = {}) => agent('otto', 'Otto', 'claude', 'ledge', 'fix/island-prefs', extra);
const iris = (extra: Partial<Session> = {}) => agent('iris', 'Iris', 'codex', 'pilot', 'feat/worker-retry', extra);
const pim = (extra: Partial<Session> = {}) => agent('pim', 'Pim', 'claude', 'ledge', 'chore/deps', extra);
const bix = (extra: Partial<Session> = {}) => agent('bix', 'Bix', 'cursor', 'boutique', 'feat/migration', extra);
const nova = (extra: Partial<Session> = {}) => agent('nova', 'Nova', 'omp', 'ledge', 'feat/relay-queue', extra);
const finishedText = two('La préférence d’écran est relue au branchement d’un moniteur. Les 14 tests passent, la PR est prête à relire.', 'The screen preference is read again when a monitor is plugged in. All 14 tests pass, the PR is ready for review.');
const permission = (extra: Partial<Session> = {}) => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm up --latest && pnpm test', tool: 'Bash', source: 'hook' }, ...extra });
const questionText = two('Migration progressive ou courte fenêtre de maintenance ?', 'Gradual migration or a short maintenance window?');
const questionOptions = { fr: ['Migration progressive', 'Fenêtre de maintenance, dimanche 2 h'], en: ['Gradual migration', 'Maintenance window, Sunday 2 am'] };
const question = (l: Lang) => bix({ state: 'waiting_input', pending: { kind: 'question', text: questionText[l], options: questionOptions[l], source: 'hook' } });
const longQuestion = (l: Lang) => bix({ state: 'waiting_input', pending: { kind: 'question', source: 'hook',
  text: l === 'fr' ? 'La table orders a 41 millions de lignes. La migration ajoute deux colonnes et un index ; sur la copie de prod elle a pris 38 minutes, avec des verrous courts. Comment veux-tu la passer ?' : 'The orders table has 41 million rows. The migration adds two columns and an index; on the prod copy it took 38 minutes, with short locks. How do you want to run it?',
  options: l === 'fr' ? ['Migration progressive, par lots de 100 000', 'Fenêtre de maintenance, dimanche 2 h', 'En ligne, sans fenêtre, avec les verrous courts', 'Attendre la copie de prod de lundi pour mesurer encore', 'Découper : colonnes maintenant, index dimanche'] : ['Gradual migration, in batches of 100,000', 'Maintenance window, Sunday 2 am', 'Online, no window, with the short locks', 'Wait for Monday’s prod copy to measure again', 'Split: columns now, index on Sunday'] } });

/** The routines' examples (docs/mockups/ledge-routines.html, cards 15 and 23), as the daemon lists them. */
const base = { catchUp: 'once' as const, createdAt: at, createdBy: { kind: 'session' as const, id: 'iris', name: 'Iris' }, prompt: 'Point de la semaine du {date}.' };
const irisTarget = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
const pointHebdo: Routine = { ...base, key: 'k-point', id: 'r3f9a12', name: 'point-hebdo', target: irisTarget, schedule: { kind: 'recurring', times: ['16:30'], days: ['fri'] }, state: 'pending' };
const briefing: Routine = { ...base, key: 'k-brief', id: 'r5b2c11', name: 'briefing', target: irisTarget, schedule: { kind: 'recurring', times: ['07:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, state: 'enabled',
  proposal: { spec: { name: 'briefing', target: irisTarget, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, prompt: 'p' }, by: { id: 'iris', name: 'Iris' }, at } };
const veille: Routine = { ...base, id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, createdBy: { kind: 'user' },
  schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, state: 'enabled', lastRun: { at, slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille', field: 'cwd' } };
const once = (id: string, name: string, when: string): Routine => ({ ...base, key: `k-${id}`, id, name, target: irisTarget, schedule: { kind: 'once', at: [when] }, state: 'pending' });
const group = [once('r000001', 'prepa-121', '2026-12-03T16:00'), once('r000002', 'prepa-comite-archi', '2026-12-07T15:00'), once('r000003', 'prepa-demo-compart', '2026-12-08T09:30')];
const task = (id: string, routine: Task['routine'], extra: Partial<Task> = {}): Task => ({ id, title: 't', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at, updatedAt: at, log: [], routine, ...extra });
const TASKS = [
  task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }),
  task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }),
  task('t3', { kind: 'approve', id: 'r5b2c11', name: 'briefing' }),
  task('t4', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }),
  task('t5', undefined, { giver: 'otto', giverName: 'Otto' })
];
const decision = (taskId: string, who: string, time: string): OperatorNotice => ({ id: `decision:${taskId}`, kind: 'decision', text: 't', who, priority: 'routine', at: time });
const rig = (l: Lang, options = true): OperatorNotice => ({ id: 'rig.ask:q1', kind: 'rig.ask', qid: 'p1', qitem: 'q1', who: 'pilot-lead', rig: 'ledge-dev', priority: 'urgent', at,
  text: l === 'fr' ? 'On publie la 0.62 ce soir ou on attend la revue de Codex ?' : 'Do we ship 0.62 tonight or wait for Codex’s review?',
  ...(options ? { options: l === 'fr' ? [{ id: 'tonight', label: 'Ce soir' }, { id: 'after', label: 'Après la revue' }] : [{ id: 'tonight', label: 'Tonight' }, { id: 'after', label: 'After the review' }] } : {}) });

type Daemon = Awaited<ReturnType<typeof fakeDaemon>>;
interface Shot { name: string; sessions: Session[]; go: (d: Daemon, l: Lang, page: import('@playwright/test').Page) => Promise<void>; prefs?: Partial<IslandPrefs>; viewport?: { width: number; height: number } }

const SHOTS: Shot[] = [
  { name: 'finished', sessions: [otto({ state: 'working' })], go: async (d, l) => { d.upsert(otto({ state: 'idle', lastReply: { text: finishedText[l], at } })); } },
  { name: 'error', sessions: [iris({ state: 'working' })], go: async d => { d.upsert(iris({ state: 'error', lastError: 'ECONNREFUSED 127.0.0.1:7317' })); } },
  { name: 'permission', sessions: [pim()], go: async d => { d.upsert(permission()); } },
  { name: 'question', sessions: [bix()], go: async (d, l) => { d.upsert(question(l)); } },
  { name: 'plan', sessions: [nova()], go: async (d, l) => { d.upsert(nova({ state: 'waiting_input', pending: { kind: 'plan', text: l === 'fr' ? 'File d’attente du relais' : 'Relay queue', source: 'hook' } })); } },
  { name: 'diff', sessions: [otto()], go: async (d, l) => { d.upsert(otto({ state: 'waiting_input', pending: { kind: 'diff', text: l === 'fr' ? '3 fichiers · +42 −7' : '3 files · +42 −7', source: 'hook' } })); } },
  { name: 'more', sessions: [pim(), iris(), otto()], go: async (d, l) => { d.upsert(permission()); d.upsert(iris({ state: 'error', lastError: 'ECONNREFUSED 127.0.0.1:7317' })); d.upsert(otto({ state: 'idle', lastReply: { text: finishedText[l], at } })); } },
  { name: 'sent', sessions: [pim()], go: async (d, _l, page) => { d.upsert(permission()); await expect(island(page)).toHaveAttribute('data-phase', 'open'); await page.keyboard.press('y'); } },
  { name: 'failed', sessions: [pim()], go: async (d, l, page) => { d.upsert(permission()); await expect(island(page)).toHaveAttribute('data-phase', 'open'); await page.keyboard.press('y'); d.error('pim', l === 'fr' ? 'La décision n’a pas été transmise' : 'The decision was not delivered'); } },
  { name: 'readonly', sessions: [bix({ source: 'hook_only' })], go: async (d, l) => { d.upsert({ ...question(l), source: 'hook_only' }); } },
  { name: 'nudge', sessions: [bix()], go: async (d, l, page) => { d.upsert(question(l)); await expect(island(page)).toHaveAttribute('data-phase', 'open'); await page.locator('.di-actions .ledge-btn').first().click(); } },
  { name: 'quick-off', sessions: [bix()], prefs: { shows: { quick: false, finished: true, say: true, helpers: true } }, go: async (d, l) => { d.upsert(question(l)); } },
  { name: 'tall', sessions: [bix()], viewport: { width: 1920, height: 360 }, go: async (d, l) => { d.upsert(longQuestion(l)); } },
  { name: 'tool-edit', sessions: [pim()], go: async d => { d.upsert(permission({ pending: { kind: 'permission', text: 'apps/overlay/src/surface/Bubble.tsx', tool: 'Edit', source: 'hook' } })); } },
  { name: 'tool-mcp', sessions: [iris()], go: async d => { d.upsert(iris({ state: 'waiting_permission', pending: { kind: 'permission', text: 'kl-ledge/ledge · « fix: worker retry »', tool: 'github.create_pull_request', source: 'hook' } })); } },
  { name: 'ledge-rig', sessions: [], go: async (d, l) => { d.notices([rig(l)]); } },
  { name: 'ledge-rig-bare', sessions: [], go: async (d, l) => { d.notices([rig(l, false)]); } },
  { name: 'ledge-decision', sessions: [agent('otto', 'Otto', 'claude', 'ledge', 'feat/routines-ui', { state: 'idle' })], go: async d => { d.notices([decision('t5', 'Otto', at)]); } },
  { name: 'ledge-routine', sessions: [], go: async d => { d.notices([decision('t1', 'Iris', '2026-11-27T01:10:00.000Z')]); } },
  { name: 'ledge-routine-group', sessions: [], go: async d => { d.notices([decision('t2', 'Iris', '2026-11-27T01:58:00.000Z')]); } },
  { name: 'ledge-routine-edit', sessions: [], go: async d => { d.notices([decision('t3', 'Iris', '2026-11-27T02:40:00.000Z')]); } },
  { name: 'ledge-routine-failed', sessions: [], go: async d => { d.notices([decision('t4', 'Ledge', '2026-11-27T17:00:00.000Z')]); } },
  { name: 'ledge-offline', sessions: [], go: async d => { d.drop(); } }
];

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) test.describe(`${lang} ${theme}`, () => {
  test.use({ lang, deviceScaleFactor: 2 });
  for (const s of SHOTS) test(s.name, async ({ page }) => {
    if (s.viewport) await page.setViewportSize(s.viewport);
    await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); } catch { /* ignore */ } }, theme);
    await page.clock.install({ time: T0 });
    const d = await fakeDaemon(page, s.sessions, { daemon: DAEMON, island: { ...PREFS, ...s.prefs }, tasks: TASKS, routines: [pointHebdo, briefing, veille, ...group] });
    await ready(page);
    // A desktop behind the island, as the mockup's desks: the window itself is transparent.
    await page.addStyleTag({ content: `body { background: ${theme === 'dark' ? '#2b2824' : '#cfc7ba'} !important; }` });
    await s.go(d, lang, page);
    await expect(island(page)).toHaveAttribute('data-phase', 'open');
    // A notice's ring at 4 s left, held there by the pointer.
    await page.clock.runFor(2000);
    const box = (await island(page).boundingBox())!;
    await page.mouse.move(box.x + box.width - 20, box.y + 18);
    await page.waitForTimeout(700);
    mkdirSync(DIR, { recursive: true });
    const b = (await island(page).boundingBox())!;
    await page.screenshot({ path: join(DIR, `island-${s.name}-${lang}-${theme}.png`), clip: { x: Math.max(0, b.x - 24), y: 0, width: b.width + 48, height: b.y + b.height + 32 } });
  });
});
