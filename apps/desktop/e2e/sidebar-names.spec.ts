import type { Locator, Page } from '@playwright/test';
import type { ClientMessage } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// docs/mockups/ledge-sidebar-names.html, validated by the owner on 2026-11-27: card 1, the drag grip redrawn (six dots, beside a
// project's chevron, never over it; on a session's name line); card 2 (v2), a session's nickname given in place in the explorer and
// shown before its name, « KB Projet 1 (Echo) ». Dark and light, zoomed captures in the test's output folder.
test.use({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 3 });
test.setTimeout(90_000);

const T = (min: number) => new Date(Date.UTC(2026, 10, 27, 9, min)).toISOString();
const sessions = [
  session('pim', { name: 'Pim', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Tests e2e de l’espace', startedAt: T(1), state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } }),
  session('otto', { name: 'Otto', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Fusion des PR', startedAt: T(2), state: 'idle' }),
  session('nova', { name: 'Nova', cwd: '/w/ledge', project: 'ledge', branch: 'feat/ide-shell', topic: 'Terminaux WebGL', startedAt: T(3), helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le relais', state: 'working' }] }),
  session('echo', { name: 'Echo', label: 'KB Projet 1', cwd: '/w/website', project: 'website', branch: 'main', topic: 'Notifications', startedAt: T(4) })
];
const tree = (page: Page) => page.locator('.st-tree');
const row = (page: Page, name: string) => tree(page).locator('[role="treeitem"]').filter({ has: page.locator('.st-main strong', { hasText: new RegExp(`^${name}`) }) }).first();
/** A session's row by its id, whatever it reads (a nickname changes its text). */
const rowOf = (page: Page, id: string) => tree(page).locator(`[role="treeitem"]:has([data-tree-key$="${id}"])`).first();
const box = async (l: Locator) => (await l.boundingBox())!;
const mid = (b: { y: number; height: number }) => b.y + b.height / 2;

async function boot(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => {
    try {
      localStorage.setItem('desktop.theme', t); localStorage.setItem('desktop.lang', 'fr');
      localStorage.setItem('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: 280, sideView: 'projects', bottom: false, bottomHeight: 200, right: false }));
    } catch { /* ignore */ }
  }, theme);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: { version: '0.66.0', install: 'npm', systemd: true, archive: true, sessionLabel: true } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(rowOf(page, 'echo')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return daemon;
}

for (const theme of ['dark', 'light'] as const) {
  test(`the grip: six dots, left of a project's chevron, on a session's name line (${theme})`, async ({ page }, info) => {
    await boot(page, theme);
    const project = row(page, 'Ledge');
    await project.hover();
    const grip = project.locator('.st-grip');
    await expect(grip).toHaveCSS('opacity', '1');
    await expect(grip.locator('i')).toHaveCount(6);
    const p = await box(project);
    await page.screenshot({ path: info.outputPath(`grip-project-${theme}.png`), clip: { x: p.x - 6, y: p.y - 4, width: 150, height: p.height + 8 } });
    // The chevron as drawn: its stroke, not its 16 px box, which has room around it.
    const [g, chev] = [await box(grip.locator('i').first()), await box(project.locator('.st-chev svg path, .st-chev svg polyline').first())];
    // Its dots end before the chevron's stroke starts, and sit on the row's middle.
    const dotsRight = Math.max(...await grip.locator('i').evaluateAll(xs => xs.map(x => x.getBoundingClientRect().right)));
    expect(dotsRight).toBeLessThanOrEqual(chev.x - 1);
    expect(Math.abs(mid(await box(grip)) - mid(await box(project)))).toBeLessThanOrEqual(1);
    expect(g.width).toBe(2);

    const otto = row(page, 'Otto');
    await otto.hover();
    const sg = otto.locator('.st-grip');
    await expect(sg).toHaveCSS('opacity', '1');
    const o = await box(otto);
    await page.screenshot({ path: info.outputPath(`grip-session-${theme}.png`), clip: { x: o.x - 6, y: o.y - 4, width: 170, height: o.height + 8 } });
    // On the name and logo's line, not on the middle of the two lines; left of the logo, not touching it.
    const logo = await box(otto.locator('.st-bot'));
    expect(Math.abs(mid(await box(sg)) - mid(logo))).toBeLessThanOrEqual(1);
    const sgRight = Math.max(...await sg.locator('i').evaluateAll(xs => xs.map(x => x.getBoundingClientRect().right)));
    expect(sgRight).toBeLessThan(logo.x - 2);

    // A session with sub-agents: the grip stays left of their chevron's stroke, on the same line.
    const nova = row(page, 'Nova');
    await nova.hover();
    const ng = nova.locator('.st-grip');
    await expect(ng).toHaveCSS('opacity', '1');
    const n = await box(nova);
    await page.screenshot({ path: info.outputPath(`grip-session-kids-${theme}.png`), clip: { x: n.x - 6, y: n.y - 4, width: 170, height: n.height + 8 } });
    const stroke = await box(nova.locator('.st-chev svg path, .st-chev svg polyline').first());
    const ngRight = Math.max(...await ng.locator('i').evaluateAll(xs => xs.map(x => x.getBoundingClientRect().right)));
    expect(ngRight).toBeLessThanOrEqual(stroke.x - 1);
    expect(Math.abs(mid(await box(ng)) - mid(stroke))).toBeLessThanOrEqual(1.5);
  });

  test(`a nickname in place: F2, the field with the name beside it, Enter sends session.label; « KB Projet 1 (Echo) » shown (${theme})`, async ({ page }, info) => {
    const daemon = await boot(page, theme);
    // Shown: the nickname, then the name in brackets, muted, on the name's line.
    const echo = rowOf(page, 'echo');
    await expect(echo.locator('.st-aname')).toHaveText('KB Projet 1 (Echo)');
    const e = await box(echo);
    await page.screenshot({ path: info.outputPath(`nickname-shown-${theme}.png`), clip: { x: e.x - 6, y: e.y - 4, width: e.width + 12, height: e.height + 8 } });

    await row(page, 'Otto').locator('.st-main').focus();
    await page.keyboard.press('F2');
    // While its name is a field the row has no name text: it is the row that holds the field.
    const otto = tree(page).locator('[role="treeitem"]:has(.st-rename)');
    const field = otto.getByRole('textbox', { name: 'Surnom de Otto' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');
    await expect(otto.locator('.st-renaming .sn-name')).toHaveText('(Otto)');
    // The field sits on the name's line, its middle on the logo's; the row is the selected one.
    expect(Math.abs(mid(await box(field)) - mid(await box(otto.locator('.st-bot'))))).toBeLessThanOrEqual(1.5);
    await expect(otto).toHaveClass(/\bsel\b/);
    await expect(otto.locator('.st-rename-hint')).toHaveText('↵ renommer · Échap annuler');
    await expect(otto.locator('.st-grip')).toBeHidden();
    // « (Otto) » stays inside the row, after the field.
    const [nm, rowBox, fb] = [await box(otto.locator('.st-renaming .sn-name')), await box(otto), await box(field)];
    expect(nm.x + nm.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(nm.x).toBeGreaterThanOrEqual(fb.x + fb.width);
    const o = await box(otto);
    const clip = () => ({ x: o.x - 6, y: o.y - 4, width: o.width + 12, height: o.height + 12 });
    await page.screenshot({ path: info.outputPath(`nickname-edit-${theme}.png`), clip: clip() });
    await page.keyboard.type('Revue des PR');
    await page.screenshot({ path: info.outputPath(`nickname-typing-${theme}.png`), clip: clip() });
    await page.keyboard.press('Enter');
    await expect.poll(() => daemon.received.filter((m): m is Extract<ClientMessage, { type: 'session.label' }> => m.type === 'session.label')).toEqual([{ type: 'session.label', id: 'otto', label: 'Revue des PR' }]);
    await expect(tree(page).getByRole('textbox')).toHaveCount(0);
  });
}

// The field must show what is typed in every view of the explorer: compact or not, grouped by branch or not (owner's report after
// 0.67.0: in a view the field was cropped and the text could not be read).
for (const view of [{ dense: false, byBranch: true }, { dense: true, byBranch: true }, { dense: false, byBranch: false }, { dense: true, byBranch: false }]) {
  test(`the nickname field shows what is typed (compact ${view.dense}, by branch ${view.byBranch})`, async ({ page }, info) => {
    await page.addInitScript(v => { try { localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: true, ...v })); } catch { /* ignore */ } }, view);
    await boot(page, 'dark');
    await row(page, 'Otto').locator('.st-main').focus();
    await page.keyboard.press('F2');
    const field = tree(page).getByRole('textbox', { name: 'Surnom de Otto' });
    await expect(field).toBeFocused();
    await page.keyboard.type('Revue des PR');
    const o = await box(tree(page).locator('[role="treeitem"]:has(.st-rename)'));
    await page.screenshot({ path: info.outputPath(`nickname-field-${view.dense ? 'dense' : 'roomy'}-${view.byBranch ? 'branches' : 'flat'}.png`), clip: { x: o.x - 6, y: o.y - 4, width: o.width + 12, height: o.height + 8 } });
    // Wide enough for the text, and tall enough for its letters: nothing is cut.
    const fit = await field.evaluate((x: HTMLInputElement) => ({ width: x.clientWidth, scroll: x.scrollWidth, height: x.clientHeight, line: parseFloat(getComputedStyle(x).fontSize) }));
    expect(fit.width).toBeGreaterThanOrEqual(120);
    expect(fit.scroll).toBeLessThanOrEqual(fit.width);
    expect(fit.height).toBeGreaterThanOrEqual(fit.line + 2);
    // Its logo on the field's line.
    const editing = tree(page).locator('[role="treeitem"]:has(.st-rename)');
    expect(Math.abs(mid(await box(field)) - mid(await box(editing.locator('.st-bot'))))).toBeLessThanOrEqual(1.5);
    // The keys stay readable under it, in every view.
    await expect(tree(page).locator('.st-rename-hint')).toBeVisible();
    expect((await box(tree(page).locator('.st-rename-hint'))).height).toBeGreaterThanOrEqual(12);
  });
}

// A session's sub-agents at work, folded: their pill (spinner and count) sits on the session's name line, centred on its logo and its
// name, in every view (owner's report after 0.67.0: the spinner was not aligned with the session).
for (const dense of [false, true]) {
  test(`the sub-agents' pill sits on the session's name line (compact ${dense})`, async ({ page }, info) => {
    await page.addInitScript(v => { try { localStorage.setItem('desktop.sidebar', JSON.stringify({ hideDone: true, dense: v, byBranch: true })); } catch { /* ignore */ } }, dense);
    await boot(page, 'dark');
    const nova = row(page, 'Nova');
    const pill = nova.locator('.st-kids');
    await expect(pill).toBeVisible();
    const n = await box(nova);
    await page.screenshot({ path: info.outputPath(`kids-pill-${dense ? 'dense' : 'roomy'}.png`), clip: { x: n.x - 6, y: n.y - 4, width: n.width + 12, height: n.height + 8 } });
    const [p, logo, name] = [await box(pill), await box(nova.locator('.st-bot')), await box(nova.locator('.st-aname'))];
    expect(Math.abs(mid(p) - mid(logo))).toBeLessThanOrEqual(1);
    expect(Math.abs(mid(p) - mid(name))).toBeLessThanOrEqual(1.5);
    // The spinner is centred in its pill.
    const spin = await box(pill.locator('.st-kids-spin'));
    expect(Math.abs(mid(spin) - mid(p))).toBeLessThanOrEqual(1);
  });
}
