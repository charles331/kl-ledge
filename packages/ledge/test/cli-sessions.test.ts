import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { sessionKey } from '../src/auth.js';
import { SESSION_KEY_VAR } from '../src/auth.js';
import { commandArgs, formatStatus, runSessionCommand, runStatus, sessionRow } from '../src/cli/sessions.js';
import { printWho } from '../src/cli/who.js';
import { until } from './helpers.js';

// The sessions managed from a shell: `ledge status --json`, `who --json`, and archive, unarchive, resume, rename, move, delete.

const NOW = Date.parse('2026-11-24T12:00:00Z');
function session(over: Partial<Session>): Session {
  return {
    id: 'a1', name: 'Otto', tool: 'claude', cwd: '/home/u/iptv', project: 'iptv', title: 'iptv', tmuxSession: 'ledge-1', state: 'idle', helpers: [],
    startedAt: '2026-11-24T10:00:00.000Z', lastActivityAt: '2026-11-24T11:57:00.000Z', source: 'launcher', ...over
  } as Session;
}
const projects = { projects: [{ id: 'tv', name: 'IPTV', color: 'blue' as const, description: '', repos: [{ machine: 'local', path: '/home/u/iptv' }] }], rules: [] };

describe('ledge status, offline', () => {
  it('lists every session with its id, the most recently active first, the archived ones only with --all', () => {
    const list = [
      session({}),
      session({ id: 'b2', name: 'Otto', state: 'exited', lastActivityAt: '2026-11-24T08:00:00.000Z', archivedAt: '2026-11-24T09:00:00.000Z' } as Partial<Session>),
      session({ id: 'c3', name: 'Max', cwd: '/home/u/chef', project: 'chef', lastActivityAt: '2026-11-24T11:59:00.000Z', topic: 'on en est où ?' })
    ];
    const text = formatStatus(list, projects, { now: NOW }).split('\n');
    expect(text[0]).toMatch(/^ID\s+NOM\s+OUTIL\s+ÉTAT\s+PROJET\s+ACTIVITÉ\s+SUJET$/);
    expect(text.slice(1).map(l => l.split(/\s+/)[0])).toEqual(['c3', 'a1']);
    expect(text[2]).toMatch(/^a1\s+Otto\s+claude\s+idle\s+IPTV\s+3 min\s+-$/);
    const all = formatStatus(list, projects, { all: true, now: NOW });
    expect(all).toMatch(/b2\s+Otto\s+claude\s+exited · archivée/);
  });

  it('gives an agent what it needs to act by id', () => {
    expect(sessionRow(session({ branch: 'main' }), projects)).toEqual({
      id: 'a1', name: 'Otto', tool: 'claude', state: 'idle', projectId: 'tv', project: 'IPTV', repo: null, cwd: '/home/u/iptv', branch: 'main', topic: null,
      archived: false, readOnly: false, startedAt: '2026-11-24T10:00:00.000Z', lastActivityAt: '2026-11-24T11:57:00.000Z'
    });
  });

  it('parses each command\'s words and flags, and refuses what does not fit', () => {
    expect(commandArgs('archive', ['a1', 'b2', '--close'])).toEqual({ words: ['a1', 'b2'], json: false, yes: false, close: true });
    expect(commandArgs('delete', ['a1', '--yes', '--json'])).toEqual({ words: ['a1'], json: true, yes: true, close: false });
    expect(commandArgs('rename', ['a1', ''])).toEqual({ words: ['a1', ''], json: false, yes: false, close: false });
    expect(commandArgs('move', ['a1', ''])).toBeUndefined();
    expect(commandArgs('rename', ['a1'])).toBeUndefined();
    expect(commandArgs('resume', [])).toBeUndefined();
    expect(commandArgs('resume', ['a1', '--yes'])).toBeUndefined();
    expect(commandArgs('archive', ['a1', '--force'])).toBeUndefined();
  });
});

function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

describe('the commands, against a daemon', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client;
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-clis-'));
    work = mkdtempSync(join(tmpdir(), 'ledge-clis-work-'));
    store = new Store();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    c = await connect({ port: srv.port }); await c.next('snapshot');
  });
  afterEach(async () => { await c.close(); await srv.close(); });

  async function launch(name: string): Promise<string> {
    c.send({ type: 'session.launch', tool: 'claude', cwd: work, name });
    return (await c.next('session.launched', 5000)).id;
  }
  const user = { env: {} as NodeJS.ProcessEnv };
  const as = (id: string) => ({ env: { LEDGE_SESSION: id, [SESSION_KEY_VAR]: sessionKey(id) } as NodeJS.ProcessEnv });

  it('status --json and who --json give the ids', async () => {
    const id = await launch('Ann');
    const status = await runStatus(['--json'], { port: srv.port });
    expect(JSON.parse(status.line)).toEqual([expect.objectContaining({ id, name: 'Ann', archived: false })]);
    expect(JSON.parse(await printWho({ port: srv.port, json: true }))).toEqual([expect.objectContaining({ id, name: 'Ann' })]);
    expect((await runStatus(['--oops'], { port: srv.port })).code).toBe(1);
  });

  it('a session (the chef) closes and archives another, restores it, renames it; deleting stays the user\'s, with --yes', async () => {
    const chef = await launch('Chef');
    const bob = await launch('Bob');
    const archived = await runSessionCommand('archive', ['Bob', '--close'], { port: srv.port, ...as(chef) });
    expect(archived).toMatchObject({ code: 0, line: expect.stringMatching(/fait : Fermer Bob\nfait : Archiver Bob/) });
    await until(() => store.get(bob)?.archivedAt !== undefined);
    expect((await runSessionCommand('unarchive', [bob], { port: srv.port, ...as(chef) })).code).toBe(0);
    await until(() => store.get(bob)?.archivedAt === undefined);
    expect(await runSessionCommand('rename', [chef, 'Le chef'], { port: srv.port, ...as(chef) })).toEqual({ code: 0, line: 'fait : Renommer Chef : Le chef' });

    expect(await runSessionCommand('delete', [bob, '--yes'], { port: srv.port, ...as(chef) })).toMatchObject({ code: 1, line: expect.stringMatching(/^refusé : .*utilisateur/) });
    expect(await runSessionCommand('delete', [bob], { port: srv.port, ...user })).toMatchObject({ code: 1, line: expect.stringContaining('relance avec --yes') });
    expect(await runSessionCommand('delete', [bob, '--yes'], { port: srv.port, ...user })).toMatchObject({ code: 0 });
    await until(() => store.get(bob) === undefined);
  });

  it('stops at the first session that cannot be, and says it in JSON for an agent', async () => {
    const r = await runSessionCommand('resume', ['nobody', '--json'], { port: srv.port, ...user });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.line)).toMatchObject({ ok: false, reason: 'unknown session nobody' });
  });
});
