import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady, pane, tabOf } from './ide';

// Preview tabs (docs/superpowers/specs/2026-11-26-preview-tabs-design.md §7; approved mockup docs/mockups/ledge-preview-tabs.html,
// option 1: the italic alone). A single click in Projects shows a session in its group's preview, which the next single click
// replaces in place; a double click keeps it; typing in its composer keeps it. LEDGE_VISUAL=1 saves zoomed captures of the
// italic title before and after a double click, dark and light.
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
test.setTimeout(90_000);

const sessions: Session[] = [
  session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge', state: 'idle' }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'idle' }),
  session('sol', { name: 'Sol', project: 'ledge', cwd: '/w/ledge', state: 'idle' })
];

/** Geist as Desktop gets it from Google Fonts (index.html: `wght@400;500;600;700`): upright faces only. The fixtures answer
 *  Google Fonts with nothing (offline), which leaves a system font that has an italic of its own and hides the problem the
 *  title's `font-synthesis-style: auto` solves. Served from the mobile app's @fontsource copy, upright file only. */
const GEIST = readFileSync(new URL('../../mobile/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', import.meta.url));
async function realGeist(page: Page): Promise<void> {
  await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css',
    body: "@font-face { font-family: 'Geist'; font-style: normal; font-weight: 100 900; src: url(https://fonts.gstatic.com/geist-upright.woff2) format('woff2'); }" }));
  await page.route(/fonts\.gstatic\.com\/geist-upright\.woff2/, r => r.fulfill({ status: 200, contentType: 'font/woff2', body: GEIST }));
}

async function boot(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  await realGeist(page);
  await page.addInitScript(t => { try { localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await ideReady(page);
}
const row = (page: Page, name: string) => page.locator('.ide-explorer').getByRole('button', { name: new RegExp(`^${name}`) }).first();
const names = (page: Page) => page.locator('.ide-dockview .dv-tab .tab-name').allTextContents();
const preview = (page: Page, name: string) => tabOf(page, name).locator('.ide-tab.preview');

test('three single clicks in Projects leave one tab, the last one, as the preview', async ({ page }) => {
  await boot(page);
  for (const name of ['Pim', 'Nova', 'Sol']) {
    await row(page, name).click();
    await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
  }
  await expect.poll(() => names(page)).toEqual(['Atelier', 'Sol']);
  await expect(preview(page, 'Sol')).toHaveCount(1);
});

test('a double click keeps the tab: the next single click adds a preview beside it', async ({ page }) => {
  await boot(page);
  await row(page, 'Pim').dblclick();
  await expect(tabOf(page, 'Pim')).toHaveClass(/dv-active-tab/);
  await expect(preview(page, 'Pim')).toHaveCount(0);
  await row(page, 'Nova').click();
  await expect.poll(() => names(page)).toEqual(['Atelier', 'Pim', 'Nova']);
  await expect(preview(page, 'Nova')).toHaveCount(1);
  // A double click on the preview's own tab keeps it too.
  await tabOf(page, 'Nova').dblclick();
  await expect(preview(page, 'Nova')).toHaveCount(0);
  await row(page, 'Sol').click();
  await expect.poll(() => names(page)).toEqual(['Atelier', 'Pim', 'Nova', 'Sol']);
});

test('typing in the composer of a preview keeps it: clicking another agent leaves both tabs', async ({ page }) => {
  await boot(page);
  await row(page, 'Pim').click();
  const reply = pane(page, 'Pim').getByRole('textbox', { name: 'Reply to the agent' });
  await expect(reply).toBeVisible({ timeout: 20_000 });
  await reply.fill('');
  await reply.pressSequentially('Bonjour');
  await expect(preview(page, 'Pim')).toHaveCount(0);
  await row(page, 'Nova').click();
  await expect.poll(() => names(page)).toEqual(['Atelier', 'Pim', 'Nova']);
  await tabOf(page, 'Pim').click();
  await expect(pane(page, 'Pim').getByRole('textbox', { name: 'Reply to the agent' })).toHaveValue('Bonjour');
});

for (const theme of ['dark', 'light'] as const) {
  test(`the preview's title is in italic and really slanted (${theme}); kept, it straightens`, async ({ page }) => {
    await boot(page, theme);
    await row(page, 'Pim').dblclick();
    await row(page, 'Nova').click();
    const title = tabOf(page, 'Nova').locator('.tab-name');
    await expect(preview(page, 'Nova')).toHaveCount(1);
    await expect(title).toHaveCSS('font-style', 'italic');
    await page.evaluate(() => document.fonts.ready);
    // Drawn in Geist, which has no italic here: the slant can only come from the browser's synthesis.
    expect(await page.evaluate(() => [...document.fonts].some(f => f.family.replaceAll('"', '') === 'Geist' && f.status === 'loaded'))).toBe(true);
    const strip = page.locator('.ide-dockview .dv-tabs-and-actions-container').first();
    const shot = async (name: string) => {
      const png = await strip.screenshot({ animations: 'disabled' });
      if (process.env.LEDGE_VISUAL) await strip.screenshot({ path: `e2e/.results/preview-tabs-${name}-${theme}.png`, animations: 'disabled' });
      return png;
    };
    // Desktop sets `font-synthesis: none` and loads Geist without an italic: without `font-synthesis-style: auto` the italic
    // title would draw exactly as the upright one. The same tab, the pointer away, drawn with and without the mark, must differ.
    await page.mouse.move(0, 0);
    const slanted = await title.screenshot({ animations: 'disabled' });
    await title.evaluate(el => el.closest('.ide-tab')!.classList.remove('preview'));
    const upright = await title.screenshot({ animations: 'disabled' });
    await title.evaluate(el => el.closest('.ide-tab')!.classList.add('preview'));
    expect(slanted.equals(upright)).toBe(false);
    await shot('before');
    await tabOf(page, 'Nova').dblclick();
    await expect(preview(page, 'Nova')).toHaveCount(0);
    await expect(title).toHaveCSS('font-style', 'normal');
    await page.mouse.move(0, 0);
    await shot('after');
  });
}
