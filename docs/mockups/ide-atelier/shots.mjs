// Captures of docs/mockups/ledge-ide-atelier.html, each in a fresh browser context so no choice leaks from one to the next.
// Usage: node docs/mockups/ide-atelier/shots.mjs <path to a playwright-core package>
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..');
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const url = pathToFileURL(resolve(out, 'ledge-ide-atelier.html')).href;
const browser = await chromium.launch();
const errors = [];

/** One capture: the page opened on `query`, `act` run on it, then the whole window or a zoomed `clip`. */
async function shot(name, query, { act, clip, size = [1600, 1000], scale = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.goto(`${url}?${query}`);
  await page.locator('.ide-explorer .st-agent').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  if (act) { await act(page); await page.waitForTimeout(700); }
  await page.screenshot({ path: resolve(out, `ledge-ide-atelier-${name}.png`), ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) });
  await context.close();
}
const ask = async page => { const f = page.getByPlaceholder('Demander à Ledge…'); await f.click(); await f.fill('Qui m\'attend ?'); await f.press('Enter'); };
const activity = name => page => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

// Before and after, both themes.
for (const theme of ['dark', 'light']) {
  await shot(`avant-${theme}`, `skin=off&theme=${theme}`);
  await shot(`${theme}`, `skin=atelier&theme=${theme}`, { act: ask });
}
// Every palette, both themes, at a smaller window.
for (const pal of ['maquette-b', 'établi', 'sable', 'sauge', 'ardoise', 'nuit', 'prune', 'encre']) for (const theme of ['dark', 'light'])
  await shot(`palette-${pal.replace('é', 'e')}-${theme}`, `skin=atelier&pal=${encodeURIComponent(pal)}&theme=${theme}`, { size: [1280, 800] });
// Other views and what opens over the window.
for (const theme of ['dark', 'light']) {
  await shot(`vue-atoi-${theme}`, `skin=atelier&theme=${theme}`, { act: activity('À toi') });
  await shot(`vue-reglages-${theme}`, `skin=atelier&theme=${theme}`, { act: activity('Réglages (onglet)') });
  await shot(`vue-commandes-${theme}`, `skin=atelier&theme=${theme}`, { act: page => page.keyboard.press('Control+k') });
  await shot(`vue-nouvelle-session-${theme}`, `skin=atelier&theme=${theme}`, { act: page => page.keyboard.press('n') });
  await shot(`vue-limites-${theme}`, `skin=atelier&theme=${theme}`, { act: page => page.locator('.ide-status .ugroup').first().click(), clip: [760, 600, 840, 400], scale: 2 });
  // Zooms, to check corners and alignments.
  await shot(`zoom-explorateur-${theme}`, `skin=atelier&theme=${theme}`, { clip: [0, 44, 520, 420], scale: 3 });
  await shot(`zoom-fil-${theme}`, `skin=atelier&theme=${theme}`, { clip: [300, 84, 520, 330], scale: 3 });
  await shot(`zoom-accord-${theme}`, `skin=atelier&theme=${theme}`, { clip: [300, 440, 520, 340], scale: 3 });
  await shot(`zoom-compteurs-${theme}`, `skin=atelier&theme=${theme}`, { clip: [0, 84, 310, 130], scale: 4 });
  await shot(`zoom-onglets-${theme}`, `skin=atelier&theme=${theme}`, { clip: [304, 84, 990, 40], scale: 3 });
  await shot(`zoom-etat-${theme}`, `skin=atelier&theme=${theme}`, { clip: [0, 740, 1600, 260], scale: 2 });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
