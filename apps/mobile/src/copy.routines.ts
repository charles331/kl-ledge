// The phone's Routines words (docs/mockups/ledge-routines.html, cards 17 and 25, `T.fr` and `A()`), kept apart from copy.ts so
// the other lots' sections stay untouched; copy.ts puts them under `routines`. English: copy.routines.en.ts. Tutoiement.

export const routinesFr = {
  /** The entry at the top of Sessions: how many routines, and the next run of any of them. */
  entry: 'Routines',
  entrySub: (n: number, next: string) => `${n} ${n === 1 ? 'routine' : 'routines'} · prochain tir ${next}`,
  title: 'Routines',
  back: 'Retour aux sessions',
  readonly: 'Créer ou modifier une routine : sur le PC, ou en le demandant à Ledge.',
  groups: { recurring: 'Récurrentes', once: 'Uniques' },
  /** A weekly routine's next run (« Prochain tir aujourd’hui 13:30 »), and a dated one's (every other week, a one-shot). */
  next: (when: string) => `Prochain tir ${when}`,
  nextDated: (when: string) => `Prochain : ${when}`,
  today: 'aujourd’hui', tomorrow: 'demain',
  runNow: 'Lancer maintenant', retry: 'Relancer', pause: 'Pause', resume: 'Reprendre',
  pending: 'Attend ton accord',
  paused: 'en pause', late: 'en retard', never: 'jamais partie',
  lastAt: (slot: string, outcome: string) => `${slot} · ${outcome}`,
  outcome: { delivered: 'remise', resumed: 'reprise, puis remise', launched: 'lancée', failed: 'échouée' },
  /** How a schedule reads: its days, every day, every other week, a one-shot. */
  days: { mon: 'lun', tue: 'mar', wed: 'mer', thu: 'jeu', fri: 'ven', sat: 'sam', sun: 'dim' },
  daily: 'tous les jours',
  everyOther: '1 semaine sur 2',
  /** Every other week inside an activation request (« 16:00 (jeu, 1 sem. sur 2) »), approved by the owner. */
  every2: '1 sem. sur 2',
  oneShot: 'unique',
  /** Why a run did not leave, as cards 8, 13-16 and 29 draw it, by the field the daemon names; any other reason is the daemon's own. */
  why: { cwd: (dir: string) => `dossier introuvable : ${dir}`, tool: (tool: string) => `outil absent : ${tool}`, timeout: 'pas tapée en 30 min (session occupée)' },
  /** Past three moments in a request: « jeu. 3 déc. 16:00, …, jeu. 17 déc. 16:00 et 2 autres » (card 28). */
  more: (list: string, n: number) => `${list} et ${n} autres`,
  /** The items of « À toi »: an activation request (one routine, or several proposed together), a failure. */
  /** A routine waiting for approval, at the top of Routines (#40 D4; cards 17, 25, 29 to 32). */
  request: {
    kind: 'Routine', ask: 'Demande',
    asks: (name: string, when: string, dir: string) => `veut programmer « ${name} » : ${when}, dans ${dir}`,
    groupAsks: (n: number) => `veut programmer ${n} routines uniques`,
    /** The folder a grouped request's routines share (card 31). */
    inDir: (dir: string) => `dans ${dir}`,
    /** An approval refused because the routine changed since it was shown (card 32): the new version is read, nothing activated. */
    stale: (name: string) => `« ${name} » a changé depuis que tu l’as ouverte : relis-la avant d’activer.`,
    /** Before the routine is read: never the daemon's French task title (card 30). */
    fallbackAsk: (name: string) => `« ${name} » attend ton accord`,
    /** A session's change to a routine (card 29): the settings it asks for, no « avant → demandé » on the phone. */
    editAsks: (name: string, when: string) => `veut modifier « ${name} » : ${when}`,
    activate: 'Activer', refuse: 'Refuser',
    activateAll: (n: number) => `Activer les ${n}`, refuseAll: (n: number) => `Refuser les ${n}`,
    verify: 'Activer demande la vérification de cet appareil (empreinte ou code), comme les autres actions sensibles.'
  }
};

export type RoutinesCopy = typeof routinesFr;
