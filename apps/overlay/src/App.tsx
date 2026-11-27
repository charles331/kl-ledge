import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ISLAND_PREFS } from '@ledge/protocol';
import { createDaemonClient } from './daemon/client';
import { createFleetClient } from './daemon/fleet';
import { fleetOptions } from './surface/fleetOptions';
import { loadMachines, useIsland } from './daemon/machines';
import { attachClient } from './daemon/store';
import { Surface } from './surface/Surface';
import { daemonTokenSource, isTauri, listMonitors, screenHeight, screenWidth, setMonitor } from './tauri/bridge';
import { loadScale, migrateLegacyScale, resolveScale, saveScale, type UiScale } from './scale';
import { loadMonitor, monitorOfScreen, saveMonitor, type MonitorInfo } from './monitor';
import { LangProvider, loadLang, type Lang } from './i18n/lang';
import { LANGS } from './i18n/messages';
import { DND_KEY, loadDnd, onStorageKey } from './shared';
import { createWebAudioPlayer } from './sounds/player';
import { loadIslandPosition, saveIslandPosition, loadIslandPrefs, saveIslandPrefs, localIslandPrefs, type IslandPosition } from './island';

export function App() {
  // An isolated browser demo can point at a fake daemon without disturbing the live WSL daemon.
  const token = daemonTokenSource();
  const demo = !!(import.meta.env.DEV && import.meta.env.VITE_LEDGE_DEMO_WS); // the demo stays tokenless
  const client = useMemo(() => demo
    ? createDaemonClient({ url: import.meta.env.VITE_LEDGE_DEMO_WS })
    : createFleetClient(loadMachines(), undefined, { ...fleetOptions, token }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The work area in logical px. The page is never zoomed: the island's layer applies its own size.
  const [workH, setWorkH] = useState(window.innerHeight);
  const [workW, setWorkW] = useState(window.innerWidth);
  const [scale, setScale] = useState<UiScale>(() => { migrateLegacyScale(); return loadScale('handle'); });
  // The Screen setting (null: the primary monitor) and the monitors it can resolve to.
  const [monitor, setMonitorChoice] = useState<string | null>(loadMonitor);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  // The language is Desktop's (`desktop.lang`): the island only follows it.
  const [lang, setLang] = useState<Lang>(loadLang);
  useEffect(() => onStorageKey('desktop.lang', v => { if ((LANGS as readonly string[]).includes(v ?? '')) setLang(v as Lang); }), []);
  const [islandPosition, setIslandPosition] = useState<IslandPosition>(loadIslandPosition);
  useEffect(() => { saveIslandPosition(islandPosition); }, [islandPosition]);
  // Do not disturb is Desktop's switch: the island starts from it and follows it.
  const [dnd, setDnd] = useState(loadDnd);
  useEffect(() => onStorageKey(DND_KEY, v => setDnd(v === '1')), []);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ledge.theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; } });
  const [player] = useState(() => createWebAudioPlayer());
  const tauri = isTauri();
  const islandScale = resolveScale(scale, workH, 'handle');
  useEffect(() => { const off = attachClient(client); client.connect(); return () => { off(); client.close(); }; }, [client]);
  const refreshMonitors = () => { listMonitors().then(setMonitors).catch(() => {}); };
  useEffect(refreshMonitors, []);
  // The island's settings live in Ledge Desktop and come through the local daemon: they win over what the island stored,
  // and are stored in turn, so an offline start keeps the last ones.
  const island = useIsland(client);
  const [kept] = useState(loadIslandPrefs);
  const applied = island ?? kept ?? DEFAULT_ISLAND_PREFS;
  useEffect(() => {
    if (!island) return;
    saveIslandPrefs(island); setIslandPosition(island.position); setScale(island.islandScale);
  }, [island]);
  // The screen Desktop chose: the primary, or a monitor by its id; an older `second` is the first one that is not the primary,
  // listed again whenever it is asked for.
  const screen = island?.screen;
  useEffect(() => { if (screen === 'second') refreshMonitors(); }, [screen]);
  useEffect(() => {
    if (screen === undefined) return;
    const id = monitorOfScreen(screen, monitors);
    if (id !== undefined) setMonitorChoice(id);
  }, [screen, monitors]);
  // A daemon that holds no settings yet gets the island's own, once; the first front to send them wins, like the machines.
  const migrated = useRef(false);
  useEffect(() => {
    if (island !== null || migrated.current || !client.fleet) return;
    migrated.current = true;
    try { client.fleet.setIsland(localIslandPrefs()); } catch { migrated.current = false; }
  }, [island, client]);
  // The shell moves the overlay to the chosen monitor; the island then lays itself out in that monitor's work area.
  useEffect(() => { saveMonitor(monitor); let live = true; setMonitor(monitor).then(() => Promise.all([screenHeight(monitor), screenWidth(monitor)])).then(([h, w]) => { if (live) { setWorkH(h); setWorkW(w); } }).catch(() => {}); return () => { live = false; }; }, [monitor]);
  // In the browser the viewport is the work area: follow its resizes.
  useEffect(() => { if (tauri) return; const h = () => { setWorkH(window.innerHeight); setWorkW(window.innerWidth); }; window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [tauri]);
  useEffect(() => { saveScale('handle', scale); }, [scale]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ledge.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') setTheme(t => (t === 'dark' ? 'light' : 'dark')); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  return (
    <LangProvider lang={lang}>
      <Surface screenH={workH} screenW={workW} islandScale={islandScale} client={client} dnd={dnd} soundPlayer={player}
        islandPosition={islandPosition} visible={applied.visible} shows={applied.shows} />
    </LangProvider>
  );
}
