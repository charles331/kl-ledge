import { test as base, expect, type Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';

/**
 * Every spec runs the real app in Chromium, in English unless it opts into French (`lang`). The web fonts are answered locally (no network in CI), and every console
 * error or uncaught page error fails the test that produced it.
 */
export const test = base.extend<{ errors: string[]; lang: 'en' | 'fr' | null }>({
  /** The overlay defaults to French. The older specs read English: they run with Desktop's `desktop.lang` = 'en' stored before the
   *  app boots. `test.use({ lang: null })` leaves storage alone (the French default), 'fr' stores French. */
  lang: ['en', { option: true }],
  errors: [async ({ page, lang }, use) => {
    if (lang) await page.addInitScript(l => { try { if (!sessionStorage.getItem('ledge.e2e.langSet')) { localStorage.setItem('desktop.lang', l); sessionStorage.setItem('ledge.e2e.langSet', '1'); } } catch { /* ignore */ } }, lang);
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await use(errors);
    expect(errors, 'no console or page errors').toEqual([]);
  }, { auto: true }]
});
export { expect };

export const surface = (page: Page) => page.locator('[data-surface]');
export const island = (page: Page) => page.locator('.di-island');
export const card = (page: Page) => page.locator('.di-card');
/** Waits until the fake daemon received a message matching `pred`, and returns it. */
export async function received<T extends ClientMessage['type']>(list: ClientMessage[], type: T, pred: (m: Extract<ClientMessage, { type: T }>) => boolean = () => true) {
  let found: Extract<ClientMessage, { type: T }> | undefined;
  await expect.poll(() => (found = list.find((m): m is Extract<ClientMessage, { type: T }> => m.type === type && pred(m as Extract<ClientMessage, { type: T }>)))).toBeTruthy();
  return found!;
}
/** The page is up, the daemon connected, the island at rest. */
export async function ready(page: Page) {
  await page.goto('/');
  await expect(surface(page)).toHaveAttribute('data-phase', 'gone');
}
