import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Captures of docs/mockups/ledge-report.html: every card dark FR, light FR and dark EN, plus the full page.
// Usage: node shots.mjs <path to a playwright-core package>
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1340, height: 1000 }, deviceScaleFactor: 2 });
const url = pathToFileURL(resolve(out, 'ledge-report.html')).href;
for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en']]) {
  await page.goto(`${url}?theme=${theme}&lang=${lang}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  for (const id of [1, 2, 3, 4, 5, 6]) await page.locator(`#s${id}`).screenshot({ path: resolve(out, `ledge-report-s${id}-${theme}-${lang}.png`) });
}
await page.goto(`${url}?theme=dark&lang=fr`);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: resolve(out, 'ledge-report.png'), fullPage: true });
await browser.close();
