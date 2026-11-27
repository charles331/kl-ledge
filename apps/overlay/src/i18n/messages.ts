/**
 * Every user-visible string of the island, aria-labels included, in French (the default) and English. `en` is typed as
 * `Messages` (the shape of `fr`): a key missing or extra on either side is a type error. The island says « tu » (the
 * owner's choice for #27); the cards' words are the dynamic-island mockup's (docs/mockups/ledge-dynamic-island.html) and
 * the states it did not draw are design-ux's (« Les autres états d'une carte d'agent »).
 */
import type { CardKind } from '../surface/Island';

const fr = {
  offline: 'Hors connexion : reconnexion au daemon',
  readOnlyBlocked: 'Lecture seule : lancée sans Ledge, réponds dans son terminal',
  lost: 'La connexion a été perdue avant la réponse du terminal',
  notTaken: 'Le terminal ne l’a pas pris en compte',
  /** Said to a screen reader when Ledge Desktop is asked to open a session, or could not. */
  handoff: {
    session: (name: string) => `Ouverture de ${name} dans Ledge Desktop`,
    failed: 'Ledge Desktop n’a pas pu s’ouvrir.'
  },
  island: {
    badge: { finished: 'Terminé', error: 'Erreur', permission: 'Ton accord', question: 'Une question', plan: 'Plan à approuver', diff: 'À relire' } as Record<CardKind, string>,
    say: { finished: 'a terminé', error: 's’est arrêtée sur une erreur', permission: 'veut exécuter une commande', question: 'te pose une question', plan: 'propose un plan', diff: 'propose des modifications à relire' } as Record<CardKind, string>,
    deny: 'Refuser', approve: 'Autoriser', reply: 'Répondre', review: 'Relire dans Ledge', later: 'Plus tard', laterNext: 'Plus tard, suivante',
    open: 'Ouvrir dans Ledge', short: 'Ou répondre en quelques mots…', choices: 'Réponses proposées',
    pending: 'Envoyé, en attente du terminal', confirmed: 'Reçu',
    failed: (why: string) => `${why}. Réessaie ou ouvre la session.`,
    choose: 'Choisis une réponse ou écris-en une.',
    more: (n: number) => `+${n} ${n > 1 ? 'autres' : 'autre'}`,
    openAria: (who: string) => `Ouvrir ${who} dans Ledge`
  }
};

export type Messages = typeof fr;

const en: Messages = {
  offline: 'Offline: reconnecting to the daemon',
  readOnlyBlocked: 'Read only: started without Ledge, answer in its terminal',
  lost: 'The connection dropped before the terminal answered',
  notTaken: 'The terminal did not take it',
  handoff: {
    session: (name: string) => `Opening ${name} in Ledge Desktop`,
    failed: 'Ledge Desktop could not open.'
  },
  island: {
    badge: { finished: 'Done', error: 'Error', permission: 'Approval', question: 'Question', plan: 'Plan to approve', diff: 'To review' },
    say: { finished: 'finished', error: 'stopped on an error', permission: 'wants to run a command', question: 'asks you a question', plan: 'proposes a plan', diff: 'has changes for you to review' },
    deny: 'Deny', approve: 'Allow', reply: 'Reply', review: 'Review in Ledge', later: 'Later', laterNext: 'Later, next',
    open: 'Open in Ledge', short: 'Or answer in a few words…', choices: 'Suggested answers',
    pending: 'Sent, waiting for the terminal', confirmed: 'Received',
    failed: (why: string) => `${why}. Try again or open the session.`,
    choose: 'Choose an answer or write one.',
    more: (n: number) => `+${n} more`,
    openAria: (who: string) => `Open ${who} in Ledge`
  }
};

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
