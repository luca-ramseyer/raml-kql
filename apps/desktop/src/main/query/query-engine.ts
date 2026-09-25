import { randomUUID } from 'node:crypto';

import { AppError } from '../../shared/errors';
import {
  TERMINAL_STATES,
  type QueryRunRequest,
  type RenderSpec,
  type RerunRequest,
  type RunSnapshot,
  type WorkspaceErrorCode,
  type WorkspaceRunState,
  type WorkspaceRunStatus,
  type AttributionColumn,
} from '../../shared/query/models';
import { accessPathKey, type AccessPath, type Workspace } from '../../shared/workspaces/models';
import type { AuditLog } from '../audit/audit-log';
import type { TokenRequest } from '../auth/auth-service';
import type { AccessToken } from '../auth/token-cache';
import { QueryFailure, type QueryResponse } from '../azure/log-analytics-query';
import { describeError } from '../logging/redact';
import type { ResultStore } from '../results/result-store';

import { ENGINE_DEFAULTS } from './limits';
import { backoffMs, sleep } from './retry';
import type { Scheduler } from './scheduler';

/** Where query results come from: the Log Analytics API, or demo data. */
export interface DataSource {
  execute(request: {
    workspace: Workspace;
    token: string;
    query: string;
    timespan: string | undefined;
    timeoutSeconds: number;
    requestId: string;
    signal: AbortSignal;
  }): Promise<QueryResponse>;
}

export interface EngineSettings {
  timeoutSeconds: number;
  failFastOnSemanticError: boolean;
  fallbackAccessPaths: boolean;
}

export interface QueryEngineOptions {
  workspace: (resourceId: string) => Workspace | undefined;
  /** Real names for the attribution columns (aliasing is applied when rendering). */
  tenantName: (tenantId: string) => string;
  accountName: (accountId: string) => string;
  getToken: (request: TokenRequest) => Promise<AccessToken>;
  source: DataSource;
  scheduler: Scheduler;
  store: ResultStore;
  audit?: AuditLog | undefined;
  settings: () => EngineSettings;
  demo: boolean;
  onChange: (snapshot: RunSnapshot) => void;
  newRunId?: () => string;
  random?: () => number;
  now?: () => number;
  /** Snapshots are coalesced to at most one per interval while a run is busy. */
  emitIntervalMs?: number;
  maxAttempts?: number;
}

interface Task {
  resourceId: string;
  status: WorkspaceRunStatus;
  controller: AbortController;
  /** Why the task was stopped before it started (fail-fast, auth aggregation). */
  skipReason: { code: WorkspaceErrorCode; message: string } | undefined;
  render: RenderSpec | undefined;
}

interface Run {
  runId: string;
  tabId: string;
  query: string;
  timespan: string | undefined;
  startedAt: number;
  finishedAt: number | undefined;
  cancelled: boolean;
  tasks: Map<string, Task>;
  order: string[];
  requestCounter: number;
  /** A task already reached a final state (fail-fast only looks at the first one). */
  anyCompleted: boolean;
  failFast: { message: string } | undefined;
  failFastDisabled: boolean;
  /** (account, tenant) pairs whose token failed in this run: later workspaces skip. */
  authFailures: Map<string, { code: WorkspaceErrorCode; message: string }>;
  emitTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Semantic errors that are legitimately per-workspace (a table or column missing there). */
const PER_WORKSPACE_ERROR =
  /failed to resolve (table|column|scalar expression|entity)|does not refer to any known|unknown (table|column)|could not be resolved/i;

export class QueryEngine {
  private readonly runs = new Map<string, Run>();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: QueryEngineOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /** Start a run. Earlier runs of the same tab are cancelled and their results freed. */
  async run(request: QueryRunRequest): Promise<RunSnapshot> {
    for (const run of [...this.runs.values()]) {
      if (run.tabId === request.tabId) await this.deleteRun(run.runId);
    }
    const runId = this.options.newRunId?.() ?? randomUUID();
    const ids = roundRobinByTenant(
      [...new Set(request.resourceIds.map((id) => id.toLowerCase()))],
      (id) => this.options.workspace(id)?.tenantId ?? '',
    );
    const run: Run = {
      runId,
      tabId: request.tabId,
      query: request.query,
      timespan: request.timespan,
      startedAt: this.now(),
      finishedAt: undefined,
      cancelled: false,
      tasks: new Map(ids.map((id) => [id, this.newTask(id)])),
      order: ids,
      requestCounter: 0,
      anyCompleted: false,
      failFast: undefined,
      failFastDisabled: false,
      authFailures: new Map(),
      emitTimer: undefined,
    };
    this.runs.set(runId, run);
    const timeoutSeconds = this.options.settings().timeoutSeconds;
    for (const id of ids) void this.execute(run, id, timeoutSeconds);
    this.checkFinished(run);
    return this.snapshot(run);
  }

  /** Stop a run: in-flight requests are aborted, queued ones dropped; results so far stay. */
  cancel(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId);
    if (run === undefined) return undefined;
    run.cancelled = true;
    for (const task of run.tasks.values()) task.controller.abort();
    this.checkFinished(run);
    return this.snapshot(run);
  }

  /** Run some workspaces again ("Re-run failed", fail-fast "Run on remaining anyway"). */
  async rerun(request: RerunRequest): Promise<RunSnapshot | undefined> {
    const run = this.runs.get(request.runId);
    if (run === undefined) return undefined;
    const states = new Set(request.states);
    const ids = run.order.filter((id) => {
      const task = run.tasks.get(id);
      return task !== undefined && states.has(task.status.state);
    });
    if (ids.length === 0) return this.snapshot(run);
    run.cancelled = false;
    run.finishedAt = undefined;
    run.failFast = undefined;
    run.failFastDisabled = true;
    run.authFailures.clear();
    for (const id of ids) {
      await this.options.store.removeWorkspace(run.runId, id);
      run.tasks.set(id, this.newTask(id));
    }
    const timeoutSeconds = request.timeoutSeconds ?? this.options.settings().timeoutSeconds;
    for (const id of ids) void this.execute(run, id, timeoutSeconds);
    this.emit(run, true);
    return this.snapshot(run);
  }

  /** Free a run's results (tab closed, re-run, "Clear all results"). */
  async deleteRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
    run.cancelled = true;
    for (const task of run.tasks.values()) task.controller.abort();
    clearTimeout(run.emitTimer);
    this.runs.delete(runId);
    await this.options.store.deleteRun(runId);
  }

  async deleteAll(): Promise<void> {
    for (const runId of [...this.runs.keys()]) await this.deleteRun(runId);
  }

  get(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId);
    return run === undefined ? undefined : this.snapshot(run);
  }

  // --- One workspace ------------------------------------------------------------------------

  private newTask(resourceId: string): Task {
    const workspace = this.options.workspace(resourceId);
    return {
      resourceId,
      status: {
        resourceId,
        tenantId: workspace?.tenantId ?? '',
        state: 'queued',
        rows: 0,
        attempts: 0,
      },
      controller: new AbortController(),
      skipReason: undefined,
      render: undefined,
    };
  }

  private async execute(run: Run, resourceId: string, timeoutSeconds: number): Promise<void> {
    const task = run.tasks.get(resourceId);
    if (task === undefined) return;
    const workspace = this.options.workspace(resourceId);
    const started = this.now();
    const finish = (state: WorkspaceRunState, extra: Partial<WorkspaceRunStatus> = {}): void => {
      if (run.tasks.get(resourceId) !== task) return; // superseded by a re-run
      task.status = { ...task.status, ...extra, state, durationMs: this.now() - started };
      this.onTaskFinished(run, task);
    };
    const stopped = (): void => {
      if (task.skipReason !== undefined) {
        finish('skipped', { errorCode: task.skipReason.code, message: task.skipReason.message });
      } else {
        finish('cancelled', { errorCode: 'CANCELLED', message: 'Cancelled.' });
      }
    };

    if (workspace === undefined) {
      finish('failed', {
        errorCode: 'WORKSPACE_UNKNOWN',
        message: 'This workspace is no longer in the inventory.',
      });
      return;
    }
    const paths = orderedPaths(workspace);
    const settings = this.options.settings();
    const maxAttempts = this.options.maxAttempts ?? ENGINE_DEFAULTS.maxAttempts;
    let pathIndex = 0;
    let retries = 0;
    let forceRefresh = false;
    let refreshed = false;

    for (;;) {
      const path = paths[pathIndex];
      if (path === undefined) {
        finish('failed', {
          errorCode: 'NO_PERMISSION',
          message: 'No account can reach this workspace.',
        });
        return;
      }
      const authKey = accessPathKey(path);
      const skipForAuth = (): boolean => {
        const authFailure = run.authFailures.get(authKey);
        if (authFailure === undefined) return false;
        finish('skipped', { accountId: path.accountId, ...authErrorFields(authFailure) });
        return true;
      };
      if (skipForAuth()) return;

      let release: () => void;
      try {
        release = await this.options.scheduler.acquire(path.accountId, task.controller.signal);
      } catch {
        stopped();
        return;
      }
      // Another workspace of this tenant may have hit an auth failure while this one waited.
      if (skipForAuth()) {
        release();
        return;
      }
      this.update(run, task, {
        state: retries > 0 ? 'retrying' : 'running',
        accountId: path.accountId,
        attempts: task.status.attempts + 1,
      });
      const attemptStarted = this.now();
      let response: QueryResponse | undefined;
      let failure: unknown;
      try {
        const token = await this.options.getToken({
          accountId: path.accountId,
          tenantId: path.authorityTenantId,
          resource: 'logAnalytics',
          ...(forceRefresh ? { forceRefresh: true } : {}),
        });
        forceRefresh = false;
        run.requestCounter += 1;
        response = await this.options.source.execute({
          workspace,
          token: token.token,
          query: run.query,
          timespan: run.timespan,
          timeoutSeconds,
          requestId: `${run.runId}-${String(run.requestCounter)}`,
          signal: task.controller.signal,
        });
      } catch (error) {
        failure = error;
      } finally {
        release();
      }

      // --- Success --------------------------------------------------------------------------
      if (response !== undefined) {
        const outcome = await this.storeResponse(run, task, workspace, path, response);
        this.audit(run, workspace, path, outcome.state, outcome.rows, attemptStarted, task);
        finish(outcome.state, outcome.extra);
        return;
      }

      // --- Failure --------------------------------------------------------------------------
      if (task.controller.signal.aborted) {
        this.audit(run, workspace, path, 'cancelled', 0, attemptStarted, task);
        stopped();
        return;
      }
      if (failure instanceof AppError) {
        // Token acquisition failed (spec 02): no silent retry.
        if (failure.code === 'AUTH_NO_ACCESS' && this.canFallBack(settings, paths, pathIndex)) {
          pathIndex += 1;
          continue;
        }
        const fields = { code: failure.code as WorkspaceErrorCode, message: failure.message };
        run.authFailures.set(authKey, fields);
        this.audit(run, workspace, path, 'failed', 0, attemptStarted, task);
        finish('failed', authErrorFields(fields));
        return;
      }
      const error =
        failure instanceof QueryFailure
          ? failure
          : new QueryFailure('network', describeError(failure));
      this.audit(run, workspace, path, error.kind, 0, attemptStarted, task);

      switch (error.kind) {
        case 'cancelled':
          stopped();
          return;
        case 'throttled':
          this.options.scheduler.cooldown(
            path.accountId,
            this.now() + (error.details.retryAfterMs ?? ENGINE_DEFAULTS.defaultRetryAfterMs),
          );
          if (++retries < maxAttempts) {
            this.update(run, task, { state: 'retrying', message: 'Throttled; waiting to retry.' });
            continue;
          }
          finish('failed', { errorCode: 'THROTTLED', message: error.message });
          return;
        case 'transient':
        case 'network':
          if (++retries < maxAttempts) {
            this.update(run, task, { state: 'retrying', message: error.message });
            try {
              await sleep(backoffMs(retries, this.random), task.controller.signal);
            } catch {
              stopped();
              return;
            }
            continue;
          }
          finish('failed', {
            errorCode: error.kind === 'network' ? 'NETWORK' : 'SERVER_ERROR',
            message: error.message,
          });
          return;
        case 'unauthorized':
          if (!refreshed) {
            refreshed = true;
            forceRefresh = true;
            continue;
          }
          run.authFailures.set(authKey, {
            code: 'AUTH_INTERACTION_REQUIRED',
            message: 'Sign in again to query this tenant.',
          });
          finish('failed', {
            errorCode: 'AUTH_INTERACTION_REQUIRED',
            message: 'Sign in again to query this tenant.',
          });
          return;
        case 'forbidden':
        case 'notFound':
          if (this.canFallBack(settings, paths, pathIndex)) {
            pathIndex += 1;
            refreshed = false;
            continue;
          }
          finish('failed', { errorCode: 'NO_PERMISSION', message: error.message });
          return;
        case 'timeout':
          finish('timeout', { errorCode: 'TIMEOUT', message: error.message });
          return;
        case 'badRequest':
          finish('failed', { errorCode: 'QUERY_ERROR', message: error.message });
          return;
      }
    }
  }

  private canFallBack(settings: EngineSettings, paths: AccessPath[], index: number): boolean {
    return settings.fallbackAccessPaths && index + 1 < paths.length;
  }

  private async storeResponse(
    run: Run,
    task: Task,
    workspace: Workspace,
    path: AccessPath,
    response: QueryResponse,
  ): Promise<{ state: 'succeeded' | 'partial'; rows: number; extra: Partial<WorkspaceRunStatus> }> {
    const attribution: Record<AttributionColumn, string> = {
      _TenantName: this.options.tenantName(workspace.tenantId),
      _TenantId: workspace.tenantId,
      _SubscriptionName: workspace.subscriptionName ?? workspace.subscriptionId,
      _WorkspaceName: workspace.name,
      _WorkspaceId: workspace.customerId,
      _Account: this.options.accountName(path.accountId),
    };
    let rows = 0;
    let truncated = false;
    for (const [index, table] of response.tables.entries()) {
      if (!this.runs.has(run.runId) || run.tasks.get(task.resourceId) !== task) break;
      const result = await this.options.store.addBatch({
        runId: run.runId,
        tableIndex: index,
        tableName: table.name,
        workspaceKey: task.resourceId,
        attribution,
        columns: table.columns,
        rows: table.rows,
      });
      rows += result.accepted;
      truncated ||= result.truncated;
    }
    task.render = response.render;
    const extra: Partial<WorkspaceRunStatus> = {
      rows,
      ...(response.statistics === undefined ? {} : { statistics: response.statistics }),
    };
    if (truncated) {
      return {
        state: 'partial',
        rows,
        extra: {
          ...extra,
          errorCode: 'TRUNCATED',
          message: 'Merged result row limit reached (results.maxMergedRows); rows were dropped.',
        },
      };
    }
    if (response.partialError !== undefined) {
      return {
        state: 'partial',
        rows,
        extra: { ...extra, errorCode: 'PARTIAL', message: response.partialError.message },
      };
    }
    return {
      state: 'succeeded',
      rows,
      extra: { ...extra, errorCode: undefined, message: undefined },
    };
  }

  private audit(
    run: Run,
    workspace: Workspace,
    path: AccessPath,
    state: string,
    rows: number,
    started: number,
    task: Task,
  ): void {
    void this.options.audit
      ?.append({
        kind: 'query',
        runId: run.runId,
        account: this.options.accountName(path.accountId),
        via: path.via,
        tenantId: workspace.tenantId,
        workspaceId: workspace.customerId,
        workspaceResourceId: workspace.resourceId,
        query: run.query,
        timespan: run.timespan,
        state,
        rows,
        durationMs: this.now() - started,
        attempt: task.status.attempts,
      })
      .catch((error: unknown) => {
        console.error(`[audit] ${describeError(error)}`);
      });
  }

  // --- Run bookkeeping ----------------------------------------------------------------------

  private update(run: Run, task: Task, patch: Partial<WorkspaceRunStatus>): void {
    if (run.tasks.get(task.resourceId) !== task) return;
    task.status = { ...task.status, ...patch };
    this.emit(run, false);
  }

  private onTaskFinished(run: Run, task: Task): void {
    const first =
      !run.anyCompleted && task.status.state !== 'cancelled' && task.status.state !== 'skipped';
    if (first) run.anyCompleted = true;
    if (
      first &&
      !run.failFastDisabled &&
      task.status.errorCode === 'QUERY_ERROR' &&
      this.options.settings().failFastOnSemanticError &&
      !PER_WORKSPACE_ERROR.test(task.status.message ?? '')
    ) {
      run.failFast = { message: task.status.message ?? 'The query has an error.' };
      for (const other of run.tasks.values()) {
        if (other.status.state === 'queued') {
          other.skipReason = {
            code: 'FAIL_FAST',
            message: 'Skipped: the query failed on the first workspace.',
          };
          other.controller.abort();
        }
      }
    }
    this.checkFinished(run);
    this.emit(run, false);
  }

  private checkFinished(run: Run): void {
    if (run.finishedAt !== undefined) return;
    const done = [...run.tasks.values()].every((t) => TERMINAL_STATES.has(t.status.state));
    if (!done) return;
    run.finishedAt = this.now();
    this.emit(run, true);
  }

  private emit(run: Run, now: boolean): void {
    if (!this.runs.has(run.runId)) return;
    if (now) {
      clearTimeout(run.emitTimer);
      run.emitTimer = undefined;
      this.options.onChange(this.snapshot(run));
      return;
    }
    run.emitTimer ??= setTimeout(() => {
      run.emitTimer = undefined;
      if (this.runs.has(run.runId)) this.options.onChange(this.snapshot(run));
    }, this.options.emitIntervalMs ?? 100);
  }

  private snapshot(run: Run): RunSnapshot {
    const tasks = run.order.flatMap((id) => {
      const task = run.tasks.get(id);
      return task === undefined ? [] : [task];
    });
    const render = mostCommonRender(tasks.map((t) => t.render));
    return {
      runId: run.runId,
      tabId: run.tabId,
      state: run.finishedAt === undefined ? 'running' : run.cancelled ? 'cancelled' : 'completed',
      startedAt: new Date(run.startedAt).toISOString(),
      ...(run.finishedAt === undefined
        ? {}
        : { finishedAt: new Date(run.finishedAt).toISOString() }),
      ...(run.timespan === undefined ? {} : { timespan: run.timespan }),
      workspaces: tasks.map((t) => stripUndefined(t.status)),
      tables: this.options.store.tables(run.runId),
      truncated: this.options.store.truncated(run.runId),
      demo: this.options.demo,
      ...(render === undefined ? {} : { render }),
      ...(run.failFast === undefined ? {} : { failFast: run.failFast }),
    };
  }
}

function authErrorFields(failure: {
  code: WorkspaceErrorCode;
  message: string;
}): Partial<WorkspaceRunStatus> {
  return { errorCode: failure.code, message: failure.message };
}

function stripUndefined(status: WorkspaceRunStatus): WorkspaceRunStatus {
  return Object.fromEntries(
    Object.entries(status).filter((entry: [string, unknown]) => entry[1] !== undefined),
  ) as WorkspaceRunStatus;
}

/** Preferred access path first, then the rest in discovery order (spec 03). */
export function orderedPaths(workspace: Workspace): AccessPath[] {
  const preferred = workspace.paths.find((p) => accessPathKey(p) === workspace.preferredPath);
  return preferred === undefined
    ? [...workspace.paths]
    : [preferred, ...workspace.paths.filter((p) => p !== preferred)];
}

/** Interleave tenants so one tenant with many workspaces doesn't go first (spec 04). */
export function roundRobinByTenant(ids: string[], tenantOf: (id: string) => string): string[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const tenant = tenantOf(id);
    const group = groups.get(tenant) ?? [];
    group.push(id);
    groups.set(tenant, group);
  }
  const lists = [...groups.values()];
  const result: string[] = [];
  for (let i = 0; result.length < ids.length; i++) {
    for (const list of lists) {
      const id = list[i];
      if (id !== undefined) result.push(id);
    }
  }
  return result;
}

/** The render spec most workspaces agree on (spec 04). */
export function mostCommonRender(renders: (RenderSpec | undefined)[]): RenderSpec | undefined {
  const counts = new Map<string, { spec: RenderSpec; count: number }>();
  for (const spec of renders) {
    if (spec === undefined) continue;
    const key = JSON.stringify(spec);
    const entry = counts.get(key) ?? { spec, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { spec: RenderSpec; count: number } | undefined;
  for (const entry of counts.values())
    if (best === undefined || entry.count > best.count) best = entry;
  return best?.spec;
}
