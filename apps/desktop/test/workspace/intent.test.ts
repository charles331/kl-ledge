import { afterEach, describe, expect, it, vi } from 'vitest';
import { acts, asPreview, clickIntent, noteClick, openAs, typing } from '../../src/workspace/intent';
import { empty, isPreview, open, type Tab } from '../../src/workspace/model';

// How a click asks for a tab (spec 2026-11-26-preview-tabs §5.2–§5.4).
const S = (id: string): Tab => ({ kind: 'session', ref: id });
const el = (html: string, pick: string): Element => { document.body.innerHTML = html; return document.querySelector(pick)!; };
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('noteClick and openAs', () => {
  it('a single click (or Enter: detail 0) asks for a preview, the second click of a double click for a kept tab', () => {
    const b = el('<button>Otto</button>', 'button');
    noteClick({ detail: 1, target: b });
    expect(isPreview(openAs(empty(), S('a')), 'session:a')).toBe(true);
    noteClick({ detail: 0, target: b });
    expect(clickIntent()).toEqual({ preview: true });
    noteClick({ detail: 2, target: b });
    expect(isPreview(openAs(empty(), S('a')), 'session:a')).toBe(false);
  });

  it('a menu and a control marked data-keep ask for nothing: a kept tab', () => {
    noteClick({ detail: 1, target: el('<div role="menu"><button role="menuitem">Ouvrir</button></div>', 'button') });
    expect(clickIntent()).toBeNull();
    noteClick({ detail: 1, target: el('<button data-keep>Nouvelle routine</button>', 'button') });
    expect(clickIntent()).toBeNull();
  });

  it('a click in a tab names it: what it opens is a preview, and that tab is kept', () => {
    const w = open(empty(), { kind: 'atelier', ref: 'main' }, 'active', { preview: true });
    noteClick({ detail: 1, target: el('<button data-agent>Otto</button>', 'button') }, 'atelier:main');
    const r = openAs(w, S('otto'));
    expect(isPreview(r, 'atelier:main')).toBe(false);
    expect(isPreview(r, 'session:otto')).toBe(true);
  });

  it('lasts for the event only: a tab opened afterwards is kept', () => {
    vi.useFakeTimers();
    noteClick({ detail: 1, target: el('<button>x</button>', 'button') });
    expect(clickIntent()).not.toBeNull();
    vi.runAllTimers();
    expect(clickIntent()).toBeNull();
    expect(isPreview(openAs(empty(), S('a')), 'session:a')).toBe(false);
  });

  it('asPreview: the island\'s « Voir » opens a preview, the intent before it restored', () => {
    expect(asPreview(() => isPreview(openAs(empty(), S('a')), 'session:a'))).toBe(true);
    expect(clickIntent()).toBeNull();
  });

  it('asPreview from a tab (Enter on an agent of the Atelier): that tab kept, the agent the preview', () => {
    const w = open(empty(), { kind: 'atelier', ref: 'main' }, 'active', { preview: true });
    const r = asPreview(() => openAs(w, S('otto')), 'atelier:main');
    expect(isPreview(r, 'atelier:main')).toBe(false);
    expect(isPreview(r, 'session:otto')).toBe(true);
  });
});

describe('typing', () => {
  const key = (key: string, target: Element, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    typing({ key, target, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it('a character, Backspace, Delete or Enter in a field, a text area, a contenteditable or a terminal\'s input', () => {
    expect(key('a', el('<textarea></textarea>', 'textarea'))).toBe(true);
    expect(key('Backspace', el('<input type="text">', 'input'))).toBe(true);
    expect(key('Enter', el('<input type="search">', 'input'))).toBe(true);
    expect(key('x', el('<div contenteditable="true"><p>hi</p></div>', 'p'))).toBe(true);
    expect(key('x', el('<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>', 'textarea'))).toBe(true);
  });

  it('not moving, not a shortcut, not a key outside a field, not a checkbox', () => {
    expect(key('ArrowDown', el('<textarea></textarea>', 'textarea'))).toBe(false);
    expect(key('Tab', el('<textarea></textarea>', 'textarea'))).toBe(false);
    expect(key('`', el('<textarea></textarea>', 'textarea'), { ctrlKey: true })).toBe(false);
    expect(key('y', el('<button>Autoriser</button>', 'button'))).toBe(false);
    expect(key(' ', el('<input type="checkbox">', 'input'))).toBe(false);
  });
});

describe('acts (a PR, a rig, OpenRig, a routine, Réglages)', () => {
  it('a button, a switch, a field act; a sub-view, a section, an unfolding, a line chosen, a link only look', () => {
    expect(acts(el('<button>Fusionner</button>', 'button'))).toBe(true);
    expect(acts(el('<button><svg><path></path></svg></button>', 'path'))).toBe(true);
    expect(acts(el('<button role="switch" aria-checked="false"></button>', 'button'))).toBe(true);
    expect(acts(el('<div role="tablist"><button role="tab">Discussion</button></div>', 'button'))).toBe(false);
    expect(acts(el('<nav><button>Général</button></nav>', 'button'))).toBe(false);
    expect(acts(el('<button aria-expanded="false">Plus</button>', 'button'))).toBe(false);
    expect(acts(el('<button role="option">pom.xml</button>', 'button'))).toBe(false);
    expect(acts(el('<button data-look>Voir</button>', 'button'))).toBe(false);
    expect(acts(el('<p>texte</p>', 'p'))).toBe(false);
  });
});
