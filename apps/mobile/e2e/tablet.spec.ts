// An iPad, either way up: the tabs are a rail on the left, the list stays on the left and what it opens shows beside it
// (docs/mockups/mobile-multi-device.html, part 5). Narrower (Split View), the phone's single column comes back.
// SHOTS=<dir> saves a capture of each screen there.
import { devices, expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { openRequest, startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPad } = devices['iPad Pro 11 landscape'];
test.use(iPad);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');

let h: Harness;
test.beforeAll(async () => { h = await startHarness(); });
test.afterAll(async () => { await h?.close(); });

async function shot(page: Page, name: string, browser: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${browser}-tablet-${name}.png` });
}

test('on an iPad the list and the request sit side by side, either way up', async ({ page, browserName }) => {
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  // The app without a key opens on the choice (passkey-reinstall.html, 1 a): the code.
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
  // Sessions is home (#40 D6): nothing chosen yet, the right pane says what will open there.
  const row = page.locator('.split-list main a[href^="#/thread/"]', { hasText: 'Otto' }).first();
  await expect(row).toBeVisible();
  await expect(page.getByRole('heading', { name: copy.split.agent.title })).toBeVisible();
  const nav = page.getByRole('navigation', { name: copy.nav.label });
  expect.soft((await nav.boundingBox())!.x).toBe(0);
  await shot(page, 'sessions', browserName);

  // The request, as its push opens it: beside the Sessions list, its session's row lit; no « Retour » to a list that is there.
  await openRequest(page, 'p1');
  const allow = page.getByRole('button', { name: copy.decide.allow });
  await expect(allow).toBeEnabled();
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'page');
  expect.soft((await allow.boundingBox())!.x).toBeGreaterThan((await row.boundingBox())!.x + (await row.boundingBox())!.width);
  await expect(page.getByRole('link', { name: copy.nav.backTo.sessions! })).toBeHidden();
  await shot(page, 'request', browserName);

  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(row).toBeVisible();
  await expect(allow).toBeVisible();
  await shot(page, 'request-portrait', browserName);

  // Split View: a phone's width, a phone's column.
  await page.setViewportSize({ width: 420, height: 1194 });
  await expect(row).toBeHidden();
  await expect(allow).toBeVisible();
  await shot(page, 'request-narrow', browserName);

  // Y allows it, its receipt shows, then the pane moves on; with none left, Sessions' « nothing chosen ».
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(allow).toBeEnabled();
  await page.keyboard.press('y');
  await expect(page.getByText(copy.result.allowed)).toBeVisible();
  await expect.poll(() => h.daemon.typed.length).toBe(1);
  await expect(page.getByRole('heading', { name: copy.split.agent.title })).toBeVisible({ timeout: 10_000 });

  // A thread beside the agents.
  const agent = page.locator('.split-list main a[href^="#/thread/"]').first();
  await agent.click();
  await expect(agent).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.split-detail header')).toBeVisible();
  await shot(page, 'thread', browserName);
});


// Sessions upright (t-tablette.html §2, §3; Q92 A, Q93 A): the thread keeps the list beside it with the phone's foot; the terminal
// folds the list and takes the whole width, and « Retour » reopens it.
test('upright, the thread keeps the list beside it and the terminal folds it', async ({ page, browserName }) => {
  // Its own PC: the file's one is already paired with the first test's page.
  const h = await startHarness();
  try {
    await page.setViewportSize({ width: 834, height: 1194 });
    await page.goto(h.url);
    await page.getByRole('link', { name: copy.login.github }).click();
    await page.getByRole('button', { name: copy.recover.code }).click();
    await h.pc.code();
    await page.getByRole('button', { name: copy.compare.same }).click();
    h.pc.ok();
    await page.getByRole('link', { name: copy.compare.seePending }).click();
    await page.getByRole('navigation', { name: copy.nav.label }).getByRole('link', { name: copy.nav.sessions }).click();
    await page.locator('.split-list main a[href^="#/thread/"]').first().click();
    const list = page.locator('.split-list');
    await expect(list).toBeVisible();
    expect.soft((await list.boundingBox())!.width).toBe(330);
    // The thread's pane keeps 18 px on each side, as §2 draws it (review-qa 6873dfab).
    const pad = await page.locator('.split-detail').evaluate(e => [getComputedStyle(e).paddingLeft, getComputedStyle(e).paddingRight]);
    expect.soft(pad).toEqual(['18px', '18px']);
    await shot(page, 'thread-portrait', browserName);

    await page.locator('.split-detail').getByRole('link', { name: copy.sessions.view.terminal }).click();
    await expect(list).toBeHidden();
    const detail = (await page.locator('.split-detail').boundingBox())!;
    expect.soft(detail.x).toBe(76);
    expect.soft(detail.width).toBe(834 - 76);
    await shot(page, 'terminal-portrait', browserName);

    await page.locator('.split-detail [data-back]').first().click();
    await expect(list).toBeVisible();
  } finally {
    await h.close();
  }
});
