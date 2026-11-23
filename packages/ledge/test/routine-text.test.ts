import { describe, it, expect } from 'vitest';
import type { Routine } from '@ledge/protocol';
import { daysText, routineLive, routinesOf, scheduleText, targetNames } from '../src/routine-text.js';

const at = '2026-11-23T08:00:00.000Z';
const routine = (name: string, target: string, cwd: string): Routine => ({ id: 'r0a1b2c', name, target: { name: target, cwd, tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00'], days: ['mon'] }, prompt: 'p', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: at });

describe('routine text (routines spec §3.3, §3.5, §3.6)', () => {
  it('a session holds the routines aimed at its name, or the name it relieves, in its own folder only', () => {
    const all = [routine('briefing', 'Iris', '/w/assistant'), routine('autre', 'Iris', '/w/ailleurs'), routine('nova', 'Nova', '/w/assistant'), routine('relevee', 'Otto', '/w/assistant')];
    expect(routinesOf(all, { cwd: '/w/assistant', names: ['Iris'] }).map(r => r.name)).toEqual(['briefing']);
    expect(routinesOf(all, { cwd: '/w/assistant/', names: ['Iris', 'Otto'] }).map(r => r.name)).toEqual(['briefing', 'relevee']);
  });

  it('a session answers to every name down its chain of reliefs, as the scheduler reaches its live end (review of b7093994)', () => {
    const iris = { id: 'a', name: 'Iris' };
    const iris2 = { id: 'b', name: 'Iris-2', relieves: { id: 'a', name: 'Iris', at } };
    const iris3 = { id: 'c', name: 'Iris-3', relieves: { id: 'b', name: 'Iris-2', at } };
    const byId = new Map<string, { name: string; relieves?: { id: string; name: string; at: string } }>([['a', iris], ['b', iris2], ['c', iris3]]);
    expect(targetNames(iris3, id => byId.get(id))).toEqual(['Iris-3', 'Iris-2', 'Iris']);
    expect(routinesOf([routine('briefing', 'Iris', '/w/assistant')], { cwd: '/w/assistant', names: targetNames(iris3, id => byId.get(id)) }).map(r => r.name)).toEqual(['briefing']);
    // A predecessor gone from the store still gives the name its relief recorded; the chain stops there.
    expect(targetNames(iris3, id => (id === 'b' ? undefined : byId.get(id)))).toEqual(['Iris-3', 'Iris-2']);
    // A loop (never made by Ledge) ends.
    const loop = new Map([['x', { name: 'X', relieves: { id: 'y', name: 'Y', at } }], ['y', { name: 'Y', relieves: { id: 'x', name: 'X', at } }]]);
    expect(targetNames(loop.get('x')!, id => loop.get(id))).toEqual(['X', 'Y']);
  });

  it('days read as --days does: a run of three or more as a range, every day said so', () => {
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri'], 'fr')).toBe('lun-ven');
    expect(daysText(['fri', 'mon', 'wed'], 'fr')).toBe('lun,mer,ven');
    expect(daysText(['sat', 'sun'], 'en')).toBe('sat,sun');
    expect(daysText(['mon', 'tue', 'wed', 'fri', 'sat', 'sun'], 'en')).toBe('mon-wed,fri-sun');
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], 'fr')).toBe('tous les jours');
  });

  it('every other week names its anchor week; a one-off its moments; a one-off that fired is no longer live (§3.1.1)', () => {
    expect(scheduleText({ kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } }, 'fr')).toBe('16:00 (jeu, une semaine sur deux, semaine du 2026-11-27)');
    expect(scheduleText({ kind: 'recurring', times: ['10:05'], days: ['fri'], every: { weeks: 1, anchor: '2026-11-27' } }, 'en')).toBe('10:05 (fri)');
    expect(scheduleText({ kind: 'once', at: ['2026-12-05T09:00', '2026-12-03T16:00'] }, 'fr')).toBe('une fois : 2026-12-03 16:00, 2026-12-05 09:00');
    expect(scheduleText({ kind: 'once', at: ['2026-12-03T16:00'], tz: 'Europe/Brussels' }, 'en')).toBe('once: 2026-12-03 16:00 (Europe/Brussels)');
    expect(routineLive({ state: 'done' })).toBe(false);
    expect(routineLive({ state: 'paused' })).toBe(true);
  });

  it('times are sorted, the zone named when set', () => {
    expect(scheduleText({ kind: 'recurring', times: ['16:30', '08:00', '13:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, 'fr')).toBe('08:00, 13:30, 16:30 (lun-ven)');
    expect(scheduleText({ kind: 'recurring', times: ['09:00'], days: ['mon'], tz: 'Europe/Brussels' }, 'en')).toBe('09:00 (mon, Europe/Brussels)');
  });
});
