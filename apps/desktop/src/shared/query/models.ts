import {
  KQL_IDENTIFIER,
  PARAMETER_TYPES,
  ParameterValueSchema,
} from '@raml-kql/pack-schema/schemas';
import { z } from 'zod';

import { AppErrorCodeSchema } from '../errors';
import { KqlTypeSchema } from '../schema/models';

import { TimeRangeSchema } from './time-range';

/**
 * Query runs (spec 04). Only metadata travels in run snapshots; result rows are fetched page
 * by page from the main-process result store and never persisted.
 */

export const QUERY_TEXT_MAX = 100_000;

/** A parameter with the value to run with. */
export const BoundParameterSchema = z
  .object({
    name: z.string().regex(KQL_IDENTIFIER).max(100),
    type: z.enum(PARAMETER_TYPES),
    values: z.array(z.string().max(1000)).max(500).optional(),
    value: ParameterValueSchema,
  })
  .strict();
export type BoundParameter = z.infer<typeof BoundParameterSchema>;

export const QueryRunRequestSchema = z
  .object({
    tabId: z.string().min(1).max(200),
    query: z.string().min(1).max(QUERY_TEXT_MAX),
    /** ISO 8601 duration or `start/end`; omitted when the query sets its own time filter. */
    timespan: z.string().max(100).optional(),
    resourceIds: z.array(z.string().min(1).max(1000)).min(1).max(5000),
    /** For history only: the Targets group and the time range picked. */
    groupId: z.string().max(100).optional(),
    timeRange: TimeRangeSchema.optional(),
    tabTitle: z.string().max(300).optional(),
    /**
     * Query parameters (spec 08): main prepends typed `let` statements, or replaces the
     * query's own `let` of the same name. Values are checked against their type there.
     */
    parameters: z.array(BoundParameterSchema).max(50).optional(),
  })
  .strict();
export type QueryRunRequest = z.infer<typeof QueryRunRequestSchema>;

export const WorkspaceRunStateSchema = z.enum([
  'queued',
  'running',
  'retrying',
  'succeeded',
  'partial',
  'failed',
  'timeout',
  'cancelled',
  'skipped',
]);
export type WorkspaceRunState = z.infer<typeof WorkspaceRunStateSchema>;

export const TERMINAL_STATES: ReadonlySet<WorkspaceRunState> = new Set([
  'succeeded',
  'partial',
  'failed',
  'timeout',
  'cancelled',
  'skipped',
]);

/** Error codes of a failed workspace: app codes plus the query-specific ones. */
export const WorkspaceErrorCodeSchema = z.union([
  AppErrorCodeSchema,
  z.enum([
    'NO_PERMISSION',
    'THROTTLED',
    'TIMEOUT',
    'SERVER_ERROR',
    'NETWORK',
    'QUERY_ERROR',
    'PARTIAL',
    'TRUNCATED',
    'CANCELLED',
    'FAIL_FAST',
    'WORKSPACE_UNKNOWN',
  ]),
]);
export type WorkspaceErrorCode = z.infer<typeof WorkspaceErrorCodeSchema>;

export const WorkspaceStatisticsSchema = z.object({
  cpuMs: z.number().nonnegative().optional(),
  dataScannedMb: z.number().nonnegative().optional(),
});
export type WorkspaceStatistics = z.infer<typeof WorkspaceStatisticsSchema>;

export const WorkspaceRunStatusSchema = z.object({
  resourceId: z.string(),
  tenantId: z.string(),
  accountId: z.string().optional(),
  state: WorkspaceRunStateSchema,
  rows: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  attempts: z.number().int().nonnegative(),
  errorCode: WorkspaceErrorCodeSchema.optional(),
  /** Server error code and message as returned (e.g. `SemanticError: …`); redacted. */
  message: z.string().max(4000).optional(),
  statistics: WorkspaceStatisticsSchema.optional(),
});
export type WorkspaceRunStatus = z.infer<typeof WorkspaceRunStatusSchema>;

export const ResultColumnSchema = z.object({
  name: z.string(),
  type: KqlTypeSchema,
  /** Workspaces disagreed on the type; it was widened (shown as ⓘ). */
  widenedFrom: z.array(KqlTypeSchema).optional(),
  /** An attribution column added by the app (`_TenantName`, ...). */
  attribution: z.boolean().optional(),
});
export type ResultColumn = z.infer<typeof ResultColumnSchema>;

export const ResultTableInfoSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  rowCount: z.number().int().nonnegative(),
  columns: z.array(ResultColumnSchema),
});
export type ResultTableInfo = z.infer<typeof ResultTableInfoSchema>;

export const RenderSpecSchema = z.object({
  visualization: z.string().max(100),
  properties: z.record(z.string(), z.json()).optional(),
});
export type RenderSpec = z.infer<typeof RenderSpecSchema>;

export const RunStateSchema = z.enum(['running', 'completed', 'cancelled']);
export type RunState = z.infer<typeof RunStateSchema>;

export const RunSnapshotSchema = z.object({
  runId: z.string(),
  tabId: z.string(),
  state: RunStateSchema,
  /** The query text that ran (for "Open query in Azure Portal Logs"). */
  query: z.string().max(QUERY_TEXT_MAX),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  timespan: z.string().optional(),
  workspaces: z.array(WorkspaceRunStatusSchema),
  tables: z.array(ResultTableInfoSchema),
  /** The merged row cap was hit; later rows were dropped. */
  truncated: z.boolean(),
  /** Results come from the demo data source. */
  demo: z.boolean(),
  render: RenderSpecSchema.optional(),
  /** Fail-fast stopped the run: the renderer asks whether to run the rest anyway. */
  failFast: z.object({ message: z.string().max(4000) }).optional(),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const ResultPageRequestSchema = z
  .object({
    runId: z.string().min(1).max(100),
    tableIndex: z.number().int().nonnegative().max(1000),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(10_000),
  })
  .strict();
export type ResultPageRequest = z.infer<typeof ResultPageRequestSchema>;

export const ResultPageSchema = z.object({
  runId: z.string(),
  tableIndex: z.number().int(),
  offset: z.number().int(),
  columns: z.array(ResultColumnSchema),
  rows: z.array(z.array(z.json())),
});
export type ResultPage = z.infer<typeof ResultPageSchema>;

export const RerunRequestSchema = z
  .object({
    runId: z.string().min(1).max(100),
    /** Which workspaces to run again. */
    states: z.array(WorkspaceRunStateSchema).min(1),
    /** Override `query.timeoutSeconds` (e.g. "re-run timed out with a longer timeout"). */
    timeoutSeconds: z.number().int().min(10).max(600).optional(),
  })
  .strict();
export type RerunRequest = z.infer<typeof RerunRequestSchema>;

/** Attribution columns prepended to every merged table (spec 04). */
export const ATTRIBUTION_COLUMNS = [
  '_TenantName',
  '_TenantId',
  '_SubscriptionName',
  '_WorkspaceName',
  '_WorkspaceId',
  '_Account',
] as const;
export type AttributionColumn = (typeof ATTRIBUTION_COLUMNS)[number];
