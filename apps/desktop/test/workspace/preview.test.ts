import { describe, expect, it } from 'vitest';
import {
  activate, changesTab, close, closeOthers, closeWindow, deserialize, empty, find, isPreview, keyOf, move, moveActive, moveTo, open, pin, place,
  reconcile, remember, reopenLast, serialize, setLink, setView, split, windowOf, type Tab, type Workspace
} from '../../src/workspace/model';

// Preview tabs (docs/superpowers/specs/2026-11-26-preview-tabs-design.md §5.1, §7): a single click looks, the next
// single click replaces it in place, a double click or an action keeps it.
const S = (id: string): Tab => ({ kind: 'session', ref: id });
const P = { preview: true } as const;
const group = (w: Workspace, id: string) => w.groups.find(g => g.id === id)!;
const keys = (w: Workspace, id: string) => group(w, id).tabs.map(keyOf);
const front = (w: Workspace, id: string) => { const g = group(w, id); return g.tabs[g.active] ? keyOf(g.tabs[g.active]!) : null; };
const preview = (w: Workspace, id: string) => group(w, id).preview ?? null;
/** a kept, then b as the preview of g1. */
const looked = () => open(open(empty(), S('a')), S('b'), 'active', P);

describe('open as a preview', () => {
  it('appended when the group has none; the next preview takes its place, active', () => {
    let w = looked();
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b']);
    expect(preview(w, 'g1')).toBe('session:b');
    w = open(w, S('c'), 'active', P);
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:c']);
    expect(preview(w, 'g1')).toBe('session:c');
    expect(front(w, 'g1')).toBe('session:c');
  });

  it('replaced at its own place, a kept tab after it staying where it is', () => {
    let w = open(looked(), S('d'));
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b', 'session:d']);
    w = open(w, S('c'), 'active', P);
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:c', 'session:d']);
    expect(front(w, 'g1')).toBe('session:c');
  });

  it('three single clicks leave one tab', () => {
    const w = open(open(open(empty(), S('a'), 'active', P), S('b'), 'active', P), S('c'), 'active', P);
    expect(keys(w, 'g1')).toEqual(['session:c']);
    expect(isPreview(w, 'session:c')).toBe(true);
  });

  it('one preview per group: each group replaces its own', () => {
    let w = open(looked(), S('x'), 'right');
    expect(w.focus).toBe('g2');
    w = open(w, S('y'), 'active', P);
    w = open(w, S('z'), 'active', P);
    expect(keys(w, 'g2')).toEqual(['session:x', 'session:z']);
    expect(preview(w, 'g2')).toBe('session:z');
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b']);
    expect(preview(w, 'g1')).toBe('session:b');
  });

  it('Ctrl+click: into the group on the right, replacing its preview; a new group only when there is none', () => {
    let w = open(looked(), S('c'), 'right', P);
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g2']);
    expect(preview(w, 'g2')).toBe('session:c');
    w = activate(w, 'g1', 0);
    w = open(w, S('d'), 'right', P);
    expect(w.groups.map(g => g.id)).toEqual(['g1', 'g2']);
    expect(keys(w, 'g2')).toEqual(['session:d']);
    expect(w.focus).toBe('g2');
    // A kept tab « à droite » still opens a new group, as before.
    w = activate(w, 'g1', 0);
    expect(open(w, S('e'), 'right').groups.map(g => g.id)).toEqual(['g1', 'g3', 'g2']);
  });

  it('a tab already open anywhere is only brought forward; kept stays kept, a preview stays a preview', () => {
    let w = open(looked(), S('c'), 'right');
    w = open(w, S('b'), 'active', P);
    expect(w.focus).toBe('g1');
    expect(preview(w, 'g1')).toBe('session:b');
    w = open(w, S('a'), 'active', P);
    expect(front(w, 'g1')).toBe('session:a');
    expect(isPreview(w, 'session:a')).toBe(false);
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b']);
  });

  it('a new window holds the preview', () => {
    const w = open(empty(), S('a'), 'window', P);
    const g = find(w, 'session:a')!.group;
    expect(windowOf(w, 'session:a')).not.toBe('main');
    expect(g.preview).toBe('session:a');
  });
});

describe('keeping a preview', () => {
  it('opened kept (a double click on its line): the next preview is added beside it', () => {
    let w = open(looked(), S('b'));
    expect(isPreview(w, 'session:b')).toBe(false);
    expect('preview' in group(w, 'g1')).toBe(false);
    w = open(w, S('c'), 'active', P);
    expect(keys(w, 'g1')).toEqual(['session:a', 'session:b', 'session:c']);
  });

  it('pin: kept; a tab already kept, or unknown: the same object', () => {
    const w = looked();
    const p = pin(w, 'session:b');
    expect(preview(p, 'g1')).toBeNull();
    expect(keys(p, 'g1')).toEqual(keys(w, 'g1'));
    expect(pin(w, 'session:a')).toBe(w);
    expect(pin(w, 'session:nope')).toBe(w);
  });

  it('moved to another group, to a new group, to a new window, or dragged within its group: kept', () => {
    const base = open(looked(), S('x'), 'right');
    expect(isPreview(move(base, 'session:b', { group: 'g2' }), 'session:b')).toBe(false);
    expect(isPreview(move(looked(), 'session:b', { rightOf: 'g1' }), 'session:b')).toBe(false);
    expect(isPreview(move(looked(), 'session:b', { window: 'new' }), 'session:b')).toBe(false);
    expect(isPreview(moveTo(looked(), 'session:b', { group: 'g1', index: 0 }), 'session:b')).toBe(false);
    expect(isPreview(moveActive(looked(), 1), 'session:b')).toBe(false);
    expect(isPreview(place(base, S('b'), { group: 'g2', index: 0 }), 'session:b')).toBe(false);
  });

  it('a split from it keeps it', () => {
    const w = split(looked(), 'g1');
    expect(preview(w, 'g1')).toBeNull();
    expect(w.focus).toBe('g2');
  });

  it('looking is not acting: activating, switching thread ⇄ terminal, another tab reordered leave it a preview', () => {
    let w = activate(looked(), 'g1', 0);
    w = setView(w, 'session:b', 'terminal');
    w = moveTo(w, 'session:a', { group: 'g1', index: 1 });
    expect(preview(w, 'g1')).toBe('session:b');
  });
});

describe('closing, following, coming back', () => {
  it('closing the preview clears it; closing another tab leaves it', () => {
    const w = open(looked(), S('c'));
    expect(preview(close(w, 'session:b'), 'g1')).toBeNull();
    expect(preview(close(w, 'session:c'), 'g1')).toBe('session:b');
  });

  it('« Fermer les autres »: the preview goes with the others; kept on it, it stays the preview', () => {
    const w = looked();
    expect(preview(closeOthers(w, 'session:a'), 'g1')).toBeNull();
    expect(preview(closeOthers(w, 'session:b'), 'g1')).toBe('session:b');
  });

  it('a preview whose session is gone is dropped with its tab', () => {
    const w = reconcile(looked(), t => t.ref !== 'b');
    expect(keys(w, 'g1')).toEqual(['session:a']);
    expect(preview(w, 'g1')).toBeNull();
  });

  it('Ctrl+Shift+T reopens a closed preview kept', () => {
    const w = looked();
    const r = reopenLast(close(w, 'session:b'), remember([], w, 'session:b'));
    expect(keys(r.w, 'g1')).toEqual(['session:a', 'session:b']);
    expect(isPreview(r.w, 'session:b')).toBe(false);
  });

  it('a linked group: its Changes preview follows the session chosen and stays the preview, under its new key', () => {
    let w = open(open(empty(), S('a')), S('b'));
    w = open(w, changesTab('a'), 'right', P);
    w = setLink(setLink(w, 'g1', 'violet'), 'g2', 'violet');
    w = activate(w, 'g1', 1);
    expect(keys(w, 'g2')).toEqual([keyOf(changesTab('b'))]);
    expect(preview(w, 'g2')).toBe(keyOf(changesTab('b')));
  });

  it('a detached window closed: its tabs come back kept', () => {
    let w = open(looked(), S('c'), 'window', P);
    const win = windowOf(w, 'session:c')!;
    w = closeWindow(w, win);
    expect(isPreview(w, 'session:c')).toBe(false);
  });
});

describe('saved and read back', () => {
  it('a workspace saved before previews existed reads back unchanged', () => {
    const w = open(open(open(empty(), S('a')), S('b')), S('c'), 'right');
    const back = deserialize(serialize(w))!;
    expect(back).toEqual(w);
    expect(back.groups.some(g => 'preview' in g)).toBe(false);
  });

  it('a workspace read back (a restart, a disposition) holds only kept tabs, every tab still there', () => {
    const w = open(looked(), S('c'), 'right', P);
    const back = deserialize(serialize(w))!;
    expect(back.groups.map(g => g.tabs.map(keyOf))).toEqual(w.groups.map(g => g.tabs.map(keyOf)));
    expect(back.groups.some(g => 'preview' in g)).toBe(false);
  });
});
