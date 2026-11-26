// Issue #15: `ledge claude --name` with a name taken is refused, as the daemon's launch refuses it; nothing is spawned.
import { describe, it, expect } from 'vitest';
import type { Session } from '@ledge/protocol';
import { createSession, NameTakenError } from '../src/cli/launch.js';
import type { Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const live = (name: string, extra: Partial<Session> = {}) => ({ id: name.toLowerCase(), name, state: 'idle', ...extra }) as Session;
const daemon = (sessions: Session[]) => ({ send() {}, next: async () => ({ type: 'snapshot', sessions }) }) as unknown as Client;
const tmux = () => { const made: string[] = []; return { made, t: { async newSession(o: { name: string }) { made.push(o.name); } } as unknown as Tmux }; };

describe('ledge <tool> --name (#15)', () => {
  it('a name taken (its case aside, its base held by a numbered session, « ledge ») is refused with a clear message, nothing spawned', async () => {
    const { made, t } = tmux();
    const run = (name: string, sessions: Session[]) => createSession({ tool: 'claude', args: [], name, cwd: '/tmp', tmux: t, client: daemon(sessions) });
    await expect(run('otto', [live('Otto')])).rejects.toThrow(new NameTakenError('Otto'));
    await expect(run('Otto', [live('Otto-2')])).rejects.toThrow('the name Otto is taken (Otto-2 holds it): choose another --name, or leave it out for a free one');
    await expect(run('ledge', [])).rejects.toBeInstanceOf(NameTakenError);
    expect(made).toEqual([]);
  });
  it('a name an ended or archived session had is free again; no name is the first free one, as before', async () => {
    const { made, t } = tmux();
    const s = await createSession({ tool: 'claude', args: [], name: 'Otto', cwd: '/tmp', tmux: t, client: daemon([live('Otto', { state: 'exited' })]) });
    expect(s.name).toBe('Otto');
    const d = await createSession({ tool: 'claude', args: [], cwd: '/tmp', tmux: t, client: daemon([live('Otto')]) });
    expect(d.name).toBe('Pim');
    expect(made).toHaveLength(2);
  });
});
