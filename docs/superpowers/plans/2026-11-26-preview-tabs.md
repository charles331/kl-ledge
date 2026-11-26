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

## Task 2: Asking for a preview (routing; nothing visible yet)

**Files:**
- Modify: `apps/desktop/src/nav/state.ts`
- Modify: `apps/desktop/src/workspace/route.ts`
- Modify: `apps/desktop/src/App.tsx` (`onTab`, `openRoutineRef`)
- Test: `test/workspace/route.test.ts`, `test/nav-state.test.ts`

- [ ] The `open` nav action gets `preview?: boolean`.
- [ ] `openClick(id, e)` sets it.
- [ ] A new `keepClick(id, e)` (a double click) does not set it.
- [ ] `route.ts` passes it on to `open`:
  - for `open`, `home` (the Atelier), `settings` and `openrig` when the action asks for it;
  - the other callers keep their kept tab.
- [ ] `onTab(tab, where, how)` and `openRoutineRef` get a `preview` flag, to the same effect.
- [ ] A test checks that a single-click action opens a preview and a double-click action opens a kept tab.

## Task 3: Which clicks ask for a preview (§5.2, §5.3)

Each line in §5.2 dispatches with `preview` on `onClick` (and `Enter`), and keeps on `onDoubleClick`. The first click of
a double click opens the preview; the second keeps it (`open` kept of the preview). The places:

- the Projets tree and the Archives (`ide/IdeExplorer.tsx`);
- Rigs (`ide/rigs/RigsView.tsx`, `ide/rig/RigTopology.tsx`, `ide/rig/RigView.tsx`);
- the OpenRig page (`ide/openrig/sections/Overview.tsx`);
- À toi (`ide/atoi/`);
- MR et PR (`forge/PrsView.tsx`);
- Routines;
- the Atelier (`atelier/ProjectTable.tsx`, `atelier/ProjectRoom.tsx`, `atelier/Unassigned.tsx`);
- the activity bar's Atelier and Réglages (`ide/ActivityBar.tsx`);
- the status bar's next waiting request (`ide/IdeStatusBar.tsx`);
- the island and the notifications.

What stays kept:
- the context menu's « Ouvrir » and « Ouvrir à droite »;
- a session just launched;
- « Nouvelle routine »;
- the palette (`Ctrl+K`);
- `Ctrl+Shift+T`;
- a disposition.

**Tests:**
- One component test per family: a click asks for a preview, a double click asks for a kept tab.
- The context menu and the palette still open kept tabs.

## Task 4: What pins (§5.4)

`wsStore.update(w => pin(w, key))`, wired in one place per gesture, before the gesture's effect:

- **A double click on the tab** (`ide/DockHost.tsx` tab header).
- **A session or a seat** (`session/Reply.tsx` and the request cards):
  - the composer's first keystroke;
  - sending a message;
  - answering an approval, a question or a plan;
  - a keystroke in its terminal view.
- **A terminal tab:** a keystroke.
- **A routine:** an edit of its form, run, pause or delete.
- **A PR:** comment, approve, merge, open in the forge.
- **A rig or the OpenRig page:** start, stop, restart a seat, send a message.
- **Réglages:** a setting changed.
- **A click inside a tab that opens another one:** an agent in the Atelier, a seat in a rig's topology, the session
  bar's PR or `+N −N`. The source tab is pinned, and the new one opens as a preview. For `+N −N`, `beside` gets the
  same `preview` option as `open`.
- **Dragging a tab:** already kept by the model (Task 1).

These do not pin:
- scrolling;
- selecting text;
- switching thread ⇄ terminal;
- focusing;
- hovering.

**Tests:**
- One component test per gesture: the tab is kept after it.
- A preview with a draft is never replaced. The first keystroke pins it, and the next click adds a tab beside it.

## Task 5: The look — only after the owner approved the mockup

**Files:**
- `ide/SessionTabLabel.tsx`, `ide/tabs.tsx` (the tab title)
- the tab CSS
- i18n if the mockup has a text

- [ ] The preview tab's title in italic, exactly as the approved mockup draws it, in light and dark.
  - **Watch out:** a plain `font-style: italic` renders **upright** in Desktop. This was raised by design-ux and relayed
    by pilot-lead on 2026-11-26.
    - `apps/desktop/src/styles/app.css:18` sets `font-synthesis: none` on `:root`.
    - Geist is loaded without an italic: `index.html` asks for `wght@400;500;600;700` only.
    - `.notice-summary` and `.action-dropped` already render upright for this reason.
  - The mockup sets `font-style: italic; font-synthesis-style: auto;` on the preview title. Use that, or load the
    real Geist italic.
  - The e2e captures (Task 6) must show the slant.
- [ ] Anything else (a tooltip, a hint) only if the mockup shows it.

## Task 6: e2e and captures (§7)

**File:** `apps/desktop/e2e/preview-tabs.spec.ts`

- [ ] Click three agents: one tab.
- [ ] Double click: the tab is kept, and the next click adds a preview beside it.
- [ ] Type in the composer of a preview, then click another agent: both tabs remain.
- [ ] Zoomed captures of the italic title, light and dark, compared with the mockup.
- [ ] The title must actually slant in these captures, not render upright (see Task 5).

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

## Readings of the spec, confirmed by pilot-lead on 2026-11-26

- `Ctrl`+click opens the preview in the **existing** group on the right, replacing its preview (§5.2's « that group's
  preview »). A new group is made only when there is none. « Ouvrir à droite » from the menu still makes a new group.
- `Ctrl+\` (split) pins the front tab of the group it splits (« splitting with it », §5.4).
- « Fermer les autres » on the preview leaves it a preview.
