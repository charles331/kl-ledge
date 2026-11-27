// Ledge Desktop's real IDE under the Atelier skin, on a daemon simulated in the page, with the session thread redrawn as a
// conversation (./Thread.tsx, ./cowork.css). The bar above the window switches between today's thread and the new one, the
// theme, and a wide or a narrow session.
import './daemon';
import '../../../apps/desktop/src/styles/app.css';
// The « Atelier » skin, as Desktop's own main.tsx lays it over every other sheet (issue #28); the app turns it on itself.
import '../../../apps/desktop/src/styles/atelier-skin.css';
import '../../../apps/desktop/src/styles/atelier-tree.css';
import './bar.css';
import './cowork.css';
import { createRoot } from 'react-dom/client';
import { App } from '../../../apps/desktop/src/App';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { bootLanguages } from '../../../apps/desktop/src/i18n/boot';
import { setTheme } from '../../../apps/desktop/src/shell/theme';
import { getVariant, setVariant } from './variant';

const q = new URLSearchParams(location.search);
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
/** « large »: one group, the session as wide as the window allows. « split »: two groups side by side, the chat and the bottom
 *  panel open, as on the Atelier mockup: the thread at its narrowest. */
const vue = q.get('vue') === 'split' ? 'split' : 'large';
const front = ['pim', 'nova', 'ida'].indexOf(q.get('s') ?? 'pim');
put('desktop.lang', 'fr');
put('ledge.ide.layout', JSON.stringify(vue === 'large'
  ? { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 200, right: false }
  : { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: true, bottomHeight: 200, right: true }));
// The store keeps the workspace as a JSON string inside its JSON value, hence the two encodings.
const session = (id: string) => ({ kind: 'session', ref: `local:${id}` });
put('ledge.ide.workspace', JSON.stringify(JSON.stringify(vue === 'large'
  ? { version: 1, windows: ['main'], groups: [{ id: 'g1', window: 'main', tabs: [session('pim'), session('nova'), session('ida')], active: Math.max(0, front), link: 'violet' }], focus: 'g1', next: 2 }
  : { version: 1, windows: ['main'], groups: [
    { id: 'g1', window: 'main', tabs: [session('pim')], active: 0, link: 'violet' },
    { id: 'g2', window: 'main', tabs: [session('nova'), session('ida')], active: 0, link: 'teal' }
  ], focus: 'g1', next: 3 })));
setTheme(q.get('theme') === 'light' ? 'light' : 'dark');

const root = document.documentElement;
const themeNow = (): 'dark' | 'light' => (root.dataset.theme === 'light' ? 'light' : 'dark');
const bar = document.getElementById('mk-bar')!;
function draw() {
  const fil = getVariant(), dark = themeNow() === 'dark';
  bar.innerHTML = `<b>Ledge · fil de session « Cowork »</b>
    <span class="mk-seg"><button data-fil="today" class="${fil === 'today' ? 'on' : ''}">Aujourd'hui</button><button data-fil="cowork" class="${fil === 'cowork' ? 'on' : ''}">Cowork</button></span>
    <span class="mk-seg"><button data-theme-set="dark" class="${dark ? 'on' : ''}">Sombre</button><button data-theme-set="light" class="${dark ? '' : 'on'}">Clair</button></span>
    <span class="mk-seg"><button data-vue="large" class="${vue === 'large' ? 'on' : ''}">Session large</button><button data-vue="split" class="${vue === 'split' ? 'on' : ''}">Deux groupes</button></span>
    <span class="mk-sp"></span><small>Le vrai IDE Desktop sous l'habillage Atelier, sur des données d'exemple · Pim attend, Nova travaille, Ida a fini</small>`;
}
bar.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.fil) { setVariant(b.dataset.fil as 'today' | 'cowork'); draw(); }
  if (b.dataset.themeSet) setTheme(b.dataset.themeSet as 'dark' | 'light');
  if (b.dataset.vue && b.dataset.vue !== vue) { const next = new URLSearchParams({ vue: b.dataset.vue, theme: themeNow(), fil: getVariant() }); location.search = next.toString(); }
});
// The app sets the theme on the root from an effect: the bar follows it from there.
new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
draw();

void bootLanguages(loadMessages, 'fr').then(boot => { if (boot.ok) createRoot(document.getElementById('root')!).render(<App lang={boot.lang} />); });
