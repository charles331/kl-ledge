import { z } from 'zod';

/** A size of the island or of its windows, as both fronts offer it (`@ledge/ui/scale`'s UI_SCALES). */
export const IslandScaleSchema = z.union([z.literal('auto'), z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]);

/** The island's settings, set in Ledge Desktop › Settings › Island and applied by the island (atelier spec §7, sober island §4). */
export const IslandPrefsSchema = z.object({
  /** Shown at the top of the screen; hidden, Desktop still notifies. */
  visible: z.boolean(),
  /** `primary` (whichever it is after a reconfiguration), or a monitor's id as the shell lists it (`list_monitors`: the OS
   *  name, `#index` without one). `second`, written by older fronts, is the first monitor that is not the primary. */
  screen: z.string().trim().min(1).max(200),
  position: z.enum(['center', 'left', 'right']),
  /** Retired with the floating island (#27): it was a strip under a maximised window. Optional and never read, so a file or
   *  a front that still carries it parses; still written by DEFAULT_ISLAND_PREFS because a daemon before #27 requires it in
   *  `island.set`. */
  discreet: z.boolean().optional(),
  islandScale: IslandScaleSchema,
  /** Retired with the floating island (#27): the island's size sizes its cards too. Optional and never read; still written by
   *  DEFAULT_ISLAND_PREFS for daemons before #27, which require it. */
  panelScale: IslandScaleSchema.optional(),
  /** What the island shows besides asks and questions, which it always shows. */
  shows: z.object({
    /** Allow, deny or answer in a line from the island; off, its cards only say « Open in Ledge ». */
    quick: z.boolean(),
    /** The 6 s « Done » card when an agent finishes its turn. */
    finished: z.boolean(),
    /** Retired with the floating island (#27), like `helpers`: optional and never read, still written by default for older daemons. */
    say: z.boolean().optional(),
    helpers: z.boolean().optional()
  }),
  /** The global shortcut that reopens the oldest waiting request, as shown (`Ctrl Alt L`). */
  shortcut: z.string().trim().min(1).max(40)
});
export type IslandPrefs = z.infer<typeof IslandPrefsSchema>;

export const DEFAULT_ISLAND_PREFS: IslandPrefs = {
  visible: true, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto',
  shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L'
};
