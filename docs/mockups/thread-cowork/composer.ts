// The mockup's own state of the reply field: which session dictates, and the asides (« /btw ») asked so far. Nothing of it
// exists in the app: an implementation gives the aside to the harness and the voice to a dictation service.
import type { Session } from '@ledge/protocol';
import { getVariant } from './variant';

export type Mode = 'voice' | null;
/** « /btw » and its question, as typed in the reply field. */
const BTW = /^\/btw(?:\s+([\s\S]*))?$/;
/** The field holds an aside: it starts with « /btw ». */
export const isBtw = (text: string): boolean => BTW.test(text.trim());
export interface Aside { id: number; question: string; answer: string; at: string }

const modes = new Map<string, Mode>();
const asides = new Map<string, readonly Aside[]>();
const listeners = new Set<() => void>();
const NONE: readonly Aside[] = [];
let next = 1;
const emit = () => { for (const l of listeners) l(); };
/** A session's daemon id without its machine (« local:nova » → « nova »): the page and the reply do not name it alike. */
const key = (id: string) => id.slice(id.lastIndexOf(':') + 1);

export const subscribeComposer = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const modeOf = (id: string): Mode => modes.get(key(id)) ?? null;
export const asidesOf = (id: string): readonly Aside[] => asides.get(key(id)) ?? NONE;
export function toggleMode(id: string, mode: Exclude<Mode, null>): void { modes.set(key(id), modeOf(id) === mode ? null : mode); emit(); }
export function closeAside(id: string, aside: number): void { asides.set(key(id), asidesOf(id).filter(a => a.id !== aside)); emit(); }

/** Enter or the send button on « /btw … »: the question becomes an aside beside the thread, not a message in it. True when
 *  taken (a bare « /btw » is taken too, and waits for its question). */
export function takeBtw(session: Session, text: string, clear: () => void): boolean {
  const question = BTW.exec(text.trim());
  if (getVariant() !== 'cowork' || !question) return false;
  if (!question[1]?.trim()) return true;
  asides.set(key(session.id), [...asidesOf(session.id), { id: next++, question: question[1].trim(), at: new Date().toISOString(),
    answer: `(Exemple de réponse) ${session.name} répond ici en quelques lignes, sans interrompre son travail et sans que l'échange entre dans le fil.` }]);
  clear(); emit();
  return true;
}

// One aside already asked, so the mockup shows it without typing.
asides.set('nova', [{ id: next++, question: 'Au fait, c\'est WebGL 1 ou 2 qu\'on demande ?', at: new Date(Date.now() - 30_000).toISOString(),
  answer: 'WebGL 2 : `WebglAddon` le demande d\'abord, et le terminal retombe sur le rendu DOM s\'il manque.' }]);
