# Routines: Ledge wakes a standing session at set times

Date: 2026-11-23. Status: **approved by the owner on 2026-11-23** (decisions in §5), ready for the plan. Delivered in
one go: daemon, protocol, CLI, « le point », chat context, and the Routines screens on Desktop, the phone and
`ledge tui`. The screens start with a mockup in `docs/mockups/` that **the owner** approves before any UI code (§3.7).

## 1. Where we are

Checked in the code on 2026-11-23 (`origin/main` at `756fd2a2`, 0.62.0).

Ledge can already do every step of a recurring job except the first one:

- **Launch and resume a session** in a folder, with a first prompt: `session.launch` (`packages/ledge/src/daemon/server.ts:1349`),
  and the resume path that brings a session back with its conversation (`server.ts:981`, `RESUME_ARGS`).
- **Type into a live session at its next free moment**: `Mailbox.notify()` (`daemon/mailbox.ts`), used by task pointers.
- **Hand the user a decision** and wake the session with the answer: `ledge task give ledge` (`daemon/tasks.ts`), shown
  in « À toi » on the PC and the phone.
- **Durable facts** the user validates: `ledge brain propose` (spec 2026-11-04-brain-design).
- **Persist across daemon restarts**: `jsonJournal` (`daemon/journal.ts`).
- **Relief** when a session's context nears its limit: the usual « Passer le relais » suggestion (`daemon/handover.ts`).

What is missing is a clock. Nothing in the daemon fires at a time of day: today the owner would have to wire a WSL
crontab to a shell script that finds the session, starts it if gone and types into it — outside Ledge, with no trace
in Ledge.

The case that prompted this: a work assistant session that, at 08:00, 13:30 and 16:30 on weekdays, reads the owner's
mail and calendar (Outlook skill), Jira and TOPdesk, compares with what it noted last time, writes a briefing, and puts
each decision in « À toi ». The owner answers from the PC or the phone; the answer wakes the session, which acts and
updates its notes.

## 2. Goals and non-goals

Goals:

1. A **routine** is a schedule plus a prompt plus a target session. The daemon fires it at the set times.
2. The target is a **standing session**, known by its Ledge name and project folder: alive, the prompt is typed at its
   next free moment; gone, Ledge resumes it (or starts it fresh in its folder) and gives it the prompt.
3. The session keeps its **memory in files of its project** (a convention, written in the routine's prompt and the
   project's `CLAUDE.md`), so a relief or a fresh start loses nothing.
4. Each firing leaves a trace: in the daemon journal, and as a line in « le point », never as an « À toi » item by
   itself (only a failure or an activation request is).
5. Managed from the CLI (`ledge routine …`), so a session can set one up for the owner, and from a Routines screen on
   Desktop, the phone and the TUI.

Non-goals:

- Not a general cron. No sub-minute precision, no arbitrary shell commands: a routine only ever types a prompt into an
  agent session.
- No new permission model. The session runs under its tool's own permissions; what it may do unattended is the
  session's own settings and instructions. Ledge adds no bypass.
- No cloud execution. A routine fires only while the daemon runs (the PC is on); a missed slot fires on wake (§3.2).
- No special lifecycle for the target's context: relief stays as it is today (§5.1).

## 3. Design

### 3.1 The routine

Schema in `@ledge/protocol` first (`packages/protocol/src/routines.ts`, exported like the others), stored in
`~/.ledge/routines.json` through `jsonJournal`:

```ts
Routine {
  id: string            // "r" + 6 hex
  name: string          // "briefing", unique per target session name
  target: { name: string; cwd: string; tool: Tool; model?: string }   // the standing session
  schedule: Schedule    // §3.1.1
  expiresAfterRun?: true      // set for a one-shot routine: removed (kept in the journal) once fired
  prompt: string        // what is typed; placeholders {slot} {date} {last} (local time of the previous firing)
  catchUp: 'once' | 'skip'   // default 'once' (§3.2)
  state: 'enabled' | 'paused' | 'pending' | 'done'   // 'pending': created by a session, waiting for the owner (§3.4);
                                                     // 'done': a one-shot fired, kept for its history
  createdBy: { kind: 'user' } | { kind: 'session'; id: string; name: string }
  createdAt: string
  proposal?: { spec: RoutineSpec; by: { id: string; name: string }; at: string }   // a session's change, waiting for the owner (§3.4)
  runs?: RoutineRun[]   // the last 5 firings, newest first (owner's decision on the mockup, §5.8)
  lastRun?: RoutineRun  // runs[0]
  nextRun?: string      // computed by the daemon, sent to the fronts, never trusted from them
  nextRuns?: string[]   // the next 3 firings, computed by the daemon (§3.1.1)
}
RoutineRun { at: string; slot: string; slotAt?: string; outcome: 'delivered' | 'launched' | 'resumed' | 'failed'; reason?: string; late?: true }
```

`RoutineSpec` is what a routine does: `name`, `target`, `schedule`, `prompt`, `catchUp` (and `expiresAfterRun`). A front
previews the next 3 firings of a schedule not saved yet with `routine.preview` → `routine.previewed`, so the parity is
the daemon's alone.

#### 3.1.1 Schedule (added by the owner on 2026-11-23: weekly / every two weeks, and one-shot)

```ts
type Schedule =
  | { kind: 'recurring'; times: string[]; days: Weekday[];       // ["08:00","13:30","16:30"], ["mon",…,"fri"]
      every?: { weeks: 1 | 2; anchor: string };                  // default: every week. anchor = an ISO date in a week
      tz?: string }                                              //   that counts as « on » (e.g. a Sprint Review Friday)
  | { kind: 'once'; at: string[]; tz?: string }                  // ["2026-12-03T16:00"]: one or several exact moments
```

- **Recurring, every week** (the default): fires at each `time` on each listed `day`.
- **Recurring, every two weeks**: fires only in the weeks whose ISO week is `anchor`'s week plus an even number of weeks.
  The anchor is how the owner says « the sprint weeks »: `--every 2w --anchor 2026-11-27` (a Sprint Review Friday)
  makes Thursday 16:00 « veille de la review » land on the right Thursdays. The UI and `list` show the next 3 firings
  so the owner can check the parity at a glance. `weeks` is typed `1 | 2` for now; the schema allows widening later.
- **Once**: one or several exact local date-times. After its last moment has fired (delivered, resumed or launched),
  the routine is removed from the active list and kept in the journal: it stays in the list as `done` for 30 days
  (owner's decision, 2026-11-23; « Retirer de l'historique » removes it sooner), then leaves it, still on record; a failed one-shot stays, `failed`, until the
  owner relaunches or removes it. A one-shot whose moment is already past when it is created is refused.
  This is how a session prepares a meeting it found in the calendar (« prépa 121 la veille à 16:00 »): Ledge's daemon
  does not read the calendar, the standing session does, and creates one-shots for what it finds — each one `pending`
  until the owner's « Activer » (§3.4), or grouped into one « À toi » item when it creates several at once.

A schedule is a list of times and days, not a cron string: it covers the cases at hand, reads the same in the CLI and on
the screens, and has no syntax to get wrong. `tz` defaults to the machine's zone; times are local wall-clock times, so
a DST change keeps 08:00 at 08:00.

Wire messages (zod, in `messages.ts` / `phone.ts` as the existing pairs are):
`routine.list` → `routine.listed`, `routine.cmd` (`add | update | pause | resume | run | rm | approve | refuse`) →
`routine.result`, and a `routine.changed` broadcast so every front stays in sync. The phone gets the same commands,
with the device assertion already required for sensitive actions on `approve`.

### 3.2 Firing

One scheduler in the daemon (`packages/ledge/src/daemon/routines.ts`) keeps a single timer set to the next due slot of
any enabled routine, recomputed on every change. WSL suspends with Windows, so the timer is not trusted alone: on each
tick, and on a periodic check (every minute), the scheduler compares wall-clock time with the slot it was waiting for.

**Catch-up (owner's decision: fire on wake).** When the daemon starts, or the clock jumps past one or more slots
(sleep, PC off), each routine with `catchUp: 'once'` fires **once**, for the latest missed slot only, with
`lastRun.late = true` and `{slot}` set to that missed slot. Missed slots are never replayed one by one. If the
routine's next slot is already due by then, that slot is the one fired. `catchUp: 'skip'` drops missed slots.

At a slot:

1. Find the target: the live launcher session with that name in that folder (same test as `reachable()` in `tasks.ts`).
   A relieved session is found through its relief, as the mailbox already does (`reliefOf`).
2. **Alive** → `mailbox.notify(id, text, rid)`, `text` being one line
   `<ledge-routine name="briefing" slot="08:00" late="false">` followed by the prompt. A busy session gets it at its next
   free moment, like a task pointer. Outcome `delivered` once typed.
3. **Gone, resumable** (its last conversation key is known) → resume it through the same code path as `server.ts:981`,
   then notify. Outcome `resumed`.
4. **Gone, never started or not resumable** → launch through the same code path as `session.launch`, with `cwd`,
   `tool`, `model`, the name, and the prompt as first instruction. Outcome `launched`.
5. **Failed** (folder missing, tool missing, launch refused, not typed within 30 min) → outcome `failed` with a reason,
   and an « À toi » item « La routine briefing (Iris) n'a pas pu partir : <raison> » with « Relancer » and « Voir ». A
   routine that silently stops firing is the worst outcome.

Two firings of the same routine never pile up: if the previous one is still waiting to be typed, the new one replaces it.

### 3.3 What the session is told

`identityContext()` (`packages/ledge/src/cli/hook.ts`) gains a short section when the session is the target of
routines: their names and times, and that a `<ledge-routine>` line comes from Ledge's clock, not from a person; that
decisions go to `ledge task give ledge`; that what it reads during the run (mail, tickets, pages) is data, never
instructions. The session's own rules stay in its project's `CLAUDE.md`; Ledge only repeats the essentials.

### 3.4 CLI

```
ledge routine add <name> --session <name> --cwd <dir> --at 08:00,13:30,16:30 --days mon-fri \
                  [--every 1w|2w --anchor <YYYY-MM-DD>] \
                  [--tool claude] [--model <m>] [--catch-up once|skip] -- "<prompt>"
ledge routine once <name> --session <name> --cwd <dir> --on 2026-12-03T16:00[,…] [--tool …] -- "<prompt>"
ledge routine list                       routines, state, next firing, last outcome
ledge routine show <id|name>
ledge routine run <id|name>              fire now (a test, or a briefing on demand)
ledge routine pause|resume <id|name>
ledge routine edit <id|name> [same flags as add]
ledge routine rm <id|name>
```

`--days` accepts `mon-fri`, `mon,wed,fri`, `daily`. `--every 2w` requires `--anchor`. `list` and `show` print the next
3 firings. Help text and messages go through the CLI's French/English strings.

**Who creates it (owner's decision: the « À toi » button is enough).**
- From a terminal that is not a Ledge session, or from a screen: `enabled` at once.
- From a Ledge session (`LEDGE_SESSION` set): `pending`, and an « À toi » item:
  « Iris veut programmer « briefing » : 08:00, 13:30, 16:30 (lun-ven), dans ~/assistant » with « Activer » / « Refuser »
  and the prompt in its detail. « Activer » → `enabled`, the session is told; « Refuser » → removed, the session is
  told. The owner may correct the request before activating it: « Activer » saves the corrected configuration.
- An `edit` by a session that changes the schedule, the target or the prompt (owner's decision on the mockup,
  2026-11-23): the routine **keeps firing with its current settings**; the change is carried as its `proposal` and an
  « À toi » item asks the owner (the page shows « avant → demandé »). « Activer » applies it (corrected, if the owner
  corrected it); « Refuser » drops it and the routine stays as it was. The session is told either way.
- Several routines a session creates while its activation item is still unanswered join that one item (« Iris veut
  programmer 3 routines : … »): the item lists them; each is activated or refused, the item closes when none waits.
- A session may `pause`, `run` and `rm` its own routines without asking: none of these schedules new unattended work.

### 3.5 Traces

- Daemon journal (`journal.ts`): each firing, its slot, its outcome, its reason.
- « Le point » (`packages/ledge/src/operator/point.ts`): one grouped line per firing — under « En cours » while the
  session works on it (« Iris · briefing de 08:00 »), then « Terminé » when the session goes idle again. A late firing
  says so (« briefing de 08:00, lancé à 08:42 au réveil »). No « À toi » badge, except §3.2 failures and §3.4 requests.
- Chat context (`packages/ledge/src/chat/context.ts`): a `routines.md` file, so « qu'est-ce qui est programmé ? » and
  « est-ce que le briefing de ce matin est parti ? » have an answer.
- Brain: `@ledge` (the generated guide, `chat/guide.ts`) and `docs/ledge-guide.md` describe routines, the CLI and the
  screen, as every new screen requires.

### 3.6 Relief

Unchanged (owner's decision): when the target's context nears its limit, Ledge suggests « Passer le relais » as usual.
The scheduler follows the relief by name (step 1 of §3.2), so the next firing reaches the new session. The relief brief
should mention the routines the session holds; the new session rereads its memory files on its first routine prompt.

### 3.7 Screens (mockup first)

The `design-uxui` seat draws the mockup in `docs/mockups/ledge-routines.html` (and a `.tsx` beside it if the
Desktop observatory mockups are the reference); **the owner approves it before any UI code**. A state, a text or an
interaction the mockup does not show is asked for, not invented. What the screens must cover:

- **Desktop**: a « Routines » view. Where it lives (activity bar entry, Atelier section, or Réglages) is the
  designer's proposal for the owner. Content:
  - the list: name, session it wakes (with its mascot and state), times and days, next firing, last outcome (delivered /
    resumed / launched / failed, late);
  - per routine: « Lancer maintenant », « Pause » / « Reprendre », « Modifier », « Supprimer » (with confirmation),
    « Ouvrir la session »;
  - a create / edit form: name, session (existing session, or a new one: name, folder, tool, model), the kind
    (recurring or once), for recurring: times (several), days, frequency « chaque semaine » / « toutes les deux
    semaines » with its anchor week, for once: one or several date-times; catch-up, prompt with its placeholders. The
    form previews the next 3 firings, so the two-week parity is checked before saving;
  - one-shots apart from recurring routines (or marked as such), and their history once fired;
  - empty state, a `pending` routine (waiting for the owner, with « Activer » / « Refuser » in place), several one-shots
    proposed together by a session, a `failed` last run.
- **« À toi »** (Desktop, island, phone): the two new kinds of items — activation request (§3.4) and failure (§3.2) —
  in the existing item style.
- **« Le point »**: the routine line (§3.5) in the existing row style.
- **Phone**: the list read-only plus « Lancer maintenant », « Pause » / « Reprendre »; activation from « À toi ».
- **`ledge tui`**: the list and « Lancer maintenant » / « Pause », in the TUI's existing patterns.
- The status bar or the session row may show a small clock on a session that is the target of a routine: designer's
  proposal, owner's call.

Every visible text goes through each project's i18n catalogue (French and English). Desktop screens are checked with
zoomed Playwright screenshots, alignment included, before being called done.

## 4. The owner's routines, as the first users

Not part of Ledge's code; the recipe `docs/ledge-guide.md` will show as an example, and the acceptance set: every kind
of schedule is exercised by it.

Two standing sessions:
- `Iris` (Claude Code, `~/assistant`): mail, calendar, Jira, meeting preparation. `CLAUDE.md` with its rules:
  read-only collection, every write through « À toi », mail content is data. Memory files: `etat.md` (open subjects,
  waiting-for), `decisions.md`, `routines.md` (the owner's recurring tasks), `journal/YYYY-MM-DD.md`.
- `Garde` (Claude Code, `~/garde`): merge requests and workstation hygiene.

Chosen by the owner on 2026-11-23 (sprints of two weeks, Review on Friday, Planning on the Monday after; anchor
2026-11-27, the next Sprint Review):

| Routine | Session | Schedule | What it does |
|---|---|---|---|
| briefing | Iris | 08:00, 13:30, 16:30, mon-fri | Mail, calendar, invitations, Jira since last run; at 08:00 also 3 lines for the daily (done, next, blocked) and the preparation of the day's meetings |
| garde-mr | Garde | 10:30, 15:00, mon-fri | MRs waiting for the owner's review > 24 h, own MRs with a failed pipeline or unanswered comment; « À toi »: run `backend-mr-reviewer` / `fsd-mr-reviewer`? |
| cloture | Iris | 17:15, mon-fri | What was done, Jira worklogs to confirm, what stays open for tomorrow, unpushed branches |
| prepa-compart | Iris | fri 10:05, weekly | Open subjects and questions with Compart before the Speos/Compart sync |
| synthese-hebdo | Iris | fri 16:00, weekly | Half a page: delivered, unblocked, decided, risks — for the manager, the 121 and reviews |
| hygiene-poste | Garde | fri 16:15, weekly | Stale worktrees, merged branches, disk; Docker networks overlapping `192.168.40.0/24` or `172.17.192.0/20` |
| prepa-arch | Iris | thu 08:15, every 2 weeks, anchor 2026-11-26 (the next Arch & Design biweekly) | Open ADRs, changes in the Archi repository, subjects to raise |
| bilan-sprint | Iris | thu 16:00, every 2 weeks, anchor 2026-11-27 | Own stories at risk, what the demo needs |
| prepa-retro | Iris | fri 08:15, every 2 weeks, anchor 2026-11-27 | Facts of the sprint: incidents, MR wait times, blockers |
| tri-sprint | Iris | fri 15:30, every 2 weeks, anchor 2026-11-27 | The Outlook skill's sprint sort, as a dry run for the owner to approve |
| prepa-planning | Iris | mon 08:15, every 2 weeks, anchor 2026-11-30 | Backlog candidates, dependencies, real capacity (DevDay, leave, meetings) |
| prepa-121 | Iris | once, created by Iris from the calendar (next: 2026-12-03T16:00 for the 121 of 2026-12-04) | Achievements since the last 121 (from the weekly summaries), subjects to ask |

Example: `ledge routine add bilan-sprint --session Iris --cwd ~/assistant --at 16:00 --days thu --every 2w --anchor 2026-11-27 -- "…"`.

## 5. Owner's decisions (2026-11-23)

1. **Relief**: as usual — no special handling by the routine; the scheduler follows the relief by name.
2. **Missed slot**: fire on wake, once, for the latest missed slot (`catchUp: 'once'` is the default).
3. **Session-created routines**: allowed; created `pending`, activated by the owner's « Activer » / « Refuser » in « À toi ».
4. **Scope**: everything in one go — daemon, protocol, CLI, « le point », chat context, guide, and the screens
   (Desktop, phone, TUI) after the mockup is approved.
5. **Frequency**: a recurring routine runs every week or every two weeks, the latter anchored on a date (§3.1.1).
6. **One-shot routines**: supported, including several moments at once; a session creates them from the calendar,
   `pending` until the owner activates them (§3.1.1, §3.4).
7. **A session's edit** (on the mockup v2, 2026-11-23): the routine keeps firing with its current settings until the
   owner answers; « Activer » applies the change, « Refuser » drops it; the owner may correct a request before
   activating it (§3.4).
8. **History**: the routine's page shows its last 5 firings (slot, day, outcome, late, reason); the daemon keeps them
   and they survive a restart (§3.1).

## 6. Suggested lots for the rig

Independent enough to run in parallel once the protocol lot is merged into the feature branch:

1. **Protocol**: `routines.ts` schemas, wire messages, phone messages. Tests: schema round-trips.
2. **Daemon scheduler**: `daemon/routines.ts` — store, next-slot computation, drift and catch-up, firing (notify /
   resume / launch / fail), overlap, journal; wiring in `server.ts`. Tests below.
3. **CLI**: `ledge routine …`, the `pending` path for sessions, « À toi » items for activation and failure.
4. **Operator, chat, brain**: « le point » line, `routines.md` in the chat context, `identityContext()` section, guide
   (`docs/ledge-guide.md` + generated `@ledge`).
5. **Mockup** (`design-uxui`), then **owner's approval**, then **UI**: Desktop view, « À toi » items, phone, TUI.

## 7. Tests

- Scheduler: next slot over days, times, tz and a DST change; drift after a simulated suspend; catch-up `once` fires
  the latest missed slot only, `skip` fires none; daemon restart with a missed slot.
- Two-week parity: anchor in the past and in the future, anchor on another weekday than the slot, across a year
  boundary (ISO week 53), across a DST change; the next 3 firings match a hand-written list for the §4 routines.
- One-shot: fires at its moment then leaves the active list; several moments fire each once; a past moment is
  refused at creation; a missed one-shot fires on wake (catch-up `once`); a failed one stays until relaunched or removed.
- Firing: alive → notify; relieved → reaches the relief; gone and resumable → resume then notify; never started →
  launch; folder missing → `failed` + « À toi » item; a second firing replaces an undelivered one.
- CLI: add / list / show / run / pause / resume / edit / rm round trip; from a session → `pending` until « Activer »;
  « Refuser » removes it; a session's edit of times or prompt goes back to `pending`; a session's pause/run/rm do not.
- Journal: routines and `lastRun` survive a daemon restart.
- Fronts: `routine.changed` keeps Desktop, phone and TUI in sync; e2e on the Desktop view once the mockup is approved.
