# 04 — Query execution, result cache, audit log, demo mode

## Request

```ts
interface QueryRun {
  runId: string;                 // ulid
  tabId: string;
  query: string;                 // final KQL after parameter injection (spec 08)
  timespan?: string;             // ISO 8601 duration or "start/end"; omitted when "Set in query"
  targets: TargetRef[];          // workspace keys
  options: { includeRender: boolean; includeStatistics: boolean; timeoutSec: number };
}
```

## Log Analytics Query API

- `POST https://api.loganalytics.io/v1/workspaces/{customerId}/query`, body `{ query, timespan? }`.
- Headers:
  - `Prefer: wait=<timeoutSec>, include-render=true, include-statistics=true`
  - `x-ms-app: RamlKQL/<version>`
  - `x-ms-client-request-id: <runId>-<n>`
- Use the official SDK (`@azure/monitor-query` or its current successor for logs) if it supports cancellation, `Prefer` options and raw column types cleanly. Otherwise use a thin typed client on `AzureHttp`. Record the choice in DECISIONS.
- Handle multiple result tables (`tables[]`) and the `render` / `statistics` payloads.

### Service limits to respect

These values were known at the time of writing. **Verify them against current Microsoft docs** ("Log Analytics Query API limits") and put the final values in `src/main/query/limits.ts`, with a link in a comment.

- About 5 concurrent queries per user. Beyond that, requests queue server-side (up to ~3 min) and then return 429.
- About 200 requests per 30 s per user or client IP.
- Max 500,000 rows and ~64 MB of data per result.
- Default server timeout 3 min; max 10 min via `Prefer: wait=600`.

## Fan-out engine

### Scheduling

- One **queue per principal** (principal = accountId, or `az` identity), because limits are per user.
  - `maxConcurrentPerPrincipal` default **4**. Setting `query.maxConcurrentPerAccount`, range 1–5. The default of 4 leaves one slot for the portal the analyst probably has open.
  - Token bucket: default 150 requests / 30 s per principal. This keeps headroom under the ~200 limit.
- Overall cap `query.maxConcurrentTotal` default 16 across all principals.
- Order: targets whose tenant token is already warm go first; then round-robin across tenants so one slow tenant doesn't starve others.

### Pre-flight

- Parse the query with the Kusto language service (monaco-kusto's parser in main, or the same library headless).
  - **Syntax errors block the run** with inline squiggles. The query is never sent to 40 workspaces just to get 40 identical errors.
- Semantic errors, like a missing table in some workspaces, are only detected server-side. The schema-merge hints (spec 05) warn beforehand but don't block.
- **Fail-fast on first semantic error** (setting `query.failFastOnSemanticError`, default `true`): if the **first** completed workspace returns a semantic error (`BadArgumentError`/`SemanticError`) that does not mention an unknown table/column, cancel queued (not yet started) workspaces and ask "Query has an error — Run on remaining workspaces anyway?". Unknown table/column errors don't trigger fail-fast because they are legitimately per-workspace.

### Timeouts and retries

- Per-workspace timeout: `query.timeoutSeconds` default 180, max 600 (sent as `Prefer: wait`). The client-side abort is set to timeout + 15 s.
- **Retry policy**, max 3 attempts, full-jitter exponential backoff (base 1 s, cap 30 s):
  - **429:** honour `Retry-After` / `x-ms-retry-after-ms`. Put the principal's queue into cooldown (pause *all* its requests, not just the one).
  - **5xx, network errors, `ECONNRESET`:** retry.
  - **400 / semantic errors:** never retry.
  - **401:** one silent token refresh, then `AUTH_INTERACTION_REQUIRED` (spec 02).
  - **403:** try the next access path if `query.fallbackAccessPaths`; otherwise fail with `NO_PERMISSION`.
  - **Timeouts:** do not retry automatically (a query that timed out once will usually time out again). Mark as `timeout`; the user can re-run with a longer timeout.
- **Cancellation:** `Esc` / Stop cancels all in-flight requests (`AbortController`) and drops queued ones. Workspaces already completed keep their results. The run is marked `cancelled`.

### Per-workspace states

`queued → running → (retrying) → succeeded | partial | failed | timeout | cancelled | skipped`

- `partial`: the API returned data plus an error (e.g. `PartialError`, or the result was truncated at the row/size cap). Rows are kept and marked as incomplete.
- `skipped`: fail-fast or auth-aggregation skipped it.

### Result merging (same approach as the June prototype: merge per-workspace results globally, app-side)

- For each result table index `i`, the merged table = union of all workspaces' table `i`.
- **Attribution columns** are prepended:
  - `_TenantName`, `_TenantId`, `_SubscriptionName`, `_WorkspaceName`, `_WorkspaceId` (customerId), `_Account` (hidden by default).
  - Setting `results.attributionColumns` controls which ones are visible.
- **Schema union:** columns are matched by name. If types conflict between workspaces (e.g. `long` vs `real`), widen (`long`→`real`, anything→`string` as a last resort) and show a ⓘ on the column header explaining it.
  - Columns missing in a workspace become null.
  - Column order: attribution columns, then the first successful workspace's order, then new columns appended.
- **Row caps:**
  - Per workspace: API cap (500k).
  - Merged total: `results.maxMergedRows` default 1,000,000. When exceeded, stop ingesting further rows and show a banner "Result truncated at 1,000,000 rows — narrow your query or reduce targets".
- Results stream into the grid as workspaces complete (don't wait for all).
- `render` metadata: use the first successful workspace's render spec. If workspaces disagree, use the most common one.
- `statistics`: summarise per workspace (CPU time, data scanned) and show them in the status panel.

### Run status panel

A panel tab "Run" next to "Results", like VS Code's Output/Problems, with a table per run:

| Tenant | Workspace | Account | State | Rows | Duration | Attempts | Message |
|---|---|---|---|---|---|---|---|

- The header summary reads "38 ✓ · 2 partial · 1 failed · 00:14".
- A summary pill with the same counts appears above the grid. Clicking it opens the panel.
- Actions: **Re-run failed**, **Re-run failed + timed out with longer timeout**, "Copy error", "Open in portal" for that workspace, and "Sign in" for auth failures.
- The Problems-like error text keeps the server's error code and message (e.g. `SemanticError: 'where' operator: Failed to resolve table or column expression named 'DeviceEvents'`).

## Result store (encrypted session cache)

- At app start, generate a random 256-bit **session key**, held in main-process memory only (never written).
- Results are held in memory as columnar batches, up to `results.memoryBudgetMB` (default 1024).
  - Above the budget, older batches (or other tabs' results) **spill to disk**: `<userData>/session-cache/<sessionId>/` files, encrypted with AES-256-GCM (Node `crypto`), a unique IV per chunk, and the run ID as associated data.
- **On quit** (`before-quit`, `will-quit`): delete the session cache directory, zero and drop the key.
- **On start:** delete any leftover `session-cache/*` (from crashes, kill -9, power loss). Leftovers are unreadable anyway because their key died with the process, so this is crypto-shredding plus cleanup.
- Tabs persist (query, targets, time range, layout); **results do not**. On restart the tab shows "Results from the previous session were cleared. Press Shift+Enter to run again."
- Closing a tab frees its results immediately. A "Clear all results" command exists.
- Unit test: after `ResultStore.dispose()` the directory is gone and key material is not reachable. Integration test: kill-and-restart wipes the cache.

## Audit log

- A local, append-only JSONL file in the config dir, `audit/audit-YYYY-MM.jsonl`, rotated monthly. Retention: `audit.retentionMonths` default 12. Setting `audit.enabled` default `true`.
- Recorded per workspace execution attempt:

```json
{"ts":"2026-09-24T09:12:03.123Z","runId":"01J...","seq":1842,
 "account":"luca@contoso.com","via":"lighthouse","tenantId":"...","workspaceId":"...",
 "workspaceResourceId":"...","queryHash":"sha256:...","query":"SigninLogs | ...",
 "timespan":"P1D","state":"succeeded","rows":1234,"durationMs":5120,"attempt":1,
 "appVersion":"1.0.0","prev":"sha256:<hash of previous line>"}
```

- **Hash chain:** `prev` is the SHA-256 of the previous line, which makes tampering evident. Command "Audit: Verify Log Integrity".
- Setting `audit.includeQueryText` default `true`. When `false`, only the hash is stored.
- Also logged: sign-in/out, extension permission grants and revokes, extension installs, and source adds.
- Never logged: tokens or result values.
- Audit viewer: a simple searchable table view plus "Export as CSV" (for MSSP accountability: "which customers did I query, and when?").

## Demo mode

- Enabled with `--demo` / `RAML_KQL_DEMO=1` or the command "Developer: Restart in Demo Mode".
- Fake principals:
  - 2 accounts: `analyst@contoso.example` (home + lighthouse) and `guest@woodgrove.example` (guest).
  - 6 tenants, 12 workspaces, a few non-Sentinel, one "needs re-auth", one that always 403s, one slow, and one that returns 429 once.
- A fake data source implements the `DataSource` interface. It generates deterministic data for common tables (`SigninLogs`, `SecurityEvent`, `SecurityIncident`, `DeviceProcessEvents`, `EmailEvents`, `AzureActivity`, `Heartbeat`) from a seeded PRNG, with a real `TimeGenerated` column.
  - It does **not** implement a KQL engine. It detects the source table, honours `take`/`limit` and `count`, and returns canned results for a few known queries used in tests and screenshots. Everything else returns a generic sample of the source table. Label results "Demo data" in the UI so nobody mistakes them for real query output.
- A fake HTTP server (for integration tests of the real clients) implements Resource Graph, `/tenants` and the Log Analytics query/metadata endpoints with fixture responses and fault injection (429, 5xx, timeouts, partial). It lives in `apps/desktop/test/fake-azure/`.
