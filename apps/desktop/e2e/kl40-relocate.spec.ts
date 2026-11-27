// #40 PR 2a (docs/mockups/ledge-remove-chat-d1-d3-d6.html, ledge-remove-chat-p2.html): what the chat and « À toi » did, in its new
// place, on the real app with real clicks, French and English, dark and light. Captures in e2e/.results/kl40/ (or SHOTS=<dir>).
import type { Page } from '@playwright/test';
import type { HumanAsk, HumanChannel, Session, Task } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const OUT = process.env.SHOTS ?? 'e2e/.results/kl40';
const NOW = new Date(Date.now() - 4 * 60_000).toISOString();
const from = (role: string) => ({ seat: `${role.replace('.', '-')}@ledge-dev`, rig: 'ledge-dev', role });
const base = { alert: false, priority: 'routine' as const, bodyTruncated: false, detail: null, evidenceRef: null, createdAt: NOW, updatedAt: NOW };
const ASKS: HumanAsk[] = [
  { ...base, id: 'qitem-merge', kind: 'decision', priority: 'urgent', from: from('pilot.lead'), summary: 'Fusionner #36 avant #37 ?', body: '#36 change l’ordre des sessions ; #37 en dépend. review-qa a accepté les deux.',
    evidenceRef: 'state/pr/k46-merge-review.md', questions: [{ id: 'q', question: 'Fusionner #36 avant #37 ?', options: [{ id: 'merge', label: 'Fusionner #36', recommended: true }, { id: 'wait', label: 'Attendre', recommended: false }], answer: null }] },
  { ...base, id: 'qitem-parked', kind: 'parked', from: from('dev.back'), summary: 'Le daemon peut-il garder les tâches closes 7 jours ?', body: '', questions: [] },
  { ...base, id: 'qitem-news', kind: 'update', from: { seat: 'max@ledge-dev', rig: 'ledge-dev', role: null }, summary: 'L’équipe du lot 14 est en place.', body: '', questions: [] }
] as HumanAsk[];
const READY: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const ctx = (used: number) => ({ used, window: 200_000, at: NOW });
const SESSIONS: Session[] = [
  session('otto', { name: 'Otto', cwd: '/w/ledge', project: 'ledge', state: 'idle' }),
  session('nova', { name: 'Nova', cwd: '/w/ledge', project: 'ledge', tool: 'codex', state: 'idle', context: ctx(182_000), handover: { state: 'failed', at: NOW, reason: 'Codex hors ligne' } } as Partial<Session>)
];
const task = (id: string, o: Partial<Task>): Task => ({ id, title: `Task ${id}`, giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: NOW, updatedAt: NOW, log: [{ at: NOW, by: 'Nova', what: 'demande' }], ...o });
const TASKS: Task[] = [
  task('t-12', { title: 'Écrire le test du refus', giver: 'ledge', giverName: 'Ledge', owner: 'pim', ownerName: 'Pim', state: 'done' }),
  task('t-13', { title: 'Choisir le dossier des captures', text: 'captures/ ou docs/shots/ ? Les deux existent.' }),
  task('r-4', { title: 'Le test de l’île échoue sous charge', giver: 'otto', giverName: 'Otto', report: { kind: 'bug', title: 'Le test de l’île échoue sous charge', detail: 'island.spec : le relâché du glisser arrive après Échap quand le CPU est chargé.' } } as Partial<Task>)
];

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, SESSIONS, { daemon: { version: '0.68.0', install: 'npm', systemd: true, openrigAsks: true }, asks: { channel: READY, asks: ASKS }, tasks: TASKS });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}
const bar = (page: Page) => page.getByRole('navigation', { name: /activité|Activity/ });

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  const fr = lang === 'fr';
  test.describe(`${theme}, ${lang}`, () => {
    test('D1: « Demandes » at the top of Rigs, its badge; an answer leaves; Ledge\'s desk opens them', async ({ page }) => {
      await open(page, theme, lang);
      const rigsIcon = bar(page).getByRole('button', { name: 'Rigs OpenRig', exact: true }).or(bar(page).getByRole('button', { name: 'OpenRig rigs', exact: true }));
      await expect(rigsIcon.locator('.ide-badge.amber')).toHaveText('2');
      // Ledge's desk, in the Atelier tab: their number; a click opens the Rigs view on them.
      const desk = page.locator('.ledge-desk');
      await expect(desk).toContainText(fr ? '2 demandes' : '2 requests');
      await desk.screenshot({ path: `${OUT}/desk-${theme}-${lang}.png` });
      await desk.click();
      const block = page.getByRole('region', { name: fr ? 'Demandes' : 'Requests' });
      await expect(block).toBeVisible();
      await expect(block.locator('.ide-rigs-req-card')).toHaveCount(3);
      await expect(block.locator('.ide-rigs-req-card').first()).toHaveAttribute('data-ask', 'qitem-merge');
      await page.locator('.ide-explorer').screenshot({ path: `${OUT}/rigs-requests-${theme}-${lang}.png` });
      await block.getByRole('button', { name: fr ? 'Replier' : 'Fold' }).click();
      await expect(block.locator('.ide-rigs-req-card')).toHaveCount(0);
      await block.getByRole('button', { name: fr ? 'Déplier' : 'Unfold' }).click();
      await block.locator('[data-ask="qitem-merge"]').getByRole('button', { name: /Fusionner #36/ }).click();
      await expect(block.locator('[data-ask="qitem-merge"]')).toContainText(fr ? 'Envoyé à' : 'Sent to');
    });

    test('D3, D5, D7: the Tasks view by Ctrl+/, its badge, a decision and a report; / does nothing', async ({ page }) => {
      await open(page, theme, lang);
      const icon = bar(page).getByRole('button', { name: fr ? 'Tâches (Ctrl+/)' : 'Tasks (Ctrl+/)' });
      await expect(icon.locator('.ide-badge.amber')).toHaveText('2');
      await page.keyboard.press('/');
      await expect(page.getByRole('complementary', { name: fr ? 'Tâches' : 'Tasks' })).toHaveCount(0);
      await page.keyboard.press('Control+/');
      const view = page.getByRole('complementary', { name: fr ? 'Tâches' : 'Tasks' });
      await expect(view).toBeVisible();
      await expect(view.locator('[data-task="r-4"]')).toContainText(fr ? 'signalement' : 'report');
      await page.screenshot({ path: `${OUT}/tasks-${theme}-${lang}.png` });
      await view.locator('[data-task="r-4"]').click();
      await expect(view.getByRole('button', { name: fr ? 'Créer l’issue' : 'Create the issue' })).toBeVisible();
      await view.screenshot({ path: `${OUT}/tasks-report-${theme}-${lang}.png` });
      await page.keyboard.press('Escape');
      await view.locator('[data-task="t-13"]').click();
      await expect(view.getByRole('button', { name: fr ? 'Répondre' : 'Answer' })).toBeVisible();
      await expect(view).toContainText(fr ? 'Nova attend votre décision' : 'Nova');
      await view.screenshot({ path: `${OUT}/tasks-decision-${theme}-${lang}.png` });
      // Ctrl+/ again: back to the view shown before.
      await page.keyboard.press('Control+/');
      await expect(view).toHaveCount(0);
    });

    test('D10: a failed handover on the tree row and the session page, « Réessayer »', async ({ page }) => {
      await open(page, theme, lang);
      const row = page.locator('.st-row').filter({ has: page.getByRole('button', { name: /^Nova/ }) });
      await expect(row.locator('.st-ctx.failed')).toHaveText(fr ? 'relève échouée' : 'relief failed');
      await row.getByRole('button', { name: /^Nova/ }).click();
      const strip = page.locator('.relief-failed');
      await expect(strip).toContainText(fr ? 'Relève de Nova échouée : Codex hors ligne' : 'Handover of Nova failed: Codex hors ligne');
      await expect(strip.getByRole('button', { name: fr ? 'Réessayer' : 'Retry' })).toBeVisible();
      await page.screenshot({ path: `${OUT}/handover-failed-${theme}-${lang}.png` });
    });
  });
}
