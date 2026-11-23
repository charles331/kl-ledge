import { describe, it, expect } from 'vitest';
import type { FleetRoutine } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Routine, Task, Weekday } from '@ledge/protocol';
import { glyphsFor } from '../src/tui/glyphs.js';
import { en } from '../src/tui/i18n/en.js';
import { fr } from '../src/tui/i18n/fr.js';
import { momentText, routineItems, routineLines, routineOrder, whenText } from '../src/tui/model/routines.js';
import { until } from './helpers.js';
import { mockupSessions, startTui } from './tui-fixture.js';

/** Monday 23 November 2026, 13:02 local: the mockup's moment. */
const NOW = new Date(2026, 10, 23, 13, 2).getTime();
const local = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
const MONFRI: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const rt = (o: Partial<Routine> & Pick<Routine, 'id' | 'name'>): FleetRoutine => ({
  target: { name: 'Iris', cwd: '/home/u/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['09:00'], days: [...MONFRI] }, prompt: 'p',
  catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: local(20, 9, 0), machineId: 'local', ...o
});

/** The mockup's five routines (card 18), in another order than the screen's. */
const CARD18: FleetRoutine[] = [
  rt({ id: 'r9d8e7f', name: 'nettoyage-branches', target: { name: 'Pim', cwd: '/home/u/Workspace/synapse', tool: 'claude' }, schedule: { kind: 'recurring', times: ['19:30'], days: ['fri'] }, state: 'paused',
    lastRun: { at: local(20, 19, 30), slot: '19:30', outcome: 'launched' } }),
  rt({ id: 'r5e6f70', name: 'revue-prs', target: { name: 'Otto', cwd: '/home/u/Workspace/ledge', tool: 'codex' }, nextRun: local(24, 9, 0), lastRun: { at: local(23, 9, 0), slot: '09:00', outcome: 'delivered' } }),
  rt({ id: 'r1a2b3c', name: 'briefing', schedule: { kind: 'recurring', times: ['16:30', '08:00', '13:30'], days: [...MONFRI] }, nextRun: local(23, 13, 30),
    lastRun: { at: local(23, 8, 42), slot: '08:00', outcome: 'resumed', late: true } }),
  rt({ id: 'r81c0d4', name: 'veille', target: { name: 'Nova', cwd: '/home/u/veille', tool: 'claude' }, schedule: { kind: 'recurring', times: ['18:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    nextRun: local(23, 18, 0), lastRun: { at: local(22, 18, 0), slot: '18:00', outcome: 'failed', reason: 'dossier introuvable : ~/veille' } }),
  rt({ id: 'r3f9a12', name: 'point-hebdo', schedule: { kind: 'recurring', times: ['17:00'], days: ['fri'] }, state: 'pending', createdBy: { kind: 'session', id: 'iris1', name: 'Iris' } })
];
/** Card 25's additions: a two-week routine and two one-shots, one waiting, one fired already (the PC's history). */
const CARD25: FleetRoutine[] = [
  rt({ id: 'rb11111', name: 'bilan-sprint', schedule: { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, nextRun: local(26, 16, 0) }),
  rt({ id: 'rc22222', name: 'prépa-121', schedule: { kind: 'once', at: ['2026-12-03T16:00'] }, state: 'pending', createdBy: { kind: 'session', id: 'iris1', name: 'Iris' } }),
  rt({ id: 'rd33333', name: 'rappel-conges', schedule: { kind: 'once', at: ['2026-12-04T09:00'] }, nextRun: local(34, 9, 0) }),
  rt({ id: 're44444', name: 'prépa-démo', schedule: { kind: 'once', at: ['2026-11-20T09:00'] }, state: 'done', lastRun: { at: local(20, 9, 0), slot: '09:00', outcome: 'delivered' } })
];
const text = (lines: Array<Array<{ text: string }>>) => lines.map(l => l.map(s => s.text).join('').trimEnd());
const g = glyphsFor({});

describe('tui routines: the model (mockup cards 18 and 25)', () => {
  it('orders the list: awaiting approval, failed, by next firing, paused last; one-shots after, a fired one left out', () => {
    expect(routineOrder(CARD18).map(r => r.name)).toEqual(['point-hebdo', 'veille', 'briefing', 'revue-prs', 'nettoyage-branches']);
    expect(routineOrder([...CARD25, ...CARD18.slice(2, 3)]).map(r => r.name)).toEqual(['briefing', 'bilan-sprint', 'prépa-121', 'rappel-conges']);
  });

  it('draws card 18: the name, its state on the right, the grey line below; the chosen one marked', () => {
    const rows = routineOrder(CARD18);
    const { lines, selLine } = routineLines(rows, { sel: 2, width: 80, now: NOW, lang: 'fr' }, fr, g);
    expect(text(lines)).toEqual([
      ' point-hebdo           ? attend votre accord dans À toi',
      '   Iris · 17:00 · ven',
      ' veille                ! 18:00 échouée',
      '   Nova · 18:00 · tous les jours · dossier introuvable : ~/veille',
      '▌briefing              ● prochain 13:30  ✓ 08:00 en retard',
      '   Iris · 08:00 13:30 16:30 · lun-ven · reprise, puis remise',
      ' revue-prs             ● demain 09:00  ✓ 09:00',
      '   Otto · 09:00 · lun-ven · remise',
      ' nettoyage-branches    ‖ en pause',
      '   Pim · 19:30 · ven'
    ]);
    expect(selLine).toBe(4);
    // The chosen line runs on the selection's background to the box's edge.
    expect(lines[4]!.every(s => s.bg !== undefined)).toBe(true);
    expect(text(routineLines(rows, { sel: 0, width: 80, now: NOW, lang: 'en' }, en, g).lines).slice(0, 6)).toEqual([
      '▌point-hebdo           ? awaits your approval in For you',
      '   Iris · 17:00 · fri',
      ' veille                ! 18:00 failed',
      '   Nova · 18:00 · every day · dossier introuvable : ~/veille',
      ' briefing              ● next 13:30  ✓ 08:00 late',
      '   Iris · 08:00 13:30 16:30 · mon-fri · resumed, then delivered'
    ]);
  });

  it('draws card 25: « 1 sem./2 » and the date, then UNIQUES with a waiting one dated and an active one « unique »', () => {
    const rows = routineOrder([...CARD25, ...CARD18.slice(2, 3)]);
    expect(text(routineLines(rows, { sel: 9, width: 80, now: NOW, lang: 'fr' }, fr, g).lines)).toEqual([
      ' briefing              ● prochain 13:30  ✓ 08:00 en retard',
      '   Iris · 08:00 13:30 16:30 · lun-ven · reprise, puis remise',
      ' bilan-sprint          ● jeu. 26 16:00',
      '   Iris · jeu 16:00 · 1 sem./2',
      '',
      ' UNIQUES',
      ' prépa-121             ? attend votre accord dans À toi',
      '   Iris · jeu. 3 déc. 16:00',
      ' rappel-conges         ● 4 déc. 09:00',
      '   Iris · unique'
    ]);
  });

  it('names a moment as the list does, and a schedule once for each use', () => {
    expect(momentText(local(23, 18, 0), NOW, 'fr', fr)).toBe('18:00');
    expect(momentText(local(24, 9, 0), NOW, 'en', en)).toBe('tomorrow 09:00');
    expect(momentText(local(26, 16, 0), NOW, 'en', en)).toBe('Thu 26 16:00');
    expect(momentText(local(34, 9, 0), NOW, 'en', en)).toBe('4 Dec 09:00');
    expect(whenText(CARD18[4]!, 'ask', 'fr', fr)).toBe('17:00 (ven)');
    expect(whenText(CARD25[1]!, 'list', 'fr', fr)).toBe('unique');
    expect(whenText(CARD25[1]!, 'list', 'fr', fr, { dated: true })).toBe('jeu. 3 déc. 16:00');
    expect(whenText(CARD25[0]!, 'list', 'en', en)).toBe('thu 16:00 · every 2 wks');
  });

  it('writes the two « À toi » items from the routine, the daemon’s title when it is not listed', () => {
    const base = { giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open' as const, at: local(23, 2, 10), updatedAt: local(23, 2, 10), log: [] };
    const tasks: Task[] = [
      { ...base, id: 't1', title: 'daemon words', routine: { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' } },
      { ...base, id: 't2', title: 'daemon words', routine: { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' } },
      { ...base, id: 't3', title: 'Iris veut programmer 2 routines : …', routine: { kind: 'approve', id: 'rc22222', name: 'prépa-121', ids: ['rc22222', 'rd33333'] } },
      { ...base, id: 't4', title: 'La routine x (Y) n’a pas pu partir : z', routine: { kind: 'failed', id: 'r0000ff', name: 'x' } },
      { ...base, id: 't5', title: 'Fusionner ?' }
    ];
    expect(routineItems(tasks, [...CARD18, ...CARD25], 'fr', fr)).toEqual([
      { id: 't1', mark: 'ask', text: 'Iris veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant' },
      { id: 't2', mark: 'fail', text: 'La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille' },
      { id: 't3', mark: 'ask', text: 'Iris veut programmer 2 routines uniques' },
      { id: 't4', mark: 'fail', text: 'La routine x (Y) n’a pas pu partir : z' }
    ]);
    expect(routineItems(tasks.slice(0, 1), CARD18, 'en', en)[0]!.text).toBe('Iris wants to schedule “point-hebdo”: 17:00 (fri), in ~/assistant');
  });
});

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

/** A TUI on a daemon that serves routines: it lists the mockup's and answers each command with the routine as it is. */
async function routinesTui(list: Routine[], o: { sessions?: ReturnType<typeof mockupSessions> } = {}) {
  const tui = await startTui({ daemonExtras: { routines: true }, ...(o.sessions ? { sessions: o.sessions } : {}) });
  tui.daemon.onMessage(m => {
    if (m.type === 'routine.list') tui.daemon.push({ type: 'routine.listed', rid: m.rid, routines: list });
    if (m.type === 'routine.cmd') {
      const r = list.find(x => x.id === m.routine);
      if (!r) { tui.daemon.push({ type: 'routine.result', rid: m.rid, code: 'not_found', reason: 'routine inconnue' }); return; }
      const next = m.op === 'pause' ? { ...r, state: 'paused' as const } : m.op === 'resume' ? { ...r, state: 'enabled' as const } : r;
      tui.daemon.push({ type: 'routine.result', rid: m.rid, routine: next });
    }
  });
  await until(() => (tui.client.fleet?.routines().length ?? 0) === list.length);
  return tui;
}
const strip = ({ machineId: _m, ...r }: FleetRoutine): Routine => r;

describe('ledge tui: the Routines screen (7)', () => {
  it('7 opens it; j k choose, r runs now, p pauses and resumes, the delivery comes as a toast; esc goes back', async () => {
    const list = CARD18.map(strip);
    const tui = await routinesTui(list);
    try {
      await tui.resize(120, 30);
      await tui.press('7');
      await until(() => tui.frame().includes('ROUTINES · 5'));
      const f = tui.frame();
      expect(f).toContain('7 · Routines');
      expect(f).toContain('point-hebdo');
      expect(f).toMatch(/j k +naviguer +r +lancer maintenant +p +pause\/reprendre +↵ +ouvrir la session/);
      // The first is chosen: awaiting approval, r and p send nothing.
      await tui.press('r'); await tui.press('p');
      expect(sent(tui.daemon.received, 'routine.cmd')).toEqual([]);
      await tui.press('j'); await tui.press('j');
      await tui.press('r');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 1);
      expect(sent(tui.daemon.received, 'routine.cmd')[0]).toMatchObject({ op: 'run', routine: 'r1a2b3c' });
      // The firing reached Iris: the daemon tells the routine's new last run, the toast says so.
      const briefing = list.find(r => r.id === 'r1a2b3c')!;
      tui.daemon.push({ type: 'routine.changed', routine: { ...briefing, lastRun: { at: new Date().toISOString(), slot: '13:05', outcome: 'delivered' } } });
      await until(() => tui.frame().includes('✓ « briefing » remise à Iris'));
      await tui.press('p');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 2);
      expect(sent(tui.daemon.received, 'routine.cmd')[1]).toMatchObject({ op: 'pause', routine: 'r1a2b3c' });
      await until(() => tui.frame().includes('‖ en pause'));
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('ROUTINES · 5'));
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('↵ opens the session the routine wakes; a refused run says why', async () => {
    const iris = fakeSession('iris', { name: 'Iris', cwd: '/home/u/assistant', state: 'idle', lastActivityAt: new Date().toISOString() });
    const list = [strip(CARD18[2]!)];
    const tui = await routinesTui(list, { sessions: [...mockupSessions(), iris] });
    try {
      await tui.resize(120, 30);
      await tui.press('7');
      await until(() => tui.frame().includes('ROUTINES · 1'));
      list.length = 0;
      await tui.press('r');
      await until(() => tui.frame().includes('« briefing » n’a pas pu partir : routine inconnue'));
      await tui.press('\r');
      await until(() => !tui.frame().includes('ROUTINES · 1'));
      expect(tui.frame()).toContain('Iris');
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('says how to make one when there is none', async () => {
    const tui = await routinesTui([]);
    try {
      await tui.press('7');
      await until(() => tui.frame().includes('Aucune routine. `ledge routine add` en crée une.'));
      expect(tui.frame()).toContain('ROUTINES · 0');
    } finally { await tui.cleanup(); }
  });

  it('« À toi » of the overview shows a routine’s request and failure, not as decisions: D does not answer them', async () => {
    const tui = await routinesTui(CARD18.map(strip));
    const base = { giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open' as const, at: local(23, 2, 10), updatedAt: local(23, 2, 10), log: [] };
    try {
      await tui.resize(160, 40);
      tui.daemon.push({ type: 'task.updated', task: { ...base, id: 't1', title: 'x', routine: { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' } } });
      tui.daemon.push({ type: 'task.updated', task: { ...base, id: 't2', title: 'y', routine: { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' } } });
      await until(() => tui.frame().includes('La routine veille (Nova) n’a pas pu partir'));
      const f = tui.frame();
      expect(f).toContain('? Iris veut programmer « point-hebdo » : 17:00 (ven), dans');
      expect(f).toContain('! La routine veille (Nova) n’a pas pu partir : dossier');
      expect(f).toContain('À TOI · 4');
      expect(f).not.toMatch(/D +répondre à la décision/);
      await tui.press('D');
      expect(tui.frame()).not.toContain('RÉPONDRE À');
    } finally { await tui.cleanup(); }
  }, 20_000);
});
