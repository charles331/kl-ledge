import type { JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';

/** The mockup's Routines glyphs (`I.alarm`, `I.clock`, `I.open`, `I.calendar`), on the app's 24 px line grid. */
export const ROUTINE_ICONS = {
  alarm: ['M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M12 9v4l2.5 1.5', 'M5 3 2 6', 'm19 3 3 3'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4']
} as const;

/** The réveil: the activity bar's entry, a routine's tab and page head. */
export function AlarmIcon({ size = 16 }: { size?: number }): JSX.Element {
  return <Icon d={ROUTINE_ICONS.alarm} size={size} />;
}

/** A routine's tab (mockup `tabs`): the réveil, an amber « • » while its page has unsaved changes, its name. */
export function RoutineTabLabel({ title, dirty }: { title: string; dirty: boolean }): JSX.Element {
  return <span className="rt-tab"><AlarmIcon size={13} />{dirty && <span className="rt-dirty" aria-hidden="true">•</span>}<span className="tab-name">{title}</span></span>;
}
