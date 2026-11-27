import { describe, expect, it } from 'vitest';
import { cardOf } from '../src/surface/Surface';
import type { Item } from '../src/surface/machine';
import { fakeSession } from './mockDaemon';

// docs/mockups/ledge-sidebar-names.html, card 2: a session's nickname shows before its name, on the island too.
describe('the island names a session by its nickname', () => {
  it('« KB Projet 1 (Otto) » with a nickname, « Otto » without', () => {
    const done: Item = { kind: 'finished', id: 'a' };
    expect(cardOf(done, fakeSession('a', { name: 'Otto', label: 'KB Projet 1', lastReply: { text: 'Fini.', at: '2026-11-27T09:00:00.000Z' } }))?.who).toBe('KB Projet 1 (Otto)');
    expect(cardOf(done, fakeSession('a', { name: 'Otto', lastReply: { text: 'Fini.', at: '2026-11-27T09:00:00.000Z' } }))?.who).toBe('Otto');
  });
});
