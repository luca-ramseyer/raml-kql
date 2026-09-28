import { create } from 'zustand';

import { AppError } from '../../../shared/errors';
import type { QueryRunRequest, RunSnapshot, WorkspaceRunState } from '../../../shared/query/models';
import { showPanelTab, togglePanel } from '../../platform/layout';
import { dismissNotification, notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';

/**
 * Query runs per tab (spec 04). Holds run snapshots only (states, counts, table shapes);
 * result rows stay in the main process and are paged in by the results view.
 */
interface RunsState {
  byTab: Record<string, RunSnapshot>;
}

export const useRuns = create<RunsState>(() => ({ byTab: {} }));

/** The fail-fast prompt shown per run, so it appears once. */
const failFastPrompts = new Map<string, number>();

export function applyRunSnapshot(snapshot: RunSnapshot): void {
  const current = useRuns.getState().byTab[snapshot.tabId];
  // Ignore late events of a run the tab has already replaced.
  if (
    current !== undefined &&
    current.runId !== snapshot.runId &&
    current.startedAt > snapshot.startedAt
  ) {
    return;
  }
  useRuns.setState((state) => ({ byTab: { ...state.byTab, [snapshot.tabId]: snapshot } }));
  promptFailFast(snapshot);
}

function promptFailFast(snapshot: RunSnapshot): void {
  if (snapshot.failFast === undefined) {
    const id = failFastPrompts.get(snapshot.runId);
    if (id !== undefined) dismissNotification(id);
    failFastPrompts.delete(snapshot.runId);
    return;
  }
  if (failFastPrompts.has(snapshot.runId)) return;
  const skipped = snapshot.workspaces.filter((w) => w.errorCode === 'FAIL_FAST').length;
  failFastPrompts.set(
    snapshot.runId,
    notify({
      severity: 'error',
      message: `Query has an error — run on the remaining ${String(skipped)} workspace${skipped === 1 ? '' : 's'} anyway?`,
      detail: snapshot.failFast.message,
      source: 'Query',
      actions: [
        {
          label: 'Run Anyway',
          run: () => void rerunTab(snapshot.tabId, ['skipped']),
        },
        {
          label: 'Show Run',
          run: () => {
            togglePanel(true);
            showPanelTab('run');
          },
        },
      ],
    }),
  );
}

function reportError(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Query',
  });
}

export async function startRun(request: QueryRunRequest): Promise<void> {
  try {
    applyRunSnapshot(await unwrap(getBridge().query.run(request)));
  } catch (error) {
    reportError(error, 'The query could not be started.');
  }
}

export async function cancelTabRun(tabId: string): Promise<void> {
  const run = useRuns.getState().byTab[tabId];
  if (run === undefined || run.state !== 'running') return;
  try {
    const snapshot = await unwrap(getBridge().query.cancel({ runId: run.runId }));
    if (snapshot !== null) applyRunSnapshot(snapshot);
  } catch (error) {
    reportError(error, 'The query could not be cancelled.');
  }
}

export async function rerunTab(
  tabId: string,
  states: WorkspaceRunState[],
  timeoutSeconds?: number,
): Promise<void> {
  const run = useRuns.getState().byTab[tabId];
  if (run === undefined) return;
  try {
    const snapshot = await unwrap(
      getBridge().query.rerun({
        runId: run.runId,
        states,
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      }),
    );
    if (snapshot !== null) applyRunSnapshot(snapshot);
  } catch (error) {
    reportError(error, 'The workspaces could not be run again.');
  }
}

/** The tab closed: free its results in the main process. */
export function forgetTabRun(tabId: string): void {
  const run = useRuns.getState().byTab[tabId];
  if (run === undefined) return;
  useRuns.setState((state) => {
    const { [tabId]: _removed, ...byTab } = state.byTab;
    return { byTab };
  });
  void unwrap(getBridge().query.delete({ runId: run.runId })).catch(() => undefined);
}

export async function clearAllResults(): Promise<void> {
  useRuns.setState({ byTab: {} });
  try {
    await unwrap(getBridge().query.deleteAll());
  } catch (error) {
    reportError(error, 'Results could not be cleared.');
  }
}

export interface RunCounts {
  succeeded: number;
  partial: number;
  failed: number;
  timeout: number;
  cancelled: number;
  skipped: number;
  pending: number;
  rows: number;
}

export function runCounts(run: RunSnapshot): RunCounts {
  const counts: RunCounts = {
    succeeded: 0,
    partial: 0,
    failed: 0,
    timeout: 0,
    cancelled: 0,
    skipped: 0,
    pending: 0,
    rows: 0,
  };
  for (const workspace of run.workspaces) {
    counts.rows += workspace.rows;
    switch (workspace.state) {
      case 'queued':
      case 'running':
      case 'retrying':
        counts.pending += 1;
        break;
      default:
        counts[workspace.state] += 1;
    }
  }
  return counts;
}

/** `mm:ss` (or `h:mm:ss`) between two instants. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`;
}

/** "38 ✓ · 2 partial · 1 failed · 00:14" (spec 04, "Run status panel"). */
export function runSummaryText(run: RunSnapshot, now: number = Date.now()): string {
  const counts = runCounts(run);
  const parts = [`${String(counts.succeeded)} ✓`];
  if (counts.partial > 0) parts.push(`${String(counts.partial)} partial`);
  if (counts.failed > 0) parts.push(`${String(counts.failed)} failed`);
  if (counts.timeout > 0) parts.push(`${String(counts.timeout)} timed out`);
  if (counts.skipped > 0) parts.push(`${String(counts.skipped)} skipped`);
  if (counts.cancelled > 0) parts.push(`${String(counts.cancelled)} cancelled`);
  if (counts.pending > 0) parts.push(`${String(counts.pending)} running`);
  const end = run.finishedAt === undefined ? now : Date.parse(run.finishedAt);
  parts.push(formatElapsed(end - Date.parse(run.startedAt)));
  return parts.join(' · ');
}

/** For tests. */
export function resetRuns(): void {
  useRuns.setState({ byTab: {} });
  failFastPrompts.clear();
}
