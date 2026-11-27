import type { JSX } from 'react';
import { cls } from '../shell/cls';
import type { WaitCause } from './waiting';

/** What the agent is doing, drawn (docs/mockups/ledge-operator-rigs-panel.html, « Quand l'agent travaille : le dessin suit l'action »,
 *  validated by the owner: « Selon ce qu'il fait »). */
export type WorkDrawingKind = 'read' | 'write' | 'search' | 'run';

/** The drawing for the waiting line's cause: its last action's verb (it reads a page, writes lines, searches with a lens, runs a
 *  command). None while no action is behind the wait (the agent thinks, was just asked, hears from a helper…: WaitLine shows the
 *  phrase alone) nor for a failed one (the ring stays). */
export function drawingOf(c: WaitCause): WorkDrawingKind | null {
  if (c.kind !== 'tool' || c.failed) return null;
  switch (c.verb) {
    case 'read': return 'read';
    case 'edit': return 'write';
    case 'search': return 'search';
    case 'command': return 'run';
  }
}

/** The mockup's drawings, its strokes and timings as they are, in the Atelier's coral; `still` (the app's « reduce motion ») stops
 *  them, as the stylesheet does for the system's. */
export function WorkDrawing({ kind, still }: { kind: WorkDrawingKind; still: boolean }): JSX.Element {
  return (
    <svg className={cls('work-draw', still && 'still')} data-drawing={kind} viewBox="0 0 18 18" aria-hidden="true">
      {kind === 'read' ? <><rect x="4" y="2.5" width="10" height="13" rx="1.8" /><path className="wd-scan" d="M6.5 6h5" /></>
        : kind === 'write' ? <g className="wd-write"><path d="M3 5h8" /><path d="M3 9h8" /><path d="M3 13h8" /></g>
        : kind === 'search' ? <g className="wd-seek"><circle cx="8" cy="8" r="4" /><path d="m11 11 3.5 3.5" /></g>
        : <><path d="m3 5.5 4 3.5-4 3.5" /><path className="wd-caret" d="M9.5 13h5.5" /></>}
    </svg>
  );
}
