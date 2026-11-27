import { describe, it, expect } from 'vitest';
import { PushPayloadSchema } from '@ledge/protocol';
import { pointPush } from '../../src/operator/notices.js';

describe('pointPush', () => {
  it('is a point titled Ledge, its body the lead cut to 120, opening the chat tab', () => {
    const p = pointPush('x'.repeat(300), 3);
    expect(p).toMatchObject({ kind: 'point', title: 'Ledge', url: '/#/chat', badge: 3, tag: 'point' });
    expect(p.body.length).toBeLessThanOrEqual(120);
    expect(PushPayloadSchema.parse(p)).toEqual(p);
  });
});
