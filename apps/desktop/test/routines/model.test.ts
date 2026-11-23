import { describe, expect, it } from 'vitest';
import type { Routine, Session, Task } from '@ledge/protocol';
import type { FleetRoutine } from '@ledge/fleet';
import { MESSAGES } from '../../src/i18n/messages';
import {
  atoiRoutineItems, draftErrors, expandHome, faultOf, faultyField, refusalOf, whyText, homeLabel, parseRoutineRef, proposalChanges, proposalsOf, routineRef, routinesBadge,
  routinesOfSession, sessionOfRoutine, sideGroups, specDraft, specOf, specPatch
} from '../../src/routines/model';
import { anchorWeek, askLine, daysLabel, draftOf, fillPrompt, isoWeek, nextLabel, runDay, scheduleErrors, scheduleLine, scheduleOf } from '../../src/routines/schedule';

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
    expect(scheduleLine({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, fr)).toBe('jeu. 16:00 · 1 sem. sur 2');
    expect(scheduleLine({ kind: 'once', at: ['2026-12-03T16:00'] }, fr)).toBe('unique');
    expect(askLine({ kind: 'recurring', times: ['17:00'], days: ['fri'] }, 'point-hebdo', '~/assistant', 'fr', fr)).toBe('veut programmer « point-hebdo » : 17:00 (ven), dans ~/assistant');
    // The owner's two texts of 2026-11-23: every other week, and a single one-shot.
    const two = { kind: 'recurring' as const, times: ['16:00'], days: ['thu' as const], every: { weeks: 2 as const, anchor: '2026-11-27' } };
    expect(askLine(two, 'bilan-sprint', '~/assistant', 'fr', fr)).toBe('veut programmer « bilan-sprint » : 16:00 (jeu, 1 sem. sur 2), dans ~/assistant');
    expect(askLine(two, 'bilan-sprint', '~/assistant', 'en', en)).toBe('wants to schedule “bilan-sprint”: 16:00 (Thu, every 2 wks), in ~/assistant');
    expect(askLine({ kind: 'once', at: ['2026-12-03T16:00'] }, 'prépa-121', '~/assistant', 'fr', fr)).toBe('veut programmer « prépa-121 » : jeu. 3 déc. 16:00, dans ~/assistant');
    expect(askLine({ kind: 'once', at: ['2026-12-03T16:00'] }, 'prépa-121', '~/assistant', 'en', en)).toBe('wants to schedule “prépa-121”: Thu 3 Dec 16:00, in ~/assistant');
    // A session's change reads « veut modifier », without the folder (card 29).
    const week = { kind: 'recurring' as const, times: ['07:30', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] as ('mon' | 'tue' | 'wed' | 'thu' | 'fri')[] };
    expect(askLine(week, 'briefing', '~/assistant', 'fr', fr, true)).toBe('veut modifier « briefing » : 07:30, 13:30, 16:30 (lun–ven)');
    expect(askLine(week, 'briefing', '~/assistant', 'en', en, true)).toBe('wants to change “briefing”: 07:30, 13:30, 16:30 (Mon–Fri)');
    expect(askLine({ kind: 'once', at: ['2026-12-03T16:00'] }, 'prépa-121', '~/assistant', 'en', en, true)).toBe('wants to change “prépa-121”: Thu 3 Dec 16:00');
    // Beyond three moments, « … et N autres » (card 28).
    const five = { kind: 'once' as const, at: ['2026-12-31T16:00', '2026-12-03T16:00', '2026-12-10T16:00', '2026-12-17T16:00', '2026-12-24T16:00'] };
    expect(askLine(five, 'point-121', '~/assistant', 'fr', fr)).toBe('veut programmer « point-121 » : jeu. 3 déc. 16:00, jeu. 10 déc. 16:00, jeu. 17 déc. 16:00 et 2 autres, dans ~/assistant');
    expect(askLine(five, 'point-121', '~/assistant', 'en', en)).toBe('wants to schedule “point-121”: Thu 3 Dec 16:00, Thu 10 Dec 16:00, Thu 17 Dec 16:00 and 2 more, in ~/assistant');
  });
  it('says when the next run is: the time alone today, then tomorrow, then the day', () => {
    expect(nextLabel(new Date(2026, 10, 23, 13, 30).toISOString(), now, 'fr', fr)).toBe('13:30');
    expect(nextLabel(new Date(2026, 10, 24, 9, 0).toISOString(), now, 'fr', fr)).toBe('demain 09:00');
    expect(nextLabel(new Date(2026, 10, 26, 16, 0).toISOString(), now, 'fr', fr)).toBe('jeu. 26 16:00');
    // The TUI's rule (design-ux point 7): within six days the weekday, beyond the date, whatever the kind.
    expect(nextLabel(new Date(2026, 10, 29, 16, 0).toISOString(), now, 'fr', fr)).toBe('dim. 29 16:00');
    expect(nextLabel(new Date(2026, 11, 3, 16, 0).toISOString(), now, 'fr', fr)).toBe('3 déc. 16:00');
    expect(nextLabel(new Date(2026, 11, 4, 9, 0).toISOString(), now, 'en', en)).toBe('4 Dec 09:00');
    // The page: « demain » alone, then always the month (cards 3, 4 fixed by 274bbbc7).
    expect(runDay(new Date(2026, 10, 24, 8, 0).toISOString(), now, 'fr', fr)).toBe('demain');
    expect(runDay(new Date(2026, 10, 20, 8, 0).toISOString(), now, 'fr', fr)).toBe('ven. 20 nov.');
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
    // The daemon's `field` (ff7a19c2) wins over the words; the words are only the fallback.
    expect(faultOf({ field: 'tz', reason: 'dossier introuvable' })).toBe('schedule');
    expect(faultOf({ field: 'cwd' })).toBe('dir');
    expect(faultOf({ message: 'dossier introuvable : /x' })).toBe('dir');
    expect(whyText({ field: 'cwd', reason: 'dossier introuvable : /home/jde/veille' }, { cwd: '/home/jde/veille', tool: 'claude' }, () => '~/veille', en)).toBe('folder not found: ~/veille');
    expect(whyText({ reason: 'pas tapée en 30 min' }, { cwd: '/x', tool: 'claude' }, p => p, en)).toBe('pas tapée en 30 min');
    // The daemon's cause (4b5087f2) words a firing not typed in time in the screen's language (card 3).
    expect(whyText({ cause: 'timeout', reason: 'pas remise dans les 30 minutes' }, { cwd: '/x', tool: 'claude' }, p => p, en)).toBe('not typed within 30 min (session busy)');
  });
  it('says each daemon refusal in the front’s words, under its field (card 28)', () => {
    const d = { ...specDraft(routine('a')), name: 'briefing', target: { name: 'Iris', cwd: '~/x', tool: 'cursor' as const, model: 'gpt-9' } };
    const said = (code: string, field: Parameters<typeof refusalOf>[0]['field'], message = 'raison du daemon') => refusalOf({ code, field, message }, d, en);
    expect(said('name_taken', 'name')).toEqual({ part: 'name', text: 'Iris already has a routine “briefing”.' });
    expect(said('invalid', 'cwd')).toEqual({ part: 'dir', text: 'This folder doesn’t exist on this PC.' });
    expect(said('invalid', 'at')).toEqual({ part: 'at', text: 'This moment has already passed.' });
    expect(said('invalid', 'tz', 'fuseau horaire inconnu : Mars/Olympus')).toEqual({ part: 'schedule', text: 'Unknown time zone: Mars/Olympus.' });
    expect(said('invalid', 'session', 'session injoignable')).toEqual({ part: 'session', text: 'This session isn’t responding.' });
    expect(said('forbidden', 'session', 'session hors de Ledge')).toEqual({ part: 'session', text: 'This session isn’t followed by Ledge.' });
    expect(said('forbidden', 'session_untracked', 'quelconque')).toEqual({ part: 'session', text: 'This session isn’t followed by Ledge.' });
    expect(said('invalid', 'tool')).toEqual({ part: 'tool', text: 'Tool not found on this PC: cursor.' });
    expect(said('invalid', 'model')).toEqual({ part: 'model', text: 'Unknown model for cursor: gpt-9.' });
    expect(said('invalid', 'prompt')).toEqual({ part: 'prompt', text: 'The prompt is empty.' });
    expect(said('invalid', 'name')).toEqual({ part: 'name', text: 'Invalid name: letters, digits, dot, hyphen and underscore only.' });
    // A cause the card does not word keeps the daemon's words; no field: the head of the configuration.
    expect(said('not_pending', undefined)).toEqual({ part: null, text: 'raison du daemon' });
    const r = routine('a', { schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon'] } });
    r.proposal = { spec: { ...r, schedule: { kind: 'recurring', times: ['07:30', '13:30', '16:30'], days: ['mon'] } }, by: { id: 's', name: 'Iris' }, at: T0 };
    expect(proposalChanges(r, 'fr', fr)).toEqual([{ label: 'Heures', before: '08:00, 13:30, 16:30', after: '07:30, 13:30, 16:30' }]);
  });
});

describe('« À toi »’s decisions', () => {
  it('leave a routine’s item to the Routines block', async () => {
    const { openDecisions } = await import('../../src/tasks/useTasksApi');
    const plain = { ...task('t0', undefined), routine: undefined };
    expect(openDecisions([plain, task('t1', { kind: 'approve', id: 'r000001', name: 'a' })]).map(t => t.id)).toEqual(['t0']);
  });
});

describe('a routine id is unique per machine only (review HIGH)', () => {
  // The fleet keeps the local daemon's tasks only: a task's routine.id / ids name local routines, even when a remote machine
  // listed first holds a routine with the same id.
  const remote = (id: string, extra: Partial<Routine> = {}) => ({ ...routine(id, extra), machineId: 'lap', name: `lap-${id}` });
  it('« À toi » items resolve on the local machine', () => {
    const rs = [remote('r000001', { state: 'pending' }), remote('r000002', { state: 'pending' }), routine('r000001', { state: 'pending' }), routine('r000002', { state: 'pending' }), remote('r000003'), routine('r000003')];
    const items = atoiRoutineItems([
      task('t1', { kind: 'approve', id: 'r000001', name: 'r-r000001', ids: ['r000001', 'r000002'] }),
      task('t2', { kind: 'failed', id: 'r000003', name: 'r-r000003' })
    ], rs);
    expect(items.map(i => i.routines.map(r => `${r.machineId}:${r.id}`))).toEqual([['local:r000001', 'local:r000002'], ['local:r000003']]);
  });
  it('the sidebar groups a proposal on the local machine only', () => {
    const once = (m: 'lap' | 'local', id: string) => ({ ...(m === 'lap' ? remote(id) : routine(id)), state: 'pending' as const, schedule: { kind: 'once' as const, at: ['2026-12-03T16:00'] } });
    const proposals = proposalsOf([task('t1', { kind: 'approve', id: 'r000001', name: 'r-r000001', ids: ['r000001', 'r000002'] })]);
    const g = sideGroups([once('lap', 'r000001'), once('lap', 'r000002'), once('local', 'r000001'), once('local', 'r000002')], proposals, Date.parse('2026-11-23T12:00:00Z'));
    const rows = g.find(x => x.key === 'once')!.rows.map(x => (x.kind === 'proposed' ? 'proposed' : `${x.r.machineId}:${x.r.id}${x.of ? ' of' : ''}`));
    expect(rows.filter(x => x.endsWith(' of'))).toEqual(['local:r000001 of', 'local:r000002 of']);
    expect(rows.filter(x => x === 'proposed')).toHaveLength(1);
    // Every routine keeps its row: the remote ones with the same ids are not taken for the local ones.
    expect(rows).toEqual(['lap:r000001', 'lap:r000002', 'proposed', 'local:r000001 of', 'local:r000002 of']);
  });
});
