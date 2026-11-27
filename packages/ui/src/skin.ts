/**
 * The « Atelier » skin (issue #28, docs/superpowers/specs/2026-11-26-ide-atelier-skin.md §3): every surface drawn from one
 * colour, the main background, and one coral for the brand and for « c'est à toi ». Computed here rather than with CSS
 * `oklch(from …)`, so the values are tested and no WebView version is assumed.
 *
 * One set of tokens for every front that wears the skin (Desktop's IDE, the island of #27): `skinTokens` gives the CSS
 * custom properties, `applySkin` paints them inline on an element, beside `data-skin="atelier"` for the stylesheets that
 * scope their rules to it. Nothing here touches the state colours (success, warning, info, destructive).
 */
import { accentTokens, parseAccent } from './accent';

export type SkinTheme = 'dark' | 'light';
export interface Palette { id: string; dark: { base: string; coral: string }; light: { base: string; coral: string } }

/** The spec's palettes (§3.2). Only « Établi » ships for now; the others wait for the picker's mockup. */
export const PALETTES: readonly Palette[] = [
  { id: 'etabli', dark: { base: '#221f1b', coral: '#f27a63' }, light: { base: '#fbf7f1', coral: '#d6543d' } },
  { id: 'sable', dark: { base: '#262119', coral: '#f08a52' }, light: { base: '#f7f0e1', coral: '#c2611f' } },
  { id: 'sauge', dark: { base: '#1b211e', coral: '#f1836a' }, light: { base: '#f1f5f0', coral: '#c9553c' } },
  { id: 'ardoise', dark: { base: '#1b2026', coral: '#f47f6a' }, light: { base: '#f1f4f8', coral: '#d5513c' } },
  { id: 'nuit', dark: { base: '#161a26', coral: '#f59a62' }, light: { base: '#eef1f9', coral: '#c5651f' } },
  { id: 'prune', dark: { base: '#221c25', coral: '#f0788f' }, light: { base: '#f7f1f6', coral: '#cc4767' } },
  { id: 'encre', dark: { base: '#18181b', coral: '#f27a63' }, light: { base: '#f6f6f5', coral: '#d6543d' } }
];
export const DEFAULT_PALETTE = PALETTES[0]!;

// ---- OKLCH ⇄ sRGB (Björn Ottosson's OKLab) ----
type Lch = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function hexToOklch(hex: string): Lch {
  const n = Number.parseInt((parseAccent(hex) ?? '#000000').slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** `#rrggbb`, or `#rrggbbaa` with `alpha` under 1; out-of-gamut channels are clipped. */
export function oklchToHex([L, C, H]: Lch, alpha = 1): string {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  const byte = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');
  return `#${rgb.map(c => byte(toGamma(clamp01(c)))).join('')}${alpha < 1 ? byte(alpha) : ''}`;
}

const at = (l: number, c: number, h: number, alpha = 1) => oklchToHex([clamp01(l), Math.max(0, c), h], alpha);

/** The ladder of §3.1, from the main background; its chroma is capped (0.04 dark, 0.028 light) so a vivid pick stays usable. */
export interface Ladder { pane: string; side: string; well: string; bench: string; card: string; raise: string; field: string; ink: string; ink2: string; line: string; line2: string; /** The focused group's border (#28 focus cue, option A). */ line3: string }
export function skinLadder(base: string, theme: SkinTheme): Ladder {
  const [l, c0, h] = hexToOklch(base);
  const c = Math.min(c0, theme === 'dark' ? 0.04 : 0.028);
  if (theme === 'dark') {
    const ink: Lch = [0.95, c * 0.9 + 0.004, h];
    const well = at(l - 0.04, c, h);
    return {
      pane: at(l, c, h), side: at(l - 0.018, c, h), well, bench: at(l - 0.068, c * 0.9, h), card: at(l + 0.04, c, h), raise: at(l + 0.075, c, h),
      field: well, ink: oklchToHex(ink), ink2: at(0.69, c + 0.004, h), line: oklchToHex(ink, 0.09), line2: oklchToHex(ink, 0.17), line3: oklchToHex(ink, 0.32)
    };
  }
  const ink: Lch = [0.24, c + 0.012, h];
  const card = at(Math.min(1, l + 0.02), c * 0.5, h);
  return {
    pane: at(l, c, h), side: at(l - 0.025, c, h), well: at(l - 0.035, c, h), bench: at(l - 0.08, c * 1.1, h), card, raise: at(l - 0.055, c, h),
    field: card, ink: oklchToHex(ink), ink2: at(0.52, c + 0.012, h), line: oklchToHex(ink, 0.11), line2: oklchToHex(ink, 0.2), line3: oklchToHex(ink, 0.38)
  };
}

export interface SkinOptions { theme: SkinTheme; palette?: Palette; /** Settings › Appearance's accent: it wins over the palette's coral. */ accent?: string | null }

/** Every custom property the skin sets, by name. */
export function skinTokens({ theme, palette = DEFAULT_PALETTE, accent = null }: SkinOptions): Record<string, string> {
  const p = palette[theme];
  const s = skinLadder(p.base, theme);
  const chosen = parseAccent(accent);
  const coral = chosen ? accentTokens(chosen, theme).sidebarPrimary : p.coral;
  const [cl, cc, ch] = hexToOklch(coral);
  const coralInk = chosen ? accentTokens(chosen, theme).primaryForeground : theme === 'dark' ? at(0.2, 0.04, ch) : '#ffffff';
  // The ink on an amber pill (« À toi » for a question): tokens.css's --warning, darkened as the mockup's oklch(from … .2 .04 h).
  const wh = hexToOklch(theme === 'dark' ? '#fbbf24' : '#b45309')[2];
  return {
    '--at-pane': s.pane, '--at-side': s.side, '--at-well': s.well, '--at-bench': s.bench, '--at-card': s.card, '--at-raise': s.raise,
    '--at-field': s.field, '--at-ink': s.ink, '--at-ink2': s.ink2, '--at-line': s.line, '--at-line2': s.line2, '--at-line3': s.line3,
    '--at-coral': coral, '--at-coral-ink': coralInk, '--at-warning-ink': at(0.2, 0.04, wh),
    '--background': s.field, '--foreground': s.ink,
    '--card': s.card, '--card-foreground': s.ink, '--popover': s.card, '--popover-foreground': s.ink,
    '--secondary': s.raise, '--secondary-foreground': s.ink, '--muted': s.raise, '--muted-foreground': s.ink2,
    '--accent': s.raise, '--accent-foreground': s.ink,
    '--border': s.line, '--input': s.line2, '--ring': s.ink2,
    '--sidebar': s.pane, '--sidebar-foreground': s.ink, '--sidebar-accent': s.raise, '--sidebar-accent-foreground': s.ink,
    '--sidebar-border': s.line, '--sidebar-ring': s.ink2,
    '--well': s.well, '--term-bg': s.well, '--term-fg': s.ink, '--term-cursor': s.ink,
    '--primary': coral, '--primary-foreground': coralInk, '--primary-hover': at(cl - 0.05, cc, ch),
    '--sidebar-primary': coral, '--sidebar-primary-foreground': coralInk, '--ide-tab-front': coral,
    '--radius-sm': '8px', '--radius-md': '10px', '--radius-lg': '12px', '--radius-xl': '16px', '--at-gap': '6px'
  };
}

const SKIN_VARS = Object.keys(skinTokens({ theme: 'dark' }));

/**
 * Wears the skin on `el` (the root by default): `data-skin="atelier"` and every token inline. `null` takes it off, leaving the
 * shared tokens.css. Order with `applyAccent`, which sets and removes some of the same names: on, `applyAccent` then
 * `applySkin(opts)` (the accent is folded in here); off, `applySkin(null)` then `applyAccent`.
 */
export function applySkin(opts: SkinOptions | null, el: HTMLElement = document.documentElement): void {
  if (!opts) {
    delete el.dataset.skin;
    for (const name of SKIN_VARS) el.style.removeProperty(name);
    return;
  }
  el.dataset.skin = 'atelier';
  for (const [name, value] of Object.entries(skinTokens(opts))) el.style.setProperty(name, value);
}
