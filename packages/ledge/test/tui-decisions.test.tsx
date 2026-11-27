import { describe, it, expect } from 'vitest';
import type { ClientMessage, Task } from '@ledge/protocol';
import { openDecisions } from '../src/tui/model/overview.js';
import { until } from './helpers.js';
import { startTui } from './tui-fixture.js';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: `Tâche ${id}`, giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open',
  at: '2026-10-09T16:05:00.000Z', updatedAt: '2026-10-09T16:05:00.000Z', log: [], ...extra
});
const sent = <T extends ClientMessage['type']>(received: ClientMessage[], type: T) => received.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);

describe('tui: the decisions a session puts to the user', () => {
  it('openDecisions: the open ones given to Ledge, in their order; not an answered one, not a task Ledge gave', () => {
    const tasks = [
      task('t000001', { title: 'Fusionner feat/roles ?' }),
      task('t000002', { state: 'done', result: 'Oui' }),
      task('t000003', { giver: 'ledge', giverName: 'Ledge', owner: 'nova', ownerName: 'Nova' }),
      task('t000004', { state: 'taken' }),
      task('t000005', { state: 'refused' })
    ];
    expect(openDecisions(tasks).map(x => x.id)).toEqual(['t000001', 't000004']);
    expect(openDecisions([])).toEqual([]);
  });

  it('the tree marks the asking session « ? », tab reaches it; its Session screen says it under the crumb, and D, the answer, its confirmation send exactly task.answer (#40, PR 3)', async () => {
    const tui = await startTui();
    try {
      await tui.resize(160, 40);
      tui.daemon.push({ type: 'task.updated', task: task('t91b0d4', { giver: 'bix', giverName: 'Bix', title: 'Fusionner feat/roles ?', text: 'Options : oui / non\nLa CI est verte.' }) });
      // No « À toi » box any more: Bix carries an amber « ? » in the tree; the top bar still counts it.
      // The window's title, written after the render, is the harness's last frame: a resize draws the screen again.
      await until(() => tui.frame().includes('3 t’attendent')); await tui.resize(160, 41);
      await until(() => /Bix\? /.test(tui.frame()));
      const f = tui.frame();
      expect(f).not.toContain('À TOI');
      expect(f).toContain('3 t’attendent');
      // tab goes to the sessions that wait, then to the one a decision waits on: D is offered once it is chosen.
      for (let i = 0; i < 4 && !/BIX · /.test(tui.frame()); i++) await tui.press('\t');
      await until(() => /BIX · /.test(tui.frame()));
      expect(tui.frame()).toMatch(/D +répondre à la décision/);
      await tui.press('\r');
      await until(() => tui.frame().includes('Bix te demande : Fusionner feat/roles ? · D répondre à la décision'));
      await tui.press('D');
      await until(() => tui.frame().includes('RÉPONDRE À BIX'));
      // ↵ on an empty field sends nothing.
      await tui.press('\r');
      expect(tui.frame()).not.toContain('UNE RÉPONSE NE SE REPREND PAS');
      await tui.press('Oui, fusionne');
      await tui.press('\r');
      await until(() => tui.frame().includes('UNE RÉPONSE NE SE REPREND PAS'));
      expect(tui.frame()).toContain('Oui, fusionne');
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
      // n goes back to the field, the answer kept; a second ↵ asks again.
      await tui.press('n');
      await until(() => tui.frame().includes('RÉPONDRE À BIX'));
      await tui.press('\r');
      await until(() => tui.frame().includes('UNE RÉPONSE NE SE REPREND PAS'));
      // Any other key (q) neither quits nor sends.
      await tui.press('q');
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
      await tui.press('y');
      await until(() => sent(tui.daemon.received, 'action.run').length === 1);
      const run = sent(tui.daemon.received, 'action.run')[0]!;
      expect(run).toEqual({ type: 'action.run', rid: run.rid, action: 'task.answer', args: { task: 't91b0d4', answer: 'Oui, fusionne' }, confirmed: true });
      expect(sent(tui.daemon.received, 'task.cmd').filter(m => m.op === 'done')).toEqual([]);
      tui.daemon.push({ type: 'action.result', rid: run.rid, action: 'task.answer', reason: 'la décision est déjà répondue' });
      await until(() => tui.frame().includes('Réponse non envoyée : la décision est déjà répondue'));
    } finally { await tui.cleanup(); }
  }, 20_000);

  it('D on the overview answers the selected session\'s decision only; esc in the field leaves it, nothing sent; answered elsewhere, it goes', async () => {
    const tui = await startTui();
    try {
      await tui.resize(160, 40);
      tui.daemon.push({ type: 'task.updated', task: task('t000001', { giver: 'bix', giverName: 'Bix', title: 'Quel port ?' }) });
      // The window's title, written after the render, is the harness's last frame: a resize draws the screen again.
      await until(() => tui.frame().includes('3 t’attendent')); await tui.resize(160, 41);
      await until(() => /Bix\? /.test(tui.frame()));
      // Another session is chosen: D does nothing.
      expect(tui.frame()).not.toMatch(/BIX · /);
      await tui.press('D');
      expect(tui.frame()).not.toContain('RÉPONDRE À');
      for (let i = 0; i < 4 && !/BIX · /.test(tui.frame()); i++) await tui.press('\t');
      await until(() => /BIX · /.test(tui.frame()));
      await tui.press('D');
      await until(() => tui.frame().includes('RÉPONDRE À BIX'));
      await tui.press('5173');
      await tui.press('\u001b');
      await until(() => !tui.frame().includes('RÉPONDRE À BIX'));
      // Answered elsewhere: its mark goes.
      tui.daemon.push({ type: 'task.updated', task: task('t000001', { giver: 'bix', giverName: 'Bix', title: 'Quel port ?', state: 'done', result: '5173' }) });
      await until(() => !/Bix\? /.test(tui.frame()));
      expect(sent(tui.daemon.received, 'action.run')).toEqual([]);
    } finally { await tui.cleanup(); }
  }, 20_000);
});
