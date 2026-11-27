// Issue #15 (docs/mockups/ledge-launch-name.html, card 6): on the phone, « Définir un nom ? » on the Project label's right, off at
// opening; on, the Name field under the project, the free name as its placeholder; a taken name says whose it is and the button
// « Choisis un autre nom ». Dark and light, French. SHOTS=<dir> saves a capture of each state beside the mockup's s6.
import { devices, expect, test, type Page } from '@playwright/test';
import { copyFor } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const T = new Date().toISOString();
let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  h.daemon.device = { registered: true, prepare: () => undefined } as never;
  h.daemon.launch = true;
  h.daemon.projects = [{ id: 'ledge', name: 'ledge', color: 'blue' }];
  h.daemon.projectFolders = { recents: [], home: '/home/u', listings: {}, folders: { ledge: [{ machine: 'local', path: '/home/u/ledge' }] } };
  h.daemon.sessions = [
    { id: 'otto', name: 'Otto', tool: 'claude', project: 'ledge', title: 'Otto · ledge', state: 'working', helpers: [], startedAt: T, lastActivityAt: T, unread: false },
    { id: 'pim', name: 'Pim', tool: 'claude', project: 'ledge', title: 'Pim · ledge', state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, unread: false }
  ];
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/launch-name-${name}.png` });
}

const c = copyFor('fr');
const L = c.launch;
for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a phone, ${theme}`, () => {
    test.use(iPhone13);
    test('« Définir un nom ? »: off, on and empty, a taken name', async ({ page }) => {
      await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); localStorage.setItem('mobile.lang', 'fr'); } catch { /* ignore */ } }, theme);
      await page.goto(h.url);
      await page.getByRole('link', { name: c.login.github }).click();
      await page.getByRole('button', { name: c.recover.code }).click();
      await h.pc.code();
      await page.getByRole('button', { name: c.compare.same }).click();
      h.pc.ok();
      await page.getByRole('link', { name: c.compare.seePending }).click();
      await page.evaluate(() => { location.hash = '#/new'; });

      const sw = page.getByRole('switch', { name: L.nameToggle });
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('textbox', { name: L.name })).toHaveCount(0);
      // On the Project label's line, at its right.
      const [label, s] = [await page.getByText(L.project, { exact: true }).first().boundingBox(), await sw.boundingBox()];
      expect(Math.abs((label!.y + label!.height / 2) - (s!.y + s!.height / 2))).toBeLessThanOrEqual(2);
      expect(s!.x).toBeGreaterThan(label!.x + label!.width);
      await shot(page, `off-${theme}`);

      await sw.click();
      const field = page.getByRole('textbox', { name: L.name });
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute('placeholder', L.namePlaceholder('Nova'));
      await expect(page.getByText(L.nameHint)).toBeVisible();
      await field.blur();
      await shot(page, `on-${theme}`);

      await field.fill('Otto');
      await expect(page.getByRole('alert')).toHaveText(L.nameTaken('Otto', 'ledge'));
      await expect(page.getByRole('button', { name: L.missing.name })).toBeDisabled();
      await field.blur();
      await shot(page, `taken-${theme}`);
    });
  });
}
