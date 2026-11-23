import { describe, it, expect } from 'vitest';
import type { Routine } from '@ledge/protocol';
import { daysText, routinesOf, scheduleText } from '../src/routine-text.js';

const at = '2026-11-23T08:00:00.000Z';
const routine = (name: string, target: string, cwd: string): Routine => ({ id: 'r0a1b2c', name, target: { name: target, cwd, tool: 'claude' }, schedule: { times: ['08:00'], days: ['mon'] }, prompt: 'p', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: at });

describe('routine text (routines spec §3.3, §3.5, §3.6)', () => {
  it('a session holds the routines aimed at its name, or the name it relieves, in its own folder only', () => {
    const all = [routine('briefing', 'Iris', '/w/assistant'), routine('autre', 'Iris', '/w/ailleurs'), routine('nova', 'Nova', '/w/assistant'), routine('relevee', 'Otto', '/w/assistant')];
    expect(routinesOf(all, { name: 'Iris', cwd: '/w/assistant' }).map(r => r.name)).toEqual(['briefing']);
    expect(routinesOf(all, { name: 'Iris', cwd: '/w/assistant/', relieves: { name: 'Otto' } }).map(r => r.name)).toEqual(['briefing', 'relevee']);
  });

  it('days read as --days does: a run of three or more as a range, every day said so', () => {
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri'], 'fr')).toBe('lun-ven');
    expect(daysText(['fri', 'mon', 'wed'], 'fr')).toBe('lun,mer,ven');
    expect(daysText(['sat', 'sun'], 'en')).toBe('sat,sun');
    expect(daysText(['mon', 'tue', 'wed', 'fri', 'sat', 'sun'], 'en')).toBe('mon-wed,fri-sun');
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], 'fr')).toBe('tous les jours');
  });

  it('times are sorted, the zone named when set', () => {
    expect(scheduleText({ times: ['16:30', '08:00', '13:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, 'fr')).toBe('08:00, 13:30, 16:30 (lun-ven)');
    expect(scheduleText({ times: ['09:00'], days: ['mon'], tz: 'Europe/Brussels' }, 'en')).toBe('09:00 (mon, Europe/Brussels)');
  });
});
