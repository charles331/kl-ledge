import type { Page } from '@playwright/test';
import type { PullRequest, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Issue #3 (docs/mockups/ledge-prs-mine.html): « MR et PR » lists all of the user's MRs and PRs (created, assigned, to review) with a
// role filter and a search. The fake daemon sends the followed ones (`prs`) and the account's own (`mine`).
test.use({ viewport: { width: 1600, height: 1000 } });
test.setTimeout(90_000);

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const sessions: Session[] = [session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', branch: 'feat/lot-9', state: 'idle' })];
const pr = (p: Partial<PullRequest> & Pick<PullRequest, 'forge' | 'number' | 'title' | 'repo'>): PullRequest => {
  const host = p.forge === 'github' ? 'github.com' : 'gitlab.speos.lan';
  return { id: `${host}/${p.repo}#${p.number}`, host, ref: p.forge === 'github' ? `#${p.number}` : `!${p.number}`, url: `https://example.invalid/${p.number}`, branch: `b${p.number}`,
    state: 'open', target: 'main', headSha: 'a41c9e2', pipeline: 'ok', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 0, updatedAt: ago(p.number), sessions: [], ...p };
};
const FOLLOWED: PullRequest[] = [
  pr({ forge: 'github', number: 231, title: 'Lot 9 : fenêtres détachées', repo: 'ledge', branch: 'feat/lot-9', state: 'review', openThreads: 2, sessions: ['otto'], roles: ['author'], updatedAt: ago(1) })
];
const MINE: PullRequest[] = [
  pr({ forge: 'github', number: 88, title: 'Rendu des polices variables dans le PDF', repo: 'paper-rendering', state: 'review', pipeline: 'fail', openThreads: 5, roles: ['reviewer'], updatedAt: ago(2) }),
  pr({ forge: 'gitlab', number: 141, title: 'Worker : relance sur délai S3', repo: 'synapse', pipeline: 'run', roles: ['author', 'assignee'], updatedAt: ago(3) }),
  pr({ forge: 'github', number: 12, title: 'Clé de mise à jour : nouvelle paire', repo: 'kl-ledge/ledge', state: 'review', openThreads: 1, roles: ['assignee', 'reviewer'], updatedAt: ago(4) }),
  pr({ forge: 'gitlab', number: 77, title: 'Refus d’un IBAN vide', repo: 'speos-front', state: 'draft', pipeline: 'wait', roles: ['author'], updatedAt: ago(5) }),
  pr({ forge: 'github', number: 90, title: 'Mise à jour de pdf-lib 1.17', repo: 'paper-rendering', pipeline: 'none', roles: ['reviewer'], updatedAt: ago(6) }),
  pr({ forge: 'github', number: 228, title: 'Lot 5 : groupes liés', repo: 'ledge', state: 'merged', roles: ['author'], updatedAt: ago(60 * 24) }),
  pr({ forge: 'gitlab', number: 139, title: 'Cache des modèles', repo: 'synapse', state: 'closed', pipeline: 'fail', roles: ['reviewer'], updatedAt: ago(60 * 48) }),
  pr({ forge: 'github', number: 200, title: 'Trop vieille', repo: 'ledge', state: 'merged', roles: ['author'], updatedAt: ago(60 * 24 * 9) })
];
const DAEMON = { version: '0.60.0', install: 'npm' as const, systemd: true, forge: true };

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: DAEMON as never,
    forge: { prs: FOLLOWED, mine: MINE, details: { [MINE[0]!.id]: { description: 'Polices variables.', author: 'ana', reviewers: [{ name: 'Joffrey', state: 'pending' }], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [], mergeCommand: 'gh pr merge 88 --squash', mergeBlockers: ['pipeline'] } } } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  const activity = page.getByRole('navigation', { name: lang === 'fr' ? 'Barre d’activité' : 'Activity bar' });
  await activity.getByRole('button', { name: lang === 'fr' ? 'MR et PR' : 'MRs and PRs', exact: true }).click();
  return { daemon, view: page.getByRole('region', { name: lang === 'fr' ? 'MR et PR' : 'MRs and PRs' }), activity };
}
const refs = (page: Page) => page.locator('.fg-side .fg-row b').allTextContents();

test('all of mine: the followed and the account\'s own, roles as pills, counts, filter, search, the closed folded; a row opens its tab', async ({ page }) => {
  const { daemon, view, activity } = await boot(page, 'dark', 'fr');
  await expect.poll(() => refs(page)).toEqual(['#231', '#88', '!141', '#12', '!77', '#90']);
  const otto = view.locator('.fg-row').first();
  await expect(otto.locator('.fg-pill')).toHaveText(['créée', 'branche suivie']);
  await expect(otto).toContainText('GitHub · ledge · en revue · Otto');
  await expect(view.locator('.fg-row').nth(2).locator('.fg-pill')).toHaveText(['créée', 'assignée']);
  await expect(view.getByRole('group', { name: 'Rôle' }).getByRole('button')).toHaveText(['Toutes6', 'Créées3', 'Assignées2', 'À relire3']);
  await expect(view.getByRole('button', { name: /^Toutes/ })).toHaveAttribute('aria-pressed', 'true');
  // The badge of the activity bar is unchanged: the followed requests' failed pipelines only (the account's #88 failed, it does not count).
  await expect(activity.getByRole('button', { name: 'MR et PR', exact: true }).locator('.ide-badge')).toHaveCount(0);

  await view.getByRole('button', { name: /^À relire/ }).click();
  await expect.poll(() => refs(page)).toEqual(['#88', '#12', '#90']);
  await view.getByRole('searchbox').fill('paper');
  await expect.poll(() => refs(page)).toEqual(['#88', '#90']);
  await expect(view.getByRole('button', { name: /^Toutes/ })).toHaveText('Toutes6');
  await view.getByRole('searchbox').fill('!999');
  await expect(view.getByText('Aucune MR ou PR ne correspond.')).toBeVisible();
  await view.getByRole('button', { name: 'Effacer le filtre' }).click();
  await expect.poll(() => refs(page)).toHaveLength(6);

  // The merged and closed of the last 7 days (not the 9 days old one), folded, dimmed once unfolded.
  const fold = view.getByRole('button', { name: 'Fusionnées et fermées · 2 · 7 derniers jours' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect.poll(() => refs(page)).toEqual(['#231', '#88', '!141', '#12', '!77', '#90', '#228', '!139']);

  // The filter lives with the window: another view and back, it is still there.
  await view.getByRole('button', { name: /^Créées/ }).click();
  await activity.getByRole('button', { name: 'Projets', exact: true }).click();
  await activity.getByRole('button', { name: 'MR et PR', exact: true }).click();
  await expect(view.getByRole('button', { name: /^Créées/ })).toHaveAttribute('aria-pressed', 'true');

  // One of the account's own opens in a tab and reads its detail like a followed one.
  await view.getByRole('button', { name: /^Toutes/ }).click();
  await view.locator('.fg-row').nth(1).click();
  await expect(page.getByRole('tabpanel', { name: /^#88/ })).toContainText('Polices variables.');
  await expect.poll(() => daemon.received.some(m => m.type === 'forge.detail' && (m as { prId: string }).prId === MINE[0]!.id)).toBe(true);
});

for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en'], ['light', 'en']] as const) {
  test(`captures (${theme}, ${lang})`, async ({ page }) => {
    const { view } = await boot(page, theme, lang);
    await expect.poll(() => refs(page)).toHaveLength(6);
    await page.screenshot({ path: `e2e/.results/prs-mine/all-${theme}-${lang}.png` });
    await view.getByRole('button', { name: lang === 'fr' ? /^À relire/ : /^To review/ }).click();
    await view.getByRole('button', { name: lang === 'fr' ? /^Fusionnées et fermées/ : /^Merged and closed/ }).click();
    await page.screenshot({ path: `e2e/.results/prs-mine/review-${theme}-${lang}.png` });
    await view.getByRole('searchbox').fill('!999');
    await page.screenshot({ path: `e2e/.results/prs-mine/none-${theme}-${lang}.png` });
  });
}
