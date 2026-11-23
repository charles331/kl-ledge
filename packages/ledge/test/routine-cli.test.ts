import { describe, it, expect } from 'vitest';
import type { ClientMessage, Routine, ServerMessage } from '@ledge/protocol';
import type { Client } from '../src/client.js';
import { formatList, formatRoutine, langOf, parseDays, patchOf, routineArgs, routineOnClient } from '../src/cli/routine.js';

const AT = '2026-11-20T06:00:00.000Z';
const routine: Routine = {
  id: 'r1a2b3c', name: 'briefing', target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude' },
  schedule: { kind: 'recurring', times: ['08:00', '13:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], tz: 'Europe/Brussels' },
  prompt: 'Briefing de {slot}.', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: AT,
  runs: [{ at: '2026-11-20T07:40:00.000Z', slot: '08:00', slotAt: '2026-11-20T07:00:00.000Z', outcome: 'resumed', late: true }],
  lastRun: { at: '2026-11-20T07:40:00.000Z', slot: '08:00', slotAt: '2026-11-20T07:00:00.000Z', outcome: 'resumed', late: true },
  nextRun: '2026-11-20T12:30:00.000Z', nextRuns: ['2026-11-20T12:30:00.000Z', '2026-11-23T07:00:00.000Z', '2026-11-23T12:30:00.000Z']
};

/** A client whose daemon answers `routine.list` with `list` and each `routine.cmd` with `answer`. */
function fake(list: Routine[], answer: (m: Extract<ClientMessage, { type: 'routine.cmd' }>) => Extract<ServerMessage, { type: 'routine.result' }>) {
  const sent: ClientMessage[] = []; const inbox: ServerMessage[] = [];
  const client: Client = {
    send: m => {
      sent.push(m);
      if (m.type === 'routine.list') inbox.push({ type: 'routine.listed', rid: m.rid, routines: list });
      if (m.type === 'routine.cmd') inbox.push(answer(m));
    },
    next: async <T extends ServerMessage['type']>(type: T) => {
      const i = inbox.findIndex(x => x.type === type);
      if (i < 0) throw new Error(`no ${type}`);
      return inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
    },
    nextOf: async () => { throw new Error('unused'); },
    close: async () => {}
  };
  return { client, sent };
}
const ok = (routine_: Routine) => (m: Extract<ClientMessage, { type: 'routine.cmd' }>) => ({ type: 'routine.result' as const, rid: m.rid, routine: routine_ });

describe('ledge routine: arguments', () => {
  it('add: the spec as the spec writes it, a relative folder from here, ~ left to the daemon', () => {
    expect(routineArgs(['add', 'briefing', '--session', 'Iris', '--cwd', '~/assistant', '--at', '08:00,13:30,16:30', '--days', 'mon-fri', '--', 'Briefing', 'de', '{slot}'], '/w')).toEqual({
      op: 'add', spec: { name: 'briefing', target: { name: 'Iris', cwd: '~/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00', '13:30', '16:30'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, prompt: 'Briefing de {slot}' }
    });
    expect(routineArgs(['add', 'b', '--session', 'Iris', '--cwd', 'assistant', '--at', '08:00', '--days', 'daily', '--tool', 'codex', '--model', 'gpt-5', '--catch-up', 'skip', '--tz', 'Europe/Paris', '--', 'x'], '/w')).toMatchObject({
      spec: { target: { cwd: '/w/assistant', tool: 'codex', model: 'gpt-5' }, schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], tz: 'Europe/Paris' }, catchUp: 'skip' }
    });
  });
  it('every two weeks takes its anchor; without it there is no schedule', () => {
    const two = routineArgs(['add', 'bilan-sprint', '--session', 'Iris', '--cwd', '/a', '--at', '16:00', '--days', 'thu', '--every', '2w', '--anchor', '2026-11-27', '--', 'x']);
    expect(two).toMatchObject({ spec: { schedule: { kind: 'recurring', every: { weeks: 2, anchor: '2026-11-27' } } } });
    expect(routineArgs(['add', 'b', '--session', 'Iris', '--cwd', '/a', '--at', '16:00', '--days', 'thu', '--every', '2w', '--', 'x'])).toBeUndefined();
    expect(routineArgs(['add', 'b', '--session', 'Iris', '--cwd', '/a', '--at', '16:00', '--days', 'thu', '--every', '3w', '--anchor', '2026-11-27', '--', 'x'])).toBeUndefined();
  });
  it('once: one or several moments, and nothing of a recurring schedule', () => {
    expect(routineArgs(['once', 'prepa-121', '--session', 'Iris', '--cwd', '/a', '--on', '2026-12-03T16:00,2026-12-10T16:00', '--', 'Prépare'])).toMatchObject({
      op: 'add', spec: { schedule: { kind: 'once', at: ['2026-12-03T16:00', '2026-12-10T16:00'] } }
    });
    expect(routineArgs(['once', 'p', '--session', 'Iris', '--cwd', '/a', '--on', '2026-12-03 16:00', '--', 'x'])).toBeUndefined();
    expect(routineArgs(['once', 'p', '--session', 'Iris', '--cwd', '/a', '--on', '2026-12-03T16:00', '--at', '08:00', '--', 'x'])).toBeUndefined();
    expect(routineArgs(['add', 'p', '--session', 'Iris', '--cwd', '/a', '--on', '2026-12-03T16:00', '--', 'x'])).toBeUndefined();
  });
  it('refuses what does not fit: no prompt, a bad time, an unknown flag, a missing session', () => {
    const base = ['add', 'b', '--session', 'Iris', '--cwd', '/a', '--at', '08:00', '--days', 'mon'];
    expect(routineArgs(base)).toBeUndefined();
    expect(routineArgs([...base.slice(0, 7), '8:00', '--days', 'mon', '--', 'x'])).toBeUndefined();
    expect(routineArgs([...base, '--color', 'red', '--', 'x'])).toBeUndefined();
    expect(routineArgs(['add', 'b', '--cwd', '/a', '--at', '08:00', '--days', 'mon', '--', 'x'])).toBeUndefined();
    expect(routineArgs(['run'])).toBeUndefined();
    expect(routineArgs(['list', 'x'])).toBeUndefined();
  });
  it('reads the days as --days writes them', () => {
    expect(parseDays('mon,wed,fri')).toEqual(['mon', 'wed', 'fri']);
    expect(parseDays('tue-thu,sat')).toEqual(['tue', 'wed', 'thu', 'sat']);
    expect(parseDays('fri-mon')).toBeUndefined();
    expect(parseDays('lun')).toBeUndefined();
  });
  it('edit: the flags over the routine as it is', () => {
    const edit = routineArgs(['edit', 'briefing', '--at', '09:00']);
    expect(edit?.op === 'edit' && patchOf(edit.flags, routine)).toEqual({ schedule: { kind: 'recurring', times: ['09:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'], tz: 'Europe/Brussels' } });
    const two = routineArgs(['edit', 'briefing', '--every', '2w', '--anchor', '2026-11-27']);
    expect(two?.op === 'edit' && patchOf(two.flags, routine)).toMatchObject({ schedule: { every: { weeks: 2, anchor: '2026-11-27' } } });
    const prompt = routineArgs(['edit', 'briefing', '--name', 'matin', '--', 'Nouveau']);
    expect(prompt?.op === 'edit' && patchOf(prompt.flags, routine)).toEqual({ name: 'matin', prompt: 'Nouveau' });
    const back = routineArgs(['edit', 'briefing', '--every', '2w']);
    expect(back?.op === 'edit' && patchOf(back.flags, routine)).toBeUndefined();
  });
});

describe('ledge routine: words', () => {
  it('speaks French when asked, English otherwise', () => {
    expect(langOf({ LANG: 'fr_BE.UTF-8' })).toBe('fr');
    expect(langOf({ LEDGE_LANG: 'en', LANG: 'fr_BE.UTF-8' })).toBe('en');
    expect(langOf({})).toBe('en');
  });
  it('lists a routine with its next 3 firings and its last one, late', () => {
    expect(formatList([routine], 'fr')).toBe([
      'r1a2b3c  briefing  active  Iris  08:00, 13:30 · lun–ven (Europe/Brussels)',
      '         prochains : ven. 20/11 13:30, lun. 23/11 08:00, lun. 23/11 13:30',
      '         dernier : ven. 20/11 08:00 reprise (en retard, ven. 20/11 08:40)'
    ].join('\n'));
    expect(formatList([routine], 'en')).toContain('last: Fri 20/11 08:00 resumed (late, Fri 20/11 08:40)');
    expect(formatList([], 'fr')).toBe('aucune routine');
  });
  it('shows a routine whole, its proposal and its prompt', () => {
    const shown = formatRoutine({ ...routine, proposal: { spec: { ...routine, schedule: { kind: 'once', at: ['2026-12-03T16:00'] } }, by: { id: 'iris', name: 'Iris' }, at: AT } }, 'fr');
    expect(shown).toContain('modification demandée par Iris : unique : 2026-12-03 16:00');
    expect(shown.endsWith('prompt :\nBriefing de {slot}.')).toBe(true);
  });
});

describe('ledge routine: against the daemon', () => {
  it('from a session: in its name, with its key, and says the routine waits for the user', async () => {
    const pending = { ...routine, state: 'pending' as const, createdBy: { kind: 'session' as const, id: 'iris', name: 'Iris' } };
    const { client, sent } = fake([], ok(pending));
    const r = await routineOnClient(client, ['add', 'briefing', '--session', 'Iris', '--cwd', '/a', '--at', '08:00', '--days', 'mon', '--', 'x'], { by: 'iris', key: 'k', ms: 100, lang: 'fr' });
    expect(r).toEqual({ line: "routine briefing (r1a2b3c) proposée : elle attend l'accord de l'utilisateur dans « À toi »", code: 0 });
    expect(sent[0]).toMatchObject({ type: 'routine.cmd', op: 'add', by: 'iris', key: 'k' });
  });
  it('from a terminal: as the user; an edit goes as an update of the routine found, a proposal said as such', async () => {
    const { client, sent } = fake([routine], ok({ ...routine, proposal: { spec: routine, by: { id: 'iris', name: 'Iris' }, at: AT } }));
    const r = await routineOnClient(client, ['edit', 'briefing', '--at', '09:00'], { ms: 100, lang: 'en' });
    expect(r.line).toBe('change to briefing proposed: the routine goes on as before until the user approves it in « À toi »');
    const update = sent.find(m => m.type === 'routine.cmd');
    expect(update).toMatchObject({ op: 'update', routine: 'r1a2b3c', patch: { schedule: { times: ['09:00'] } } });
    expect(update && 'by' in update).toBe(false);
  });
  it('says a refusal with its reason', async () => {
    const { client } = fake([], m => ({ type: 'routine.result', rid: m.rid, code: 'not_found', reason: 'aucune routine zzz' }));
    expect(await routineOnClient(client, ['pause', 'zzz'], { ms: 100, lang: 'fr' })).toEqual({ line: 'refusé : aucune routine zzz', code: 1 });
  });
  it('show finds a routine by name or id', async () => {
    const { client } = fake([routine], ok(routine));
    expect((await routineOnClient(client, ['show', 'briefing'], { ms: 100, lang: 'fr' })).line).toContain('briefing (r1a2b3c) · active');
  });
});
