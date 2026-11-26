import type { Page } from '@playwright/test';
import type { PrDetail, PullRequest, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Issue kl-ledge/ledge #14: a request with long text (a repository path, a title, a description without spaces) made the
// MR and PR view scroll sideways. The view and the request's page scroll vertically only, in a narrow window (the issue's
// 338 × 1147) as in a wide one. LEDGE_VISUAL=1 also saves captures of each, dark and light (KL14_TAG names the set).
test.setTimeout(120_000);

const AT = '2026-11-25T10:05:00.000Z';
const LONG_REPO = 'speos_streamplatform/entreprisesolution/platform-worker-paper-sender-notification-service';
const LONG_WORD = 'SBT-4291_pin_paper-lib_3.7.0-dev.8bd5d0c9_on_the_paper_sender_worker_and_its_notification_service';
const sessions: Session[] = [session('tom', { name: 'Tom', project: 'synapse', cwd: '/w/synapse', branch: 'fix/s3-timeout', state: 'idle' })];
const pr = (p: Partial<PullRequest> & Pick<PullRequest, 'id' | 'number' | 'ref' | 'title'>): PullRequest => ({
  forge: 'gitlab', host: 'gitlab.speos.lan', url: `https://example.invalid/${p.number}`, state: 'open', target: 'main', headSha: 'a41c9e2',
  repo: LONG_REPO, branch: 'chore/SBT-4291-pin-paper-lib-3.7.0-dev.8bd5d0c9-in-the-sender-worker', pipeline: 'run',
  approvals: { given: 0, required: 1 }, mergeable: true, openThreads: 0, updatedAt: AT, sessions: [], roles: ['author'], ...p
});
const PRS: PullRequest[] = [
  pr({ id: 'gitlab.speos.lan/x#47', number: 47, ref: '!47', title: `chore: ${LONG_WORD}` }),
  pr({ id: 'gitlab.speos.lan/x#848', number: 848, ref: '!848', title: 'fix(k8s): let KEDA own the replica count of the autoscaled workers', branch: 'fix/keda-replicas', pipeline: 'ok', roles: ['reviewer'] })
];
const LONG_LINE = `const url = 'https://gitlab.speos.lan/${LONG_REPO}/-/pipelines?ref=chore/SBT-4291-pin-paper-lib-3.7.0-dev.8bd5d0c9&scope=all';`;
const DETAIL: Omit<PrDetail, 'pr'> = {
  description: `Pins ${LONG_WORD} so the sender keeps the fixed ${LONG_REPO} contract.\n\n\`${LONG_LINE}\`\n\n- ${LONG_WORD}`,
  author: 'lda', reviewers: [{ name: 'Joffrey', state: 'pending' }], labels: ['chore', 'paper-lib'], issues: [],
  jobs: [{ id: 'j1', name: `build:${LONG_WORD}`, column: 0, columnName: 'build', status: 'run' }],
  threads: [{ id: 't1', resolvable: true, resolved: false, file: `${LONG_REPO}/src/main/java/be/speos/paper/sender/NotificationService.java`, line: 31, code: `+    ${LONG_LINE}`,
    comments: [{ id: 'c1', author: 'Joffrey', at: AT, body: `Why ${LONG_WORD}?` }] }],
  files: [{ path: `${LONG_REPO}/pom.xml`, added: 1, removed: 1, patch: `@@ pom.xml  −28,3 +28,3 @@\n-    <paper-lib.version>3.6.2</paper-lib.version>\n+    ${LONG_LINE}` }],
  commits: [{ sha: '8bd5d0c9a', title: `chore: ${LONG_WORD}`, author: 'lda', at: AT }],
  mergeCommand: 'glab mr merge 47 --squash', mergeBlockers: ['pipeline']
};

async function boot(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  await fakeDaemon(page, sessions, { projects: twoProjects, daemon: { version: '0.62.0', install: 'npm', systemd: true, forge: true } as never,
    // The account's own requests no session follows travel in `mine` (issue #3).
    forge: { prs: [], mine: PRS, details: { [PRS[0]!.id]: DETAIL } } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
}

/** How far an element's content reaches past its box, sideways (0: it scrolls vertically only). */
const sideways = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate(el => el.scrollWidth - el.clientWidth);

const shot = async (page: Page, name: string) => {
  if (!process.env.LEDGE_VISUAL) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `e2e/.results/kl14-${process.env.KL14_TAG ?? 'after'}-${name}.png`, animations: 'disabled' });
};

for (const [label, viewport] of [['narrow', { width: 338, height: 1147 }], ['medium', { width: 900, height: 1000 }], ['wide', { width: 1920, height: 1080 }]] as const) {
  for (const theme of ['dark', 'light'] as const) {
    test(`MR et PR (${label}, ${theme}): long text wraps, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await boot(page, theme);
      await page.getByRole('navigation', { name: 'Barre d’activité' }).getByRole('button', { name: 'MR et PR', exact: true }).click();
      const view = page.getByRole('region', { name: 'MR et PR' });
      await expect(view.locator('.fg-row')).toHaveCount(2);
      await shot(page, `list-${label}-${theme}`);
      expect.soft(await sideways(page, '.fg-side'), 'the list').toBeLessThanOrEqual(0);

      // The request's page, each of its views: the description, the discussion, the changes.
      await view.locator('.fg-row').first().click();
      const tab = page.getByRole('tabpanel', { name: /^!47/ });
      await expect(tab.locator('.fg-desc')).toContainText('Pins');
      await shot(page, `page-${label}-${theme}`);
      expect.soft(await sideways(page, '.fg-page'), 'the overview').toBeLessThanOrEqual(0);
      for (const name of ['Discussion', 'Modifications', 'Commits']) {
        const sub = tab.getByRole('tab', { name: new RegExp(`^${name}`) });
        if (await sub.count() === 0) continue;
        await sub.click();
        await shot(page, `page-${name.toLowerCase()}-${label}-${theme}`);
        expect.soft(await sideways(page, '.fg-page'), name).toBeLessThanOrEqual(0);
      }
    });
  }
}
