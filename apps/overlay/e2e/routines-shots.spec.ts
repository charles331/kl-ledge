import type { Page } from '@playwright/test';
import type { OperatorNotice, Routine, Task } from '@ledge/protocol';
import { test, expect, surface, layer, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';

/**
 * Captures of the island's routine items of « À toi », to hold against cards 15 and 23 of docs/mockups/ledge-routines.html
 * (an activation request, a failure, several one-shots proposed together), dark and light, in French and English. The island's
 * Activer sends `routine.cmd` to the routine's daemon. Captures only with ROUTINES_SHOTS=<folder>; the check runs always.
 */
const out = process.env.ROUTINES_SHOTS;
test.use({ viewport: { width: 1000, height: 300 }, deviceScaleFactor: 2 });

const T = '2026-11-23T01:10:00.000Z';
const base = { catchUp: 'once' as const, createdAt: T, createdBy: { kind: 'session' as const, id: 'iris', name: 'Iris' }, prompt: 'Point de la semaine du {date}.' };
const iris = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
const ROUTINES: Routine[] = [
  { ...base, id: 'r3f9a12', name: 'point-hebdo', target: iris, schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending' },
  { ...base, id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, createdBy: { kind: 'user' }, schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, state: 'enabled' },
  ...([['r000001', 'prepa-121', '2026-12-03T16:00'], ['r000002', 'prepa-comite-archi', '2026-12-07T15:00'], ['r000003', 'prepa-demo-compart', '2026-12-08T09:30']] as const)
    .map(([id, name, at]): Routine => ({ ...base, id, name, target: iris, schedule: { kind: 'once', at: [at] }, state: 'pending' }))
];
const task = (id: string, routine: Task['routine'], at: string, extra: Partial<Task> = {}): Task => ({
  id, title: 'Iris veut programmer une routine', giver: 'iris', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open', at, updatedAt: at, log: [], routine, ...extra
});
const TASKS: Record<string, Task> = {
  ask: task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }, '2026-11-23T01:10:00.000Z'),
  failed: task('t2', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, '2026-11-22T17:00:00.000Z', { giver: 'ledge', giverName: 'Ledge' }),
  group: task('t3', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }, '2026-11-23T01:58:00.000Z')
};

/** The island on a daemon that serves routines: its tasks and routines answered, then the decision notice of `which`. */
async function open(page: Page, theme: 'dark' | 'light', which: keyof typeof TASKS) {
  await page.addInitScript(t => { localStorage.setItem('ledge.theme', t); localStorage.setItem('ledge.finished', 'none'); }, theme);
  const d = await fakeDaemon(page, [session('iris', { name: 'Iris' }), session('nova', { name: 'Nova', state: 'idle' })],
    { daemon: { version: '0.62.0', install: 'npm', systemd: true, routines: true } });
  await ready(page, 2);
  const list = await received(d.received, 'task.cmd', m => m.op === 'list');
  d.send({ type: 'task.result', rid: list.rid, tasks: [TASKS[which]] });
  const routines = await received(d.received, 'routine.list');
  d.send({ type: 'routine.listed', rid: routines.rid, routines: ROUTINES });
  const t = TASKS[which]!;
  const notice: OperatorNotice = { id: `decision:${t.id}`, kind: 'decision', text: t.title, who: t.giverName, priority: 'routine', at: t.at };
  d.send({ type: 'operator.state', notices: [notice] });
  await expect(layer(page, 'bubble')).toHaveAttribute('data-routine', t.routine!.kind);
  return d;
}
async function shot(page: Page, name: string) {
  if (!out) return;
  await page.waitForTimeout(500); // the size transition settles
  const s = (await surface(page).boundingBox())!;
  const pad = 40;
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: Math.max(0, s.x - pad), y: 0, width: Math.min(1000, s.width + 2 * pad), height: s.height + 24 } });
}

for (const [lang, theme] of [['fr', 'dark'], ['en', 'light']] as const) {
  test.describe(`${lang}, ${theme}`, () => {
    test.use({ lang });
    test('an activation request: Activer sends approve to its daemon', async ({ page }) => {
      const d = await open(page, theme, 'ask');
      await shot(page, `island-ask-${theme}-${lang}`);
      await layer(page, 'bubble').getByRole('button', { name: lang === 'fr' ? 'Activer' : 'Activate', exact: true }).click();
      const cmd = await received(d.received, 'routine.cmd');
      expect(cmd).toMatchObject({ op: 'approve', routine: 'r3f9a12' });
    });

    test('a failure', async ({ page }) => {
      await open(page, theme, 'failed');
      await shot(page, `island-failed-${theme}-${lang}`);
    });

    test('several one-shots proposed together', async ({ page }) => {
      await open(page, theme, 'group');
      await expect(layer(page, 'bubble').getByRole('button', { name: lang === 'fr' ? 'Activer les 3' : 'Activate all 3' })).toBeVisible();
      await shot(page, `island-group-${theme}-${lang}`);
    });
  });
}
