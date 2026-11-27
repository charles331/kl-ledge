// Captures of docs/mockups/ledge-thread-cowork-rows.html, before and after, each in a fresh browser context.
// Usage: PAGE=<html> SHOTS=<dir> node shots.mjs <path to a playwright-core package> [name filter]
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = process.env.SHOTS;
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const only = process.argv[3];
const url = pathToFileURL(process.env.PAGE).href;
const browser = await chromium.launch();
const errors = [];
async function shot(name, query, { clip, size = [1600, 1000], scale = 1, end = false } = {}) {
  if (only && !name.includes(only)) return;
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${url}?${query}`);
  await page.locator('.cw-col').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.evaluate(end => { for (const el of document.querySelectorAll('.session-thread')) el.scrollTop = end ? el.scrollHeight : 0; }, end);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, `ledge-thread-cowork-rows-${name}.png`), ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) });
  await context.close();
}
for (const theme of ['dark', 'light']) for (const rows of ['avant', 'apres']) {
  await shot(`${rows}-${theme}`, `rows=${rows}&theme=${theme}`);
  await shot(`${rows}-etroit-${theme}`, `rows=${rows}&vue=split&theme=${theme}`);
  await shot(`${rows}-fin-${theme}`, `rows=${rows}&theme=${theme}`, { end: true });
  await shot(`${rows}-zoom-${theme}`, `rows=${rows}&theme=${theme}`, { clip: [400, 84, 800, 880], scale: 2 });
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'ok');
