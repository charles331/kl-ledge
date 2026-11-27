import { describe, it, expect } from 'vitest';
import { DEFAULT_ISLAND_PREFS, IslandPrefsSchema, parseClientMessage } from '../src/index.js';

describe('island settings after the floating island (#27)', () => {
  const { discreet: _discreet, panelScale: _panelScale, ...rest } = DEFAULT_ISLAND_PREFS;
  const current = { ...rest, shows: { quick: true, finished: true } };

  it('read a settings file saved before #27, its discreet, window size, words and subagents included', () => {
    expect(IslandPrefsSchema.safeParse({ ...current, discreet: false, panelScale: 2, shows: { quick: true, finished: true, say: false, helpers: false } }).success).toBe(true);
  });

  it('read settings without them, as a front after #27 may send them', () => {
    expect(IslandPrefsSchema.safeParse(current).success).toBe(true);
    expect(parseClientMessage({ type: 'island.set', prefs: current }).type).toBe('island.set');
  });

  it('still write them by default, which a daemon before #27 requires in island.set', () => {
    expect(DEFAULT_ISLAND_PREFS).toMatchObject({ discreet: true, panelScale: 'auto', shows: { say: true, helpers: true } });
  });
});
