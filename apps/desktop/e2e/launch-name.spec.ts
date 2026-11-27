import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

// « Nouvelle session » and its name (issue #15), proposal A of docs/mockups/ledge-sidebar-names.html (cards 3 and 4, validated by the
// owner on 2026-11-27): the name Ledge will give stands in the title, « Nouvelle session · Pim ✎ »; a click or F2 makes it a field
// there, selected; a taken or reserved name rings it, says why in place of the hint, and « Lancer » waits; Escape goes back to Ledge's
// pick. The captures (French, both themes, zoomed) are left in the test's output folder.
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
  return { daemon, dialog, title: dialog.locator('.modal-title h2'), name: dialog.locator('.launch-modal-tbtn'), field: dialog.getByRole('textbox', { name: 'Nom' }),
    sub: dialog.locator('.launch-modal-sub'), launch: dialog.getByRole('button', { name: /^Lancer/ }), prompt: dialog.getByRole('textbox', { name: 'Premier message' }) };
}

/** The vertical middle of a box. */
const mid = (b: { y: number; height: number } | null) => b!.y + b!.height / 2;
/** The vertical middle of an element's own text (its first text node), what the eye lines up: not its box and its padding. */
const textMid = (l: import('@playwright/test').Locator) => l.evaluate(el => {
  const node = [...el.childNodes].find(x => x.nodeType === 3 && x.textContent!.trim())!;
  const r = document.createRange(); r.selectNodeContents(node); const b = r.getBoundingClientRect();
  return (b.top + b.bottom) / 2;
});

test('at rest: « Nouvelle session · Lu ✎ » on the title\'s line, no switch; the launch leaves the name to the daemon', async ({ page }) => {
  const { daemon, dialog, title, name, prompt } = await open(page);
  // eight holds Otto, Nova, Pim and Bix on this machine: Lu is the next free name.
  await expect(name).toHaveText('Lu');
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  const [t, n] = [await title.boundingBox(), await name.boundingBox()];
  expect(n!.x).toBeGreaterThan(t!.x + t!.width);
  expect(Math.abs((await textMid(name)) - (await textMid(title)))).toBeLessThanOrEqual(0.5);
  await prompt.fill('Relis la PR #231 et dis-moi si elle peut partir.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBeUndefined();
});

test('a click: the name as a field in the title, selected, the hint under it; a cleaned name says so, and is the one sent', async ({ page }) => {
  const { daemon, dialog, title, name, field, sub, prompt } = await open(page);
  const height = (await dialog.boundingBox())!.height;
  await name.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Lu');
  expect(await field.evaluate((x: HTMLInputElement) => [x.selectionStart, x.selectionEnd])).toEqual([0, 2]);
  expect(Math.abs(mid(await field.boundingBox()) - (await textMid(title)))).toBeLessThanOrEqual(1);
  await expect(sub).toHaveText('Entrée valide le nom · Échap revient à Lu');
  // The box keeps its height: nothing was added under Project.
  expect((await dialog.boundingBox())!.height).toBe(height);
  await page.keyboard.type('Revue PR');
  await expect(sub).toHaveText('La session s’appellera RevuePR : espaces et ponctuation sont retirés.');
  await page.keyboard.press('Enter');
  await expect(name).toHaveText('RevuePR');
  await expect(name).toBeFocused();
  await prompt.fill('Relis la PR #231.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBe('RevuePR');
});

test('a taken name: ringed, the reason in place of the hint, « Lancer » does not send; Escape goes back to Lu', async ({ page }) => {
  const { daemon, dialog, name, field, sub, launch, prompt } = await open(page);
  await prompt.fill('Relis la PR #231.');
  await name.click();
  await page.keyboard.type('otto');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(sub).toHaveText('Otto est déjà le nom d’une session de Ledge. Choisissez un autre nom, ou laissez vide.');
  await expect(launch).toHaveAttribute('aria-disabled', 'true');
  await launch.click({ force: true });
  await expect(dialog.locator('.launch-modal-go .launch-modal-alert')).toHaveText('Choisissez un autre nom pour la session');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  expect(launchesOf(daemon.received)).toEqual([]);
  // « Lancer » took the focus: the field closed on « Otto », still refused; open again, Escape goes back to Ledge's pick.
  await expect(name).toHaveText('Otto');
  await name.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(name).toHaveText('Lu');
  await expect(launch).not.toHaveAttribute('aria-disabled', 'true');
  await launch.click();
  await expect.poll(() => launchesOf(daemon.received).length).toBe(1);
  expect(launchesOf(daemon.received)[0]!.name).toBeUndefined();
});

test('a base held by a numbered session, and « ledge »: refused with their own sentences', async ({ page }) => {
  const sessions = [...eight, session('kit2', { name: 'Kit-2', project: 'ledge', cwd: '/w/ledge', state: 'working' })];
  const { name, field, sub, launch } = await open(page, 'dark', sessions);
  await name.click();
  await field.fill('Kit');
  await expect(sub).toHaveText('Kit est déjà pris : Kit-2 porte ce nom.');
  await field.fill('Ledge');
  await expect(sub).toHaveText('ledge est réservé à Ledge lui-même. Choisissez un autre nom.');
  await expect(launch).toHaveAttribute('aria-disabled', 'true');
  // A finished session does not hold its name.
  await field.fill('Lu');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
});

test('F2 anywhere in the box opens the name', async ({ page }) => {
  const { field, prompt } = await open(page);
  await prompt.focus();
  await page.keyboard.press('F2');
  await expect(field).toBeFocused();
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(() => {
    test.use({ deviceScaleFactor: 2 });
    test(`captures beside the mockup's card 4, ${theme}`, async ({ page }, info) => {
      const { dialog, name, field, prompt } = await open(page, theme);
      await prompt.fill('Relis la PR #231 et dis-moi si elle peut partir.');
      const shot = (n: string) => dialog.screenshot({ path: info.outputPath(`launch-name-${n}-${theme}-fr.png`) });
      await shot('rest');
      await name.hover();
      await shot('hover');
      await name.click();
      await shot('edit');
      await page.keyboard.type('Otto');
      await shot('taken');
      // The title's line, zoomed: the name and the field against « Nouvelle session ».
      const t = (await dialog.locator('.modal-title').boundingBox())!;
      await page.screenshot({ path: info.outputPath(`launch-name-title-taken-${theme}-fr.png`), clip: { x: t.x, y: t.y, width: Math.min(t.width, 520), height: t.height + 30 } });
      await field.fill('');
      await page.keyboard.press('Escape');
      await page.screenshot({ path: info.outputPath(`launch-name-title-rest-${theme}-fr.png`), clip: { x: t.x, y: t.y, width: Math.min(t.width, 520), height: t.height + 30 } });
    });
  });
}
