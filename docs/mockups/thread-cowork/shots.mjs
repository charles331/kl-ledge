// Captures of docs/mockups/ledge-thread-cowork.html, each in a fresh browser context so no choice leaks from one to the next.
// Usage: node docs/mockups/thread-cowork/shots.mjs <path to a playwright-core package> [name filter]
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const only = process.argv[3];
const url = pathToFileURL(resolve(out, 'ledge-thread-cowork.html')).href;
const browser = await chromium.launch();
const errors = [];

/** One capture: the page opened on `query`, `act` run on it, then the whole window or a zoomed `clip`. */
async function shot(name, query, { act, clip, size = [1600, 1000], scale = 1 } = {}) {
  if (only && !name.includes(only)) return;
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${url}?${query}`);
  await page.locator('.ide-explorer .st-agent').first().waitFor();
  await page.locator('.session-thread').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  if (act) { await act(page); await page.waitForTimeout(700); }
  await page.screenshot({ path: resolve(out, `ledge-thread-cowork-${name}.png`), ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) });
  await context.close();
}
/** Scrolls the thread in front back to its start. */
const top = page => page.evaluate(() => { for (const el of document.querySelectorAll('.session-thread')) el.scrollTop = 0; });
const unfold = async page => { await top(page); await page.locator('.cw-work').first().click(); await page.locator('.cw-steps-head').first().click(); };

for (const theme of ['dark', 'light']) {
  // Before and after, on the same session.
  await shot(`avant-${theme}`, `fil=today&theme=${theme}`);
  await shot(`pim-${theme}`, `theme=${theme}`);
  await shot(`pim-debut-${theme}`, `theme=${theme}`, { act: top });
  await shot(`pim-passe-ouvert-${theme}`, `passe=ouvert&theme=${theme}`, { act: top });
  await shot(`pim-deplie-${theme}`, `theme=${theme}`, { act: unfold });
  await shot(`pim-accord-${theme}`, `theme=${theme}`, { act: page => page.keyboard.press('y') });
  await shot(`nova-${theme}`, `s=nova&theme=${theme}`);
  await shot(`nova-btw-${theme}`, `s=nova&theme=${theme}`, { act: async page => { await page.locator('.session-reply textarea').fill('/btw Et sous Firefox ?'); } });
  await shot(`nova-slash-${theme}`, `s=nova&theme=${theme}`, { act: page => page.locator('.session-reply textarea').pressSequentially('/b') });
  await shot(`nova-btw-envoye-${theme}`, `s=nova&theme=${theme}`, { act: async page => { const f = page.locator('.session-reply textarea'); await f.fill('/btw Et sous Firefox ?'); await f.press('Enter'); } });
  await shot(`ida-voix-${theme}`, `s=ida&theme=${theme}`, { act: page => page.locator('.cw-mic').click() });
  await shot(`ida-${theme}`, `s=ida&theme=${theme}`);
  // The thread at its narrowest: two groups, the chat and the bottom panel open.
  await shot(`etroit-${theme}`, `vue=split&theme=${theme}`);
  // Zooms, to check corners and alignments.
  await shot(`zoom-fil-${theme}`, `theme=${theme}`, { clip: [300, 84, 800, 560], scale: 2 });
  await shot(`zoom-resume-${theme}`, `theme=${theme}`, { clip: [1100, 84, 500, 560], scale: 2 });
  await shot(`zoom-deplie-${theme}`, `theme=${theme}`, { act: unfold, clip: [300, 84, 800, 620], scale: 2 });
  await shot(`zoom-nova-${theme}`, `s=nova&theme=${theme}`, { clip: [300, 84, 800, 620], scale: 2 });
  await shot(`zoom-saisie-${theme}`, `s=nova&theme=${theme}`, { clip: [400, 760, 780, 220], scale: 3 });
  await shot(`zoom-saisie-etroit-${theme}`, `vue=split&theme=${theme}`, { clip: [300, 430, 1000, 340], scale: 2 });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
