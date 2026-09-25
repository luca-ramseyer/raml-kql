import { z } from 'zod';

import { QUERY_TEXT_MAX } from './models';
import { TimeRangeSchema } from './time-range';

/**
 * Query history (spec 05, "History"): one entry per run in `state/history.jsonl`. Query text,
 * target keys, group, time range, per-state counts, rows and duration. Never result data.
 */
export const HistoryEntrySchema = z.object({
  id: z.string().min(1).max(100),
  ts: z.iso.datetime(),
  query: z.string().max(QUERY_TEXT_MAX),
  targets: z.array(z.string().max(1000)).max(5000),
  /** Tenants of the targets (search by tenant). */
  tenantIds: z.array(z.string().max(100)).max(5000),
  groupId: z.string().max(100).optional(),
  timeRange: TimeRangeSchema.optional(),
  timespan: z.string().max(100).optional(),
  tabTitle: z.string().max(300).optional(),
  counts: z.object({
    succeeded: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    timeout: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  rows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistorySnapshotSchema = z.object({ entries: z.array(HistoryEntrySchema) });
export type HistorySnapshot = z.infer<typeof HistorySnapshotSchema>;
