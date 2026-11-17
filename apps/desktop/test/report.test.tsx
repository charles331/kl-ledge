// Issue #9 (docs/mockups/ledge-report.html): « Signaler », its form, and an agent's report in « À toi ».
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, Task } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { clearReportDraft } from '../src/report/api';
import { ReportDecision } from '../src/report/ReportDecision';
import { ReportDialog } from '../src/report/ReportDialog';

afterEach(() => { cleanup(); clearReportDraft(); });

const ITEMS = [{ key: 'desktop', value: '0.60.1' }, { key: 'daemon', value: '0.60.1' }, { key: 'system', value: 'Windows 11 · WSL Ubuntu 24.04' }, { key: 'tool', value: 'Claude Code 2.1 · Otto' }] as const;
/** A daemon that answers previews with ITEMS (and the log when asked), and creations as `created` says. */
function fakeClient(created: (m: Extract<ClientMessage, { type: 'report.create' }>) => Partial<Extract<ServerMessage, { type: 'report.created' }>> = () => ({ ok: true, number: 14, url: 'https://github.com/kl-ledge/ledge/issues/14' })) {
  const listeners = new Set<(m: ServerMessage) => void>();
  const sent: ClientMessage[] = [];
  let previews = 0;
  const emit = (m: ServerMessage) => queueMicrotask(() => { for (const l of listeners) l(m); });
  const client = {
    onMessage(fn: (m: ServerMessage) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    send(m: ClientMessage) {
      sent.push(m);
      if (m.type === 'report.preview') { const n = ++previews; emit({ type: 'report.preview.reply', requestId: m.requestId, items: [...ITEMS], login: 'paradow', ...(m.log ? { log: `19:41:0${n} forge  github  read 7 prs`, logId: `log-${n}` } : {}) } as ServerMessage); }
      if (m.type === 'report.create') emit({ type: 'report.created', requestId: m.requestId, ok: false, ...created(m) } as ServerMessage);
      if (m.type === 'report.ignore') emit({ type: 'report.ignored', requestId: m.requestId, ok: true } as ServerMessage);
    }
  } as unknown as DaemonClient;
  return { client, sent };
}
const dialog = (client: DaemonClient, extra: Partial<Parameters<typeof ReportDialog>[0]> = {}) => {
  const p = { onClose: vi.fn(), onCreated: vi.fn(), onOpenUrl: vi.fn() };
  render(<LangProvider lang="en"><ReportDialog client={client} desktop="0.60.1" session="otto" {...p} {...extra} /></LangProvider>);
  return { ...p, box: within(screen.getByRole('dialog', { name: 'Report' })) };
};
const creates = (sent: ClientMessage[]) => sent.filter((m): m is Extract<ClientMessage, { type: 'report.create' }> => m.type === 'report.create');

describe('« Signaler »', () => {
  it('a bug: its fields, what is attached, one taken out struck through; « Create the issue » sends it all, the toast says its number', async () => {
    const { client, sent } = fakeClient();
    const { box, onCreated } = dialog(client);
    expect(box.getByRole('radio', { name: /^Bug/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(box.getByText('Claude Code 2.1 · Otto')).toBeVisible());
    expect(sent[0]).toMatchObject({ type: 'report.preview', kind: 'bug', session: 'otto', desktop: '0.60.1' });
    fireEvent.change(box.getByRole('textbox', { name: 'Title' }), { target: { value: 'The enlarged chat keeps its width' } });
    fireEvent.change(box.getByRole('textbox', { name: 'What happened' }), { target: { value: 'It comes back enlarged.' } });
    fireEvent.change(box.getByRole('textbox', { name: 'What was expected' }), { target: { value: 'Its normal width.' } });
    fireEvent.click(box.getByRole('button', { name: 'Remove Session tool' }));
    expect(document.querySelector('[data-item="tool"]')).toHaveClass('off');
    expect(box.getByRole('button', { name: 'Put back Session tool' })).toHaveAttribute('aria-pressed', 'true');
    expect(box.getByText('kl-ledge/ledge')).toBeVisible();
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(14, 'https://github.com/kl-ledge/ledge/issues/14'));
    expect(creates(sent)[0]).toMatchObject({ kind: 'bug', session: 'otto', desktop: '0.60.1', title: 'The enlarged chat keeps its width',
      fields: { happened: 'It comes back enlarged.', expected: 'Its normal width.' }, omit: ['tool'] });
    expect(creates(sent)[0]).not.toHaveProperty('log');
  });

  it('the log excerpt: unchecked; checked, shown as it would go, and asked with the issue', async () => {
    const { client, sent } = fakeClient();
    const { box } = dialog(client);
    expect(document.querySelector('pre.rp-excerpt')).toBeNull();
    fireEvent.click(box.getByRole('checkbox', { name: /Add an excerpt of the daemon log/ }));
    await waitFor(() => expect(document.querySelector('pre.rp-excerpt')?.textContent).toMatch(/^19:41:0\d forge  github  read 7 prs$/));
    const shown = document.querySelector('pre.rp-excerpt')!.textContent!.slice(7, 8);
    fireEvent.change(box.getByRole('textbox', { name: 'Title' }), { target: { value: 'T' } });
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(creates(sent)).toHaveLength(1));
    // The excerpt that goes is the one shown (review C4: logId), never a fresh read.
    expect(creates(sent)[0]).toMatchObject({ log: true, logId: `log-${shown}` });
  });

  it('an idea: its own fields and label; without a title nothing is sent and the field says what to do', async () => {
    const { client, sent } = fakeClient();
    const { box } = dialog(client);
    fireEvent.click(box.getByRole('radio', { name: /^Idea/ }));
    expect(box.getByRole('textbox', { name: 'The need' })).toBeVisible();
    expect(box.queryByRole('textbox', { name: 'What happened' })).toBeNull();
    expect(box.queryByRole('checkbox')).toBeNull();
    expect(box.getByText('enhancement')).toBeVisible();
    // Card 3: the context and the proposal on one line, the proposal optional (review C3).
    expect(box.getByRole('textbox', { name: 'The context' }).tagName).toBe('INPUT');
    expect(box.getByRole('textbox', { name: /^A proposal/ }).tagName).toBe('INPUT');
    expect(box.getByText('A proposal').closest('label')).toHaveTextContent('A proposaloptional');
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    expect(box.getByRole('alert')).toHaveTextContent('Give the report a title.');
    expect(box.getByRole('textbox', { name: 'Title' })).toHaveFocus();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(creates(sent)).toEqual([]);
  });

  it('gh not signed in: the footer says so and the button opens the prefilled page; what was written stays', async () => {
    const url = 'https://github.com/kl-ledge/ledge/issues/new?title=T';
    const { client } = fakeClient(() => ({ ok: false, code: 'no_gh', url }));
    const { box, onOpenUrl, onCreated } = dialog(client);
    fireEvent.change(box.getByRole('textbox', { name: 'Title' }), { target: { value: 'T' } });
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(box.getByRole('alert')).toHaveTextContent('gh isn’t signed in on this machine'));
    fireEvent.click(box.getByRole('button', { name: /^Open on GitHub/ }));
    expect(onOpenUrl).toHaveBeenCalledWith(url);
    expect(onCreated).not.toHaveBeenCalled();
    expect(box.getByRole('textbox', { name: 'Title' })).toHaveValue('T');
  });

  it('the draft is kept when the window closes, until it is sent', async () => {
    const { client } = fakeClient();
    dialog(client).box.getByRole('textbox', { name: 'Title' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Half written' } });
    cleanup();
    const again = dialog(client);
    expect(again.box.getByRole('textbox', { name: 'Title' })).toHaveValue('Half written');
    fireEvent.click(again.box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(again.onCreated).toHaveBeenCalled());
    cleanup();
    expect(dialog(client).box.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });
});

describe('an agent\'s report in « À toi »', () => {
  const task = { id: 't7', title: 'Le daemon répète la lecture des PR', giverName: 'Otto', owner: 'ledge', state: 'open',
    report: { kind: 'bug', title: 'Le daemon répète la lecture des PR', detail: 'Après un 502, il relit en boucle.', session: 'Otto', project: 'Ledge' } } as unknown as Task & { report: NonNullable<Task['report']> };
  const card = (client: DaemonClient) => {
    const p = { onEdit: vi.fn(), onCreated: vi.fn(), onOpenUrl: vi.fn() };
    render(<LangProvider lang="en"><ReportDecision task={task} client={client} desktop="0.60.1" {...p} /></LangProvider>);
    return p;
  };
  it('says who reports and what, what is attached; « Create the issue » sends it as it is, with the task', async () => {
    const { client, sent } = fakeClient();
    const p = card(client);
    expect(screen.getByText('Otto reports a bug')).toBeVisible();
    expect(screen.getByText('session Otto · project Ledge')).toBeVisible();
    await waitFor(() => expect(screen.getByText('Claude Code 2.1 · Otto')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Create the issue' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledWith(14, expect.any(String)));
    expect(creates(sent)[0]).toMatchObject({ kind: 'bug', task: 't7', title: task.report.title, fields: { detail: task.report.detail } });
  });
  it('« Edit first » opens the form; « Ignore » puts it away', async () => {
    const { client, sent } = fakeClient();
    const p = card(client);
    fireEvent.click(screen.getByRole('button', { name: 'Edit first' }));
    expect(p.onEdit).toHaveBeenCalledWith('t7');
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(sent.some(m => m.type === 'report.ignore' && m.task === 't7')).toBe(true));
  });
  it('« Edit first »: the form starts from the agent\'s report and answers it', async () => {
    const { client, sent } = fakeClient();
    const { box, onCreated } = dialog(client, { task });
    expect(box.getByRole('textbox', { name: 'Title' })).toHaveValue(task.report.title);
    expect(box.getByRole('textbox', { name: 'What happened' })).toHaveValue(task.report.detail);
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(creates(sent)[0]).toMatchObject({ task: 't7', fields: { happened: task.report.detail } });
    expect(creates(sent)[0]).not.toHaveProperty('session');
  });
});

describe('« Signaler »: the account and an expired excerpt (#9 review C4)', () => {
  it('names the GitHub account the daemon gives', async () => {
    const { client } = fakeClient();
    const { box } = dialog(client);
    await waitFor(() => expect(box.getByText('paradow')).toBeVisible());
    expect(box.getByText('paradow').closest('p')).toHaveTextContent('with your GitHub account paradow');
  });
  it('log_stale: nothing created, the excerpt asked again and shown, the user told; the next try sends the new one', async () => {
    let n = 0;
    const { client, sent } = fakeClient(() => (++n === 1 ? { ok: false, code: 'log_stale' } : { ok: true, number: 15 }));
    const { box, onCreated } = dialog(client);
    fireEvent.change(box.getByRole('textbox', { name: 'Title' }), { target: { value: 'T' } });
    fireEvent.click(box.getByRole('checkbox', { name: /Add an excerpt of the daemon log/ }));
    await waitFor(() => expect(document.querySelector('pre.rp-excerpt')).not.toBeNull());
    const first = (sent.filter(m => m.type === 'report.preview').length);
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(box.getByRole('alert')).toHaveTextContent('The log excerpt was refreshed: read it again, then create the issue.'));
    await waitFor(() => expect(sent.filter(m => m.type === 'report.preview').length).toBe(first + 1));
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole('button', { name: /^Create the issue/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(15, undefined));
    expect(creates(sent)[1]).toMatchObject({ logId: `log-${first + 1}` });
  });
});
