import { describe, expect, it } from 'vitest';
import type { Routine, Session, Task } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet';
import { MESSAGES } from '../../src/i18n/messages';
import {
  atoiRoutineItems, draftErrors, expandHome, faultyField, homeLabel, parseRoutineRef, proposalChanges, proposalsOf, routineRef, routinesBadge,
  routinesOfSession, sessionOfRoutine, sideGroups, specDraft, specOf, specPatch
} from '../../src/routines/model';
import { anchorWeek, askParts, daysLabel, draftOf, fillPrompt, isoWeek, nextLabel, runDay, scheduleErrors, scheduleLine, scheduleOf } from '../../src/routines/schedule';

const fr = MESSAGES.fr.routines;
const en = MESSAGES.en.routines;
const T0 = '2026-11-20T08:00:00.000Z';
const routine = (id: string, extra: Partial<Routine> = {}): FleetRoutine => ({
  id, name: `r-${id}`, target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' },
  schedule: { kind: 'recurring', times: ['08:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, prompt: 'Briefing', catchUp: 'once',
  state: 'enabled', createdBy: { kind: 'user' }, createdAt: T0, machineId: 'local', ...extra
});
const task = (id: string, routine: Task['routine']): Task => ({
  id, title: 'x', giver: 's1', giverName: 'Iris', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [], routine
});

describe('the schedule as Desktop reads it', () => {
  const now = new Date(2026, 10, 23, 13, 2);
  it('names the days, the frequency and a one-shot', () => {
    expect(daysLabel(['fri', 'mon', 'tue', 'wed', 'thu'], fr)).toBe('lun–ven');
    expect(daysLabel(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], fr)).toBe('tous les jours');
    expect(daysLabel(['fri', 'mon'], en)).toBe('Mon, Fri');
    expect(scheduleLine({ kind: 'recurring', times: ['08:00', '13:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, fr)).toBe('08:00 13:30 · lun–ven');
    expect(scheduleLine({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, fr)).toBe('jeu 16:00 · 1 sem. sur 2');
    expect(scheduleLine({ kind: 'once', at: ['2026-12-03T16:00'] }, fr)).toBe('unique');
    expect(askParts({ kind: 'recurring', times: ['17:00'], days: ['fri'] }, 'fr', fr)).toEqual({ times: '17:00', days: 'ven' });
  });
  it('says when the next run is: the time alone today, then tomorrow, then the day', () => {
    expect(nextLabel(new Date(2026, 10, 23, 13, 30).toISOString(), now, 'fr', fr, false)).toBe('13:30');
    expect(nextLabel(new Date(2026, 10, 24, 9, 0).toISOString(), now, 'fr', fr, false)).toBe('demain 09:00');
    expect(nextLabel(new Date(2026, 10, 26, 16, 0).toISOString(), now, 'fr', fr, false)).toBe('jeu. 26 16:00');
    expect(nextLabel(new Date(2026, 11, 3, 16, 0).toISOString(), now, 'fr', fr, true)).toBe('3 déc. 16:00');
    expect(runDay(new Date(2026, 10, 24, 8, 0).toISOString(), now, 'fr', fr)).toBe('demain (mar.)');
    expect(runDay(new Date(2026, 10, 22, 8, 0).toISOString(), now, 'en', en)).toBe('yesterday');
  });
  it('names the reference week, across a month too', () => {
    expect(isoWeek(new Date(2026, 10, 27)).week).toBe(48);
    expect(anchorWeek('2026-11-27', 'fr', fr)).toBe('semaine 48, du 23 au 29 novembre');
    expect(anchorWeek('2026-12-03', 'fr', fr)).toBe('semaine 49, du 30 novembre au 6 décembre');
    expect(anchorWeek('2026-11-27', 'en', en)).toBe('week 48, 23–29 Nov');
  });
  it('turns the form back into a schedule, and keeps both kinds while switching', () => {
    const d = draftOf({ kind: 'recurring', times: ['16:30', '08:00'], days: ['fri', 'mon'], every: { weeks: 2, anchor: '2026-11-27' } });
    expect(scheduleOf(d)).toEqual({ kind: 'recurring', times: ['08:00', '16:30'], days: ['mon', 'fri'], every: { weeks: 2, anchor: '2026-11-27' } });
    expect(scheduleOf({ ...d, weeks: 1 })).toEqual({ kind: 'recurring', times: ['08:00', '16:30'], days: ['mon', 'fri'] });
    const once = { ...d, kind: 'once' as const, at: ['2026-12-03T16:00'] };
    expect(scheduleOf(once)).toEqual({ kind: 'once', at: ['2026-12-03T16:00'] });
    expect(scheduleOf({ ...once, kind: 'recurring' }).kind).toBe('recurring');
  });
  it('refuses an empty schedule and a moment past', () => {
    expect(scheduleErrors(draftOf(), now)).toEqual({ times: true, days: true });
    expect(scheduleErrors({ ...draftOf(), kind: 'once', at: ['2026-11-18T10:00', '2026-12-03T16:00'] }, now)).toEqual({ past: ['2026-11-18T10:00'] });
  });
  it('fills the prompt for its preview', () => {
    expect(fillPrompt('Briefing de {slot} (précédent : {last}), journal/{date}.md', new Date(2026, 10, 23, 13, 30).toISOString(), '08:00'))
      .toBe('Briefing de 13:30 (précédent : 08:00), journal/2026-11-23.md');
  });
});

describe('the Routines screens rules', () => {
  it('round-trips a tab ref', () => {
    expect(parseRoutineRef(routineRef({ machineId: 'local', id: 'r1a2b3c' }))).toEqual({ machine: 'local', id: 'r1a2b3c' });
  });
  it('counts the badge: to activate, a change asked, a last run failed; a past one never', () => {
    const failed = { at: T0, slot: '08:00', outcome: 'failed' as const, reason: 'x' };
    expect(routinesBadge([routine('a', { state: 'pending' }), routine('b', { runs: [failed] }), routine('c'),
      routine('d', { proposal: { spec: routine('d'), by: { id: 's', name: 'Iris' }, at: T0 } }), routine('e', { state: 'done', runs: [failed] })])).toBe(3);
  });
  it('groups and orders the sidebar: requests, failures, by next run; paused and past apart; proposals together', () => {
    const now = Date.parse('2026-11-23T12:00:00.000Z');
    const rs = [
      routine('a', { nextRuns: ['2026-11-23T15:00:00.000Z'] }),
      routine('b', { nextRuns: ['2026-11-23T13:00:00.000Z'] }),
      routine('c', { runs: [{ at: T0, slot: '08:00', outcome: 'failed' }], nextRuns: ['2026-11-24T08:00:00.000Z'] }),
      routine('d', { state: 'pending' }),
      routine('p', { state: 'paused' }),
      routine('o1', { state: 'pending', schedule: { kind: 'once', at: ['2026-12-03T16:00'] } }),
      routine('o2', { state: 'pending', schedule: { kind: 'once', at: ['2026-12-07T15:00'] } }),
      routine('o3', { schedule: { kind: 'once', at: ['2026-12-04T09:00'] }, nextRuns: ['2026-12-04T08:00:00.000Z'] }),
      routine('old', { state: 'done', runs: [{ at: '2026-09-01T08:00:00.000Z', slot: '08:00', outcome: 'delivered' }] }),
      routine('past', { state: 'done', runs: [{ at: '2026-11-19T15:00:00.000Z', slot: '16:00', outcome: 'delivered' }] })
    ];
    const proposals = proposalsOf([task('t1', { kind: 'approve', id: 'o1', name: 'r-o1', ids: ['o1', 'o2'] })]);
    const g = sideGroups(rs, proposals, now);
    expect(g.map(x => [x.key, x.count])).toEqual([['recurring', 4], ['once', 3], ['paused', 1], ['past', 1]]);
    expect(g[0]!.rows.map(x => (x.kind === 'routine' ? x.r.id : '-'))).toEqual(['d', 'c', 'b', 'a']);
    expect(g[1]!.rows.map(x => (x.kind === 'routine' ? `${x.r.id}${x.of ? `:${x.of.i}/${x.of.n}` : ''}` : `by ${x.who}`))).toEqual(['by Iris', 'o1:1/2', 'o2:2/2', 'o3']);
  });
  it('finds the session a routine wakes, by machine, name and folder', () => {
    const s = (id: string, extra: Partial<Session>) => ({ id, name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude', state: 'idle', ...extra }) as Session;
    const r = routine('a');
    expect(expandHome('~/assistant/', '/home/jde')).toBe('/home/jde/assistant');
    expect(homeLabel('/home/jde/assistant', '/home/jde')).toBe('~/assistant');
    expect(sessionOfRoutine(r, [s('x', { cwd: '/elsewhere' }), s('y', {})], '/home/jde')?.id).toBe('y');
    expect(sessionOfRoutine(r, [s('z', { machineId: 'srv' })], '/home/jde')).toBeUndefined();
    expect(routinesOfSession(s('y', {}), [r, routine('b', { state: 'done' })], '/home/jde').map(x => x.id)).toEqual(['a']);
  });
  it('makes the « À toi » items: a request while it waits, a failure, a grouped request', () => {
    const rs = [routine('a', { state: 'pending' }), routine('b'), routine('c', { state: 'pending' }), routine('d', { state: 'pending' })];
    const items = atoiRoutineItems([
      task('t1', { kind: 'approve', id: 'a', name: 'r-a' }), task('t2', { kind: 'failed', id: 'b', name: 'r-b', reason: 'x' }),
      task('t3', { kind: 'approve', id: 'c', name: 'r-c', ids: ['c', 'd'] }), task('t4', { kind: 'approve', id: 'b', name: 'r-b' })
    ], rs);
    expect(items.map(i => [i.task.id, i.kind, i.routines.map(r => r.id)])).toEqual([['t1', 'approve', ['a']], ['t2', 'failed', ['b']], ['t3', 'approve', ['c', 'd']]]);
  });
  it('patches only what the form changed, and checks it', () => {
    const r = routine('a');
    const d = specDraft(r);
    expect(specPatch(r, d)).toEqual({});
    const next = { ...d, schedule: { ...d.schedule, times: ['07:30', '08:00'] } };
    expect(specPatch(r, next)).toEqual({ schedule: { kind: 'recurring', times: ['07:30', '08:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] } });
    expect(specOf({ ...d, target: { ...d.target, model: '  ' } }).target).toEqual({ name: 'Iris', cwd: '~/assistant', tool: 'claude' });
    const now = new Date(2026, 10, 23);
    expect(draftErrors(d, [routine('b', { name: 'r-a' })], now)).toEqual({ name: 'taken' });
    expect(draftErrors(specDraft(), [], now)).toMatchObject({ name: 'invalid', session: true, times: true, days: true, prompt: true });
  });
  it('reads a failure that names a field, and a session change before → asked', () => {
    expect(faultyField('dossier introuvable : ~/veille')).toBe('dir');
    expect(faultyField('tool missing: cursor-agent')).toBe('tool');
    expect(faultyField('pas tapée en 30 min (session occupée)')).toBeNull();
    const r = routine('a', { schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon'] } });
    r.proposal = { spec: { ...r, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: ['mon'] } }, by: { id: 's', name: 'Iris' }, at: T0 };
    expect(proposalChanges(r, 'fr', fr)).toEqual([{ label: 'Heures', before: '08:00, 13:30, 16:30', after: '07:30, 13:30, 16:30' }]);
  });
});
