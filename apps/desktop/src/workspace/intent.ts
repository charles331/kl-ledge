import { keyOf, open, pin, type Tab, type Where, type Workspace } from './model';

/**
 * How the click being handled asks for a tab (docs/superpowers/specs/2026-11-26-preview-tabs-design.md §5.2–§5.4).
 *
 * The places whose lines open previews (the explorer, the activity bar, the status bar, a tab's content) note each click in
 * the capture phase, before any handler runs: a single click (or `Enter` on a focused line) asks for a preview, the second
 * click of a double click for a kept tab. A click inside a tab also names that tab (`from`): opening another tab from it
 * keeps it. Every other way of opening a tab (the context menu, the palette, a dialog, a shortcut, code) notes nothing and
 * opens a kept tab, as before. The note lasts for the event only.
 */
export interface Intent { preview: boolean; from?: string }

let current: Intent | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Clicks that never ask for a preview, even where lines do: a menu (« Ouvrir », « Ouvrir à droite » open kept tabs) and
 *  any control marked `data-keep` (« Nouvelle routine »). */
const KEPT = '[role="menu"], [role="menuitem"], [data-keep]';

function set(i: Intent | null): void {
  current = i;
  clearTimeout(timer);
  // Cleared after the event: a tab opened later (a reply's promise, a timer) is a kept one.
  if (i) timer = setTimeout(() => { current = null; }, 0);
}

/** Notes a click in a place whose lines open previews; `from`: the tab whose content was clicked. */
export function noteClick(e: { detail: number; target: EventTarget | null }, from?: string): void {
  const el = e.target instanceof Element ? e.target : null;
  set(el?.closest(KEPT) ? null : { preview: e.detail < 2, ...(from ? { from } : {}) });
}

/** The click being handled, if one was noted. */
export const clickIntent = (): Intent | null => current;

/** Runs `fn` as a single click would: the island's and the notifications' « Voir » open previews (§5.2). */
export function asPreview<T>(fn: () => T): T {
  const was = current;
  current = { preview: true };
  try { return fn(); } finally { current = was; }
}

/** `open` as the click asks: a preview or a kept tab, the clicked tab kept first when another one opens from it (§5.4). */
export function openAs(w: Workspace, tab: Tab, where: Where = 'active', how: Intent | null = current): Workspace {
  const base = how?.from && how.from !== keyOf(tab) ? pin(w, how.from) : w;
  return open(base, tab, where, how?.preview ? { preview: true } : {});
}

/** Whether a keystroke is typing into a field of a tab (a composer, a form, a terminal's input): what keeps a preview
 *  (§5.4). Moving, shortcuts with Ctrl, Alt or ⌘, and keys outside a field are not typing. */
export function typing(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Enter') return false;
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return el.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

/** Tabs whose buttons act (a PR, a rig, the OpenRig page, a routine, Réglages): any of them pressed keeps a preview (§5.4),
 *  except what only looks: a sub-view, a section, something unfolded, a line chosen in a list, a link. */
export const ACTING_KINDS: ReadonlySet<Tab['kind']> = new Set(['pr', 'rig', 'openrig', 'routine', 'settings']);
const LOOKS = 'nav, [role="tab"], [role="option"], [aria-expanded], [data-look], a';
export function acts(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  const control = el?.closest('button, input, select, textarea, [role="switch"], [role="checkbox"], [role="radio"]');
  return !!control && !control.closest(LOOKS);
}
