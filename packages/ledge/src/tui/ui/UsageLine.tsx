import { Box, Text } from 'ink';
import { isUnread, resetIsDate, resetLong, resetShort, shownWindows, span, usageAlerts, usageGroups, usageThreshold, useUsage, type UsageGroup } from '@ledge/fleet';
import type { UsageAlert, UsageWindow } from '@ledge/protocol';
import { useTui } from '../context.js';
import { C } from '../theme.js';
import { useNow } from './now.js';

type Seg = readonly [string, string, boolean?];

/** Cursor's window key in the i18n tables: its pool, else `month` or `week`. */
export const cursorKey = (w: UsageWindow): string => (w.kind === 'pool' ? w.pool ?? '' : w.kind === 'month' ? 'month' : 'week');
/** A Cursor window's label from one of the tables, the raw key when the table does not know it (never empty). */
export const cursorLabel = (table: Record<string, string>, w: UsageWindow): string => table[cursorKey(w)] ?? cursorKey(w);

/** A gauge of `n` cells. */
export const bars = (pct: number, n: number, full: string, empty: string): string => {
  const f = Math.round((Math.min(100, pct) / 100) * n);
  return full.repeat(f) + empty.repeat(n - f);
};

/** An alert as words (docs/mockups/ledge-harness-usage.html): « Claude Code · 5 h atteinte · reprend 18:00 », or past the threshold
 *  « … à 84 % · remise … »; a date reads without its hour (« 1 déc. »). */
export function alertText(a: UsageAlert, t: ReturnType<typeof useTui>['t'], lang: string, now: number): string {
  const w = a.window;
  const name = a.harness === 'cursor' ? cursorLabel(t.usage.cursorAlert, w)
    : w.kind === 'five_hour' ? t.usage.five5 : w.kind === 'seven_day' ? t.usage.weekAll : t.usage.weekOf(w.model ?? '');
  const date = !!w.resetsAt && resetIsDate(w.resetsAt, now);
  const at = w.resetsAt ? (date ? resetShort : resetLong)(w.resetsAt, now, lang) : null;
  const harness = t.usage.harness[a.harness] ?? a.harness;
  return a.level === 'full' ? t.usage.alertFull(harness, name, at, date) : t.usage.alertThreshold(harness, name, w.pct, at, date);
}

/** The alert the footer shows (#40, D9): a limit reached before one past the threshold, then the newest; and how many others. */
export function worstAlert(alerts: readonly UsageAlert[]): { alert: UsageAlert; more: number } | null {
  const first = alerts.find(a => a.level === 'full') ?? alerts[0];
  return first ? { alert: first, more: alerts.length - 1 } : null;
}

/** The same window: its kind, and its model or pool when it has one. */
const sameWindow = (w: UsageWindow, v: UsageWindow): boolean => w.kind === v.kind && (w.model ?? null) === (v.model ?? null) && (w.pool ?? null) === (v.pool ?? null);

/**
 * The group an alert is about: its account's. An account-less harness (Codex) has one group per machine and its alert names no
 * machine: it goes to the group whose window matches it (the same reset, else the same percentage, else past it); none, or none that
 * matches, and it leads the line on its own, never in place of another machine's (review of #40 PR 2c).
 */
export function groupOfAlert(a: UsageAlert, groups: readonly UsageGroup[]): UsageGroup | undefined {
  if (a.account) return groups.find(x => x.key === `${a.harness}|${a.account}`);
  const mine = groups.filter(y => y.harness === a.harness && y.key.startsWith(`${a.harness}|@`));
  const win = (y: UsageGroup) => y.windows.find(w => sameWindow(w, a.window));
  return mine.find(y => !!a.window.resetsAt && win(y)?.resetsAt === a.window.resetsAt && (win(y)?.pct ?? -1) >= a.window.pct)
    ?? mine.find(y => win(y)?.pct === a.window.pct)
    ?? mine.find(y => (win(y)?.pct ?? -1) >= a.window.pct);
}

/**
 * The harnesses' limits on one line above the keys, on every screen (docs/mockups/ledge-harness-usage.html, « TUI »): per
 * account its mark (✻ Claude Code, >_ Codex), the 5 hours and the week, the models past the threshold; from 120 columns with
 * gauges and the week's reset. Grey under the threshold, yellow past it, red at 100 %; old values grey with their age in
 * yellow. The machine's name when one harness shows two groups, always on Codex (N2). Nothing when no harness gives limits.
 * An alert (#40, D9, docs/mockups/ledge-remove-chat-p2.html) takes its harness's place: its words, yellow past the threshold, red
 * when reached; with several, the worst, then « +n ».
 */
export function usageSegments(groups: readonly UsageGroup[], o: { wide: boolean; threshold: number; now: number; lang: string; label(id: string): string; t: ReturnType<typeof useTui>['t']; g: ReturnType<typeof useTui>['g']; alerts?: readonly UsageAlert[] }): Seg[] {
  const { t, g } = o;
  const u = t.usage;
  const segs: Seg[] = [];
  const named = (x: UsageGroup) => x.harness === 'codex' || groups.filter(y => y.harness === x.harness).length > 1;
  const col = (pct: number, dim: boolean) => (dim ? C.faint : pct >= 100 ? C.red : pct >= o.threshold * 100 ? C.yellow : C.dim);
  const worst = worstAlert(o.alerts ?? []);
  const said = () => {
    segs.push([alertText(worst!.alert, t, o.lang, o.now), worst!.alert.level === 'full' ? C.red : C.yellow]);
    if (worst!.more) segs.push([` ${u.more(worst!.more)}`, C.faint]);
  };
  // An alert no group shows (not read recently enough on any machine, or none of its windows matches) still leads the line.
  const owner = worst ? groupOfAlert(worst.alert, groups) : undefined;
  if (worst && !owner) { said(); if (groups.length) segs.push(['  │  ', C.line]); }
  groups.forEach((x, i) => {
    if (i) segs.push(['  │  ', C.line]);
    if (worst && x === owner) { said(); return; }
    const cursor = x.harness === 'cursor';
    segs.push([`${x.harness === 'claude' ? g.markClaude : cursor ? g.markCursor : g.markCodex} `, x.harness === 'claude' ? C.coral : cursor ? C.fg : C.violet, cursor]);
    if (named(x)) segs.push([`${x.machines.map(o.label).join(' + ')} `, C.fg]);
    if (x.status === 'loading') { segs.push([u.reading, C.faint]); return; }
    if (x.status === 'expired') { segs.push([o.wide ? u.expired(u.harness[x.harness] ?? x.harness) : u.expiredShort, C.yellow]); return; }
    const dim = x.status === 'stale' || x.status === 'unreachable';
    const one = (k: string, w: UsageWindow, reset: string) => {
      const c = col(w.pct, dim);
      segs.push([`${k} `, C.faint]);
      if (o.wide) segs.push([`${bars(w.pct, 6, g.barFull, g.barEmpty)} `, c]);
      segs.push([`${w.pct}%`, c === C.dim ? C.fg : c]);
      if (reset) segs.push([` ${g.reset}${reset}`, C.faint]);
      segs.push(['  ', '']);
    };
    if (cursor && isUnread(x, o.now)) { segs.push([u.unread, C.faint]); return; }
    const s = shownWindows(x, o.threshold);
    const at = (w: UsageWindow | undefined) => (w?.resetsAt ? resetShort(w.resetsAt, o.now, o.lang) : '');
    if (cursor) {
      // Its total (month, or week on weekly plans) with its reset, then the pools past the threshold.
      const total = s.month ?? s.week;
      if (total) one(s.month ? (o.wide ? u.month : u.monthShort) : (o.wide ? u.week : u.weekShort), total, o.wide ? at(total) : '');
      for (const w of s.hot) one(cursorLabel(u.cursorPool, w), w, '');
    } else {
      if (s.five) one(u.five, s.five, at(s.five));
      if (s.week) one(o.wide ? u.week : u.weekShort, s.week, o.wide ? at(s.week) : '');
      for (const w of s.hot) one(w.model ?? '', w, '');
    }
    if (dim) segs.push([x.status === 'unreachable' ? u.unreachable : x.readAt ? u.ago(span(o.now - Date.parse(x.readAt), o.lang)) : u.never, C.yellow]);
  });
  return segs;
}

/** Every machine's limits as the TUI shows them. */
export function useUsageGroups(): { groups: UsageGroup[]; threshold: number; now: number; label(id: string): string; alerts: UsageAlert[] } {
  const { client, machines } = useTui();
  const states = useUsage(client);
  // The ages and resets move by the minute: the second's clock, rounded.
  const now = Math.floor(useNow() / 30_000) * 30_000;
  const byId = new Map(machines.map(m => [m.id, m]));
  const online = (id: string) => byId.get(id)?.status === 'open';
  return { groups: usageGroups(states, online, now), threshold: usageThreshold(states), now, label: id => byId.get(id)?.label ?? id, alerts: usageAlerts(states, online, now) };
}

export function UsageLine({ columns }: { columns: number }) {
  const { t, g, lang } = useTui();
  const { groups, threshold, now, label, alerts } = useUsageGroups();
  if (!groups.length) return null;
  const segs = usageSegments(groups, { wide: columns >= 120, threshold, now, lang, label, t, g, alerts });
  return (
    <Box paddingX={1} height={1} overflow="hidden">
      <Text wrap="truncate">{segs.map(([s, c, b], i) => <Text key={i} color={c || undefined} bold={b}>{s}</Text>)}</Text>
    </Box>
  );
}
