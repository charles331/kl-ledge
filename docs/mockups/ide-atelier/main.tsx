// Ledge Desktop's real IDE, on a daemon simulated in the page, with the « Atelier » skin laid over the app's stylesheets.
// The bar above the window switches the skin off and on, the theme, and the one colour every surface is drawn from.
import './daemon';
import '../../../apps/desktop/src/styles/app.css';
import './atelier.css';
import { createRoot } from 'react-dom/client';
import { App } from '../../../apps/desktop/src/App';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { bootLanguages } from '../../../apps/desktop/src/i18n/boot';
import { setTheme } from '../../../apps/desktop/src/shell/theme';

const q = new URLSearchParams(location.search);
const seed = (k: string, v: string) => { try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch { /* ignore */ } };
seed('desktop.lang', 'fr');
seed('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: true, bottomHeight: 200, right: true }));
// Two groups side by side: Pim in front in the first, Nova and Ida in the second.
// The store keeps the workspace as a JSON string inside its JSON value, hence the two encodings.
seed('ledge.ide.workspace', JSON.stringify(JSON.stringify({ version: 1, windows: ['main'], groups: [
  { id: 'g1', window: 'main', tabs: [{ kind: 'session', ref: 'local:pim' }], active: 0, link: 'violet' },
  { id: 'g2', window: 'main', tabs: [{ kind: 'session', ref: 'local:nova' }, { kind: 'session', ref: 'local:ida' }], active: 0, link: 'teal' }
], focus: 'g1', next: 3 })));
if (q.get('theme')) setTheme(q.get('theme') === 'light' ? 'light' : 'dark');
document.documentElement.dataset.skin = q.get('skin') === 'off' ? 'off' : 'atelier';

// ----- The bar above the window: the skin on or off, the theme, a palette, or any colour for the main background. -----
const root = document.documentElement;
/** A palette: its name, the main background in dark and in light, and the coral that goes with each. The coral stays Ledge's,
 *  its hue only leaning toward the background's (rosier on plum, more orange on sand and night). */
const PALETTES: [name: string, dark: string, light: string, coralDark: string, coralLight: string][] = [
  // The reference: the hand-drawn mockup's own colours, surface by surface (atelier.css, [data-at-ref]), not derived from the base.
  ['Maquette B', '#221f1b', '#fdfaf5', '#f27a63', '#d6543d'],
  ['Établi', '#221f1b', '#fbf7f1', '#f27a63', '#d6543d'],
  ['Sable', '#262119', '#f7f0e1', '#f08a52', '#c2611f'],
  ['Sauge', '#1b211e', '#f1f5f0', '#f1836a', '#c9553c'],
  ['Ardoise', '#1b2026', '#f1f4f8', '#f47f6a', '#d5513c'],
  ['Nuit', '#161a26', '#eef1f9', '#f59a62', '#c5651f'],
  ['Prune', '#221c25', '#f7f1f6', '#f0788f', '#cc4767'],
  ['Encre', '#18181b', '#f6f6f5', '#f27a63', '#d6543d']
];
/** Perceived lightness of a #rrggbb colour, 0 to 1: under .62 the dark theme's inks read on it, above it the light theme's. */
const light = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)); return Math.cbrt(.2126 * r! + .7152 * g! + .0722 * b!); };
const themeNow = (): 'dark' | 'light' => (root.dataset.theme === 'light' ? 'light' : 'dark');
const bar = document.getElementById('mk-bar')!;
/** The palette in use, or a colour picked by hand (the coral is then Établi's). */
let pal = PALETTES.findIndex(p => p[0].toLowerCase().replace(' ', '-') === (q.get('pal') ?? 'établi').toLowerCase()); if (pal < 0) pal = 1;
let custom: string | null = q.get('base') ? '#' + q.get('base') : null;
const baseNow = () => custom ?? PALETTES[pal]![themeNow() === 'dark' ? 1 : 2];
function apply() {
  const dark = themeNow() === 'dark', p = PALETTES[custom ? 1 : pal]!;
  const ref = !custom && pal === 0;
  if (ref) root.dataset.atRef = ''; else delete root.dataset.atRef;
  root.style.setProperty('--at-base', baseNow());
  // The reference's coral comes with its own surfaces, from the stylesheet.
  if (ref) root.style.removeProperty('--at-coral'); else root.style.setProperty('--at-coral', p[dark ? 3 : 4]);
}
function draw() {
  const skin = root.dataset.skin === 'atelier', theme = themeNow(), dark = theme === 'dark';
  bar.innerHTML = `<b>Ledge · IDE, habillage « Atelier »</b>
    <span class="mk-seg"><button data-skin="off" class="${skin ? '' : 'on'}">Aujourd'hui</button><button data-skin="atelier" class="${skin ? 'on' : ''}">Atelier</button></span>
    <span class="mk-seg"><button data-theme-set="dark" class="${dark ? 'on' : ''}">Sombre</button><button data-theme-set="light" class="${dark ? '' : 'on'}">Clair</button></span>
    <span class="mk-pals ${skin ? '' : 'off'}">${PALETTES.map((p, i) => `<button data-pal="${i}" class="${!custom && i === pal ? 'on' : ''}" ${skin ? '' : 'disabled'}><i style="background:${p[dark ? 1 : 2]};--a:${p[dark ? 3 : 4]}"></i>${p[0]}</button>`).join('')}</span>
    <span class="mk-pick ${skin ? '' : 'off'}"><label>Fond libre <input type="color" value="${baseNow()}" ${skin ? '' : 'disabled'}></label><code>${baseNow()}</code></span>
    <span class="mk-sp"></span><small>Le vrai IDE Desktop, sur des données d'exemple</small>`;
}
const refresh = () => { apply(); draw(); };
bar.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.skin) { root.dataset.skin = b.dataset.skin; draw(); }
  // A palette has a background for each theme; a colour picked by hand has one, so changing the theme drops it.
  if (b.dataset.themeSet) { custom = null; setTheme(b.dataset.themeSet as 'dark' | 'light'); }
  if (b.dataset.pal) { custom = null; pal = Number(b.dataset.pal); refresh(); }
});
// The picker moves the colour live, without redrawing the bar under the open picker; a light colour takes the light theme.
bar.addEventListener('input', e => {
  const i = e.target as HTMLInputElement; if (i.type !== 'color') return;
  custom = i.value; const want = light(custom) > .62 ? 'light' : 'dark'; if (want !== themeNow()) setTheme(want);
  apply(); bar.querySelector('code')!.textContent = custom;
});
bar.addEventListener('change', e => { if ((e.target as HTMLInputElement).type === 'color') draw(); });
// The app sets the theme on the root from an effect: the colours and the bar follow it from there.
new MutationObserver(() => { apply(); if (!bar.querySelector('input:focus')) draw(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
if (custom && (light(custom) > .62 ? 'light' : 'dark') !== themeNow()) setTheme(light(custom) > .62 ? 'light' : 'dark');
refresh();

void bootLanguages(loadMessages, 'fr').then(boot => { if (boot.ok) createRoot(document.getElementById('root')!).render(<App lang={boot.lang} />); });
