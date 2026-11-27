import { describe, it, expect } from 'vitest';
import { DEFAULT_ISLAND_PREFS, IslandPrefsSchema, parseClientMessage } from '../src/index.js';

describe('island settings after the floating island (#27)', () => {
  const { discreet: _gone, ...current } = DEFAULT_ISLAND_PREFS;

  it('read a settings file saved before #27, its discreet choice included', () => {
    expect(IslandPrefsSchema.safeParse({ ...current, discreet: false }).success).toBe(true);
  });

  it('read settings without discreet, as a front after #27 may send them', () => {
    expect(IslandPrefsSchema.safeParse(current).success).toBe(true);
    expect(parseClientMessage({ type: 'island.set', prefs: current }).type).toBe('island.set');
  });

  it('still write discreet by default, which a daemon before #27 requires in island.set', () => {
    expect(DEFAULT_ISLAND_PREFS.discreet).toBe(true);
  });
});
