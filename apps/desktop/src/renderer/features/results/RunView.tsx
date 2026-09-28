import { useEffect, useState } from 'react';

import type { WorkspaceRunState, WorkspaceRunStatus } from '../../../shared/query/models';
import { executeCommand } from '../../platform/commands';
import { getBridge, unwrap } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';
import { useAccounts } from '../accounts/accounts-store';
import { useNamer } from '../privacy/privacy';
import { runCounts, runSummaryText } from '../query/run-store';
import { useInventory } from '../workspaces/inventory-store';

import { useActiveRun } from './active-run';

import './results.css';

const STATE_ICON: Record<WorkspaceRunState, { icon: string; className: string; label: string }> = {
  queued: { icon: 'circle-large-outline', className: 'state-pending', label: 'Queued' },
  running: { icon: 'loading', className: 'state-pending codicon-modifier-spin', label: 'Running' },
  retrying: { icon: 'sync', className: 'state-warning codicon-modifier-spin', label: 'Retrying' },
  succeeded: { icon: 'pass', className: 'state-ok', label: 'Succeeded' },
  partial: { icon: 'warning', className: 'state-warning', label: 'Partial' },
  failed: { icon: 'error', className: 'state-error', label: 'Failed' },
  timeout: { icon: 'watch', className: 'state-error', label: 'Timed out' },
  cancelled: { icon: 'circle-slash', className: 'state-pending', label: 'Cancelled' },
  skipped: { icon: 'debug-step-over', className: 'state-pending', label: 'Skipped' },
};

/** Re-render every second while a run is going, for the elapsed time. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

function WorkspaceRow({ status }: { status: WorkspaceRunStatus }): React.JSX.Element {
  const namer = useNamer();
  const workspace = useInventory((s) =>
    s.inventory.workspaces.find((w) => w.resourceId === status.resourceId),
  );
  const accountName = useAccountName(status.accountId);
  const state = STATE_ICON[status.state];
  const needsSignIn =
    status.errorCode === 'AUTH_INTERACTION_REQUIRED' && status.accountId !== undefined;
  return (
    <tr>
      <td>{namer.tenant(status.tenantId)}</td>
      <td>{workspace === undefined ? 'Unlisted workspace' : namer.workspace(workspace)}</td>
      <td>{accountName}</td>
      <td>
        <span className="run-state">
          <Codicon name={state.icon} className={state.className} />
          {state.label}
        </span>
      </td>
      <td className="numeric">{status.rows.toLocaleString()}</td>
      <td className="numeric">
        {status.durationMs === undefined ? '' : `${(status.durationMs / 1000).toFixed(1)} s`}
      </td>
      <td className="numeric">{status.attempts}</td>
      <td className="run-message" title={status.message}>
        {status.message ?? ''}
      </td>
      <td className="run-actions">
        {needsSignIn ? (
          <button
            type="button"
            className="link-button"
            onClick={() =>
              void executeCommand('accounts.reauthenticate', status.accountId, status.tenantId)
            }
          >
            Sign in
          </button>
        ) : null}
        {status.message !== undefined && status.state !== 'succeeded' ? (
          <button
            type="button"
            className="action-item"
            title="Copy Error"
            aria-label="Copy error"
            onClick={() =>
              void unwrap(getBridge().shell.writeClipboard({ text: status.message ?? '' }))
            }
          >
            <Codicon name="copy" />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function useAccountName(accountId: string | undefined): string {
  const namer = useNamer();
  const account = useAccounts((s) => s.snapshot.accounts.find((a) => a.id === accountId));
  if (accountId === undefined) return '';
  return namer.account(accountId, account?.label ?? account?.username ?? 'Signed-out account');
}

/** Per-workspace status of the active tab's run (spec 04, "Run status panel"). */
export function RunView(): React.JSX.Element {
  const { run } = useActiveRun();
  const now = useTicker(run?.state === 'running');
  if (run === undefined) {
    return <p className="panel-empty">Per-workspace status of the latest run appears here.</p>;
  }
  const counts = runCounts(run);
  const canRerunFailed = counts.failed > 0;
  return (
    <div className="run-view">
      <div className="results-bar">
        <span className="run-summary" role="status">
          {runSummaryText(run, now)}
        </span>
        <span className="results-bar-spacer" />
        {run.state === 'running' ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void executeCommand('query.cancel')}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          disabled={!canRerunFailed || run.state === 'running'}
          onClick={() => void executeCommand('query.rerunFailed')}
        >
          Re-run Failed
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={counts.failed + counts.timeout === 0 || run.state === 'running'}
          onClick={() => void executeCommand('query.rerunFailedLongerTimeout')}
        >
          Re-run Failed + Timed Out (Longer Timeout)
        </button>
      </div>
      <div className="results-scroll">
        <table className="results-table run-table" aria-label="Workspace status">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Workspace</th>
              <th>Account</th>
              <th>State</th>
              <th className="numeric">Rows</th>
              <th className="numeric">Duration</th>
              <th className="numeric">Attempts</th>
              <th>Message</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {run.workspaces.map((status) => (
              <WorkspaceRow key={status.resourceId} status={status} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
