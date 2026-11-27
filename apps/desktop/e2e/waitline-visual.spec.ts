import type { ThreadItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady, openSession, pane } from './ide';

// Visual review of « Quand l'agent travaille : le dessin suit l'action » (docs/mockups/ledge-operator-rigs-panel.html, validated by
// the owner: « Selon ce qu'il fait »): the thread's waiting line after a Read, an Edit, a Grep and a Bash, then while the agent reads
// its message (the phrase alone), dark and light. Motion is reduced so each drawing is captured at rest.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/waitline-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the waiting line');
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const NOVA = session('nova', { name: 'Nova', cwd: '/w/ledge', project: 'ledge', title: 'Nova · Le fil', topic: 'Le fil', state: 'working' });
const prompt: ThreadItem = { kind: 'prompt', id: 'p1', at: ago(20), turn: 1, text: 'Rends l’attente plus vivante' };
const done = (id: string, tool: string, label: string): ThreadItem => ({ kind: 'tool', id, at: ago(3), turn: 1, tool, label, status: 'success', durationMs: 300, files: [] });

for (const theme of ['dark', 'light'] as const) {
  test(`the waiting line follows what the agent does, ${theme}`, async ({ page }, info) => {
    await seedAtelier(page);
    await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } }, [theme]);
    const d = await fakeDaemon(page, [NOVA], { projects: twoProjects, threads: { nova: [prompt] } });
    await page.goto('/');
    await ideReady(page);
    await openSession(page, 'Nova');
    const line = pane(page, 'Nova').getByRole('status', { name: /travaille|working/ });
    await expect(line).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await line.screenshot({ path: info.outputPath(`wait-thinking-${theme}.png`) });
    for (const [id, tool, label, drawing] of [['t1', 'Read', 'Thread.tsx', 'read'], ['t2', 'Edit', 'RigsCard.tsx', 'write'], ['t3', 'Grep', 'useRigRow', 'search'], ['t4', 'Bash', 'pnpm test', 'run']] as const) {
      d.item('nova', done(id, tool, label));
      await expect(line.locator(`[data-drawing="${drawing}"]`)).toBeVisible();
      await line.screenshot({ path: info.outputPath(`wait-${drawing}-${theme}.png`) });
    }
  });
}
