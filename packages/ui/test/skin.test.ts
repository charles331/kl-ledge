// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applySkin, hexToOklch, oklchToHex, PALETTES, skinLadder, skinTokens, type Ladder } from '../src/skin';
import { accentTokens } from '../src/accent';

/** What Chromium computes for the mockup's own CSS (docs/mockups/ide-atelier/atelier.css, `oklch(from …)`), palette « Établi ». */
const CHROMIUM: Record<'dark' | 'light', Record<keyof Ladder, [number, number, number]>> = {
  dark: {
    pane: [0.241177, 0.0087483, 75.1269], side: [0.223177, 0.0087483, 75.1269], well: [0.201177, 0.0087483, 75.1269],
    bench: [0.173177, 0.00787347, 75.1269], card: [0.281177, 0.0087483, 75.1269], raise: [0.316177, 0.0087483, 75.1269],
    field: [0.201177, 0.0087483, 75.1269], ink: [0.95, 0.0118735, 75.1269], ink2: [0.69, 0.0127483, 75.1269],
    line: [0.95, 0.0118735, 75.1269], line2: [0.95, 0.0118735, 75.1269]
  },
  light: {
    pane: [0.977558, 0.0090622, 78.0309], side: [0.952558, 0.0090622, 78.0309], well: [0.942558, 0.0090622, 78.0309],
    bench: [0.897558, 0.00996841, 78.0309], card: [0.997558, 0.0045311, 78.0309], raise: [0.922558, 0.0090622, 78.0309],
    field: [0.997558, 0.0045311, 78.0309], ink: [0.24, 0.0210622, 78.0309], ink2: [0.52, 0.0210622, 78.0309],
    line: [0.24, 0.0210622, 78.0309], line2: [0.24, 0.0210622, 78.0309]
  }
};

describe('the Atelier ladder', () => {
  it('round-trips a colour through OKLCH', () => {
    for (const hex of ['#221f1b', '#fbf7f1', '#f27a63', '#000000', '#ffffff']) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });
  for (const theme of ['dark', 'light'] as const) {
    it(`matches what the mockup's CSS gives in Chromium (${theme})`, () => {
      const ladder = skinLadder(PALETTES[0]![theme].base, theme);
      for (const [role, [l, c, h]] of Object.entries(CHROMIUM[theme]) as [keyof Ladder, [number, number, number]][]) {
        const [L, C, H] = hexToOklch(ladder[role].slice(0, 7));
        expect(Math.abs(L - l), `${role} lightness`).toBeLessThan(0.006);
        expect(Math.abs(C - c), `${role} chroma`).toBeLessThan(0.006);
        if (c > 0.005) expect(Math.abs(H - h), `${role} hue`).toBeLessThan(12);
      }
      expect(ladder.line.slice(7)).toBe(theme === 'dark' ? '17' : '1c'); // 9 % and 11 % of the ink
      expect(ladder.line2.slice(7)).toBe(theme === 'dark' ? '2b' : '33');
    });
  }
  it('caps a vivid background\'s chroma so the screen stays usable', () => {
    const [, c] = hexToOklch(skinLadder('#ff00aa', 'dark').pane);
    expect(c).toBeLessThan(0.045);
  });
  it('keeps the order of the surfaces in each theme', () => {
    const L = (theme: 'dark' | 'light') => { const s = skinLadder(PALETTES[0]![theme].base, theme); return (k: keyof Ladder) => hexToOklch(s[k])[0]; };
    const d = L('dark');
    expect(d('bench')).toBeLessThan(d('well')); expect(d('well')).toBeLessThan(d('side')); expect(d('side')).toBeLessThan(d('pane'));
    expect(d('pane')).toBeLessThan(d('card')); expect(d('card')).toBeLessThan(d('raise'));
    const l = L('light');
    expect(l('bench')).toBeLessThan(l('raise')); expect(l('raise')).toBeLessThan(l('well')); expect(l('well')).toBeLessThan(l('side'));
    expect(l('side')).toBeLessThan(l('pane')); expect(l('pane')).toBeLessThan(l('card'));
  });
});

describe('the skin\'s tokens', () => {
  it('one coral for the primary button, the sidebar\'s and the tab in front; its ink dark on dark, white on light', () => {
    const dark = skinTokens({ theme: 'dark' });
    expect(dark['--primary']).toBe('#f27a63');
    expect(dark['--sidebar-primary']).toBe('#f27a63');
    expect(dark['--ide-tab-front']).toBe('#f27a63');
    expect(hexToOklch(dark['--primary-foreground']!)[0]).toBeCloseTo(0.2, 2);
    expect(skinTokens({ theme: 'light' })['--primary-foreground']).toBe('#ffffff');
    expect(dark['--term-bg']).toBe(dark['--well']);
    expect(dark['--radius-lg']).toBe('12px');
  });
  it('an accent chosen in Settings wins over the palette\'s coral', () => {
    const t = skinTokens({ theme: 'dark', accent: '#3366ff' });
    expect(t['--primary']).toBe(accentTokens('#3366ff', 'dark').sidebarPrimary);
    expect(t['--at-coral']).toBe(t['--primary']);
  });
  it('applySkin paints the root and takes it all back off', () => {
    const el = document.createElement('div');
    applySkin({ theme: 'light' }, el);
    expect(el.dataset.skin).toBe('atelier');
    expect(el.style.getPropertyValue('--at-bench')).toBe(skinTokens({ theme: 'light' })['--at-bench']);
    applySkin(null, el);
    expect(el.dataset.skin).toBeUndefined();
    expect(el.getAttribute('style') ?? '').toBe('');
  });
});
