import { useState } from 'react';

import type { Account, TenantInfo } from '../../../shared/auth/models';
import { executeCommand } from '../../platform/commands';
import { updateSetting, useSetting } from '../../platform/settings';
import { getBridge } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';
import { useNamer } from '../privacy/privacy';

import { accountName, reauthenticate, useAccounts } from './accounts-store';
import './AccountsView.css';

const STATE_ICON: Record<TenantInfo['state'], { icon: string; label: string }> = {
  ok: { icon: 'pass', label: 'Signed in' },
  needsReauth: { icon: 'warning', label: 'Needs sign-in' },
  noAccess: { icon: 'circle-slash', label: 'No Azure access' },
  unknown: { icon: 'circle-large-outline', label: 'Not checked yet' },
};

const RELATION: Record<TenantInfo['relation'], string> = {
  home: 'home',
  guest: 'guest',
  lighthouse: 'Lighthouse',
};

const PROVIDER: Record<Account['provider'], string> = {
  builtin: 'Microsoft',
  custom: 'custom client ID',
  azureCli: 'Azure CLI',
  demo: 'demo',
};

function TenantRow({
  account,
  tenant,
}: {
  account: Account;
  tenant: TenantInfo;
}): React.JSX.Element {
  const state = STATE_ICON[tenant.state];
  const signingIn = useAccounts((s) => s.signingIn);
  const namer = useNamer();
  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={false}
      className={`accounts-row tenant-row state-${tenant.state}`}
      title={
        namer.active ? tenant.detail : [tenant.tenantId, tenant.detail].filter(Boolean).join('\n')
      }
    >
      <Codicon
        name={tenant.state === 'unknown' && account.refreshing ? 'loading' : state.icon}
        className={`tenant-state${tenant.state === 'unknown' && account.refreshing ? ' codicon-modifier-spin' : ''}`}
        title={state.label}
      />
      <span className="accounts-label">{namer.tenant(tenant.tenantId, tenant)}</span>
      <span className="accounts-description">{RELATION[tenant.relation]}</span>
      {tenant.state === 'needsReauth' ? (
        <button
          type="button"
          className="link-button accounts-signin"
          disabled={signingIn}
          onClick={() => void reauthenticate(account.id, tenant.tenantId)}
        >
          Sign in
        </button>
      ) : null}
    </div>
  );
}

function AccountRow({ account }: { account: Account }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const showNoAccess = useSetting('accounts.showTenantsWithoutAccess');
  const tenants = account.tenants.filter((t) => showNoAccess || t.state !== 'noAccess');
  const hidden = account.tenants.length - tenants.length;
  const namer = useNamer();
  const name = namer.account(account.id, accountName(account));
  return (
    <div role="none">
      <div
        role="treeitem"
        aria-level={1}
        aria-expanded={expanded}
        aria-selected={false}
        aria-label={name}
        tabIndex={0}
        className="accounts-row account-row"
        onClick={() => {
          setExpanded(!expanded);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setExpanded(!expanded);
          if (event.key === 'ArrowRight') setExpanded(true);
          if (event.key === 'ArrowLeft') setExpanded(false);
        }}
      >
        <Codicon name={expanded ? 'chevron-down' : 'chevron-right'} className="twistie" />
        <Codicon name="account" />
        <span className="accounts-label">{name}</span>
        <span className="accounts-description">
          {account.label === undefined || namer.active
            ? PROVIDER[account.provider]
            : `${account.username} · ${PROVIDER[account.provider]}`}
        </span>
        <span
          className="accounts-actions"
          onClick={(event) => {
            event.stopPropagation();
          }}
          role="toolbar"
        >
          <button
            type="button"
            className="action-item"
            title="Refresh"
            aria-label={`Refresh ${name}`}
            onClick={() => void executeCommand('accounts.refresh', account.id)}
          >
            <Codicon name="refresh" />
          </button>
          <button
            type="button"
            className="action-item"
            title="Set Label"
            aria-label={`Set label for ${name}`}
            onClick={() => void executeCommand('accounts.rename', account.id)}
          >
            <Codicon name="edit" />
          </button>
          <button
            type="button"
            className="action-item"
            title="Sign Out"
            aria-label={`Sign out ${name}`}
            onClick={() => void executeCommand('accounts.signOut', account.id)}
          >
            <Codicon name="sign-out" />
          </button>
        </span>
      </div>
      {expanded ? (
        <div role="group">
          {tenants.map((tenant) => (
            <TenantRow key={tenant.tenantId} account={account} tenant={tenant} />
          ))}
          {hidden > 0 ? (
            <div className="accounts-row tenant-row accounts-hidden-note" role="none">
              {hidden} tenant{hidden === 1 ? '' : 's'} without Azure access hidden
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Accounts view (spec 02, "Accounts UI"). */
export function AccountsView(): React.JSX.Element {
  const { snapshot, signingIn } = useAccounts();

  if (snapshot.accounts.length === 0) {
    return (
      <div className="welcome-view">
        {snapshot.persistence === 'unavailable' ? (
          <>
            <p>
              No OS keyring is available, so sign-ins can’t be stored securely. Install and unlock
              GNOME Keyring or KWallet (with libsecret) and restart, or sign in for this session
              only.
            </p>
            <button
              type="button"
              className="button button-secondary welcome-view-button"
              onClick={() =>
                void updateSetting('auth.sessionOnly', true).then(() =>
                  getBridge().app.relaunch({ demo: false }),
                )
              }
            >
              Use Session-Only Sign-In (Restart)
            </button>
          </>
        ) : null}
        <p>Sign in to see the tenants and Log Analytics workspaces your account can reach.</p>
        <button
          type="button"
          className="button button-primary welcome-view-button"
          disabled={signingIn}
          onClick={() => void executeCommand('accounts.add')}
        >
          {signingIn ? 'Signing in…' : 'Add Account'}
        </button>
        <p>
          Raml KQL signs in with your own identity and only does what your account is allowed to do.
          Tokens stay on this computer.
        </p>
      </div>
    );
  }

  return (
    <div className="accounts-view" role="tree" aria-label="Accounts">
      {snapshot.accounts.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
      {snapshot.persistence === 'sessionOnly' ? (
        <p className="accounts-footnote">
          <Codicon name="info" /> Session-only sign-in: you’ll sign in again after a restart.
        </p>
      ) : null}
    </div>
  );
}
