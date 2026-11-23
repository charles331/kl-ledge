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
  pending: 'Attend ton accord', seeInAtoi: 'Voir dans À toi',
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
  /** Why a run did not leave, from the field the daemon names (the mockup's words); any other reason is the daemon's own. */
  why: { cwd: (dir: string) => `dossier introuvable : ${dir}` },
  /** The items of « À toi »: an activation request (one routine, or several proposed together), a failure. */
  atoi: {
    kind: 'Routine', ask: 'Demande', failed: 'Échec',
    asks: (name: string, when: string, dir: string) => `veut programmer « ${name} » : ${when}, dans ${dir}`,
    groupAsks: (n: number) => `veut programmer ${n} routines uniques`,
    failedLine: (name: string, who: string, why: string) => `La routine ${name} (${who}) n’a pas pu partir : ${why}`,
    activate: 'Activer', refuse: 'Refuser', retry: 'Relancer', see: 'Voir',
    activateAll: (n: number) => `Activer les ${n}`, refuseAll: (n: number) => `Refuser les ${n}`,
    verify: 'Activer demande la vérification de cet appareil (empreinte ou code), comme les autres actions sensibles.'
  }
};

export type RoutinesCopy = typeof routinesFr;
