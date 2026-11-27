import { describe, it, expect } from 'vitest';
import type { Task } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet/routines';
import { MESSAGES } from '../src/i18n/messages';
import { routineNotice, routineWhen } from '../src/routines';
import { T, iris, pointHebdo, veille, group, task, decision } from './routineFixtures';

describe('the island’s words for a routine (cards 15 and 23)', () => {
  const fr = MESSAGES.fr, en = MESSAGES.en;
  it('a schedule: its times, then its days in brackets; every other week said; a one-shot by its day and month', () => {
    expect(routineWhen(pointHebdo.schedule, fr).ask).toBe('17:00 (ven)');
    expect(routineWhen(pointHebdo.schedule, en).ask).toBe('17:00 (Fri)');
    expect(routineWhen({ kind: 'recurring', times: ['16:30', '08:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, fr).ask).toBe('08:00, 16:30 (lun–ven)');
    expect(routineWhen(veille.schedule, fr).ask).toBe('18:00 (tous les jours)');
    expect(routineWhen({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, fr).ask).toBe('16:00 (jeu, 1 sem. sur 2)');
    expect(routineWhen(group[0]!.schedule, fr).moments).toEqual(['3 déc. 16:00']);
    expect(routineWhen(group[0]!.schedule, en).moments).toEqual(['3 Dec 16:00']);
    // A single one-off's and every other week's request words, approved by the owner (2026-11-23).
    expect(routineWhen(group[0]!.schedule, fr).ask).toBe('jeu. 3 déc. 16:00');
    expect(routineWhen(group[0]!.schedule, en).ask).toBe('Thu 3 Dec 16:00');
    expect(routineWhen({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, en).ask).toBe('16:00 (Thu, every 2 wks)');
  });

  it('a request, a group and a failure, as the mockup says them; a plain decision is none', () => {
    // The French words hold non-breaking spaces before « : » and inside « » (the island's catalogue): read here as plain spaces.
    const n = (t: Task, list: FleetRoutine[] = [pointHebdo, veille, ...group]) => {
      const r = routineNotice(decision(t.id), 'local', t, list, fr);
      return r && { ...r, text: r.text.replace(/\u00a0/g, ' ') };
    };
    expect(n(task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }))).toMatchObject({ kind: 'approve', who: 'Iris', ids: ['r3f9a12'], text: 'Iris veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant' });
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }))).toMatchObject({
      ids: ['r000001', 'r000002', 'r000003'], text: 'Iris veut programmer 3 routines uniques : prepa-121 (3 déc. 16:00), prepa-comite-archi (7 déc. 15:00), prepa-demo-compart (8 déc. 09:30)'
    });
    expect(n(task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' }, { giverName: 'Ledge' }))).toMatchObject({ kind: 'failed', who: 'Nova', ids: ['r81c0d4'], text: 'La routine veille (Nova) n’a pas pu partir : dossier introuvable : ~/veille' });
    expect(n(task('t5', { kind: 'approve', id: 'r000009', name: 'point-121' }), [{ ...group[0]!, id: 'r000009', name: 'point-121', schedule: { kind: 'once', at: ['2026-12-03T16:00', '2026-12-10T16:00', '2026-12-17T16:00', '2026-12-24T16:00', '2026-12-31T16:00'] } }])?.text)
      .toBe('Iris veut programmer « point-121 » : jeu. 3 déc. 16:00, jeu. 10 déc. 16:00, jeu. 17 déc. 16:00 et 2 autres, dans ~/assistant');
    // A routine answered elsewhere leaves the count; one not listed yet keeps the task's title.
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }), [{ ...group[0]!, state: 'enabled' }, group[1]!, group[2]!])?.ids).toEqual(['r000002', 'r000003']);
    // Not read yet: card 30's words, never the task's French title; nothing to activate without the routine's key.
    expect(n(task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }), [])).toMatchObject({ text: '« point-hebdo » attend ton accord', keys: { r3f9a12: undefined } });
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002'] }), [])?.text).toBe('« prepa-121 » attend ton accord');
    expect(n(task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'pas remise dans les 30 minutes' }), [])?.text).toBe('La routine veille n’a pas pu partir : pas remise dans les 30 minutes');
    // A run not typed in time says card 8's words (`cause`), the daemon's French reason only without one.
    const late = { ...veille, lastRun: { at: T, slot: '18:00', outcome: 'failed' as const, reason: 'pas remise dans les 30 minutes', cause: 'timeout' as const } };
    expect(routineNotice(decision('t3'), 'local', task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'pas remise dans les 30 minutes' }), [late], en)?.text)
      .toBe('The routine veille (Nova) could not run: not typed within 30 min (session busy)');
    // Each routine's key, as listed: what an approval sends back as `expect`.
    expect(n(task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] }))?.keys).toEqual({ r000001: 'k-r000001', r000002: 'k-r000002', r000003: 'k-r000003' });
    // A session's change (card 29): « veut modifier », with the settings it asks for.
    const asked = { name: 'point-hebdo', target: iris, schedule: { kind: 'recurring' as const, times: ['16:00'], days: ['fri' as const] }, prompt: 'p' };
    expect(n(task('t6', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' }), [{ ...pointHebdo, state: 'enabled', proposal: { spec: asked, by: { id: 'iris', name: 'Iris' }, at: T } }])?.text)
      .toBe('Iris veut modifier « point-hebdo » : 16:00 (ven)');
    expect(n(task('t4', { kind: 'approve', id: 'r000001', name: 'prepa-121' }))?.text).toBe('Iris veut programmer « prepa-121 » : jeu. 3 déc. 16:00, dans ~/assistant');
    expect(routineNotice(decision('t9'), 'local', task('t9', undefined), [pointHebdo], fr)).toBeNull();
  });
});

