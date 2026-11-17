import type { Page } from '@playwright/test';
import type { ClientMessage, Task } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Issue #9 (docs/mockups/ledge-report.html): the flag of the title bar opens « Signaler »; an agent's report waits in « À toi ».
// The fake daemon answers: no real issue is created.
test.use({ viewport: { width: 1600, height: 1000 } });
test.setTimeout(90_000);

const NOW = Date.now();
const iso = (ago: number) => new Date(NOW - ago).toISOString();
const ITEMS = [{ key: 'desktop', value: '0.60.1' }, { key: 'daemon', value: '0.60.1' }, { key: 'system', value: 'Windows 11 · WSL Ubuntu 24.04' }, { key: 'tool', value: 'Claude Code 2.1 · Otto' }];
const LOG = '19:41:02 forge  github  read 7 prs (2 machines)\n19:41:05 chat   ask q-8f2  tool=claude\n19:41:12 forge  github  error 502 Bad Gateway  retry 19:41:22';
const REPORT: Task = {
  id: 't-15', title: 'Le daemon répète la lecture des PR toutes les 10 s après une erreur 502', giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open',
  at: iso(60_000), updatedAt: iso(60_000), log: [{ at: iso(60_000), by: 'Otto', what: 'confiée' }],
  report: { kind: 'bug', title: 'Le daemon répète la lecture des PR toutes les 10 s après une erreur 502', detail: 'Pendant le lot 13, après un 502 de GitHub, le daemon relit en boucle au lieu d’attendre le délai prévu (journal : 6 lectures en une minute).', session: 'Otto', project: 'Ledge' }
};
const W = {
  fr: { flag: 'Signaler un bug ou proposer une idée', dialog: 'Signaler', title: 'Titre', happened: 'Ce qui s’est passé', expected: 'Ce qui était attendu', repro: /^Comment le reproduire/,
    log: /Ajouter un extrait du journal du daemon/, create: /^Créer l’issue/, created: 'Issue #14 créée sur kl-ledge/ledge.', titleEmpty: 'Donnez un titre au signalement.', openGh: /^Ouvrir sur GitHub/,
    nav: /activité/, atoi: 'À toi', page: 'Page', agent: 'Otto signale un bug', idea: /^Idée/ },
  en: { flag: 'Report a bug or suggest an idea', dialog: 'Report', title: 'Title', happened: 'What happened', expected: 'What was expected', repro: /^How to reproduce it/,
    log: /Add an excerpt of the daemon log/, create: /^Create the issue/, created: 'Issue #14 created on kl-ledge/ledge.', titleEmpty: 'Give the report a title.', openGh: /^Open on GitHub/,
    nav: /Activity bar/, atoi: 'For you', page: 'Page', agent: 'Otto reports a bug', idea: /^Idea/ }
} as const;

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en', created: { ok: boolean; number?: number; url?: string; code?: string } = { ok: true, number: 14, url: 'https://github.com/kl-ledge/ledge/issues/14' }) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, [session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'idle' })], {
    projects: twoProjects, daemon: { version: '0.60.1', install: 'npm', systemd: true } as never, tasks: [REPORT], report: { items: ITEMS, log: LOG, created }
  });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  return daemon;
}
const creates = (received: ClientMessage[]) => received.filter(m => m.type === 'report.create');

for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en'], ['light', 'en']] as const) {
  test(`« Signaler » (${theme}, ${lang}): the flag, a bug with its log, the toast; an idea; an agent's report in « À toi »`, async ({ page }) => {
    const w = W[lang];
    const daemon = await boot(page, theme, lang);
    const flag = page.getByRole('button', { name: w.flag });
    await expect(flag).toHaveAttribute('title', w.flag);
    await page.screenshot({ path: `e2e/.results/report/titlebar-${theme}-${lang}.png`, clip: { x: 0, y: 0, width: 1600, height: 60 } });
    await flag.click();
    const box = page.getByRole('dialog', { name: w.dialog });
    await box.getByRole('textbox', { name: w.title }).fill(lang === 'fr' ? 'Le chat agrandi garde sa largeur après Ctrl+/' : 'The enlarged chat keeps its width after Ctrl+/');
    await box.getByRole('textbox', { name: w.happened }).fill(lang === 'fr' ? 'J’agrandis le chat, je le masque avec Ctrl+/, je le rouvre : il revient agrandi.' : 'I enlarge the chat, hide it with Ctrl+/, open it again: it comes back enlarged.');
    await box.getByRole('textbox', { name: w.expected }).fill(lang === 'fr' ? 'Qu’il revienne à sa largeur normale.' : 'That it comes back at its normal width.');
    await box.getByRole('textbox', { name: w.repro }).fill('1. … 2. Ctrl+/ 3. Ctrl+/');
    await expect(box.locator('[data-item="tool"]')).toContainText('Claude Code 2.1 · Otto');
    await page.screenshot({ path: `e2e/.results/report/bug-${theme}-${lang}.png` });
    await box.locator('[data-item="tool"] button').click();
    await box.getByRole('checkbox', { name: w.log }).check();
    await expect(box.locator('pre.rp-excerpt')).toContainText('error 502 Bad Gateway');
    await page.screenshot({ path: `e2e/.results/report/bug-log-${theme}-${lang}.png` });
    await page.keyboard.press('Control+Enter');
    await expect(box).toBeHidden();
    await expect(page.locator('.toast-region')).toContainText(w.created);
    await expect.poll(() => creates(daemon.received)).toEqual([expect.objectContaining({ kind: 'bug', log: true, logId: 'log-1', omit: ['tool'] })]);
    await page.screenshot({ path: `e2e/.results/report/created-${theme}-${lang}.png` });

    // An idea; no title: nothing goes, the field says what to do.
    await flag.click();
    await box.getByRole('radio', { name: w.idea }).click();
    await box.getByRole('button', { name: w.create }).click();
    await expect(box.getByRole('alert')).toHaveText(w.titleEmpty);
    await page.screenshot({ path: `e2e/.results/report/idea-${theme}-${lang}.png` });
    expect(creates(daemon.received)).toHaveLength(1);
    await page.keyboard.press('Escape');

    // An agent's report, in « À toi » › Decisions.
    await page.getByRole('navigation', { name: w.nav }).getByRole('button', { name: w.atoi, exact: true }).click();
    await page.getByRole('button', { name: w.page, exact: true }).click();
    const card = page.locator('[data-report="t-15"]');
    await expect(card).toContainText(w.agent);
    await expect(card.locator('[data-item="tool"]')).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/.results/report/agent-${theme}-${lang}.png` });
  });
}

test('gh not signed in: « Ouvrir sur GitHub » opens the prefilled page, what was written stays', async ({ page }) => {
  const url = 'https://github.com/kl-ledge/ledge/issues/new?title=x';
  await boot(page, 'dark', 'fr', { ok: false, code: 'no_gh', url });
  await page.getByRole('button', { name: W.fr.flag }).click();
  const box = page.getByRole('dialog', { name: W.fr.dialog });
  await box.getByRole('textbox', { name: W.fr.title }).fill('Le chat agrandi garde sa largeur après Ctrl+/');
  await box.getByRole('button', { name: W.fr.create }).click();
  await expect(box.getByRole('button', { name: W.fr.openGh })).toBeVisible();
  await expect(box.getByRole('alert')).toContainText('gh n’est pas connecté sur cette machine');
  await expect(box.getByRole('textbox', { name: W.fr.title })).toHaveValue('Le chat agrandi garde sa largeur après Ctrl+/');
  await page.screenshot({ path: 'e2e/.results/report/nogh-dark-fr.png' });
});
