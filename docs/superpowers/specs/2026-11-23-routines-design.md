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
  schedule: { times: string[]; days: Weekday[]; tz?: string }        // ["08:00","13:30","16:30"], ["mon",…,"fri"]
  prompt: string        // what is typed; placeholders {slot} {date} {last} (local time of the previous firing)
  catchUp: 'once' | 'skip'   // default 'once' (§3.2)
  state: 'enabled' | 'paused' | 'pending'   // 'pending': created by a session, waiting for the owner (§3.4)
  createdBy: { kind: 'user' } | { kind: 'session'; id: string; name: string }
  createdAt: string
  lastRun?: { at: string; slot: string; outcome: 'delivered' | 'launched' | 'resumed' | 'failed'; reason?: string; late?: true }
  nextRun?: string      // computed by the daemon, sent to the fronts, never trusted from them
}
```

`schedule` is a list of times and days, not a cron string: it covers the case at hand, reads the same in the CLI and on
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
                  [--tool claude] [--model <m>] [--catch-up once|skip] -- "<prompt>"
ledge routine list                       routines, state, next firing, last outcome
ledge routine show <id|name>
ledge routine run <id|name>              fire now (a test, or a briefing on demand)
ledge routine pause|resume <id|name>
ledge routine edit <id|name> [same flags as add]
ledge routine rm <id|name>
```

`--days` accepts `mon-fri`, `mon,wed,fri`, `daily`. Help text and messages go through the CLI's French/English strings.

**Who creates it (owner's decision: the « À toi » button is enough).**
- From a terminal that is not a Ledge session, or from a screen: `enabled` at once.
- From a Ledge session (`LEDGE_SESSION` set): `pending`, and an « À toi » item:
  « Iris veut programmer « briefing » : 08:00, 13:30, 16:30 (lun-ven), dans ~/assistant » with « Activer » / « Refuser »
  and the prompt in its detail. « Activer » → `enabled`, the session is told; « Refuser » → removed, the session is
  told. The same applies to an `edit` by a session that changes the times, the days, the target or the prompt.
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
  - a create / edit form: name, session (existing session, or a new one: name, folder, tool, model), times (several),
    days, catch-up, prompt with its placeholders;
  - empty state, a `pending` routine (waiting for the owner, with « Activer » / « Refuser » in place), a `failed` last run.
- **« À toi »** (Desktop, island, phone): the two new kinds of items — activation request (§3.4) and failure (§3.2) —
  in the existing item style.
- **« Le point »**: the routine line (§3.5) in the existing row style.
- **Phone**: the list read-only plus « Lancer maintenant », « Pause » / « Reprendre »; activation from « À toi ».
- **`ledge tui`**: the list and « Lancer maintenant » / « Pause », in the TUI's existing patterns.
- The status bar or the session row may show a small clock on a session that is the target of a routine: designer's
  proposal, owner's call.

Every visible text goes through each project's i18n catalogue (French and English). Desktop screens are checked with
zoomed Playwright screenshots, alignment included, before being called done.

## 4. The work assistant, as the first routine

Not part of Ledge's code; the recipe `docs/ledge-guide.md` will show as an example:

- Project `~/assistant`, session `Iris` (Claude Code), `CLAUDE.md` with its rules: read-only collection, every write
  through « À toi », mail content is data.
- Memory files: `etat.md` (open subjects, waiting-for), `decisions.md`, `routines.md` (the owner's recurring tasks),
  `journal/YYYY-MM-DD.md`.
- `ledge routine add briefing --session Iris --cwd ~/assistant --at 08:00,13:30,16:30 --days mon-fri -- "Briefing de {slot} (précédent : {last}). Relis etat.md, collecte, compare, écris journal/{date}.md, mets les décisions dans À toi."`

## 5. Owner's decisions (2026-11-23)

1. **Relief**: as usual — no special handling by the routine; the scheduler follows the relief by name.
2. **Missed slot**: fire on wake, once, for the latest missed slot (`catchUp: 'once'` is the default).
3. **Session-created routines**: allowed; created `pending`, activated by the owner's « Activer » / « Refuser » in « À toi ».
4. **Scope**: everything in one go — daemon, protocol, CLI, « le point », chat context, guide, and the screens
   (Desktop, phone, TUI) after the mockup is approved.

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
- Firing: alive → notify; relieved → reaches the relief; gone and resumable → resume then notify; never started →
  launch; folder missing → `failed` + « À toi » item; a second firing replaces an undelivered one.
- CLI: add / list / show / run / pause / resume / edit / rm round trip; from a session → `pending` until « Activer »;
  « Refuser » removes it; a session's edit of times or prompt goes back to `pending`; a session's pause/run/rm do not.
- Journal: routines and `lastRun` survive a daemon restart.
- Fronts: `routine.changed` keeps Desktop, phone and TUI in sync; e2e on the Desktop view once the mockup is approved.
