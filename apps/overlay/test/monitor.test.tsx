import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { loadMonitor, monitorOfScreen, saveMonitor, resolveMonitor, type MonitorInfo } from '../src/monitor';

import { LangProvider } from '../src/i18n/lang';

const main: MonitorInfo = { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', width: 1920, height: 1080, workH: 1032, primary: true };
const side: MonitorInfo = { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', width: 2560, height: 1440, workH: 1400, primary: false };
const base = { visible: true, theme: 'dark' as const, dnd: false, reduced: false, osReduced: false, onToggleDnd: () => {}, onReduced: () => {}, onBack: () => {}, onClose: () => {}, finished: 'both' as const, sounds: DEFAULT_SOUNDS, onFinished: () => {}, onSounds: () => {}, onTestSound: () => {} };

describe('the Screen setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('is the primary monitor by default and remembers a chosen monitor id', () => {
    expect(loadMonitor()).toBeNull();
    saveMonitor(side.id);
    expect(loadMonitor()).toBe(side.id);
    expect(localStorage.getItem('ledge.monitor')).toBe(side.id);
    saveMonitor(null);
    expect(loadMonitor()).toBeNull();
    expect(localStorage.getItem('ledge.monitor')).toBeNull();
  });

  it('resolves to the chosen monitor while it is listed, else to the primary', () => {
    expect(resolveMonitor(null, [main, side])).toBe(main);
    expect(resolveMonitor(side.id, [main, side])).toBe(side);
    expect(resolveMonitor('\\\\.\\DISPLAY3', [main, side])).toBe(main);
    expect(resolveMonitor(side.id, [])).toBeUndefined();
    // No monitor reports itself primary: the first one stands in.
    expect(resolveMonitor(null, [{ ...side, primary: false }])).toEqual({ ...side, primary: false });
  });

  it('follows Desktop’s Screen setting: the primary, any monitor by its id, an older « second » as the first other one', () => {
    const third: MonitorInfo = { ...side, id: '\\\\.\\DISPLAY3', name: '\\\\.\\DISPLAY3' };
    expect(monitorOfScreen('primary', [main, side, third])).toBeNull();
    expect(monitorOfScreen(third.id, [main, side, third])).toBe(third.id);
    expect(monitorOfScreen(third.id, [])).toBe(third.id); // unplugged or not listed yet: the shell falls back to the primary
    expect(monitorOfScreen('second', [main, side, third])).toBe(side.id);
    expect(monitorOfScreen('second', [main])).toBeNull();
    expect(monitorOfScreen('second', [])).toBeUndefined();
  });

});
