import { ParameterSchema } from '@raml-kql/pack-schema/schemas';
import { z } from 'zod';

import { QUERY_TEXT_MAX } from './models';
import { TimeRangeSchema } from './time-range';

/**
 * Persisted tabs (spec 05, "Persistence"): `state/tabs.json` holds tabs, groups, cursor
 * positions, targets, time range and unsaved text. Result data is never saved (spec 04).
 */
const EditorKindSchema = z.enum(['welcome', 'settings', 'workspaces', 'query']);

export const PersistedQuerySchema = z.object({
  text: z.string().max(QUERY_TEXT_MAX),
  timeRange: TimeRangeSchema,
  cursor: z
    .object({ line: z.number().int().positive(), column: z.number().int().positive() })
    .optional(),
  targets: z.array(z.string().max(1000)).max(5000).optional(),
  targetGroupId: z.string().max(100).optional(),
  /** Linked My Queries file (path relative to `<config>/queries/`) and its saved text. */
  file: z
    .object({ path: z.string().max(1000), savedText: z.string().max(QUERY_TEXT_MAX) })
    .optional(),
  /** Parameter definitions and what was typed into the parameter bar. */
  parameters: z
    .object({
      definitions: z.array(ParameterSchema).max(50),
      inputs: z.record(z.string().max(100), z.string().max(100_000)),
    })
    .optional(),
});
export type PersistedQuery = z.infer<typeof PersistedQuerySchema>;

export const PersistedEditorSchema = z.object({
  id: z.string().min(1).max(200),
  kind: EditorKindSchema,
  title: z.string().max(300),
  pinned: z.boolean().optional(),
  description: z.string().max(1000).optional(),
  query: PersistedQuerySchema.optional(),
});

export const TabsStateSchema = z.object({
  version: z.literal(1),
  queryCounter: z.number().int().nonnegative(),
  activeGroupId: z.string().max(100),
  groups: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        size: z.number().positive().max(100),
        activeId: z.string().max(200).optional(),
        editors: z.array(PersistedEditorSchema).max(200),
      }),
    )
    .max(20),
});
export type TabsState = z.infer<typeof TabsStateSchema>;
