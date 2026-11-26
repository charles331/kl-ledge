# Preview tabs: a single click looks, a double click keeps

Date: 2026-11-26. Status: **awaiting the owner's approval**. Desktop only. The visible change (the preview tab's look)
starts with a mockup in `docs/mockups/` that **the owner** approves before any UI code.

## 1. Why

Every click in Ledge Desktop that opens something adds a tab that stays. Going through five agents to see where they
are leaves five tabs; within an hour there are 10 or 15. The owner wants the VS Code behaviour: a single click shows a
thing in a temporary tab that the next single click replaces; a double click keeps it.

## 2. Where we are

Checked on `main` at `b304be74` (0.63.0).

- Every tab is opened by `open(w, tab, where)` in `apps/desktop/src/workspace/model.ts:116`: an open tab is brought
  forward wherever it is, otherwise the tab is appended to the active group, or to a new group on the right
  (`Ctrl`+click, or the setting « Ouvrir une session »). No tab is temporary.
- The clicks reach it through `onTab` (`App.tsx:1093`) or the `open` nav action (`nav/state.ts:57`, `openClick`):
  the Projets tree, Rigs (`ide/rigs/RigsView.tsx:118`), À toi, MR et PR, Routines, the Atelier, the activity bar's
  Atelier and Réglages (`ide/ActivityBar.tsx:24`), the session bar's PR button, the status bar's waiting requests.
- The workspace is persisted as is (`workspace/store.ts`); `docs/ide-workspace.md` « Ouvrir » describes the rules.

## 3. Goals, non-goals, anti-goals

- **Goal:** looking through agents, PRs, routines or rigs leaves at most one temporary tab per group.
- **Goal:** what the owner has worked with stays open without thinking about it (owner's choice: option B).
- **Non-goal:** a setting to turn previews off; a limit on the number of tabs; closing old tabs automatically.
- **Anti-goal:** losing work. A tab with a draft being typed, an approval half-answered, or a terminal typed into must
  never vanish because of the next click.

## 4. Approaches

- **A. Double click only pins.** Simple, but answering an agent in a preview tab and then clicking elsewhere makes it
  disappear.
- **B. Double click, or acting in the tab, pins (chosen by the owner, 2026-11-26).** What VS Code does when a file is
  edited.
- **C. B, plus a tab left in front some time pins itself.** Rejected: it brings back part of the pile-up.

## 5. The design

### 5.1 The model (`workspace/model.ts`)

- A group holds **at most one preview tab**: `Group.preview?: string`, the key of that tab. Optional, so a saved
  workspace reads back unchanged.
- `open(w, tab, where, { preview: true })`:
  - the tab is already open anywhere: brought forward, as today; its state (preview or kept) does not change;
  - otherwise, in the target group: if it has a preview tab, the new tab **takes its place** (same position) and becomes
    the preview; else it is appended and becomes the preview.
- `open` without `preview` opens a kept tab, as today. Opening kept a tab that is the preview keeps it.
- `pin(w, key)`: the tab stops being a preview. No-op when it is not one.
- Moving a tab (`move`, `moveTo`, to another group or window, a split) keeps it. Closing the preview clears the field.
  `Ctrl+Shift+T` reopens a tab kept. When a linked group's Changes or Terminal tab follows another session
  (`follow`), a preview stays a preview under its new key.

### 5.2 What opens a preview

A single click (or `Enter` on a focused line) in: the Projets tree, Archives, Rigs (rigs, kernel, seats, the OpenRig
daemon line), À toi (its « Page »), MR et PR, Routines, the Atelier's agents, the activity bar's Atelier and Réglages,
the status bar's next waiting request, the island and notifications.

`Ctrl`+click opens the preview in the group on the right (that group's preview, if any, is replaced).

### 5.3 What opens a kept tab

A double click on any line of §5.2; the context menu's « Ouvrir » and « Ouvrir à droite »; a session just launched;
« Nouvelle routine »; the search palette (`Ctrl+K`); `Ctrl+Shift+T`; a disposition applied; the workspace read back.

### 5.4 What pins a preview (acting in it)

- a double click on its tab;
- in a session or seat: the first keystroke in the composer (so a draft is never lost), sending a message, answering
  a request (approval, question, plan), a keystroke in its terminal view;
- a terminal tab: a keystroke;
- a routine: any edit of its form, run, pause, delete;
- a PR: any action (comment, approve, merge, open in the forge);
- a rig or OpenRig page: any management action (start, stop, restart a seat, send a message);
- Réglages: any setting changed;
- a click inside it that opens another tab (an agent in the Atelier, a seat in a rig's topology, the session bar's PR
  or `+N −N`): the source tab is kept, the new one opens as a preview;
- dragging it, moving it, splitting with it.

Not pinning: scrolling, selecting text, switching thread ⇄ terminal view, focusing, hovering.

### 5.5 The look

The preview tab's title is in italic, as in VS Code. Anything else (a tooltip, a hint) is the mockup's proposal, decided
by the owner, not invented in code. The mockup shows: a group with kept tabs and one preview tab, in light and dark,
and the same group after a double click.

### 5.6 Documentation

`docs/ide-workspace.md` (« Ouvrir », « Onglets et groupes ») and `docs/ledge-guide.md` describe single click = preview,
double click = kept, and what pins.

## 6. Calls made without the owner (to check)

- One preview per group, not one per window (VS Code's rule; each split shows its own).
- The first keystroke in the composer pins, not only sending.
- The search palette and the context menu open kept tabs (deliberate gestures).
- Switching thread ⇄ terminal does not pin.
- No setting to turn previews off.

## 7. Tests

- `workspace/model` (vitest): replacement in place, one preview per group, already-open tab untouched, `pin`, move and
  split keep, close clears, `follow` keeps the preview under the new key, a saved workspace without `preview` reads back.
- e2e (Playwright, `apps/desktop/e2e`): click three agents → one tab; double click → kept, next click adds a preview
  beside it; typing in the composer of a preview then clicking another agent → both tabs remain; zoomed screenshots of
  the italic title.
- `cargo test` and `tauri build` are not touched (no Rust change).
