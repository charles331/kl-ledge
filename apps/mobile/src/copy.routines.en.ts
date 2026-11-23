// The phone's Routines words in English, key for key with copy.routines.ts: the mockup's `T.en` and `A()` English column.
import type { RoutinesCopy } from './copy.routines';

export const routinesEn: RoutinesCopy = {
  entry: 'Routines',
  entrySub: (n: number, next: string) => `${n} ${n === 1 ? 'routine' : 'routines'} · next run ${next}`,
  title: 'Routines',
  back: 'Back to sessions',
  readonly: 'To create or edit a routine: on the PC, or ask Ledge.',
  groups: { recurring: 'Recurring', once: 'Once' },
  next: (when: string) => `Next run ${when}`,
  nextDated: (when: string) => `Next: ${when}`,
  today: 'today', tomorrow: 'tomorrow',
  runNow: 'Run now', retry: 'Run again', pause: 'Pause', resume: 'Resume',
  pending: 'Awaits your approval', seeInAtoi: 'See in For you',
  paused: 'paused', late: 'late', never: 'never run',
  lastAt: (slot: string, outcome: string) => `${slot} · ${outcome}`,
  outcome: { delivered: 'delivered', resumed: 'resumed, then delivered', launched: 'launched', failed: 'failed' },
  days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
  daily: 'every day',
  everyOther: 'every other week',
  every2: 'every 2 wks',
  oneShot: 'once',
  why: { cwd: (dir: string) => `folder not found: ${dir}` },
  atoi: {
    kind: 'Routine', ask: 'Request', failed: 'Failure',
    asks: (name: string, when: string, dir: string) => `wants to schedule “${name}”: ${when}, in ${dir}`,
    groupAsks: (n: number) => `wants to schedule ${n} one-shot routines`,
    failedLine: (name: string, who: string, why: string) => `The routine ${name} (${who}) could not run: ${why}`,
    activate: 'Activate', refuse: 'Refuse', retry: 'Run again', see: 'View',
    activateAll: (n: number) => `Activate all ${n}`, refuseAll: (n: number) => `Refuse all ${n}`,
    verify: 'Activate asks for this device’s verification (fingerprint or code), like the other sensitive actions.'
  }
};
