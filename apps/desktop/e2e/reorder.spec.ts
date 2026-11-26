import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Issue #16 (docs/mockups/ledge-reorder.html): projects and sessions put in order in the explorer, by a real drag, the keys and
// the menus; kept by the daemon. French and English, dark and light. Captures in e2e/.results/reorder/.
test.use({ viewport: { width: 1280, height: 860 } });
test.setTimeout(90_000);

const OUT = 'e2e/.results/reorder';
const T = (min: number) => new Date(Date.UTC(2026, 10, 26, 9, min)).toISOString();
const sessions = [
  session('pim', { name: 'Pim', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Tests e2e de l’espace', startedAt: T(1), state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } }),
  session('ida', { name: 'Ida', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Maquette de l’espace', startedAt: T(2), state: 'idle' }),
  session('nova', { name: 'Nova', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Terminaux WebGL', startedAt: T(3) }),
  session('echo', { name: 'Echo', cwd: '/w/website', project: 'website', branch: 'main', topic: 'Notifications', startedAt: T(4) })
];
const tree = (page: Page) => page.getByRole('tree', { name: /^(Projects, branches and sessions|Projets, branches et sessions)$/ });
const row = (page: Page, name: string) => tree(page).locator('[role="treeitem"]').filter({ has: page.locator('.st-main strong', { hasText: new RegExp(`^${name}`) }) }).first();
const names = (page: Page, project: string) => page.evaluate(p => {
  const items = [...document.querySelectorAll<HTMLElement>('.st-tree [role="treeitem"]')];
  const start = items.findIndex(x => x.classList.contains('st-project') && x.querySelector('.st-main strong')?.textContent === p);
  const out: string[] = [];
  for (const x of items.slice(start + 1)) { if (x.classList.contains('st-project')) break; if (x.classList.contains('st-agent')) out.push(x.querySelector('.st-main strong')!.textContent!.replace(/[^A-Za-zÀ-ÿ]+$/, '')); }
  return out;
}, project);
const projectsShown = (page: Page) => tree(page).locator('.st-project .st-main strong').allTextContents();
const said = (page: Page) => page.locator('.st-said');
const box = async (l: Locator) => (await l.boundingBox())!;

async function boot(page: Page, o: { theme?: 'dark' | 'light'; lang?: 'fr' | 'en'; extra?: ReturnType<typeof session>[] } = {}) {
  const { theme = 'dark', lang = 'en' } = o;
  await page.addInitScript(([t, l]) => {
    try {
      localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', l!);
      localStorage.setItem('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: 280, sideView: 'projects', bottom: false, bottomHeight: 200, right: false }));
    } catch { /* ignore */ }
  }, [theme, lang]);
  const daemon = await fakeDaemon(page, [...sessions, ...(o.extra ?? [])], { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await expect(row(page, 'Echo')).toBeVisible();
  return daemon;
}
/** A real drag (the pointer), held at `to` while `during` runs, then let go. */
async function drag(page: Page, from: Locator, to: () => Promise<{ x: number; y: number }>, during?: () => Promise<void>) {
  const f = await box(from);
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2 + 6, { steps: 3 });
  const p = await to();
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.move(p.x, p.y + 1);
  if (during) await during();
  await page.mouse.up();
}

for (const theme of ['dark', 'light'] as const) for (const lang of ['fr', 'en'] as const) {
  test(`reorder in the explorer (${theme}, ${lang}): the grip, a session dragged in its group, a project dragged, the keys and the menu`, async ({ page }) => {
    await boot(page, { theme, lang });
    // One branch: the tree shows the project flat, and a session's group is its project.
    const ledge = 'Ledge';
    expect(await names(page, 'Ledge')).toEqual(['Pim', 'Ida', 'Nova']);
    // 1 · The grip shows on hover only, with its tooltip.
    const ida = row(page, 'Ida');
    await expect(ida.locator('.st-grip')).toHaveCSS('opacity', '0');
    await ida.hover();
    await expect(ida.locator('.st-grip')).toHaveCSS('opacity', '1');
    await expect(ida.locator('.st-grip')).toHaveAttribute('title', lang === 'fr' ? 'Glisser pour déplacer · Alt+↑ / Alt+↓' : 'Drag to move · Alt+↑ / Alt+↓');
    await tree(page).screenshot({ path: `${OUT}/grip-${theme}-${lang}.png` });
    // 2 · Ida dragged above Pim: a dashed place, the violet line; let go, she is first, the daemon keeps it, it is said.
    await drag(page, ida, async () => { const b = await box(row(page, 'Pim')); return { x: b.x + b.width / 2, y: b.y + 4 }; }, async () => {
      await expect(ida).toHaveClass(/st-lifted/);
      await expect(row(page, 'Pim')).toHaveClass(/st-mark-before/);
      await tree(page).screenshot({ path: `${OUT}/drag-session-${theme}-${lang}.png` });
    });
    await expect.poll(() => names(page, 'Ledge')).toEqual(['Ida', 'Pim', 'Nova']);
    await expect(said(page)).toHaveText(lang === 'fr' ? `Ida est maintenant 1re sur 3 dans ${ledge}.` : `Ida is now 1 of 3 in ${ledge}.`);
    // 3 · Website dragged above Ledge: the projects' order, kept.
    await drag(page, row(page, 'Website'), async () => { const b = await box(row(page, 'Ledge')); return { x: b.x + b.width / 2, y: b.y + 3 }; }, async () => {
      await expect(row(page, 'Ledge')).toHaveClass(/st-mark-before/);
      await tree(page).screenshot({ path: `${OUT}/drag-project-${theme}-${lang}.png` });
    });
    await expect.poll(() => projectsShown(page)).toEqual(['Website', 'Ledge']);
    await expect(said(page)).toHaveText(lang === 'fr' ? 'Website est maintenant 1er sur 2 projets.' : 'Website is now 1 of 2 projects.');
    // 4 · By the keys: Nova, Alt+↑, goes second; the row keeps the focus.
    await row(page, 'Nova').locator('.st-main').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => names(page, 'Ledge')).toEqual(['Ida', 'Nova', 'Pim']);
    await expect(row(page, 'Nova').locator('.st-main')).toBeFocused();
    await expect(said(page)).toHaveText(lang === 'fr' ? `Nova est maintenant 2e sur 3 dans ${ledge}.` : `Nova is now 2 of 3 in ${ledge}.`);
    // 5 · The menu: Move up, Move down, To the top of the project.
    await row(page, 'Nova').click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: lang === 'fr' ? 'Monter' : 'Move up' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: lang === 'fr' ? 'En haut du projet' : 'To the top of the project' })).toBeEnabled();
    await page.screenshot({ path: `${OUT}/menu-${theme}-${lang}.png` });
    await menu.getByRole('menuitem', { name: lang === 'fr' ? 'En haut du projet' : 'To the top of the project' }).click();
    await expect.poll(() => names(page, 'Ledge')).toEqual(['Nova', 'Ida', 'Pim']);
  });
}

test('a session dropped on another project is filed there: the row ringed, « Release to file … » under it', async ({ page }) => {
  const daemon = await boot(page);
  await drag(page, row(page, 'Ida'), async () => { const b = await box(row(page, 'Website')); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, async () => {
    await expect(row(page, 'Website')).toHaveClass(/drop-over/);
    await expect(row(page, 'Website').locator('.st-drop-tip')).toHaveText('Release to file Ida in Website');
    // Out of its group, no insertion line is left behind.
    await expect(tree(page).locator('.st-mark-before, .st-mark-after')).toHaveCount(0);
    await tree(page).screenshot({ path: `${OUT}/file-into-dark-en.png` });
  });
  // The rule « this folder → Website » is written (Ranger dans…, as today).
  await expect.poll(() => daemon.received.some(m => m.type === 'projects.set' && (m as { projects: { rules: { project: string }[] } }).projects.rules.some(r => r.project === 'website'))).toBe(true);
});

test('a session never lands among another group\'s sessions: no line, nothing sent', async ({ page }) => {
  const daemon = await boot(page);
  const before = daemon.received.filter(m => m.type === 'sessions.order').length;
  await drag(page, row(page, 'Ida'), async () => { const b = await box(row(page, 'Echo')); return { x: b.x + b.width / 2, y: b.y + 4 }; }, async () => {
    await expect(row(page, 'Echo')).not.toHaveClass(/st-mark/);
  });
  expect(daemon.received.filter(m => m.type === 'sessions.order')).toHaveLength(before);
  expect(await names(page, 'Ledge')).toEqual(['Pim', 'Ida', 'Nova']);
});

test('#16 review C2: a project dropped after an unfolded project lands below its sessions, and the line is drawn there', async ({ page }) => {
  const daemon = await boot(page);
  // Ledge on the lower half of Website's heading: Website is unfolded (Echo under it) and last.
  await drag(page, row(page, 'Ledge'), async () => { const b = await box(row(page, 'Website')); return { x: b.x + b.width / 2, y: b.y + b.height - 3 }; }, async () => {
    await expect(row(page, 'Website')).not.toHaveClass(/st-mark/);
    await expect(row(page, 'Echo')).not.toHaveClass(/st-mark/);
    const end = tree(page).locator('.st-mark-end');
    await expect(end).toBeVisible();
    expect((await box(end)).y).toBeGreaterThan((await box(row(page, 'Echo'))).y);
    await tree(page).screenshot({ path: `${OUT}/drag-project-after-dark-en.png` });
  });
  await expect.poll(() => projectsShown(page)).toEqual(['Website', 'Ledge']);
  expect(daemon.received.filter(m => m.type === 'projects.set')).toHaveLength(1);
});

test('#16 review C2: with « No project » shown last, a project dropped after the last project has its line above « No project »', async ({ page }) => {
  await boot(page, { extra: [session('kit', { name: 'Kit', cwd: '/tmp', project: 'tmp', startedAt: T(5) })] });
  const none = tree(page).locator('.st-project').last();
  await expect(none.locator('.st-main strong')).toHaveText('No project');
  await drag(page, row(page, 'Ledge'), async () => { const b = await box(row(page, 'Website')); return { x: b.x + b.width / 2, y: b.y + b.height - 3 }; }, async () => {
    await expect(none).toHaveClass(/st-mark-before/);
    await expect(tree(page).locator('.st-mark-end')).toHaveCount(0);
  });
  await expect.poll(() => projectsShown(page)).toEqual(['Website', 'Ledge', 'No project']);
});
