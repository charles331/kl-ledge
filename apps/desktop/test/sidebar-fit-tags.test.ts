import { afterEach, describe, expect, it } from 'vitest';
import { fitBranchTags } from '../src/shell/sidebar/Tree';

// Issue #32 (design-ux and the lead, 2026-11-26): a branch tag shows its name while the line leaves room for its icon and three
// characters with « … », else its icon alone. jsdom lays nothing out: the widths are given here, as a browser would measure them.

afterEach(() => { document.body.innerHTML = ''; });

const define = (el: Element, o: { width?: number; client?: number; scroll?: number }) => {
  if (o.width !== undefined) el.getBoundingClientRect = () => ({ width: o.width!, height: 15, x: 0, y: 0, top: 0, left: 0, right: o.width!, bottom: 15, toJSON: () => ({}) });
  if (o.client !== undefined) Object.defineProperty(el, 'clientWidth', { value: o.client, configurable: true });
  if (o.scroll !== undefined) Object.defineProperty(el, 'scrollWidth', { value: o.scroll, configurable: true });
};

/** One session row: its line `main` (`room` px), the name (`name` px at full width), a branch tag (6 px margin, 4 + 5 padding, 1 + 1
 *  border, a 9 px icon) whose name is `branch` in a monospaced 6 px font, and « wt » when `worktree`. */
function row(room: number, name: number, branch: string, worktree = false) {
  const tree = document.createElement('div');
  tree.innerHTML = `<div class="st-agent"><span class="st-main"><strong><span class="st-aname">N</span><span class="st-btag" style="margin-left:6px;padding:0 5px 0 4px;border:1px solid"><svg></svg><span class="st-btag-name">${branch}</span>${worktree ? '<i>wt</i>' : ''}</span></strong></span></div>`;
  document.body.append(tree);
  define(tree.querySelector('.st-main')!, { client: room });
  define(tree.querySelector('.st-aname')!, { scroll: name });
  define(tree.querySelector('svg')!, { width: 9 });
  define(tree.querySelector('.st-btag-name')!, { scroll: branch.length * 6 });
  if (worktree) define(tree.querySelector('i')!, { scroll: 12 });
  return { tree, tag: () => tree.querySelector<HTMLElement>('.st-btag')!.dataset.fit };
}

describe('fitBranchTags', () => {
  // The tag's frame (6 + 9 + 2 + 9 = 26) and three characters with « … » (3 + 4 × 6 = 27): 53 px beside the name.
  it('room for the icon and three characters with « … »: the name shows', () => {
    const r = row(30 + 53, 30, 'feat/ide-shell');
    fitBranchTags(r.tree);
    expect(r.tag()).toBeUndefined();
  });

  it('one pixel less: the icon alone', () => {
    const r = row(30 + 52, 30, 'feat/ide-shell');
    fitBranchTags(r.tree);
    expect(r.tag()).toBe('icon');
  });

  it('a name longer than the line: the icon alone', () => {
    const r = row(120, 200, 'main');
    fitBranchTags(r.tree);
    expect(r.tag()).toBe('icon');
  });

  it('« wt » needs its room too (3 + 2 + 12 px)', () => {
    const r = row(30 + 53 + 16, 30, 'feat/ide-shell', true);
    fitBranchTags(r.tree);
    expect(r.tag()).toBe('icon');
    const s = row(30 + 53 + 17, 30, 'feat/ide-shell', true);
    fitBranchTags(s.tree);
    expect(s.tag()).toBeUndefined();
  });

  it('the choice does not depend on what the tag is now: run again, it stays', () => {
    const r = row(30 + 52, 30, 'feat/ide-shell');
    fitBranchTags(r.tree); fitBranchTags(r.tree);
    expect(r.tag()).toBe('icon');
    const s = row(30 + 53, 30, 'feat/ide-shell');
    s.tree.querySelector<HTMLElement>('.st-btag')!.dataset.fit = 'icon';
    fitBranchTags(s.tree);
    expect(s.tag()).toBeUndefined();
  });
});
