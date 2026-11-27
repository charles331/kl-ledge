// A decision a session put to the user, answered from the phone outside the chat (#40, D2): `task.answer`, confirmed, with the device's
// check bound to that decision and that exact answer, applied through `action.run task.answer`.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage, Task } from '@ledge/protocol';
import { PhoneClientMessageSchema } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

const T0 = '2026-11-27T10:00:00.000Z';
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const decision: Task = { id: 't000001', title: 'Fusionner #309 ?', text: 'oui / non', giver: 'a', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [] };
const proposal: Task = { ...decision, id: 't000002', brain: { kind: 'add', note: 'machines', fact: 'Le Pi a 1 Go' } };
const closed: Task = { ...decision, id: 't000003', state: 'done' };

afterEach(stopAll);

function make(result: (msg: Extract<ClientMessage, { type: 'action.run' }>) => Partial<Extract<ServerMessage, { type: 'action.result' }>> = () => ({})) {
  const asked: ClientMessage[] = [];
  const g = setup({ tasks: () => [decision, proposal, closed], dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    asked.push(msg);
    if (msg.type === 'action.run') reply({ type: 'action.result', rid: msg.rid, action: msg.action, ...result(msg) });
  } });
  return { g, asked };
}
const enroll = async (g: ReturnType<typeof setup>) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' }); await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) }); await flush();
  return auth;
};
const prepare = async (g: ReturnType<typeof setup>, task: string, taskAnswer?: string) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'decision', task, ...(taskAnswer !== undefined ? { taskAnswer } : {}) }); await flush();
  return g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
};
const challenge = async (g: ReturnType<typeof setup>, task: string, taskAnswer: string) => {
  const m = await prepare(g, task, taskAnswer);
  if (m?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(m)}`);
  expect(m.purpose).toBe('decision');
  return m.challenge;
};
const answer = async (g: ReturnType<typeof setup>, msg: object) => {
  const op = randomUUID();
  g.send('dev1', { type: 'task.answer', op, task: decision.id, answer: 'oui', confirmed: true, ...msg }); await flush();
  return g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1);
};

describe('task.answer from the phone', () => {
  it('the schema wants it confirmed and strict, with a non-empty answer', () => {
    const base = { type: 'task.answer', op: randomUUID(), task: 't1', answer: 'oui', confirmed: true };
    expect(PhoneClientMessageSchema.safeParse(base).success).toBe(true);
    expect(PhoneClientMessageSchema.safeParse({ ...base, confirmed: undefined }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, answer: '   ' }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('the snapshot says the daemon takes it', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon.taskAnswer).toBe(true);
  });

  it('needs a passkey, then a check over that decision and that exact answer; applied through action.run task.answer', async () => {
    const { g, asked } = make();
    expect(await answer(g, {})).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const auth = await enroll(g);
    expect(await answer(g, {})).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const other = await challenge(g, decision.id, 'non');
    expect(await answer(g, { assertion: auth.get(rp, other, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const ch = await challenge(g, decision.id, 'oui');
    expect(await answer(g, { assertion: auth.get(rp, ch, { counter: 2 }) })).toMatchObject({ status: 'applied' });
    expect(asked.filter(m => m.type === 'action.run')).toEqual([
      expect.objectContaining({ type: 'action.run', action: 'task.answer', args: { task: decision.id, answer: 'oui' }, confirmed: true })
    ]);
  });

  it('a decision gone or closed is stale, a proposal about the notes is not one (invalid); neither reaches the daemon', async () => {
    const { g, asked } = make();
    expect(await answer(g, { task: 'tnope' })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(await answer(g, { task: closed.id })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(await answer(g, { task: proposal.id })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    // Not confirmed: the schema refuses it, answered on its op.
    expect(await answer(g, { confirmed: undefined })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(asked.some(m => m.type === 'action.run')).toBe(false);
  });

  it('a challenge is issued only for an open decision and an answer', async () => {
    const { g } = make();
    await enroll(g);
    for (const [task, text] of [[proposal.id, 'oui'], [closed.id, 'oui'], ['tnope', 'oui'], [decision.id, undefined]] as const) {
      expect((await prepare(g, task, text))?.type).toBe('error');
    }
  });

  it('a decision closed meanwhile, refused by the daemon, is stale; another failure is failed', async () => {
    let code: string | undefined = 'refused';
    const { g } = make(() => (code ? { code, reason: 'x' } : {}));
    const auth = await enroll(g);
    let n = 1;
    const go = async () => answer(g, { assertion: auth.get(rp, await challenge(g, decision.id, 'oui'), { counter: n++ }) });
    expect(await go()).toMatchObject({ status: 'rejected', reason: 'stale' });
    code = 'failed';
    expect(await go()).toMatchObject({ status: 'failed' });
  });
});
