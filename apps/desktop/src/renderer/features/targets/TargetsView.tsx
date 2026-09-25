import { useEffect, useMemo, useRef, useState } from 'react';

import type { Workspace } from '../../../shared/workspaces/models';
import { executeCommand } from '../../platform/commands';
import { useSetting } from '../../platform/settings';
import { Codicon } from '../../workbench/common/Codicon';
import { reauthenticate, useAccounts } from '../accounts/accounts-store';
import { useNamer } from '../privacy/privacy';
import { useInventory } from '../workspaces/inventory-store';

import { selectGroup, setSelected, useTargets, visibleTargets } from './targets-store';
import './TargetsView.css';

function TriStateCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox targets-checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    />
  );
}

/** Targets view (spec 03): enabled workspaces as tenant → workspace, with checkboxes. */
export function TargetsView(): React.JSX.Element {
  const { inventory, groups } = useInventory();
  const { selected, groupId } = useTargets();
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const groupBySubscription = useSetting('targets.groupBySubscription');
  const namer = useNamer();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // (account, tenant) pairs that need sign-in.
  const needsReauth = useMemo(() => {
    const pairs = new Set<string>();
    for (const account of accounts) {
      for (const tenant of account.tenants) {
        if (tenant.state === 'needsReauth') pairs.add(`${account.id}|${tenant.tenantId}`);
      }
    }
    return pairs;
  }, [accounts]);

  const visible = useMemo(
    () => visibleTargets(groupId, { inventory, groups }),
    [inventory, groupId, groups],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return visible;
    return visible.filter((w) =>
      [namer.workspace(w), namer.tenant(w.tenantId), namer.subscription(w)].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    );
  }, [visible, query, namer]);

  const byTenant = useMemo(() => {
    const map = new Map<string, Workspace[]>();
    for (const workspace of filtered) {
      const list = map.get(workspace.tenantId) ?? [];
      list.push(workspace);
      map.set(workspace.tenantId, list);
    }
    return [...map.entries()]
      .map(([tenantId, workspaces]) => ({
        tenantId,
        name: namer.tenant(tenantId),
        workspaces: workspaces.sort((a, b) => namer.workspace(a).localeCompare(namer.workspace(b))),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, namer]);

  if (accounts.length === 0 && inventory.workspaces.length === 0) {
    return (
      <div className="welcome-view">
        <p>Targets are the Log Analytics workspaces a query runs against.</p>
        <p>Add an account to discover the workspaces it can reach.</p>
        <button
          type="button"
          className="button button-primary welcome-view-button"
          onClick={() => void executeCommand('accounts.add')}
        >
          Add Account
        </button>
        <button
          type="button"
          className="button button-secondary welcome-view-button"
          onClick={() => void executeCommand('workbench.action.restartInDemoMode')}
        >
          Explore with Demo Data
        </button>
      </div>
    );
  }

  const workspaceNeedsReauth = (w: Workspace): boolean =>
    w.paths.length > 0 &&
    w.paths.every((p) => needsReauth.has(`${p.accountId}|${p.authorityTenantId}`));
  const tenantNeedsReauth = (tenantId: string): { accountId: string } | undefined => {
    const account = accounts.find((a) =>
      a.tenants.some((t) => t.tenantId === tenantId && t.state === 'needsReauth'),
    );
    return account === undefined ? undefined : { accountId: account.id };
  };

  const selectedCount = visible.filter((w) => selected.has(w.resourceId)).length;

  return (
    <div className="targets-view">
      <div className="targets-controls">
        <select
          className="dropdown targets-group"
          aria-label="Group"
          value={groupId ?? ''}
          onChange={(event) => {
            selectGroup(event.target.value === '' ? undefined : event.target.value);
          }}
        >
          <option value="">All enabled</option>
          {groups.groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <input
          className="input targets-search"
          type="search"
          placeholder="Search workspaces"
          aria-label="Search workspaces"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <div className="targets-summary" aria-live="polite">
          {selectedCount} of {visible.length} selected
          {inventory.refreshing ? (
            <span className="targets-refreshing">
              <Codicon name="loading" className="codicon-modifier-spin" /> Discovering…
            </span>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="welcome-view">
          <p>
            {inventory.refreshing
              ? 'Discovering workspaces…'
              : groupId === undefined
                ? 'No enabled workspaces. Choose which workspaces appear here in Workspaces settings.'
                : 'No enabled workspaces match this group.'}
          </p>
          <button
            type="button"
            className="button button-secondary welcome-view-button"
            onClick={() => void executeCommand('workbench.action.openWorkspacesSettings')}
          >
            Open Workspaces Settings
          </button>
        </div>
      ) : (
        <div className="targets-tree" role="tree" aria-label="Targets" aria-multiselectable="true">
          {byTenant.map(({ tenantId, name, workspaces }) => {
            const ids = workspaces.map((w) => w.resourceId);
            const count = ids.filter((id) => selected.has(id)).length;
            const isCollapsed = collapsed.has(tenantId);
            const reauth = tenantNeedsReauth(tenantId);
            return (
              <div key={tenantId} role="none">
                <div
                  className="targets-row tenant"
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={!isCollapsed}
                  aria-selected={count === ids.length}
                  aria-label={name}
                  tabIndex={0}
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (isCollapsed) next.delete(tenantId);
                    else next.add(tenantId);
                    setCollapsed(next);
                  }}
                >
                  <Codicon
                    name={isCollapsed ? 'chevron-right' : 'chevron-down'}
                    className="twistie"
                  />
                  <TriStateCheckbox
                    label={`Select all workspaces in ${name}`}
                    checked={count === ids.length}
                    indeterminate={count > 0 && count < ids.length}
                    onChange={(checked) => {
                      setSelected(ids, checked);
                    }}
                  />
                  <span className="targets-label">{name}</span>
                  <span className="targets-description">{ids.length}</span>
                  {reauth === undefined ? null : (
                    <>
                      <Codicon name="warning" className="targets-warning" title="Needs sign-in" />
                      <button
                        type="button"
                        className="link-button targets-signin"
                        onClick={(event) => {
                          event.stopPropagation();
                          void reauthenticate(reauth.accountId, tenantId);
                        }}
                      >
                        Sign in
                      </button>
                    </>
                  )}
                </div>
                {isCollapsed
                  ? null
                  : workspaces.map((workspace, index) => {
                      const subscription = namer.subscription(workspace);
                      const showSubscriptionHeader =
                        groupBySubscription &&
                        (index === 0 ||
                          workspaces[index - 1]?.subscriptionId !== workspace.subscriptionId);
                      return (
                        <div key={workspace.resourceId} role="none">
                          {showSubscriptionHeader ? (
                            <div className="targets-row subscription" role="presentation">
                              <Codicon name="key" />{' '}
                              <span className="targets-label">{subscription}</span>
                            </div>
                          ) : null}
                          <label
                            className={`targets-row workspace${groupBySubscription ? ' nested' : ''}`}
                            role="treeitem"
                            aria-level={2}
                            aria-selected={selected.has(workspace.resourceId)}
                            title={namer.active ? undefined : workspace.resourceId}
                          >
                            <input
                              type="checkbox"
                              className="checkbox targets-checkbox"
                              checked={selected.has(workspace.resourceId)}
                              onChange={(event) => {
                                setSelected([workspace.resourceId], event.target.checked);
                              }}
                            />
                            <span className="targets-label">{namer.workspace(workspace)}</span>
                            {workspace.sentinel ? (
                              <Codicon
                                name="shield"
                                className="targets-sentinel"
                                title="Microsoft Sentinel"
                              />
                            ) : null}
                            {groupBySubscription ? null : (
                              <span className="targets-description">{subscription}</span>
                            )}
                            {workspaceNeedsReauth(workspace) ? (
                              <Codicon
                                name="warning"
                                className="targets-warning"
                                title="Needs sign-in"
                              />
                            ) : null}
                          </label>
                        </div>
                      );
                    })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
