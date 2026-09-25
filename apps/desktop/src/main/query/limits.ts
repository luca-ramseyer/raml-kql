/**
 * Log Analytics Query API limits (spec 04), verified 2026-09 against "Azure Monitor service
 * limits": https://learn.microsoft.com/azure/azure-monitor/fundamentals/service-limits#log-queries-and-language
 * and #log-analytics-workspaces (Query API).
 */
export const LOG_ANALYTICS_LIMITS = {
  /** Concurrent queries per user; more are queued server-side (FIFO, up to 3 minutes). */
  concurrentQueriesPerUser: 5,
  /** Requests per 30 s per Entra user or client IP. */
  requestsPer30s: 200,
  /** Rows per result. */
  maxRows: 500_000,
  /** Raw data per result (~100 MiB; 64 MB compressed on the wire). */
  maxResultBytes: 104_857_600,
  /** Maximum `Prefer: wait` (10 minutes); the default without the header is 3 minutes. */
  maxTimeoutSeconds: 600,
} as const;

/** Engine defaults, chosen to stay under the limits above (spec 04, "Scheduling"). */
export const ENGINE_DEFAULTS = {
  maxConcurrentPerPrincipal: 4, // leaves one slot for the portal the analyst has open
  maxConcurrentTotal: 16,
  bucketCapacity: 150, // per principal per 30 s, headroom under 200
  bucketWindowMs: 30_000,
  timeoutSeconds: 180,
  maxAttempts: 3,
  backoffBaseMs: 1000,
  backoffCapMs: 30_000,
  /** Throttled without a Retry-After header. */
  defaultRetryAfterMs: 5000,
} as const;
