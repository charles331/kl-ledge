import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { randomUUID } from 'node:crypto';
import { useState } from 'react';
import { BROADCAST_SILENT, canBroadcast, isPending, useContextNear, useTasks } from '@ledge/fleet';
import { contextNear, contextShare, isOmpSeat, isStoppedOmpSeat, projectOf, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useEditing, useScreenKeys, useScreenSize, useTui } from '../context.js';
import { exchanges, helperCount, machineOf, nearContext, overview, step } from '../model/overview.js';
import { askingIds, decisionOf, useDecisionFlow, useDecisions } from '../decision.js';
import { fit, machineLabel, paneName } from '../model/labels.js';
import { rigTag, seatSecond } from '../model/rigSeat.js';
import { clock, oneLine } from '../model/time.js';
import { handOver } from '../handover.js';
import { C, projectColor, STATE_COLOR } from '../theme.js';
import { Field, fieldRows } from '../ui/Field.js';
import { Frame } from '../ui/Frame.js';
import { SessionCard } from '../ui/SessionCard.js';
import { Tail } from '../ui/Tail.js';
import { TitledBox } from '../ui/TitledBox.js';

/** Under this many columns the overview is one column: the session card opens with ↵. */
export const WIDE = 100;

type Row = { kind: 'project'; key: string; label: string; color: string; count: number; shown?: number; rig?: boolean; folder?: string }
  | { kind: 'branch'; key: string; branch: string; indent: number } | { kind: 'session'; key: string; s: Session; indent: number; group?: 'rig' | 'kernel' };
/** A rig's folder by its last name (`/w/ledge` -> `ledge`). */
const folderOf = (cwd: string | undefined): string => (cwd ?? '').split('/').filter(Boolean).at(-1) ?? '';

/** The rows of the tree box that fit in `height`, scrolled so that the selected session shows. */
export function windowed<T extends { key: string }>(rows: readonly T[], selectedKey: string | null, height: number): T[] {
  if (rows.length <= height) return [...rows];
  const at = Math.max(0, rows.findIndex(r => r.key === selectedKey));
  const start = Math.min(Math.max(0, at - Math.floor(height / 2)), rows.length - height);
  return rows.slice(start, start + height);
}

export function Overview() {
  const tui = useTui();
  const { d, projects, t, g, selected, select, actions, go, attach } = tui;
  const { columns, rows: height } = useScreenSize();
  const wide = columns >= WIDE;
  // The left column: wide enough for a topic, never more than half the terminal.
  const left = wide ? Math.min(64, Math.max(44, Math.floor(columns * 0.42))) : columns;
  const tasks = useTasks(tui.client);
  const view = useMemo(() => overview(d.sessions, projects), [d.sessions, projects]);
  const sel = selected?.id ?? null;
  // « À toi » left the overview (#40, PR 3): the sessions that wait are in the tree, tab goes to the next one, and so does it to a session
  // a decision waits on (marked « ? »). D answers the selected session's decision, as its Session screen does (decision.tsx).
  const decisions = useDecisions();
  const asking = useMemo(() => askingIds(decisions), [decisions]);
  const flow = useDecisionFlow(decisions);
  // m: one message to every live session of the selected one's project, through the fleet's broadcast (each machine that
  // holds them answers, merged, always within its timeout); the toast says who got it. Only a local daemon that takes it offers m.
  const writable = canBroadcast(tui.machines);
  const [writing, setWriting] = useState<{ id: string; project: string; draft: string } | null>(null);
  useEditing(flow.editing || !!writing);
  const broadcast = (id: string, text: string) => {
    void tui.fleet.broadcast({ project: id }, text, randomUUID()).then(m => {
      const why = m.reason === BROADCAST_SILENT ? t.toast.broadcastSilent : m.reason ?? m.refused[0]?.reason ?? '?';
      tui.toast(m.sent.length ? { text: t.toast.broadcastSent(m.sent.map(s => s.name).join(', '), m.refused.map(r => r.reason).join(' · ')), tone: 'ok' } : { text: t.toast.broadcastNobody(why), tone: 'error' });
    });
  };
  // Sessions near their context limit (context handover spec §3.2): H hands the selected one (else the first) over. They are no longer
  // listed here (#40, D10): the tree's ◔ says them, and a failed relief shows on the session itself.
  const threshold = useContextNear(tui.client);
  const near = useMemo(() => nearContext(d.sessions, threshold), [d.sessions, threshold]);

  useScreenKeys((input, key) => {
    // A decision's answer being written or read again: its keys only.
    if (flow.onKey(input, key)) return true;
    if (writing) { if (key.escape) setWriting(null); return true; }
    if (input === 'm' && selected && writable) {
      const id = projects ? projectOf({ machineId: machineOf(selected), cwd: selected.cwd }, projects) : null;
      const name = id ? projects?.projects.find(p => p.id === id)?.name : undefined;
      if (id && name) setWriting({ id, project: name, draft: '' }); else tui.toast({ text: t.toast.noProject, tone: 'info' });
      return true;
    }
    if (input === 'D') { const x = decisionOf(decisions, selected?.id); if (x) flow.start(x); return true; }
    if (input === 'H') {
      const s = (selected && selected.source === 'launcher' && selected.state !== 'exited' && selected.tool !== 'omp' && (!selected.handover || selected.handover.state === 'failed') ? selected : undefined) ?? near.find(x => x.handover?.state !== 'failed') ?? near[0];
      if (!s) return true;
      handOver(tui.client, s, t, tui.toast);
      return true;
    }
    if (input === 'j' || key.downArrow) { select(step(view.order, sel, 1)); return true; }
    if (input === 'k' || key.upArrow) { select(step(view.order, sel, -1)); return true; }
    if (key.tab) {
      // The sessions that wait, then those a decision waits on, round again.
      const ids = [...view.yours.map(s => s.id), ...view.order.filter(id => asking.has(id) && !view.yours.some(s => s.id === id))];
      const next = ids.length ? ids[(ids.indexOf(sel ?? '') + 1) % ids.length]! : null;
      if (next) select(next);
      return true;
    }
    // An OMP seat of OpenRig has no thread: ↵ attaches its terminal, as a does (docs/mockups/ledge-openrig-omp.html, view 2).
    if (key.return) { if (selected && isOmpSeat(selected)) attach(selected); else if (selected) go('session'); return true; }
    if (!selected) return false;
    if (input === 'a') { attach(selected); return true; }
    if (input === 'r' && selected.pending) { go('session'); return true; }
    // A digit answers the selected question; otherwise it switches screens (the App's keys).
    if (/^[1-9]$/.test(input) && selected.pending?.kind !== 'question') return false;
    if (input === 'y' || input === 'n' || input === 'A' || /^[1-9]$/.test(input)) return actions.key(selected, input);
    if (input === 'i' && selected.state === 'working') { actions.interrupt(selected); return true; }
    return false;
  });

  // PROJETS, RIGS and KERNEL, each in its own box (docs/mockups/ledge-openrig-groups.html, view 3).
  const groupRows = (kind: 'rig' | 'kernel'): Row[] => view.tree.filter(n => n.kind === kind).flatMap(n => [
    ...(kind === 'rig' ? [{ kind: 'project' as const, key: n.key, label: n.label, color: C.blue, count: n.count, ...(n.shown !== undefined && { shown: n.shown }), rig: true, folder: folderOf(n.branches[0]?.sessions[0]?.cwd) }] : []),
    ...n.branches.flatMap(b => b.sessions.map(s => ({ kind: 'session' as const, key: s.id, s, indent: kind === 'rig' ? 2 : 0, group: kind })))
  ]);
  const rigRows = groupRows('rig'), kernelRows = groupRows('kernel');
  const tree: Row[] = view.tree.filter(n => !n.kind).flatMap(n => {
    return [
      { kind: 'project' as const, key: n.key, label: n.label, color: projectColor(n.color), count: n.count },
      ...n.branches.flatMap(b => [{ kind: 'branch' as const, key: `${n.key}|${b.branch}`, branch: b.branch, indent: 2 }, ...b.sessions.map(s => ({ kind: 'session' as const, key: s.id, s, indent: 0 }))])
    ];
  });
  // The status bar, the key bar, the toast, the boxes' borders and titles; then a field across the screen under the boxes (a message to
  // the project, or a decision's answer). The tree takes the rest (#40, PR 3: no « À toi » box above it).
  const decideHeight = writing ? fieldRows(columns, height) + 2 : flow.height(columns, height);
  const allHeight = Math.max(3, height - 3 - decideHeight - 3);
  // The rigs' and the kernel's boxes take what their rows need (up to a few), the projects' the rest.
  const kernelHeight = kernelRows.length ? Math.min(kernelRows.length, 5) : 0;
  const rigsHeight = rigRows.length ? Math.min(rigRows.length, Math.max(3, Math.floor(allHeight / 3))) : 0;
  const treeHeight = Math.max(3, allHeight - (rigsHeight ? rigsHeight + 2 : 0) - (kernelHeight ? kernelHeight + 2 : 0));
  // Inside the box (borders and padding: 4): a row's fixed parts, then what is left for its text.
  const inner = left - 4, nameW = 7;
  const stateW = Math.max(...Object.values(t.state).map(x => x.length)) + 1;
  const topicW = Math.max(6, inner - 6 - nameW - stateW - 3);
  // The rigs' box: each seat's role, then its harness at the same column (the longest role and two spaces).
  const roleW = Math.max(11, ...rigRows.map(r => (r.kind === 'session' ? [...(r.s.rig?.role ?? '')].length + 2 : 0)));

  const treeBox = (
    <TitledBox title={t.overview.projects} flexGrow={1}>
      {tree.length === 0 ? <Text color={C.faint}>{t.overview.noSession}</Text> : windowed(tree, sel, treeHeight).map(r => r.kind === 'project'
        ? <Text key={r.key} wrap="truncate"><Text color={r.color}>{g.project}</Text> <Text color={C.fg} bold>{r.label}</Text> <Text color={C.faint}>{t.overview.sessions(r.count)}</Text></Text>
        : r.kind === 'branch'
          ? <Text key={r.key} wrap="truncate" color={C.faint}>{' '.repeat(r.indent)}{g.branch} {r.branch}</Text>
          : <SessionRow key={r.key} s={r.s} on={r.s.id === sel} nameW={nameW} topicW={Math.max(6, topicW - r.indent)} stateW={stateW} indent={r.indent} sigW={near.length ? SIG_W : 0} asks={asking.has(r.s.id)} />)}
    </TitledBox>
  );
  const groupBox = (title: string, rows: Row[], rowsHeight: number) => rows.length === 0 ? null : (
    <TitledBox title={title} height={rowsHeight + 2}>
      {windowed(rows, sel, rowsHeight).map(r => r.kind === 'project'
        ? <Text key={r.key} wrap="truncate"><Text color={r.color}>⬡</Text> <Text color={C.fg} bold>{r.label}</Text>{r.folder ? <Text color={C.faint}>  {r.folder}</Text> : null}<Text color={C.faint}>  {r.shown !== undefined ? t.overview.sessionsOf(r.count, r.shown) : t.overview.sessions(r.count)}</Text></Text>
        : r.kind === 'session'
          ? <SessionRow key={r.key} s={r.s} on={r.s.id === sel} nameW={nameW} topicW={Math.max(6, topicW - r.indent)} stateW={stateW} indent={r.indent} group={r.group} roleW={roleW} asks={asking.has(r.s.id)} />
          : null)}
    </TitledBox>
  );
  const rigsBox = groupBox(t.overview.rigsGroup, rigRows, rigsHeight);
  const kernelBox = groupBox(t.overview.kernelGroup, kernelRows, kernelHeight);

  const stopped = !!selected && isStoppedOmpSeat(selected);
  const keys: Array<readonly [string, string]> = writing ? [['↵', t.keys.sendOnly], ['alt+↵', t.keys.newLine], ['esc', t.keys.cancel]] : flow.active ? flow.keys : [
    // On an OMP seat ↵ attaches its terminal; on a stopped one, neither ↵ nor a has anything to attach.
    ['j k', t.keys.navigate], ...(stopped ? [] : [['↵', selected && isOmpSeat(selected) ? t.keys.attachSeat : t.keys.open] as const]), ...(view.yours.length || asking.size ? [['tab', t.keys.next] as const] : []), ...(view.yours.length ? [['y n', t.keys.answer] as const] : []),
    ...(stopped ? [] : [['a', t.keys.attach] as const]), ...(writable ? [['m', t.keys.writeProject] as const] : []),
    ...(decisionOf(decisions, selected?.id) ? [['D', t.keys.decide] as const] : []), ...(near.length ? [['H', t.keys.handover] as const] : []),
    ['+', t.keys.launch], [',', t.keys.settings], ['?', t.keys.help], ['q', t.keys.quit]
  ];
  return (
    <Frame crumb={tui.machines.map(m => `${m.label} ${m.ready ? g.machine : '○'}`).join('  ')} keys={keys}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={left} flexShrink={0}>{treeBox}{rigsBox}{kernelBox}</Box>
        {wide ? (
          <Box flexDirection="column" flexGrow={1}>
            {selected ? (
              <>
                <TitledBox title={`${selected.name}${selected.rig ? ` · ${t.overview.rigSeat(selected.rig.name, selected.rig.role ?? selected.rig.seat)}` : ''} · ${oneLine(selected.topic ?? selected.title)}`} color={isPending(selected) ? C.red : C.line} titleColor={isPending(selected) ? C.red : C.dim}>
                  <SessionCard s={selected} note />
                </TitledBox>
                <TitledBox title={t.overview.terminal(paneName(selected))} flexGrow={1}>
                  <Tail lines={d.previews.get(selected.id) ?? []} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
                </TitledBox>
              </>
            ) : <TitledBox title={t.tabs.session} flexGrow={1}><Text color={C.faint}>{t.session.noSession}</Text></TitledBox>}
            <TitledBox title={t.overview.exchanges} height={5}>
              {(() => {
                const list = exchanges(d.sessions, 3, tasks, t.overview.ledge);
                return list.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text> : list.map((x, i) => (
                  <Text key={i} wrap="truncate"><Text color={C.faint}>{clock(x.at)}</Text> <Text color={C.fg}>{x.from}</Text> <Text color={x.kind === 'task' ? C.green : C.violet}>{g.arrow}</Text> <Text color={C.fg}>{x.to}</Text>  {x.kind === 'task' ? <Text color={C.green}>{g.task} </Text> : null}<Text color={C.dim}>{oneLine(x.summary)}</Text></Text>
                ));
              })()}
            </TitledBox>
          </Box>
        ) : null}
      </Box>
      {writing ? (
        <Field title={t.overview.writeProjectTitle(writing.project)} value={writing.draft} onChange={v => setWriting(x => (x ? { ...x, draft: v } : x))}
          onSubmit={v => { if (!v.trim()) return false; setWriting(null); broadcast(writing.id, v.trim()); }} onEscape={() => setWriting(null)} active placeholder={t.overview.writeProjectHint} />
      ) : flow.view(columns, height)}
    </Frame>
  );
}

/** The context signal's column in a session row: `◔88%` and a space. */
const SIG_W = 6;

function SessionRow({ s, on, nameW, topicW, stateW, indent = 0, group, roleW = 11, sigW = 0, asks = false }: { s: Session; on: boolean; nameW: number; topicW: number; stateW: number; indent?: number; group?: 'rig' | 'kernel'; roleW?: number; sigW?: number; asks?: boolean }) {
  const { t, g, client } = useTui();
  const near = useContextNear(client);
  const st = botState(s);
  const n = helperCount(s);
  // A stopped OMP seat: all grey, « Arrêté » (docs/mockups/ledge-openrig-omp.html, view 2).
  const stopped = isStoppedOmpSeat(s);
  // In a group's box: the kernel's role (short) then its harness, as before; a rig's whole role, then its harness at one column.
  // Short of room, the harness gives way first: the role stays whole.
  const roleTool = group === 'kernel' ? `${(s.rig?.role ?? '').replace(/\.(agent|lead|worker)$/, '').padEnd(11)}${s.tool}` : `${(s.rig?.role ?? '').padEnd(roleW)}${s.tool}`;
  return (
    <Text wrap="truncate" backgroundColor={on ? C.sel : undefined}>
      <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
      <Text>{' '.repeat(2 + indent)}</Text>
      <Text color={s.offline || stopped ? C.faint : STATE_COLOR[st]}>{g[st]} </Text>
      {/* A decision waits on it (#40, PR 3, design-ux): « ? » in amber after its name, no text; D answers it. */}
      {asks
        ? <><Text color={stopped ? C.faint : s.offline ? C.dim : C.fg} bold={!stopped}>{fit(s.name, nameW - 1).trimEnd()}</Text><Text color={C.yellow}>?</Text><Text>{' '.repeat(Math.max(1, nameW - fit(s.name, nameW - 1).trimEnd().length - 1))}</Text></>
        : <Text color={stopped ? C.faint : s.offline ? C.dim : C.fg} bold={!stopped}>{fit(s.name, nameW)}</Text>}
      {/* A seat: its tag whole, then its role and the topic in what is left (the topic goes first). */}
      {/* In the rigs' and the kernel's boxes the box says the rig: the role (and, for the kernel, the harness) instead. */}
      {group ? <Text color={stopped ? C.faint : C.dim}> {fit(roleTool, topicW - 1)} </Text> : <>
        {s.rig ? <Text color={C.blue}> {rigTag(s)}</Text> : null}
        <Text color={C.dim}>{fit(seatSecond(s, oneLine(s.topic ?? s.title)), Math.max(0, (s.rig ? topicW - rigTag(s).length - 1 : topicW) - sigW))} </Text>
        {/* Its context, compact, only past « Contexte max » (docs/mockups/ledge-harness-usage.html): a column of its own, there
            while one session of the tree needs it. */}
        {/* A relief that failed turns it red (#40, D10, design-ux): its words are on the Session screen, where H tries again. */}
        {sigW ? <Text color={s.handover?.state === 'failed' ? C.red : C.yellow}>{fit(contextNear(s.context, near) || s.handover?.state === 'failed' ? `${g.gauge}${Math.round((contextShare(s.context) ?? 0) * 100)}%` : '', sigW)}</Text> : null}
      </>}
      <Text color={s.offline || stopped ? C.faint : STATE_COLOR[st]}>{fit(s.offline ? t.overview.offline : stopped ? t.state.stopped : t.state[st], stateW).trimEnd()}</Text>
      {n > 0 ? <Text color={C.violet}> +{n}</Text> : null}
      {s.machineName && s.machineId !== 'local' ? <Text color={C.faint}> · {machineLabel(s)}</Text> : null}
    </Text>
  );
}
