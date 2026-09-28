import { useMemo, useState } from 'react';

import { resolveGroup, type Group } from '../../../shared/workspaces/groups';
import { accessPathKey, type Workspace } from '../../../shared/workspaces/models';
import { executeCommand } from '../../platform/commands';
import { showInputBox } from '../../platform/quickinput/quick-input';
import { getBridge } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';
import { accountName, useAccounts } from '../accounts/accounts-store';
import { useNamer } from '../privacy/privacy';

import {
  deleteGroup,
  refreshInventory,
  saveGroup,
  updateTenant,
  updateWorkspaces,
  useInventory,
} from './inventory-store';
import './WorkspacesEditor.css';

const VIA_LABEL = {
  home: 'home',
  lighthouse: 'Lighthouse',
  guest: 'guest',
  azureCli: 'Azure CLI',
} as const;

function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  ].slice(0, 50);
}

function portalUrl(workspace: Workspace): string {
  return `https://portal.azure.com/#@${workspace.tenantId}/resource${workspace.resourceId}/overview`;
}

function editAlias(
  current: string | undefined,
  what: string,
  save: (alias: string | null) => void,
): void {
  showInputBox({
    placeholder: `Alias for this ${what}`,
    prompt: `Shown instead of the real name while aliasing is on (leave empty for the automatic alias)`,
    value: current ?? '',
    validate: (value) => (value.length > 200 ? 'Keep it under 200 characters.' : undefined),
    onAccept: (value) => {
      save(value.trim() === '' ? null : value);
    },
  });
}

function editTags(current: string[], save: (tags: string[]) => void): void {
  showInputBox({
    placeholder: 'Tags, comma separated (e.g. bank, ch, tier1)',
    prompt: 'Tags are used by dynamic groups',
    value: current.join(', '),
    onAccept: (value) => {
      save(parseTags(value));
    },
  });
}

function WorkspaceRow({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const namer = useNamer();
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const preferred =
    workspace.preferredPath ??
    (workspace.paths[0] === undefined ? '' : accessPathKey(workspace.paths[0]));
  return (
    <div
      className={`ws-row workspace${workspace.missing ? ' missing' : ''}`}
      role="treeitem"
      aria-level={4}
      aria-label={namer.workspace(workspace)}
    >
      <input
        type="checkbox"
        className="checkbox"
        aria-label={`Enable ${namer.workspace(workspace)}`}
        checked={workspace.enabled}
        disabled={workspace.missing}
        onChange={(event) =>
          void updateWorkspaces({
            resourceIds: [workspace.resourceId],
            enabled: event.target.checked,
          })
        }
      />
      <span className="ws-name">{namer.workspace(workspace)}</span>
      {workspace.sentinel ? (
        <span className="ws-badge">
          <Codicon name="shield" /> Sentinel
        </span>
      ) : null}
      <span className="ws-meta">{workspace.location}</span>
      {workspace.tags.length > 0 ? (
        <span className="ws-tags">{workspace.tags.join(', ')}</span>
      ) : null}
      {workspace.missing ? <span className="ws-badge missing">missing</span> : null}
      {workspace.paths.length > 1 ? (
        <select
          className="dropdown ws-path"
          aria-label="Preferred access path"
          value={preferred}
          onChange={(event) =>
            void updateWorkspaces({
              resourceIds: [workspace.resourceId],
              preferredPath: event.target.value,
            })
          }
        >
          {workspace.paths.map((path) => {
            const account = accounts.find((a) => a.id === path.accountId);
            const label =
              account === undefined
                ? path.accountId
                : namer.account(account.id, accountName(account));
            return (
              <option key={accessPathKey(path)} value={accessPathKey(path)}>
                via {label} ({VIA_LABEL[path.via]})
              </option>
            );
          })}
        </select>
      ) : null}
      <span className="ws-actions">
        <button
          type="button"
          className="action-item"
          title="Set Alias"
          aria-label={`Set alias for ${namer.workspace(workspace)}`}
          onClick={() => {
            editAlias(
              workspace.alias,
              'workspace',
              (alias) => void updateWorkspaces({ resourceIds: [workspace.resourceId], alias }),
            );
          }}
        >
          <Codicon name="edit" />
        </button>
        <button
          type="button"
          className="action-item"
          title="Edit Tags"
          aria-label={`Edit tags for ${namer.workspace(workspace)}`}
          onClick={() => {
            editTags(
              workspace.tags,
              (tags) => void updateWorkspaces({ resourceIds: [workspace.resourceId], tags }),
            );
          }}
        >
          <Codicon name="tag" />
        </button>
        <button
          type="button"
          className="action-item"
          title="Copy Resource ID"
          aria-label="Copy resource ID"
          onClick={() => void getBridge().shell.writeClipboard({ text: workspace.resourceId })}
        >
          <Codicon name="copy" />
        </button>
        <button
          type="button"
          className="action-item"
          title="Open in Azure Portal"
          aria-label="Open in Azure portal"
          onClick={() => void getBridge().shell.openExternal({ url: portalUrl(workspace) })}
        >
          <Codicon name="link-external" />
        </button>
        {workspace.missing ? (
          <button
            type="button"
            className="action-item"
            title="Remove"
            aria-label="Remove missing workspace"
            onClick={() =>
              void updateWorkspaces({ resourceIds: [workspace.resourceId], remove: true })
            }
          >
            <Codicon name="trash" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

function BulkButtons({ ids, label }: { ids: string[]; label: string }): React.JSX.Element {
  return (
    <span className="ws-actions">
      <button
        type="button"
        className="action-item"
        title={`Enable all in ${label}`}
        aria-label={`Enable all in ${label}`}
        onClick={() => void updateWorkspaces({ resourceIds: ids, enabled: true })}
      >
        <Codicon name="check-all" />
      </button>
      <button
        type="button"
        className="action-item"
        title={`Disable all in ${label}`}
        aria-label={`Disable all in ${label}`}
        onClick={() => void updateWorkspaces({ resourceIds: ids, enabled: false })}
      >
        <Codicon name="circle-slash" />
      </button>
    </span>
  );
}

function SubscriptionRows({ workspaces }: { workspaces: Workspace[] }): React.JSX.Element | null {
  const namer = useNamer();
  const [first] = workspaces;
  if (first === undefined) return null;
  const name = namer.subscription(first);
  return (
    <div role="none">
      <div className="ws-row subscription" role="treeitem" aria-level={3} aria-label={name}>
        <Codicon name="key" /> <span className="ws-name">{name}</span>
        <BulkButtons ids={workspaces.map((w) => w.resourceId)} label={name} />
      </div>
      {workspaces.map((workspace) => (
        <WorkspaceRow key={workspace.resourceId} workspace={workspace} />
      ))}
    </div>
  );
}

function GroupEditor({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [sentinel, setSentinel] = useState(false);
  const [tenantTags, setTenantTags] = useState('');
  const [workspaceTags, setWorkspaceTags] = useState('');
  const [nameRegex, setNameRegex] = useState('');
  const [mode, setMode] = useState<'all' | 'any'>('all');
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (
    <form
      className="group-form"
      aria-label="New dynamic group"
      onSubmit={(event) => {
        event.preventDefault();
        const match = {
          ...(sentinel ? { sentinel: true } : {}),
          ...(parseTags(tenantTags).length > 0 ? { tenantTags: parseTags(tenantTags) } : {}),
          ...(parseTags(workspaceTags).length > 0
            ? { workspaceTags: parseTags(workspaceTags) }
            : {}),
          ...(nameRegex.trim() !== '' ? { nameRegex: nameRegex.trim() } : {}),
          mode,
        };
        void saveGroup({
          id: id === '' ? 'group' : id,
          name: name.trim(),
          type: 'dynamic',
          match,
        }).then((ok) => {
          if (ok) onDone();
        });
      }}
    >
      <label>
        Name{' '}
        <input
          className="input"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label className="inline">
        <input
          type="checkbox"
          className="checkbox"
          checked={sentinel}
          onChange={(e) => {
            setSentinel(e.target.checked);
          }}
        />{' '}
        Only Sentinel workspaces
      </label>
      <label>
        Tenant tags{' '}
        <input
          className="input"
          placeholder="bank, ch"
          value={tenantTags}
          onChange={(e) => {
            setTenantTags(e.target.value);
          }}
        />
      </label>
      <label>
        Workspace tags{' '}
        <input
          className="input"
          value={workspaceTags}
          onChange={(e) => {
            setWorkspaceTags(e.target.value);
          }}
        />
      </label>
      <label>
        Name matches (regex){' '}
        <input
          className="input"
          placeholder="^la-.*-sentinel$"
          value={nameRegex}
          onChange={(e) => {
            setNameRegex(e.target.value);
          }}
        />
      </label>
      <label>
        Match
        <select
          className="dropdown"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value === 'any' ? 'any' : 'all');
          }}
        >
          <option value="all">all conditions</option>
          <option value="any">any condition</option>
        </select>
      </label>
      <div className="group-form-buttons">
        <button type="submit" className="button button-primary" disabled={name.trim() === ''}>
          Save Group
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function GroupsSection(): React.JSX.Element {
  const { inventory, groups } = useInventory();
  const [creating, setCreating] = useState(false);
  const describe = (group: Group): string =>
    group.type === 'static'
      ? `static · ${String(group.workspaces.length)} workspace${group.workspaces.length === 1 ? '' : 's'}`
      : `dynamic · ${
          Object.keys(group.match)
            .filter((k) => k !== 'mode')
            .join(', ') || 'everything'
        }`;
  return (
    <section className="ws-groups" aria-label="Groups">
      <div className="ws-section-header">
        <h3>Groups</h3>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setCreating(true);
          }}
        >
          New Dynamic Group…
        </button>
      </div>
      <p className="ws-hint">
        Static groups are saved from the Targets view (“Save Selection as Group…”). Groups only ever
        select enabled workspaces.
      </p>
      {creating ? (
        <GroupEditor
          onDone={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {groups.groups.length === 0 ? <p className="ws-hint">No groups yet.</p> : null}
      {groups.groups.map((group) => (
        <div key={group.id} className="ws-row group" role="group" aria-label={group.name}>
          <Codicon name={group.type === 'static' ? 'list-flat' : 'filter'} />
          <span className="ws-name">{group.name}</span>
          <span className="ws-meta">{describe(group)}</span>
          <span className="ws-meta">
            → {resolveGroup(group, inventory.workspaces, inventory.tenants).length} enabled
          </span>
          <span className="ws-actions">
            <button
              type="button"
              className="action-item"
              title="Delete Group"
              aria-label={`Delete group ${group.name}`}
              onClick={() => void deleteGroup(group.id)}
            >
              <Codicon name="trash" />
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

/** Settings → Workspaces (spec 03): which workspaces appear in Targets, aliases, tags, paths. */
export function WorkspacesEditor(): React.JSX.Element {
  const { inventory } = useInventory();
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const namer = useNamer();
  const [query, setQuery] = useState('');
  const [onlySentinel, setOnlySentinel] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inventory.workspaces.filter(
      (w) =>
        (!onlySentinel || w.sentinel) &&
        (needle === '' ||
          [
            namer.workspace(w),
            namer.tenant(w.tenantId),
            namer.subscription(w),
            w.location,
            ...w.tags,
          ].some((t) => t.toLowerCase().includes(needle))),
    );
  }, [inventory.workspaces, query, onlySentinel, namer]);

  // Account → tenant → subscription → workspaces, each workspace under its first access path.
  const tree = useMemo(() => {
    const byAccount = new Map<string, Map<string, Map<string, Workspace[]>>>();
    for (const workspace of filtered) {
      const accountId = workspace.paths[0]?.accountId ?? 'unknown';
      const tenants = byAccount.get(accountId) ?? new Map<string, Map<string, Workspace[]>>();
      const subs = tenants.get(workspace.tenantId) ?? new Map<string, Workspace[]>();
      subs.set(workspace.subscriptionId, [
        ...(subs.get(workspace.subscriptionId) ?? []),
        workspace,
      ]);
      tenants.set(workspace.tenantId, subs);
      byAccount.set(accountId, tenants);
    }
    return byAccount;
  }, [filtered]);

  const enabledCount = inventory.workspaces.filter((w) => w.enabled && !w.missing).length;
  const tenantOf = (id: string) => inventory.tenants.find((t) => t.tenantId === id);

  return (
    <div className="workspaces-editor">
      <div className="ws-header">
        <h2>Workspaces</h2>
        <p className="ws-hint">
          Choose which workspaces appear in the query view. Disabled workspaces are hidden from
          Targets.
        </p>
        <div className="ws-toolbar">
          <input
            className="input ws-search"
            type="search"
            placeholder="Search workspaces, tenants, tags"
            aria-label="Search workspaces"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <label className="inline">
            <input
              type="checkbox"
              className="checkbox"
              checked={onlySentinel}
              onChange={(e) => {
                setOnlySentinel(e.target.checked);
              }}
            />{' '}
            Only Sentinel
          </label>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void updateWorkspaces({
                resourceIds: filtered.map((w) => w.resourceId),
                enabled: true,
              })
            }
            disabled={filtered.length === 0}
          >
            Enable Shown
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void updateWorkspaces({
                resourceIds: filtered.map((w) => w.resourceId),
                enabled: false,
              })
            }
            disabled={filtered.length === 0}
          >
            Disable Shown
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void refreshInventory()}
            disabled={inventory.refreshing}
          >
            <Codicon
              name={inventory.refreshing ? 'loading' : 'refresh'}
              className={inventory.refreshing ? 'codicon-modifier-spin' : undefined}
            />
            &nbsp;Refresh
          </button>
        </div>
        <p className="ws-count" aria-live="polite">
          {enabledCount} of {inventory.workspaces.length} workspaces enabled
          {inventory.refreshedAt === undefined
            ? ''
            : ` · discovered ${new Date(inventory.refreshedAt).toLocaleString()}`}
        </p>
        {inventory.problems.length > 0 ? (
          <div className="ws-problems" role="alert">
            <Codicon name="warning" /> Discovery was incomplete: {inventory.problems.join(' · ')}
          </div>
        ) : null}
      </div>

      <div className="ws-tree" role="tree" aria-label="Workspaces">
        {inventory.workspaces.length === 0 ? (
          <div className="welcome-view">
            <p>
              {inventory.refreshing
                ? 'Discovering workspaces…'
                : 'No workspaces discovered yet. Add an account, then refresh.'}
            </p>
            <button
              type="button"
              className="button button-secondary welcome-view-button"
              onClick={() => void executeCommand('accounts.add')}
            >
              Add Account
            </button>
          </div>
        ) : null}
        {[...tree.entries()].map(([accountId, tenants]) => {
          const account = accounts.find((a) => a.id === accountId);
          const accountLabel =
            account === undefined
              ? 'Signed-out account'
              : namer.account(account.id, accountName(account));
          return (
            <div key={accountId} role="none">
              <div
                className="ws-row account"
                role="treeitem"
                aria-level={1}
                aria-label={accountLabel}
              >
                <Codicon name="account" /> <span className="ws-name">{accountLabel}</span>
                {account === undefined ? null : <span className="ws-meta">{account.provider}</span>}
              </div>
              {[...tenants.entries()].map(([tenantId, subs]) => {
                const tenant = tenantOf(tenantId);
                const tenantIds = [...subs.values()].flat().map((w) => w.resourceId);
                const via = [...subs.values()][0]?.[0]?.paths[0]?.via;
                return (
                  <div key={tenantId} role="none">
                    <div
                      className="ws-row tenant"
                      role="treeitem"
                      aria-level={2}
                      aria-label={namer.tenant(tenantId)}
                    >
                      <Codicon name="organization" />{' '}
                      <span className="ws-name">{namer.tenant(tenantId)}</span>
                      {via === undefined ? null : <span className="ws-meta">{VIA_LABEL[via]}</span>}
                      {tenant !== undefined && tenant.tags.length > 0 ? (
                        <span className="ws-tags">{tenant.tags.join(', ')}</span>
                      ) : null}
                      <span className="ws-actions">
                        <button
                          type="button"
                          className="action-item"
                          title="Set Tenant Alias"
                          aria-label={`Set alias for tenant ${namer.tenant(tenantId)}`}
                          onClick={() => {
                            editAlias(
                              tenant?.alias,
                              'tenant',
                              (alias) => void updateTenant({ tenantId, alias }),
                            );
                          }}
                        >
                          <Codicon name="edit" />
                        </button>
                        <button
                          type="button"
                          className="action-item"
                          title="Edit Tenant Tags"
                          aria-label={`Edit tags for tenant ${namer.tenant(tenantId)}`}
                          onClick={() => {
                            editTags(
                              tenant?.tags ?? [],
                              (tags) => void updateTenant({ tenantId, tags }),
                            );
                          }}
                        >
                          <Codicon name="tag" />
                        </button>
                      </span>
                      <BulkButtons ids={tenantIds} label={namer.tenant(tenantId)} />
                    </div>
                    {[...subs.entries()].map(([subscriptionId, workspaces]) => (
                      <SubscriptionRows key={subscriptionId} workspaces={workspaces} />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <GroupsSection />
    </div>
  );
}
