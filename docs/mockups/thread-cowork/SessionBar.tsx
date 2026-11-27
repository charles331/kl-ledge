// The session bar, moved into the reply field: under « Cowork » the real SessionBar is drawn inside the slot ./Composer.tsx
// leaves in the field's bottom row. Where there is no field (the Terminal view, a subagent's page, a session offline or read
// only) it stays where it is today, under the session. The build puts this file in the place of Desktop's SessionBar.tsx.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { SessionBar as Real, type SessionBarProps } from '../../../apps/desktop/src/session/SessionBar';
import { getVariant, subscribeVariant } from './variant';

export type { SessionBarProps } from '../../../apps/desktop/src/session/SessionBar';

export function SessionBar(p: SessionBarProps): JSX.Element {
  const cowork = useSyncExternalStore(subscribeVariant, getVariant, getVariant) === 'cowork';
  const here = useRef<HTMLSpanElement>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  // After every render: the field comes and goes with the view and the session's state.
  useLayoutEffect(() => {
    const found = cowork ? here.current?.closest('.session-main')?.querySelector('.cw-bar-slot') ?? null : null;
    if (found !== slot) setSlot(found);
  });
  return <><span ref={here} hidden />{slot ? createPortal(<Real {...p} />, slot) : <Real {...p} />}</>;
}
