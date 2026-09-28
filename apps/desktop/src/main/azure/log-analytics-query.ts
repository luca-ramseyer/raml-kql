import { z } from 'zod';

import type { RenderSpec, WorkspaceStatistics } from '../../shared/query/models';
import { normalizeKqlType, type KqlType } from '../../shared/schema/models';
import type { CloudProfile } from '../auth/cloud';
import { redact } from '../logging/redact';

import type { FetchLike } from './arm-tenants';

/**
 * Log Analytics Query API client (spec 04): `POST {endpoint}/v1/workspaces/{customerId}/query`.
 * A thin typed client instead of `@azure/monitor-query-logs` (D-031): the engine needs raw
 * column types, the `render` and `statistics` payloads, AbortSignal cancellation and requests
 * through AzureHttp (OS proxy).
 */

export type QueryFailureKind =
  | 'throttled'
  | 'transient'
  | 'network'
  | 'badRequest'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'timeout'
  | 'cancelled';

export class QueryFailure extends Error {
  constructor(
    readonly kind: QueryFailureKind,
    message: string,
    readonly details: { status?: number; code?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'QueryFailure';
  }
}

export interface RawColumn {
  name: string;
  type: KqlType;
}

export interface RawTable {
  name: string;
  columns: RawColumn[];
  rows: unknown[][];
}

export interface QueryResponse {
  tables: RawTable[];
  render?: RenderSpec;
  statistics?: WorkspaceStatistics;
  /** Data came back together with an error (e.g. `PartialError`, result truncated). */
  partialError?: { code: string; message: string };
}

const ErrorSchema: z.ZodType<ApiError> = z.lazy(() =>
  z.looseObject({
    code: z.string().nullish(),
    message: z.string().nullish(),
    innererror: ErrorSchema.nullish(),
    details: z
      .array(z.looseObject({ code: z.string().nullish(), message: z.string().nullish() }))
      .nullish(),
  }),
);
interface ApiError {
  code?: string | null | undefined;
  message?: string | null | undefined;
  innererror?: ApiError | null | undefined;
  details?:
    { code?: string | null | undefined; message?: string | null | undefined }[] | null | undefined;
}

const ResponseSchema = z.looseObject({
  tables: z
    .array(
      z.looseObject({
        name: z.string(),
        columns: z.array(z.looseObject({ name: z.string(), type: z.string().nullish() })),
        rows: z.array(z.array(z.unknown())),
      }),
    )
    .nullish(),
  error: ErrorSchema.nullish(),
  render: z.looseObject({ visualization: z.string().nullish() }).nullish(),
  statistics: z.unknown().optional(),
});

/** `Code: message` from the most specific (innermost) error, as the portal shows it. */
export function describeApiError(
  error: ApiError | null | undefined,
  fallback: string,
): {
  code: string;
  message: string;
} {
  let current = error ?? undefined;
  let code = current?.code ?? undefined;
  let message = current?.message ?? undefined;
  while (current?.innererror !== undefined && current.innererror !== null) {
    current = current.innererror;
    code = current.code ?? code;
    message = current.message ?? message;
  }
  const finalCode = code ?? 'Error';
  return {
    code: finalCode,
    message: redact(`${finalCode}: ${message ?? fallback}`).slice(0, 4000),
  };
}

/** `Retry-After` (seconds or HTTP date) or `x-ms-retry-after-ms`, in milliseconds. */
export function retryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const ms = headers.get('x-ms-retry-after-ms');
  if (ms !== null && /^\d+$/.test(ms)) return Number(ms);
  const value = headers.get('retry-after');
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** `hh:mm:ss.fffffff` (a KQL timespan) → milliseconds. */
function timespanMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (match === null) return undefined;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return Math.round(
    ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000,
  );
}

function parseStatistics(raw: unknown): WorkspaceStatistics | undefined {
  const query = (raw as { query?: Record<string, unknown> } | undefined)?.query;
  if (query === undefined) return undefined;
  const usage = query['resourceUsage'] as Record<string, Record<string, unknown>> | undefined;
  const cpuMs = timespanMs(usage?.['cpu']?.['total cpu']);
  const hot = (
    usage?.['cache']?.['shards'] as Record<string, Record<string, number>> | undefined
  )?.['hot'];
  const bytes =
    hot === undefined
      ? undefined
      : (hot['hitbytes'] ?? 0) + (hot['missbytes'] ?? 0) + (hot['retrievebytes'] ?? 0);
  const statistics: WorkspaceStatistics = {
    ...(cpuMs === undefined ? {} : { cpuMs }),
    ...(bytes === undefined ? {} : { dataScannedMb: Math.round((bytes / 1_048_576) * 100) / 100 }),
  };
  return Object.keys(statistics).length === 0 ? undefined : statistics;
}

/** Parse a 200 response body (exported for tests). */
export function parseQueryResponse(json: unknown): QueryResponse {
  const body = ResponseSchema.parse(json);
  const response: QueryResponse = {
    tables: (body.tables ?? []).map((table) => ({
      name: table.name,
      columns: table.columns.map((c) => ({
        name: c.name,
        type: normalizeKqlType(c.type ?? 'string'),
      })),
      rows: table.rows,
    })),
  };
  if (body.error !== undefined && body.error !== null) {
    response.partialError = describeApiError(body.error, 'The query returned partial results.');
  }
  const visualization = body.render?.visualization;
  if (typeof visualization === 'string' && visualization !== '') {
    const { visualization: _v, ...properties } = body.render ?? {};
    response.render = { visualization, properties: properties as RenderSpec['properties'] };
  }
  const statistics = parseStatistics(body.statistics);
  if (statistics !== undefined) response.statistics = statistics;
  return response;
}

function failureFor(status: number): QueryFailureKind {
  if (status === 429) return 'throttled';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 504 || status === 408) return 'timeout';
  if (status >= 500) return 'transient';
  return 'badRequest';
}

export interface LogAnalyticsQueryOptions {
  cloud: CloudProfile;
  fetch: FetchLike;
  token: string;
  customerId: string;
  query: string;
  timespan?: string | undefined;
  /** Server-side timeout (`Prefer: wait`); the client aborts 15 s later. */
  timeoutSeconds: number;
  /** `x-ms-client-request-id` (`<runId>-<n>`). */
  requestId: string;
  signal: AbortSignal;
  /** How long after `Prefer: wait` the client gives up (default 15 s; tests shorten it). */
  clientGraceMs?: number;
}

export async function executeLogAnalyticsQuery(
  options: LogAnalyticsQueryOptions,
): Promise<QueryResponse> {
  const url = `${new URL(options.cloud.logAnalyticsEndpoint).origin}/v1/workspaces/${encodeURIComponent(options.customerId)}/query`;
  const clientTimeout = AbortSignal.timeout(
    options.timeoutSeconds * 1000 + (options.clientGraceMs ?? 15_000),
  );
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: `wait=${String(options.timeoutSeconds)}, include-render=true, include-statistics=true`,
        'x-ms-client-request-id': options.requestId,
      },
      body: JSON.stringify({
        query: options.query,
        ...(options.timespan === undefined ? {} : { timespan: options.timespan }),
      }),
      signal: AbortSignal.any([options.signal, clientTimeout]),
    });
  } catch (error) {
    throw abortOrNetwork(error, options.signal, clientTimeout);
  }

  if (!response.ok) {
    let apiError: ApiError | undefined;
    try {
      apiError =
        ErrorSchema.safeParse(((await response.json()) as { error?: unknown }).error).data ??
        undefined;
    } catch {
      apiError = undefined;
    }
    const { code, message } = describeApiError(
      apiError,
      `Log Analytics returned HTTP ${String(response.status)}`,
    );
    const retryAfter = retryAfterMs(response.headers);
    throw new QueryFailure(failureFor(response.status), message, {
      status: response.status,
      code,
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    });
  }

  try {
    return parseQueryResponse(await response.json());
  } catch (error) {
    if (options.signal.aborted || clientTimeout.aborted) {
      throw abortOrNetwork(error, options.signal, clientTimeout);
    }
    throw new QueryFailure(
      'transient',
      'Log Analytics returned a response that could not be read.',
    );
  }
}

function abortOrNetwork(error: unknown, signal: AbortSignal, timeout: AbortSignal): QueryFailure {
  if (signal.aborted) return new QueryFailure('cancelled', 'Cancelled.');
  if (timeout.aborted) return new QueryFailure('timeout', 'The query timed out (no response).');
  const message = error instanceof Error ? error.message : String(error);
  return new QueryFailure('network', redact(`Network error: ${message}`).slice(0, 500));
}
