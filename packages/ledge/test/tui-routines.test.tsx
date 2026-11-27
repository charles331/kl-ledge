import { describe, it, expect } from 'vitest';
import type { FleetRoutine } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Routine, Weekday } from '@ledge/protocol';
import { glyphsFor } from '../src/tui/glyphs.js';
import { en } from '../src/tui/i18n/en.js';
import { fr } from '../src/tui/i18n/fr.js';
import { awaitsOwner, momentText, routineLines, routineOrder, runReason, whenText } from '../src/tui/model/routines.js';
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
      ' point-hebdo           ? attend votre accord',
      '   Iris · 17:00 · ven.',
      ' veille                ! 18:00 échouée',
      '   Nova · 18:00 · tous les jours · dossier introuvable : ~/veille',
      '▌briefing              ● prochain 13:30  ✓ 08:00 en retard',
      '   Iris · 08:00 13:30 16:30 · lun-ven · reprise, puis remise',
      ' revue-prs             ● demain 09:00  ✓ 09:00',
      '   Otto · 09:00 · lun-ven · remise',
      ' nettoyage-branches    ‖ en pause',
      '   Pim · 19:30 · ven.'
    ]);
    expect(selLine).toBe(4);
    // The chosen line runs on the selection's background to the box's edge.
    expect(lines[4]!.every(s => s.bg !== undefined)).toBe(true);
    expect(text(routineLines(rows, { sel: 0, width: 80, now: NOW, lang: 'en' }, en, g).lines).slice(0, 6)).toEqual([
      '▌point-hebdo           ? waits for your approval',
      '   Iris · 17:00 · Fri',
      ' veille                ! 18:00 failed',
      '   Nova · 18:00 · every day · dossier introuvable : ~/veille',
      ' briefing              ● next 13:30  ✓ 08:00 late',
      '   Iris · 08:00 13:30 16:30 · Mon-Fri · resumed, then delivered'
    ]);
  });

  it('draws card 25: « 1 sem./2 » and the date, then UNIQUES with a waiting one dated and an active one « unique »', () => {
    const rows = routineOrder([...CARD25, ...CARD18.slice(2, 3)]);
    expect(text(routineLines(rows, { sel: 9, width: 80, now: NOW, lang: 'fr' }, fr, g).lines)).toEqual([
      ' briefing              ● prochain 13:30  ✓ 08:00 en retard',
      '   Iris · 08:00 13:30 16:30 · lun-ven · reprise, puis remise',
      ' bilan-sprint          ● jeu. 26 16:00',
      '   Iris · jeu. 16:00 · 1 sem./2',
      '',
      ' UNIQUES',
      ' prépa-121             ? attend votre accord',
      '   Iris · jeu. 3 déc. 16:00',
      ' rappel-conges         ● 4 déc. 09:00',
      '   Iris · unique'
    ]);
  });

  it('with several machines, a title per machine, its one-shots under UNIQUES inside it; a daemon too old says so (card 27)', () => {
    const laptop = (r: FleetRoutine): FleetRoutine => ({ ...r, machineId: 'laptop', target: { ...r.target, name: 'Garde' } });
    const rows = routineOrder([CARD18[2]!, laptop(CARD25[2]!), laptop(rt({ id: 'rf55555', name: 'garde-mr', nextRun: local(23, 15, 0) }))], ['local', 'laptop']);
    const machines = [{ id: 'local', label: 'PC du bureau', up: true }, { id: 'laptop', label: 'Portable', up: true }, { id: 'old', label: 'Vieux', up: true, old: true }];
    expect(text(routineLines(rows, { sel: 9, width: 80, now: NOW, lang: 'fr', machines }, fr, g).lines)).toEqual([
      ' Vieux ●',
      '   Ce daemon ne connaît pas encore les routines : mettez Ledge à jour.',
      '',
      ' PC du bureau ●',
      ' briefing              ● prochain 13:30  ✓ 08:00 en retard',
      '   Iris · 08:00 13:30 16:30 · lun-ven · reprise, puis remise',
      '',
      ' Portable ●',
      ' garde-mr              ● prochain 15:00',
      '   Garde · 09:00 · lun-ven',
      '',
      ' UNIQUES',
      ' rappel-conges         ● 4 déc. 09:00',
      '   Garde · unique'
    ]);
    // One machine: no title.
    expect(text(routineLines(rows.slice(0, 1), { sel: 0, width: 80, now: NOW, lang: 'fr', machines: machines.slice(0, 1) }, fr, g).lines)[0]).toContain('briefing');
  });

  it('a failure that timed out is worded by its cause, not the daemon’s French reason', () => {
    const timedOut = rt({ id: 'r777777', name: 'veille', target: { name: 'Nova', cwd: '/home/u/veille', tool: 'claude' }, nextRun: local(23, 18, 0),
      lastRun: { at: local(22, 18, 0), slot: '18:00', outcome: 'failed', reason: 'pas tapée en 30 min', cause: 'timeout' } });
    expect(text(routineLines([timedOut], { sel: 9, width: 90, now: NOW, lang: 'en' }, en, g).lines)[1]).toBe('   Nova · 09:00 · Mon-Fri · not typed within 30 min (session busy)');
    expect(text(routineLines([timedOut], { sel: 9, width: 90, now: NOW, lang: 'fr' }, fr, g).lines)[1]).toContain('pas tapée en 30 min (session occupée)');
    expect(runReason({ reason: 'dossier introuvable', field: 'cwd', cause: 'timeout' }, en)).toBe('dossier introuvable');
  });

  it('names a moment as the list does, and a schedule once for each use', () => {
    expect(momentText(local(23, 18, 0), NOW, 'fr', fr)).toBe('18:00');
    expect(momentText(local(24, 9, 0), NOW, 'en', en)).toBe('tomorrow 09:00');
    expect(momentText(local(26, 16, 0), NOW, 'en', en)).toBe('Thu 26 16:00');
    expect(momentText(local(34, 9, 0), NOW, 'en', en)).toBe('4 Dec 09:00');
    expect(whenText(CARD18[4]!, 'ask', 'fr', fr)).toBe('17:00 (ven)');
    expect(whenText(CARD25[1]!, 'list', 'fr', fr)).toBe('unique');
    expect(whenText(CARD25[1]!, 'list', 'fr', fr, { dated: true })).toBe('jeu. 3 déc. 16:00');
    expect(whenText(CARD25[0]!, 'list', 'en', en)).toBe('Thu 16:00 · every 2 wks');
    // The two request texts the owner approved on 2026-11-23.
    expect(whenText(CARD25[0]!, 'ask', 'fr', fr)).toBe('16:00 (jeu, 1 sem. sur 2)');
    expect(whenText(CARD25[0]!, 'ask', 'en', en)).toBe('16:00 (Thu, every 2 wks)');
    expect(whenText(CARD25[1]!, 'ask', 'en', en)).toBe('Thu 3 Dec 16:00');
  });

  it('a session’s change waits like a new routine: « attend votre accord » before its pause, who asks what under it when chosen (#40, D4)', () => {
    const briefing = { ...CARD18[2]!, proposal: { spec: { name: 'briefing', target: CARD18[2]!.target, schedule: { kind: 'recurring' as const, times: ['07:30', '13:30', '16:30'], days: [...MONFRI] }, prompt: 'p' }, by: { id: 'iris1', name: 'Iris' }, at: local(23, 2, 10) } };
    expect(awaitsOwner(briefing)).toBe(true);
    expect(awaitsOwner(CARD18[4]!)).toBe(true);
    expect(awaitsOwner(CARD18[1]!)).toBe(false);
    const chosen = text(routineLines([briefing], { sel: 0, width: 90, now: NOW, lang: 'fr' }, fr, g).lines);
    expect(chosen[0]).toMatch(/briefing +\? attend votre accord$/);
    // Its current schedule stays on its line; the change asked is said under it.
    expect(chosen[1]).toContain('08:00 13:30 16:30');
    expect(chosen[2]).toBe('   Iris veut modifier « briefing » : 07:30, 13:30, 16:30 (lun-ven)');
    expect(text(routineLines([briefing], { sel: 0, width: 90, now: NOW, lang: 'en' }, en, g).lines)[2]).toBe('   Iris wants to change “briefing”: 07:30, 13:30, 16:30 (Mon-Fri)');
    // Not chosen: two lines, as every routine.
    expect(routineLines([briefing], { sel: 9, width: 90, now: NOW, lang: 'fr' }, fr, g).lines).toHaveLength(2);
    // Paused with a change: the wait comes first.
    expect(text(routineLines([{ ...briefing, state: 'paused' }], { sel: 9, width: 90, now: NOW, lang: 'fr' }, fr, g).lines)[0]).toContain('attend votre accord');
  });
});

const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

/** A TUI on a daemon that serves routines: it lists the mockup's and answers each command with the routine as it is. */
async function routinesTui(list: Routine[], o: { sessions?: ReturnType<typeof mockupSessions>; refuse?: string; slowMs?: number } = {}) {
  // The daemon answers from before the TUI connects: the fleet asks `routine.list` as soon as it reads the snapshot.
  const tui = await startTui({ daemonExtras: { routines: true }, ...(o.sessions ? { sessions: o.sessions } : {}), ...(o.slowMs ? { slowMs: o.slowMs } : {}), answer: daemon => daemon.onMessage(m => {
    if (m.type === 'routine.list') daemon.push({ type: 'routine.listed', rid: m.rid, routines: list });
    if (m.type === 'routine.cmd') {
      const r = list.find(x => x.id === m.routine);
      if (!r) { daemon.push({ type: 'routine.result', rid: m.rid, code: 'not_found', reason: 'routine inconnue' }); return; }
      if (o.refuse) { daemon.push({ type: 'routine.result', rid: m.rid, code: 'forbidden', reason: o.refuse }); return; }
      // An approve bound to another version than the routine's own is refused, as the daemon does (card 32).
      if (m.op === 'approve' && r.key && m.expect !== r.key) { daemon.push({ type: 'routine.result', rid: m.rid, code: 'stale', reason: 'la routine a changé (texte du daemon)' }); return; }
      const next = m.op === 'pause' ? { ...r, state: 'paused' as const } : m.op === 'resume' ? { ...r, state: 'enabled' as const } : r;
      daemon.push({ type: 'routine.result', rid: m.rid, routine: next });
    }
  }) });
  await until(() => (tui.client.fleet?.routines().length ?? 0) === list.length);
  return tui;
}
const strip = ({ machineId: _m, ...r }: FleetRoutine): Routine => r;

describe('ledge tui: the Routines screen (6)', () => {
  it('lists the routines on a slower machine too: the first `routine.list` is answered (release 0.63.0 CI)', async () => {
    const tui = await routinesTui([strip(CARD18[2]!)], { slowMs: 300 });
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('ROUTINES · 1'));
    } finally { await tui.cleanup(); }
  });

  it('6 opens it; j k choose, r runs now, p pauses and resumes, the delivery comes as a toast; esc goes back', async () => {
    const list = CARD18.map(strip);
    const tui = await routinesTui(list);
    try {
      await tui.resize(120, 30);
      await tui.press('6');
      await until(() => tui.frame().includes('ROUTINES · 5'));
      const f = tui.frame();
      expect(f).toContain('6 · Routines');
      expect(f).toContain('point-hebdo');
      // The first is chosen: awaiting approval, its keys are a and x (#40, D4); r and p send nothing.
      expect(f).toMatch(/j k +naviguer +a +activer +x +refuser +↵ +ouvrir la session/);
      expect(f).toContain('? attend votre accord');
      await tui.press('r'); await tui.press('p');
      expect(sent(tui.daemon.received, 'routine.cmd')).toEqual([]);
      await tui.press('j'); await tui.press('j');
      await until(() => /j k +naviguer +r +lancer maintenant +p +pause\/reprendre +↵ +ouvrir la session/.test(tui.frame()));
      await tui.press('r');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 1);
      expect(sent(tui.daemon.received, 'routine.cmd')[0]).toMatchObject({ op: 'run', routine: 'r1a2b3c' });
      // The firing reached Iris: the daemon tells the routine's new last run, the toast says so.
      const briefing = list.find(r => r.id === 'r1a2b3c')!;
      // The mock daemon keeps its list as it changes, so a command's answer carries the routine as it now is.
      const change = (r: Routine) => { list[list.findIndex(x => x.id === r.id)] = r; tui.daemon.push({ type: 'routine.changed', routine: r }); };
      change({ ...briefing, lastRun: { at: new Date().toISOString(), slot: '13:05', outcome: 'delivered' } });
      await until(() => tui.frame().includes('✓ « briefing » remise à Iris'));
      // Launched in a new session: said so.
      await tui.press('r');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 2);
      change({ ...briefing, lastRun: { at: new Date(Date.now() + 1000).toISOString(), slot: '13:06', outcome: 'launched' } });
      await until(() => tui.frame().includes('✓ Iris lancée, « briefing » remise'));
      await tui.press('p');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 3);
      expect(sent(tui.daemon.received, 'routine.cmd')[2]).toMatchObject({ op: 'pause', routine: 'r1a2b3c' });
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
      await tui.press('6');
      await until(() => tui.frame().includes('ROUTINES · 1'));
      list.length = 0;
      await tui.press('r');
      await until(() => tui.frame().includes('« briefing » n’a pas pu partir : routine inconnue'));
      await tui.press('\r');
      await until(() => !tui.frame().includes('ROUTINES · 1'));
      expect(tui.frame()).toContain('Iris');
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('↵ with no live session says r will resume it; a refused pause says why', async () => {
    const tui = await routinesTui([strip(CARD18[1]!)], { refuse: 'interdit' });
    try {
      await tui.resize(120, 30);
      await tui.press('6');
      await until(() => tui.frame().includes('ROUTINES · 1'));
      await tui.press('\r');
      await until(() => tui.frame().includes('· Otto ne tourne pas : r lance la routine, qui la reprendra.'));
      await tui.press('p');
      await until(() => tui.frame().includes('! Pause refusée : interdit'));
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('a daemon that does not know routines says so, not « no routine »', async () => {
    const tui = await startTui();
    try {
      await tui.resize(120, 30);
      await tui.press('6');
      await until(() => tui.frame().includes('Ce daemon ne connaît pas encore les routines : mettez Ledge à jour.'));
      expect(tui.frame()).not.toContain('Aucune routine');
    } finally { await tui.cleanup(); }
  });

  it('says how to make one when there is none', async () => {
    const tui = await routinesTui([]);
    try {
      await tui.press('6');
      await until(() => tui.frame().includes('Aucune routine. `ledge routine add` en crée une.'));
      expect(tui.frame()).toContain('ROUTINES · 0');
    } finally { await tui.cleanup(); }
  });

  it('a on a waiting routine sends the version shown; a stale refusal says so in the screen’s words and activates nothing; x refuses (#40, D4, card 32)', async () => {
    const hebdo = { ...strip(CARD18[4]!), key: 'k1' };
    const list: Routine[] = [hebdo];
    const tui = await routinesTui(list);
    try {
      await tui.resize(160, 40);
      await tui.press('6');
      await until(() => tui.frame().includes('ROUTINES · 1'));
      // The session changes the routine (17:00 → 16:30) after the screen showed it; the daemon's key moves on.
      const changed = { ...hebdo, schedule: { kind: 'recurring' as const, times: ['16:30'], days: ['fri' as const] }, key: 'k2' };
      list[0] = changed;
      tui.daemon.push({ type: 'routine.changed', routine: changed });
      await until(() => tui.frame().includes('16:30'));
      // a was meant for the version shown before: the daemon holds a newer one and refuses it.
      list[0] = { ...changed, key: 'k3' };
      await tui.press('a');
      await until(() => tui.frame().includes('« point-hebdo » a changé : relisez-la avant d’activer.'));
      expect(sent(tui.daemon.received, 'routine.cmd')[0]).toMatchObject({ op: 'approve', routine: 'r3f9a12', expect: 'k2' });
      expect(tui.frame()).not.toContain('texte du daemon');
      // Read again, a sends the version now listed; x refuses, bound to nothing.
      tui.daemon.push({ type: 'routine.changed', routine: list[0]! });
      await new Promise(r => setTimeout(r, 100));
      await tui.press('a');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 2);
      expect(sent(tui.daemon.received, 'routine.cmd')[1]).toMatchObject({ op: 'approve', expect: 'k3' });
      await tui.press('x');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 3);
      expect(sent(tui.daemon.received, 'routine.cmd')[2]).toEqual(expect.objectContaining({ op: 'refuse', routine: 'r3f9a12' }));
      expect(sent(tui.daemon.received, 'routine.cmd')[2]).not.toHaveProperty('expect');
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('a session’s change to an active routine is answered here too: a sends it bound to its key (#40, D4)', async () => {
    const briefing = { ...strip(CARD18[2]!), key: 'kb', proposal: { spec: { name: 'briefing', target: CARD18[2]!.target, schedule: { kind: 'recurring' as const, times: ['07:30'], days: [...MONFRI] }, prompt: 'p' }, by: { id: 'iris1', name: 'Iris' }, at: local(23, 2, 10) } };
    const tui = await routinesTui([briefing]);
    try {
      await tui.resize(160, 40);
      await tui.press('6');
      await until(() => tui.frame().includes('Iris veut modifier « briefing » : 07:30 (lun-ven)'));
      expect(tui.frame()).toMatch(/a +activer +x +refuser/);
      await tui.press('r');
      await tui.press('a');
      await until(() => sent(tui.daemon.received, 'routine.cmd').length === 1);
      expect(sent(tui.daemon.received, 'routine.cmd')[0]).toMatchObject({ op: 'approve', routine: 'r1a2b3c', expect: 'kb' });
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('the overview no longer lists a routine’s request or failure (#40, D4): they are the Routines screen’s', async () => {
    const tui = await routinesTui(CARD18.map(strip));
    const base = { giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open' as const, at: local(23, 2, 10), updatedAt: local(23, 2, 10), log: [] };
    try {
      await tui.resize(160, 40);
      tui.daemon.push({ type: 'task.updated', task: { ...base, id: 't1', title: 'x', routine: { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' } } });
      tui.daemon.push({ type: 'task.updated', task: { ...base, id: 't2', title: 'y', routine: { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' } } });
      await until(() => tui.frame().includes('PROJETS'));
      await new Promise(r => setTimeout(r, 100));
      const f = tui.frame();
      expect(f).not.toContain('veut programmer');
      expect(f).not.toContain('n’a pas pu partir');
      expect(f).not.toMatch(/D +répondre à la décision/);
      // y on the overview answers the selected session, never a routine.
      await tui.press('\t'); await tui.press('\t'); await tui.press('\t');
      expect(sent(tui.daemon.received, 'routine.cmd')).toEqual([]);
    } finally { await tui.cleanup(); }
  }, 20_000);
});
