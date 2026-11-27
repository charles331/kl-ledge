import { useEffect, useRef, useState, type JSX } from 'react';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import type { HumanAsk, Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { AskCard, AskDone } from '../../asks/AskCard';
import { AskBanner } from '../../asks/AskBanner';
import { DONE_MS, openRequests, sessionOfAsk, whoOf } from '../../asks/model';

const ALERT = ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'];
/** How long a card brought by « Ouvrir » (the island, Ledge's desk) stays ringed. */
export const REQUEST_LIT_MS = 1500;
const RANK: Record<HumanAsk['priority'], number> = { critical: 0, urgent: 1, routine: 2 };

/** The requests in the block's order (#40 D1, card 1): the most urgent first, then the most recent. */
export const requestOrder = (asks: readonly HumanAsk[]): HumanAsk[] =>
  [...asks].sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.createdAt.localeCompare(a.createdAt));


/** Whether the block shows: a request, the channel's banner (the rigs cannot write to the person), or a partial read. */
export const requestsShown = (view: OpenRigAsksView | undefined): boolean =>
  !!view && (view.asks.length > 0 || (!!view.channel && view.channel.state !== 'ready') || !!view.partial);

/**
 * « Demandes » at the top of the Rigs view (#40 D1, docs/mockups/ledge-remove-chat-d1-d3-d6.html, cards 1 to 4): what OpenRig asks
 * the person, every card whole (AskCard, as « À toi » showed it), the most urgent first. Hidden with nothing to show. It folds
 * (« Replier »), and opens again by itself when a new request comes. `focus` (« Ouvrir » on the island, Ledge's desk) unfolds it and
 * rings that card 1.5 s.
 */
export function RigRequests({ view, sessions, machineLabel, focus, onFocused, sourceOf, onOpenSeat }: {
  view: OpenRigAsksView; sessions: readonly Session[]; machineLabel: string;
  focus: { id: string; n: number } | null; onFocused?(): void;
  sourceOf?(ask: HumanAsk): ((path: string) => void) | null;
  onOpenSeat?(sessionId: string): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const v = t.ide.rigsView;
  const [open, setOpen] = useState(true);
  const [lit, setLit] = useState<string | null>(null);
  const [brought, setBrought] = useState<{ id: string; n: number } | null>(null);
  const [done, setDone] = useState<ReadonlyMap<string, { ask: HumanAsk; end: 'sent' | 'already' }>>(new Map());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  // A request not seen before opens the block again.
  const known = useRef<ReadonlySet<string>>(new Set(view.asks.map(a => a.id)));
  useEffect(() => {
    if (view.asks.some(a => !known.current.has(a.id))) setOpen(true);
    known.current = new Set(view.asks.map(a => a.id));
  }, [view.asks]);
  const seen = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === seen.current) return;
    seen.current = focus.n;
    setOpen(true); setLit(focus.id); setBrought(focus);
    later(() => setLit(l => (l === focus.id ? null : l)), REQUEST_LIT_MS);
    onFocused?.();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!requestsShown(view) && done.size === 0) return null;
  const finish = (ask: HumanAsk, end: 'sent' | 'already') => {
    setDone(d => new Map(d).set(ask.id, { ask, end }));
    later(() => setDone(d => { const n = new Map(d); n.delete(ask.id); return n; }), DONE_MS);
  };
  // The pushed list, plus the answered ones still showing their end after the push dropped them.
  const asks = requestOrder([...view.asks, ...[...done.values()].filter(d => !view.asks.some(x => x.id === d.ask.id)).map(d => d.ask)]);
  const banner = !!view.channel && view.channel.state !== 'ready';
  const count = openRequests({ ...view, asks: view.asks.filter(a => !done.has(a.id)) });
  return (
    <section className={`ide-rigs-pane ide-rigs-req${open ? ' open' : ''}`} aria-label={v.requests}>
      <div className="ide-rigs-ph">
        <span className="ide-rigs-ptog ide-rigs-req-h">{v.requests}{count > 0 && <span className="ide-rigs-n ide-rigs-req-n">{count}</span>}</span>
        <button type="button" className="ide-rigs-req-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? v.requestsFold : v.requestsUnfold}</button>
      </div>
      {open && (
        <div className="ide-rigs-req-b">
          <AskBanner channel={view.channel} machineLabel={machineLabel} />
          {!banner && view.partial && <span className="ide-rigs-req-partial" role="status"><Icon d={ALERT} size={12} />{t.asks.partial}</span>}
          {asks.map(ask => {
            const session = sessionOfAsk(ask, sessions);
            const d = done.get(ask.id);
            const who = whoOf(ask, session);
            const src = sourceOf?.(ask);
            return (
              <div key={ask.id} className={`ask-col ide-rigs-req-card${lit === ask.id ? ' lit' : ''}`} data-ask={ask.id}>
                {d ? <AskDone end={d.end} name={who.name} role={who.role} />
                  : <AskCard ask={ask} session={session} answer={view.answer} onDone={end => finish(ask, end)} focus={brought?.id === ask.id ? brought.n : 0}
                      {...(src ? { onSource: src } : {})} {...(onOpenSeat ? { onOpenSeat } : {})} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
