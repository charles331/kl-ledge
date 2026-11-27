import type { JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { canVoiceType, voiceTyping } from '../tauri/bridge';

const MIC = ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'];

/**
 * The dictation button any text field can carry (#39, #41; docs/mockups/ledge-thread-cowork-complement.md §2): a click opens or
 * closes Windows' voice typing, which writes into the field that has the focus. The button never takes the focus (its mousedown
 * is cancelled), or Windows would write elsewhere. Ledge cannot tell whether Windows listens, so the button has no state of its
 * own; outside Ledge Desktop it is greyed and says why.
 */
export function MicButton({ disabled = false, className = 'cw-mic' }: { disabled?: boolean; className?: string }): JSX.Element {
  const { t } = useI18n();
  const tr = t.session.reply;
  const available = canVoiceType();
  return (
    <button type="button" className={className} disabled={disabled || !available} aria-label={tr.dictate} title={available ? tr.dictateTitle : tr.dictateUnavailable}
      onMouseDown={e => e.preventDefault()} onClick={() => { void voiceTyping(); }}>
      <Icon d={MIC} size={15} />
    </button>
  );
}
