# Preview tabs (Desktop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single click that opens something shows it in its group's preview tab, which the next single click replaces
in place; a double click or an action in the tab keeps it (VS Code's behaviour, option B of the spec).

**Architecture:** The rule lives in the pure workspace model (`apps/desktop/src/workspace/model.ts`): a group carries
the key of its preview tab, and `open(…, { preview: true })`, `pin` and every move/close keep it consistent. The views
only say *how* a thing was asked for: a single click asks for a preview, a double click or a deliberate gesture asks
for a kept tab, and an action in a tab pins it through the workspace store. The look (an italic title) is drawn by the
tab label once the owner has approved the mockup.

**Tech Stack:** TypeScript, React 18, dockview, vitest + Testing Library, Playwright (`apps/desktop/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-26-preview-tabs-design.md` (approved by the owner on 2026-11-26).
**Mockup:** by design-ux (§5.5). It must be approved by the owner before Task 5, and before any visible code.

## Global Constraints

- No visible change before the owner has approved the mockup. A state, a text or an interaction the mockup does not
  show is asked of design-ux, not invented.
- A preview never holds work: every gesture in §5.4 pins before its effect, so the next click cannot drop a draft, a
  half-answered request or a typed terminal.
- Comments are prose. Visible texts (a tooltip, if the mockup has one) go through the i18n catalogue, in French and in
  English.
- Tests run on Node 24:
  - `npx vitest run <file>` from `apps/desktop`;
  - `pnpm --filter desktop typecheck`;
  - e2e with `npx playwright test <spec>` from `apps/desktop`.

## Task 1: The model (`workspace/model.ts`, spec §5.1, §7) — done first, nothing visible

**Files:**
- Modify: `apps/desktop/src/workspace/model.ts`
- Create: `apps/desktop/test/workspace/preview.test.ts`

**The model:**
- [x] `Group.preview?: string`: the key of the group's preview tab. It is optional, so a workspace saved before
  previews reads back unchanged. A group that has none does not carry the field at all.
- [x] `open(w, tab, where, { preview: true })`:
  - a tab already open anywhere is only brought forward, and its state does not change;
  - otherwise the new tab takes the place of the target group's preview, at the same position, or it is appended;
  - in both cases it becomes the preview.
- [x] « À droite » with a preview: the tab goes to the group right of the focused one, replacing that group's preview.
  A new group is made only when there is no group on the right. A kept tab « à droite » still makes a new group, as
  before.
- [x] `open` kept of a tab that is the preview keeps it. This is the double click on a line.
- [x] `pin(w, key)` and `isPreview(w, key)`.
- [x] The following keep a preview, because the tab is moved:
  - `move` and `moveTo`, to another group, a new group or a new window;
  - a reorder within the group;
  - `place` and `moveActive`;
  - `split` from it (Ctrl+\).
- [x] `close`, `closeOthers` and `reconcile` clear the preview when the preview tab goes.
- [x] `reopenLast` and `closeWindow` bring tabs back kept.
- [x] `follow`: a linked Changes or Terminal preview switched to another session stays the preview, under its new key.
- [x] `deserialize` reads every tab back kept: a restart or a disposition applied (§5.3).

**Tests:** `test/workspace/preview.test.ts` covers each point above, as listed in §7. The existing `model`, `store` and
`dispositions` tests stay green.

## Task 2: Asking for a preview — the click intent (done)

**As built:** the plan first thought of a `preview` flag on every nav action and callback. That would have threaded
the click event through about fifteen components. Instead, the places whose lines open previews note each click in
the capture phase, before any handler runs, and every open in `App.tsx` asks how the click wanted it.

**Files:**
- `apps/desktop/src/workspace/intent.ts`:
  - `noteClick`: a single click or `Enter` (detail 0 or 1) asks for a preview, the second click of a double click
    for a kept tab;
  - the note lasts for the event only (cleared by a 0 ms timer);
  - `openAs`, `asPreview`, `typing`, `acts`.
- `workspace/route.ts`: `open`, `home`, `settings` and `openrig` go through `openAs` with `ctx.how`.
- `App.tsx`:
  - `dispatch` passes `how: clickIntent()`;
  - `onTab` and `openRoutineRef` use `openAs`;
  - the island's « Voir » runs under `asPreview`.

- [x] With no click noted, the tab opens kept, as before:
  - the context menu (`role="menu"`, `menuitem`);
  - the palette and the dialogs (outside the noted places);
  - a launch;
  - a shortcut;
  - code;
  - a promise that resolves later.
- [x] « Nouvelle routine » is marked `data-keep`.
- [x] **Tests:** `test/workspace/intent.test.ts`.

## Task 3: Which clicks ask for a preview (§5.2, §5.3) (done)

`onClickCapture={e => noteClick(e.nativeEvent)}` is set on four places:
- the activity bar (`ide/ActivityBar.tsx`);
- the explorer (`ide/IdeExplorer.tsx`), which covers Projets, Archives, Rigs, À toi and its « Page », MR et PR, and
  Routines;
- the status bar row (`ide/IdeFrame.tsx`);
- each tab's content (`ide/DockHost.tsx` `Pane`), with that tab's key as `from`.

The island goes through `asPreview` in `App.tsx`. Windows notifications have no click action in Desktop
(`sendNotification`), so there is nothing to wire for them.

- [x] **Tests:**
  - `test/ide/frame.test.tsx` « preview tabs »;
  - the context menu « Ouvrir » opens a kept tab.

## Task 4: What pins (§5.4) (done)

- [x] **A double click on the tab:** a `dblclick` listener on dockview's `.dv-tab` (`PanelTab`).
- [x] **Typing:** `Pane` `onKeyDownCapture` with `typing()`, and `onPasteCapture`. This covers:
  - the composer's first keystroke;
  - a form;
  - a terminal's input (the xterm helper textarea).
- [x] **Answering, sending:** `App.tsx` wraps `decisions` (`decide`, `reply`, `answer`) to pin the session's or the
  seat's tab, wherever the gesture comes from: the tab's buttons, `Y`/`N`, « À toi ».
- [x] **A PR, a rig, OpenRig, a routine, Réglages (`ACTING_KINDS`):**
  - any control pressed pins (`acts()`), except what only looks:
    - `nav` (Réglages' sections);
    - `[role=tab]` (a PR's views);
    - `[role=option]`;
    - `[aria-expanded]`;
    - `[data-look]`;
    - links;
  - `onChangeCapture` pins too.
- [x] **A click inside a tab that opens another one:**
  - `openAs` pins `from`, and the new tab is the preview;
  - `beside(…, { preview })` covers the session bar's `+N −N`.
- [x] **Dragging, moving, splitting:** the model (Task 1).
- [x] **Not pinning:**
  - scrolling;
  - selecting text;
  - switching thread ⇄ terminal;
  - focusing;
  - hovering.
- [x] **Tests:**
  - `test/ide/frame.test.tsx`: the double click on the tab, typing in the composer, `Y`, the Réglages switch versus
    its section, a click in the Atelier;
  - `test/workspace/intent.test.ts`;
  - `test/workspace/preview.test.ts` (`beside`).

## Task 5: The look — only after the owner approved the mockup

**Files (as built):**
- `ide/DockHost.tsx`: the `preview` class on `.ide-tab`.
- `styles/ide.css`: `.ide-tab.preview .tab-name`.
- `App.tsx`: every label's title in `.tab-name`. The Atelier, Réglages, a rig and a shell had their title bare; their
  title now ellipsises at 220 px, as a session's does.
- No i18n: option 1 has no text.

- [x] The preview tab's title in italic, exactly as the approved mockup draws it, in light and dark.
  - **Watch out:** a plain `font-style: italic` renders **upright** in Desktop. This was raised by design-ux and relayed
    by pilot-lead on 2026-11-26.
    - `apps/desktop/src/styles/app.css:18` sets `font-synthesis: none` on `:root`.
    - Geist is loaded without an italic: `index.html` asks for `wght@400;500;600;700` only.
    - `.notice-summary` and `.action-dropped` already render upright for this reason.
  - The mockup sets `font-style: italic; font-synthesis-style: auto;` on the preview title. Use that, or load the
    real Geist italic.
  - The e2e captures (Task 6) must show the slant.
- [x] Anything else (a tooltip, a hint) only if the mockup shows it.

## Task 6: e2e and captures (§7)

**File:** `apps/desktop/e2e/preview-tabs.spec.ts`

- [x] Click three agents: one tab.
- [x] Double click: the tab is kept, and the next click adds a preview beside it.
- [x] Type in the composer of a preview, then click another agent: both tabs remain.
- [x] Zoomed captures of the italic title, light and dark, compared with the mockup.
- [x] The title must actually slant in these captures, not render upright (see Task 5).

## Task 7: Documentation (§5.6)

Update `docs/ide-workspace.md` (« Ouvrir », « Onglets et groupes ») and `docs/ledge-guide.md`:
- a single click opens a preview;
- a double click keeps it;
- what pins.

`test/ledge-guide.test.ts` stays green.

## Review Focus

1. **No lost work.** A preview with a draft, a half-answered request or a typed terminal must never be replaced.
   - A replaced preview does not go through the store's `close`. So it is not remembered for `Ctrl+Shift+T`, and it
     does not trigger the `closed` hook that kills a bottom-panel shell.
   - Terminal tabs never open as previews (§5.2), and a routine is pinned by its first edit. So the `guard` against
     unsaved changes is never bypassed.
2. **Consistency of `Group.preview`.** It always names a tab of its own group, or it is absent. This holds after every
   model function, after `follow`, and after a workspace is read back.
3. **No change for kept tabs.** Every existing `open` call without `preview` behaves exactly as before.
4. **The click intent is module state** (`workspace/intent.ts`). It is set in the capture phase and cleared by a 0 ms
   timer. An open that runs synchronously in the click's handlers sees it; any later open is kept. Check that no place
   outside the noted regions opens a preview, and that no click in them opens a preview that should be kept.

## Readings of the spec, confirmed by pilot-lead on 2026-11-26

- `Ctrl`+click opens the preview in the **existing** group on the right, replacing its preview (§5.2's « that group's
  preview »). A new group is made only when there is none. « Ouvrir à droite » from the menu still makes a new group.
- `Ctrl+\` (split) pins the front tab of the group it splits (« splitting with it », §5.4).
- « Fermer les autres » on the preview leaves it a preview.
