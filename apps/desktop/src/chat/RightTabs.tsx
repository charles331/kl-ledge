import type { JSX } from 'react';
import type { ChatTurn } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import type { HomeTab } from '../nav/state';
import type { TasksApi } from '../tasks/useTasksApi';
import { clock, Connecting, OfflineBanner, type ListState } from '../tasks/TasksView';
import '../styles/rtabs.css';

export type { ListState };

/** The IDE's right panel as the app keeps it for the window's life (docs/mockups/ledge-ide-tasks-history.html): the tab, and what
 *  « Résumer la journée » asked from elsewhere. « Tâches » left it for its own view (#40 D3); until the chat goes (#40 PR 4) the
 *  panel keeps Conversation and Historique. `task` and `seen` are the Tasks view's, kept here with the rest of the panel's state. */
export interface RightTabs {
  tasks: TasksApi;
  tab: HomeTab;
  /** The task whose detail replaces the list, or null for the list. */
  task: string | null;
  /** Bumped by each « Voir » from elsewhere: the filters go back to All / Anyone, so the task is in the list on the way back. */
  seen: number;
  /** A question asked from elsewhere (« Résumer la journée »), kept until the panel sends it, on Conversation: the panel may
   *  only be mounting (shown in the same render, or hidden by a narrow window until it fits). */
  ask?: { text: string; n: number };
  /** The panel sent `ask`: the app forgets it. */
  onAsked(): void;
  onTab(tab: HomeTab, task?: string | null): void;
}

/** The tab strip under the chat's header: Conversation · Historique (« Tâches » is a view of its own, #40 D3). */
export function RightTabStrip({ tab, onTab }: { tab: HomeTab; onTab(tab: HomeTab): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rt-tabs" role="tablist" aria-label={t.home.tabsLabel}>
      <button type="button" role="tab" aria-selected={tab === 'conversation'} className={cls(tab === 'conversation' && 'on')} onClick={() => onTab('conversation')}>{t.home.tabs.conversation}</button>
      <button type="button" role="tab" aria-selected={tab === 'history'} className={cls(tab === 'history' && 'on')} onClick={() => onTab('history')}>{t.home.tabs.history}</button>
    </div>
  );
}

/** « Historique »: the questions asked to Ledge since the last new conversation, the latest first; a click goes back to the
 *  conversation on that question (ChatPanel scrolls to it and lights it). */
export function HistoryPane({ chat, state, onOpen }: { chat: readonly ChatTurn[]; state: ListState; onOpen(qid: string): void }): JSX.Element {
  const { t } = useI18n();
  if (state === 'connecting') return <Connecting />;
  const offline = state === 'offline';
  return (
    <div className="rt-pane" role="tabpanel" aria-label={t.home.tabs.history}>
      {offline && <OfflineBanner />}
      {chat.length === 0 ? <div className="rt-empty">{t.home.history.none}</div> : (
        <div className={cls('rt-list', offline && 'dim')}>
          {chat.slice().reverse().map(turn => (
            <button key={turn.qid} type="button" className="rt-hrow" title={t.home.history.open} onClick={() => onOpen(turn.qid)}>
              <small>{clock(turn.askedAt)}</small><span>{turn.question}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
