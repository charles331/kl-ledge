import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session } from './daemon';

// Issue #44 (docs/mockups/ledge-closed-reply.html, option A, validated by the owner): a reply field shut by a question that takes
// only its proposed answers (Codex, Cursor) has no placeholder; the hint under it says why, alone. SHOTS=<dir> saves the field
// beside the mockup's s2 (dark FR, light FR, dark EN).
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

const nova = session('nova', { name: 'Nova', tool: 'codex', project: 'ledge', cwd: '/w/ledge', branch: 'main', state: 'waiting_input',
  pending: { kind: 'question', text: 'Quelle base pour la branche du lot 13 ?', options: ['main', 'develop', 'release/0.68'], source: 'hook' } });

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await seedAtelier(page);
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, [nova]);
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ide-explorer').getByRole('button', { name: /^Nova/ }).first().dblclick();
  await expect(page.locator('.session-page')).toBeVisible({ timeout: 20_000 });
}

for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en']] as const) {
  test(`a field shut by a question with proposed answers has no placeholder, its hint alone (${theme}, ${lang})`, async ({ page }) => {
    await open(page, theme, lang);
    const field = page.locator('.session-reply textarea');
    await expect(field).toBeDisabled();
    await expect(field).toHaveAttribute('placeholder', '');
    await expect(page.locator('.reply-hint')).toHaveText(lang === 'fr' ? 'Choisissez une des réponses proposées (1–9).' : 'Choose one of the proposed answers (1–9).');
    if (process.env.SHOTS) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.locator('.session-reply').screenshot({ path: `${process.env.SHOTS}/closed-reply-${theme}-${lang}.png` });
    }
  });
}
