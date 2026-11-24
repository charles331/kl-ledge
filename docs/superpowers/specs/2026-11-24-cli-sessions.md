# Managing the sessions from the CLI

## The problem

The owner talks to one session, the « chef » (a Claude Code session in a `chef` project), which hands their requests to the
other sessions. It should also tidy them up: archive what is done, resume, rename, file in a project. All of that existed
only in Desktop's « Gérer la session ».

- `ledge status` printed about 30 rows with duplicate names (several Otto, several Max) and no id.
- `ledge who` and `ledge status` printed text only.
- A session could only close itself: `runGuard` (#93, option 4 of 2026-10-26) refused it every other action.

## What changes

### Listing (`packages/ledge/src/cli/sessions.ts`, `who.ts`)

`ledge status [--all] [--json]` lists every session, the most recently active first. The columns are:

| ID | NOM | OUTIL | ÉTAT | PROJET | ACTIVITÉ | SUJET |
|---|---|---|---|---|---|---|

- `ÉTAT` adds « archivée » and « lecture seule » when they apply.
- `PROJET` is the daemon's project name.
- `ACTIVITÉ` is how long ago, for example `3 min`.
- Archived sessions are listed only with `--all`.

`ledge who [--json]` keeps its text output.

With `--json`, both commands give one row per session:

```
{ id, name, tool, state, projectId, project, repo, cwd, branch, topic, archived, readOnly, startedAt, lastActivityAt }
```

### Acting

Every command goes through `action.run`. The daemon resolves a session by id or name and applies its own rules, as for
the chat's cards.

| Command | Action | Applies |
|---|---|---|
| `ledge archive <session>… [--close]` | `session.archive` (with `--close`: `session.close` first) | `session.archive` |
| `ledge unarchive <session>…` | `session.restore` | `session.restore` |
| `ledge resume <session>…` | `session.resume` | `session.resume` |
| `ledge rename <session> "<sujet>"` | `session.topic` (new) | `session.rename`: the topic, as Desktop's « Renommer… »; the agent's name, its address, does not change |
| `ledge move <session> <projet>` | `session.move` (new) | `projects.set` with the folder → project rule, as « Ranger dans… » |
| `ledge delete <session>… --yes` | `session.delete` (new, destructive) | `session.delete` |

Every command takes `--json`: one JSON line per step. A run stops at the first failure.

- **The CLI's own actions** (`session.topic`, `session.move`, `session.delete`) carry `chat: false` in the registry. The
  chat's persona and guide use `CHAT_ACTIONS`, and `parseActionBlock` refuses them. The chat therefore never proposes
  deleting a session (spec 2026-10-26 §6.2) nor filing one.
- **Who may run what** (`runGuard`, the owner's decision of 2026-11-24): the user runs anything. A session runs on any
  session what can be undone: close, archive, restore, resume, rename, move. Deleting and every other action stay the
  user's.

## Not in scope

These are follow-ups:

- `ledge project add|edit|rm`.
- A detached launch: `ledge claude --project <p> --dir <d> --name <n> --detach "<message>"`.

## Checks

- `test/cli-sessions.test.ts`:
  - `status` formatting and order, `--all`;
  - the JSON row;
  - argument parsing;
  - against a daemon, a session closing, archiving, restoring and renaming another;
  - delete refused to a session, asked again without `--yes`, done for the user;
  - a JSON failure.
- `test/action-run.test.ts`:
  - the new guard;
  - `session.topic`;
  - `session.move`: by id or name, the rule written, unknown or unchanged refused;
  - `session.delete` confirmed.
- `packages/protocol/test/actions.test.ts`: the CLI's own actions are kept out of the chat.
