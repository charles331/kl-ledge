import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerMessageSchema, type Session } from '@ledge/protocol';
import { sessionKey } from '../src/auth.js';
import { createIssue, issueBody, logExcerpt, NEW_ISSUE_URL_MAX, newIssueUrl, scrub } from '../src/daemon/report.js';
import { reportArgs, reporterOf, REPORT_USAGE } from '../src/cli/report.js';
import { parseLedgeCommand } from '../src/cli/send.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { ForgeRun } from '../src/daemon/forge/run.js';
import type { Tmux } from '../src/tmux.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-report-')); process.env.LEDGE_HOME = home; });

describe('what a report carries (no secret, no home)', () => {
  it('scrubs tokens, the home, Windows profiles, other homes and emails', () => {
    const t = scrub('gh token ghp_abcdefghijklmnopqrstuvwxyz0123 in /home/u/x and /mnt/c/Users/Desan/y, C:\\Users\\Desan\\z, /home/bob/w, a@b.be', '/home/u');
    expect(t).not.toMatch(/ghp_|Desan|bob|a@b\.be|\/home\/u/);
    expect(t).toContain('~/x');
    expect(t).toContain('/mnt/c/Users/…/y');
    expect(t).toContain('[email]');
  });
  it('the log excerpt: its last lines only, scrubbed; nothing when the log cannot be read', async () => {
    const f = join(home, 'daemon.log');
    writeFileSync(f, Array.from({ length: 80 }, (_, i) => `line ${i} ${home}/a`).join('\n') + '\n');
    const x = await logExcerpt(f, home, 50);
    expect(x.split('\n')).toHaveLength(50);
    expect(x.split('\n')[0]).toBe('line 30 ~/a');
    expect(x).not.toContain(home);
    expect(await logExcerpt(join(home, 'nope.log'), home)).toBe('');
  });
  it('the body: the sections written, the items kept, the excerpt fenced, who reported it', () => {
    const b = issueBody({ happened: 'Ça plante', expected: 'Que ça marche', repro: '  ' }, [{ key: 'daemon', value: '0.61.0' }, { key: 'tool', value: 'claude' }], 'x ``` y', 'Otto');
    expect(b).toContain('## Ce qui s’est passé\n\nÇa plante');
    expect(b).toContain('## Ce qui était attendu\n\nQue ça marche');
    expect(b).not.toContain('Comment le reproduire');
    expect(b).toContain('- daemon : 0.61.0\n- Outil de la session : claude');
    expect(b).toContain('## Extrait du journal du daemon\n\n```\nx `\u200b`` y\n```');
    expect(b).toContain('_Signalé depuis Ledge par Otto._');
  });
  it('the prefilled page: repository, label, title and body, cut to fit', () => {
    const u = newIssueUrl('feature', 'Une idée', 'corps');
    expect(u).toBe('https://github.com/kl-ledge/ledge/issues/new?labels=enhancement&title=Une%20id%C3%A9e&body=corps');
    expect(newIssueUrl('bug', 't', 'é'.repeat(20000)).length).toBeLessThanOrEqual(NEW_ISSUE_URL_MAX);
  });
  it('never cuts a character in two: emojis wherever the cut falls (review of 2449e9fa)', () => {
    for (let n = 0; n < 400; n++) {
      const u = newIssueUrl('bug', 't', `${'a'.repeat(n)}${'🚀✅'.repeat(4000)}`);
      expect(u.length).toBeLessThanOrEqual(NEW_ISSUE_URL_MAX);
      expect(() => decodeURIComponent(u.split('body=')[1]!)).not.toThrow();
    }
    expect(decodeURIComponent(newIssueUrl('bug', 't', '🚀'.repeat(10)).split('body=')[1]!)).toBe('🚀'.repeat(10));
  });
  it('a title starting with « - » is never read as a flag by gh', async () => {
    const calls: string[][] = [];
    await createIssue({ run: async (_f, args) => { calls.push(args); return { code: 0, stdout: 'https://github.com/kl-ledge/ledge/issues/3', stderr: '' }; }, ready: async () => true }, 'bug', '--help me', 'b');
    expect(calls[0]).toContain('--title=--help me');
  });
});

describe('creating the issue with gh (never a real one here)', () => {
  const fake = (r: { code: number | null; stdout?: string; stderr?: string }) => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const run: ForgeRun = async (_f, args, o = {}) => { calls.push({ args, input: o.input }); return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; };
    return { run, calls };
  };
  it('gh signed in: the issue on kl-ledge/ledge with its label, the body on stdin; its number from the address gh prints', async () => {
    const { run, calls } = fake({ code: 0, stdout: 'https://github.com/kl-ledge/ledge/issues/14\n' });
    expect(await createIssue({ run, ready: async () => true }, 'bug', 'Titre', 'Corps')).toEqual({ ok: true, number: 14, url: 'https://github.com/kl-ledge/ledge/issues/14' });
    expect(calls).toEqual([{ args: ['issue', 'create', '-R', 'kl-ledge/ledge', '--title=Titre', '--label', 'bug', '--body-file', '-'], input: 'Corps' }]);
  });
  it('no gh, or gh signed out: no_gh and the prefilled page, gh never run; a refusal: refused, its message redacted', async () => {
    const a = fake({ code: 0 });
    expect(await createIssue({ run: a.run, ready: async () => false }, 'feature', 'T', 'B')).toMatchObject({ ok: false, code: 'no_gh', url: expect.stringContaining('labels=enhancement') });
    expect(a.calls).toEqual([]);
    const b = fake({ code: 1, stderr: 'could not add label: token ghp_abcdefghijklmnopqrstuvwxyz0123 lacks scope' });
    const r = await createIssue({ run: b.run, ready: async () => true }, 'bug', 'T', 'B');
    expect(r).toMatchObject({ ok: false, code: 'refused', url: expect.stringContaining('/issues/new?') });
    expect(JSON.stringify(r)).not.toContain('ghp_');
    expect(await createIssue({ run: fake({ code: null }).run, ready: async () => true }, 'bug', 'T', 'B')).toMatchObject({ ok: false, code: 'no_gh' });
  });
});

describe('ledge report: its arguments and who it is', () => {
  it('reads bug|feature "<titre>" "<détail>" and status <id>; anything else is the usage', () => {
    expect(reportArgs(['bug', ' Ça plante ', 'détail'])).toEqual({ op: 'give', kind: 'bug', title: 'Ça plante', detail: 'détail' });
    expect(reportArgs(['feature', 'Idée', 'besoin'])).toMatchObject({ op: 'give', kind: 'feature' });
    expect(reportArgs(['status', 't1a2b3c'])).toEqual({ op: 'status', task: 't1a2b3c' });
    for (const a of [[], ['bug'], ['bug', 't'], ['idea', 't', 'd'], ['bug', 't', 'd', 'x'], ['status', 'nope'], ['status']]) expect(reportArgs(a)).toBe(REPORT_USAGE);
    expect(reportArgs(['bug', '   ', 'd'])).toContain('refusé');
  });
  it('a session Ledge launched (id and key), else an OpenRig seat (its name), else nobody', () => {
    expect(reporterOf({ LEDGE_SESSION: 's1', LEDGE_SESSION_KEY: 'k' })).toEqual({ by: 's1', key: 'k' });
    expect(reporterOf({ OPENRIG_SESSION_NAME: 'dev-back@ledge-dev' })).toEqual({ seat: 'dev-back@ledge-dev' });
    expect(reporterOf({ OPENRIG_SESSION_NAME: 'not a seat' })).toBeUndefined();
    expect(reporterOf({})).toBeUndefined();
  });
  it('a Codex agent\'s `ledge report …` is run by its hook', () => {
    expect(parseLedgeCommand('ledge report bug "Ça plante" "en lançant"')).toEqual({ cmd: 'report', args: ['bug', 'Ça plante', 'en lançant'] });
  });
});

describe('reports through the daemon', () => {
  const fakeTmux = (): Tmux => {
    const panes = new Set<string>();
    return { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); },
      async listSessions() { return [...panes]; }, async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
  };
  let srv: Awaited<ReturnType<typeof startServer>>; let c: Client; let store: Store;
  const gh = { calls: [] as string[][], bodies: [] as string[], logins: 0, login: 'paradow\n', answer: { code: 0 as number | null, stdout: 'https://github.com/kl-ledge/ledge/issues/21\n', stderr: '' }, ready: true };
  const srvReport: { run: ForgeRun } = { run: async () => ({ code: 1, stdout: '', stderr: '' }) };
  beforeEach(async () => {
    srvReport.run = async (_f, args, o) => {
      // `gh api user` (the login a preview shows) apart from the creations.
      if (args[0] === 'api') { gh.logins++; return { code: 0, stdout: gh.login, stderr: '' }; }
      gh.calls.push(args); gh.bodies.push(o?.input ?? ''); return gh.answer;
    };
    gh.calls = []; gh.bodies = []; gh.logins = 0; gh.login = 'paradow\n'; gh.answer = { code: 0, stdout: 'https://github.com/kl-ledge/ledge/issues/21\n', stderr: '' }; gh.ready = true;
    store = new Store();
    writeFileSync(join(home, 'daemon.log'), `boot in ${home}/x\n`);
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, home, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }),
      claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))],
      report: { run: (f, args, o) => srvReport.run(f, args, o), ready: async () => gh.ready, system: async () => 'Windows · WSL2 · Ubuntu', logFile: join(home, 'daemon.log') } });
    c = await connect({ port: srv.port }); await c.next('snapshot');
  });
  afterEach(async () => { await c.close(); await srv.close(); });
  const launch = async (name: string) => { c.send({ type: 'session.launch', tool: 'claude', cwd: home, name }); return (await c.next('session.launched', 5000)).id; };

  it('the user\'s own: preview of what is attached (a bug\'s excerpt scrubbed), then the issue, its items but those taken out', async () => {
    const s = await launch('otto');
    c.send({ type: 'report.preview', requestId: 'p', kind: 'bug', session: s, desktop: '0.61.0', log: true });
    const p = await c.next('report.preview.reply', 3000);
    expect(p.items.map(i => i.key)).toEqual(['desktop', 'daemon', 'system', 'tool']);
    expect(p.items.find(i => i.key === 'tool')?.value).toBe('claude');
    expect(p.log).toMatch(/^boot in ~\/x/);
    expect(p.log).not.toContain(home);
    c.send({ type: 'report.preview', requestId: 'p2', kind: 'feature', log: true });
    expect((await c.next('report.preview.reply', 3000)).log).toBeUndefined();
    expect(p.login).toBe('paradow');
    expect(p.logId).toEqual(expect.any(String));
    // Lines written after the preview never go: the excerpt sent is the one shown (review of fda04b1b).
    appendFileSync(join(home, 'daemon.log'), 'secret written after the preview\n');
    c.send({ type: 'report.create', requestId: 'c', kind: 'bug', title: 'Ça plante', fields: { happened: 'x' }, session: s, desktop: '0.61.0', omit: ['system'], log: true, logId: p.logId });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: true, number: 21, url: 'https://github.com/kl-ledge/ledge/issues/21' });
    expect(gh.calls[0]).toEqual(['issue', 'create', '-R', 'kl-ledge/ledge', '--title=Ça plante', '--label', 'bug', '--body-file', '-']);
    expect(gh.bodies[0]).toContain(p.log!);
    expect(gh.bodies[0]).not.toContain('secret written after the preview');
  });

  it('the excerpt shown or none: an unknown logId creates nothing, no logId sends no excerpt', async () => {
    c.send({ type: 'report.create', requestId: 'c', kind: 'bug', title: 'x', fields: { happened: 'x' }, log: true, logId: 'not-a-preview' });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: false, code: 'log_stale' });
    expect(gh.calls).toEqual([]);
    c.send({ type: 'report.create', requestId: 'd', kind: 'bug', title: 'x', fields: { happened: 'x' }, log: true });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: true });
    expect(gh.bodies[0]).not.toContain('Extrait du journal');
    expect(gh.bodies[0]).not.toContain('boot in');
  });

  it('the GitHub login in the preview, read once for a while; none when gh is not signed in or answers nonsense', async () => {
    c.send({ type: 'report.preview', requestId: 'p', kind: 'feature' });
    expect((await c.next('report.preview.reply', 3000)).login).toBe('paradow');
    c.send({ type: 'report.preview', requestId: 'p2', kind: 'feature' });
    expect((await c.next('report.preview.reply', 3000)).login).toBe('paradow');
    expect(gh.logins).toBe(1);
  });
  it('no login when gh is not signed in to github.com', async () => {
    gh.ready = false;
    c.send({ type: 'report.preview', requestId: 'p', kind: 'feature' });
    expect((await c.next('report.preview.reply', 3000)).login).toBeUndefined();
    expect(gh.logins).toBe(0);
  });
  it('no login when gh answers something that is not one', async () => {
    gh.login = '{"message":"Bad credentials"}\n';
    c.send({ type: 'report.preview', requestId: 'p', kind: 'feature' });
    expect((await c.next('report.preview.reply', 3000)).login).toBeUndefined();
  });

  it('without gh: not created, the prefilled page answered; nothing for an unknown agent report', async () => {
    gh.ready = false;
    c.send({ type: 'report.create', requestId: 'c', kind: 'feature', title: 'Idée', fields: { need: 'n' } });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: false, code: 'no_gh', url: expect.stringContaining('github.com/kl-ledge/ledge/issues/new') });
    expect(gh.calls).toEqual([]);
    c.send({ type: 'report.create', requestId: 'd', kind: 'bug', title: 'x', fields: {}, task: 't000000' });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: false, code: 'stale' });
  });

  it('an agent reports: a decision for the user, nothing on GitHub; « Créer l\'issue » creates it and the agent learns its number', async () => {
    const ann = await launch('ann');
    c.send({ type: 'report.agent', rid: 'r1', op: 'give', by: ann, key: sessionKey(ann), report: { kind: 'bug', title: 'Le chat se fige', detail: 'après un envoi' } });
    const given = await c.next('report.agent.result', 3000);
    expect(given.task?.state).toBe('open');
    expect(gh.calls).toEqual([]);
    const id = given.task!.id;
    c.send({ type: 'task.cmd', rid: 'l', by: 'ledge', op: 'show', task: id });
    const t = (await c.next('task.result', 3000)).task!;
    expect(t).toMatchObject({ owner: 'ledge', title: 'Bug : Le chat se fige', report: { kind: 'bug', session: 'Ann' } });
    expect(t.text).toContain('après un envoi');
    c.send({ type: 'report.preview', requestId: 'p', kind: 'bug', task: id });
    expect((await c.next('report.preview.reply', 3000)).items.map(i => [i.key, i.value])).toEqual(expect.arrayContaining([['session', 'Ann'], ['tool', 'claude']]));
    c.send({ type: 'report.create', requestId: 'c', kind: 'bug', title: 'Le chat se fige', fields: { detail: 'après un envoi' }, task: id });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: true, number: 21 });
    c.send({ type: 'report.agent', rid: 'r2', op: 'status', by: ann, key: sessionKey(ann), task: id });
    expect((await c.next('report.agent.result', 3000)).task).toMatchObject({ state: 'done', result: expect.stringContaining('issue #21') });
    // Answered once: a second click is stale.
    c.send({ type: 'report.create', requestId: 'c2', kind: 'bug', title: 'x', fields: {}, task: id });
    expect(await c.next('report.created', 3000)).toMatchObject({ ok: false, code: 'stale' });
  });

  it('« Ignorer »: closed without an issue, the agent told; a wrong key, an unknown seat, past the cap are refused', async () => {
    const ann = await launch('ann');
    c.send({ type: 'report.agent', rid: 'w', op: 'give', by: ann, key: 'wrong', report: { kind: 'bug', title: 't', detail: 'd' } });
    expect((await c.next('report.agent.result', 3000)).reason).toContain('clé');
    c.send({ type: 'report.agent', rid: 'u', op: 'give', seat: 'nobody@nowhere', report: { kind: 'bug', title: 't', detail: 'd' } });
    expect((await c.next('report.agent.result', 3000)).reason).toContain('aucun siège');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      c.send({ type: 'report.agent', rid: `g${i}`, op: 'give', by: ann, key: sessionKey(ann), report: { kind: 'feature', title: `idée ${i}`, detail: 'd' } });
      ids.push((await c.next('report.agent.result', 3000)).task!.id);
    }
    c.send({ type: 'report.agent', rid: 'g6', op: 'give', by: ann, key: sessionKey(ann), report: { kind: 'feature', title: 'encore', detail: 'd' } });
    expect((await c.next('report.agent.result', 3000)).reason).toContain('5 signalements');
    c.send({ type: 'report.ignore', requestId: 'i', task: ids[0]! });
    expect(await c.next('report.ignored', 3000)).toEqual({ type: 'report.ignored', requestId: 'i', ok: true });
    c.send({ type: 'report.agent', rid: 's', op: 'status', by: ann, key: sessionKey(ann), task: ids[0]! });
    expect((await c.next('report.agent.result', 3000)).task).toMatchObject({ state: 'refused', result: expect.stringContaining('ignoré') });
    c.send({ type: 'report.ignore', requestId: 'i2', task: ids[0]! });
    expect(await c.next('report.ignored', 3000)).toMatchObject({ ok: false, code: 'stale' });
    expect(gh.calls).toEqual([]);
  });

  it('an OpenRig seat reports by its name, and reads only its own reports', async () => {
    const seat: Session = { id: 'seat-1', name: 'dev-back', tool: 'claude', cwd: home, project: 'w', title: 'dev-back', tmuxSession: null, state: 'idle', helpers: [],
      startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), source: 'rig', rig: { seat: 'dev-back@ledge-dev', name: 'ledge-dev' } };
    store.upsert(seat);
    c.send({ type: 'report.agent', rid: 'r', op: 'give', seat: 'dev-back@ledge-dev', report: { kind: 'feature', title: 'Une idée', detail: 'le besoin' } });
    const id = (await c.next('report.agent.result', 3000)).task!.id;
    c.send({ type: 'task.cmd', rid: 'l', by: 'ledge', op: 'show', task: id });
    expect((await c.next('task.result', 3000)).task).toMatchObject({ giver: 'seat-1', title: 'Idée : Une idée', report: { session: 'dev-back' } });
    const ann = await launch('ann');
    c.send({ type: 'report.agent', rid: 's', op: 'status', by: ann, key: sessionKey(ann), task: id });
    expect((await c.next('report.agent.result', 3000)).reason).toContain('aucun signalement');
  });

  it('two « Créer l\'issue » at once on one agent report: one issue; « Ignorer » meanwhile is stale too (review of 2449e9fa)', async () => {
    const ann = await launch('ann');
    c.send({ type: 'report.agent', rid: 'r', op: 'give', by: ann, key: sessionKey(ann), report: { kind: 'bug', title: 't', detail: 'd' } });
    const id = (await c.next('report.agent.result', 3000)).task!.id;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const answer = gh.answer;
    srvReport.run = async (_f, args) => { gh.calls.push(args); await gate; return answer; };
    c.send({ type: 'report.create', requestId: 'a', kind: 'bug', title: 't', fields: { detail: 'd' }, task: id });
    await new Promise(r => setTimeout(r, 50));
    c.send({ type: 'report.create', requestId: 'b', kind: 'bug', title: 't', fields: { detail: 'd' }, task: id });
    expect(await c.next('report.created', 3000)).toMatchObject({ requestId: 'b', ok: false, code: 'stale' });
    c.send({ type: 'report.ignore', requestId: 'i', task: id });
    expect(await c.next('report.ignored', 3000)).toMatchObject({ ok: false, code: 'stale' });
    release();
    expect(await c.next('report.created', 3000)).toMatchObject({ requestId: 'a', ok: true });
    expect(gh.calls).toHaveLength(1);
  });

  it('a report given through task.cmd is refused: only report.agent puts one, its cap and origin the daemon\'s', async () => {
    const ann = await launch('ann');
    c.send({ type: 'task.cmd', rid: 'x', by: ann, key: sessionKey(ann), op: 'give', to: 'ledge', report: { kind: 'bug', title: 't', detail: 'd', session: 'autre' } });
    expect((await c.next('task.result', 3000)).reason).toContain('ledge report');
  });

  it('every report message parses as the protocol says', () => {
    for (const m of [{ type: 'report.preview.reply', requestId: 'x', items: [{ key: 'daemon', value: '1' }] }, { type: 'report.created', requestId: 'x', ok: false, code: 'no_gh', url: 'https://github.com/x' },
      { type: 'report.ignored', requestId: 'x', ok: true }, { type: 'report.agent.result', rid: 'x', task: { id: 't', state: 'open' } }]) expect(ServerMessageSchema.safeParse(m).success).toBe(true);
  });
});
