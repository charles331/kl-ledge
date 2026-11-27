import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderLogo } from '../../../apps/desktop/src/ide/ProviderLogo';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { LedgeMark } from '../../../apps/desktop/src/shell/LedgeMark';

/* ------------------------------------------------------------------------------------------------------------------
 * Mockup: the notch reworked as a dynamic island. Nothing rests on the screen: the island comes out of the top edge on
 * an agent's notification, opens on it, closes and leaves. The music, the Ledge chat and the activity line are gone.
 * It wears « Atelier », the IDE's skin (docs/mockups/ide-atelier, branch docs/ide-visual-directions): every surface is drawn
 * from one colour, a request is a coral card, and an agent is its provider's logo, not a mascot. The sentences, the badges
 * and the buttons are Desktop's request card's (apps/desktop/src/i18n, `pending`).
 * ---------------------------------------------------------------------------------------------------------------- */

type Theme = 'light' | 'dark';
type Lang = 'fr' | 'en';
type Provider = 'anthropic' | 'openai' | 'cursor' | 'omp';
type Kind = 'finished' | 'error' | 'permission' | 'question' | 'plan' | 'diff';
/** Where the island is in its one movement. `seed` is the small pill it passes through on the way in and out. */
type Phase = 'gone' | 'seed' | 'open';
type Two = Record<Lang, string>;
/** How a notice shows the time it has left: a ring around the provider's logo, the island's own rim, or the line at its foot. */
type Timer = 'ring' | 'rim' | 'bar';

interface Note {
  kind: Kind; who: string; provider: Provider; project: string; branch: string;
  /** A finish: the first lines of the last reply. An error: its message. A question: its text. */
  text?: Two;
  cmd?: string;
  /** The tool a permission is for (pending.tool): Bash, Edit, Write, an MCP tool… */
  tool?: string;
  /** A diff's own summary (its stat). */
  stat?: string;
  /** A plan's title. */
  title?: Two;
  options?: Record<Lang, string[]>;
}

const isRequest = (n: Note) => n.kind === 'permission' || n.kind === 'question' || n.kind === 'plan' || n.kind === 'diff';
const isReview = (n: Note) => n.kind === 'plan' || n.kind === 'diff';

/* Geometry (px) and times (ms). The notice's 6 s and the 900 ms acknowledgement are today's (surface/machine.ts). */
const G = { top: 8, seedW: 72, seedH: 36, openW: 420, logo: 16 };
const T = { appear: 260, open: 420, hold: 6000, ack: 900, close: 320, leave: 240 };

const COPY = {
  fr: {
    badge: { finished: 'Terminé', error: 'Erreur', permission: 'Ton accord', question: 'Une question', plan: 'Plan à approuver', diff: 'À relire' } as Record<Kind, string>,
    say: { finished: 'a terminé', error: 's’est arrêtée sur une erreur', permission: 'veut exécuter une commande', question: 'te pose une question', plan: 'propose un plan', diff: 'propose des modifications à relire' } as Record<Kind, string>,
    deny: 'Refuser', approve: 'Autoriser', reply: 'Répondre', review: 'Relire dans Ledge', later: 'Plus tard', laterNext: 'Plus tard, suivante',
    open: 'Ouvrir dans Ledge', short: 'Ou répondre en quelques mots…', confirmed: 'Reçu',
    sent: 'Envoyé, en attente du terminal', failed: (why: string) => `${why}. Réessaie ou ouvre la session.`, choose: 'Choisis une réponse ou écris-en une.',
    offline: 'Hors connexion : reconnexion au daemon', readOnly: 'Lecture seule : lancée sans Ledge, réponds dans son terminal',
    more: (n: number) => `+${n} ${n > 1 ? 'autres' : 'autre'}`,
    openAria: (who: string) => `Ouvrir ${who} dans Ledge`
  },
  en: {
    badge: { finished: 'Done', error: 'Error', permission: 'Approval', question: 'Question', plan: 'Plan to approve', diff: 'To review' } as Record<Kind, string>,
    say: { finished: 'finished', error: 'stopped on an error', permission: 'wants to run a command', question: 'asks you a question', plan: 'proposes a plan', diff: 'has changes for you to review' } as Record<Kind, string>,
    deny: 'Deny', approve: 'Allow', reply: 'Reply', review: 'Review in Ledge', later: 'Later', laterNext: 'Later, next',
    open: 'Open in Ledge', short: 'Or answer in a few words…', confirmed: 'Received',
    sent: 'Sent, waiting for the terminal', failed: (why: string) => `${why}. Try again or open the session.`, choose: 'Choose an answer or write one.',
    offline: 'Offline: reconnecting to the daemon', readOnly: 'Read only: started without Ledge, answer in its terminal',
    more: (n: number) => `+${n} more`,
    openAria: (who: string) => `Open ${who} in Ledge`
  }
};
type Copy = typeof COPY.fr;

/* ------------------------------------------------------------------ examples (real-looking text) */

const N: Record<string, Note> = {
  finished: { kind: 'finished', who: 'Otto', provider: 'anthropic', project: 'ledge', branch: 'fix/island-prefs',
    text: { fr: 'La préférence d’écran est relue au branchement d’un moniteur. Les 14 tests passent, la PR est prête à relire.', en: 'The screen preference is read again when a monitor is plugged in. All 14 tests pass, the PR is ready for review.' } },
  finishedBare: { kind: 'finished', who: 'Otto', provider: 'anthropic', project: 'ledge', branch: 'fix/island-prefs' },
  error: { kind: 'error', who: 'Iris', provider: 'openai', project: 'pilot', branch: 'feat/worker-retry',
    text: { fr: 'ECONNREFUSED 127.0.0.1:7317', en: 'ECONNREFUSED 127.0.0.1:7317' } },
  permission: { kind: 'permission', who: 'Pim', provider: 'anthropic', project: 'ledge', branch: 'chore/deps', cmd: 'pnpm up --latest && pnpm test' },
  question: { kind: 'question', who: 'Bix', provider: 'cursor', project: 'boutique', branch: 'feat/migration',
    text: { fr: 'Migration progressive ou courte fenêtre de maintenance ?', en: 'Gradual migration or a short maintenance window?' },
    options: { fr: ['Migration progressive', 'Fenêtre de maintenance, dimanche 2 h'], en: ['Gradual migration', 'Maintenance window, Sunday 2 am'] } },
  plan: { kind: 'plan', who: 'Nova', provider: 'omp', project: 'ledge', branch: 'feat/relay-queue', title: { fr: 'File d’attente du relais', en: 'Relay queue' } },
  diff: { kind: 'diff', who: 'Otto', provider: 'anthropic', project: 'ledge', branch: 'fix/island-prefs', stat: '3 fichiers · +42 −7' },
  edit: { kind: 'permission', who: 'Pim', provider: 'anthropic', project: 'ledge', branch: 'chore/deps', tool: 'Edit', cmd: 'apps/overlay/src/surface/Bubble.tsx' },
  mcp: { kind: 'permission', who: 'Iris', provider: 'openai', project: 'pilot', branch: 'feat/worker-retry', tool: 'github.create_pull_request', cmd: 'kl-ledge/ledge · « fix: worker retry »' },
  longQuestion: { kind: 'question', who: 'Bix', provider: 'cursor', project: 'boutique', branch: 'feat/migration',
    text: { fr: 'La table orders a 41 millions de lignes. La migration ajoute deux colonnes et un index ; sur la copie de prod elle a pris 38 minutes, avec des verrous courts. Comment veux-tu la passer ?', en: 'The orders table has 41 million rows. The migration adds two columns and an index; on the prod copy it took 38 minutes, with short locks. How do you want to run it?' },
    options: { fr: ['Migration progressive, par lots de 100 000', 'Fenêtre de maintenance, dimanche 2 h', 'En ligne, sans fenêtre, avec les verrous courts', 'Attendre la copie de prod de lundi pour mesurer encore', 'Découper : colonnes maintenant, index dimanche'], en: ['Gradual migration, in batches of 100,000', 'Maintenance window, Sunday 2 am', 'Online, no window, with the short locks', 'Wait for Monday’s prod copy to measure again', 'Split: columns now, index on Sunday'] } }
};

/* ------------------------------------------------------------------ glyphs */

const TONE: Record<Kind, string> = { finished: 'var(--success)', error: 'var(--danger-text)', permission: 'var(--primary)', question: 'var(--warning)', plan: 'var(--warning)', diff: 'var(--warning)' };

function Tone({ kind, size = 14 }: { kind: Kind; size?: number }) {
  const c = TONE[kind];
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'finished') return <svg {...common}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>;
  if (kind === 'error') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (kind === 'permission') return <svg {...common}><path d="M8 2.2 13 4v3.6c0 3-2.2 5.2-5 6.2-2.8-1-5-3.2-5-6.2V4z" /></svg>;
  if (kind === 'question') return <svg {...common}><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill={c} /></svg>;
  return <svg {...common}><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>;
}

/* ------------------------------------------------------------------ the island */

interface IslandProps {
  note: Note | null; phase: Phase; theme: Theme; lang: Lang;
  /** A static frame: no transition, no mascot motion. */
  still?: boolean;
  /** Other notifications waiting behind this one. */
  more?: number;
  /** The decision was sent and confirmed: « Reçu » for 900 ms, then the island closes. */
  ack?: boolean;
  /** What is left of a notice's 6 s, and whether the clock is held (hover). */
  leftMs?: number; held?: boolean;
  timer?: Timer;
  /** Animation time multiplier (the demo's slow motion). */
  k?: number;
  onEnter?: () => void; onLeave?: () => void;
  onDecide?: () => void; onLater?: () => void; onOpen?: () => void;
  /** States drawn by the complement (2026-11-27): the decision sent and not yet confirmed, refused, blocked; Reply pressed with
   *  nothing chosen; quick answers turned off in Desktop's settings; a card taller than the screen allows. */
  sent?: boolean; failure?: string; blocked?: 'offline' | 'readOnly'; nudge?: boolean; quickOff?: boolean; maxH?: number;
}

function Island(p: IslandProps) {
  const t = COPY[p.lang];
  const card = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = card.current; if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight)); ro.observe(el); setH(el.offsetHeight);
    return () => ro.disconnect();
  }, [p.note]);
  useEffect(() => { setChoice(null); }, [p.note]);
  const n = p.note;
  if (!n) return <div className="di-island" data-phase="gone" data-still={p.still || undefined} style={{ width: G.seedW, height: G.seedH }} />;
  const open = p.phase === 'open';
  const notice = !isRequest(n);
  const left = p.leftMs ?? T.hold;
  const pct = (left / T.hold) * 100;
  const running = open && notice && !p.held && !p.still;
  const timer = p.timer ?? 'ring';
  /** The stroke that empties: `pathLength` is 100, so the offset is the share already spent. */
  const drain = { key: `${running}|${Math.round(left)}`, pathLength: 100, style: { stroke: TONE[n.kind], strokeDashoffset: 100 - pct, animation: running ? `di-drain ${left}ms linear forwards` : 'none' } as CSSProperties };
  const size: CSSProperties = { width: open ? G.openW : G.seedW, height: open && h ? h : G.seedH, ['--di-k' as string]: p.k ?? 1, ...(p.maxH ? { ['--di-max' as string]: `${p.maxH}px` } : {}) };
  const preview = n.kind === 'finished' || n.kind === 'error' ? n.text?.[p.lang] : undefined;
  return <div className="di-island" data-phase={p.phase} data-kind={n.kind} data-still={p.still || undefined} style={size} onMouseEnter={p.onEnter} onMouseLeave={p.onLeave}>
    <div className="di-seed" aria-hidden="true">
      <ProviderLogo provider={n.provider} size={G.logo} />
      <Tone kind={n.kind} />
    </div>
    <div ref={card} className="di-card" inert={!open} role={notice ? 'button' : 'group'} tabIndex={notice && open ? 0 : undefined} aria-label={notice ? t.openAria(n.who) : undefined} onClick={notice ? p.onOpen : undefined}>
      <div className="di-head">
        <span className="di-logo">
          <ProviderLogo provider={n.provider} size={G.logo} />
          {notice && timer === 'ring' && <svg className="di-ring" viewBox="0 0 34 34" aria-hidden="true"><rect className="di-track" x="1" y="1" width="32" height="32" rx="11" /><rect className="di-left" x="1" y="1" width="32" height="32" rx="11" {...drain} /></svg>}
        </span>
        <div className="di-id">
          <span className="di-line"><span className="di-badge" data-kind={n.kind}>{t.badge[n.kind]}</span><span className="di-sentence"><b>{n.who}</b> {t.say[n.kind]}{n.title ? ` · ${n.title[p.lang]}` : ''}</span></span>
          <span className="di-meta">{n.project} · {n.branch}{p.more ? <em> · {t.more(p.more)}</em> : null}</span>
        </div>
      </div>
      {preview && <p className="di-preview" data-mono={n.kind === 'error' || undefined}>{preview}</p>}
      {n.stat && <p className="di-preview" data-mono>{n.stat}</p>}
      <div className="di-body" data-scroll={p.maxH ? 'true' : undefined}>
        {n.cmd && <div className="di-command"><span className="di-chip-k" title={n.tool ?? 'Bash'}>{n.tool ?? 'Bash'}</span><code>{n.cmd}</code></div>}
        {n.kind === 'question' && n.text && <p className="di-question">{n.text[p.lang]}</p>}
        {n.kind === 'question' && n.options && !p.quickOff && <div className="di-choices" role="radiogroup">
          {n.options[p.lang].map((o, i) => <button key={o} type="button" role="radio" aria-checked={choice === i} className="di-choice" onClick={() => setChoice(i)}><Kbd>{i + 1}</Kbd><span>{o}</span></button>)}
          <input className="di-reply" type="text" placeholder={t.short} aria-label={t.short} />
        </div>}
      </div>
      {p.nudge && <span className="di-note" data-tone="bad" role="alert">{t.choose}</span>}
      {p.failure && <span className="di-note" data-tone="bad" role="status">{t.failed(p.failure)}</span>}
      {p.blocked && <span className="di-note" role="status">{t[p.blocked]}</span>}
      {!notice && <div className="di-actions">
        {p.quickOff && !isReview(n)
          ? <Button variant="primary" size="sm" onClick={p.onOpen}>{t.open}<Kbd accent>O</Kbd></Button>
          : <>
            {n.kind === 'permission' && <><Button variant="primary" size="sm" disabled={p.ack || p.sent || !!p.blocked} onClick={p.onDecide}>{t.approve}<Kbd accent>Y</Kbd></Button><Button variant="outline" size="sm" disabled={p.ack || p.sent || !!p.blocked} onClick={p.onDecide}>{t.deny}<Kbd>N</Kbd></Button></>}
            {n.kind === 'question' && <Button variant="primary" size="sm" disabled={p.ack || p.sent || !!p.blocked} onClick={p.onDecide}>{t.reply}</Button>}
            {isReview(n) && <Button variant="primary" size="sm" onClick={p.onOpen}>{t.review}</Button>}
          </>}
        {p.ack ? <span className="di-ack" role="status">{t.confirmed}</span> : p.sent ? <span className="di-ack" role="status">{t.sent}</span> : <span className="di-foot">
          {!isReview(n) && !p.quickOff && <button type="button" onClick={p.onOpen}>{t.open}<Kbd>O</Kbd></button>}
          <button type="button" onClick={p.onLater}>{p.more ? t.laterNext : t.later}<Kbd>Esc</Kbd></button>
        </span>}
      </div>}
      {notice && timer === 'bar' && <div className="di-drain" aria-hidden="true">
        <i key={drain.key} style={{ background: TONE[n.kind], width: `${pct}%`, ['--ledge-from' as string]: `${pct}%`, animation: running ? `ledge-drain ${left}ms linear forwards` : 'none' }} />
      </div>}
    </div>
    {notice && timer === 'rim' && <svg className="di-rim" aria-hidden="true"><rect className="di-left" x="1" y="1" rx="15" {...drain} /></svg>}
  </div>;
}

/* ------------------------------------------------------------------ Ledge's own notices (complement, 2026-11-27) */

/* What Ledge says for itself, not for an agent: a rig's question, a decision put to the user, a routine, a machine
 * that dropped. The content and the sentences are today's notch's (apps/overlay/src/i18n/messages.ts: rigAsk,
 * decision, atoi.routine, offline); only the badges are new. Ledge's mark stands where an agent's provider logo would. */

type LKind = 'rig' | 'decision' | 'routineAsk' | 'routineGroup' | 'routineEdit' | 'routineFailed' | 'offline';
type LTone = 'ask' | 'bad' | 'off';
const LTONE: Record<LTone, string> = { ask: 'var(--warning)', bad: 'var(--danger-text)', off: 'var(--muted-foreground)' };

const LCOPY = {
  fr: {
    /** New: the badge of each Ledge notice. */
    badge: { rig: 'Question d’un rig', decision: 'Décision', routine: 'Routine', offline: 'Hors ligne' },
    // Today's words (rigAsk, decision, atoi.routine, offlineSub, later, openSession).
    see: 'Voir', later: 'Plus tard', answerIn: 'Répondre dans Ledge', activate: 'Activer', activateAll: (n: number) => `Activer les ${n}`, refuse: 'Refuser', retry: 'Relancer',
    decisionAsks: ' te demande une décision', offlineSub: 'Reconnexion automatique', offline: 'Une machine est hors ligne'
  },
  en: {
    badge: { rig: 'Rig question', decision: 'Decision', routine: 'Routine', offline: 'Offline' },
    see: 'View', later: 'Later', answerIn: 'Answer in Ledge', activate: 'Activate', activateAll: (n: number) => `Activate all ${n}`, refuse: 'Refuse', retry: 'Retry',
    decisionAsks: ' asks you for a decision', offlineSub: 'Reconnecting on its own', offline: 'A machine is offline'
  }
};

/** Real-looking content, as the daemon sends it today. */
const LN: Record<LKind, { tone: LTone; badge: keyof typeof LCOPY.fr.badge; sentence: Record<Lang, ReactNode>; meta?: Two; options?: Record<Lang, string[]> }> = {
  rig: { tone: 'ask', badge: 'rig', meta: { fr: 'ledge-dev · 09:12', en: 'ledge-dev · 09:12' },
    sentence: { fr: <><b>pilot-lead</b> : « On publie la 0.62 ce soir ou on attend la revue de Codex ? »</>, en: <><b>pilot-lead</b>: “Do we ship 0.62 tonight or wait for Codex’s review?”</> },
    options: { fr: ['Ce soir', 'Après la revue'], en: ['Tonight', 'After the review'] } },
  decision: { tone: 'ask', badge: 'decision', meta: { fr: 'ledge · feat/routines-ui', en: 'ledge · feat/routines-ui' },
    sentence: { fr: <><b>Otto</b>{LCOPY.fr.decisionAsks}</>, en: <><b>Otto</b>{LCOPY.en.decisionAsks}</> } },
  routineAsk: { tone: 'ask', badge: 'routine', meta: { fr: '02:10', en: '02:10' },
    sentence: { fr: <><b>Iris</b> veut programmer « point-hebdo » : 16:30 (ven), dans ~/assistant</>, en: <><b>Iris</b> wants to schedule “point-hebdo”: 16:30 (Fri), in ~/assistant</> } },
  routineGroup: { tone: 'ask', badge: 'routine', meta: { fr: '02:58', en: '02:58' },
    sentence: { fr: <><b>Iris</b> veut programmer 3 routines uniques : prepa-121 (3 déc. 16:00), prepa-comite-archi (7 déc. 15:00), prepa-demo-compart (8 déc. 09:30)</>,
      en: <><b>Iris</b> wants to schedule 3 one-shot routines: prepa-121 (3 Dec 16:00), prepa-comite-archi (7 Dec 15:00), prepa-demo-compart (8 Dec 09:30)</> } },
  routineEdit: { tone: 'ask', badge: 'routine', meta: { fr: '03:40', en: '03:40' },
    sentence: { fr: <><b>Iris</b> veut modifier « briefing » : 07:30, 13:30, 16:30 (lun–ven)</>, en: <><b>Iris</b> wants to change “briefing”: 07:30, 13:30, 16:30 (Mon–Fri)</> } },
  routineFailed: { tone: 'bad', badge: 'routine', meta: { fr: '18:00', en: '18:00' },
    sentence: { fr: <>La routine <b>veille</b> (Nova) n’a pas pu partir : dossier introuvable : ~/veille</>, en: <>The routine <b>veille</b> (Nova) could not run: folder not found: ~/veille</> } },
  offline: { tone: 'off', badge: 'offline', meta: { fr: LCOPY.fr.offlineSub, en: LCOPY.en.offlineSub },
    sentence: { fr: <b>PC du bureau</b>, en: <b>Office PC</b> } }
};

/** The sign next to Ledge's mark in the pill. */
function LGlyph({ kind, size = 14 }: { kind: LKind; size?: number }) {
  const c = LTONE[LN[kind].tone];
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'routineFailed') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (kind.startsWith('routine')) return <svg {...common}><circle cx="8" cy="8.5" r="5" /><path d="M8 6v2.7l1.8 1.2M3.5 3 5 1.8M12.5 3 11 1.8" /></svg>;
  if (kind === 'offline') return <svg {...common}><path d="M2.5 6.5a8 8 0 0 1 11 0M4.8 9a4.6 4.6 0 0 1 6.4 0M2.5 2.5l11 11" /><circle cx="8" cy="12" r=".5" fill={c} /></svg>;
  return <svg {...common}><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill={c} /></svg>;
}

/** A Ledge notice in the island: the same frame as an agent's, Ledge's mark for the logo. */
function LedgeIsland({ kind, lang, phase = 'open', timer = 'ring', noOptions }: { kind: LKind; lang: Lang; phase?: Phase; timer?: Timer; noOptions?: boolean }) {
  const t = LCOPY[lang];
  const n = LN[kind];
  const notice = kind === 'offline';
  const open = phase === 'open';
  const card = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => { const el = card.current; if (el) setH(el.offsetHeight); }, [kind, lang]);
  const pct = (STILL_LEFT / T.hold) * 100;
  const drain = { pathLength: 100, style: { stroke: LTONE[n.tone], strokeDashoffset: 100 - pct } as CSSProperties };
  const opts = noOptions ? undefined : n.options?.[lang];
  const foot = (see?: string) => <span className="di-foot">{see && <button type="button">{see}<Kbd>O</Kbd></button>}<button type="button">{t.later}<Kbd>Esc</Kbd></button></span>;
  return <div className="di-island" data-phase={phase} data-ledge={n.tone} data-still style={{ width: open ? G.openW : G.seedW, height: open && h ? h : G.seedH }}>
    <div className="di-seed" aria-hidden="true"><LedgeMark size={G.logo} /><LGlyph kind={kind} /></div>
    <div ref={card} className="di-card" inert={!open} role={notice ? 'button' : 'group'}>
      <div className="di-head">
        <span className="di-logo"><LedgeMark size={G.logo} />
          {notice && timer === 'ring' && <svg className="di-ring" viewBox="0 0 34 34" aria-hidden="true"><rect className="di-track" x="1" y="1" width="32" height="32" rx="11" /><rect className="di-left" x="1" y="1" width="32" height="32" rx="11" {...drain} /></svg>}
        </span>
        <div className="di-id">
          <span className="di-line"><span className="di-badge" style={{ ['--tone' as string]: LTONE[n.tone] }}>{t.badge[n.badge]}</span><span className="di-sentence">{n.sentence[lang]}</span></span>
          {n.meta && <span className="di-meta">{n.meta[lang]}</span>}
        </div>
      </div>
      {!notice && <div className="di-actions">
        {kind === 'rig' && (opts ? <>{opts.map((o, i) => <Button key={o} variant={i === 0 ? 'primary' : 'outline'} size="sm">{o}</Button>)}{foot(t.answerIn)}</>
          : <><Button variant="primary" size="sm">{t.answerIn}<Kbd accent>O</Kbd></Button>{foot()}</>)}
        {kind === 'decision' && <><Button variant="primary" size="sm">{t.see}<Kbd accent>O</Kbd></Button>{foot()}</>}
        {(kind === 'routineAsk' || kind === 'routineEdit') && <><Button variant="primary" size="sm">{t.activate}</Button><Button variant="outline" size="sm">{t.refuse}</Button>{foot(t.see)}</>}
        {kind === 'routineGroup' && <><Button variant="primary" size="sm">{t.activateAll(3)}</Button><Button variant="outline" size="sm">{t.refuse}</Button>{foot(t.see)}</>}
        {kind === 'routineFailed' && <><Button variant="primary" size="sm">{t.retry}</Button>{foot(t.see)}</>}
      </div>}
    </div>
  </div>;
}

function LPair({ kind, lang, tag, title, children, noOptions }: { kind: LKind; lang: Lang; tag: string; title: string; children: ReactNode; noOptions?: boolean }) {
  return <figure className="di-pair">
    <Desk theme="light"><LedgeIsland kind={kind} lang={lang} noOptions={noOptions} /></Desk>
    <Desk theme="dark"><LedgeIsland kind={kind} lang={lang} noOptions={noOptions} /></Desk>
    <figcaption><span className="di-tag">{tag}</span><strong>{title}</strong><span>{children}</span></figcaption>
  </figure>;
}

/** The texts this complement adds or changes, for the owner's validation. */
const LTEXTS: [status: string, where: string, fr: string, en: string][] = [
  ['nouveau', 'Pastille d’une question de rig', 'Question d’un rig', 'Rig question'],
  ['nouveau', 'Pastille d’une décision', 'Décision', 'Decision'],
  ['nouveau', 'Pastille d’une routine (demande, groupe, modification, échec)', 'Routine', 'Routine'],
  ['repris', 'Pastille d’une machine hors ligne (bubble.offlineBadge)', 'Hors ligne', 'Offline'],
  ['repris', '« Plus tard » sur la question d’un rig, une décision et une routine (bubble.later)', 'Plus tard', 'Later'],
  ['modifié (tutoiement, choix A de jde)', 'Pastille d’une demande d’accord (carte d’agent)', 'Votre accord → Ton accord', 'Approval (inchangé)'],
  ['modifié (tutoiement, choix A de jde)', 'Phrase d’une question (carte d’agent)', 'vous pose une question → te pose une question', 'asks you a question (inchangé)']
];

function LedgeSection({ lang }: { lang: Lang }) {
  return <Section id="ledge" title="Les avis de Ledge (complément)" lead={<>Ce que Ledge dit pour lui-même, et non pour un agent : la question d’un rig, une décision, une routine, une machine hors ligne. Même cadre que les notifications d’agent ; le <b>logo de Ledge</b> prend la place de celui du provider, dans la pastille comme dans la carte. Contenu, phrases et boutons sont ceux de l’encoche d’aujourd’hui ; seules les pastilles d’état sont nouvelles. Tout est au tutoiement.</>}>
    <div className="di-grid">
      <figure className="di-pair">
        <Desk theme="light"><div style={{ display: 'flex', gap: 10 }}>{(['rig', 'routineAsk', 'routineFailed', 'offline'] as LKind[]).map(k => <LedgeIsland key={k} kind={k} lang={lang} phase="seed" />)}</div></Desk>
        <Desk theme="dark"><div style={{ display: 'flex', gap: 10 }}>{(['rig', 'routineAsk', 'routineFailed', 'offline'] as LKind[]).map(k => <LedgeIsland key={k} kind={k} lang={lang} phase="seed" />)}</div></Desk>
        <figcaption><span className="di-tag">pastille</span><strong>Sortie du bord</strong><span>Le logo de Ledge, puis le signe de l’avis : une question ou une décision (?, ambre), une routine (réveil, ambre ; croix rouge si elle n’a pas pu partir), une machine hors ligne (réseau barré, gris).</span></figcaption>
      </figure>
      <LPair kind="rig" lang={lang} tag="demande" title="La question d’un rig">Qui demande et son rig, la question entre guillemets, les réponses proposées (3 au plus) : la réponse suggérée en premier, en corail, comme Autoriser. Répondre dans Ledge (O) ouvre la question ; Plus tard (Esc).</LPair>
      <LPair kind="rig" lang={lang} noOptions tag="demande" title="Question d’un rig sans réponses proposées">Un seul bouton, Répondre dans Ledge (O), comme aujourd’hui.</LPair>
      <LPair kind="decision" lang={lang} tag="demande" title="Une décision demandée par une session">Voir (O) ouvre « À toi » dans Ledge Desktop ; Plus tard (Esc).</LPair>
      <LPair kind="routineAsk" lang={lang} tag="demande" title="Routine : demande d’activation">Activer, Refuser, puis Voir (O) qui ouvre la page de la routine. Le prompt n’est pas déplié dans l’île (carte 15 des routines) : on le lit avec Voir.</LPair>
      <LPair kind="routineGroup" lang={lang} tag="demande" title="Routine : plusieurs uniques proposées ensemble">Activer les 3, Refuser, Voir. Un daemon trop ancien pour un groupe : le texte de la carte 33 des routines s’affiche sous la phrase, en rouge, et rien n’est envoyé.</LPair>
      <LPair kind="routineEdit" lang={lang} tag="demande" title="Routine : modification demandée par une session">« veut modifier », avec les réglages demandés.</LPair>
      <LPair kind="routineFailed" lang={lang} tag="demande" title="Routine : n’a pas pu partir">Pastille rouge. Relancer, puis Voir (O) qui ouvre la page de la routine ; Plus tard (Esc).</LPair>
      <LPair kind="offline" lang={lang} tag="avis · 6 s" title="Une machine est hors ligne">Un avis, comme un tour terminé : 6 s, l’anneau gris autour du logo, le survol retient. Le nom de la machine, « Reconnexion automatique » dessous. Un clic ouvre les machines dans Ledge Desktop. Sans nom connu : « Une machine est hors ligne ».</LPair>
    </div>
    <dl className="di-list">
      <div><dt>Avis de tir d’une routine</dt><dd>Il ne passe pas par l’encoche aujourd’hui ; l’île n’en montre pas.</dd></div>
      <div><dt>Ordre</dt><dd>Les avis de Ledge qui attendent une réponse sont des demandes : ils passent avant les avis, dans leur ordre d’arrivée, avec « +2 autres » comme les autres.</dd></div>
      <div><dt>Ne pas déranger</dt><dd>Rien ne s’ouvre, comme pour les agents. Tout reste dans « À toi ».</dd></div>
      <div><dt>Après la réponse</dt><dd>« Reçu » 900 ms, puis l’île se referme. Un refus du daemon (routine changée entre-temps, daemon trop ancien) s’affiche sous la phrase, avec les textes déjà validés des routines (cartes 32 et 33).</dd></div>
    </dl>
    <div className="di-decisions">
      <article><span className="di-tag">L1</span><h3>Le logo d’un avis de Ledge</h3><p><b>A (recommandé, maquetté).</b> Le logo de Ledge (le L blanc et le point rouge), à la place du provider.</p><p><b>B.</b> Pas de logo, seulement le signe de l’avis.</p></article>
      <article><span className="di-tag">L3</span><h3>Une machine hors ligne</h3><p><b>A (recommandé, maquetté).</b> Avis de 6 s sans bouton ; un clic ouvre les machines, comme un tour terminé ouvre sa session.</p><p><b>B.</b> Garder OK et Ouvrir dans Ledge, comme aujourd’hui.</p></article>
      <article><span className="di-tag">L4</span><h3>« Plus tard » sur la question d’un rig, une décision, une routine</h3><p><b>A (recommandé, maquetté).</b> Ajouté (texte existant) : sans lui, l’île resterait ouverte tant que tu ne réponds pas, puisqu’une demande ne se referme pas seule (décision 1).</p><p><b>B.</b> Pas de Plus tard, comme aujourd’hui.</p></article>
      <article><span className="di-tag">L5</span><h3>Le clavier</h3><p><b>A (recommandé, maquetté).</b> O pour Voir / Répondre dans Ledge, Esc pour Plus tard. Pas de Y, N ni de chiffres : activer une routine ou répondre à un rig se fait au clic, après lecture.</p><p><b>B.</b> Y / N pour Activer / Refuser une routine, 1-3 pour les réponses d’un rig.</p></article>
      <article><span className="di-tag">L6</span><h3>L’ordre des réponses d’un rig</h3><p><b>A (recommandé, maquetté).</b> La réponse suggérée en premier, à gauche, en corail, comme Autoriser sur les cartes d’agent.</p><p><b>B.</b> À droite, comme aujourd’hui.</p></article>
    </div>
    <table className="di-texts">
      <thead><tr><th>Statut</th><th>Où</th><th>FR</th><th>EN</th></tr></thead>
      <tbody>{LTEXTS.map(r => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
    </table>
  </Section>;
}

/* ------------------------------------------------------------------ an agent card's other states (complement, dev-front's questions) */

const STATE_TEXTS: [string, string, string, string][] = [
  ['repris', '1 · Envoi en cours (bubble.pending)', 'Envoyé, en attente du terminal', 'Sent, waiting for the terminal'],
  ['modifié (tutoiement)', '2 · Échec de la décision (bubble.failed)', '<raison>. Réessayez ou ouvrez la session. → <raison>. Réessaie ou ouvre la session.', '<reason>. Try again or open the session. (inchangé)'],
  ['repris', '3 · Machine hors ligne (offline)', 'Hors connexion : reconnexion au daemon', 'Offline: reconnecting to the daemon'],
  ['modifié (tutoiement)', '3 · Session en lecture seule (readOnlyBlocked)', '… répondez dans son terminal → … réponds dans son terminal', 'Read only: started without Ledge, answer in its terminal (inchangé)'],
  ['modifié (tutoiement)', '4 · Répondre sans choix (bubble.choose)', 'Choisissez une réponse ou écrivez-en une. → Choisis une réponse ou écris-en une.', 'Choose an answer or write one. (inchangé)'],
  ['nouveau', '6 · Pastille d’un diff', 'À relire', 'To review'],
  ['repris', '6 · Phrase d’un diff (sentence.review)', 'propose des modifications à relire', 'has changes for you to review']
];

function StatesSection({ lang }: { lang: Lang }) {
  const P = (props: Omit<IslandProps, 'theme' | 'phase' | 'lang'> & { tag: string; title: string; children: ReactNode }) => <Pair lang={lang} {...props} />;
  return <Section id="states" title="Les autres états d’une carte d’agent (complément)" lead="Ce que la carte de demande fait aujourd’hui et que la maquette ne dessinait pas. Mêmes textes qu’aujourd’hui, passés au tutoiement. Une ligne d’état se place toujours entre le contenu et les boutons ; « Envoyé… » et « Reçu » prennent la place des liens du bas.">
    <div className="di-grid">
      <P tag="1" title="Envoi en cours" note={N.permission!} sent>La décision est partie, le daemon ne l’a pas encore confirmée : boutons grisés, « Envoyé, en attente du terminal » à la place d’Ouvrir dans Ledge et Plus tard. Puis « Reçu » 900 ms, et l’île se referme.</P>
      <P tag="2" title="Échec de la décision" note={N.permission!} failure={lang === 'fr' ? 'La décision n’a pas été transmise' : 'The decision was not delivered'}>Le daemon refuse ou la connexion tombe : la raison en rouge sous la commande, les boutons se déverrouillent, l’île reste ouverte.</P>
      <P tag="3" title="Actions bloquées : machine hors ligne" note={N.permission!} blocked="offline">La raison en gris sous le contenu, Autoriser et Refuser grisés. Ouvrir dans Ledge et Plus tard restent actifs.</P>
      <P tag="3" title="Actions bloquées : session en lecture seule" note={N.question!} blocked="readOnly">Même place, même règle : on ne peut que l’ouvrir ou la remettre à plus tard.</P>
      <P tag="4" title="Répondre sans rien choisir" note={N.question!} nudge>« Choisis une réponse ou écris-en une. » en rouge sous les réponses ; rien n’est envoyé. Le message part dès qu’on choisit ou tape.</P>
      <P tag="5" title="Réponses rapides coupées dans les réglages" note={N.question!} quickOff>Comme un plan : le contenu reste lisible (la commande, la question), sans les réponses ni le champ ; un seul bouton, Ouvrir dans Ledge (O), puis Plus tard (Esc).</P>
      <P tag="6" title="Diff à relire" note={N.diff!}>Pastille ambre « À relire », la phrase d’aujourd’hui, le résumé du diff en mono sous l’en-tête (ses stats, comme la ligne actuelle). Relire dans Ledge, ou Plus tard.</P>
      <P tag="7" title="Trop haute pour l’écran" note={N.longQuestion!} maxH={300}>Même règle qu’aujourd’hui : l’en-tête et les boutons restent, le milieu (question, réponses, champ) défile entre deux filets. La carte ne dépasse jamais la hauteur de l’écran.</P>
      <P tag="8" title="Un autre outil que Bash : Edit" note={N.edit!}>Le nom de l’outil (pending.tool) prend la place de « Bash », avec le texte qu’il donne aujourd’hui : le fichier pour Edit et Write.</P>
      <P tag="8" title="Un outil MCP" note={N.mcp!}>Le nom de l’outil tel que l’agent l’envoie, coupé avec « … » au-delà de la largeur ; son texte dessous.</P>
    </div>
    <table className="di-texts">
      <thead><tr><th>Statut</th><th>Où</th><th>FR</th><th>EN</th></tr></thead>
      <tbody>{STATE_TEXTS.map(r => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
    </table>
  </Section>;
}

/* ------------------------------------------------------------------ Desktop › Settings › Notch (complement, dev-back's questions) */

type SRow = { label: string; hint: string; control?: string; status: 'keep' | 'new' | 'gone'; was?: string };
const SETTINGS: { title: string; note?: string; rows: SRow[] }[] = [
  { title: 'Encoche', note: 'L’encoche n’a plus de réglages à elle.', rows: [
    { status: 'new', label: '(bandeau)', hint: 'Elle vous prévient quand un agent a besoin de vous : autoriser ou répondre d’un geste, ou ouvrir la session dans Ledge Desktop.', was: 'Le menu de son chat Ledge ouvre cette page, « Réglages dans Ledge Desktop ». L’encoche garde l’essentiel : vous prévenir, autoriser ou répondre d’un geste, ouvrir une session, parler à Ledge.' },
    { status: 'new', label: 'Afficher l’encoche', hint: 'Elle sort du haut de l’écran quand un agent a besoin de vous. Masquée, Ledge Desktop continue de vous prévenir.', control: 'Encoche affichée', was: 'La petite encoche en haut de l’écran. Masquée, Ledge Desktop continue de vous prévenir.' },
    { status: 'new', label: 'Aperçu de l’encoche', hint: 'L’île ouverte sur une demande, à la position et à la taille choisies. Légende : « Au repos, rien n’est à l’écran. L’encoche s’ouvre ici sur une demande. »', was: 'Une mascotte résidente, la bulle « Otto attend votre accord », la légende « L’encoche au repos, trois agents qui l’habitent. »' },
    { status: 'new', label: 'Aperçu, ne pas déranger', hint: 'Légende : « Ne pas déranger : rien ne s’ouvre, les demandes attendent dans Ledge Desktop. »', was: 'Ne pas déranger : les demandes restent dans l’encoche, sans bulle.' },
    { status: 'keep', label: 'Écran', hint: 'L’encoche se pose en haut de cet écran (2560 × 1440).', control: 'Principal' },
    { status: 'keep', label: 'Position de l’encoche', hint: 'Au centre du bord supérieur, ou décalée au quart de l’écran pour laisser libres les titres et les onglets.', control: 'Centre' },
    { status: 'gone', label: 'Mode discret sous une fenêtre', hint: 'Retiré avec « Simuler une fenêtre maximisée » et ses deux légendes (issue #27).' },
    { status: 'new', label: 'Taille de l’encoche', hint: 'L’encoche et ses cartes, en haut de l’écran.', control: '100 %', was: 'L’encoche et ses compagnons en haut de l’écran.' },
    { status: 'gone', label: 'Taille des fenêtres de l’encoche', hint: 'Plus de liste, de session ni de chat : la taille de l’encoche règle aussi ses cartes.' }
  ] },
  { title: 'Ce que fait l’encoche', note: 'Les demandes d’accord et les questions s’affichent toujours dans l’encoche. Le reste est à votre choix.', rows: [
    { status: 'keep', label: 'Autoriser et répondre depuis l’encoche', hint: 'Autoriser, refuser (Y / N) ou répondre en une ligne sans ouvrir Ledge Desktop.', control: 'Réponses rapides dans l’encoche' },
    { status: 'new', label: 'Avis quand un agent a terminé', hint: 'La carte « Terminé » de 6 s, avec le début de sa réponse.', control: 'Avis de fin de tâche', was: 'Bulle quand un agent a terminé · Une bulle de 6 s sous l’encoche. · Bulle de fin de tâche / Pas de bulle de fin de tâche' },
    { status: 'gone', label: 'Paroles des agents', hint: 'Rien de tel sur l’île.' },
    { status: 'gone', label: 'Sous-agents dans l’encoche', hint: 'Plus de mascottes ni de bots sur l’épaule.' },
    { status: 'new', label: 'Raccourci pour rouvrir une demande', hint: 'Rouvre la plus ancienne demande en attente, partout dans Windows.', control: 'Ctrl Alt L', was: 'Raccourci pour ouvrir l’encoche · Ouvre la liste des sessions de l’encoche, partout dans Windows.' }
  ] }
];

const SETTINGS_TEXTS: [string, string, string, string][] = [
  ['nouveau', 'bannerBody', 'Elle vous prévient quand un agent a besoin de vous : autoriser ou répondre d’un geste, ou ouvrir la session dans Ledge Desktop.', 'It lets you know when an agent needs you: allow or answer in one gesture, or open the session in Ledge Desktop.'],
  ['nouveau', 'showHint', 'Elle sort du haut de l’écran quand un agent a besoin de vous. Masquée, Ledge Desktop continue de vous prévenir.', 'It comes out of the top of the screen when an agent needs you. Hidden, Ledge Desktop still lets you know.'],
  ['nouveau', 'caption.rest', 'Au repos, rien n’est à l’écran. L’encoche s’ouvre ici sur une demande.', 'At rest, nothing is on screen. The notch opens here on a request.'],
  ['nouveau', 'caption.dnd', 'Ne pas déranger : rien ne s’ouvre, les demandes attendent dans Ledge Desktop.', 'Do not disturb: nothing opens, requests wait in Ledge Desktop.'],
  ['nouveau', 'islandScaleHint', 'L’encoche et ses cartes, en haut de l’écran.', 'The notch and its cards, at the top of the screen.'],
  ['nouveau', 'finished · finishedHint · finishedOn · finishedOff', 'Avis quand un agent a terminé · La carte « Terminé » de 6 s, avec le début de sa réponse. · Avis de fin de tâche · Pas d’avis de fin de tâche', 'Notice when an agent is done · The 6 s “Done” card, with the start of its reply. · Task finished notice · No task finished notice'],
  ['nouveau', 'shortcut · shortcutHint · recorder · shortcutSaved', 'Raccourci pour rouvrir une demande · Rouvre la plus ancienne demande en attente, partout dans Windows. · Raccourci pour rouvrir une demande : {keys}. Modifier · Rouvrir une demande : {keys}', 'Shortcut to reopen a request · Reopens the oldest waiting request, anywhere in Windows. · Shortcut to reopen a request: {keys}. Edit · Reopen a request: {keys}'],
  ['nouveau', 'Raccourcis › globalRows.island', 'Rouvrir la plus ancienne demande', 'Reopen the oldest request'],
  ['retiré', 'discreet*, cover, uncover, caption.strip, caption.whole, panelScale*, say*, helpers*, bubble', '—', '—']
];

function SettingsSection() {
  return <Section id="settings" title="Ledge Desktop › Réglages › Encoche (complément)" lead="La page décrit l’encoche d’avant. Ce qui part avec elle, et les textes qui changent pour dire l’île. La page garde le vouvoiement des réglages (seule l’île tutoie). Les libellés « encoche » restent : la page ne change pas de nom.">
    <div className="di-settings">
      {SETTINGS.map(card => <div key={card.title} className="di-scard">
        <h3>{card.title}</h3>{card.note && <p className="di-snote">{card.note}</p>}
        {card.rows.map(r => <div key={r.label} className="di-srow" data-status={r.status}>
          <div><b>{r.label}</b><span>{r.hint}</span>{r.was && <s>{r.was}</s>}</div>
          {r.control && r.status !== 'gone' && <em>{r.control}</em>}
          <i>{r.status === 'new' ? 'texte nouveau' : r.status === 'gone' ? 'retiré' : 'inchangé'}</i>
        </div>)}
      </div>)}
    </div>
    <div className="di-decisions">
      <article><span className="di-tag">R1</span><h3>L’aperçu de la page</h3><p><b>A (recommandé).</b> L’île ouverte sur une demande, à la position et à la taille choisies, avec la nouvelle légende.</p><p><b>B.</b> Plus d’aperçu : au repos il n’y a rien à montrer.</p></article>
      <article><span className="di-tag">R2</span><h3>La taille des fenêtres</h3><p><b>A (recommandé).</b> Retirée : la taille de l’encoche règle aussi ses cartes. La valeur enregistrée est ignorée.</p><p><b>B.</b> Gardée, renommée « Taille des cartes de l’encoche ».</p></article>
      <article><span className="di-tag">R3</span><h3>Le raccourci global</h3><p><b>A (recommandé).</b> Renommé : il rouvre la plus ancienne demande (règle « Clavier » validée).</p><p><b>B.</b> Inchangé dans ce lot.</p></article>
    </div>
    <table className="di-texts">
      <thead><tr><th>Statut</th><th>Clé (desktop i18n, settings.island)</th><th>FR</th><th>EN</th></tr></thead>
      <tbody>{SETTINGS_TEXTS.map(r => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
    </table>
  </Section>;
}

/* ------------------------------------------------------------------ page parts */

function Desk({ theme, children, tall, window: win, hint }: { theme: Theme; children?: ReactNode; tall?: boolean; window?: boolean; hint?: string }) {
  return <div className={`di-desk th-${theme}`} data-tall={tall || undefined}>
    {win && <div className="di-window" aria-hidden="true"><i /><i><b /><b /><b /></i><i /></div>}
    <div className="di-holder">{children}</div>
    {hint && <p className="di-hint">{hint}</p>}
  </div>;
}

/** What a static frame shows of the 6 s: two thirds left, so the way the time reads can be judged. */
const STILL_LEFT = 4000;

/** The same state in light and dark. */
function Pair({ tag, title, note, children, ...props }: Omit<IslandProps, 'theme' | 'phase'> & { tag: string; title: string; children: ReactNode; phase?: Phase }) {
  return <figure className="di-pair">
    <Desk theme="light"><Island theme="light" phase="open" still leftMs={STILL_LEFT} {...props} note={note} /></Desk>
    <Desk theme="dark"><Island theme="dark" phase="open" still leftMs={STILL_LEFT} {...props} note={note} /></Desk>
    <figcaption><span className="di-tag">{tag}</span><strong>{title}</strong><span>{children}</span></figcaption>
  </figure>;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return <section className="di-section" aria-labelledby={id}>
    <header><h2 id={id}>{title}</h2>{lead && <p>{lead}</p>}</header>
    {children}
  </section>;
}

/* ------------------------------------------------------------------ the live demo */

const STEPS = ['Rien à l’écran', 'Elle sort du bord', 'Elle s’ouvre', 'Elle se referme', 'Elle disparaît'];
const HINTS = [
  'Au repos : rien. Lance un événement.',
  'Une pastille sort du bord haut, avec le logo du provider de l’agent.',
  'Ouverte. Le survol la retient, un clic ouvre la session dans Ledge.',
  'Elle se referme sur la pastille.',
  'Elle remonte dans le bord. Plus rien à l’écran.'
];

const EVENTS: { id: string; label: string; notes: Note[] }[] = [
  { id: 'finished', label: 'Tour terminé', notes: [N.finished!] },
  { id: 'error', label: 'Erreur', notes: [N.error!] },
  { id: 'permission', label: 'Demande d’accord', notes: [N.permission!] },
  { id: 'question', label: 'Question', notes: [N.question!] },
  { id: 'plan', label: 'Plan à relire', notes: [N.plan!] },
  { id: 'three', label: 'Trois d’affilée', notes: [N.finished!, N.permission!, N.error!] }
];

const TIMERS: [Timer, string][] = [['ring', 'Anneau du logo'], ['rim', 'Liseré de l’île'], ['bar', 'Trait du bas']];

function Live({ lang, palettes, timer, setTimer }: { lang: Lang; palettes: ReactNode; timer: Timer; setTimer: (t: Timer) => void }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [slow, setSlow] = useState(false);
  const k = slow ? 4 : 1;
  const [queue, setQueue] = useState<Note[]>([]);
  const [cur, setCur] = useState<Note | null>(null);
  const [phase, setPhase] = useState<Phase>('gone');
  const [closing, setClosing] = useState(false);
  const [hover, setHover] = useState(false);
  const [ack, setAck] = useState(false);
  const [left, setLeft] = useState(T.hold);
  const startedAt = useRef(0);

  /** A request always passes before a notice, as today. */
  const fire = (notes: Note[]) => setQueue(q => { const all = [...q, ...notes]; return [...all.filter(isRequest), ...all.filter(n => !isRequest(n))]; });
  /** Whether the notice's clock is running right now, read by `close` from a timer set on an earlier render. */
  const ticking = useRef(false);
  // The island closes with its clock where it stopped: run out, the ring stays empty while the card fades, it never fills again.
  const close = () => {
    if (ticking.current) { const spent = performance.now() - startedAt.current; setLeft(l => (l - spent < 80 ? 0 : l - spent)); }
    ticking.current = false; setClosing(true); setPhase('seed');
  };

  // Nothing on screen and something waits: mount it out of sight, then let it come out of the edge.
  useEffect(() => {
    if (cur || queue.length === 0) return;
    setCur(queue[0]!); setQueue(q => q.slice(1)); setClosing(false); setAck(false); setLeft(T.hold);
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('seed')));
    return () => cancelAnimationFrame(r);
  }, [cur, queue]);
  // The pill, on the way in: it opens. On the way out: the next notification takes its place, or it leaves.
  useEffect(() => {
    if (!cur || phase !== 'seed') return;
    if (!closing) { const t = setTimeout(() => setPhase('open'), T.appear * k); return () => clearTimeout(t); }
    const t = setTimeout(() => {
      if (queue.length) { setCur(queue[0]!); setQueue(q => q.slice(1)); setClosing(false); setAck(false); setLeft(T.hold); }
      else setPhase('gone');
    }, T.close * k);
    return () => clearTimeout(t);
  }, [cur, phase, closing, k]); // eslint-disable-line
  useEffect(() => {
    if (!cur || phase !== 'gone' || !closing) return;
    const t = setTimeout(() => { setCur(null); setClosing(false); }, T.leave * k);
    return () => clearTimeout(t);
  }, [cur, phase, closing, k]);
  // A notice's 6 s, held by the hover. A request has no clock.
  useEffect(() => {
    if (!cur || phase !== 'open' || isRequest(cur) || hover) return;
    startedAt.current = performance.now(); ticking.current = true;
    const t = setTimeout(close, left);
    return () => { clearTimeout(t); ticking.current = false; };
  }, [cur, phase, hover, left]);
  useEffect(() => { if (!ack) return; const t = setTimeout(close, T.ack); return () => clearTimeout(t); }, [ack]);

  const enter = () => { if (cur && phase === 'open' && !isRequest(cur) && !hover) setLeft(l => Math.max(400, l - (performance.now() - startedAt.current))); setHover(true); };
  const step = !cur ? 0 : phase === 'open' ? 2 : phase === 'seed' ? (closing ? 3 : 1) : closing ? 4 : 0;

  return <div className="di-live">
    <Desk theme={theme} tall window hint={step === 2 && cur && isRequest(cur) ? 'Une demande reste ouverte jusqu’à ta réponse ou « Plus tard ».' : HINTS[step]}>
      <Island note={cur} phase={phase} theme={theme} lang={lang} more={queue.length || undefined} ack={ack} leftMs={left} held={hover} k={k} timer={timer}
        onEnter={enter} onLeave={() => setHover(false)} onDecide={() => setAck(true)} onLater={close} onOpen={close} />
    </Desk>
    <ol className="di-steps" aria-label="Étapes">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span>{s}</li>)}</ol>
    <div className="di-controls">
      <div className="di-chips" role="group" aria-label="Événements">
        {EVENTS.map(e => <button key={e.id} type="button" className="di-chip" onClick={() => fire(e.notes)}>{e.label}</button>)}
      </div>
      <div className="di-chips" role="group" aria-label="Réglages de la démo">
        <button type="button" className="di-chip" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Sombre</button>
        <button type="button" className="di-chip" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Clair</button>
        <button type="button" className="di-chip" aria-pressed={slow} onClick={() => setSlow(s => !s)}>Ralenti ×4</button>
      </div>
      <div className="di-chips" role="group" aria-label="Temps restant">
        {TIMERS.map(([id, label]) => <button key={id} type="button" className="di-chip" aria-pressed={timer === id} onClick={() => setTimer(id)}>{label}</button>)}
      </div>
      {palettes}
    </div>
  </div>;
}

/* ------------------------------------------------------------------ the film, what leaves, rules, decisions */

const FILM: { phase: Phase; note: Note | null; title: string; text: string; time: string }[] = [
  { phase: 'gone', note: null, title: 'Rien à l’écran', text: 'Pas de filet, pas de Ledge résident, pas de pochette. Le bord haut est vide.', time: 'repos' },
  { phase: 'seed', note: N.finished!, title: 'Elle sort du bord', text: 'Une pastille de 72 × 36 px descend à 8 px du bord, avec le logo du provider de l’agent et le signe de l’événement.', time: '260 ms' },
  { phase: 'open', note: N.finished!, title: 'Elle s’ouvre sur la notification', text: 'La pastille s’élargit à 420 px et prend la hauteur du contenu. Un avis reste 6 s, l’anneau autour du logo se vide.', time: '420 ms, puis 6 s' },
  { phase: 'seed', note: N.finished!, title: 'Elle se referme', text: 'Retour à la pastille. Si une autre notification attend, elle se rouvre aussitôt sur la suivante.', time: '320 ms' },
  { phase: 'gone', note: null, title: 'Elle disparaît', text: 'La pastille remonte dans le bord et s’efface. Il ne reste rien.', time: '240 ms' }
];

const GONE: [string, string][] = [
  ['La musique', 'La pochette, les contrôles, la ligne « nouveau morceau » et les trois barres au repos. Le suivi du lecteur du PC n’est plus lu.'],
  ['Le chat Ledge dans l’encoche', 'Le clic sur Ledge et Ctrl+Alt+L n’ouvrent plus de chat ici. Demander à Ledge reste dans Ledge Desktop.'],
  ['Les tâches en cours', 'La ligne d’activité : « Otto modifie Handle.tsx », « Nova réfléchit… », les actions des sous-agents. Plus de réveil toutes les 20 s.'],
  ['Le repos visible', 'Le filet de 10 px, le trait de Ledge, Ledge résident et les épaules qui raccordaient l’encoche au bord. L’île flotte, puis s’en va.'],
  ['Les mascottes', 'Un agent est montré par le logo de son provider (Claude, OpenAI, Cursor, omp), comme dans l’IDE Atelier.'],
  ['Le réveil au survol', 'Survoler le bord haut ne montre plus rien : il n’y a plus de « dernière ligne, il y a 12 s ».'],
  ['Le réglage « discret »', 'La bande réduite sous une fenêtre maximisée n’a plus d’objet. La position (centre, gauche, droite), l’écran et la taille restent.']
];

const RULES: [string, ReactNode][] = [
  ['Ce qui ouvre l’île', <>Un tour terminé, une erreur, une demande d’accord, une question, un plan ou un diff à relire. Les avis de Ledge (la question d’un rig, une routine) et « une machine est hors ligne » gardent leur contenu actuel, dans cette forme.</>],
  ['Un avis', <>Tour terminé ou erreur : 6 s, puis l’île se referme seule. Le temps restant se lit sur l’île, et le survol retient le compte. Un clic ouvre la session dans Ledge Desktop et ferme l’île.</>],
  ['Une demande', <>Accord, question, plan, diff : mêmes boutons qu’aujourd’hui. Après la réponse, « Reçu » pendant 900 ms, puis l’île se referme.</>],
  ['Plusieurs à la suite', <>Une seule à la fois. Les demandes passent avant les avis. « +2 autres » le dit sous la phrase, et l’île repasse par la pastille entre deux.</>],
  ['Ne pas déranger', <>Rien ne s’ouvre, comme aujourd’hui. Les demandes attendent dans Ledge Desktop.</>],
  ['Clavier', <>Ctrl+Alt+L rouvre la plus ancienne demande en attente. Sans demande, il ne fait plus rien. Y, N, 1-9, O et Esc gardent leur rôle sur l’île ouverte.</>],
  ['Mouvement réduit', <>Pas de trajet ni de rebond : l’île apparaît ouverte en fondu et s’efface de même.</>]
];

function Trace({ theme, on }: { theme: Theme; on: boolean }) {
  return <Desk theme={theme}>{on && <span className="di-trace" title="Pim attend ton accord" />}</Desk>;
}

/* ------------------------------------------------------------------ page */

/** Atelier's palettes (docs/mockups/ide-atelier/main.tsx): the main background in dark and in light, and the coral that goes with each. */
const PALETTES: [name: string, dark: string, light: string, coralDark: string, coralLight: string][] = [
  ['Établi', '#221f1b', '#fbf7f1', '#f27a63', '#d6543d'],
  ['Sable', '#262119', '#f7f0e1', '#f08a52', '#c2611f'],
  ['Sauge', '#1b211e', '#f1f5f0', '#f1836a', '#c9553c'],
  ['Ardoise', '#1b2026', '#f1f4f8', '#f47f6a', '#d5513c'],
  ['Nuit', '#161a26', '#eef1f9', '#f59a62', '#c5651f'],
  ['Prune', '#221c25', '#f7f1f6', '#f0788f', '#cc4767'],
  ['Encre', '#18181b', '#f6f6f5', '#f27a63', '#d6543d']
];

function Page() {
  const [lang, setLang] = useState<Lang>('fr');
  const [pageTheme, setPageTheme] = useState<Theme>('dark');
  const [pal, setPal] = useState(0);
  const [timer, setTimer] = useState<Timer>('ring');
  useEffect(() => { document.documentElement.dataset.theme = pageTheme; }, [pageTheme]);
  useEffect(() => {
    const [, dark, light, coralDark, coralLight] = PALETTES[pal]!;
    const st = document.documentElement.style;
    st.setProperty('--di-base-dark', dark); st.setProperty('--di-base-light', light); st.setProperty('--di-coral-dark', coralDark); st.setProperty('--di-coral-light', coralLight);
  }, [pal]);
  const palettes = <div className="di-chips" role="group" aria-label="Palette Atelier">
    {PALETTES.map((p, i) => <button key={p[0]} type="button" className="di-chip di-pal" aria-pressed={i === pal} onClick={() => setPal(i)}><i style={{ background: p[1], ['--a' as string]: p[3] }} />{p[0]}</button>)}
  </div>;
  return <main className="di-page">
    <header className="di-top">
      <div>
        <p className="di-kicker">Maquette · à valider</p>
        <h1>L’île dynamique</h1>
        <p>L’encoche ne reste plus à l’écran. Elle sort du bord quand un agent a quelque chose à te dire, s’ouvre sur sa notification, se referme et disparaît. La musique, le chat Ledge et les tâches en cours quittent l’encoche. Elle porte l’habillage « Atelier » de l’IDE : ses surfaces dérivées d’une seule couleur, le corail pour ce qui t’attend, et le logo du provider à la place des mascottes.</p>
      </div>
      <div className="di-chips">
        <button type="button" className="di-chip" aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>FR</button>
        <button type="button" className="di-chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" className="di-chip" onClick={() => setPageTheme(pageTheme === 'dark' ? 'light' : 'dark')}>Page {pageTheme === 'dark' ? 'sombre' : 'claire'}</button>
      </div>
    </header>

    <Live lang={lang} palettes={palettes} timer={timer} setTimer={setTimer} />

    <Section id="film" title="Le mouvement, image par image" lead="Un seul geste, toujours le même : sortir, s’ouvrir, se refermer, partir. L’île flotte à 8 px du bord haut, elle n’y est plus accolée.">
      <ol className="di-film">
        {FILM.map((f, i) => <li key={i}>
          <div className="di-film-text"><span className="di-tag">{i + 1} · {f.time}</span><strong>{f.title}</strong><span>{f.text}</span></div>
          <Desk theme="dark"><Island theme="dark" lang={lang} phase={f.phase} note={f.note} still leftMs={STILL_LEFT} timer={timer} /></Desk>
        </li>)}
      </ol>
    </Section>

    <Section id="kinds" title="Les notifications" lead="Le logo du provider, la pastille d’état, la phrase (le nom en gras, puis ce qu’il veut), le projet et la branche. Les pastilles, les phrases et les boutons sont ceux de la carte de demande de Ledge Desktop, dans l’habillage Atelier.">
      <div className="di-grid">
        <Pair tag="avis · 6 s" title="Tour terminé" note={N.finished!} lang={lang} timer={timer}>Pastille verte. Sous la phrase, le début de la dernière réponse de l’agent, sur deux lignes au plus.</Pair>
        <Pair tag="avis · 6 s" title="Erreur" note={N.error!} lang={lang} timer={timer}>Pastille rouge. Le message de l’erreur, en mono.</Pair>
        <Pair tag="demande" title="Demande d’accord" note={N.permission!} lang={lang}>La seule carte teintée de corail : c’est à toi. La commande dans son bloc, Autoriser (Y) en corail, Refuser (N) ; puis Ouvrir dans Ledge et Plus tard.</Pair>
        <Pair tag="demande" title="Question" note={N.question!} lang={lang}>Liseré et pastille ambre. Les réponses proposées (1, 2…), le champ libre, Répondre.</Pair>
        <Pair tag="demande" title="Plan ou diff à relire" note={N.plan!} lang={lang}>Il se décide dans Ledge Desktop, après lecture : Relire dans Ledge, ou Plus tard.</Pair>
        <Pair tag="file" title="D’autres attendent" note={N.permission!} more={2} lang={lang}>« +2 autres » après la branche ; « Plus tard » devient « Plus tard, suivante ».</Pair>
      </div>
    </Section>

    <LedgeSection lang={lang} />

    <StatesSection lang={lang} />

    <SettingsSection />

    <Section id="timer" title="Le temps restant" lead="Trois façons de montrer les 6 s d’un avis. Le signe prend la couleur de l’état (vert, rouge) et s’arrête au survol. Le choix fait ici ou dans la démo s’applique à toute la page.">
      <div className="di-grid" data-three>
        {([['ring', 'A · Anneau autour du logo (recommandé)', 'Le contour de la tuile du logo se vide. Le temps se lit là où l’œil se pose d’abord, et la carte n’a plus de trait en bas.'], ['rim', 'B · Liseré de l’île', 'Le bord de l’île lui-même se vide. Plus visible, plus proche d’une « dynamic island », mais plus présent à l’écran.'], ['bar', 'C · Trait du bas', 'Le trait d’aujourd’hui, dans la couleur de l’état.']] as [Timer, string, string][]).map(([id, title, text]) => <figure key={id} className="di-pair">
          <Desk theme="light"><Island theme="light" lang={lang} phase="open" note={N.finished!} still leftMs={STILL_LEFT} timer={id} /></Desk>
          <Desk theme="dark"><Island theme="dark" lang={lang} phase="open" note={N.error!} still leftMs={STILL_LEFT} timer={id} /></Desk>
          <figcaption><strong>{title}</strong><span>{text}</span><button type="button" className="di-chip" aria-pressed={timer === id} onClick={() => setTimer(id)}>{timer === id ? 'Affiché dans la page' : 'Voir dans la page'}</button></figcaption>
        </figure>)}
      </div>
    </Section>

    <Section id="gone" title="Ce qui quitte l’encoche">
      <dl className="di-list" data-gone>{GONE.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
    </Section>

    <Section id="rules" title="Règles">
      <dl className="di-list">{RULES.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
    </Section>

    <Section id="decide" title="Quatre décisions à prendre" lead="La maquette suit chaque fois le choix recommandé. Dis-moi ceux que tu veux changer.">
      <div className="di-decisions">
        <article>
          <span className="di-tag">1</span>
          <h3>Une demande sans réponse se referme-t-elle seule ?</h3>
          <p><b>A (recommandé, maquetté).</b> Non : elle reste ouverte jusqu’à ta réponse ou « Plus tard », comme aujourd’hui. Un agent bloqué sur un accord ne passe pas inaperçu.</p>
          <p><b>B.</b> Oui, après 10 s, comme un avis. Plus léger, mais on peut la manquer.</p>
        </article>
        <article>
          <span className="di-tag">2</span>
          <h3>Après « Plus tard », reste-t-il une trace ?</h3>
          <div className="di-ab">
            <figure><Trace theme="dark" on={false} /><figcaption><b>A (maquetté).</b> Rien. Ctrl+Alt+L rouvre la demande, Ledge Desktop et le téléphone la portent.</figcaption></figure>
            <figure><Trace theme="dark" on /><figcaption><b>B (recommandé).</b> Une pastille de 22 × 6 px, rouge ou ambre, tant qu’une demande attend. Un clic la rouvre.</figcaption></figure>
          </div>
          <p>A tient l’objectif à la lettre. Je recommande B : sans trace, un agent reste arrêté tant que tu n’ouvres pas Ledge Desktop.</p>
        </article>
        <article>
          <span className="di-tag">3</span>
          <h3>Les messages entre agents</h3>
          <p><b>A (recommandé, maquetté).</b> Ils quittent l’île avec les tâches en cours : « Otto → Nova » ne te demande rien.</p>
          <p><b>B.</b> Ils restent, comme un avis de 6 s avec le résumé du message.</p>
        </article>
        <article>
          <span className="di-tag">4</span>
          <h3>Tour terminé : avec ou sans extrait ?</h3>
          <div className="di-ab">
            <figure><Desk theme="dark"><Island theme="dark" lang={lang} phase="open" note={N.finished!} still /></Desk><figcaption><b>A (recommandé, maquetté).</b> Le début de la dernière réponse : on sait où l’agent en est sans ouvrir Ledge.</figcaption></figure>
            <figure><Desk theme="dark"><Island theme="dark" lang={lang} phase="open" note={N.finishedBare!} still /></Desk><figcaption><b>B.</b> La phrase seule, sur deux lignes.</figcaption></figure>
          </div>
        </article>
      </div>
    </Section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Page />);
