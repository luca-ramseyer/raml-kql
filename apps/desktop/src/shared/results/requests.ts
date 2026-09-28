import { z } from 'zod';

import { ResultColumnSchema } from '../query/models';

import { GroupSpecSchema } from './aggregate';
import { DisplayNamesSchema } from './display-names';
import { ViewRequestSchema, ViewStateSchema } from './view';

/** IPC requests over stored results (spec 06). */

const TableRef = {
  runId: z.string().min(1).max(100),
  tableIndex: z.number().int().nonnegative().max(1000),
  view: ViewStateSchema,
  display: DisplayNamesSchema.optional(),
};

export const ViewPageRequestSchema = ViewRequestSchema.extend({
  display: DisplayNamesSchema.optional(),
});
export type ViewPageRequest = z.input<typeof ViewPageRequestSchema>;

export const AggregateRequestSchema = z.object({ ...TableRef, spec: GroupSpecSchema }).strict();
export type AggregateRequest = z.input<typeof AggregateRequestSchema>;

export const GroupResultSchema = z.object({
  columns: z.array(ResultColumnSchema),
  rows: z.array(z.array(z.json())),
  truncated: z.boolean(),
});

/** Charts get at most this many rows (larger line charts are downsampled with LTTB). */
export const CHART_ROW_LIMIT = 200_000;

export const ChartDataRequestSchema = z
  .object({
    ...TableRef,
    columns: z.array(z.number().int().nonnegative()).min(1).max(50),
  })
  .strict();
export type ChartDataRequest = z.input<typeof ChartDataRequestSchema>;

export const ChartDataSchema = z.object({
  columns: z.array(ResultColumnSchema),
  rows: z.array(z.array(z.json())),
  /** More rows than CHART_ROW_LIMIT: the chart shows the first ones. */
  truncated: z.boolean(),
});
export type ChartData = z.infer<typeof ChartDataSchema>;

export const PortalQueryRequestSchema = z
  .object({
    tenantId: z.string().regex(/^[0-9a-f-]{36}$/i),
    workspaceResourceId: z.string().min(1).max(1000),
    query: z.string().min(1).max(100_000),
    timespan: z.string().max(100).optional(),
  })
  .strict();
export type PortalQueryRequest = z.infer<typeof PortalQueryRequestSchema>;
