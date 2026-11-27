/**
 * Everything the web app asks of the native shell goes through here. In a plain browser (dev, tests) every call is a
 * no-op or a DOM fallback; under Tauri it talks to the commands and events of Ledge Desktop's notch window (`apps/desktop/src-tauri/src/notch.rs`):
 *   set_frame { left, top, width, height }   the rectangle the page draws, from the work area's corner: the window itself
 *                                      covers the whole work area and only its region follows the frame (clicks pass outside it);
 *                                      0 × 0 is no region at all, while the island rests
 *   list_monitors                      every monitor (logical sizes, work-area height, which one is the primary)
 *   set_monitor { id | null }          the Screen setting: the overlay moves to that monitor at once (null: primary)
 *   focus_overlay                      remember the foreground window, then show and focus the overlay window
 *   release_focus                      give the foreground back to the window remembered by focus_overlay
 *   open_url { url }                   open a web URL in the default browser (the webview never navigates)
 *   daemon_token                       the per-user daemon token read from WSL: { kind: 'token', token } | { kind: 'absent' } | { kind: 'unavailable' }
 *   open_in_ledge { target }           show Ledge Desktop's window on the target (the same process)
 *   foreground_is_terminal             whether Windows Terminal holds the foreground (a sound rule)
 * The tray and its menu are Ledge Desktop's.
 * Coordinates sent to the shell are logical px from the top of the chosen monitor's work area ("monitor px").
 * The page is never zoomed (each layer applies its own UI scale), so its CSS px are monitor px; `setFrame` still
 * takes an optional `zoom` (one CSS px = `zoom` monitor px) and round frames outward here. The shell
 * itself never knows about any zoom.
 */
import { createTokenSource, type TokenRead, type TokenSource } from '@ledge/fleet';
import { resolveMonitor, type MonitorInfo } from '../monitor';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const inTauri = isTauri;

export interface Frame { left: number; top: number; w: number; h: number }

/** The work-area height, in logical (monitor) px, of the monitor the Screen setting `choice` resolves to (`null`: the
 *  primary): the height the surface lays itself out in. */
export async function screenHeight(choice: string | null = null): Promise<number> {
  if (!inTauri()) return window.innerHeight;
  if (choice !== null) {
    const m = resolveMonitor(choice, await listMonitors());
    if (m) return m.workH;
  }
  const { primaryMonitor } = await import('@tauri-apps/api/window');
  const m = await primaryMonitor();
  if (!m) return window.innerHeight;
  const h = m.workArea?.size.height ?? m.size.height;
  return Math.round(h / m.scaleFactor);
}

/** Work-area width in logical monitor pixels, independent of the current overlay window. */
export async function screenWidth(choice: string | null = null): Promise<number> {
  if (!inTauri()) return window.innerWidth;
  if (choice !== null) {
    const m = resolveMonitor(choice, await listMonitors());
    if (m) return m.workW ?? m.width;
  }
  const { primaryMonitor } = await import('@tauri-apps/api/window');
  const m = await primaryMonitor();
  if (!m) return window.innerWidth;
  return Math.round((m.workArea?.size.width ?? m.size.width) / m.scaleFactor);
}

/** The monitors the Screen setting can choose from. In the browser: the viewport, as the one primary monitor. */
export async function listMonitors(): Promise<MonitorInfo[]> {
  if (!inTauri()) return [{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, workW: window.innerWidth, primary: true }];
  try { return await invoke<MonitorInfo[]>('list_monitors'); } catch { return []; }
}

/** Applies the Screen setting: the shell moves the overlay to that monitor at once (`null`: the primary). */
export async function setMonitor(id: string | null): Promise<void> {
  if (!inTauri()) return;
  await invoke('set_monitor', { id }).catch(() => {});
}

// One shared import: the commands are loaded once, not once per call.
let core: Promise<typeof import('@tauri-apps/api/core')> | null = null;
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  core ??= import('@tauri-apps/api/core');
  return (await core).invoke<T>(cmd, args);
};

/** The daemon token this window presents: one source per window, so the client and the notice share the reads. Inside Tauri
 *  it asks the shell (`daemon_token`); in a browser it is `VITE_LEDGE_TOKEN` when set, else none (tokenless, as dev, demo and e2e). */
let tokenSource: TokenSource | undefined;
export function daemonTokenSource(): TokenSource | undefined {
  if (tokenSource) return tokenSource;
  if (isTauri()) return (tokenSource = createTokenSource(() => invoke<TokenRead>('daemon_token')));
  const fixed = (import.meta.env.DEV ? import.meta.env.VITE_LEDGE_TOKEN : undefined) as string | undefined; // dev only: a release build never inlines a token
  if (fixed) return (tokenSource = createTokenSource(async () => ({ kind: 'token', token: fixed })));
  return undefined;
}

/** A frame in CSS px to monitor px under `zoom`: the edges are rounded outward so the window always holds the drawing. */
export function toMonitorFrame(f: Frame, zoom = 1): Frame {
  if (zoom === 1) return f;
  const left = Math.floor(f.left * zoom), top = Math.floor(f.top * zoom);
  return { left, top, w: Math.max(1, Math.ceil((f.left + f.w) * zoom) - left), h: Math.max(1, Math.ceil((f.top + f.h) * zoom) - top) };
}

// Frames are sent one after the other: async commands may otherwise land out of order and leave the
// window at an older frame than the page offset, which is committed with each request.
let lastFrame = '';
let frameChain: Promise<unknown> = Promise.resolve();
/** Moves and sizes the native window to `f` (CSS px) under the UI `zoom`. Resolves true once the shell applied it
 *  (false in the browser or on failure). */
export function setFrame(f: Frame, zoom = 1): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  const m = toMonitorFrame(f, zoom);
  const key = `${m.left}:${m.top}:${m.w}:${m.h}`;
  if (key === lastFrame) return frameChain.then(() => lastFrame === key);
  lastFrame = key;
  const run = frameChain.then(() => invoke('set_frame', { left: m.left, top: m.top, width: m.w, height: m.h })).then(() => true, () => { if (lastFrame === key) lastFrame = ''; return false; });
  frameChain = run;
  return run;
}

/** Gives the overlay OS focus so single-letter keys reach it. Only for keyboard opens: asks never steal focus. */
export async function focusOverlay(): Promise<void> {
  if (!inTauri()) return;
  await invoke('focus_overlay').catch(() => {});
}

/** Hands OS focus back to the window that had it before `focusOverlay` (a keyboard-opened surface folding away). */
export async function releaseFocus(): Promise<void> {
  if (!inTauri()) return;
  await invoke('release_focus').catch(() => {});
}

/** Opens a web URL in the default browser: through the shell in Tauri (the overlay's webview must never navigate
 *  away), a new tab in the browser. Anything but http(s) is ignored. */
export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri()) { void invoke('open_url', { url }).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener');
}

/** Shows Ledge Desktop's window on `target` (the island's JSON); 'browser': outside Tauri, nothing to show. */
export async function openDesktop(target: string): Promise<'ok' | 'failed' | 'browser'> {
  if (!inTauri()) return 'browser';
  return invoke('open_in_ledge', { target }).then(() => 'ok' as const, () => 'failed' as const);
}

/** Whether Windows Terminal is the foreground window (the "only when the terminal is behind" sound rule). False outside Tauri. */
export async function foregroundIsTerminal(): Promise<boolean> {
  if (!inTauri()) return false;
  return invoke<boolean>('foreground_is_terminal').catch(() => false);
}

let shortcutPlugin: Promise<typeof import('@tauri-apps/plugin-global-shortcut')> | null = null;
/** Ctrl+Alt+<key>: a global shortcut under Tauri, a window key binding in the browser. */
function globalShortcut(key: string, fn: () => void): () => void {
  if (!inTauri()) { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === key) fn(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }
  const accel = `Ctrl+Alt+${key.toUpperCase()}`;
  let off = () => {}; let disposed = false;
  shortcutPlugin ??= import('@tauri-apps/plugin-global-shortcut');
  shortcutPlugin.then(async ({ register, unregister }) => {
    await register(accel, e => { if (e.state === 'Pressed') fn(); });
    off = () => { unregister(accel).catch(() => {}); };
    if (disposed) off();
  }).catch(() => {});
  return () => { disposed = true; off(); };
}

/** Ctrl+Alt+L: open or fold the list from the keyboard. */
export const onShortcut = (fn: () => void) => globalShortcut('l', fn);
/** Ctrl+Alt+N: ask Ledge Desktop for a new session. The island no longer has the form. */
export const onNewSessionShortcut = (fn: () => void) => globalShortcut('n', fn);

/** Quits Ledge: the notch and Desktop are one process. A no-op in the browser and in tests. */
export async function quitApp(): Promise<void> {
  if (!inTauri()) return;
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
}
