// Issue #3 (docs/mockups/ledge-prs-mine.html): all of the user's MRs and PRs, a role filter with counts, a search, the closed folded.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { Fleet, FleetPullRequest } from '@ledge/fleet';
import { LangProvider } from '../../src/i18n/lang';
import { PrsView } from '../../src/forge/PrsView';
import { useForge } from '../../src/forge/useForge';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const pr = (n: number, extra: Partial<FleetPullRequest> = {}): FleetPullRequest => ({
  id: `github.com/o/r#${n}`, forge: 'github', host: 'github.com', repo: 'o/r', number: n, ref: `#${n}`, url: `https://github.com/o/r/pull/${n}`,
  title: `T${n}`, state: 'open', branch: `b${n}`, target: 'main', headSha: 'a'.repeat(40), pipeline: 'ok', approvals: { given: 1 }, mergeable: true,
  openThreads: 0, updatedAt: `2026-11-17T10:0${n % 10}:00.000Z`, sessions: [], machineId: 'local', ...extra
});
const LIST = [
  pr(1, { title: 'Lot 9', repo: 'ledge', roles: ['author'], sessions: ['local:otto'] }),
  pr(2, { title: 'Polices variables', repo: 'paper-rendering', roles: ['reviewer'] }),
  pr(3, { title: 'Relance S3', repo: 'synapse', roles: ['author', 'assignee'] }),
  pr(4, { title: 'pdf-lib', repo: 'paper-rendering', roles: ['reviewer'] }),
  pr(5, { title: 'Groupes liés', state: 'merged', roles: ['author'], updatedAt: '2026-11-16T09:00:00.000Z' }),
  pr(6, { title: 'Vieux', state: 'closed', roles: ['reviewer'], updatedAt: '2026-11-01T09:00:00.000Z' })
];
const view = (lang: 'fr' | 'en' = 'fr', prs = LIST) => render(
  <LangProvider lang={lang}><PrsView prs={prs} agentOf={p => (p.sessions.length ? 'Otto' : null)} current={null} onOpen={() => {}} now={() => NOW} /></LangProvider>
);
const rows = () => screen.queryAllByRole('button').filter(b => b.classList.contains('fg-row'));

describe('« MR et PR »: all of mine (issue #3)', () => {
  it('lists the open ones, each role as a pill and « branche suivie », the counts of the open ones per role', () => {
    view();
    expect(rows().map(r => r.querySelector('b')?.textContent)).toEqual(['#4', '#3', '#2', '#1']);
    expect([...rows()[1]!.querySelectorAll('.fg-pill')].map(p => p.textContent)).toEqual(['créée', 'assignée']);
    expect([...rows()[3]!.querySelectorAll('.fg-pill')].map(p => p.textContent)).toEqual(['créée', 'branche suivie']);
    const roles = within(screen.getByRole('group', { name: 'Rôle' })).getAllByRole('button');
    expect(roles.map(b => b.textContent)).toEqual(['Toutes4', 'Créées2', 'Assignées1', 'À relire2']);
    expect(roles[0]).toHaveAttribute('aria-pressed', 'true');
  });
  it('filters by role and searches, the counts unchanged; nothing matching offers to clear', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: /^À relire/ }));
    expect(rows().map(r => r.querySelector('b')?.textContent)).toEqual(['#4', '#2']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Chercher : réf, titre, dépôt' }), { target: { value: 'POLICES' } });
    expect(rows().map(r => r.querySelector('b')?.textContent)).toEqual(['#2']);
    expect(screen.getByRole('button', { name: /^Toutes/ }).textContent).toBe('Toutes4');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '!999' } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('Aucune MR ou PR ne correspond.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer le filtre' }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Toutes/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('folds the merged and closed ones of the last 7 days, the filter applying to them', () => {
    view('en');
    const fold = screen.getByRole('button', { name: 'Merged and closed · 1 · last 7 days' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(4);
    fireEvent.click(fold);
    expect(rows().map(r => r.querySelector('b')?.textContent)).toEqual(['#4', '#3', '#2', '#1', '#5']);
    fireEvent.click(screen.getByRole('button', { name: /^To review/ }));
    expect(screen.queryByRole('button', { name: /^Merged and closed/ })).toBeNull();
  });
  it('only closed ones match: no « nothing matches », the fold opens by itself, then back to the user\'s state (review C1)', () => {
    view('en');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'groupes' } });
    expect(screen.queryByText('No MR or PR matches.')).toBeNull();
    const fold = screen.getByRole('button', { name: 'Merged and closed · 1 · last 7 days' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(rows().map(r => r.querySelector('b')?.textContent)).toEqual(['#5']);
    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /^Merged and closed/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '!999' } });
    expect(screen.getByText('No MR or PR matches.')).toBeTruthy();
  });
  it('without any request: the empty state, no filter', () => {
    view('fr', []);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('Aucune MR ni PR ouverte')).toBeTruthy();
  });
});

describe('useForge: the account\'s own requests (issue #3)', () => {
  it('joins the followed and the account\'s own of every machine, one row per request', () => {
    let cb = () => {};
    const followed = pr(1, { sessions: ['local:otto'], roles: ['assignee'] });
    let mine: FleetPullRequest[] = [pr(1, { roles: ['author'], machineId: 'srv' }), pr(2, { roles: ['reviewer'], machineId: 'srv' }), pr(2, { roles: ['reviewer'] })];
    const fleet = { prs: () => [followed], mine: () => mine, forges: () => [], onForge: (f: () => void) => { cb = f; return () => {}; } } as unknown as Fleet;
    const { result } = renderHook(() => useForge(fleet, () => NOW));
    expect(result.current.prs).toHaveLength(1);
    expect(result.current.listed.map(p => [p.number, p.machineId, p.roles])).toEqual([[1, 'local', ['author', 'assignee']], [2, 'srv', ['reviewer']]]);
    mine = [];
    act(() => cb());
    expect(result.current.listed.map(p => p.number)).toEqual([1]);
  });
});
