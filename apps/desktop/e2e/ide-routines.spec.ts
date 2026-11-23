import type { Page } from '@playwright/test';
import type { Routine, Session, Task } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session } from './daemon';

// Routines (docs/mockups/ledge-routines.html, cards 1-14 and 19-24) on the protocol's contract, with the mockup's examples, seen
// on Monday 23 November 2026 at 13:02 in Brussels. Nothing reaches a real daemon: the fake one answers.
test.use({ viewport: { width: 1440, height: 940 }, timezoneId: 'Europe/Brussels' });
test.setTimeout(120_000);

const SHOTS = process.env.LEDGE_ROUTINE_SHOTS;
const NOW = new Date('2026-11-23T12:02:00.000Z');
const at = (iso: string) => new Date(iso).toISOString();
const sessions: Session[] = [
  session('iris', { name: 'Iris', project: 'assistant', cwd: '/home/jde/assistant', state: 'working', branch: 'main' }),
  session('otto', { name: 'Otto', tool: 'codex', project: 'ledge', cwd: '/home/jde/Workspace/ledge', state: 'idle', branch: 'review' })
];
const base = { catchUp: 'once' as const, createdBy: { kind: 'user' as const }, createdAt: at('2026-11-01T08:00:00Z') };
const iris = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
const routines = (): Routine[] => [
  { ...base, id: 'r3f9a12', name: 'point-hebdo', target: iris, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, createdAt: at('2026-11-23T01:10:00Z'),
    schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, prompt: 'Point de la semaine du {date} : relis journal/, résume ce qui a avancé et ce qui reste, mets les décisions dans À toi.' },
  { ...base, id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, state: 'enabled',
    schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, prompt: 'Veille du {date} : lis les flux de sources.md.',
    nextRuns: [at('2026-11-23T17:00:00Z'), at('2026-11-24T17:00:00Z'), at('2026-11-25T17:00:00Z')],
    runs: [{ at: at('2026-11-22T17:00:00Z'), slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : /home/jde/veille', field: 'cwd' }, { at: at('2026-11-21T17:00:00Z'), slot: '18:00', outcome: 'launched' }] },
  { ...base, id: 'r1a2b3c', name: 'briefing', target: iris, state: 'enabled', schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: [...WEEK] },
    prompt: 'Briefing de {slot} (précédent : {last}). Relis etat.md, collecte, compare, écris journal/{date}.md, mets les décisions dans À toi.',
    nextRuns: [at('2026-11-23T12:30:00Z'), at('2026-11-23T15:30:00Z'), at('2026-11-24T07:00:00Z')],
    runs: [
      { at: at('2026-11-23T07:42:00Z'), slot: '08:00', slotAt: at('2026-11-23T07:00:00Z'), outcome: 'resumed', late: true },
      { at: at('2026-11-22T15:30:00Z'), slot: '16:30', outcome: 'delivered' }, { at: at('2026-11-22T12:30:00Z'), slot: '13:30', outcome: 'delivered' },
      { at: at('2026-11-22T07:00:00Z'), slot: '08:00', outcome: 'launched' },
      { at: at('2026-11-20T15:30:00Z'), slot: '16:30', outcome: 'failed', reason: 'pas tapée en 30 min (session occupée)' }
    ] },
  { ...base, id: 'r5e6f70', name: 'revue-prs', target: { name: 'Otto', cwd: '~/Workspace/ledge', tool: 'codex' }, state: 'enabled', schedule: { kind: 'recurring', times: ['09:00'], days: [...WEEK] },
    prompt: 'Revue des PR ouvertes.', nextRuns: [at('2026-11-24T08:00:00Z')], runs: [{ at: at('2026-11-23T08:00:00Z'), slot: '09:00', outcome: 'delivered' }] },
  { ...base, id: 'r9d8e7f', name: 'nettoyage-branches', target: { name: 'Pim', cwd: '~/Workspace/synapse', tool: 'claude' }, state: 'paused',
    schedule: { kind: 'recurring', times: ['19:30'], days: ['fri'] }, prompt: 'Nettoie les branches fusionnées.' },
  { ...base, id: 'r200001', name: 'bilan-sprint', target: iris, state: 'enabled', schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } },
    prompt: 'Bilan du sprint.', nextRuns: [at('2026-11-26T15:00:00Z'), at('2026-12-10T15:00:00Z'), at('2026-12-24T15:00:00Z')] },
  ...(['prepa-121|2026-12-03T16:00', 'prepa-comite-archi|2026-12-07T15:00', 'prepa-demo-compart|2026-12-08T09:30'] as const).map((x, i): Routine => {
    const [name, moment] = x.split('|') as [string, string];
    return { ...base, id: `r30000${i}`, name, target: iris, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, createdAt: at('2026-11-23T01:58:00Z'),
      schedule: { kind: 'once', at: [moment] }, prompt: `Prépare ${name}.` };
  }),
  { ...base, id: 'r400000', name: 'prepa-121-nov', target: iris, state: 'done', schedule: { kind: 'once', at: ['2026-11-19T16:00'] }, prompt: 'Prépare le 121 du 20/11.',
    runs: [{ at: at('2026-11-19T15:00:00Z'), slot: '16:00', outcome: 'delivered' }] }
];
const task = (id: string, routine: Task['routine'], title: string, text?: string): Task => ({
  id, title, giver: 'iris', giverName: routine?.kind === 'failed' ? 'Nova' : 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open',
  at: at('2026-11-23T01:58:00Z'), updatedAt: at('2026-11-23T01:58:00Z'), log: [], routine, ...(text ? { text } : {})
});
const tasks: Task[] = [
  task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }, 'point-hebdo'),
  task('t2', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, 'veille'),
  task('t3', { kind: 'approve', id: 'r300000', name: 'prepa-121', ids: ['r300000', 'r300001', 'r300002'] }, 'prepa', 'préparations de réunion trouvées dans l’agenda')
];
const DAEMON = { version: '0.62.0', install: 'npm' as const, systemd: true, routines: true, home: '/home/jde' };

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en', list: Routine[] = routines()) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { daemon: DAEMON as never, routines: { list, preview: [at('2026-11-23T12:30:00Z'), at('2026-11-23T15:30:00Z'), at('2026-11-24T07:00:00Z')] }, tasks });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  return daemon;
}
const activity = (page: Page) => page.locator('nav.ide-activity');
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, ...(clip ? { clip } : {}) });
};
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

for (const [theme, lang] of [['dark', 'fr'], ['light', 'en']] as const) {
  test(`Routines (${theme}, ${lang}): the view, a page, a change, the questions`, async ({ page }) => {
    const daemon = await boot(page, theme, lang);
    const fr = lang === 'fr';
    const button = activity(page).getByRole('button', { name: 'Routines', exact: true });
    // Card 1: the badge counts point-hebdo, veille's failure and the three one-shots asked together.
    await expect(button.locator('.ide-badge')).toHaveText('5');
    await button.click();
    const view = page.getByRole('region', { name: 'Routines' });
    await expect(view.locator('.rt-grp-h')).toHaveText(fr ? ['Récurrentes · 5', 'Uniques · 3', 'En pause · 1', 'Passées · 1'] : ['Recurring · 5', 'Once · 3', 'Paused · 1', 'Past · 1']);
    // Card 2's order: to activate, failed, then by next run.
    await expect(view.locator('.rt-grp').first().locator('.rt-row > b')).toHaveText(['point-hebdo', 'veille', 'briefing', 'revue-prs', 'bilan-sprint']);
    await expect(view.locator('[data-routine="local:r1a2b3c"] .rt-nx')).toHaveText('13:30');
    await expect(view.locator('[data-routine="local:r5e6f70"] .rt-nx')).toHaveText(fr ? 'demain 09:00' : 'tomorrow 09:00');
    await expect(view.locator('[data-routine="local:r200001"] small')).toContainText(fr ? 'jeu 16:00 · 1 sem. sur 2' : 'Thu 16:00 · every 2 wks');
    await expect(view.locator('.rt-prop')).toHaveText(fr ? 'Proposées ensemble par Iris · 3' : 'Proposed together by Iris · 3');
    await expect(view.locator('.rt-foot')).toHaveText(fr ? 'Heures de ce PC · Europe/Brussels' : 'This PC’s times · Europe/Brussels');

    // Card 3: briefing's page.
    await view.locator('[data-routine="local:r1a2b3c"] .rt-hit').click();
    const tab = page.getByRole('tabpanel', { name: /^briefing/ });
    await expect(tab.locator('.rt-hd h3')).toHaveText('briefing');
    await expect(tab.locator('.rt-wakes')).toContainText(fr ? 'Réveille Iris' : 'Wakes Iris');
    await expect(tab.locator('.rt-runs ul').first().locator('li')).toHaveCount(3);
    await expect(tab.locator('.rt-runs ul').nth(1).locator('li')).toHaveCount(5);
    await expect(view.locator('[data-routine="local:r1a2b3c"]')).toHaveClass(/sel/);
    await expect(page.locator('.ide-explorer')).toBeVisible();
    await shot(page, `vue-${theme}-${lang}`);
    const side = await box(page, '.ide-explorer');
    await shot(page, `sidebar-zoom-${theme}-${lang}`, { x: side.x, y: side.y, width: side.width, height: 520 });
    await page.setViewportSize({ width: 1440, height: 1400 });
    const p3 = await box(page, '.rt-page');
    await shot(page, `page-zoom-${theme}-${lang}`, { x: p3.x, y: p3.y, width: Math.min(p3.width, 800), height: 1180 });
    await page.setViewportSize({ width: 1440, height: 940 });

    // Card 2's hover: the two quick buttons in place of the next run; right click: its menu.
    const revue = view.locator('[data-routine="local:r5e6f70"]');
    await revue.hover();
    await expect(revue.locator('.rt-qa')).toBeVisible();
    await expect(revue.locator('.rt-nx')).toBeHidden();
    const rb = await revue.boundingBox();
    await shot(page, `hover-${theme}-${lang}`, { x: rb!.x - 8, y: rb!.y - 8, width: rb!.width + 16, height: rb!.height + 16 });
    await revue.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'revue-prs' });
    await expect(menu.getByRole('menuitem')).toHaveText(fr ? ['Lancer maintenant', 'Pause', 'Ouvrir la session', 'Supprimer…'] : ['Run now', 'Pause', 'Open the session', 'Delete…']);
    await page.keyboard.press('Escape');

    // Card 9: « Lancer maintenant » from the hover waits for the firing, then says how it went.
    await revue.hover();
    await revue.getByRole('button', { name: fr ? 'Lancer maintenant · revue-prs' : 'Run now · revue-prs' }).click();
    await expect(revue.locator('.rt-x3')).toHaveText(fr ? 'attend que Otto soit libre…' : 'waiting for Otto to be free…');
    await shot(page, `lancer-${theme}-${lang}`, { x: rb!.x - 8, y: rb!.y - 8, width: rb!.width + 16, height: rb!.height + 30 });
    await expect(page.locator('.toast-region')).toContainText(fr ? '« revue-prs » remise à Otto.' : '“revue-prs” delivered to Otto.', { timeout: 10_000 });
    await expect(revue.locator('.rt-x3')).toHaveCount(0);

    // Card 4: a time changed brings the bar and the tab's « • »; Ctrl+S saves the patch.
    await tab.locator('.rt-chip').filter({ hasText: '08:00' }).getByRole('button').click();
    await expect(tab.locator('.rt-dirtybar')).toContainText(fr ? 'Modifications non enregistrées' : 'Unsaved changes');
    await expect(page.locator('.dv-tab .rt-dirty')).toBeVisible();
    await shot(page, `dirty-${theme}-${lang}`);
    await tab.locator('textarea').focus();
    await page.keyboard.press('Control+s');
    await expect.poll(() => daemon.received.filter(m => m.type === 'routine.cmd' && m.op === 'update').length).toBe(1);
    await expect(tab.locator('.rt-dirtybar')).toHaveCount(0);

    // Card 6: a session's request; Activer sends approve.
    await view.locator('[data-routine="local:r3f9a12"] .rt-hit').click();
    const pend = page.getByRole('tabpanel', { name: /^point-hebdo/ });
    await expect(pend.locator('.rt-bn.ask')).toContainText(fr ? 'Iris demande à programmer cette routine (02:10).' : 'Iris asks to schedule this routine (02:10).');
    await expect(pend.locator('.rt-hd .fg-btn')).toHaveCount(1);
    await shot(page, `demande-${theme}-${lang}`);
    await pend.locator('.rt-bn').getByRole('button', { name: fr ? 'Activer' : 'Activate' }).click();
    await expect.poll(() => daemon.received.filter(m => m.type === 'routine.cmd' && m.op === 'approve').length).toBe(1);

    // Card 8: veille's failure, the faulty field outlined.
    await view.locator('[data-routine="local:r81c0d4"] .rt-hit').click();
    const fail = page.getByRole('tabpanel', { name: /^veille/ });
    await expect(fail.locator('.rt-bn.bad')).toContainText(fr ? 'Le tir de 18:00 n’a pas pu partir : dossier introuvable : ~/veille' : 'The 18:00 run could not start: folder not found: ~/veille');
    await expect(fail.locator('.rt-sel.err')).toBeVisible();
    await expect(view.locator('[data-routine="local:r81c0d4"] .rt-x3')).toHaveText(fr ? 'dossier introuvable : ~/veille' : 'folder not found: ~/veille');
    await shot(page, `echec-${theme}-${lang}`);

    // Card 10: delete from the right click, Échap cancels.
    await view.locator('[data-routine="local:r5e6f70"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: fr ? 'Supprimer…' : 'Delete…' }).click();
    const del = page.getByRole('tabpanel', { name: /^revue-prs/ });
    await expect(del.locator('.rt-bn.bad')).toContainText(fr ? 'Supprimer la routine « revue-prs » ?' : 'Delete the routine “revue-prs”?');
    await shot(page, `supprimer-${theme}-${lang}`);
    await page.keyboard.press('Escape');
    await expect(del.locator('.rt-bn.bad')).toHaveCount(0);

    // Card 24: one of the one-shots proposed together; card 21: the past ones, unfolded.
    await view.locator('[data-routine="local:r300001"] .rt-hit').click();
    const grp = page.getByRole('tabpanel', { name: /^prepa-comite-archi/ });
    await expect(grp.locator('.rt-bn.ask')).toContainText(fr ? 'Iris propose 3 routines uniques ensemble' : 'Iris proposes 3 one-shot routines together');
    await expect(grp.locator('.rt-prev3')).toBeVisible();
    await shot(page, `groupee-page-${theme}-${lang}`);
    await view.getByRole('button', { name: fr ? 'Passées · 1' : 'Past · 1' }).click();
    await view.locator('[data-routine="local:r400000"] .rt-hit').click();
    const past = page.getByRole('tabpanel', { name: /^prepa-121-nov/ });
    await expect(past.getByRole('button', { name: fr ? 'Programmer à nouveau…' : 'Schedule again…' })).toBeVisible();
    await shot(page, `passee-${theme}-${lang}`);

    // Card 5: « + », then Créer with nothing: the errors.
    await view.getByRole('button', { name: fr ? 'Nouvelle routine' : 'New routine' }).first().click();
    const nw = page.getByRole('tabpanel', { name: fr ? /^Nouvelle routine/ : /^New routine/ });
    await nw.getByRole('button', { name: fr ? 'Créer la routine' : 'Create the routine' }).click();
    await expect(nw.locator('.rt-hint.err')).toHaveText(fr ? ['Au moins une heure.', 'Au moins un jour.'] : ['At least one time.', 'At least one day.']);
    await nw.getByRole('radio', { name: fr ? 'Unique' : 'Once', exact: true }).click();
    await shot(page, `nouvelle-${theme}-${lang}`);

    // Card 19: briefing every two weeks, its reference week and the daemon's preview.
    await view.locator('[data-routine="local:r1a2b3c"] .rt-hit').click();
    await tab.getByLabel(fr ? 'Toutes les deux semaines' : 'Every two weeks').check();
    await tab.locator('#rt-anchor').fill('2026-11-27');
    await expect(tab.locator('.rt-fld.anchor .rt-hint')).toContainText(fr ? 'semaine 48, du 23 au 29 novembre' : 'week 48, 23–29 Nov');
    await expect(tab.locator('.rt-prev3 li')).toHaveCount(3);
    await shot(page, `type-${theme}-${lang}`);
    // Card 4's close question.
    await page.locator('.dv-tab').filter({ hasText: 'briefing' }).hover();
    await page.locator('.dv-tab').filter({ hasText: 'briefing' }).locator('.dv-default-tab-action').click();
    await expect(page.getByRole('alertdialog')).toContainText(fr ? 'Ne pas enregistrer' : 'Don’t save');
    await shot(page, `fermer-${theme}-${lang}`);
    await page.getByRole('alertdialog').getByRole('button', { name: fr ? 'Ne pas enregistrer' : 'Don’t save' }).click();
    await expect(page.locator('.dv-tab').filter({ hasText: 'briefing' })).toHaveCount(0);
  });

  test(`Routines (${theme}, ${lang}): « À toi » and the explorer's clock`, async ({ page }) => {
    await boot(page, theme, lang);
    const fr = lang === 'fr';
    // Card 14: the sidebar's « À toi », short; its amber and red counts.
    await activity(page).getByRole('button', { name: fr ? 'À toi' : 'For you', exact: true }).click();
    const cards = page.locator('.rt-st-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText(fr ? 'veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant' : 'wants to schedule “point-hebdo”: 17:00 (Fri), in ~/assistant');
    await expect(cards.nth(2)).toContainText(fr ? 'veut programmer 3 routines uniques' : 'wants to schedule 3 one-shot routines');
    const side = await box(page, '.ide-explorer');
    await shot(page, `atoi-side-${theme}-${lang}`, { x: side.x, y: side.y, width: side.width, height: 520 });
    // Card 13: the page's block, after Décisions.
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    const blk = page.locator('[data-block="routines"]');
    await expect(blk.locator('.fg-blk-h')).toContainText(fr ? 'Routines3 · à activer, ou qui n’ont pas pu partir' : 'Routines3 · to activate, or that could not run');
    await blk.getByRole('button', { name: fr ? '▸ Voir le prompt' : '▸ See the prompt' }).first().click();
    await expect(blk.locator('.rt-unfold').first()).toContainText('Point de la semaine');
    const b = await blk.boundingBox();
    await shot(page, `atoi-page-${theme}-${lang}`, { x: b!.x - 10, y: b!.y - 10, width: b!.width + 20, height: b!.height + 20 });
    // Card 12: the clock on Iris's row; a click shows the Routines view with her two routines lit (more than one).
    await activity(page).getByRole('button', { name: fr ? 'Projets' : 'Projects', exact: true }).click();
    const clock = page.locator('.ide-explorer [data-routine-clock]').first();
    await expect(clock).toHaveAttribute('title', fr ? /routines · prochain tir aujourd’hui 13:30/ : /routines · next run today 13:30/);
    const row = await clock.locator('xpath=ancestor::div[contains(@class,"st-agent")]').boundingBox();
    await shot(page, `horloge-${theme}-${lang}`, { x: row!.x - 6, y: row!.y - 6, width: row!.width + 12, height: row!.height + 12 });
    await clock.click();
    await expect(page.getByRole('region', { name: 'Routines' }).locator('.rt-row.sel')).not.toHaveCount(0);
  });
}

test('Routines: empty, then the daemon gone', async ({ page }) => {
  await boot(page, 'dark', 'fr', []);
  await activity(page).getByRole('button', { name: 'Routines', exact: true }).click();
  const view = page.getByRole('region', { name: 'Routines' });
  await expect(view.locator('.rt-empty')).toContainText('Aucune routine');
  const side = await box(page, '.ide-explorer');
  await shot(page, 'etats-vide-dark-fr', { x: side.x, y: side.y, width: side.width, height: 400 });
});
