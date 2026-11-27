import type { JSX } from 'react';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';

const ALERT = ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'];

/** The channel's banner when the rigs cannot reach the person (OpenRig stopped, unreachable, not installed…); nothing while it is ready. */
export function AskBanner({ channel, machineLabel }: { channel: OpenRigAsksView['channel']; machineLabel: string }): JSX.Element | null {
  const { t } = useI18n();
  if (!channel || channel.state === 'ready') return null;
  const c = t.asks.channel;
  // The command or the reason OpenRig gives, as is, on its own line (unreachable, no_default).
  const [title, body, tone, mono] = channel.state === 'no_person' ? [c.no_person.title, c.no_person.body, 'err', '']
    : channel.state === 'no_default' ? [c.no_default.title, c.no_default.body, 'err', channel.message ?? '']
    : channel.state === 'openrig_stopped' ? [c.openrig_stopped.title, c.openrig_stopped.body, 'warn', '']
    : channel.state === 'unreachable' ? [c.unreachable.title, '', 'warn', channel.message ?? '']
    : [c.not_installed.title(machineLabel), c.not_installed.body, '', ''];
  return (
    <div className={cls('ask-banner', tone && `ask-banner-${tone}`)} role="status" data-channel={channel.state}>
      <Icon d={ALERT} size={16} />
      <div className="ask-banner-text"><b>{title}</b>{body && <p>{body}</p>}{mono && <p className="ask-mono">{mono}</p>}</div>
    </div>
  );
}
