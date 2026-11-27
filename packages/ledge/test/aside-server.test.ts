import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ServerMessage, Session } from '@ledge/protocol';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';
import type { Asides } from '../src/daemon/aside.js';
import { authHeaders, until } from './helpers.js';

const T0 = '2026-11-27T10:00:00.000Z';
const DAEMON = { version: '0.64.0', install: 'npm' as const, systemd: true };
function fakeTmux(control: boolean, sent: string[][] = []): Tmux {
  return {
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); }, async capture() { return ''; }, async hasSession() { return true; },
    async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n],
    ...(control ? { controlArgs: (n: string) => ['-L', 'none', '-C', 'attach-session', '-t', `=${n}`] } : {})
  };
}
const codex: Session = { id: 'c1', name: 'Iris', tool: 'codex', cwd: '/w', project: 'w', title: 't', tmuxSession: 'ledge-c1', state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' };

function open(port: number): Promise<{ ws: WebSocket; got: ServerMessage[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
    const got: ServerMessage[] = [];
    ws.on('message', d => got.push(JSON.parse(String(d)) as ServerMessage));
    ws.once('open', () => res({ ws, got })); ws.once('error', rej);
  });
}

let close: Array<() => Promise<void>> = [];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-aside-')); });
afterEach(async () => { for (const c of close.splice(0).reverse()) await c(); });

describe('session.aside on the daemon (#41)', () => {
  it('says DaemonInfo.aside, broadcasts each state of an aside, and replays the kept ones after a later snapshot', async () => {
    const store = new Store();
    store.upsert(codex);
    const srv = await startServer({ store, tmux: fakeTmux(true), port: 0, daemon: DAEMON });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    const b = await open(srv.port); close.push(async () => { b.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    expect(a.got.find(m => m.type === 'snapshot')).toMatchObject({ daemon: { aside: true } });
    // Not Claude Code: refused at once, to every front.
    a.ws.send(JSON.stringify({ type: 'session.aside', id: 'c1', rid: 'r1', question: 'why?' }));
    await until(() => b.got.some(m => m.type === 'session.aside'));
    expect(b.got.find(m => m.type === 'session.aside')).toEqual({ type: 'session.aside', id: 'c1', aside: { rid: 'r1', question: 'why?', askedAt: expect.any(String), state: 'failed', cause: 'unsupported' } });
    const c = await open(srv.port); close.push(async () => { c.ws.close(); });
    await until(() => c.got.some(m => m.type === 'session.aside'));
    const types = c.got.map(m => m.type);
    expect(types.indexOf('session.aside')).toBeGreaterThan(types.indexOf('snapshot'));
  });

  it('without a tmux control client: no DaemonInfo.aside, and an aside is refused', async () => {
    const store = new Store();
    store.upsert({ ...codex, tool: 'claude' });
    const srv = await startServer({ store, tmux: fakeTmux(false), port: 0, daemon: DAEMON });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    expect((a.got.find(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>).daemon?.aside).toBeUndefined();
    a.ws.send(JSON.stringify({ type: 'session.aside', id: 'c1', rid: 'r1', question: 'why?' }));
    await until(() => a.got.some(m => m.type === 'error'));
    expect(a.got.some(m => m.type === 'session.aside')).toBe(false);
  });

  it('while an aside runs (its panel on the pane): a reply is refused busy and typed nowhere; a stop cancels the aside first, then interrupts', async () => {
    const store = new Store();
    store.upsert({ ...codex, id: 'k1', tool: 'claude', tmuxSession: 'ledge-k1', state: 'working' });
    const sent: string[][] = [];
    const order: string[] = [];
    let running = true;
    const asides: Asides = {
      ask() {}, all: () => [], drop() {}, running: () => running,
      cancel: async () => { order.push('cancel'); await new Promise(r => setTimeout(r, 20)); running = false; order.push('cancelled'); }
    };
    const tmux = fakeTmux(true, sent);
    const orig = tmux.sendKeys.bind(tmux);
    tmux.sendKeys = async (n, k) => { order.push(`keys ${k.join(' ')}`); await orig(n, k); };
    const srv = await startServer({ store, tmux, port: 0, daemon: DAEMON, asides });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    a.ws.send(JSON.stringify({ type: 'session.reply', id: 'k1', text: 'a real instruction' }));
    await until(() => a.got.some(m => m.type === 'error'));
    expect(a.got.find(m => m.type === 'error')).toMatchObject({ id: 'k1', code: 'busy' });
    expect(sent).toEqual([]);
    a.ws.send(JSON.stringify({ type: 'session.interrupt', id: 'k1' }));
    await until(() => order.includes('keys Escape'));
    expect(order).toEqual(['cancel', 'cancelled', 'keys Escape']);
  });

  it('a decision on a request that came up during an aside waits for the aside to close its panel, then goes', async () => {
    const store = new Store();
    store.upsert({ ...codex, id: 'k1', tool: 'claude', tmuxSession: 'ledge-k1', state: 'waiting_permission', pending: { kind: 'permission', text: 'Bash: ls', source: 'hook' } as NonNullable<Session['pending']> });
    const order: string[] = [];
    let running = true;
    const asides: Asides = {
      ask() {}, all: () => [], drop() {}, running: () => running,
      cancel: async () => { order.push('cancel'); running = false; }
    };
    const tmux = fakeTmux(true);
    tmux.capture = async () => { order.push('capture'); return ''; };
    const srv = await startServer({ store, tmux, port: 0, daemon: DAEMON, asides });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    a.ws.send(JSON.stringify({ type: 'session.decide', id: 'k1', decision: 'deny' }));
    await until(() => a.got.some(m => m.type === 'error'));
    // No prompt on this fake screen: refused, but only after the aside let the pane go.
    expect(order[0]).toBe('cancel');
    expect(order).toContain('capture');
  });

  it('closing a session during an aside cancels the aside before the close\'s interrupt', async () => {
    const store = new Store();
    store.upsert({ ...codex, id: 'k1', tool: 'claude', tmuxSession: 'ledge-k1', state: 'working' });
    const order: string[] = [];
    let running = true;
    const asides: Asides = {
      ask() {}, all: () => [], drop() {}, running: () => running,
      cancel: async () => { order.push('cancel'); await new Promise(r => setTimeout(r, 20)); running = false; order.push('cancelled'); }
    };
    const tmux = fakeTmux(true);
    tmux.sendKeys = async (_n, k) => { order.push(`keys ${k.join(' ')}`); };
    const srv = await startServer({ store, tmux, port: 0, daemon: DAEMON, asides, close: { freeMs: 50, exitMs: 50 } });
    close.push(() => srv.close());
    void srv.closeSession('k1').catch(() => undefined);
    await until(() => order.some(o => o.startsWith('keys')));
    expect(order.slice(0, 3)).toEqual(['cancel', 'cancelled', order.find(o => o.startsWith('keys'))]);
  });
});
