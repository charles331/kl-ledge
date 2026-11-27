import { useEffect, useSyncExternalStore } from 'react';
import { applyAccent, loadAccent, parseAccent, saveAccent } from '@ledge/ui/accent';
import { applySkin } from '@ledge/ui/skin';

const KEY = 'desktop.theme';
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export function loadTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

// One store for the theme and the accent: the settings change them, every mascot and the root follow at once (lot 7).
let theme = loadTheme();
let accent = loadAccent('desktop');
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setTheme(next: Theme): void {
  theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
/** `null` goes back to the factory coral and removes `desktop.accent`; anything but #rrggbb is ignored. */
export function setAccent(hex: string | null): void {
  const parsed = hex === null ? null : parseAccent(hex);
  if (hex !== null && parsed === null) return;
  saveAccent(parsed, 'desktop');
  accent = parsed;
  emit();
}

/** The Desktop theme (`desktop.theme`, dark by default). */
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => theme, () => theme); }
/** The chosen accent (`desktop.accent`), null for the factory coral. */
export function useAccent(): string | null { return useSyncExternalStore(subscribe, () => accent, () => accent); }
/** Issue #28: the « Atelier » skin replaces the IDE's former look (the owner's choice pending: on by default, one palette,
 *  « Établi »). `false` gives back today's look, tokens.css alone. */
export const SKIN_ON = true;
/** Whether the IDE wears the « Atelier » skin (a few components draw differently under it, the explorer's waiting tag). */
export function useSkin(): boolean { return SKIN_ON; }
/** Mounted once by the App: mirrors the theme on the root element for the shared tokens and paints the accent for it, then the
 *  skin's tokens (@ledge/ui/skin), which fold the accent in. */
export function useAppearance(): void {
  const t = useTheme(); const a = useAccent();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = t;
    if (SKIN_ON) { applyAccent(a, t); applySkin({ theme: t, accent: a }, root); } else { applySkin(null, root); applyAccent(a, t); }
  }, [t, a]);
}
/** Test hook: the next read reloads from storage. */
export function resetAppearanceForTests(): void { theme = loadTheme(); accent = loadAccent('desktop'); emit(); }
