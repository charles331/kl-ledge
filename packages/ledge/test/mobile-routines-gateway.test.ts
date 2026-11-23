// Routines on the phone (routines spec §3.7): the list without prompts, one routine whole before « Activer », and an approval
// bound by the device's check to the routine as the phone showed it.
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ClientMessage, Routine, ServerMessage, Task } from '@ledge/protocol';
import { routineKey } from '../src/mobile/project.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const AT = '2026-11-23T07:00:00.000Z';
const pending: Routine = {
  id: 'r1a2b3c', name: 'prepa-121', target: { name: 'Iris', cwd: '/home/jde/assistant', tool: 'claude' }, schedule: { kind: 'once', at: ['2026-12-03T16:00'] },
  prompt: 'Prépare le 121 de demain.', catchUp: 'once', expiresAfterRun: true, state: 'pending', createdBy: { kind: 'session', id: 'iris', name: 'Iris' }, createdAt: AT
};

function make(o: { code?: 'not_found' | 'not_pending' } = {}) {
  let routines: Routine[] = [pending];
  const cmds: Extract<ClientMessage, { type: 'routine.cmd' }>[] = [];
  const dispatch = async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    if (msg.type !== 'routine.cmd') return;
    cmds.push(msg);
    reply(o.code ? { type: 'routine.result', rid: msg.rid, code: o.code, reason: 'x' } : { type: 'routine.result', rid: msg.rid, routine: { ...pending, state: 'enabled' } });
  };
  const g = setup({ dispatch, deps: { routines: () => routines } });
  return { g, cmds, set: (r: Routine[]) => { routines = r; } };
}
const enroll = async (g: ReturnType<typeof setup>) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const cmd = async (g: ReturnType<typeof setup>, msg: object, op = randomUUID()) => {
  g.send('dev1', { type: 'routine.cmd', op, ...msg });
  await until(() => g.results('dev1').some(r => r.op === op && r.status !== 'received'));
  return g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1);
};

describe('phone routines', () => {
  it('lists them without prompts, and shows one whole', async () => {
    const { g } = make();
    g.send('dev1', { type: 'routine.list' });
    g.send('dev1', { type: 'routine.show', routine: 'r1a2b3c' });
    g.send('dev1', { type: 'routine.show', routine: 'r9f9f9f' });
    await flush();
    const list = g.got('dev1').find(m => m.type === 'routines');
    expect(list?.type === 'routines' && list.routines.map(r => [r.id, 'prompt' in r, r.key])).toEqual([['r1a2b3c', false, routineKey(pending)]]);
    const details = g.got('dev1').filter(m => m.type === 'routine.detail');
    expect(details).toEqual([
      { type: 'routine.detail', id: 'r1a2b3c', routine: expect.objectContaining({ prompt: 'Prépare le 121 de demain.', key: routineKey(pending) }) },
      { type: 'routine.detail', id: 'r9f9f9f', gone: true }
    ]);
  });
  it('fires and pauses as the owner\'s own command, and says why it was refused', async () => {
    const { g, cmds } = make();
    expect(await cmd(g, { action: 'run', routine: 'r1a2b3c' })).toMatchObject({ status: 'applied' });
    expect(cmds.map(c => [c.op, c.routine, c.by])).toEqual([['run', 'r1a2b3c', undefined]]);
    const refused = make({ code: 'not_pending' });
    expect(await cmd(refused.g, { action: 'refuse', routine: 'r1a2b3c' })).toMatchObject({ status: 'rejected', reason: 'not_pending' });
    expect(await cmd(g, { action: 'pause', routine: 'r9f9f9f' })).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
  it('« Activer » needs the key the phone showed and a device check bound to it', async () => {
    const { g, cmds, set } = make();
    const auth = await enroll(g);
    const key = routineKey(pending);
    expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: key })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: 'autre' })).toMatchObject({ status: 'rejected', reason: 'stale' });
    // A challenge for another key is not issued; one for the shown key is.
    g.send('dev1', { type: 'confirm.prepare', purpose: 'routine', routine: 'r1a2b3c', routineKey: 'autre' });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'confirm.challenge')).toHaveLength(1);
    g.send('dev1', { type: 'confirm.prepare', purpose: 'routine', routine: 'r1a2b3c', routineKey: key });
    await flush();
    const ch = g.got('dev1').filter(m => m.type === 'confirm.challenge').at(-1);
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    const assertion = auth.get(rp, ch.challenge, { counter: 1 });
    // The routine changed since: refused, nothing reaches the daemon.
    set([{ ...pending, prompt: 'Supprime tout.' }]);
    expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: key, assertion })).toMatchObject({ status: 'rejected', reason: 'stale' });
    set([pending]);
    expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: key, assertion })).toMatchObject({ status: 'applied' });
    expect(cmds.map(c => c.op)).toEqual(['approve']);
  });
  it('« Activer » a session\'s proposal on an enabled or paused routine, bound to the proposal\'s key', async () => {
    for (const state of ['enabled', 'paused'] as const) {
      const proposed: Routine = { ...pending, state, proposal: { spec: { name: 'prepa-121', target: pending.target, schedule: { kind: 'once', at: ['2026-12-04T09:00'] }, prompt: 'Autre.' }, by: { id: 'iris', name: 'Iris' }, at: AT } };
      const { g, cmds, set } = make();
      set([proposed]);
      const auth = await enroll(g);
      const key = routineKey(proposed);
      expect(key).not.toBe(routineKey({ ...proposed, proposal: undefined }));
      expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: routineKey({ ...proposed, proposal: undefined }) })).toMatchObject({ status: 'rejected', reason: 'stale' });
      g.send('dev1', { type: 'confirm.prepare', purpose: 'routine', routine: 'r1a2b3c', routineKey: key });
      await flush();
      const ch = g.got('dev1').filter(m => m.type === 'confirm.challenge').at(-1);
      if (ch?.type !== 'confirm.challenge' || ch.purpose !== 'routine') throw new Error('no challenge');
      expect(await cmd(g, { action: 'approve', routine: 'r1a2b3c', routineKey: key, assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'applied' });
      expect(cmds.map(c => c.op)).toEqual(['approve']);
    }
    // Nothing waits on a plain enabled routine.
    const plain = make(); const enabled: Routine = { ...pending, state: 'enabled' };
    plain.set([enabled]);
    expect(await cmd(plain.g, { action: 'approve', routine: 'r1a2b3c', routineKey: routineKey(enabled) })).toMatchObject({ status: 'rejected', reason: 'not_pending' });
  });
  it('gives a task\'s routine item only to a phone that asked for the routines (an older phone\'s strict task would refuse the list)', async () => {
    const task: Task = { id: 't1', title: 'Iris veut programmer « prepa-121 »', giver: 'ledge', giverName: 'Ledge', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: AT, updatedAt: AT, log: [],
      routine: { kind: 'approve', id: 'r1a2b3c', name: 'prepa-121' } };
    const g = setup({ tasks: () => [task], deps: { routines: () => [pending] } });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const first = g.got('dev1').filter(m => m.type === 'tasks').at(-1);
    expect(first?.type === 'tasks' && first.tasks[0]).not.toHaveProperty('routine');
    g.send('dev1', { type: 'routine.list' });
    await flush();
    const again = g.got('dev1').filter(m => m.type === 'tasks').at(-1);
    expect(again?.type === 'tasks' && again.tasks[0]!.routine).toEqual({ kind: 'approve', id: 'r1a2b3c', name: 'prepa-121' });
    g.gw.forward({ type: 'task.updated', task });
    await flush();
    const updated = g.got('dev1').filter(m => m.type === 'task.updated').at(-1);
    expect(updated?.type === 'task.updated' && updated.task.routine).toBeDefined();
  });
  it('« Activer les N » of a grouped request: one device check bound to every routine and its key', async () => {
    const second: Routine = { ...pending, id: 'r4d5e6f', name: 'prepa-arch', schedule: { kind: 'once', at: ['2026-12-07T15:00'] } };
    const { g, cmds, set } = make();
    set([pending, second]);
    const auth = await enroll(g);
    const refs = [{ routine: second.id, routineKey: routineKey(second) }];
    g.send('dev1', { type: 'confirm.prepare', purpose: 'routine', routine: pending.id, routineKey: routineKey(pending), routineOthers: refs });
    await flush();
    const ch = g.got('dev1').filter(m => m.type === 'confirm.challenge').at(-1);
    if (ch?.type !== 'confirm.challenge' || ch.purpose !== 'routine') throw new Error('no challenge');
    const assertion = auth.get(rp, ch.challenge, { counter: 1 });
    // A check for both does not cover one alone, nor a changed other.
    expect(await cmd(g, { action: 'approve', routine: pending.id, routineKey: routineKey(pending), others: [{ routine: second.id, routineKey: 'autre' }], assertion })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(await cmd(g, { action: 'approve', routine: pending.id, routineKey: routineKey(pending), others: refs, assertion })).toMatchObject({ status: 'applied' });
    // One command for the group: the daemon answers all or none.
    expect(cmds.map(c => [c.op, c.routine, c.expect, c.others])).toEqual([['approve', pending.id, routineKey(pending), [{ routine: second.id, expect: routineKey(second) }]]]);
    expect(await cmd(g, { action: 'refuse', routine: pending.id, others: refs })).toMatchObject({ status: 'applied' });
    expect(await cmd(g, { action: 'run', routine: pending.id, others: refs })).toMatchObject({ status: 'rejected', reason: 'invalid' });
  });
  it('passes each routine\'s key to the daemon in one command, and says stale when the daemon refuses the group', async () => {
    const second: Routine = { ...pending, id: 'r4d5e6f', name: 'prepa-arch' };
    const sent: Extract<ClientMessage, { type: 'routine.cmd' }>[] = [];
    const g = setup({ dispatch: async (m, reply) => { if (m.type !== 'routine.cmd') return; sent.push(m);
      reply({ type: 'routine.result', rid: m.rid, code: 'stale', reason: 'x' }); }, deps: { routines: () => [pending, second] } });
    const auth = await enroll(g);
    const refs = [{ routine: second.id, routineKey: routineKey(second) }];
    g.send('dev1', { type: 'confirm.prepare', purpose: 'routine', routine: pending.id, routineKey: routineKey(pending), routineOthers: refs });
    await flush();
    const ch = g.got('dev1').filter(m => m.type === 'confirm.challenge').at(-1);
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await cmd(g, { action: 'approve', routine: pending.id, routineKey: routineKey(pending), others: refs, assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(sent.map(c => [c.routine, c.expect, c.others])).toEqual([[pending.id, routineKey(pending), [{ routine: second.id, expect: routineKey(second) }]]]);
  });
  it('forwards each change, without the prompt', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward({ type: 'routine.changed', routine: pending });
    g.gw.forward({ type: 'routine.changed', removed: 'r1a2b3c' });
    await flush();
    const changes = g.got('dev1').filter(m => m.type === 'routine.changed');
    expect(changes).toEqual([{ type: 'routine.changed', routine: expect.objectContaining({ id: 'r1a2b3c', key: routineKey(pending) }) }, { type: 'routine.changed', removed: 'r1a2b3c' }]);
    expect(changes[0]!.type === 'routine.changed' && 'prompt' in changes[0]!.routine!).toBe(false);
  });
});
