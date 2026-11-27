import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of the dynamic-island mockup: each section, the live demo open on a request, the light page and a phone width.
// Pass a directory to write them elsewhere than docs/mockups (a review that should not touch the tree).
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'apps/overlay/package.json'));
const { chromium } = require('@playwright/test');
const url = pathToFileURL(resolve(root, 'docs/mockups/ledge-dynamic-island.html')).href;
const dir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'docs/mockups');
const out = n => resolve(dir, `ledge-dynamic-island-${n}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(700);
const shot = (name, sel) => page.locator(sel).first().screenshot({ path: out(name) });

await shot('film', 'section:has(#film)');
await shot('kinds', 'section:has(#kinds)');
await shot('timer', 'section:has(#timer)');
await shot('gone', 'section:has(#gone)');
await shot('rules', 'section:has(#rules)');
await shot('decide', 'section:has(#decide)');
// The complement of 2026-11-27: Ledge's own notices, an agent card's other states, the settings page.
await shot('ledge', 'section:has(#ledge)');
await shot('states', 'section:has(#states)');
await shot('settings', 'section:has(#settings)');
// The live demo: at rest, the pill on its way in (slow motion), then open on a request and on a notice.
await shot('live-rest', '.di-live');
await page.getByRole('button', { name: 'Ralenti ×4' }).click();
await page.getByRole('button', { name: 'Demande d’accord' }).click();
await page.waitForTimeout(700);
await shot('live-seed', '.di-live');
await page.waitForTimeout(3200);
await shot('live-request', '.di-live');
await page.locator('.di-live').getByRole('button', { name: 'Autoriser' }).click();
await page.waitForTimeout(400);
await shot('live-ack', '.di-live');
await page.getByRole('button', { name: 'Ralenti ×4' }).click();
await page.waitForTimeout(3500);
await shot('live-after', '.di-live');
await page.getByRole('button', { name: 'Clair', exact: true }).click();
await page.getByRole('button', { name: 'Tour terminé' }).click();
await page.waitForTimeout(1500);
await shot('live-notice-light', '.di-live');
// English and light page.
await page.getByRole('button', { name: 'EN', exact: true }).click();
await page.getByRole('button', { name: /^Page/ }).click();
await page.waitForTimeout(300);
await shot('kinds-en-light', 'section:has(#kinds)');
await shot('ledge-en-light', 'section:has(#ledge)');
await shot('states-en-light', 'section:has(#states)');
// Phone width: the page must not scroll sideways.
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await shot('narrow', 'section:has(#kinds)');
console.log(JSON.stringify({ overflow, errors }));
await browser.close();
