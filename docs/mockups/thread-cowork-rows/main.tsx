// The rows the « Cowork » mockup did not draw, set in the new thread (#41, the owner's choice A of 2026-11-27): the real Desktop
// of feat/thread-cowork on a daemon simulated in the page (./daemon.ts), with ./rows.css laid over it when the bar says « Après ».
import './daemon';
import '../../../apps/desktop/src/styles/app.css';
import '../../../apps/desktop/src/styles/atelier-skin.css';
import '../../../apps/desktop/src/styles/atelier-tree.css';
import '../thread-cowork/bar.css';
import './rows.css';
import { createRoot } from 'react-dom/client';
import { App } from '../../../apps/desktop/src/App';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { bootLanguages } from '../../../apps/desktop/src/i18n/boot';
import { setTheme } from '../../../apps/desktop/src/shell/theme';

const q = new URLSearchParams(location.search);
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const vue = q.get('vue') === 'split' ? 'split' : 'large';
const root = document.documentElement;
root.dataset.rows = q.get('rows') === 'avant' ? 'avant' : 'apres';
put('desktop.lang', 'fr');
put('ledge.ide.layout', JSON.stringify(vue === 'large'
  ? { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 200, right: false }
  : { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: true, bottomHeight: 200, right: true }));
// The store keeps the workspace as a JSON string inside its JSON value, hence the two encodings.
const session = (id: string) => ({ kind: 'session', ref: `local:${id}` });
put('ledge.ide.workspace', JSON.stringify(JSON.stringify(vue === 'large'
  ? { version: 1, windows: ['main'], groups: [{ id: 'g1', window: 'main', tabs: [session('kai'), session('nova')], active: 0, link: 'violet' }], focus: 'g1', next: 2 }
  : { version: 1, windows: ['main'], groups: [
    { id: 'g1', window: 'main', tabs: [session('kai')], active: 0, link: 'violet' },
    { id: 'g2', window: 'main', tabs: [session('nova'), session('ida')], active: 0, link: 'teal' }
  ], focus: 'g1', next: 3 })));
setTheme(q.get('theme') === 'light' ? 'light' : 'dark');

const themeNow = (): 'dark' | 'light' => (root.dataset.theme === 'light' ? 'light' : 'dark');
const bar = document.getElementById('mk-bar')!;
function draw() {
  const after = root.dataset.rows === 'apres', dark = themeNow() === 'dark';
  bar.innerHTML = `<b>Ledge · fil « Cowork » · messages, avis, OpenRig, tâches</b>
    <span class="mk-seg"><button data-rows="avant" class="${after ? '' : 'on'}">Avant</button><button data-rows="apres" class="${after ? 'on' : ''}">Après</button></span>
    <span class="mk-seg"><button data-theme-set="dark" class="${dark ? 'on' : ''}">Sombre</button><button data-theme-set="light" class="${dark ? '' : 'on'}">Clair</button></span>
    <span class="mk-seg"><button data-vue="large" class="${vue === 'large' ? 'on' : ''}">Session large</button><button data-vue="split" class="${vue === 'split' ? 'on' : ''}">Deux groupes</button></span>
    <span class="mk-sp"></span><small>Le vrai code de feat/thread-cowork · Après : pas de marge d'icônes, l'heure sous la carte</small>`;
}
bar.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.rows) { root.dataset.rows = b.dataset.rows; draw(); }
  if (b.dataset.themeSet) setTheme(b.dataset.themeSet as 'dark' | 'light');
  if (b.dataset.vue && b.dataset.vue !== vue) location.search = new URLSearchParams({ vue: b.dataset.vue, theme: themeNow(), rows: root.dataset.rows! }).toString();
});
new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
draw();

void bootLanguages(loadMessages, 'fr').then(boot => { if (boot.ok) createRoot(document.getElementById('root')!).render(<App lang={boot.lang} />); });
