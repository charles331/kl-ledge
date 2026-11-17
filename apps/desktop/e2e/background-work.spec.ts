import type { Page } from '@playwright/test';
import type { Helper, OpenRigState, RigSeat, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady } from './ide';

// Issue #1 (docs/mockups/ledge-background-work.html): an available session with work in the background no longer looks at rest:
// a ring on its logo, its subagents' counter in blue, its background command under the task, a count on its project; in « Rigs »,
// a hollow blue circle on the seat and a count on the rig.
test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
test.setTimeout(90_000);

const now = () => new Date().toISOString();
const helper = (id: string, kind: string, task: string, state: Helper['state'] = 'working'): Helper => ({ id, kind, task, state });
const ledge = { project: 'ledge', cwd: '/w/ledge' } as const;
const SESSIONS: Session[] = [
  session('otto', { name: 'Otto', ...ledge, state: 'working', topic: 'Lancer pnpm test' }),
  session('nova', { name: 'Nova', ...ledge, state: 'idle', topic: 'Relire la PR #231', helpers: [helper('h1', 'Explore', 'Cherche les appels de setHelper'), helper('h2', 'general-purpose', 'Écrit les tests du lot')] }),
  session('pim', { name: 'Pim', ...ledge, state: 'idle', topic: 'Suite e2e du lot 13', background: [{ id: 'b1', label: 'Lancer la suite e2e', since: now() }] }),
  session('ida', { name: 'Ida', ...ledge, tool: 'codex', state: 'idle', topic: 'Passer les captures en clair' }),
  session('front', { name: 'dev-front', ...ledge, state: 'idle', topic: 'Lot 9', rig: { seat: 'dev-front@ledge-dev', name: 'ledge-dev' }, helpers: [helper('h3', 'Explore', 'Lit le code'), helper('h4', 'Explore', 'Lit les tests')] }),
  session('lead', { name: 'pilot-lead', ...ledge, state: 'working', topic: 'Découpe', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev' } })
];
const seat = (logicalId: string, s: string): RigSeat => ({ logicalId, session: s, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const OPENRIG: OpenRigState = {
  installed: true, version: '0.7.10', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: now(),
  rigs: [{ id: 'r', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 0, uptime: '2h', snapshot: null,
    nodes: [seat('lead.pilot', 'pilot-lead@ledge-dev'), seat('dev.front', 'dev-front@ledge-dev')] }]
};

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await seedAtelier(page);
  await fakeDaemon(page, SESSIONS, { projects: twoProjects, openrig: OPENRIG });
  await page.goto('/');
  await ideReady(page);
}
const row = (page: Page, name: string) => page.locator('.st-tree .st-agent').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) }).first();

for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en'], ['light', 'en']] as const) {
  test(`background work (${theme}, ${lang}): « Projets » then « Rigs »`, async ({ page }) => {
    const fr = lang === 'fr';
    await boot(page, theme, lang);
    await expect(row(page, 'Nova').locator('.st-bg-ring')).toBeVisible();
    await expect(row(page, 'Pim').locator('.st-bg-ring')).toBeVisible();
    await expect(row(page, 'Ida').locator('.st-bg-ring')).toHaveCount(0);
    await expect(row(page, 'Otto').locator('.st-bg-ring')).toHaveCount(0);
    await expect(row(page, 'Nova').locator('.st-kids.on')).toHaveText('2');
    await expect(row(page, 'Pim').locator('.st-bgcmd')).toHaveText(fr ? 'Lancer la suite e2e · en arrière-plan' : 'Lancer la suite e2e · in the background');
    await expect(row(page, 'Nova').getByRole('button', { name: /^Nova/ })).toHaveAttribute('title', fr ? 'Disponible, mais 2 sous-agents travaillent encore.' : 'Available, but 2 subagents are still working.');
    // Nova and Pim (a seat's session shows under « Rigs », not here).
    await expect(page.locator('.st-project .st-tally .t-bg').first()).toHaveText('2');
    await page.screenshot({ path: `e2e/.results/background-work/projects-${theme}-${lang}.png` });

    await page.getByRole('navigation', { name: fr ? 'Barre d’activité' : 'Activity bar' }).getByRole('button', { name: fr ? 'Rigs OpenRig' : 'OpenRig rigs' }).click();
    const rigs = page.getByRole('complementary', { name: 'Rigs' });
    const front = rigs.locator('.ide-rigs-row.seat').filter({ hasText: 'dev-front' });
    await expect(front.locator('.ide-rigs-dot.d-bg')).toBeVisible();
    await expect(front).toHaveAttribute('title', fr ? 'Disponible · 2 sous-agents au travail' : 'Available · 2 subagents working');
    await expect(rigs.locator('.ide-rigs-row.rig').filter({ hasText: 'ledge-dev' }).locator('.ide-rigs-bgn')).toHaveText('1');
    await page.screenshot({ path: `e2e/.results/background-work/rigs-${theme}-${lang}.png` });
  });
}
