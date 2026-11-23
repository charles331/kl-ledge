// The operator as the daemon runs it (`startServer({ operator: true })`): an event reaches the notch and the phones, a point's row
// answered from a front reaches the point actor, and a Node without `node:sqlite` runs the daemon without the operator.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { DEFAULT_DEVICE_PREFS, pendingKey, type HumanAsk, type MobileState, type PushSend, type ServerMessage, type Session } from '@ledge/protocol';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { MobileService } from '../src/mobile/service.js';
import type { HumanChannelService } from '../src/daemon/openrigHuman.js';
import type { Tmux } from '../src/tmux.js';
import { paths } from '../src/paths.js';
import { authHeaders, until } from './helpers.js';

const T0 = '2026-11-13T10:00:00.000Z';
/** The bottom of a Claude Code 2.x permission dialog, then the turn going on once it is answered. */
const PROMPT = ['x', '─'.repeat(80), ' Bash command', '╌'.repeat(80), ' ls', '╌'.repeat(80), ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n');
function fakeTmux(panes: Record<string, string[]> = {}): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession(o) { panes[o.name] = ['']; }, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { delete panes[n]; }, attachArgs: n => ['attach', n]
  };
}

/** A mobile service with one paired phone, `dev1`, subscribed to pushes: every push the daemon sends is recorded. */
function fakeMobile() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const sub = { endpoint: 'https://push.test/x', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), key: 'K1' };
  const pushes: PushSend[] = [];
  const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'Pixel', approvedAt: T0, online: false }], pairings: [] } as unknown as MobileState;
  const mobile = {
    state: () => state, onChange: () => () => {}, onMessage: () => () => {}, onRecovery: () => () => {}, handle: async () => {}, send: async () => true,
    revoke: async () => {}, rename() {}, deviceInfo: () => ({ label: 'Pixel', kind: 'phone' }), credential: () => null, setCredential() {},
    pushOf: (id: string) => (id === 'dev1' ? sub : null), setPush() {}, prefsOf: () => DEFAULT_DEVICE_PREFS, setPrefs() {},
    relayPushKey: () => 'K1', sendPush: async (m: PushSend) => { pushes.push(m); return { result: 'sent' as const }; }, pcKey: () => 'pc', stop: async () => {}
  } as unknown as MobileService;
  return { mobile, pushes };
}

/** OpenRig installed, its human channel ready: the test pushes new lists of asks. */
function fakeOpenRig() {
  let push: ((l: { channel: { state: 'ready' }; asks: HumanAsk[] }) => void) | null = null;
  const channel = { state: 'ready' as const };
  const human = { async list() { return { channel, asks: [] }; }, async answer(qitemId: string) { return { qitemId, ok: true, outcome: 'answered' as const }; }, start(fn: typeof push) { push = fn; }, stop() {} } as unknown as HumanChannelService;
  const openrig = { async state() { return { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: T0 }; }, peek: () => undefined } as never;
  const goals = { async list() { return { goals: [] }; } } as never;
  return { human, openrig, goals, asks: (asks: HumanAsk[]) => push?.({ channel, asks }), followed: () => push !== null };
}

function open(port: number): Promise<{ ws: WebSocket; got: ServerMessage[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
    const got: ServerMessage[] = [];
    ws.on('message', d => got.push(JSON.parse(String(d)) as ServerMessage));
    ws.once('open', () => res({ ws, got })); ws.once('error', rej);
  });
}

const session: Session = { id: 's1', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'ledge-s1', state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' };

let close: Array<() => Promise<void>> = [];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-opsrv-')); });
afterEach(async () => { for (const c of close.splice(0).reverse()) await c(); });

describe('startServer({ operator: true })', () => {
  it('a request becomes a point in every thread, its notice reaches the notch and is replayed after a later snapshot, and each phone gets one push', async () => {
    const store = new Store();
    const { mobile, pushes } = fakeMobile();
    const tmux = fakeTmux({ 'ledge-s1': [PROMPT, PROMPT, 'Running…'] });
    const srv = await startServer({ store, tmux, port: 0, mobile, operator: true, claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    store.upsert(session);
    store.apply('s1', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'ls' });
    const live = store.get('s1')!.pending!;
    await until(() => a.got.some(m => m.type === 'operator.state' && m.notices.some(n => n.kind === 'point')), 15_000);
    const notice = a.got.filter(m => m.type === 'operator.state').at(-1)!;
    // One push per paired phone, the point's: the request's own push goes first, with its own topic.
    await until(() => pushes.some(p => p.topic === 'point'));
    expect(pushes.filter(p => p.topic === 'point')).toHaveLength(1);
    // A front that connects later gets the notices right after its snapshot.
    const b = await open(srv.port); close.push(async () => { b.ws.close(); });
    await until(() => b.got.some(m => m.type === 'operator.state'));
    const types = b.got.map(m => m.type);
    expect(types.indexOf('operator.state')).toBeGreaterThan(types.indexOf('snapshot'));
    expect(b.got.find(m => m.type === 'operator.state')).toEqual(notice);
    expect(existsSync(join(paths().dir, 'ledge.sqlite'))).toBe(true);

    // A row answered from the PC goes through the point actor: a row it does not know is refused by it, by its code.
    const qid = notice.type === 'operator.state' ? notice.notices.find(n => n.kind === 'point')!.qid! : '';
    a.ws.send(JSON.stringify({ type: 'point.act', qid, item: 'nope', answer: { id: 'deny' } }));
    await until(() => a.got.some(m => m.type === 'error' && m.request === 'point.act'));
    expect(a.got.find(m => m.type === 'error' && m.request === 'point.act')).toMatchObject({ code: 'unknown_item' });
    // Its real row: the request is denied through the session's own decide path, and the notch's notice goes.
    a.ws.send(JSON.stringify({ type: 'point.act', qid, item: `session.request:s1#${pendingKey(live)}`, answer: { id: 'deny' } }));
    await until(() => tmux.sent.length > 0, 10_000);
    const last = () => a.got.filter((m): m is Extract<ServerMessage, { type: 'operator.state' }> => m.type === 'operator.state').at(-1)!;
    await until(() => last().notices.length === 0, 10_000);
  }, 30_000);

  it('a routine\'s firing reaches « le point », and « Relancer » on a failed one runs the routine again (routines spec §3.5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-assistant-'));
    const srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, operator: true, claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    const cmd = (rid: string, body: Record<string, unknown>) => { a.ws.send(JSON.stringify({ type: 'routine.cmd', rid, ...body })); };
    const result = (rid: string) => a.got.find((m): m is Extract<ServerMessage, { type: 'routine.result' }> => m.type === 'routine.result' && m.rid === rid);
    const schedule = { kind: 'recurring', times: ['03:00'], days: ['sun'] };
    // One routine whose session is launched in its folder, one whose folder is gone.
    cmd('a1', { op: 'add', spec: { name: 'briefing', target: { name: 'Iris', cwd: dir, tool: 'claude' }, schedule, prompt: 'Briefing de {slot}' } });
    const gone = mkdtempSync(join(tmpdir(), 'ledge-veille-'));
    cmd('a2', { op: 'add', spec: { name: 'veille', target: { name: 'Nova', cwd: gone, tool: 'claude' }, schedule, prompt: 'Veille' } });
    await until(() => !!result('a1') && !!result('a2'));
    const briefing = result('a1')!.routine!, veille = result('a2')!.routine!;
    expect(veille).toBeDefined();
    rmSync(gone, { recursive: true });
    const lastRun = (id: string) => a.got.filter((m): m is Extract<ServerMessage, { type: 'routine.changed' }> => m.type === 'routine.changed' && m.routine?.id === id).at(-1)?.routine?.lastRun;
    cmd('r1', { op: 'run', routine: briefing.id });
    await until(() => lastRun(briefing.id)?.outcome === 'launched', 10_000);
    // The failure is an « À toi » item, said at once: the wake's point holds it and the firing.
    cmd('r2', { op: 'run', routine: veille.id });
    await until(() => lastRun(veille.id)?.outcome === 'failed', 10_000);
    const pointOf = () => a.got.map(m => JSON.stringify(m)).find(j => j.includes('routine.run:') && j.includes('n\u2019a pas pu partir'));
    await until(() => pointOf() !== undefined, 20_000);
    const turn = JSON.parse(pointOf()!) as Record<string, unknown>;
    const point = (JSON.stringify(turn).match(/"qid":"([^"]+)"/) ?? [])[1]!;
    const items = (JSON.stringify(turn).match(/"id":"(task:[^"]+|routine\.run:[^"]+)"/g) ?? []).map(x => x.slice(6, -1));
    expect(items.some(i => i.startsWith(`routine.run:${briefing.id}@`))).toBe(true);
    expect(JSON.stringify(turn)).toContain('briefing de ');
    const failed = items.find(i => i.startsWith('task:'))!;
    expect(failed).toBeDefined();
    // « Relancer »: the routine fires again (and fails again, its folder still gone), no error comes back.
    const before = a.got.filter(m => m.type === 'routine.changed' && m.routine?.id === veille.id).length;
    a.ws.send(JSON.stringify({ type: 'point.act', qid: point, item: failed, answer: { id: 'retry' } }));
    await until(() => a.got.filter(m => m.type === 'routine.changed' && m.routine?.id === veille.id).length > before, 10_000);
    const runs = a.got.filter((m): m is Extract<ServerMessage, { type: 'routine.changed' }> => m.type === 'routine.changed' && m.routine?.id === veille.id).at(-1)!.routine!.runs;
    expect(runs?.length).toBeGreaterThanOrEqual(2);
    expect(a.got.some(m => m.type === 'error' && m.request === 'point.act')).toBe(false);
  }, 60_000);

  it('a new urgent rig ask is told to the notch and pushed to the phone at once, before any point', async () => {
    const { mobile, pushes } = fakeMobile();
    const rig = fakeOpenRig();
    const srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, mobile, operator: true, human: rig.human, openrig: rig.openrig, goals: rig.goals,
      claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    close.push(() => srv.close());
    await until(() => rig.followed());
    rig.asks([]);
    const ask: HumanAsk = { id: 'qitem-9', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: null }, summary: 'Fusionner ?',
      body: '', bodyTruncated: false, detail: null, evidenceRef: null, createdAt: T0, updatedAt: T0, questions: [] };
    rig.asks([ask]);
    await until(() => pushes.some(p => p.topic === 'ask-qitem-9'));
    expect(pushes.filter(p => p.topic === 'point')).toHaveLength(0);
  }, 20_000);

  it('a Node without node:sqlite runs the daemon without the operator', async () => {
    const srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, operator: true, loadOperator: () => Promise.reject(new Error('No such built-in module: node:sqlite')) });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    expect(a.got.some(m => m.type === 'operator.state')).toBe(false);
    expect(existsSync(join(paths().dir, 'ledge.sqlite'))).toBe(false);
  });
});
