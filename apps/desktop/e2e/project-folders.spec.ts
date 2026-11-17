import type { Page } from '@playwright/test';
import type { ClientMessage, Projects } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, type Folder } from './daemon';

// Issue #2 (docs/mockups/ledge-project-folders.html): a project has at least one folder, and where to add them shows.
test.use({ viewport: { width: 1600, height: 1000 } });
test.setTimeout(90_000);

const folders: Record<string, Folder> = {
  '/home/me': { parent: '/home', entries: ['notes', 'paper-fonts', 'paper-rendering'], repos: [{ name: 'paper-fonts', branch: 'develop' }, { name: 'paper-rendering', branch: 'main' }] }
};
const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    // Saved without a folder before the rule.
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [] }
  ],
  rules: []
};
const W = {
  fr: { general: 'Général', sections: 'Sections des réglages', projects: /^Projets/, card: 'Projets', create: 'Nouveau projet', newDialog: 'Nouveau projet', name: 'Nom',
    createBtn: /^Créer le projet/, missing: 'Ajoutez au moins un dossier au projet : sans dossier, Ledge ne peut pas y ranger les sessions.', add: 'Ajouter paper-rendering (Local)',
    noRepo: 'Aucun dossier : à compléter', addFolder: 'Ajouter un dossier à Website', edit: 'Modifier Website', banner: 'Ce projet n’a aucun dossier.' },
  en: { general: 'General', sections: 'Settings sections', projects: /^Projects/, card: 'Projects', create: 'New project', newDialog: 'New project', name: 'Name',
    createBtn: /^Create the project/, missing: 'Add at least one folder to the project: without one, Ledge cannot file its sessions.', add: 'Add paper-rendering (Local)',
    noRepo: 'No folder: to complete', addFolder: 'Add a folder to Website', edit: 'Edit Website', banner: 'This project has no folder.' }
} as const;

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, eight, { projects, folders: structuredClone(folders), home: '/home/me' });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  const w = W[lang];
  await page.keyboard.press('Control+Comma');
  await expect(page.getByRole('heading', { level: 1, name: w.general })).toBeVisible();
  await page.getByRole('navigation', { name: w.sections }).getByRole('button', { name: w.projects }).click();
  return { daemon, card: page.locator('section.set-card').filter({ has: page.getByRole('heading', { level: 2, name: w.card }) }) };
}
const sets = (received: ClientMessage[]) => received.filter(m => m.type === 'projects.set');

for (const [theme, lang] of [['dark', 'fr'], ['light', 'fr'], ['dark', 'en'], ['light', 'en']] as const) {
  test(`project folders (${theme}, ${lang}): blocked without one, then kept; « to complete » in Settings, the banner in the editor`, async ({ page }) => {
    const w = W[lang];
    const { daemon, card } = await boot(page, theme, lang);
    // Settings › Projects: Website, saved without a folder, « to complete » with « Add a folder ».
    const website = card.getByRole('article', { name: 'Website' });
    await expect(website.getByText(w.noRepo)).toBeVisible();
    await page.screenshot({ path: `e2e/.results/project-folders/settings-${theme}-${lang}.png` });

    await card.getByRole('button', { name: w.create }).click();
    const editor = page.getByRole('dialog', { name: w.newDialog });
    await editor.getByLabel(w.name, { exact: true }).fill('Paper');
    await expect(editor.getByRole('button', { name: w.add })).toBeVisible();
    await page.screenshot({ path: `e2e/.results/project-folders/new-${theme}-${lang}.png` });
    await page.keyboard.press('Control+Enter');
    await expect(editor.getByRole('alert')).toHaveText(w.missing);
    // The browser's first « Add » (notes, the first folder listed).
    await expect(editor.getByRole('button', { name: lang === 'fr' ? 'Ajouter notes (Local)' : 'Add notes (Local)' })).toBeFocused();
    await page.screenshot({ path: `e2e/.results/project-folders/blocked-${theme}-${lang}.png` });
    expect(sets(daemon.received)).toEqual([]);
    await editor.getByRole('button', { name: w.add }).click();
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: `e2e/.results/project-folders/kept-${theme}-${lang}.png` });
    await editor.getByRole('button', { name: w.createBtn }).click();
    await expect(editor).toBeHidden();
    expect((sets(daemon.received)[0] as Extract<ClientMessage, { type: 'projects.set' }>).projects.projects.at(-1)).toMatchObject({ name: 'Paper', repos: [{ machine: 'local', path: '/home/me/paper-rendering' }] });

    // Website's editor: the banner; « Add a folder » opens it on the browser.
    await website.getByRole('button', { name: w.addFolder }).click();
    const edit = page.getByRole('dialog', { name: lang === 'fr' ? 'Modifier Website' : 'Edit Website' });
    await expect(edit.locator('.pe-banner')).toContainText(w.banner);
    await expect(edit.getByRole('button', { name: lang === 'fr' ? 'Ajouter paper-fonts (Local)' : 'Add paper-fonts (Local)' })).toBeVisible();
    await page.screenshot({ path: `e2e/.results/project-folders/banner-${theme}-${lang}.png` });
  });
}
