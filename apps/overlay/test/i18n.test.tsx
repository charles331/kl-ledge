import { describe, it, expect, afterEach } from 'vitest';
import { MESSAGES } from '../src/i18n/messages';
import { loadLang, saveLang, setFallbackLang } from '../src/i18n/lang';

/** Every key path of a dictionary, functions and arrays as leaves. */
const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

afterEach(() => { localStorage.removeItem('desktop.lang'); setFallbackLang('en'); });

describe('message catalogue', () => {
  it('French and English have the same keys', () => {
    expect(keys(MESSAGES.fr).sort()).toEqual(keys(MESSAGES.en).sort());
  });
  it('French is the default; the stored language wins; garbage falls back', () => {
    setFallbackLang('fr');
    expect(loadLang()).toBe('fr');
    saveLang('en'); expect(loadLang()).toBe('en');
    localStorage.setItem('desktop.lang', 'de'); expect(loadLang()).toBe('fr');
  });
  it('plurals are explicit', () => {
    expect(MESSAGES.fr.island.more(1)).toBe('+1 autre');
    expect(MESSAGES.fr.island.more(2)).toBe('+2 autres');
    expect(MESSAGES.en.island.more(2)).toBe('+2 more');
  });
  it('the island says « tu » (the owner’s choice for #27)', () => {
    const fr = JSON.stringify(MESSAGES.fr) + Object.values(MESSAGES.fr.island).filter(v => typeof v === 'function').map(f => (f as (x: string) => string)('x')).join(' ');
    expect(fr).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
    expect(MESSAGES.fr.island.badge.permission).toBe('Ton accord');
    expect(MESSAGES.fr.island.say.question).toBe('te pose une question');
    expect(MESSAGES.fr.readOnlyBlocked).toBe('Lecture seule : lancée sans Ledge, réponds dans son terminal');
    expect(MESSAGES.fr.island.failed('Refusé')).toBe('Refusé. Réessaie ou ouvre la session.');
  });
});
