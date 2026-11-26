# Ledge Desktop — the « Atelier » skin of the IDE

**Status:** mockup approved by the owner on 2026-11-26, to be developed; nothing is implemented in `apps/desktop`.
**Mockup:** `docs/mockups/ledge-ide-atelier.html` (sources in `docs/mockups/ide-atelier/`).
**Chosen from:** `docs/mockups/ledge-ide-visual-directions.html`, direction B, by the owner on 2026-11-26.

## 1. What this is

A new look for the Desktop IDE: every panel keeps its place, its content and its interactions
(`docs/mockups/ledge-ide-interactive.html` stays the structure's reference). The one layout change is inside the
projects' tree (section 5). Four things change:

1. **Colour.** Every surface is drawn from one colour, the main background, so a palette is one value per theme.
2. **One coral.** The primary button and the request's badge share Ledge's coral; the factory red no
   longer stands for « primary ».
3. **Panels as cards.** The explorer, each tab group, the bottom panel and the chat are rounded cards 6 px apart on a
   deeper « bench »; the title bar, the activity bar and the status bar sit on the bench itself.
4. **State you can read.** In the explorer a session that waits for the person says « À toi ».

The mockup is the real IDE (Desktop's components and stylesheets, on a daemon simulated in the page) with the skin laid
over it as one stylesheet, `docs/mockups/ide-atelier/atelier.css`. That file is the reference for every value below: it is
written against the app's real class names, so most of it ports as is.

## 2. How to read the mockup

Open `docs/mockups/ledge-ide-atelier.html` in a browser. The bar above the window is the mockup's, not the app's:

| Control | What it does |
|---|---|
| Aujourd'hui / Atelier | The skin off and on, on the same screen |
| Sombre / Clair | The theme |
| Palette chips | One of eight palettes; « Maquette B » is the hand-drawn mockup's exact colours, kept as the reference |
| Fond libre | Any colour for the main background; a light one switches to the light theme |

Rebuild it with `node docs/mockups/ide-atelier/build.mjs`; redo the captures with
`node docs/mockups/ide-atelier/shots.mjs <path to playwright-core>`. Captures: `docs/mockups/ledge-ide-atelier-*.png`
(before and after, every palette in both themes, five other views, six zooms per theme).

## 3. Colour

### 3.1 The ladder

From the main background `base` (its chroma capped at 0.04 in dark, 0.028 in light, so a vivid pick still gives a usable
screen), in OKLCH, lightness `l`:

| Role | Dark | Light | Feeds these tokens |
|---|---|---|---|
| pane | `l` | `l` | `--sidebar`, `--ide-pane` |
| side | `l − 0.018` | `l − 0.025` | the explorer, the chat, `--ide-strip` |
| well | `l − 0.04` | `l − 0.035` | `--well`, `--term-bg` |
| bench | `l − 0.068` | `l − 0.08` | the IDE's own background |
| card | `l + 0.04` | `min(1, l + 0.02)` | `--card`, `--popover`, the tab in front |
| raise | `l + 0.075` | `l − 0.055` | `--muted`, `--accent`, `--secondary`, `--sidebar-accent` |
| field | = well | = card | `--background` |
| ink | `l = 0.95` | `l = 0.24` | `--foreground` and its kin, `--term-fg` |
| ink 2 | `l = 0.69` | `l = 0.52` | `--muted-foreground`, `--ring` |
| line | ink at 9 % | ink at 11 % | `--border`, `--sidebar-border` |
| line 2 | ink at 17 % | ink at 20 % | `--input` |

Inks keep the base's hue with a trace of chroma. State colours (`--success`, `--warning`, `--info`, `--destructive`, the
link colours, the mascots' eyes) do not change.

### 3.2 Palettes

| Palette | Dark base | Light base | Coral, dark | Coral, light |
|---|---|---|---|---|
| Établi (default) | `#221f1b` | `#fbf7f1` | `#f27a63` | `#d6543d` |
| Sable | `#262119` | `#f7f0e1` | `#f08a52` | `#c2611f` |
| Sauge | `#1b211e` | `#f1f5f0` | `#f1836a` | `#c9553c` |
| Ardoise | `#1b2026` | `#f1f4f8` | `#f47f6a` | `#d5513c` |
| Nuit | `#161a26` | `#eef1f9` | `#f59a62` | `#c5651f` |
| Prune | `#221c25` | `#f7f1f6` | `#f0788f` | `#cc4767` |
| Encre | `#18181b` | `#f6f6f5` | `#f27a63` | `#d6543d` |

The coral is Ledge's; only its hue leans toward the background. Its ink is near black on the dark themes' coral, white on
the light themes'. « Maquette B » is not a palette to ship: it lists the hand-drawn mockup's surfaces one by one
(`atelier.css`, `[data-at-ref]`), to hold the derived ladder against.

### 3.3 Implementation note

The mockup derives the ladder in CSS (`oklch(from …)`), which needs Chromium 119 or later. Prefer computing it in
TypeScript next to `packages/ui/src/accent.ts` (`accentTokens`, `applyAccent`): the values are then unit-tested and no
WebView version is assumed. An accent the person chose in Settings › Appearance keeps winning over the palette's coral, as
its inline tokens do today.

## 4. Frame

| Part | Today | Atelier |
|---|---|---|
| Title bar | 34 px, a border under it | 38 px, on the bench, no border; the search field is a 26 px pill |
| Status bar | 24 px, a border over it | 30 px, on the bench; every item a 20 px pill, the waiting requests in coral |
| Activity bar | a border on its right, the active view on `--accent` | on the bench; the active view in coral on a 18 % coral tint, 10 px radius |
| Explorer, chat, bottom panel, each tab group | edge to edge, 1 px rules | 1 px `line` border, 12 px radius, 6 px apart |
| Tab strip | 30 px, square tabs with dividers | 36 px; tabs are 26 px tokens with an 8 px radius; the one in front on `card`; no line under any tab, neither the coral one of the tab in front nor a waiting session's (the owner, 2026-11-26: this replaces `ledge-ide-tab-front.html` under the skin) |
| Session bar (under a session) | 28 px on the strip's colour, a rule over it | 32 px, transparent, no rule |
| Bottom panel's tabs and tiles | 30 px, square | 34 px, the same tokens as the tab strip |
| Radii | 6 / 8 / 10 / 14 px | 8 / 10 / 12 / 16 px (`--radius-sm` … `--radius-xl`) |

dockview paints the pane's colour under all its groups; it must be made transparent or it fills the gaps and squares the
cards' corners. The gap between two groups is taken inside each group after the first (`padding` on `.dv-view`), dockview
laying them edge to edge.

## 5. Inside the panels

- **Explorer row of a session** (`apps/desktop/src/shell/sidebar/Tree.tsx`): the row keeps the provider's logo, with no
  mascot (the owner, 2026-11-26). A session that waits shows « À toi » (`side.yours`, already in both catalogues) as a
  pill in place of its time: coral for an authorisation, amber for a question. Sub-agent rows are unchanged. The session
  one is in (the tab in front of the focused group) stands out when its row is visible: a neutral raised row (`raise`)
  and its name in semi-bold. Never coral, which belongs to the pill of a session that wants the person.
- **The projects' tree, reworked so a session keeps its text.** Today a session's name starts 78 px into the 248 px
  panel and shares its line with the time, so names, branches and topics are cut. Under the skin: the tree is flatter
  (a project at 4 px, a branch at 12, a session at 28; a session's sub-agent chevron sits in the gutter instead of taking
  a slot); a branch's name takes its whole line (today it gets half of it); the time moves to the right of the session's
  second line, « À toi » staying on the first; and the view has one heading, the list's own line with its tools, not two.
- **Count bubbles:** one shape wherever a number is shown (the activity bar's badges, a project's tallies, a branch's
  count, the bottom panel's and the chat's tab counts, the sub-agents' count): 16 px high and at least as wide, a full
  pill, the figure centred in 10 px semi-bold tabular digits. A count of a state wears the state's colour on an 18 % tint
  of it, without the dot it had before; a plain count is neutral. The activity bar's badge is solid coral, ringed 2 px in
  the bench's colour.
- **Thread:** what the person wrote sits in a coral-tinted bubble (15 % coral on the pane, radius 5/16/16/16), left
  aligned as today. A run of consecutive actions is gathered in one soft block right of the rail (`well`, 12 px radius).
  A long duration widens the time column instead of running out of the thread.
- **Request waiting:** the card takes a 10 % coral tint and a 45 % coral border, no shadow.
- **Chat:** suggestions at 14 px radius, the field a 38 px pill, a round send button, the person's messages in the
  thread's bubble.
- **Small parts:** gauges are full pills; keys 6 px; tags, chips and icon buttons 7 to 10 px; buttons, fields and
  selects of the pages 8 px; segmented controls a 9 px frame with flush segments; page cards 12 px; menus and the
  limits' detail 14 px; dialogs 16 px. A key shown inside a coloured button takes the button's ink. Section 4 of
  `atelier.css` lists each one.

## 6. Out of scope

- The island, the phone app and `ledge tui`: they share `packages/ui/src/styles/tokens.css`, so the skin must be scoped to
  Desktop (the mockup scopes it with an attribute on the root).
- Any change of layout, content, text or interaction.
- The pixel-art Atelier tab's own drawing.

## 7. Decisions for the owner

1. **Default or option?** Atelier replaces today's look, or is a choice in Settings › Appearance.
2. **Palettes in Settings.** Where the choice lives (Settings › Appearance, beside the accent), whether all seven ship,
   and whether the free colour picker ships with them.
3. **A mascot in the request's card.** Direction B drew one; `PendingCard` does not receive the session today.
4. **No line under a tab.** With the coral line gone, nothing tells the focused group from the others: say whether that
   is wanted or whether another cue is needed.

## 8. The tour of every Desktop screen

The skin was laid over the whole Desktop e2e suite (357 tests, both themes): each test left a capture of its last screen
and an in-page audit. Four reviewers then looked at a sample of 161 captures covering every spec.

- **Colour:** no surface escapes the palette. The only backgrounds that do not follow the base colour are the coral and
  the state tints, as meant.
- **Shape:** what the audit and the reviewers found (page buttons, fields, selects, segmented controls, page cards, chips,
  keys inside coral buttons, the keyboard's ring on a tab, a notice's progress line, « Hors ligne » over a session's
  second line, a long duration in the thread, the MR et PR item of the status bar) is corrected in `atelier.css`.
- **Left as it is today, to look at during development:**
  - In the Atelier tab under about 1600 px, the zoom bar covers the legend. This is today's behaviour (the zoom bar is
    stacked above the legend on purpose), not the skin's.
  - The terminal's focus frame is a square rectangle inside a rounded card.
  - A disabled primary button's label is faint on its dimmed coral.
  - A notice sits across the bottom edge of the tab group's card.
  - xterm reads `--term-bg` when a terminal is created: with the ladder computed in TypeScript (section 3.3) it gets a
    plain colour; a terminal already open must be repainted when the palette changes.
- **Out of the tour:** the pixel-art floor of the Atelier tab, the island, the phone app.

## 9. Acceptance

- The IDE in both themes matches `ledge-ide-atelier-dark.png` and `ledge-ide-atelier-light.png`, and the four zooms per
  theme, checked with zoomed Playwright captures.
- No square corner shows behind a rounded panel, and nothing painted in the IDE has a radius under 6 px except the link
  swatches and the stop glyph (3 px).
- Changing the palette or the theme repaints every surface, the terminal included, with no reload.
- The island, the phone app and the TUI look as before.
- Specs that assert the old look are updated with the change. Under the skin these fail today, and only these:
  `ide-shell.spec.ts` (the grid's sizes), `ide-windows.spec.ts` (a detached window's bar, both themes),
  `ide-terminals.spec.ts` (the bottom panel and its zooms), `ide-session-tab.spec.ts` (the 28 px bar, the tab's 30 px, the
  surfaces' relation in both themes, the red line under a waiting tab), `ide-groups.spec.ts` (four 300 px groups in
  1280 px: the gaps take 18 px) and `session-view-toggle.spec.ts` (a bottom-panel shell's keys).
- A detached window (`body.ide-popout`) takes the same skin.

## 10. Issue text

> **Desktop IDE: the « Atelier » skin**
>
> Give the Desktop IDE the look approved in `docs/mockups/ledge-ide-atelier.html`: surfaces drawn from one background
> colour, one coral for the brand and for « c'est à toi », panels as rounded cards on a bench, and in the explorer
> « À toi » on a session that waits. Structure, content and interactions do not change.
>
> Spec: `docs/superpowers/specs/2026-11-26-ide-atelier-skin.md` (values, component edits, scope, acceptance).
> Reference stylesheet: `docs/mockups/ide-atelier/atelier.css`, written against the app's real classes.
>
> To settle before starting: section 7 of the spec (default or option, palettes in Settings, the focused group's cue).
