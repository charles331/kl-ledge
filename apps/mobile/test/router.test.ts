import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/router';

const routes: Route[] = [
  { name: 'sessions' },
  { name: 'sessions', filter: 'working' },
  { name: 'sessions', filter: 'waiting' },
  { name: 'routines' },
  { name: 'routines', routine: 'r81c0d4' },
  { name: 'prs' },
  { name: 'rigs' },
  { name: 'ask', id: 'qitem-1' },
  { name: 'thread', sessionId: 's1' },
  { name: 'terminal', sessionId: 's1' },
  { name: 'request', sessionId: 's1', key: 'k1' },
  { name: 'connection' },
  { name: 'connection', section: 'link' },
  { name: 'rig', rig: 'ledge-dev' },
  { name: 'rig', rig: 'a b/c' },
  { name: 'kernel' },
  { name: 'max' },
  { name: 'max', goalId: 'g-12345678' }
];

describe('router', () => {
  it.each(routes)('round-trips %j', (r) => {
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('opens Sessions at #/, on unknown hashes and on the old #/atoi and #/chat (#40 D6, card 8)', () => {
    expect(parseRoute('#/pair')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/nimporte')).toEqual({ name: 'sessions' });
    expect(parseRoute('')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/atoi')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/chat')).toEqual({ name: 'sessions' });
  });

  it('reads #/agents, the old address of Sessions', () => {
    expect(parseRoute('#/agents')).toEqual({ name: 'sessions' });
  });

  it('decodes an encoded sid or key once', () => {
    expect(parseRoute('#/thread/a%2Fb')).toEqual({ name: 'thread', sessionId: 'a/b' });
    expect(parseRoute('#/request/a%2Fb/c%252Fd')).toEqual({ name: 'request', sessionId: 'a/b', key: 'c%2Fd' });
    const r: Route = { name: 'request', sessionId: 'a/b', key: 'x/y%z' };
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('falls back to Sessions on a malformed escape', () => {
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ name: 'sessions' });
  });
});
