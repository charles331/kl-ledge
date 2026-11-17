// Issue #1 (docs/mockups/ledge-background-work.html): background work no longer looks like rest, in « Projets » and in « Rigs ».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Helper, OpenRigState, Rig, RigSeat, Session } from '@ledge/protocol';
import { newestCommand, restingWithWork } from '../src/session/background';
import { rigsViewOf } from '../src/ide/rigs/model';
import { boot, closeDaemons, PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

const NOW = new Date().toISOString();
const helper = (id: string, state: Helper['state']): Helper => ({ id, kind: 'Explore', task: 'Cherche', state });
const cmd = (id: string, label: string) => ({ id, label, since: NOW });

describe('restingWithWork', () => {
  it('an available session with subagents at work or a background command; nothing at work, waiting, ended or offline', () => {
    expect(restingWithWork(fakeSession('a', { state: 'idle', helpers: [helper('h', 'working')] }))).toEqual({ subagents: 1, commands: [] });
    expect(restingWithWork(fakeSession('a', { state: 'idle', background: [cmd('c', 'Lancer la suite e2e')] }))?.commands).toHaveLength(1);
    expect(restingWithWork(fakeSession('a', { state: 'idle', helpers: [helper('h', 'idle')] }))).toBeUndefined();
    expect(restingWithWork(fakeSession('a', { state: 'working', helpers: [helper('h', 'working')] }))).toBeUndefined();
    expect(restingWithWork(fakeSession('a', { state: 'waiting_input', helpers: [helper('h', 'working')] }))).toBeUndefined();
    expect(restingWithWork(fakeSession('a', { state: 'exited', background: [cmd('c', 'x')] }))).toBeUndefined();
    expect(restingWithWork({ ...fakeSession('a', { state: 'idle', helpers: [helper('h', 'working')] }), offline: true })).toBeUndefined();
  });
  it('the command line: the newest, and how many others', () => {
    expect(newestCommand([cmd('1', 'old'), cmd('2', 'new')])).toEqual({ label: 'new', others: 1 });
    expect(newestCommand([])).toBeUndefined();
  });
});

describe('« Projets »: the session, then the project', () => {
  const NOVA = fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'idle', topic: 'Relire la PR', helpers: [helper('h1', 'working'), helper('h2', 'working')] });
  const PIM = fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle', topic: 'Suite e2e', background: [cmd('c1', 'Build'), cmd('c2', 'Lancer la suite e2e')] });
  const IDA = fakeSession('ida', { name: 'Ida', cwd: '/w/ledge', tool: 'codex', state: 'idle', topic: 'Captures' });
  const OTTO = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Tests', helpers: [helper('h3', 'working')] });

  it('rings the available ones with work in the background, says why on hover, blues the counter, shows the command, counts them on the project', async () => {
    const { side } = await boot({ projects: PROJECTS, sessions: [NOVA, PIM, IDA, OTTO] });
    const box = within(side.getByRole('region', { name: 'Projects' }));
    const row = (name: string) => box.getByRole('button', { name: new RegExp(`^${name}`) }).closest('.st-row') as HTMLElement;
    await waitFor(() => expect(row('Nova')).toBeTruthy());
    expect(row('Nova').querySelector('.st-bg-ring')).not.toBeNull();
    expect(row('Pim').querySelector('.st-bg-ring')).not.toBeNull();
    expect(row('Ida').querySelector('.st-bg-ring')).toBeNull();
    // At work: its own dot says it; no ring, but its subagent's counter is blue.
    expect(row('Otto').querySelector('.st-bg-ring')).toBeNull();
    expect(row('Otto').querySelector('.st-kids.on')).not.toBeNull();
    expect(box.getByRole('button', { name: /^Nova/ })).toHaveAttribute('title', 'Available, but 2 subagents are still working.');
    const kids = row('Nova').querySelector('.st-kids')!;
    expect(kids).toHaveClass('on');
    expect(kids).toHaveAttribute('title', '2 subagents, 2 working');
    expect(box.getByRole('button', { name: /^Pim/ })).toHaveAttribute('title', 'Available, but a command started in the background is still running: “Lancer la suite e2e”. Ledge can’t tell when it will finish.');
    expect(row('Pim').querySelector('.st-bgcmd')?.textContent).toBe('Lancer la suite e2e · in the background +1');
    const bg = document.querySelector('.st-project .st-tally .t-bg');
    expect(bg?.textContent).toBe('2');
    expect(bg).toHaveAttribute('title', '2 in the background');
  });
});

describe('« Rigs »: the seat, then the rig', () => {
  const seat = (logicalId: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@ledge-dev`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
  const rig = (nodes: RigSeat[]): Rig => ({ id: 'ledge-dev', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: nodes.length, running: nodes.length, attention: 0, uptime: null, snapshot: null, nodes });
  const state = (nodes: RigSeat[]): OpenRigState => ({ installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: NOW, rigs: [rig(nodes)] });
  const joined = (id: string, seatName: string, o: Partial<Session>) => fakeSession(id, { name: id, machineId: 'local', rig: { seat: seatName, name: 'ledge-dev' }, ...o });

  it('a seat available with work in the background is « bg »; its rig counts them and keeps its own dot', () => {
    const sessions = [joined('front', 'dev-front@ledge-dev', { state: 'idle', helpers: [helper('h', 'working')] }), joined('back', 'dev-back@ledge-dev', { state: 'idle' })];
    const v = rigsViewOf({ state: state([seat('dev.front', { session: 'dev-front@ledge-dev' }), seat('dev.back', { session: 'dev-back@ledge-dev' })]), machine: 'local', sessions, asks: [] });
    const r = v.rigs[0]!;
    expect(r.seats.map(s => s.dot)).toEqual(['bg', 'idle']);
    expect(r.background).toBe(1);
    expect(r.dot).toBe('idle');
  });
});
