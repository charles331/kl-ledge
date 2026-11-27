import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_ISLAND_PREFS, type ClientMessage, type IslandPrefs } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS, type MockDaemon } from './helpers';
import { comboOf, shownKeys } from '../src/settings/Island';
import { sameIsland, useIslandSave } from '../src/settings/useIslandSave';
import { UNCONFIRMED_MS } from '../src/projects/useProjectSave';
import { setDnd } from '../src/notify/prefs';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); cleanup(); await closeDaemons(); });

type IslandSet = Extract<ClientMessage, { type: 'island.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is IslandSet => m.type === 'island.set');
const saved = () => savedNotices(log);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const sw = (name: string) => screen.getByRole('switch', { name });
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));
const recorder = () => screen.getByRole('button', { name: /^Shortcut to reopen a request: / });
const caption = () => document.querySelector('.island-preview figcaption > span')!.textContent;

/** Plays the daemon: the last `island.set` it received comes back as its `island` broadcast. */
async function confirm(d: MockDaemon, count: number): Promise<IslandPrefs> {
  await waitFor(() => expect(setsOf(d)).toHaveLength(count));
  const prefs = setsOf(d).at(-1)!.prefs;
  d.push({ type: 'island', prefs });
  return prefs;
}

/** The app on a daemon that holds `prefs` for the notch (null: none set; 'unknown': a daemon that never speaks of them), then Settings › Notch. */
async function open(prefs: IslandPrefs | null | 'unknown' = null) {
  const env = await boot({ projects: TWO_PROJECTS });
  if (prefs !== 'unknown') env.d.push({ type: 'island', prefs });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: /^Notch/ }));
  await screen.findByRole('heading', { level: 1, name: 'Notch' });
  return env;
}

describe('Settings › Notch', () => {
  it('sits between Appearance and Notifications; the banner, then the mockup’s rows in order, the defaults while none was set', async () => {
    await open();
    expect(nav().getAllByRole('button').map(b => b.textContent).slice(0, 5)).toEqual(['General', 'Workspace', 'Appearance', 'Notch', 'Notifications']);
    expect(screen.getByRole('region', { name: 'Notch' })).toHaveTextContent('The notch at the top of the screen: where it sits and what it signals.');
    expect(screen.getByRole('note')).toHaveTextContent('The notch has no settings of its own any more.');
    expect([...document.querySelectorAll('.set-card .set-label')].map(l => l.textContent)).toEqual([
      'Show the notch', 'Screen', 'Notch position', 'Notch size',
      'Allow and answer from the notch', 'Notice when an agent is done', 'Shortcut to reopen a request'
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['What the notch does']);
    for (const name of ['Show the notch', 'Allow and answer from the notch', 'Notice when an agent is done']) expect(sw(name)).toHaveAttribute('aria-checked', 'true');
    expect(group('Screen').getByRole('radio', { name: 'Main' })).toBeChecked();
    expect(group('Notch position').getByRole('radio', { name: 'Centre' })).toBeChecked();
    expect(group('Notch position').getAllByRole('radio').map(r => r.parentElement!.textContent)).toEqual(['Left', 'Centre', 'Right']);
    // Auto at the main screen's size (the browser's stand-in, 2560 × 1440): the notch 125 %, its windows 100 %.
    expect(group('Notch size').getAllByRole('radio').map(r => r.parentElement!.textContent)).toEqual(['Auto (125%)', '100%', '125%', '150%', '200%']);
    expect(screen.queryByRole('radiogroup', { name: 'Notch windows size' })).toBeNull();
    expect(screen.getByText('The notch sits at the top of this screen (2560 × 1440).')).toBeVisible();
    expect(recorder()).toHaveAccessibleName('Shortcut to reopen a request: Ctrl Alt L. Edit');
    // The preview: both screens, and on the main one the island open on a request, centred; no mascot, no words.
    expect([...document.querySelectorAll('.preview-caption')].map(c => c.textContent)).toEqual(['Main 2560 × 1440', 'Screen 2 1920 × 1080']);
    expect(document.querySelector('.preview-screen.here .preview-island.pos-center')).not.toBeNull();
    expect(document.querySelector('.preview-notch, .preview-bubble, .preview-mascot')).toBeNull();
    expect(caption()).toBe('At rest, nothing is on screen. The notch opens here on a request.');
    expect(screen.getByRole('note')).toHaveTextContent('It lets you know when an agent needs you: allow or answer in one gesture, or open the session in Ledge Desktop.');
    expect(screen.queryByRole('switch', { name: 'Agents’ words' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Subagents in the notch' })).toBeNull();
    expect(document.querySelector('.set-well')).toBeNull();
    expect(saved()).toEqual([]);
  });

  it('under Do not disturb the preview draws no island and says that nothing opens', async () => {
    setDnd(true);
    try {
      await open();
    expect(document.querySelector('.preview-screen.here')).not.toBeNull();
    expect(document.querySelector('.preview-island')).toBeNull();
      expect(caption()).toBe('Do not disturb: nothing opens, requests wait in Ledge Desktop.');
    } finally { setDnd(false); }
  });

  it('« Show the notch » off: island.set carries visible false, « Setting saved » only once the daemon broadcasts it, and every other control is disabled', async () => {
    const { d, user } = await open();
    await user.click(sw('Show the notch'));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.prefs).toEqual({ ...DEFAULT_ISLAND_PREFS, visible: false });
    expect(saved()).toEqual([]);
    await confirm(d, 1);
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Notch hidden']));
    expect(sw('Show the notch')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Show the notch')).toBeEnabled();
    for (const name of ['Allow and answer from the notch', 'Notice when an agent is done']) expect(sw(name)).toBeDisabled();
    for (const name of ['Screen', 'Notch position', 'Notch size']) {
      expect(screen.getByRole('radiogroup', { name })).toHaveAttribute('aria-disabled', 'true');
      for (const r of group(name).getAllByRole('radio')) expect(r).toBeDisabled();
    }
    expect(recorder()).toBeDisabled();
    expect(document.querySelector('.preview-screen.here')).toBeNull();
    expect(caption()).toBe('The notch is hidden. Ledge Desktop still lets you know.');
    // Back on: everything comes back.
    await user.click(sw('Show the notch'));
    await confirm(d, 2);
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Notch hidden', 'Setting saved · Notch shown']));
    expect(sw('Notice when an agent is done')).toBeEnabled();
  });

  it('screen, position, sizes and what the notch does: each change sends the whole settings and is said once confirmed; the preview follows', async () => {
    const { d, user } = await open();
    await user.click(group('Notch position').getByRole('radio', { name: 'Right' }));
    expect((await confirm(d, 1)).position).toBe('right');
    await waitFor(() => expect(document.querySelector('.preview-island.pos-right')).not.toBeNull());
    await user.click(group('Screen').getByRole('radio', { name: 'Screen 2' }));
    expect((await confirm(d, 2))).toMatchObject({ screen: '#1', position: 'right' });
    await waitFor(() => expect(screen.getByText('The notch sits at the top of this screen (1920 × 1080).')).toBeVisible());
    expect(document.querySelector('.preview-screen.here .preview-caption')).toHaveTextContent('Screen 2 1920 × 1080');
    // Auto now reads the 1080 px screen.
    expect(group('Notch size').getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
    await user.click(group('Notch size').getByRole('radio', { name: '150%' }));
    expect((await confirm(d, 3)).islandScale).toBe(1.5);
    await waitFor(() => expect(document.querySelector<HTMLElement>('.preview-island')!.style.getPropertyValue('--k')).toBe('1.5'));
    await user.click(sw('Allow and answer from the notch'));
    await confirm(d, 4);
    await user.click(sw('Notice when an agent is done'));
    // The retired words and subagents travel as the daemon held them (older daemons require them).
    expect((await confirm(d, 5)).shows).toEqual({ quick: false, finished: false, say: true, helpers: true });
    // Discreet left with the floating island (#27): neither its switch nor the preview's maximised window remain.
    expect(screen.queryByRole('switch', { name: 'Discreet under a window' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Simulate a maximised window' })).toBeNull();
    await waitFor(() => expect(saved()).toHaveLength(5));
    expect(saved()).toEqual([
      'Setting saved · Position: Right', 'Setting saved · Screen 2', 'Setting saved · Notch size 150%',
      'Setting saved · Answers in Ledge Desktop only', 'Setting saved · No task finished notice'
    ]);
  });

  it('the shortcut recorder: Edit listens, a key without Ctrl, Alt or ⊞ says why, Escape cancels without leaving Settings, Ctrl Alt K is saved', async () => {
    const { d, user } = await open();
    await user.click(recorder());
    expect(recorder()).toHaveTextContent('Press…Cancel');
    expect(screen.getByText('Press the combination you want. Esc to cancel.')).toBeVisible();
    await user.keyboard('k');
    expect(log).toContain('Add Ctrl, Alt or ⊞: the shortcut has to work anywhere in Windows.');
    await user.keyboard('{Escape}');
    expect(recorder()).toHaveTextContent('Ctrl Alt LEdit');
    expect(screen.getByRole('heading', { level: 1, name: 'Notch' })).toBeVisible();
    expect(setsOf(d)).toHaveLength(0);
    await user.click(recorder());
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    expect((await confirm(d, 1)).shortcut).toBe('Ctrl Alt K');
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Reopen a request: Ctrl Alt K']));
    expect(recorder()).toHaveAccessibleName('Shortcut to reopen a request: Ctrl Alt K. Edit');
    // Ctrl K was taken by the recorder, not by the search.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a daemon that never speaks of the notch: said at the top, and a change is refused under its row, nothing sent', async () => {
    const { d, user } = await open('unknown');
    expect(document.querySelector('.set-well[role=status]')).toHaveTextContent('The local daemon is too old for the notch’s settings: update it.');
    await user.click(sw('Notice when an agent is done'));
    // The IDE has an alert of its own elsewhere (the layouts' hint): the one of the Settings page.
    expect(within(document.querySelector<HTMLElement>('.settings-scroll')!).getByRole('alert')).toHaveTextContent('The local daemon is too old for the notch’s settings: update it.');
    expect(sw('Notice when an agent is done')).toHaveAttribute('aria-checked', 'true');
    expect(setsOf(d)).toHaveLength(0);
    expect(saved()).toEqual([]);
  });

  it('the daemon’s settings are shown as it holds them, and follow its broadcasts (set from elsewhere)', async () => {
    const { d } = await open({ ...DEFAULT_ISLAND_PREFS, position: 'left', shortcut: 'Ctrl Shift Win J' });
    expect(group('Notch position').getByRole('radio', { name: 'Left' })).toBeChecked();
    expect(recorder()).toHaveAccessibleName('Shortcut to reopen a request: Ctrl Shift ⊞ J. Edit');
    act(() => d.push({ type: 'island', prefs: { ...DEFAULT_ISLAND_PREFS, visible: false } }));
    await waitFor(() => expect(sw('Show the notch')).toHaveAttribute('aria-checked', 'false'));
    expect(saved()).toEqual([]);
  });
});

describe('the overview’s footer', () => {
  it('shows the notch’s state once the daemon speaks of it; « Notch hidden » opens Settings › Notch', async () => {
    const { d, user } = await boot({ projects: TWO_PROJECTS });
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.queryByRole('button', { name: /^Notch/ })).toBeNull();
    act(() => d.push({ type: 'island', prefs: null }));
    expect(await footer.findByRole('button', { name: 'Notch active' })).toBeVisible();
    act(() => d.push({ type: 'island', prefs: { ...DEFAULT_ISLAND_PREFS, visible: false } }));
    const hidden = await footer.findByRole('button', { name: 'Notch hidden' });
    expect(hidden).toHaveClass('off');
    await user.click(hidden);
    expect(await screen.findByRole('heading', { level: 1, name: 'Notch' })).toBeVisible();
    expect(nav().getByRole('button', { name: /^Notch/ })).toHaveAttribute('aria-current', 'page');
  });
});

describe('useIslandSave', () => {
  const fleet = (error?: string) => ({ sent: [] as IslandPrefs[], setIsland(next: IslandPrefs) { if (error) throw Object.assign(new Error(error), { name: error }); this.sent.push(next); } });

  it('shows the change while it waits, says it once the broadcast holds it; two quick changes build on each other', () => {
    const f = fleet();
    const said: string[] = [];
    const { result, rerender } = renderHook(({ island }) => useIslandSave(f, island, w => said.push(w)), { initialProps: { island: null as IslandPrefs | null } });
    expect(result.current.shown).toEqual(DEFAULT_ISLAND_PREFS);
    act(() => result.current.send('position', { ...result.current.shown, position: 'left' }, 'left'));
    act(() => result.current.send('islandScale', { ...result.current.shown, islandScale: 1.5 }, 'larger'));
    expect(f.sent.at(-1)).toMatchObject({ position: 'left', islandScale: 1.5 });
    expect(result.current.shown).toMatchObject({ position: 'left', islandScale: 1.5 });
    expect(said).toEqual([]);
    // Both broadcasts reach one render: the second holds the first too.
    rerender({ island: { ...DEFAULT_ISLAND_PREFS, position: 'left', islandScale: 1.5 } });
    expect(said).toEqual(['left', 'larger']);
    expect(result.current.saving).toBe(false);
  });

  it('a refusal names its reason under its key; a silence of UNCONFIRMED_MS is a timeout, and the daemon’s settings come back', () => {
    vi.useFakeTimers();
    for (const [name, reason] of [['DaemonOffline', 'offline'], ['DaemonOutdated', 'outdated'], ['ZodError', 'invalid']] as const) {
      const { result } = renderHook(() => useIslandSave(fleet(name), null, () => {}));
      act(() => result.current.send('say', { ...DEFAULT_ISLAND_PREFS, visible: false }, 'x'));
      expect(result.current.refused).toEqual({ key: 'say', reason });
      expect(result.current.shown).toEqual(DEFAULT_ISLAND_PREFS);
    }
    const said: string[] = [];
    const { result } = renderHook(() => useIslandSave(fleet(), null, w => said.push(w)));
    act(() => result.current.send('visible', { ...DEFAULT_ISLAND_PREFS, visible: false }, 'hidden'));
    expect(result.current.shown.visible).toBe(false);
    act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS); });
    expect(result.current.refused).toEqual({ key: 'visible', reason: 'timeout' });
    expect(result.current.shown.visible).toBe(true);
    expect(said).toEqual([]);
  });

  it('compares the settings whatever their keys’ order', () => {
    const { shows, ...rest } = DEFAULT_ISLAND_PREFS;
    expect(sameIsland(DEFAULT_ISLAND_PREFS, { shows: { helpers: true, say: true, finished: true, quick: true }, ...rest })).toBe(true);
    expect(sameIsland(DEFAULT_ISLAND_PREFS, { ...DEFAULT_ISLAND_PREFS, shows: { ...shows, finished: false } })).toBe(false);
    // The fields retired with the floating island (#27) are never compared: a daemon may hold them or not.
    const { discreet: _d, panelScale: _p, ...current } = DEFAULT_ISLAND_PREFS;
    expect(sameIsland(DEFAULT_ISLAND_PREFS, { ...current, shows: { quick: true, finished: true } })).toBe(true);
  });
});

describe('the shortcut’s keys', () => {
  const ev = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('stores the modifiers in order and the letter by its place on the keyboard; shows them in the language', () => {
    expect(comboOf(ev('€', 'KeyE', { ctrlKey: true, altKey: true }))).toBe('Ctrl Alt E');
    expect(comboOf(ev('!', 'Digit1', { shiftKey: true, metaKey: true, ctrlKey: true }))).toBe('Ctrl Win Shift 1');
    expect(comboOf(ev('F5', 'F5', { altKey: true }))).toBe('Alt F5');
    expect(comboOf(ev(' ', 'Space', { ctrlKey: true }))).toBe('Ctrl Space');
    expect(comboOf(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(shownKeys('Ctrl Win Shift L', { Shift: 'Maj', Win: '⊞' })).toBe('Ctrl ⊞ Maj L');
  });
});
