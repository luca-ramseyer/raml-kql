import { z } from 'zod';

import { KeybindingEntrySchema } from '../keybindings/keybindings';
import { ColorThemeSchema } from '../theme/theme-schema';

/** A problem found in a config file, shown as "settings.jsonc has errors (line 12)". */
export const ConfigProblemSchema = z.object({
  /** File name relative to the config dir, e.g. `settings.jsonc` or `themes/my.json`. */
  file: z.string().max(500),
  /** 1-based line number, or 0 when the problem concerns the whole file. */
  line: z.number().int().min(0),
  message: z.string().max(1000),
});
export type ConfigProblem = z.infer<typeof ConfigProblemSchema>;

/** The user's valid settings (defaults are applied by the reader) plus any problems. */
export const SettingsSnapshotSchema = z.object({
  values: z.record(z.string(), z.json()),
  problems: z.array(ConfigProblemSchema),
});
export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;

export const KeybindingsSnapshotSchema = z.object({
  entries: z.array(KeybindingEntrySchema),
  problems: z.array(ConfigProblemSchema),
});
export type KeybindingsSnapshot = z.infer<typeof KeybindingsSnapshotSchema>;

export const UserThemesSnapshotSchema = z.object({
  themes: z.array(ColorThemeSchema),
  problems: z.array(ConfigProblemSchema),
});
export type UserThemesSnapshot = z.infer<typeof UserThemesSnapshotSchema>;
