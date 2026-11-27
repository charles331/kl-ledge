import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { frameOf, unionFrame, FRAME_PAD } from '../src/surface/frame';
// The native side, stubbed: `invoke` records commands, the window's `listen` keeps the handler so a test can emit a shell event,
// the global shortcut plugin keeps each handler by its accelerator (`shortcut` is Ctrl+Alt+L's).
const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  shortcut: null as null | ((e: { state: string }) => void),
  shortcuts: new Map<string, (e: { state: string }) => void>(),
  monitor: null as null | { scaleFactor: number; size: { height: number; width: number }; workArea: { size: { height: number; width: number } } }
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
// The notch listens on its own window: the shell sends its events there only.
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => { native.listeners.set(name, cb); return () => { native.listeners.delete(name); native.unlisten(); }; }) })
}));
vi.mock('@tauri-apps/api/window', () => ({ primaryMonitor: vi.fn(async () => native.monitor) }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(async (k: string, cb: (e: { state: string }) => void) => { native.shortcuts.set(k, cb); if (k === 'Ctrl+Alt+L') native.shortcut = cb; }),
  unregister: vi.fn(async (k: string) => { native.shortcuts.delete(k); if (k === 'Ctrl+Alt+L') native.shortcut = null; })
}));

const enterTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const leaveTauri = () => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; };
const calls = (cmd: string) => native.invoke.mock.calls.filter(c => c[0] === cmd).map(c => c[1]);
// Fresh module state (the bridge's dedupe keys) for every test.
const loadBridge = async () => { vi.resetModules(); return import('../src/tauri/bridge'); };

beforeEach(() => { native.invoke.mockClear(); native.invoke.mockImplementation(async () => undefined); native.listeners.clear(); native.unlisten.mockClear(); native.shortcut = null; native.shortcuts.clear(); });
afterEach(() => { leaveTauri(); vi.unstubAllEnvs(); });

describe('frameOf', () => {
  it('pads the surface for its shadow on the sides and below, never above the top edge, in whole px', () => {
    expect(frameOf({ left: 900, top: 0, w: 117, h: 38 }, [], { w: 1920, h: 1080 })).toEqual({ left: 900 - FRAME_PAD.left, top: 0, w: 117 + FRAME_PAD.left + FRAME_PAD.right, h: 38 + FRAME_PAD.bottom });
    expect(frameOf({ left: 900.4, top: 0, w: 117, h: 38 }, [{ left: 880.5, top: 44.5, w: 200.4, h: 30 }], { w: 1920, h: 1080 })).toEqual({ left: 864, top: 0, w: 233, h: 99 });
  });

  it('extends to the extras around the surface and stays inside the work area', () => {
    // The fillets either side widen the frame; a coachmark under the panel extends it down.
    expect(frameOf({ left: 770, top: 0, w: 380, h: 300 }, [{ left: 758, top: 0, w: 404, h: 12 }], { w: 1920, h: 1080 }).w).toBe(404 + FRAME_PAD.left + FRAME_PAD.right);
    const below = frameOf({ left: 770, top: 0, w: 380, h: 300 }, [{ left: 810, top: 308, w: 300, h: 128 }], { w: 1920, h: 1080 });
    expect(below.top + below.h).toBe(308 + 128 + FRAME_PAD.bottom);
    // Clamped to the work area on every side.
    expect(frameOf({ left: 4, top: 0, w: 1912, h: 1070 }, [], { w: 1920, h: 1080 })).toEqual({ left: 0, top: 0, w: 1920, h: 1080 });
  });

  it('the union holds both frames', () => {
    expect(unionFrame({ left: 900, top: 0, w: 149, h: 62 }, { left: 754, top: 0, w: 412, h: 500 })).toEqual({ left: 754, top: 0, w: 412, h: 500 });
    expect(unionFrame({ left: 100, top: 0, w: 50, h: 80 }, { left: 120, top: 10, w: 100, h: 30 })).toEqual({ left: 100, top: 0, w: 120, h: 80 });
  });
});

describe('bridge', () => {
  it('in the browser nothing reaches the shell', async () => {
    const b = await loadBridge();
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(false);
    await b.focusOverlay(); await b.releaseFocus();
    await expect(b.foregroundIsTerminal()).resolves.toBe(false);
    await Promise.resolve();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
  });

  it('set_frame takes left, top, width and height, once per distinct frame and in call order', async () => {
    enterTauri(); const b = await loadBridge();
    const order: unknown[] = [];
    let release!: () => void;
    native.invoke.mockImplementationOnce(async (_c, a) => { await new Promise<void>(r => { release = r; }); order.push(a); });
    native.invoke.mockImplementation(async (_c, a) => { order.push(a); });
    const first = b.setFrame({ left: 900, top: 0, w: 149, h: 62 });
    const second = b.setFrame({ left: 754, top: 0, w: 412, h: 500 });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(order).toEqual([]); // the second waits for the first
    release();
    await expect(first).resolves.toBe(true); await expect(second).resolves.toBe(true);
    expect(order).toEqual([{ left: 900, top: 0, width: 149, height: 62 }, { left: 754, top: 0, width: 412, height: 500 }]);
    await b.setFrame({ left: 754, top: 0, w: 412, h: 500 });
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('a failed set_frame resolves false and is retried next time', async () => {
    enterTauri(); const b = await loadBridge();
    native.invoke.mockRejectedValueOnce(new Error('no window'));
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(false);
    await expect(b.setFrame({ left: 0, top: 1, w: 2, h: 3 })).resolves.toBe(true);
    expect(calls('set_frame')).toHaveLength(2);
  });

  it('overlay focus and its release are commands', async () => {
    enterTauri(); const b = await loadBridge();
    await b.focusOverlay(); await b.releaseFocus();
    expect(calls('focus_overlay')).toEqual([undefined]);
    expect(calls('release_focus')).toEqual([undefined]);
  });

  it('Ctrl+Alt+L and Ctrl+Alt+N are global shortcuts under Tauri and window keys in the browser', async () => {
    const browser = await loadBridge();
    const list = vi.fn(); const launch = vi.fn();
    const offL = browser.onShortcut(list); const offN = browser.onNewSessionShortcut(launch);
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
    expect(launch).toHaveBeenCalledOnce(); expect(list).toHaveBeenCalledOnce();
    offL(); offN();
    enterTauri(); const b = await loadBridge();
    const n = vi.fn(); const off = b.onNewSessionShortcut(n);
    await vi.waitFor(() => expect(native.shortcuts.has('Ctrl+Alt+N')).toBe(true));
    native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Released' }); native.shortcuts.get('Ctrl+Alt+N')!({ state: 'Pressed' });
    expect(n).toHaveBeenCalledOnce();
    off();
    await vi.waitFor(() => expect(native.shortcuts.has('Ctrl+Alt+N')).toBe(false));
  });

  it('a zoomed frame is rounded outward to whole monitor px; frames go out in order', async () => {
    enterTauri(); const b = await loadBridge();
    expect(b.toMonitorFrame({ left: 10, top: 101, w: 45, h: 77 }, 1)).toEqual({ left: 10, top: 101, w: 45, h: 77 });
    // 101 * 1.25 = 126.25 -> 126; (101 + 77) * 1.25 = 222.5 -> 223; 10 * 1.25 = 12.5 -> 12; (10 + 45) * 1.25 = 68.75 -> 69.
    expect(b.toMonitorFrame({ left: 10, top: 101, w: 45, h: 77 }, 1.25)).toEqual({ left: 12, top: 126, w: 57, h: 97 });
    expect(b.toMonitorFrame({ left: 10.4, top: 0, w: 20.2, h: 10.2 }, 1.5)).toEqual({ left: 15, top: 0, w: 31, h: 16 });
    const order: string[] = [];
    native.invoke.mockImplementation(async (c: string) => { order.push(c); });
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 2);
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 1.5); // same CSS frame, new zoom: sent again
    await b.setFrame({ left: 0, top: 100, w: 44, h: 80 }, 1.5); // unchanged: not sent twice
    expect(calls('set_frame')).toEqual([{ left: 0, top: 200, width: 88, height: 160 }, { left: 0, top: 150, width: 66, height: 120 }]);
    expect(order).toEqual(['set_frame', 'set_frame']);
  });

  it('screenHeight is the primary work area in logical px', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620, width: 2880 }, workArea: { size: { height: 1548, width: 2760 } } };
    await expect(b.screenHeight()).resolves.toBe(1032);
    await expect(b.screenWidth()).resolves.toBe(1840);
  });

  const monitors = [
    { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1', width: 1920, height: 1080, workH: 1032, primary: true },
    { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2', width: 2560, height: 1440, workH: 1400, primary: false }
  ];

  it('screenHeight follows the Screen setting: the chosen monitor while listed, else the primary', async () => {
    enterTauri(); const b = await loadBridge();
    native.monitor = { scaleFactor: 1.5, size: { height: 1620, width: 2880 }, workArea: { size: { height: 1548, width: 2760 } } };
    native.invoke.mockImplementation(async cmd => (cmd === 'list_monitors' ? monitors : undefined));
    await expect(b.screenHeight(monitors[1]!.id)).resolves.toBe(1400);
    await expect(b.screenHeight('\\\\.\\DISPLAY3')).resolves.toBe(1032);
    await expect(b.screenHeight(null)).resolves.toBe(1032);
    await expect(b.screenWidth(monitors[1]!.id)).resolves.toBe(2560);
    expect(calls('list_monitors')).toHaveLength(3);
  });

  it('listMonitors and setMonitor go to the shell; the browser lists its viewport as the one primary screen', async () => {
    const browser = await loadBridge();
    await expect(browser.listMonitors()).resolves.toEqual([{ id: 'primary', name: null, width: window.innerWidth, height: window.innerHeight, workH: window.innerHeight, workW: window.innerWidth, primary: true }]);
    await browser.setMonitor('x');
    expect(native.invoke).not.toHaveBeenCalled();
    enterTauri(); const b = await loadBridge();
    native.invoke.mockImplementation(async cmd => (cmd === 'list_monitors' ? monitors : undefined));
    await expect(b.listMonitors()).resolves.toEqual(monitors);
    await b.setMonitor(monitors[1]!.id); await b.setMonitor(null);
    expect(calls('set_monitor')).toEqual([{ id: monitors[1]!.id }, { id: null }]);
    // A shell that fails to answer: an empty list, never a rejection.
    native.invoke.mockImplementation(async () => { throw new Error('no shell'); });
    await expect(b.listMonitors()).resolves.toEqual([]);
    await expect(b.setMonitor('x')).resolves.toBeUndefined();
  });

});

describe('<Surface> under Tauri', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let detach: () => void; let close: () => void;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const surface = () => document.querySelector('[data-surface]') as HTMLElement;
  const frames = () => calls('set_frame') as Array<{ left: number; top: number; width: number; height: number }>;
  const asking = fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });

  async function mount(opts: { tauri: boolean; islandScale?: number }) {
    if (opts.tauri) enterTauri();
    // The movement itself, not the reduced fade the unit suite runs with.
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    vi.resetModules();
    const [{ Surface }, { createDaemonClient }, { attachClient, daemonStore }] = await Promise.all([
      import('../src/surface/Surface'), import('../src/daemon/client'), import('../src/daemon/store')
    ]);
    daemonStore.reset(); mock = await createMockDaemon();
    mock.sessions.set('a', fakeSession('a'));
    const client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    close = () => client.close();
    await sleep(100);
    render(<Surface screenH={1080} screenW={1920} islandScale={opts.islandScale} client={client} dnd={false} />);
  }
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(async () => { detach(); close(); await mock.close(); vi.useRealTimers(); });

  it('in the browser nothing goes to a shell', async () => {
    await mount({ tauri: false });
    await act(async () => { await sleep(20); });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('at rest the frame is 0 × 0, so every click goes through; a request sends the pill’s rectangle, then the open card’s, then 0 × 0 again', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(frames().at(-1)).toEqual({ left: 0, top: 0, width: 0, height: 0 }));
    await act(async () => { mock.upsert(asking); await sleep(50); });
    // The pill: 72 × 36 under the top edge, centred on the 1920 px axis, with room for its shadow.
    await waitFor(() => expect(frames()).toContainEqual({ left: 960 - 36 - FRAME_PAD.left, top: 8, width: 72 + FRAME_PAD.left + FRAME_PAD.right, height: 36 + FRAME_PAD.bottom }));
    await act(async () => { vi.advanceTimersByTime(300); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'open');
    await waitFor(() => expect(frames().at(-1)!.width).toBe(420 + FRAME_PAD.left + FRAME_PAD.right));
    expect(frames().at(-1)!.left).toBe(960 - 210 - FRAME_PAD.left);
    // Answered in the terminal: the request leaves, the island closes and leaves, the region goes.
    await act(async () => { mock.upsert(fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', state: 'working' })); await sleep(50); });
    await act(async () => { vi.advanceTimersByTime(320 + 240 + 500); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'gone');
    await waitFor(() => expect(frames().at(-1)).toEqual({ left: 0, top: 0, width: 0, height: 0 }));
  });

  it('at 2× the pill and its frame are doubled', async () => {
    await mount({ tauri: true, islandScale: 2 });
    await act(async () => { mock.upsert(asking); await sleep(50); });
    await waitFor(() => expect(frames()).toContainEqual({ left: 960 - 72 - FRAME_PAD.left, top: 16, width: 144 + FRAME_PAD.left + FRAME_PAD.right, height: 72 + FRAME_PAD.bottom }));
  });

  it('Ctrl+Alt+L reopens a request set aside and takes the focus; once the island has left it gives the focus back. Without a request it does nothing', async () => {
    await mount({ tauri: true });
    await waitFor(() => expect(native.shortcut).not.toBeNull());
    await act(async () => { native.shortcut!({ state: 'Pressed' }); await sleep(20); });
    expect(calls('focus_overlay')).toHaveLength(0);
    expect(surface()).toHaveAttribute('data-phase', 'gone');
    // A request opens without taking the focus.
    await act(async () => { mock.upsert(asking); await sleep(50); vi.advanceTimersByTime(300); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'open');
    expect(calls('focus_overlay')).toHaveLength(0);
    // Later: it leaves. The shortcut brings it back, focused.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Plus tard/ })); vi.advanceTimersByTime(320 + 240); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'gone');
    await act(async () => { native.shortcut!({ state: 'Pressed' }); await sleep(20); vi.advanceTimersByTime(300); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'open');
    expect(calls('focus_overlay')).toHaveLength(1);
    expect(calls('release_focus')).toHaveLength(0);
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); vi.advanceTimersByTime(320 + 240); await sleep(20); });
    expect(surface()).toHaveAttribute('data-phase', 'gone');
    await waitFor(() => expect(calls('release_focus')).toHaveLength(1));
  });
});

describe('useNativeFrame', () => {
  beforeEach(() => { vi.useFakeTimers(); enterTauri(); });
  afterEach(() => { vi.useRealTimers(); });
  const log: string[] = [];
  async function probe(first: { left: number; top: number; w: number; h: number }, settleMs = 320) {
    vi.resetModules(); log.length = 0;
    const { useNativeFrame } = await import('../src/tauri/useNativeFrame');
    native.invoke.mockImplementation(async (cmd: string, a?: unknown) => { if (cmd === 'set_frame') log.push(JSON.stringify(a)); });
    function Probe({ f }: { f: { left: number; top: number; w: number; h: number } }) { useNativeFrame(f, settleMs); return null; }
    const r = render(<Probe f={first} />);
    return { rerender: (f: { left: number; top: number; w: number; h: number }) => r.rerender(<Probe f={f} />) };
  }
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const handle = { left: 100, top: 0, w: 44, h: 77 }, list = { left: 60, top: 0, w: 396, h: 500 };
  const HANDLE = '{"left":100,"top":0,"width":44,"height":77}', LIST = '{"left":60,"top":0,"width":396,"height":500}';

  it('the first placement and a grow go out at once: the window never moves, only its region changes', async () => {
    const p = await probe(handle);
    await tick(0);
    expect(log).toEqual([HANDLE]);
    // The list opens: laid out at a fallback size, then measured. Each pass sends its frame as soon as it lands; the
    // shell only changes the window region, which costs nothing and displaces nothing on screen.
    p.rerender({ left: 60, top: 0, w: 396, h: 480 });
    p.rerender(list);
    await tick(0);
    expect(log).toEqual([HANDLE, '{"left":60,"top":0,"width":396,"height":480}', LIST]);
  });

  it('a shrink holds the union through the settle time, then sends the final frame', async () => {
    const p = await probe(list);
    await tick(0);
    p.rerender(handle);
    await tick(0);
    expect(log).toEqual([LIST]); // the union of the list and the handle is the list frame: not resent
    await tick(319);
    expect(log).toEqual([LIST]); // the surface is still shrinking: the region keeps the whole animation visible
    await tick(1);
    expect(log).toEqual([LIST, HANDLE]);
  });

  it('a frame change during the settle re-plans against the frame the shell holds', async () => {
    const p = await probe(list);
    await tick(0);
    p.rerender(handle);
    await tick(100);
    p.rerender(list); // back to the list before the settle: the union (the list frame) already holds it
    await tick(400);
    expect(log).toEqual([LIST]); // the cancelled settle never shrank the region to the handle
  });

  it('from no region (0 × 0, the island at rest) a frame goes out alone, never unioned with the screen’s corner; back to none at once', async () => {
    const p = await probe({ left: 0, top: 0, w: 0, h: 0 });
    await tick(0);
    p.rerender(handle); await tick(0);
    expect(log).toEqual(['{"left":0,"top":0,"width":0,"height":0}', HANDLE]);
    p.rerender({ left: 0, top: 0, w: 0, h: 0 }); await tick(0);
    expect(log.at(-1)).toBe('{"left":0,"top":0,"width":0,"height":0}');
  });

  it('with no settle time a shrink applies at once', async () => {
    const p = await probe(list, 0);
    await tick(0);
    p.rerender(handle);
    await tick(0);
    expect(log).toEqual([LIST, HANDLE]);
  });

  it('a partial overlap (wider but shorter) holds the union of both until the settle', async () => {
    const p = await probe({ left: 100, top: 0, w: 44, h: 200 });
    await tick(0);
    p.rerender({ left: 60, top: 0, w: 396, h: 100 });
    await tick(0);
    expect(log).toEqual(['{"left":100,"top":0,"width":44,"height":200}', '{"left":60,"top":0,"width":396,"height":200}']);
    await tick(320);
    expect(log.at(-1)).toBe('{"left":60,"top":0,"width":396,"height":100}');
  });
});

describe('openUrl', () => {
  it('goes through the shell in Tauri, a new tab in the browser, and never for a non-web url', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const browser = await loadBridge();
    browser.openUrl('https://example.com/x');
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener');
    enterTauri(); const b = await loadBridge();
    b.openUrl('https://example.com/y');
    await vi.waitFor(() => expect(calls('open_url')).toEqual([{ url: 'https://example.com/y' }]));
    b.openUrl('javascript:alert(1)');
    await new Promise(r => setTimeout(r, 20));
    expect(calls('open_url')).toHaveLength(1); expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
