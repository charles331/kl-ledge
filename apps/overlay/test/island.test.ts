import { describe, it, expect, beforeEach } from 'vitest';
import { loadIslandPosition, saveIslandPosition } from '../src/island';

describe('island settings', () => {
  beforeEach(() => localStorage.clear());
  it('position: centre by default, remembered, invalid values fall back', () => {
    expect(loadIslandPosition()).toBe('center');
    saveIslandPosition('right');
    expect(localStorage.getItem('ledge.islandPosition')).toBe('right');
    expect(loadIslandPosition()).toBe('right');
    localStorage.setItem('ledge.islandPosition', 'top');
    expect(loadIslandPosition()).toBe('center');
  });
});
