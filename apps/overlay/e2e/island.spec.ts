import type { DaemonInfo, OperatorNotice, Session } from '@ledge/protocol';
import { test, expect, surface, island, card, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/** The island, in the real app with a real mouse and keyboard (issue #27, docs/mockups/ledge-dynamic-island.html). */

const DAEMON: DaemonInfo = { version: '0.64.0', install: 'npm', systemd: false, routines: true, routineGroups: true } as DaemonInfo;
const pim = (extra: Partial<Session> = {}) => session('b', { name: 'Pim', tool: 'codex', project: 'speos-api', branch: 'chore/deps', ...extra });
const asks = (extra: Partial<Session> = {}) => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm up --latest && pnpm test', tool: 'Bash', source: 'hook' }, ...extra });
const question = pim({ state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
/** Lets a CSS transition finish in real time (the page's clock may be frozen; transitions do not follow it). */
const settle = (page: import('@playwright/test').Page) => page.waitForTimeout(600);
const T0 = new Date('2026-11-27T09:00:00.000Z');
/** The page's timers stop: only `runFor` moves them (an `install` alone lets time flow). */
const freeze = (page: import('@playwright/test').Page) => page.clock.pauseAt(new Date(T0.getTime() + 60_000));

test('at rest nothing is on screen; a finished turn comes out as a 72 × 36 pill 8 px under the edge, opens to 420 px, holds under the pointer, then leaves', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  await expect(island(page)).toHaveCount(0);
  d.upsert(pim({ state: 'idle', lastReply: { text: 'All 14 tests pass, the PR is ready for review.', at: new Date().toISOString() } }));
  await page.clock.runFor(50);
  await expect(surface(page)).toHaveAttribute('data-phase', 'seed');
  await settle(page);
  expect(await island(page).boundingBox()).toEqual({ x: 960 - 36, y: 8, width: 72, height: 36 });
  await page.clock.runFor(260);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await settle(page);
  const open = (await island(page).boundingBox())!;
  expect(open.x).toBe(960 - 210); expect(open.y).toBe(8); expect(open.width).toBe(420);
  await expect(card(page)).toContainText('DonePim finished');
  await expect(card(page)).toContainText('All 14 tests pass, the PR is ready for review.');
  // The pointer holds the ring: six seconds pass, the island stays.
  await page.mouse.move(960, 30);
  await expect(page.locator('[data-ring]')).not.toHaveAttribute('data-running', 'true');
  await page.clock.runFor(7000);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.mouse.move(960, 600);
  await page.clock.runFor(6000);
  await expect(surface(page)).toHaveAttribute('data-closing', 'true');
  await page.clock.runFor(320 + 240);
  await expect(island(page)).toHaveCount(0);
});

test('a permission: Y allows it, « Sent, waiting for the terminal », then « Received » once the terminal took it, and the island leaves', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(card(page)).toContainText('ApprovalPim wants to run a command');
  await expect(card(page).locator('.di-command')).toHaveText('Bashpnpm up --latest && pnpm test');
  await page.keyboard.press('y');
  expect(await received(d.received, 'session.decide')).toEqual({ type: 'session.decide', id: 'b', decision: 'accept' });
  await expect(card(page)).toContainText('Sent, waiting for the terminal');
  d.upsert(pim({ state: 'working' }));
  await expect(card(page)).toContainText('Received');
  await expect(island(page)).toHaveCount(0);
});

test('a question with the mouse: Reply with nothing says so; a choice, then Reply, sends it', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  d.upsert(question);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose an answer or write one.');
  await page.getByRole('radio', { name: '2 Shadow table' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reply' }).click();
  expect(await received(d.received, 'session.reply')).toEqual({ type: 'session.reply', id: 'b', text: 'Shadow table' });
});

test('Esc sets a request aside and the island leaves; Ctrl+Alt+L brings it back; without one it opens nothing', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await page.keyboard.press('Control+Alt+L');
  await expect(island(page)).toHaveCount(0);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveCount(0);
  await page.keyboard.press('Control+Alt+L');
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(card(page)).toContainText('Pim wants to run a command');
});

test('two at once: « +1 more », « Later, next », and the pill reopens on the next one', async ({ page }) => {
  const d = await fakeDaemon(page, [pim(), session('c', { name: 'Bix', tool: 'cursor', project: 'boutique', branch: 'feat/migration' })]);
  await ready(page);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  d.upsert(session('c', { name: 'Bix', tool: 'cursor', project: 'boutique', branch: 'feat/migration', state: 'waiting_input', pending: { kind: 'question', text: 'Gradual migration?', source: 'hook' } }));
  await expect(card(page).locator('.di-meta')).toHaveText('speos-api · chore/deps · +1 more');
  await page.getByRole('button', { name: 'Later, next Esc' }).click();
  await expect(card(page)).toContainText('Bix asks you a question');
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
});

test('reduced motion: the island fades in already open, without the pill', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  d.upsert(asks());
  await page.clock.runFor(1);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(island(page)).toHaveAttribute('data-reduced', 'true');
});

test('a rig’s question from Ledge: its mark, the suggested answer first; a click answers through its point', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()], { daemon: DAEMON });
  await ready(page);
  const ask: OperatorNotice = { id: 'rig.ask:q1', kind: 'rig.ask', qid: 'p1', qitem: 'q1', text: 'Merge #309 now?', who: 'pilot-lead', rig: 'ledge-dev', options: [{ id: 'merge', label: 'Merge' }, { id: 'wait', label: 'Wait for qa' }], priority: 'urgent', at: new Date().toISOString() };
  d.notices([{ id: 'point:p0', kind: 'point', qid: 'p0', text: 'Two things for you.', priority: 'routine', at: new Date().toISOString() }, ask]);
  await expect(island(page)).toHaveAttribute('data-kind', 'rig');
  await expect(card(page).locator('[data-ledge-mark]')).toHaveCount(1);
  await expect(card(page).locator('.di-sentence')).toHaveText('pilot-lead: “Merge #309 now?”');
  await page.getByRole('button', { name: 'Merge' }).click();
  expect(await received(d.received, 'point.act')).toEqual({ type: 'point.act', qid: 'p1', item: 'rig.ask:q1', answer: { id: 'merge' } });
  await expect(island(page)).toHaveCount(0);
});

test('hidden from Desktop: nothing opens; shown again, the waiting request does', async ({ page }) => {
  const prefs = { visible: false, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto', shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L' } as const;
  const d = await fakeDaemon(page, [pim()], { island: prefs });
  await page.goto('/');
  await expect(surface(page)).toHaveCount(0);
  d.upsert(asks());
  await page.waitForTimeout(400);
  await expect(surface(page)).toHaveCount(0);
  d.island({ ...prefs, visible: true });
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
});

test.describe('in French', () => {
  test.use({ lang: 'fr' });
  test('the island says « tu »', async ({ page }) => {
    const d = await fakeDaemon(page, [pim()]);
    await ready(page);
    d.upsert(asks());
    await expect(card(page)).toContainText('Ton accordPim veut exécuter une commande');
    await expect(page.getByRole('button', { name: 'Plus tard Esc' })).toBeVisible();
    d.upsert(pim({ state: 'working' }));
    d.upsert(question);
    await expect(card(page)).toContainText('Pim te pose une question');
  });
});
