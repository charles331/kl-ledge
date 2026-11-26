/** The bots' first names, in the order they are handed out. Shared so the overlay can offer a free one before launching. */
export const NAMES: readonly string[] = [
  'Otto', 'Pim', 'Nova', 'Bix', 'Lu', 'Max', 'Ida', 'Rex', 'Zoe', 'Kit',
  'Ari', 'Bo', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jax',
  'Kai', 'Lio', 'Mo', 'Nia', 'Oz', 'Pax', 'Quin', 'Rae', 'Sol', 'Tad',
  'Uma', 'Vic', 'Wyn', 'Xen', 'Yan', 'Zia', 'Abe', 'Bea', 'Cy', 'Dot',
  'Eva', 'Fin', 'Gil', 'Hen', 'Iro', 'Jo', 'Kip', 'Lex', 'Mia', 'Ned',
  'Ola', 'Pat', 'Rio', 'Sam', 'Tia', 'Ulf', 'Val', 'Wes', 'Yui', 'Zed',
  'Ash', 'Bry', 'Cleo', 'Dax'
];

/** The longest name a session takes: room for the island's bubble, the sidebar row and `-N`. */
export const NAME_MAX = 24;

/** A name as an address: letters, digits, `-` and `_` only (a space, a comma, `@` or ` [ref]` would not resolve as `to`),
 *  cut to NAME_MAX, the first letter capitalised and the rest as typed (« PrixMat » stays PrixMat). '' when nothing is left. */
export function cleanName(raw: string): string {
  const kept = [...raw.normalize('NFC').replace(/[^\p{L}\p{N}_-]/gu, '')].slice(0, NAME_MAX).join('');
  return kept.charAt(0).toUpperCase() + kept.slice(1);
}

/** `ledge` addresses Ledge itself (`ledge task give ledge`): no session takes it. */
const RESERVED = ['ledge'];

/** True when `name` is taken, whatever the case, or a numbered session (`Otto-2`) already holds that base name. */
export function nameTaken(taken: Iterable<string>, name: string): boolean {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  const key = name.toLowerCase();
  if (used.has(key)) return true;
  const prefix = `${key}-`;
  for (const u of used) if (u.startsWith(prefix) && /^\d+$/.test(u.slice(prefix.length))) return true;
  return false;
}

/**
 * Issue #15: why a name given at launch is refused, or undefined when it may be taken. It is cleaned first (cleanName, as every
 * session name): nothing left is no name at all, never a refusal. Taken: whatever its case, or its base held by a numbered session
 * (« Otto » while « Otto-2 » runs), or reserved (« ledge »). `taken`: the names in use (namesInUse).
 */
export function nameRefusal(taken: Iterable<string>, raw: string): 'name_taken' | undefined {
  const name = cleanName(raw);
  if (!name) return undefined;
  if (RESERVED.includes(name.toLowerCase()) || nameTaken(taken, name)) return 'name_taken';
  return undefined;
}

/** The session that holds a name (cleaned, whatever its case, or its base through a numbered one), for « {n} est déjà le nom
 *  d'une session de {projet} »; undefined when none does (a reserved name is held by Ledge itself, not a session). */
export function nameHolder<T extends { name: string }>(sessions: Iterable<T>, raw: string): T | undefined {
  const key = cleanName(raw).toLowerCase();
  if (!key) return undefined;
  const all = [...sessions];
  return all.find(s => s.name.toLowerCase() === key) ?? all.find(s => { const n = s.name.toLowerCase(); return n.startsWith(`${key}-`) && /^\d+$/.test(n.slice(key.length + 1)); });
}

/** What a fresh launch should ask for. A suggestion of a base a numbered session already holds (`Otto` while `Otto-2`
 *  is live) is dropped, so the next list name is chosen. An exact clash is kept and suffixed (`Otto` → `Otto-2`). */
export function openName(taken: Iterable<string>, preferred?: string): string | undefined {
  const wanted = cleanName(preferred ?? '');
  if (!wanted) return undefined;
  const used = new Set([...taken].map(n => n.toLowerCase()));
  if (used.has(wanted.toLowerCase())) return preferred;
  if (nameTaken(taken, wanted)) return undefined;
  return preferred;
}

/** The first free name, or the preferred one (cleaned, suffixed `-2`, `-3`… while that exact name is taken). A name is
 *  taken whatever its case. With no preference, a numbered session holds its base name: `Otto-2` leaves `Otto` for the
 *  session that has it and the next launch takes `Pim`. */
export function pickName(taken: Iterable<string>, preferred?: string): string {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  for (const r of RESERVED) used.add(r);
  const free = (n: string) => !used.has(n.toLowerCase());
  // A blank --name is no preference, not an empty name (which the session schema rejects).
  const wanted = cleanName(preferred ?? '');
  if (wanted) {
    if (free(wanted)) return wanted;
    for (let i = 2; ; i++) if (free(`${wanted}-${i}`)) return `${wanted}-${i}`;
  }
  const first = NAMES.find(n => !nameTaken(taken, n));
  if (first) return first;
  for (let i = 2; ; i++) if (free(`${NAMES[0]}-${i}`)) return `${NAMES[0]}-${i}`;
}

/** The names a new session must not take: those of the sessions still there, neither ended nor archived. An archived one
 *  keeps its name for its own record, but does not hold it: with every past session counted, the 64 names were all taken
 *  and every new session was « Otto-N ». */
export const namesInUse = (sessions: Iterable<{ name: string; state: string; archivedAt?: string }>): string[] =>
  [...sessions].filter(s => s.state !== 'exited' && !s.archivedAt).map(s => s.name);
