// Issue #15: a name chosen in « Nouvelle session » (docs/mockups/ledge-launch-name.html): what the front shows and the daemon refuses.
import { describe, it, expect } from 'vitest';
import { cleanName, nameHolder, nameRefusal, pickName } from '../src/names.js';

describe('a name given at launch (#15)', () => {
  it('is refused when taken whatever its case, when a numbered session holds its base, or when it is « ledge »', () => {
    expect(nameRefusal(['Otto'], 'otto')).toBe('name_taken');
    expect(nameRefusal(['Otto-2'], 'Otto')).toBe('name_taken');
    expect(nameRefusal([], 'LEDGE')).toBe('name_taken');
    expect(nameRefusal(['Otto'], 'Otto-3')).toBeUndefined();
    expect(nameRefusal(['Otto'], 'RevuePR')).toBeUndefined();
  });
  it('is cleaned as every name first: what the front shows is what the daemon checks; nothing left is no name, not a refusal', () => {
    expect(cleanName('revue PR')).toBe('RevuePR');
    expect(nameRefusal(['RevuePR'], 'revue PR')).toBe('name_taken');
    expect(nameRefusal(['Otto'], ' @!, ')).toBeUndefined();
    // « Laisse vide pour {n} »: the name an empty field gives.
    expect(pickName(['Otto', 'Pim-2'])).toBe('Nova');
  });
  it('names the session that holds it, for « {n} est déjà le nom d\'une session de {projet} »', () => {
    const sessions = [{ name: 'Otto-2', project: 'api' }, { name: 'Pim', project: 'web' }];
    expect(nameHolder(sessions, 'otto')).toEqual({ name: 'Otto-2', project: 'api' });
    expect(nameHolder(sessions, 'PIM')).toEqual({ name: 'Pim', project: 'web' });
    expect(nameHolder(sessions, 'Ledge')).toBeUndefined();
    expect(nameHolder(sessions, 'Nova')).toBeUndefined();
    expect(nameHolder(sessions, '!!')).toBeUndefined();
  });
});
