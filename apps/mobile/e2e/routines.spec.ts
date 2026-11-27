// The phone's Routines (docs/mockups/ledge-routines.html, cards 17 and 25) on a PC that sends its routines: the entry at the top of
// Sessions and the small clock, the Routines screen, and the routines' items of « À toi » (a request with its prompt, a failure,
// several one-shots proposed together); dark in French and light in English, as the mockup's captures.
// SHOTS=<dir> saves a capture of each screen there; compare with docs/mockups/ledge-routines-telephone-*.png and -ajout-telephone-tui-*.png.
import { devices, expect, test, type Page } from '@playwright/test';
import type { PhoneRoutine, PhoneSession, PhoneTask } from '@ledge/protocol';
import { copyFor, type Lang } from '../src/copy';
import { startHarness, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

/** Monday 23 November 2026, 13:02: the mockup's moment. */
const NOW = new Date(2026, 10, 23, 13, 2);
const local = (month: number, d: number, h: number, m: number) => new Date(2026, month, d, h, m).toISOString();
const T = '2026-11-23T07:00:00.000Z';
const sessionOf = (id: string, name: string, extra: Partial<PhoneSession> = {}): PhoneSession => ({
  id, name, tool: 'claude', project: 'assistant', title: `${name} · assistant`, state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, unread: false, ...extra
});
const base = { catchUp: 'once' as const, createdAt: T, createdBy: { kind: 'user' as const } };
const iris = { name: 'Iris', cwd: '~/assistant', tool: 'claude' as const };
const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

/** The mockup's examples (card 17, then card 25's additions). */
const ROUTINES: PhoneRoutine[] = [
  { ...base, id: 'r3f9a12', name: 'point-hebdo', target: iris, schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, key: 'k1' },
  { ...base, id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '~/veille', tool: 'claude' }, schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, state: 'enabled', key: 'k2',
    nextRun: local(10, 23, 18, 0), lastRun: { at: local(10, 22, 18, 0), slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille', field: 'cwd' } },
  { ...base, id: 'r1a2b3c', name: 'briefing', target: iris, schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: [...weekdays] }, state: 'enabled', key: 'k3',
    nextRun: local(10, 23, 13, 30), lastRun: { at: local(10, 23, 8, 42), slot: '08:00', outcome: 'resumed', late: true } },
  { ...base, id: 'r5e6f70', name: 'bilan-sprint', target: iris, schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, state: 'enabled', key: 'k4',
    nextRun: local(10, 26, 16, 0), lastRun: { at: local(10, 12, 16, 0), slot: '16:00', outcome: 'delivered' } },
  { ...base, id: 'r9d8e7f', name: 'rappel-conges', target: iris, schedule: { kind: 'once', at: ['2026-12-04T09:00'] }, state: 'enabled', key: 'k5', nextRun: local(11, 4, 9, 0) }
];
const PROMPTS = { r3f9a12: 'Point de la semaine du {date} : relis journal/, résume ce qui a avancé et ce qui reste, mets les décisions dans À toi.' };
const ask = (at: string, routine: PhoneTask['routine'], extra: Partial<PhoneTask> = {}): PhoneTask => ({
  id: `t${routine!.id}`, title: `Iris veut programmer « ${routine!.name} »`, owner: 'ledge', ownerName: 'Ledge', giver: 'ledge', giverName: 'Ledge', state: 'open', at, updatedAt: at, routine, ...extra
});
const TASKS: PhoneTask[] = [
  ask(local(10, 23, 2, 10), { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }),
  ask(local(10, 22, 18, 0), { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { giver: 'ledge', giverName: 'Ledge' })
];
const ONE_SHOTS: PhoneRoutine[] = [['r000001', 'prepa-121', '2026-12-03T16:00'], ['r000002', 'prepa-comite-archi', '2026-12-07T15:00'], ['r000003', 'prepa-demo-compart', '2026-12-08T09:30']]
  .map(([id, name, when]) => ({ ...base, id: id!, name: name!, target: iris, schedule: { kind: 'once', at: [when!] }, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, key: `k-${id}` }));

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  h.daemon.sessions = [sessionOf('iris', 'Iris', { state: 'working' }), sessionOf('otto', 'Otto', { tool: 'codex', project: 'ledge' }), sessionOf('lu', 'Lu', { project: 'ledge', state: 'working' })];
  h.daemon.routines = { list: ROUTINES, prompts: PROMPTS };
  h.daemon.tasks = TASKS;
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/routines-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light', lang: Lang) {
  await page.clock.setFixedTime(NOW);
  // A phone that can check itself, as the mockup draws it: the PC says this device confirms, Chromium lends a platform authenticator.
  h.daemon.push = 'unavailable';
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  }
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('ledge.theme', t!); localStorage.setItem('mobile.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
  await page.goto(h.url);
  const c = copyFor(lang);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: c.compare.seePending }).click();
}
const go = async (page: Page, hash: string) => { await page.evaluate(x => { location.hash = x; }, hash); };

for (const [lang, theme] of [['fr', 'dark'], ['en', 'light']] as const) {
  const R = copyFor(lang).routines;
  test.describe(`on a phone, ${theme}, ${lang}`, () => {
    test.use(iPhone13);
    test('the entry in Sessions, the Routines screen, « Lancer maintenant », and its requests at its top', async ({ page }) => {
      const tag = `${theme}-${lang}`;
      await pair(page, theme, lang);
      await go(page, '#/sessions');
      const entry = page.getByRole('link', { name: new RegExp(R.entry) });
      await expect(entry).toContainText(R.entrySub(5, '13:30'));
      await shot(page, `sessions-${tag}`);

      await entry.click();
      await expect(page.getByRole('article', { name: 'briefing' })).toBeVisible();
      await shot(page, `list-${tag}`);
      await page.getByRole('article', { name: 'bilan-sprint' }).scrollIntoViewIfNeeded();
      await shot(page, `list-end-${tag}`);
      await page.getByRole('article', { name: 'briefing' }).getByRole('button', { name: R.runNow }).click();
      await expect.poll(() => h.daemon.routineCmds.map(c => `${c.action} ${c.routine}`)).toEqual(['run r1a2b3c']);

      await go(page, '#/routines');  // #40 D4: the requests head Routines.
      const request = page.getByRole('article', { name: `${R.atoi.ask} · point-hebdo` });
      await expect(request.getByText(PROMPTS.r3f9a12)).toBeVisible();
      await expect(request.getByRole('button', { name: R.atoi.activate })).toBeEnabled();
      // Under the passkey's own card (this fake PC keeps no recovery passkey): the routines' items brought into view.
      await request.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await shot(page, `routines-requests-${tag}`);
    });

    test('a session’s change, and a failure’s « Voir » scrolling to its routine (card 29)', async ({ page }) => {
      const briefing = ROUTINES.find(r => r.name === 'briefing')!;
      h.daemon.routines = { list: ROUTINES.map(r => (r.id === briefing.id ? { ...r, proposed: true as const } : r)), prompts: { [briefing.id]: 'Briefing de {slot} (précédent : {last}). Relis etat.md, collecte, compare, écris journal/{date}.md, mets les décisions dans À toi.' },
        proposals: { [briefing.id]: { spec: { name: 'briefing', target: iris, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: [...weekdays] }, prompt: 'Briefing de {slot} (précédent : {last}). Relis etat.md, collecte, compare, écris journal/{date}.md, mets les décisions dans À toi.', catchUp: 'once' }, by: { id: 'iris', name: 'Iris' }, at: local(10, 23, 3, 40) } } };
      h.daemon.tasks = [ask(local(10, 23, 3, 40), { kind: 'approve', id: briefing.id, name: 'briefing' }), TASKS[1]!];
      await pair(page, theme, lang);
      await go(page, '#/routines');  // #40 D4: the requests head Routines.
      const change = page.getByRole('article', { name: `${R.atoi.ask} · briefing` });
      await expect(change).toContainText(R.atoi.editAsks('briefing', lang === 'fr' ? '07:30, 13:30, 16:30 (lun–ven)' : '07:30, 13:30, 16:30 (Mon–Fri)'));
      await change.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await shot(page, `routines-change-${theme}-${lang}`);
      // #40 D4: a failed run keeps « Relancer » on its row; « Voir » of its push still scrolls to it (card 29).
      await go(page, '#/routines/r81c0d4');
      await expect(page).toHaveURL(/#\/routines\/r81c0d4$/);
      const ringed = page.getByRole('article', { name: 'veille' }).locator('..');
      await expect(ringed).toHaveAttribute('data-focused', 'true');
      await shot(page, `see-${theme}-${lang}`);
    });

    test('several one-shots proposed together', async ({ page }) => {
      // Card 31, A: each routine read whole, its prompt unfolded.
      h.daemon.routines = { list: ONE_SHOTS, prompts: {
        r000001: 'Prépare le 121 du 4 déc. : réalisations depuis le dernier 121 (synthèses hebdo), sujets à demander. Écris prepa-121/{date}.md.',
        r000002: 'Prépare le comité d’architecture du 8 déc. : ADR ouverts, changements du dépôt Archi, sujets à lever.',
        r000003: 'Prépare la démo Compart du 8 déc. à 11:00 : état du connecteur, questions ouvertes, ce qu’il faut montrer.' } };
      h.daemon.tasks = [ask(local(10, 23, 2, 58), { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] })];
      await pair(page, theme, lang);
      await go(page, '#/routines');  // #40 D4: the requests head Routines.
      const group = page.getByRole('article', { name: `${R.atoi.ask} · prepa-121` });
      await expect(group.getByRole('button', { name: R.atoi.activateAll(3) })).toBeEnabled();
      await group.evaluate(el => el.scrollIntoView({ block: 'start' }));
      await shot(page, `atoi-group-${theme}-${lang}`);
    });
  });
}
