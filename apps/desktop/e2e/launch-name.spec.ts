import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

// Issue #15, « Nouvelle session » with a name (docs/mockups/ledge-launch-name.html, v2, validated by the owner on 2026-11-26:
// « Tout recommandé »). « Définir un nom ? » on the Project row's right, off at each opening; on, the Name row shows under Project and
// takes the focus; a taken or reserved name blocks « Lancer »; off, the name typed is kept but not sent. The captures (French, both
// themes) are left beside the mockup's ledge-launch-name-s1…s4-*-fr.png.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

type Launch = Extract<ClientMessage, { type: 'session.launch' }>;
const launchesOf = (received: ClientMessage[]) => received.filter((m): m is Launch => m.type === 'session.launch');

/** Geist as Desktop gets it (index.html), from the mobile app's @fontsource copy: widths as the mockup's. */
const GEIST = readFileSync(new URL('../../mobile/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', import.meta.url));
async function realGeist(page: Page): Promise<void> {
  await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css',
    body: "@font-face { font-family: 'Geist'; font-style: normal; font-weight: 100 900; src: url(https://fonts.gstatic.com/geist.woff2) format('woff2'); }" }));
  await page.route(/fonts\.gstatic\.com\/geist\.woff2/, r => r.fulfill({ status: 200, contentType: 'font/woff2', body: GEIST }));
}

async function open(page: Page, theme: 'dark' | 'light' = 'dark', sessions = eight) {
  await realGeist(page);
  await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await page.locator('.ide-dock').getByRole('button', { name: 'Nouvelle session (N)' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await expect(dialog.locator('.launch-modal')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { daemon, dialog, sw: dialog.getByRole('switch', { name: 'Définir un nom ?' }), field: dialog.getByRole('textbox', { name: 'Nom' }),
    launch: dialog.getByRole('button', { name: /^Lancer/ }), prompt: dialog.getByRole('textbox', { name: 'Premier message' }) };
}

test('off by default: the switch on the Project row, no Name row, the box at its height; the launch leaves the name to the daemon', async ({ page }) => {
  const { daemon, dialog, sw, field, prompt } = await open(page);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(field).toHaveCount(0);
  // On the Project row's right, on its line.
  const [row, s] = [await dialog.locator('.launch-modal-menu').boundingBox(), await sw.boundingBox()];
  expect(s!.x).toBeGreaterThan(row!.x + row!.width);
  expect(Math.abs((s!.y + s!.height / 2) - (row!.y + row!.height / 2))).toBeLessThanOrEqual(1);
  await prompt.fill('Relis la PR #231 et dis-moi si elle peut partir.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBeUndefined();
});

test('on: the Name row under Project takes the focus; its placeholder is the free name; a cleaned name says so, and is the one sent', async ({ page }) => {
  const { daemon, dialog, sw, field, prompt } = await open(page);
  const height = (await dialog.boundingBox())!.height;
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(field).toBeFocused();
  // eight holds Otto, Nova, Pim and Bix on this machine: Lu is the next free name.
  await expect(field).toHaveAttribute('placeholder', 'Laissez vide pour Lu');
  await expect(dialog.locator('.launch-modal-hint')).toHaveText('C’est son adresse : les autres sessions lui écrivent sous ce nom (ledge who, SendMessage). Lettres, chiffres, - et _.');
  expect((await dialog.boundingBox())!.height).toBeGreaterThan(height);
  await field.fill('Revue PR');
  await expect(dialog.locator('.launch-modal-hint')).toHaveText('La session s’appellera RevuePR : espaces et ponctuation sont retirés.');
  await prompt.fill('Relis la PR #231.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBe('RevuePR');
});

test('a taken name: the field says whose it is, « Lancer » does not send; off, the block lifts and the name is kept for when it comes back', async ({ page }) => {
  const { daemon, dialog, sw, field, launch, prompt } = await open(page);
  await prompt.fill('Relis la PR #231.');
  await sw.click();
  await field.fill('otto');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('.launch-modal-ferr')).toHaveText('Otto est déjà le nom d’une session de Ledge. Choisissez un autre nom, ou laissez vide.');
  await expect(launch).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled, still focusable and clickable (Playwright would wait for it to be enabled): the click says why.
  await launch.click({ force: true });
  await expect(dialog.locator('.launch-modal-go .launch-modal-alert')).toHaveText('Choisissez un autre nom pour la session');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  expect(launchesOf(daemon.received)).toEqual([]);
  // Off: the row goes, « Lancer » is free again, the typed name is not sent.
  await sw.click();
  await expect(field).toHaveCount(0);
  await expect(launch).not.toHaveAttribute('aria-disabled', 'true');
  // Back on: what was typed is there.
  await sw.click();
  await expect(field).toHaveValue('otto');
  await sw.click();
  await launch.click();
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBeUndefined();
});

test('a base held by a numbered session, and « ledge »: refused with their own sentences', async ({ page }) => {
  const sessions = [...eight, session('kit2', { name: 'Kit-2', project: 'ledge', cwd: '/w/ledge', state: 'working' })];
  const { dialog, sw, field, launch } = await open(page, 'dark', sessions);
  await sw.click();
  await field.fill('Kit');
  await expect(dialog.locator('.launch-modal-ferr')).toHaveText('Kit est déjà pris : Kit-2 porte ce nom.');
  await field.fill('Ledge');
  await expect(dialog.locator('.launch-modal-ferr')).toHaveText('ledge est réservé à Ledge lui-même. Choisissez un autre nom.');
  await expect(launch).toHaveAttribute('aria-disabled', 'true');
  // A finished session does not hold its name.
  await field.fill('Lu');
  await expect(dialog.locator('.launch-modal-ferr')).toHaveCount(0);
});

test('Space on the focused switch turns it on', async ({ page }) => {
  const { sw, field } = await open(page);
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(field).toBeFocused();
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(() => {
    test.use({ deviceScaleFactor: 2 });
    test(`captures beside the mockup's cards 1 to 4, ${theme}`, async ({ page }, info) => {
      const { dialog, sw, field, prompt } = await open(page, theme);
      await prompt.fill('Relis la PR #231 et dis-moi si elle peut partir.');
      const shot = (n: string) => dialog.screenshot({ path: info.outputPath(`launch-name-${n}-${theme}-fr.png`) });
      await shot('s1');
      await sw.click();
      await shot('s2-empty');
      await field.fill('Revue PR');
      await shot('s2-filled');
      await field.fill('Otto');
      await dialog.getByRole('button', { name: /^Lancer/ }).click({ force: true });
      await shot('s3');
      await sw.click();
      await shot('s4');
    });
  });
}
