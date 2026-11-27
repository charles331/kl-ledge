// The waiting line's drawing follows what the agent does (docs/mockups/ledge-operator-rigs-panel.html, « Selon ce qu'il fait »).
import { describe, expect, it } from 'vitest';
import { drawingOf } from '../src/session/workDrawing';

const tool = (verb: 'read' | 'edit' | 'search' | 'command', failed = false) => ({ kind: 'tool' as const, verb, target: 'x', failed });

describe('drawingOf', () => {
  it('draws the last action\'s verb: a page read, lines written, a lens searching, a command run', () => {
    expect(drawingOf(tool('read'))).toBe('read');
    expect(drawingOf(tool('edit'))).toBe('write');
    expect(drawingOf(tool('search'))).toBe('search');
    expect(drawingOf(tool('command'))).toBe('run');
  });

  it('draws nothing (the ring stays) when no action is behind the wait, or for a failed one', () => {
    expect(drawingOf(tool('command', true))).toBeNull();
    expect(drawingOf({ kind: 'said' })).toBeNull();
    expect(drawingOf({ kind: 'decision' })).toBeNull();
    expect(drawingOf({ kind: 'prompt', from: 'user' } as never)).toBeNull();
    expect(drawingOf({ kind: 'received', from: 'Otto' } as never)).toBeNull();
    expect(drawingOf({ kind: 'helper', name: 'Explore' } as never)).toBeNull();
  });
});
