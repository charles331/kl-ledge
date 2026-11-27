// The reply field's bottom row, as chat applications draw it: on the left what the session bar said under the field (the model,
// the context, the branch, the changes: the real SessionBar, moved here by ./SessionBar.tsx), on the right the voice and one round button that sends, or interrupts the agent while it works and nothing is typed.
// An aside is no button: « /btw » and a question typed in the field, as in the harness. The row then says what Enter will do.
// The build adds it at the end of Reply.tsx's form.
import { useSyncExternalStore, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { cls } from '../../../apps/desktop/src/shell/cls';
import { modeOf, subscribeComposer, toggleMode, type Mode } from './composer';
import { getVariant, subscribeVariant } from './variant';

const MIC = ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'];

/** The mode of a session's reply field: a dictation, or none. Reply.tsx reads it for its placeholder. */
export function useComposerMode(id: string): Mode {
  const cowork = useSyncExternalStore(subscribeVariant, getVariant, getVariant) === 'cowork';
  const mode = useSyncExternalStore(subscribeComposer, () => modeOf(id), () => modeOf(id));
  return cowork ? mode : null;
}

export function Composer({ client, session, filled, shut, btw }: { client?: DaemonClient; session: Session; filled: boolean; shut: boolean; btw: boolean }): JSX.Element | null {
  const cowork = useSyncExternalStore(subscribeVariant, getVariant, getVariant) === 'cowork';
  const mode = useComposerMode(session.id);
  if (!cowork) return null;
  const working = session.state === 'working' && session.offline !== true;
  const stops = working && !filled;
  return (
    <div className={cls('cw-tools', btw && 'btw')}>
      <span className="cw-bar-slot" />
      {btw && <span className="cw-btw-note"><b>btw</b>En aparté : {session.name} répond sans s'interrompre, hors du fil</span>}
      <button type="button" className={cls('cw-mic', mode === 'voice' && 'on')} aria-pressed={mode === 'voice'} disabled={shut}
        aria-label={mode === 'voice' ? 'Arrêter la dictée' : 'Dicter'} title={mode === 'voice' ? 'Arrêter la dictée' : 'Dicter'} onClick={() => toggleMode(session.id, 'voice')}>
        {mode === 'voice' ? <span className="cw-wave" aria-hidden="true"><i /><i /><i /><i /></span> : <Icon d={MIC} size={15} />}
      </button>
      {stops
        ? <button type="button" className="cw-send stop" aria-label={`Interrompre ${session.name}`} title={`Interrompre ${session.name}`} onClick={() => client?.send({ type: 'session.interrupt', id: session.id })}><i aria-hidden="true" /></button>
        : <button type="submit" className="cw-send" disabled={!filled || shut} aria-label={btw ? 'Demander en aparté' : 'Envoyer'} title={btw ? 'Demander en aparté' : 'Envoyer'}><Icon d={ICONS.send.d} size={15} /></button>}
    </div>
  );
}
