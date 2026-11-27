import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true, sessionLabel: true };
const renames = (d: MockDaemon) => d.received.filter(m => m.type === 'session.label' || m.type === 'session.rename');
/** The sidebar's rename field (docs/mockups/ledge-sidebar-names.html, card 2), where F2 lands from anywhere. */
const renameField = () => screen.queryByRole('textbox', { name: /^Nickname for/ });
/** The session shown in the front tab's page. */
const shown = () => document.querySelector<HTMLElement>('.session-page')?.dataset.session;
/** A dock tab of the IDE, by its name. */
const dvTab = (name: string) => screen.getAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === name)!;

async function open(name: string, id: string) {
  const env = await boot({ sessions: listSessions(), list: true, daemon: CAN });
  await env.user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
  await waitFor(() => expect(shown()).toBe(`local:${id}`));
  return env;
}

/** F2 where it lands as the user presses it: on the element that has the focus (the window's listener sees it bubble). */
function pressF2(on: Element = document.activeElement ?? document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true, cancelable: true });
  on.dispatchEvent(e);
  return e;
}

describe('F2 on a session page renames that session (#17)', () => {
  it('the page has the focus: F2 opens its nickname as a field in the sidebar, as its menu\'s « Rename F2 »', async () => {
    const { d, user } = await open('Otto', 'otto');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(pressF2(document.body).defaultPrevented).toBe(true);
    const field = await waitFor(() => screen.getByRole('textbox', { name: 'Nickname for Otto' }));
    expect(field.closest('[role=tree]')).not.toBeNull();
    await user.keyboard('Revue{Enter}');
    await waitFor(() => expect(renames(d)).toEqual([{ type: 'session.label', id: 'otto', label: 'Revue' }]));
    expect(renameField()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('in the composer (the reply field), F2 does nothing', async () => {
    const { d } = await open('Otto', 'otto');
    const reply = screen.getByRole('textbox', { name: 'Reply to the agent' });
    reply.focus();
    expect(pressF2(reply).defaultPrevented).toBe(false);
    expect(renameField()).toBeNull();
    expect(renames(d)).toEqual([]);
  });

  it('in a text field of the page, F2 does nothing', async () => {
    const { d } = await open('Otto', 'otto');
    const field = document.createElement('input');
    document.querySelector('.session-page')!.append(field);
    field.focus();
    expect(pressF2(field).defaultPrevented).toBe(false);
    expect(renameField()).toBeNull();
    expect(renames(d)).toEqual([]);
  });

  it('in the terminal, F2 is left as it is for the agent: not taken, no dialog', async () => {
    const { d, user } = await open('Otto', 'otto');
    fireEvent.contextMenu(dvTab('Otto'));
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Switch to the terminal/ }));
    const region = await screen.findByRole('region', { name: 'Terminal' });
    // The xterm's host (term/surface.ts marks it data-terminal) and its hidden textarea, where the keys land.
    let host = region.querySelector<HTMLElement>('[data-terminal]');
    if (!host) { host = document.createElement('div'); host.setAttribute('data-terminal', ''); region.append(host); }
    const input = document.createElement('textarea');
    host.append(input);
    input.focus();
    expect(pressF2(input).defaultPrevented).toBe(false);
    expect(renameField()).toBeNull();
    expect(renames(d)).toEqual([]);
  });

  it('a finished session\'s page: F2 opens nothing (its menu greys Rename)', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true, daemon: CAN });
    await user.click(screen.getByRole('button', { name: '+1 finished' }));
    await user.click(screen.getByRole('button', { name: /^Bix,/ }));
    await waitFor(() => expect(shown()).toBe('local:bix'));
    (document.activeElement as HTMLElement | null)?.blur();
    pressF2(document.body);
    expect(renameField()).toBeNull();
    expect(renames(d)).toEqual([]);
  });
});
