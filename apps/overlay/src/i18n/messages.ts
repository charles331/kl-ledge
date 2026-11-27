/**
 * Every user-visible string of the island, aria-labels included, in French (the default) and English. `en` is typed as
 * `Messages` (the shape of `fr`): a key missing or extra on either side is a type error. The island says « tu » (the
 * owner's choice for #27); the words are the dynamic-island mockup's and its validated complement's
 * (docs/mockups/ledge-dynamic-island.html: an agent card's other states, Ledge's own notices).
 */
import type { AgentKind } from '../surface/Island';

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
  time: { locale: 'fr-FR' },
  /** Ledge's own notices (dynamic-island complement, cards #ledge): a rig's question, a decision, a routine, a machine offline. */
  ledge: {
    badge: { rig: 'Question d’un rig', decision: 'Décision', routine: 'Routine', offline: 'Hors ligne' },
    rigQuote: (text: string) => `« ${text.replace(/ (?=[?!:;])/g, '\u202f')} »`, colon: ' : ',
    answerIn: 'Répondre dans Ledge', decisionAsks: ' te demande une décision', see: 'Voir',
    offline: 'Une machine est hors ligne', offlineSub: 'Reconnexion automatique', openMachines: 'Ouvrir les machines dans Ledge'
  },
  routine: {
    ask: (who: string, name: string, when: string, dir: string) => `${who} veut programmer « ${name} » : ${when}, dans ${dir}`,
    groupAsk: (who: string, n: number, list: string) => `${who} veut programmer ${n} routines uniques : ${list}`,
    /** A session's change to a routine (card 29): the settings it asks for. */
    editAsk: (who: string, name: string, when: string) => `${who} veut modifier « ${name} » : ${when}`,
    failed: (name: string, who: string, why: string) => `La routine ${name} (${who}) n’a pas pu partir : ${why}`,
    activate: 'Activer', activateAll: (n: number) => `Activer les ${n}`, refuse: 'Refuser', retry: 'Relancer',
    days: { mon: 'lun', tue: 'mar', wed: 'mer', thu: 'jeu', fri: 'ven', sat: 'sam', sun: 'dim' }, daily: 'tous les jours', every2: '1 sem. sur 2',
    /** Why a run did not leave, as cards 8, 13-16 and 29 draw it, by the field the daemon names; any other reason is the daemon's own. */
    why: { cwd: (dir: string) => `dossier introuvable : ${dir}`, tool: (tool: string) => `outil absent : ${tool}`, timeout: 'pas tapée en 30 min (session occupée)' },
    /** An approval refused because the routine changed since the island showed it (card 32): nothing activated. */
    stale: (name: string) => `« ${name} » a changé depuis que tu l’as ouverte : relis-la avant d’activer.`,
    /** Before the routine is read: never the daemon's French task title (card 30). */
    fallbackAsk: (name: string) => `« ${name} » attend ton accord`, fallbackFailed: (name: string, why: string) => `La routine ${name} n’a pas pu partir : ${why}`,
    /** Past three moments in a request (card 28). */
    more: (list: string, n: number) => `${list} et ${n} autres`,
    /** A daemon too old for a grouped answer, or for any routine command (card 33): nothing was sent, nothing changed. */
    groupTooOld: 'Le Ledge de cette machine est trop ancien pour activer ou refuser un groupe : mets-le à jour. Rien n’a changé.',
    tooOld: 'Le Ledge de cette machine est trop ancien pour cette action : mets-le à jour. Rien n’a changé.'
  },
  island: {
    badge: { finished: 'Terminé', error: 'Erreur', permission: 'Ton accord', question: 'Une question', plan: 'Plan à approuver', diff: 'À relire' } as Record<AgentKind, string>,
    say: { finished: 'a terminé', error: 's’est arrêtée sur une erreur', permission: 'veut exécuter une commande', question: 'te pose une question', plan: 'propose un plan', diff: 'propose des modifications à relire' } as Record<AgentKind, string>,
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
  time: { locale: 'en-US' },
  ledge: {
    badge: { rig: 'Rig question', decision: 'Decision', routine: 'Routine', offline: 'Offline' },
    rigQuote: (text: string) => `“${text}”`, colon: ': ',
    answerIn: 'Answer in Ledge', decisionAsks: ' asks you for a decision', see: 'View',
    offline: 'A machine is offline', offlineSub: 'Reconnecting on its own', openMachines: 'Open the machines in Ledge'
  },
  routine: {
    ask: (who: string, name: string, when: string, dir: string) => `${who} wants to schedule “${name}”: ${when}, in ${dir}`,
    groupAsk: (who: string, n: number, list: string) => `${who} wants to schedule ${n} one-shot routines: ${list}`,
    editAsk: (who: string, name: string, when: string) => `${who} wants to change “${name}”: ${when}`,
    failed: (name: string, who: string, why: string) => `The routine ${name} (${who}) could not run: ${why}`,
    activate: 'Activate', activateAll: (n: number) => `Activate all ${n}`, refuse: 'Refuse', retry: 'Retry',
    days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }, daily: 'every day', every2: 'every 2 wks',
    why: { cwd: (dir: string) => `folder not found: ${dir}`, tool: (tool: string) => `tool missing: ${tool}`, timeout: 'not typed within 30 min (session busy)' },
    stale: (name: string) => `“${name}” changed since you opened it: read it again before activating.`,
    fallbackAsk: (name: string) => `“${name}” awaits your approval`, fallbackFailed: (name: string, why: string) => `The routine ${name} could not run: ${why}`,
    more: (list: string, n: number) => `${list} and ${n} more`,
    groupTooOld: 'This machine’s Ledge is too old to activate or refuse a group: update it. Nothing changed.',
    tooOld: 'This machine’s Ledge is too old for this action: update it. Nothing changed.'
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
