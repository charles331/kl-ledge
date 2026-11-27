import { useEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger rests on a seat or a row before its actions open (m2-sessions.html §8). */
export const LONG_PRESS_MS = 500;
const SLOP = 10;

/**
 * A long press (§8): after LONG_PRESS_MS without moving, a light haptic tap and `onLong`; the click that follows the finger's
 * lift is then swallowed, so the seat does not also open its thread. A browser's own context menu (a right click, Android's long
 * press) opens the same actions.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const fire = () => {
    clear();
    fired.current = true;
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    onLong();
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      // The main button or a finger only; a right click goes through `contextmenu`.
      if (e.button > 0) return;
      fired.current = false;
      from.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const f = from.current;
      if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) > SLOP) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); if (!fired.current) fire(); },
    onClickCapture: (e: MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  };
}

/**
 * Issue #16 (docs/mockups/ledge-reorder.html, card 6, 4A): a long press lifts the row (a light haptic tap); moved past 10 px it is
 * dragged, the page no longer scrolls, and lifting the finger drops it; lifted and let go without moving, the row's actions open
 * as before (`onLong`). A right click or a browser's own long press opens the actions too.
 */
export function useLiftDrag(o: { onLong(): void; onLift?(y: number): void; onDrag?(y: number): void; onDrop?(): void; onCancel?(): void }) {
  const latest = useRef(o);
  latest.current = o;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const phase = useRef<'idle' | 'pressing' | 'lifted' | 'dragging'>('idle');
  const fired = useRef(false);
  const detach = useRef<(() => void) | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const end = () => { clear(); detach.current?.(); detach.current = null; phase.current = 'idle'; };
  useEffect(() => () => end(), []);
  // Lifted, the finger is the row's: its moves drag, the page does not scroll, its lift drops or opens the actions.
  const hold = () => {
    const block = (e: TouchEvent) => { if (phase.current === 'lifted' || phase.current === 'dragging') e.preventDefault(); };
    const move = (e: PointerEvent | globalThis.PointerEvent) => {
      const f = from.current;
      if (!f) return;
      if (phase.current === 'lifted' && Math.hypot(e.clientX - f.x, e.clientY - f.y) > SLOP) phase.current = 'dragging';
      if (phase.current === 'dragging') latest.current.onDrag?.(e.clientY);
    };
    const up = () => {
      const was = phase.current;
      end();
      if (was === 'dragging') latest.current.onDrop?.();
      else if (was === 'lifted') latest.current.onLong();
    };
    const cancel = () => { const was = phase.current; end(); if (was === 'dragging' || was === 'lifted') latest.current.onCancel?.(); };
    document.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    detach.current = () => {
      document.removeEventListener('touchmove', block);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  };
  const lift = () => {
    clear();
    fired.current = true;
    phase.current = 'lifted';
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    latest.current.onLift?.(from.current?.y ?? 0);
    hold();
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button > 0) return;
      fired.current = false;
      from.current = { x: e.clientX, y: e.clientY };
      clear();
      phase.current = 'pressing';
      timer.current = setTimeout(lift, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      // Before the lift, a move is a scroll: no press.
      const f = from.current;
      if (phase.current === 'pressing' && f && Math.hypot(e.clientX - f.x, e.clientY - f.y) > SLOP) { clear(); phase.current = 'idle'; }
    },
    onPointerUp: () => { if (phase.current === 'pressing') { clear(); phase.current = 'idle'; } },
    onPointerCancel: () => { if (phase.current === 'pressing') { clear(); phase.current = 'idle'; } },
    // A link or an image would start the browser's own drag, which cancels the pointer: the row is moved by this hook only.
    onDragStart: (e: DragEvent) => { e.preventDefault(); },
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); if (!fired.current && phase.current !== 'lifted' && phase.current !== 'dragging') { clear(); phase.current = 'idle'; fired.current = true; latest.current.onLong(); } },
    onClickCapture: (e: MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  };
}
