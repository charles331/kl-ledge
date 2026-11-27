// #40 PR 3: « À toi » gone from Desktop. The activity bar has no « For you »; a waiting session's tag in the Atelier skin's tree
// says what it waits for (design-ux 11/27 18:05Z, the owner's go 18:34Z): « Accord » / « Question » / « Erreur ». French and English,
// dark and light. Captures in e2e/.results/kl40/ (or SHOTS=<dir>).
import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const OUT = process.env.SHOTS ?? 'e2e/.results/kl40';
const SESSIONS: Session[] = [
  session('pim', { name: 'Pim', cwd: '/w/ledge', project: 'ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', source: 'hook' } } as Partial<Session>),
  session('tom', { name: 'Tom', cwd: '/w/ledge', project: 'ledge', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } } as Partial<Session>),
  session('zed', { name: 'Zed', cwd: '/w/ledge', project: 'ledge', state: 'error' }),
  session('ida', { name: 'Ida', cwd: '/w/ledge', project: 'ledge', state: 'working' })
];

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, SESSIONS, { daemon: { version: '0.68.0', install: 'npm', systemd: true } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  const fr = lang === 'fr';
  test(`no « For you »; the tree's tags say what the session waits for, ${theme}, ${lang}`, async ({ page }) => {
    await open(page, theme, lang);
    const bar = page.getByRole('navigation', { name: /activité|Activity/ });
    await expect(bar.getByRole('button', { name: fr ? 'Projets' : 'Projects', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: fr ? 'À toi' : 'For you', exact: true })).toHaveCount(0);
    const tag = (name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) }).locator('.at-tag');
    await expect(tag('Pim')).toHaveText(fr ? 'Accord' : 'Approval');
    await expect(tag('Tom')).toHaveText('Question');
    await expect(tag('Zed')).toHaveText(fr ? 'Erreur' : 'Error');
    await expect(tag('Ida')).toHaveCount(0);
    await page.locator('.ide-explorer').screenshot({ path: `${OUT}/tree-tags-${theme}-${lang}.png` });
    await bar.screenshot({ path: `${OUT}/activity-bar-${theme}-${lang}.png` });
  });
}
