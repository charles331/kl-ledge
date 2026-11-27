import { useEffect, useRef, useState } from 'react';
import type { HumanAsk } from '@ledge/protocol';
import { copy } from '../../copy';
import { askEndOf, pillOf, sortAsks, whoOf } from '../../model/cards';
import { href, useRoute } from '../../router';
import { useMobile, type MobileState, type MobileStore } from '../../state/store';
import { Box, Line } from '../../ui/kit/Box';
import { Dot, Pill } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { AskCard } from '../cards/AskCard';
import { useSticky } from '../cards/Receipt';
import { usePlatform } from '../device';
import { clock } from '../../clock';
import { Lbl } from './kit';

/**
 * Whether the « Demandes » block shows (m1-reponses-rig.html §4; #40 D1): with asks, or to say why none can come (the channel not
 * ready, a partial list). A PC without `daemon.openrig`, or a ready channel with nothing asked, has none.
 */
export function requestsShown(state: MobileState, asks: readonly HumanAsk[]): boolean {
  if (!state.daemon?.openrig) return asks.length > 0;
  const ch = state.asksChannel;
  return asks.length > 0 || (ch !== null && (ch.partial || ch.channel.state !== 'ready'));
}

/** Why OpenRig's asks may be missing, with Desktop's words (Q66): the channel, else a partial read. */
export function ChannelStrip({ state, machine }: { state: MobileState; machine: string }) {
  const ch = state.asksChannel;
  if (!ch) return null;
  const C = copy.asks.channel;
  const lines = ch.channel.state === 'ready'
    ? (ch.partial ? { title: null, body: copy.asks.partial } : null)
    : ch.channel.state === 'not_installed'
      ? { title: C.not_installed.title(machine), body: C.not_installed.body }
      : { title: C[ch.channel.state].title, body: C[ch.channel.state].body };
  if (!lines) return null;
  return (
    <div role="status" data-channel={ch.channel.state} className="flex items-start gap-[9px] rounded-lg border border-line px-3 py-2.5 text-[13px] leading-[18px]">
      <span className="mt-[5px]"><Dot state="off" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {lines.title && <span className="font-medium">{lines.title}</span>}
        {lines.body && <span className="text-muted">{lines.body}</span>}
      </div>
    </div>
  );
}

/**
 * The Rigs tab's « Demandes » (#40 D1, docs/mockups/ledge-remove-chat-d1-d3-d6.html, card 3): what OpenRig asks the person, at the
 * top of the tab, the most urgent then the most recent, each with the card « À toi » had before #40 (choices, a free answer, « Vu », the
 * device's check when needed). On a wide screen the list's rows open each ask beside it. It folds, and unfolds again when a new
 * ask comes; nothing shows with no ask nor anything to say about the channel.
 */
export function RigsRequests({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const wide = useWide();
  const route = useRoute();
  const platform = usePlatform();
  const asks = sortAsks(state.asks ?? []);
  const cards = useSticky(asks.map(a => ({ id: a.id, value: a })));
  const [folded, setFolded] = useState(false);
  // A new ask unfolds the block again (D1).
  const seen = useRef<ReadonlySet<string>>(new Set(asks.map(a => a.id)));
  useEffect(() => {
    if (asks.some(a => !seen.current.has(a.id))) setFolded(false);
    seen.current = new Set(asks.map(a => a.id));
  }, [asks]);
  if (!requestsShown(state, asks)) return null;
  const R = copy.rigs;
  const machine = state.daemon?.name ?? '';
  const offline = !state.fresh;
  const fold = (
    <button type="button" aria-expanded={!folded} onClick={() => setFolded(!folded)} className="text-muted">
      {folded ? R.unfold : R.fold}
    </button>
  );
  const head = <Lbl aside={fold}>{R.requests} <span className="text-attention">{asks.length}</span></Lbl>;
  if (wide) {
    return (
      <section aria-label={R.requests} className="flex flex-col gap-1.5">
        {head}
        {!folded && (
          <Box tone="rigs">
            <div className="p-2 empty:hidden"><ChannelStrip state={state} machine={machine} /></div>
            {asks.map(a => {
              const who = whoOf(a);
              return (
                <Line
                  key={a.id} href={href({ name: 'ask', id: a.id })} stale={offline} selected={route.name === 'ask' && route.id === a.id}
                  title={<>{a.priority !== 'routine' && <><Pill tone="urgent">{copy.asks.priority[a.priority]}</Pill> </>}<b className="font-semibold">{who.name}</b>{a.from.rig ? ` · ${a.from.rig}` : ''}</>}
                  sub={a.summary} meta={clock(a.updatedAt)}
                >
                  <span className="sr-only">{copy.asks.pill[pillOf(a)]}</span>
                </Line>
              );
            })}
          </Box>
        )}
      </section>
    );
  }
  const canConfirm = state.device?.confirm === true && platform;
  const enroll = platform && state.device?.confirm !== true;
  return (
    <section aria-label={R.requests} className="flex flex-col gap-2.5">
      {head}
      {!folded && <>
        <ChannelStrip state={state} machine={machine} />
        {cards.entries.map(e => (
          <AskCard
            key={e.id} store={store} ask={e.value} end={askEndOf(e.id, state.ops)} fresh={state.fresh} ghost={e.ghost}
            canConfirm={canConfirm} enroll={enroll} onGone={() => cards.dismiss(e.id)}
          />
        ))}
      </>}
    </section>
  );
}
