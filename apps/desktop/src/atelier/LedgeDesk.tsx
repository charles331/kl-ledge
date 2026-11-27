import type { JSX } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';

/** Ledge in the atelier's top-left corner (observatory.tsx, `ledge-corner`), on the ledge of its own logo. Its bubble counts the
 *  agents it watches over; while OpenRig's requests wait, it gives their number, and a click opens the Rigs view on them (#40,
 *  docs/mockups/ledge-remove-chat-d1-d3-d6.html, last card and question 3). Without a request it opens nothing. */
export function LedgeDesk({ count, requests, paused, onRequests }: { count: number; requests: number; paused: boolean; onRequests: () => void }): JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const body = (
    <>
      <span className="ledge-bubble">{requests > 0 ? t.side.rigAsks(requests) : t.atelier.watching(count)}</span>
      <span className="ledge-seat"><ResidentMascot size={80} theme={theme} paused={paused} reducedMotion={reduced} /></span>
      <strong>Ledge</strong><small>{t.atelier.assistant}</small>
    </>
  );
  return (
    <div className="ledge-corner">
      {requests > 0
        ? <button type="button" className="ledge-desk asks" onClick={onRequests}>{body}</button>
        : <div className="ledge-desk">{body}</div>}
    </div>
  );
}
