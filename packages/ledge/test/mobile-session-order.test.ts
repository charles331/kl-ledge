// Issue #16 on the phone (docs/mockups/ledge-reorder.html): the order the daemon keeps, and a long press then drag that changes it.
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, type ClientMessage, type Projects } from '@ledge/protocol';
import { flush, mk, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

const START: Projects = {
  projects: [
    { id: 'api', name: 'API', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/api' }] },
    { id: 'web', name: 'Web', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/web' }, { machine: 'srv', path: '/srv/web' }] }
  ],
  rules: [],
  // A session of another machine (srv:z) sits between this PC's.
  order: { web: ['local:w2', 'srv:z', 'local:w1'] }
};
const SESSIONS = [
  mk('w1', { cwd: '/w/web', startedAt: '2026-11-26T09:00:00.000Z' }), mk('w2', { cwd: '/w/web', startedAt: '2026-11-26T10:00:00.000Z' }),
  mk('w3', { cwd: '/w/web', startedAt: '2026-11-26T11:00:00.000Z' }), mk('a1', { cwd: '/w/api' }), mk('x', { cwd: '/tmp/x' })
];

function make() {
  const box = { state: structuredClone(START) as Projects, orders: [] as Array<{ project: string; ids: string[] }> };
  const g = setup({
    deps: { projects: () => box.state, sessions: () => SESSIONS },
    dispatch: async (msg: ClientMessage) => {
      if (msg.type !== 'sessions.order') return;
      box.orders.push({ project: msg.project, ids: msg.ids });
      box.state = { ...box.state, order: { ...box.state.order, [msg.project]: msg.ids } };
    }
  });
  return { g, box };
}
const outcome = (g: ReturnType<typeof setup>, op: string) => g.results('dev1').filter(r => r.type === 'operation.result' && r.op === op && r.status !== 'received').at(-1);
const send = async (g: ReturnType<typeof setup>, msg: object) => { const op = randomUUID(); g.send('dev1', { ...msg, op }); await flush(); return outcome(g, op); };

describe('the sessions\' order on the phone (#16)', () => {
  it('the snapshot says sessionOrder and carries this PC\'s part of the order, by session id', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = PhoneServerMessageSchema.parse(g.got('dev1').find(m => m.type === 'snapshot'));
    if (snap.type !== 'snapshot') throw new Error('no snapshot');
    expect(snap.daemon.sessionOrder).toBe(true);
    expect(snap.sessionOrder).toEqual({ web: ['w2', 'w1'] });
  });

  it('a new order of this PC\'s sessions of a project: the other machine\'s keeps its place, an unlisted one is placed', async () => {
    const { g, box } = make();
    // On the phone, Web shows w2, w1, then w3 (unlisted, at the bottom): w3 dragged to the top.
    expect(await send(g, { type: 'session.order', project: 'web', ids: ['w3', 'w2', 'w1'] })).toMatchObject({ status: 'applied' });
    expect(box.orders).toEqual([{ project: 'web', ids: ['local:w3', 'srv:z', 'local:w2', 'local:w1'] }]);
    // « Sans projet » too.
    expect(await send(g, { type: 'session.order', project: null, ids: ['x'] })).toMatchObject({ status: 'applied' });
    expect(box.orders.at(-1)).toEqual({ project: '', ids: ['local:x'] });
  });

  it('a session of another project, one gone, twice, or an unknown project: stale, nothing changed', async () => {
    const { g, box } = make();
    for (const m of [{ project: 'web', ids: ['a1'] }, { project: 'web', ids: ['gone'] }, { project: 'web', ids: ['w1', 'w1'] }, { project: 'nope', ids: ['w1'] }]) {
      expect(await send(g, { type: 'session.order', ...m })).toMatchObject({ status: 'rejected', reason: 'stale' });
    }
    expect(box.orders).toEqual([]);
  });
});
