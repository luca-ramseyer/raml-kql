import { z } from 'zod';

import { ResultColumnSchema } from '../query/models';

import { DisplayNamesSchema } from './display-names';
import { ViewStateSchema } from './view';

/** Export requests (spec 06, "Export"). */
export const ExportFormatSchema = z.enum(['csv', 'json', 'jsonl', 'xlsx', 'markdown', 'datatable']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  jsonl: 'JSON Lines',
  xlsx: 'Excel Workbook (XLSX)',
  markdown: 'Markdown Table',
  datatable: 'KQL datatable',
};

/** Rows sent inline (grouped views) are capped; tables are exported from the result store. */
export const INLINE_EXPORT_ROWS = 100_000;

export const ExportSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('table'),
    runId: z.string().min(1).max(100),
    tableIndex: z.number().int().nonnegative().max(1000),
    view: ViewStateSchema,
    scope: z.enum(['all', 'filtered', 'selected']),
    /** Row positions for scope `selected`. */
    positions: z.array(z.number().int().nonnegative()).max(1_000_000).optional(),
    /** Column indexes to include (visible columns); all when omitted. */
    columns: z.array(z.number().int().nonnegative()).max(1000).optional(),
  }),
  z.object({
    kind: z.literal('rows'),
    name: z.string().max(100),
    columns: z.array(ResultColumnSchema).max(1000),
    rows: z.array(z.array(z.json())).max(INLINE_EXPORT_ROWS),
  }),
]);

export const ExportRequestSchema = z
  .object({
    source: ExportSourceSchema,
    format: ExportFormatSchema,
    destination: z.enum(['file', 'clipboard']),
    /** Aliases to write instead of real names (spec 03 `applyToExports`). */
    display: DisplayNamesSchema.optional(),
  })
  .strict();
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export const ExportResultSchema = z.object({
  status: z.enum(['saved', 'copied', 'cancelled']),
  rows: z.number().int().nonnegative(),
  path: z.string().optional(),
  notice: z.string().optional(),
});
export type ExportResult = z.infer<typeof ExportResultSchema>;
