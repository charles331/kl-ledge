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
  pending: 'Awaits your approval',
  paused: 'paused', late: 'late', never: 'never run',
  lastAt: (slot: string, outcome: string) => `${slot} · ${outcome}`,
  outcome: { delivered: 'delivered', resumed: 'resumed, then delivered', launched: 'launched', failed: 'failed' },
  days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
  daily: 'every day',
  everyOther: 'every other week',
  every2: 'every 2 wks',
  oneShot: 'once',
  why: { cwd: (dir: string) => `folder not found: ${dir}`, tool: (tool: string) => `tool missing: ${tool}`, timeout: 'not typed within 30 min (session busy)' },
  more: (list: string, n: number) => `${list} and ${n} more`,
  /** A routine waiting for approval, at the top of Routines (#40 D4; cards 17, 25, 29 to 32). */
  request: {
    kind: 'Routine', ask: 'Request',
    asks: (name: string, when: string, dir: string) => `wants to schedule “${name}”: ${when}, in ${dir}`,
    groupAsks: (n: number) => `wants to schedule ${n} one-shot routines`,
    inDir: (dir: string) => `in ${dir}`,
    stale: (name: string) => `“${name}” changed since you opened it: read it again before activating.`,
    fallbackAsk: (name: string) => `“${name}” awaits your approval`,
    editAsks: (name: string, when: string) => `wants to change “${name}”: ${when}`,
    activate: 'Activate', refuse: 'Refuse',
    activateAll: (n: number) => `Activate all ${n}`, refuseAll: (n: number) => `Refuse all ${n}`,
    verify: 'Activate asks for this device’s verification (fingerprint or code), like the other sensitive actions.'
  }
};
