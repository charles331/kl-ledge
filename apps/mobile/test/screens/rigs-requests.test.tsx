// #40 D1 (docs/mockups/ledge-remove-chat-d1-d3-d6.html, card 3): what OpenRig asks the person heads the Rigs tab, in a « Demandes »
// block with the cards « À toi » had; it folds and unfolds again on a new ask; on a wide screen its rows open each ask beside it;
// a PC that does not send its rigs yet still shows it (design-ux 17:23Z); an ask opened from its push goes back to Rigs.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanAsk, PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { forgetTabs } from '../../src/shell/tabs';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on && !q.includes('pointer'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };
afterEach(() => { wide(false); localStorage.clear(); forgetTabs(); });

const ask = (id: string, extra: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: null }, summary: `Fusionner ${id} ?`, body: '',
  bodyTruncated: false, detail: null, evidenceRef: null, createdAt: '2026-11-27T16:41:00Z', updatedAt: '2026-11-27T16:41:00Z',
  questions: [{ id: 'q', question: `Fusionner ${id} ?`, options: [{ id: 'yes', label: 'Fusionner', recommended: true }, { id: 'wait', label: 'Attendre', recommended: false }], answer: null }], ...extra
});
const withOpenRig = (m: PhoneServerMessage, rigs = false) => ({ ...m, daemon: { ...(m as { daemon: object }).daemon, openrig: true, ...(rigs ? { rigs: true } : {}) } }) as PhoneServerMessage;
const asks = (list: HumanAsk[]) => ({ type: 'openrig.asks', channel: { state: 'ready', person: null, slack: false }, asks: list }) as PhoneServerMessage;
const block = () => screen.getByRole('region', { name: copy.rigs.requests });

describe('the Rigs tab\'s « Demandes » (#40 D1)', () => {
  it('heads the tab with the asks as cards, the urgent first, a news item not counted', () => {
    const t = app('ready', { hash: '#/rigs' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([ask('#37'), ask('#36', { priority: 'urgent', updatedAt: '2026-11-27T16:30:00Z' })])));
    expect(within(block()).getByRole('heading', { level: 2 })).toHaveTextContent(`${copy.rigs.requests} 2`);
    const cards = within(block()).getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Fusionner #36 ?');
    expect(within(cards[0]!).getByRole('button', { name: /Fusionner/ })).toBeInTheDocument();
  });

  it('folds, and unfolds again when a new ask comes', () => {
    const t = app('ready', { hash: '#/rigs' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([ask('#36')])));
    fireEvent.click(within(block()).getByRole('button', { name: copy.rigs.fold }));
    expect(within(block()).queryAllByRole('article')).toHaveLength(0);
    expect(within(block()).getByRole('button', { name: copy.rigs.unfold })).toHaveAttribute('aria-expanded', 'false');
    act(() => t.deliver(asks([ask('#36'), ask('#37')])));
    expect(within(block()).getAllByRole('article')).toHaveLength(2);
  });

  it('is not there with nothing asked on a ready channel', () => {
    const t = app('ready', { hash: '#/rigs' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([])));
    expect(screen.queryByRole('region', { name: copy.rigs.requests })).toBeNull();
  });

  it('shows above the « not sent yet » state of a PC that does not send its rigs (design-ux 17:23Z)', () => {
    const t = app('ready', { hash: '#/rigs' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([ask('#36')])));
    expect(within(block()).getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(copy.rigs.notSentBody)).toBeInTheDocument();
    expect(block().compareDocumentPosition(screen.getByText(copy.rigs.notSentBody)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('on a wide screen, lists the asks as rows that open each one beside the list', async () => {
    wide(true);
    const t = app('ready', { hash: '#/rigs' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([ask('#36')])));
    const row = within(block()).getByRole('link', { name: /pilot-lead/ });
    expect(row).toHaveAttribute('href', '#/ask/%2336');
    act(() => { globalThis.location.hash = '#/ask/%2336'; });
    await waitFor(() => expect(document.querySelector('[data-route]')).toHaveAttribute('data-route', 'ask'));
    // The list stays on the left, under the Rigs tab.
    expect(screen.getByRole('region', { name: copy.rigs.requests })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: copy.nav.label })).getByRole('link', { name: new RegExp(`^${copy.nav.rigs}`) })).toHaveAttribute('aria-current', 'page');
  });

  it('an ask opened from its push shows alone, the Rigs tab lit, and « Retour » leads to Rigs (card 3)', () => {
    const t = app('ready', { hash: '#/ask/%2336' });
    act(() => t.deliver(withOpenRig(snapshot([], 'PC-Desan'))));
    act(() => t.deliver(asks([ask('#36')])));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(within(screen.getByRole('navigation', { name: copy.nav.label })).getByRole('link', { name: new RegExp(`^${copy.nav.rigs}`) })).toHaveAttribute('aria-current', 'page');
    // « Retour »: the screen before it, else Rigs.
    expect(document.querySelector('a[data-back]')).toHaveAttribute('data-back', 'rigs');
  });
});
