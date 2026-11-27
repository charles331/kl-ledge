import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { App } from '../src/App';
import { setFallbackLang } from '../src/i18n/lang';

class SilentSocket {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: (() => void) | null = null;
  readyState = 0;
  send() {} close() {} addEventListener() {} removeEventListener() {}
}
/** Desktop writing a key in its own window: the notch hears it as a `storage` event. */
const desktopSets = (key: string, value: string | null) => act(() => {
  if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
});
/** Do not disturb, as the island holds it: nothing opens. */
const quiet = () => (document.querySelector('[data-surface]') as HTMLElement).hasAttribute('data-quiet');

describe('App follows what Desktop decides', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); setFallbackLang('en'); });

  it('takes Desktop’s do-not-disturb, at start and live', () => {
    localStorage.setItem('desktop.dnd', '1');
    render(<App />);
    expect(quiet()).toBe(true);
    desktopSets('desktop.dnd', '0');
    expect(quiet()).toBe(false);
    desktopSets('desktop.dnd', '1');
    expect(quiet()).toBe(true);
  });

  it('speaks Desktop’s language, and follows it; anything else is ignored', () => {
    localStorage.setItem('desktop.lang', 'en');
    render(<App />);
    expect(document.documentElement.lang).toBe('en');
    desktopSets('desktop.lang', 'fr');
    expect(document.documentElement.lang).toBe('fr');
    desktopSets('desktop.lang', 'de');
    expect(document.documentElement.lang).toBe('fr');
  });

});
