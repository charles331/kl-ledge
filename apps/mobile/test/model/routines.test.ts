import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/copy';
import type { RoutineField } from '@ledge/protocol';
import { coveredIds, failureWhy, nextLine, routineGroups, routineItems, routinesEntry, scheduleView, sessionOf, whenText, wokenSessions } from '../../src/model/routines';
import { openDecisions } from '../../src/model/tasks';
import { session } from './fixtures';
import { at, NOW, oneShot, pointHebdo, routine, routineTask, veille } from './routine-fixtures';

afterEach(() => setLang('fr'));

describe('how a schedule reads on the phone (docs/mockups/ledge-routines.html, cards 17 and 25)', () => {
  it('a weekly routine: its times in order, then its days, a run of days as a range', () => {
    expect(scheduleView(routine().schedule)).toEqual({ card: '08:00, 13:30, 16:30 · lun–ven', ask: '08:00, 13:30, 16:30 (lun–ven)', dated: false, moments: [] });
    expect(scheduleView(pointHebdo().schedule).card).toBe('17:00 · ven');
    expect(scheduleView(pointHebdo().schedule).ask).toBe('17:00 (ven)');
    expect(scheduleView(veille().schedule).card).toBe('18:00 · tous les jours');
    expect(scheduleView({ kind: 'recurring', times: ['09:00'], days: ['mon', 'wed', 'fri'] }).card).toBe('09:00 · lun, mer, ven');
  });

  it('every other week: the day as a date names it, then « 1 semaine sur 2 »; its next run is dated', () => {
    const v = scheduleView({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } });
    expect(v.card).toBe('jeu. 16:00 · 1 semaine sur 2');
    // The request's words, approved by the owner (2026-11-23).
    expect(v.ask).toBe('16:00 (jeu, 1 sem. sur 2)');
    expect(v.dated).toBe(true);
  });

  it('a one-shot: « unique », and each moment by its date, never moved to another zone', () => {
    const v = scheduleView({ kind: 'once', at: ['2026-12-08T09:30', '2026-12-03T16:00'] });
    expect(v.card).toBe('unique');
    expect(v.moments).toEqual(['jeu. 3 déc. 16:00', 'mar. 8 déc. 09:30']);
    expect(scheduleView({ kind: 'once', at: ['2026-12-03T16:00'] }).ask).toBe('jeu. 3 déc. 16:00');
    // Past three moments, the rest counted (card 28).
    expect(scheduleView({ kind: 'once', at: ['2026-12-03T16:00', '2026-12-10T16:00', '2026-12-17T16:00', '2026-12-24T16:00', '2026-12-31T16:00'] }).ask)
      .toBe('jeu. 3 déc. 16:00, jeu. 10 déc. 16:00, jeu. 17 déc. 16:00 et 2 autres');
    expect(v.dated).toBe(true);
  });

  it('in English, as the mockup’s English column', () => {
    setLang('en');
    expect(scheduleView(routine().schedule).card).toBe('08:00, 13:30, 16:30 · Mon–Fri');
    expect(scheduleView(pointHebdo().schedule).ask).toBe('17:00 (Fri)');
    expect(scheduleView(veille().schedule).card).toBe('18:00 · every day');
    expect(scheduleView({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }).card).toBe('Thu 16:00 · every other week');
    expect(scheduleView({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }).ask).toBe('16:00 (Thu, every 2 wks)');
    expect(scheduleView({ kind: 'once', at: ['2026-12-03T16:00'] }).ask).toBe('Thu 3 Dec 16:00');
    expect(scheduleView({ kind: 'once', at: ['2026-12-03T16:00'] }).moments).toEqual(['Thu 3 Dec 16:00']);
  });
});

describe('when a run leaves', () => {
  it('today and tomorrow by name, a later day by its date; a dated schedule always by its date', () => {
    expect(whenText(at(23, 13, 30), NOW)).toBe('aujourd’hui 13:30');
    expect(whenText(at(24, 9, 0), NOW)).toBe('demain 09:00');
    expect(whenText(at(26, 16, 0), NOW)).toBe('jeu. 26 nov. 16:00');
    expect(whenText(at(23, 16, 0), NOW, true)).toBe('lun. 23 nov. 16:00');
  });

  it('a card’s line: « Prochain tir » for a weekly routine, « Prochain : » with the date for a dated one, none without a next run', () => {
    expect(nextLine(routine(), NOW)).toBe('Prochain tir aujourd’hui 13:30');
    expect(nextLine(routine({ schedule: { kind: 'once', at: ['2026-12-04T09:00'] }, nextRun: at(4, 9, 0, 11) }), NOW)).toBe('Prochain : ven. 4 déc. 09:00');
    expect(nextLine(pointHebdo(), NOW)).toBeNull();
  });
});

describe('the list', () => {
  it('waiting on the user first, then failed, then by next run, the paused last; recurring and one-shots apart; no past one-shot', () => {
    const paused = routine({ id: 'r9d8e7f', name: 'nettoyage-branches', state: 'paused', nextRun: undefined });
    const later = routine({ id: 'r5e6f70', name: 'revue-prs', nextRun: at(24, 9, 0) });
    const once = oneShot('r000001', 'rappel-conges', '2026-12-04T09:00', { state: 'enabled', nextRun: at(4, 9, 0, 11) });
    const done = oneShot('r000002', 'prepa-121', '2026-11-19T16:00', { state: 'done' });
    const g = routineGroups([paused, later, routine(), veille(), pointHebdo(), once, done]);
    expect(g.recurring.map(r => r.name)).toEqual(['point-hebdo', 'veille', 'briefing', 'revue-prs', 'nettoyage-branches']);
    expect(g.once.map(r => r.name)).toEqual(['rappel-conges']);
  });

  it('the entry counts the live routines, says the next run (its time alone today), and flags those waiting or failed', () => {
    expect(routinesEntry([routine(), veille(), pointHebdo(), oneShot('r000002', 'x', '2026-11-19T16:00', { state: 'done' })], NOW)).toEqual({ count: 3, next: '13:30', flagged: 2 });
    expect(routinesEntry([routine({ nextRun: at(24, 9, 0) })], NOW).next).toBe('demain 09:00');
    expect(routinesEntry([], NOW)).toEqual({ count: 0, next: null, flagged: 0 });
  });

  it('a routine’s session is found by its name, the live one first; the clock goes on every session a live routine wakes', () => {
    const iris = session('iris', { name: 'Iris', state: 'working' });
    const old = session('iris0', { name: 'Iris', state: 'exited' });
    const lu = session('lu', { name: 'Lu' });
    expect(sessionOf(routine(), [old, iris, lu])?.id).toBe('iris');
    expect([...wokenSessions([routine(), oneShot('r000002', 'x', '2026-11-19T16:00', { state: 'done', target: { name: 'Lu', cwd: '~', tool: 'claude' } })], [iris, lu])]).toEqual(['iris']);
    expect(wokenSessions(null, [iris]).size).toBe(0);
  });
});

describe('why a run did not leave', () => {
  const ran = (field: RoutineField | undefined, reason: string, extra = {}) => veille({ lastRun: { at: '2026-11-22T17:00:00.000Z', slot: '18:00', outcome: 'failed', reason, ...(field ? { field } : {}) }, ...extra });
  it('card 28’s words for every field it names (the daemon’s reasons are French); the daemon’s reason otherwise', () => {
    expect(failureWhy(veille())).toBe('Ce dossier n’existe pas sur ce PC.');
    expect(failureWhy(ran('session', 'Nova tourne hors de Ledge : impossible de lui écrire'))).toBe('Cette session n’est pas suivie par Ledge.');
    expect(failureWhy(ran('session', 'Nova ne peut pas recevoir de texte de Ledge'))).toBe('Cette session ne répond pas.');
    expect(failureWhy(ran('tool', 'outil absent'))).toBe('Outil absent sur ce PC : claude.');
    expect(failureWhy(ran('model', 'modèle inconnu', { target: { name: 'Nova', cwd: '~/veille', tool: 'claude', model: 'opus-9' } }))).toBe('Modèle inconnu pour claude : opus-9.');
    expect(failureWhy(ran('name', 'nom pris'))).toBe('Nova a déjà une routine « veille ».');
    expect(failureWhy(ran('prompt', 'vide'))).toBe('Le prompt est vide.');
    expect(failureWhy(ran('at', 'passé'))).toBe('Ce moment est déjà passé.');
    expect(failureWhy(ran(undefined, 'pas remise dans les 30 minutes'))).toBe('pas remise dans les 30 minutes');
    expect(failureWhy(ran('schedule', 'horaire invalide'))).toBe('horaire invalide');
    setLang('en');
    expect(failureWhy(veille())).toBe('This folder doesn’t exist on this PC.');
    expect(failureWhy(ran('tool', 'outil absent'))).toBe('Tool not found on this PC: claude.');
    expect(failureWhy(undefined, 'raison de la tâche')).toBe('raison de la tâche');
  });
});

describe('the routines’ items of « À toi »', () => {
  it('the open ones, requests before failures, each oldest first, kept out of the chat’s decisions', () => {
    const ask = routineTask('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' });
    const failed = routineTask('t2', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable' }, { at: '2026-11-22T17:00:00.000Z' });
    const closed = routineTask('t3', { kind: 'approve', id: 'r000003', name: 'x' }, { state: 'done' });
    expect(routineItems([failed, ask, closed]).map(t => t.id)).toEqual(['t1', 't2']);
    expect(openDecisions([ask, failed])).toEqual([]);
  });

  it('a grouped request covers its ids, a single one its own', () => {
    expect(coveredIds({ kind: 'approve', id: 'r000001', name: 'a', ids: ['r000001', 'r000002'] })).toEqual(['r000001', 'r000002']);
    expect(coveredIds({ kind: 'approve', id: 'r000001', name: 'a' })).toEqual(['r000001']);
  });
});
