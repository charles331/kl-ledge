import { describe, expect, it } from 'vitest';
import { asideQuestion, parseClientMessage, parseServerMessage } from '../src/index.js';

describe('asides (#41)', () => {
  const at = '2026-11-27T10:00:00.000Z';

  it('a front asks with the session, its own id and the question; an empty question is refused', () => {
    expect(parseClientMessage({ type: 'session.aside', id: 's1', rid: 'r1', question: ' why? ' })).toEqual({ type: 'session.aside', id: 's1', rid: 'r1', question: 'why?' });
    expect(() => parseClientMessage({ type: 'session.aside', id: 's1', rid: 'r1', question: '  ' })).toThrow();
    expect(() => parseClientMessage({ type: 'session.aside', id: 's1', rid: 'r1', question: 'x'.repeat(4001) })).toThrow();
  });

  it('the daemon says each state; a cause added later reads as invalid, never drops the aside', () => {
    const answered = { type: 'session.aside', id: 's1', aside: { rid: 'r1', question: 'q', askedAt: at, state: 'answered', answer: '# A\n\n- x', answeredAt: at } };
    expect(parseServerMessage(answered)).toEqual(answered);
    const later = parseServerMessage({ type: 'session.aside', id: 's1', aside: { rid: 'r1', question: 'q', askedAt: at, state: 'failed', cause: 'some_new_cause' } });
    expect(later).toMatchObject({ aside: { state: 'failed', cause: 'invalid' } });
  });

  it('asideQuestion reads `/btw <question>` as typed in a reply field', () => {
    expect(asideQuestion('/btw what is left?')).toBe('what is left?');
    expect(asideQuestion('  /btw  multi\nline ')).toBe('multi\nline');
    expect(asideQuestion('/btw')).toBeNull();
    expect(asideQuestion('/btwx no')).toBeNull();
    expect(asideQuestion('tell me /btw')).toBeNull();
  });
});
