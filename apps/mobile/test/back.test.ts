import { describe, expect, it } from 'vitest';

const tick = () => new Promise(r => setTimeout(r, 20));
const go = async (hash: string) => { globalThis.location.hash = hash; await tick(); };

describe('« Retour »', () => {
  it('opened from outside goes to the fallback in place; inside the app, one step back to the screen before', async () => {
    // A notification opened the app on a thread: no screen of the app before it.
    globalThis.history.replaceState(null, '', '#/thread/s1');
    const { backTarget, goBack } = await import('../src/router');
    expect(backTarget({ name: 'sessions' })).toEqual({ route: { name: 'sessions' }, known: false, inApp: false });
    goBack({ name: 'sessions' });
    await tick();
    expect(globalThis.location.hash).toBe('#/sessions');
    // Replaced, not pushed: Sessions is still the first screen.
    expect(backTarget({ name: 'sessions' }).inApp).toBe(false);

    // Sessions → Rigs → a request: back leads to Rigs, then to Sessions.
    await go('#/rigs');
    await go('#/request/s1/k1');
    expect(backTarget({ name: 'sessions' })).toEqual({ route: { name: 'rigs' }, known: true, inApp: true });
    goBack({ name: 'sessions' });
    await tick();
    expect(globalThis.location.hash).toBe('#/rigs');
    expect(backTarget({ name: 'rigs' })).toEqual({ route: { name: 'sessions' }, known: true, inApp: true });

    // A new step after going back drops the one ahead: Rigs → thread, back is Rigs again.
    await go('#/thread/s2');
    expect(backTarget({ name: 'sessions' }).route).toEqual({ name: 'rigs' });
  });
});
