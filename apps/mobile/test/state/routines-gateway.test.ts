// @vitest-environment node
// The phone's routines against the daemon's real phone gateway (packages/ledge/src/mobile/gateway.ts, contract 7206a97e): the
// store, on a fake link, is wired to the gateway the PC runs; what one sends the other receives.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, PhoneServerMessage, Routine, ServerMessage, Task } from '@ledge/protocol';
import { routineKey } from '../../../../packages/ledge/src/mobile/project';
import { flush, setup as gateway, stopAll } from '../../../../packages/ledge/test/helpers/gateway';
import { softAuthenticator } from '../../../../packages/ledge/test/mobile-soft-authenticator';
import { getAssertion } from '../../src/link/webauthn';
import { setup } from '../screens/setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => true), createCredential: vi.fn(), getAssertion: vi.fn() }));
afterEach(stopAll);

const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const AT = '2026-11-23T07:00:00.000Z';
const once = (id: string, name: string, at: string): Routine => ({
  id, name, target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude' }, schedule: { kind: 'once', at: [at] }, prompt: `Prépare ${name}.`,
  catchUp: 'once', expiresAfterRun: true, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, createdAt: AT
});
const GROUP = [once('r000001', 'prepa-121', '2026-12-03T16:00'), once('r000002', 'prepa-comite-archi', '2026-12-07T15:00'), once('r000003', 'prepa-demo-compart', '2026-12-08T09:30')];
/** The grouped request as the daemon raises it: Ledge's own task, its routine item naming the three. */
const TASK: Task = { id: 't1', title: 'Iris veut programmer 3 routines', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: AT, updatedAt: AT, log: [],
  routine: { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: GROUP.map(r => r.id) } };

/** The gateway with the PC's routines and its task, a device enrolled with a passkey, and the phone's store wired to it. */
async function wired() {
  const cmds: Extract<ClientMessage, { type: 'routine.cmd' }>[] = [];
  const dispatch = async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    if (msg.type !== 'routine.cmd') return;
    cmds.push(msg);
    reply({ type: 'routine.result', rid: msg.rid, routine: { ...GROUP.find(r => r.id === msg.routine)!, state: 'enabled' } });
  };
  const g = gateway({ dispatch, tasks: () => [TASK], deps: { routines: () => GROUP } });
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  let counter = 1;
  vi.mocked(getAssertion).mockImplementation(async ({ challenge }) => auth.get(rp, challenge, { counter: counter++ }));
  const phone = setup();
  // Only what comes after the wiring reaches the phone, and every message the phone sends goes to the gateway, in order.
  let read = g.got('dev1').length;
  let wrote = 0;
  const pump = async () => {
    for (let i = 0; i < 20; i++) {
      while (wrote < phone.sent.length) g.send('dev1', phone.sent[wrote++] as never);
      await flush();
      const got = g.got('dev1');
      if (read === got.length && wrote === phone.sent.length) return;
      while (read < got.length) phone.deliver(got[read++] as PhoneServerMessage);
    }
  };
  return { g, phone, cmds, pump };
}

describe('the phone’s routines against the real gateway', () => {
  it('routine items come in the tasks only once the phone asked for the routines, which it does at every connection', async () => {
    const { g, phone, pump } = await wired();
    // A phone that never sent `routine.list` (an older one): its tasks carry no routine item.
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').filter(m => m.type === 'tasks').at(-1);
    expect(before?.type === 'tasks' && before.tasks[0]).not.toHaveProperty('routine');
    // This phone: its snapshot makes it ask, and the tasks come again with their items.
    phone.sent.length = 0;
    g.send('dev1', { type: 'snapshot.request' });
    await pump();
    expect(phone.of('routine.list')).toHaveLength(1);
    expect(phone.store.getState().tasks.get('t1')?.routine).toEqual(TASK.routine);
    expect(phone.store.getState().routines?.map(r => r.name)).toEqual(GROUP.map(r => r.name));
    // A new connection asks again.
    phone.set('pc_offline');
    phone.set('ready');
    g.send('dev1', { type: 'snapshot.request' });
    await pump();
    expect(phone.of('routine.list')).toHaveLength(2);
  });

  it('« Activer les 3 »: one device check over the three routines and their keys, then each is approved in order', async () => {
    const { g, phone, cmds, pump } = await wired();
    g.send('dev1', { type: 'snapshot.request' });
    await pump();
    const others = GROUP.slice(1).map(r => ({ routine: r.id, routineKey: routineKey(r) }));
    const done = phone.store.approveRoutine('r000001', routineKey(GROUP[0]!), others);
    for (let i = 0; i < 10; i++) { await pump(); await new Promise(r => setTimeout(r, 5)); }
    expect(await done).toEqual({ status: 'applied' });
    expect(phone.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'routine', routine: 'r000001', routineKey: routineKey(GROUP[0]!), routineOthers: others }]);
    expect(vi.mocked(getAssertion)).toHaveBeenCalledTimes(1);
    expect(cmds.map(c => [c.op, c.routine])).toEqual(GROUP.map(r => ['approve', r.id]));
  });
});
