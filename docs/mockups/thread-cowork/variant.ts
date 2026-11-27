// Which thread the mockup shows: today's rail, or the « Cowork » conversation. The bar above the window sets it, the thread reads it.
export type Variant = 'today' | 'cowork';

let current: Variant = new URLSearchParams(location.search).get('fil') === 'today' ? 'today' : 'cowork';
const listeners = new Set<() => void>();

export const getVariant = (): Variant => current;
export function setVariant(v: Variant): void {
  current = v;
  document.documentElement.dataset.fil = v;
  for (const l of listeners) l();
}
export function subscribeVariant(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
document.documentElement.dataset.fil = current;

/** A past exchange: its texts and actions folded under « Travail » (the request and the answer stay), or everything in sight, each
 *  run of actions on its line. The bar sets it, for the owner to compare. */
export type Past = 'folded' | 'open';
let past: Past = new URLSearchParams(location.search).get('passe') === 'ouvert' ? 'open' : 'folded';
export const getPast = (): Past => past;
export function setPast(p: Past): void { past = p; for (const l of listeners) l(); }
