import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { loadComposer } from '../../src/launch/lazy';
import { saveOpenSession } from '../../src/workspace/openPrefs';
import { PROJECTS } from '../helpers';
import { empty, focusGroup, open, serialize, type Workspace } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';

/** Lot 4, task 3: the IDE opens « Nouvelle session » as its modal, and the launched session where « Ouvrir » said. */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); localStorage.clear(); });

async function mount({ layout }: { layout?: Workspace } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadChat(), loadIde(), loadComposer()]);
  if (layout) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(layout)));
  const d = await createMockDaemon(); daemons.push(d);
  d.options.autoLaunch = true;
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  d.thread('otto', []); d.thread('nova', []);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await side.findByRole('button', { name: /^Otto/ });
  return { d, side, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole('dialog', { name: 'Nouvelle session' });
const groups = () => [...document.querySelectorAll<HTMLElement>('.ide-dock .dv-groupview')];
const tabsIn = (g: Element) => [...g.querySelectorAll<HTMLElement>('[role="tab"]')].map(t => t.getAttribute('aria-label'));
const allTabs = () => groups().flatMap(tabsIn);
const plusOf = (g: Element) => g.querySelector<HTMLButtonElement>('.ide-strip-tools button[title^="Nouvelle session"]')!;
const launches = (d: Daemon) => d.received.filter(m => m.type === 'session.launch') as Array<{ name?: string }>;
/** Otto in the first group, Nova in a second one; the first is focused. */
const twoGroups = () => focusGroup(open(open(empty(), { kind: 'session', ref: 'local:otto' }), { kind: 'session', ref: 'local:nova' }, 'right'), 'g1');

async function fillAndLaunch(d: Daemon, user: ReturnType<typeof userEvent.setup>) {
  const form = within(dialog()!);
  await user.type(form.getByRole('textbox', { name: 'Premier message' }), 'Relis la PR');
  await user.keyboard('{Control>}{Enter}{/Control}');
  await waitFor(() => expect(launches(d)).toHaveLength(1));
  await waitFor(() => expect(dialog()).toBeNull());
  // « Définir un nom ? » off (#15): no name goes; the mock daemon names its first launch Agent1.
  return launches(d)[0]!.name ?? 'Agent1';
}

describe('the IDE’s New session', () => {
  it('a group’s + opens the modal: that group becomes active and « Dans le groupe actif » is checked (Review Focus 2)', async () => {
    saveOpenSession('right');
    const { user } = await mount({ layout: twoGroups() });
    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(groups()[1]).not.toHaveClass('dv-active-group');
    await user.click(plusOf(groups()[1]!));
    const form = within(await screen.findByRole('dialog', { name: 'Nouvelle session' }));
    expect(document.querySelector('.modal')!.firstElementChild!.nextElementSibling).toHaveClass('launch-modal');
    expect(document.querySelector('.modal')).not.toHaveClass('composer-modal');
    expect(form.getByRole('radio', { name: 'Dans le groupe actif' })).toBeChecked();
    await waitFor(() => expect(groups()[1]).toHaveClass('dv-active-group'));
  });

  it('« Ouvrir une session » = « À droite », N: the modal starts there; launched, it closes and the tab opens in a new group on the right, active, once (Review Focus 1)', async () => {
    saveOpenSession('right');
    const { d, user } = await mount({ layout: open(empty(), { kind: 'session', ref: 'local:otto' }) });
    await waitFor(() => expect(groups()).toHaveLength(1));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('n');
    const form = within(await screen.findByRole('dialog', { name: 'Nouvelle session' }));
    expect(form.getByRole('radio', { name: 'À droite' })).toBeChecked();
    const name = await fillAndLaunch(d, user);
    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(tabsIn(groups()[1]!)).toEqual([name]);
    expect(groups()[1]).toHaveClass('dv-active-group');
    expect(allTabs().filter(x => x === name)).toHaveLength(1);
    expect(tabsIn(groups()[0]!)).toEqual(['Otto']);
  });

  it('a group’s + then a launch: the tab opens in that group', async () => {
    const { d, user } = await mount({ layout: twoGroups() });
    await waitFor(() => expect(groups()).toHaveLength(2));
    await user.click(plusOf(groups()[1]!));
    await screen.findByRole('dialog', { name: 'Nouvelle session' });
    const name = await fillAndLaunch(d, user);
    await waitFor(() => expect(tabsIn(groups()[1]!)).toEqual(['Nova', name]));
    expect(groups()).toHaveLength(2);
    expect(tabsIn(groups()[0]!)).toEqual(['Otto']);
    expect(allTabs().filter(x => x === name)).toHaveLength(1);
  });

  it('Escape closes the modal, nothing sent', async () => {
    const { d, user } = await mount({ layout: twoGroups() });
    await waitFor(() => expect(groups()).toHaveLength(2));
    await user.click(plusOf(groups()[0]!));
    await screen.findByRole('dialog', { name: 'Nouvelle session' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(launches(d)).toHaveLength(0);
  });

  it('at start, the IDE on: the chat field is not focused, N opens the modal', async () => {
    const { user } = await mount({ layout: open(empty(), { kind: 'session', ref: 'local:otto' }) });
    const chat = await screen.findByRole('complementary', { name: 'Chat Ledge' });
    const field = await within(chat).findByRole('textbox');
    await waitFor(() => expect(field).toBeEnabled());
    expect(chat.contains(document.activeElement)).toBe(false);
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
    expect(field).toHaveValue('');
  });

  it('another dialog stays open when the front tab changes under it; Enter on a session closes it and opens that tab', async () => {
    const { d, user } = await mount({ layout: twoGroups() });
    d.upsert(fakeSession('mila', { name: 'Mila', cwd: '/w/ledge', state: 'working' })); d.thread('mila', []);
    await waitFor(() => expect(groups()).toHaveLength(2));
    await waitFor(() => expect(groups()[0]).toHaveClass('dv-active-group'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette' });
    // Otto, the front tab, goes: its tab closes and Nova's group comes to the front.
    d.remove('otto');
    await waitFor(() => expect(allTabs()).not.toContain('Otto'));
    await waitFor(() => expect(document.querySelector('.ide-dock .dv-active-group [role="tab"].dv-active-tab')).toHaveAttribute('aria-label', 'Nova'));
    expect(screen.getByRole('dialog', { name: 'Palette' })).toBe(palette);
    await user.keyboard('Mila');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette' })).toBeNull());
    await waitFor(() => expect(allTabs()).toContain('Mila'));
  });

});

// Issue #15 (docs/mockups/ledge-launch-name.html, v2): « Définir un nom ? » on the Project row.
describe('the IDE’s New session, with a name', () => {
  async function openModal() {
    const env = await mount();
    await env.user.keyboard('n');
    const form = within(await screen.findByRole('dialog', { name: 'Nouvelle session' }));
    return { ...env, form, sw: form.getByRole('switch', { name: 'Définir un nom ?' }) };
  }

  it('off at opening: no Name row, and the launch sends no name', async () => {
    const { d, user, form, sw } = await openModal();
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(form.queryByRole('textbox', { name: 'Nom' })).toBeNull();
    await user.type(form.getByRole('textbox', { name: 'Premier message' }), 'Relis');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    expect(launches(d)[0]!.name).toBeUndefined();
  });

  it('on: the field takes the focus, shows the free name, and its cleaned name is sent', async () => {
    const { d, user, form, sw } = await openModal();
    await user.click(sw);
    const field = form.getByRole('textbox', { name: 'Nom' });
    expect(field).toHaveFocus();
    // Otto and Nova are live on this machine: Pim is the next free name.
    expect(field).toHaveAttribute('placeholder', 'Laissez vide pour Pim');
    await user.type(field, 'revue pr!');
    expect(form.getByText('La session s’appellera Revuepr : espaces et ponctuation sont retirés.')).toBeVisible();
    await user.type(form.getByRole('textbox', { name: 'Premier message' }), 'Relis');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    expect(launches(d)[0]!.name).toBe('Revuepr');
  });

  it('on but empty: no name is sent, as when it is off', async () => {
    const { d, user, form, sw } = await openModal();
    await user.click(sw);
    await user.type(form.getByRole('textbox', { name: 'Premier message' }), 'Relis');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    expect(launches(d)[0]!.name).toBeUndefined();
  });

  it('a taken name blocks « Lancer » and says whose it is; off, it is kept but not sent', async () => {
    const { d, user, form, sw } = await openModal();
    await user.type(form.getByRole('textbox', { name: 'Premier message' }), 'Relis');
    await user.click(sw);
    const field = form.getByRole('textbox', { name: 'Nom' });
    await user.type(field, 'nova');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(form.getByText('Nova est déjà le nom d’une session de Ledge. Choisissez un autre nom, ou laissez vide.')).toBeVisible();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(form.getByRole('button', { name: /^Lancer/ })).toHaveAttribute('aria-disabled', 'true');
    expect(form.getByText('Choisissez un autre nom pour la session')).toBeVisible();
    expect(launches(d)).toHaveLength(0);
    await user.click(sw);
    expect(form.queryByRole('textbox', { name: 'Nom' })).toBeNull();
    await user.click(sw);
    expect(form.getByRole('textbox', { name: 'Nom' })).toHaveValue('nova');
    await user.click(sw);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    expect(launches(d)[0]!.name).toBeUndefined();
  });

  it('a reopened box starts off, the name forgotten', async () => {
    const { user, form, sw } = await openModal();
    await user.click(sw);
    await user.type(form.getByRole('textbox', { name: 'Nom' }), 'Ada');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    await user.keyboard('n');
    const again = within(await screen.findByRole('dialog', { name: 'Nouvelle session' }));
    const sw2 = again.getByRole('switch', { name: 'Définir un nom ?' });
    expect(sw2).toHaveAttribute('aria-checked', 'false');
    await user.click(sw2);
    expect(again.getByRole('textbox', { name: 'Nom' })).toHaveValue('');
  });
});
