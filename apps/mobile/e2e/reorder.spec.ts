// Issue #16 on the phone (docs/mockups/ledge-reorder.html, cards 6 and 7): a long press then a drag moves a session within its
// project and a project among the projects; the PC keeps the order. Dark and light, French and English. Captures in
// e2e/.results/reorder/ (or SHOTS=<dir>).
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import type { PhoneSession } from '@ledge/protocol';
import { copyFor, type Lang } from '../src/copy';
import { PC_NAME, startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const OUT = process.env.SHOTS ?? 'e2e/.results/reorder';
const T = (min: number) => new Date(Date.UTC(2026, 10, 26, 9, min)).toISOString();
const s = (id: string, name: string, project: string, extra: Partial<PhoneSession> = {}): PhoneSession =>
  ({ id, name, tool: 'claude', project, projectId: project, title: `${name} · ${project}`, state: 'idle', helpers: [], startedAt: T(0), lastActivityAt: T(0), unread: false, ...extra } as PhoneSession);

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  h.daemon.projects = [{ id: 'ledge', name: 'ledge', color: 'blue' }, { id: 'synapse', name: 'synapse', color: 'green' }];
  h.daemon.sessionOrder = {};
  h.daemon.sessions = [
    s('pim', 'Pim', 'ledge', { startedAt: T(1), state: 'waiting_input' }),
    s('ida', 'Ida', 'ledge', { startedAt: T(2) }),
    s('nova', 'Nova', 'ledge', { startedAt: T(3), state: 'working' }),
    s('echo', 'Echo', 'synapse', { startedAt: T(4) })
  ];
});
test.afterEach(async () => { await h?.close(); });

async function pair(page: Page, theme: 'dark' | 'light', lang: Lang) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('ledge.theme', t!); localStorage.setItem('mobile.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
  await page.goto(h.url);
  const c = copyFor(lang);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  // The PC's first snapshot has come once the heading names it.
  await expect(page.getByRole('heading', { name: new RegExp(`${PC_NAME}$`) })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: c.compare.seePending }).click();
  await page.evaluate(() => { location.hash = '#/sessions'; });
  await expect(page.getByRole('region', { name: 'ledge' })).toBeVisible();
}
const rows = (page: Page, project: string) => page.getByRole('region', { name: project }).getByRole('link').evaluateAll(as => as.map(a => a.getAttribute('href')!.replace('#/thread/', '')));
const box = async (l: Locator) => (await l.boundingBox())!;
/** A long press (held past 500 ms), then a drag to `y`, held while `during` runs, then let go. */
async function liftAndDrag(page: Page, from: Locator, y: () => Promise<number>, during?: () => Promise<void>) {
  const b = await box(from);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  const to = await y();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + (to > b.y ? 14 : -14), { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, to, { steps: 8 });
  if (during) await during();
  await page.mouse.up();
}

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a phone, ${theme}, ${lang}`, () => {
    test.use(iPhone13);
    test('a session lifted and dragged above another; a project dragged below the other; both kept by the PC', async ({ page }) => {
      await pair(page, theme, lang);
      // Card 7: the kept order, a session never listed last; none listed yet, oldest first (no longer those waiting first).
      expect(await rows(page, 'ledge')).toEqual(['pim', 'ida', 'nova']);
      const ledge = page.getByRole('region', { name: 'ledge' });
      const nova = ledge.getByRole('link').nth(2);
      await liftAndDrag(page, nova, async () => (await box(ledge.getByRole('link').nth(0))).y + 4, async () => {
        await expect(page.locator('[data-insert-line]')).toHaveCount(1);
        await expect(nova).toHaveAttribute('style', /scale\(1\.02\)/);
        await page.screenshot({ path: `${OUT}/phone-drag-${theme}-${lang}.png` });
      });
      await expect.poll(() => rows(page, 'ledge')).toEqual(['nova', 'pim', 'ida']);
      expect(h.daemon.sessionOrder).toEqual({ ledge: ['nova', 'pim', 'ida'] });
      await expect(page.locator('[data-reorder-said]')).toHaveText(lang === 'fr' ? 'Nova est maintenant 1re sur 3 dans ledge.' : 'Nova is now 1 of 3 in ledge.');
      // The project's heading, dragged below synapse.
      const heading = ledge.locator('> div').first();
      await liftAndDrag(page, heading, async () => { const b = await box(page.getByRole('region', { name: 'synapse' })); return b.y + b.height - 4; });
      await expect.poll(() => page.getByRole('region').evaluateAll(rs => rs.map(r => r.getAttribute('aria-label')))).toEqual(['synapse', 'ledge']);
      expect(h.daemon.projects!.map(p => p.id)).toEqual(['synapse', 'ledge']);
      await page.screenshot({ path: `${OUT}/phone-after-${theme}-${lang}.png` });
    });

    test('held without moving: the actions, with Monter and Descendre', async ({ page }) => {
      const c = copyFor(lang).sessions.reorder;
      await pair(page, theme, lang);
      const first = page.getByRole('region', { name: 'ledge' }).getByRole('link').first();
      const b = await box(first);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('button', { name: c.up })).toBeDisabled();
      await page.screenshot({ path: `${OUT}/phone-actions-${theme}-${lang}.png` });
      await sheet.getByRole('button', { name: c.down }).click();
      await expect.poll(() => rows(page, 'ledge')).toEqual(['ida', 'pim', 'nova']);
    });
  });
}
