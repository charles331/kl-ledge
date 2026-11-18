// Issue #2 (docs/mockups/ledge-project-folders.html, card 6): on the phone, « Nouveau projet » takes its first folder, and a project's
// last folder cannot be removed. Réglages › Projets on a PC that offers the folders; dark and light, French and English.
// SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import { copyFor, type Lang } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const HOME = '/home/u';
let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  // A passkey registered (the snapshot's `device.confirm`); nothing is created here, so no challenge is asked.
  h.daemon.device = { registered: true, prepare: () => undefined } as never;
  h.daemon.projects = [{ id: 'paper', name: 'Paper', color: 'blue' }, { id: 'ledge', name: 'Ledge', color: 'green' }];
  h.daemon.projectFolders = {
    recents: [`${HOME}/Workspace/paper/paper-rendering`, `${HOME}/Workspace/ledge`], home: HOME,
    listings: { [HOME]: ['Workspace', 'notes'] },
    folders: { paper: [{ machine: 'local', path: `${HOME}/Workspace/paper/paper-rendering` }] }
  };
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/project-folders-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light', lang: Lang) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('ledge.theme', t!); localStorage.setItem('mobile.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
  await page.goto(h.url);
  const c = copyFor(lang);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: c.compare.seePending }).click();
}

for (const lang of ['fr', 'en'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    const P = copyFor(lang).settings.projects;
    test.describe(`on a phone, ${theme}, ${lang}`, () => {
      test.use(iPhone13);
      test('« Nouveau projet »: its first folder; « Dossiers de … »: the last one stays', async ({ page }) => {
        const tag = `phone-${theme}-${lang}`;
        await pair(page, theme, lang);
        await page.evaluate(() => { location.hash = '#/connection'; });
        await page.getByRole('button', { name: P.add }).click();
        const sheet = page.getByRole('dialog', { name: P.newTitle });
        await expect(sheet.getByText(P.newBody)).toBeVisible();
        await sheet.getByRole('textbox').fill('Synapse');
        await expect(sheet.getByText(P.pickFirst)).toBeVisible();
        await expect(sheet.getByRole('button', { name: P.create, exact: true })).toBeDisabled();
        await shot(page, `new-${tag}`);
        await sheet.getByRole('button', { name: P.chooseLabel(`${HOME}/Workspace/ledge`) }).click();
        await expect(sheet.getByRole('button', { name: P.create, exact: true })).toBeEnabled();
        await shot(page, `new-chosen-${tag}`);
        await sheet.getByRole('button', { name: P.cancel }).click();

        await page.getByRole('button', { name: P.editLabel('Paper') }).click();
        await page.getByRole('button', { name: P.folders }).click();
        const folders = page.getByRole('dialog', { name: P.foldersTitle('Paper') });
        await expect(folders.getByText(P.lastFolder)).toBeVisible();
        await expect(folders.getByRole('button', { name: P.removeFolderLabel(`${HOME}/Workspace/paper/paper-rendering`) })).toBeDisabled();
        await shot(page, `last-${tag}`);
      });
    });
  }
}
