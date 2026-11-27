import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import type { IdeLayout, LayoutAction, SideView } from '../workspace/layout';
import { keyOf, type Tab } from '../workspace/model';
import { ATELIER_TAB, SETTINGS_TAB } from '../workspace/store';
import { PrIcon } from '../forge/PrIcon';
import { AlarmIcon } from '../routines/icons';
import { noteClick } from '../workspace/intent';
import '../styles/ide.css';

/** The IDE's activity bar (mockup `activity()`): the sidebar views, each badged with what waits in it (#40 D7: Projects the
 *  sessions, red for an approval, else amber for a question; Rigs OpenRig's open requests; « MR et PR », lot 8b, the open requests
 *  whose pipeline failed; « Routines », those to activate or whose last run failed; « Tâches » the decisions waiting), then the
 *  tabs that open in the workspace. */
export function ActivityBar({ layout, onLayout, onTab, activeTab, badge, prsFailing = 0, routinesBadge = 0, requestsBadge = 0, tasksBadge = 0 }: {
  layout: IdeLayout; onLayout(a: LayoutAction): void; onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number }; prsFailing?: number; routinesBadge?: number;
  requestsBadge?: number; tasksBadge?: number;
}) {
  const { t } = useI18n();
  const view = (v: SideView, d: readonly string[] | React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button className={layout.sideOpen && layout.sideView === v ? 'on' : undefined} aria-label={label} title={label} onClick={() => onLayout({ type: 'view', view: v })}>
      {Array.isArray(d) ? <Icon d={d} size={18} /> : d}{extra}
    </button>
  );
  const active = activeTab ? keyOf(activeTab) : '';
  const tab = (target: Tab, d: readonly string[], label: string) => (
    <button className={active === keyOf(target) ? 'on' : undefined} aria-label={label} title={label} onClick={() => onTab(target)}>
      <Icon d={d} size={18} />
    </button>
  );
  const mark = badge.perm ? <span className="ide-badge">{badge.perm}</span> : badge.ask ? <span className="ide-badge amber">{badge.ask}</span> : null;
  return (
    // Its Atelier and Réglages open previews (spec 2026-11-26-preview-tabs §5.2).
    <nav className="ide-activity" aria-label={t.ide.activityLabel} onClickCapture={e => noteClick(e.nativeEvent)}>
      {view('projects', SHELL_ICONS.files, t.ide.projects, mark)}
      {view('rigs', SHELL_ICONS.rig, t.ide.rigs, requestsBadge > 0 ? <span className="ide-badge amber">{requestsBadge}</span> : null)}
      {view('prs', <PrIcon />, t.forge.view, prsFailing > 0 ? <span className="ide-badge">{prsFailing}</span> : null)}
      {view('routines', <AlarmIcon size={18} />, t.routines.view, routinesBadge > 0 ? <span className="ide-badge">{routinesBadge}</span> : null)}
      {view('tasks', SHELL_ICONS.tasks, t.ide.tasksView, tasksBadge > 0 ? <span className="ide-badge amber">{tasksBadge}</span> : null)}
      {tab(ATELIER_TAB, SHELL_ICONS.grid, t.ide.atelierTab)}
      <span className="grow" />
      {tab(SETTINGS_TAB, SHELL_ICONS.gear, t.ide.settingsTab)}
    </nav>
  );
}
