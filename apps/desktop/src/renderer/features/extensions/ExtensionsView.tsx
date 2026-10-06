import { useEffect, useState } from 'react';

import type { ExtensionInfo, Grant } from '../../../shared/extensions/models';
import { executeCommand } from '../../platform/commands';
import { Codicon } from '../../workbench/common/Codicon';

import {
  PermissionList,
  revokeGrant,
  setExtensionEnabled,
  uninstallExtension,
  updateExtension,
} from './extension-commands';
import { loadExtensions, useExtensions } from './extensions-store';

import './ExtensionsView.css';

const STATE_LABEL: Record<ExtensionInfo['state'], string> = {
  disabled: 'Disabled',
  inactive: 'Not running',
  starting: 'Starting…',
  active: 'Running',
  failed: 'Failed',
};

const SCOPE_LABEL: Record<Grant['scope'], string> = {
  run: 'this run',
  session: 'this session',
  always: 'always',
};

function ExtensionItem({
  extension,
  grants,
}: {
  extension: ExtensionInfo;
  grants: Grant[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className={`extension-item${extension.enabled ? '' : ' disabled'}`}>
      <button
        type="button"
        className="extension-header"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} />
        <span className="extension-name">{extension.displayName}</span>
        <span className="extension-version">{extension.version}</span>
        <span className={`extension-state state-${extension.state}`}>
          {STATE_LABEL[extension.state]}
        </span>
      </button>
      {extension.description === undefined ? null : (
        <p className="extension-description">{extension.description}</p>
      )}
      {open ? (
        <div className="extension-details">
          <p className="extension-meta">
            {extension.id} ·{' '}
            {extension.source.type === 'file'
              ? `from ${extension.source.name}`
              : extension.source.type === 'git'
                ? `${extension.source.url} ${extension.source.tag}`
                : `development: ${extension.source.path}`}
          </p>
          {extension.verified ? (
            <p className="extension-verified">
              <Codicon name="verified-filled" /> Verified by {extension.verifiedBy ?? 'Raml KQL'}
            </p>
          ) : (
            <p className="extension-unverified">
              <Codicon name="warning" /> Not verified by Raml KQL.
            </p>
          )}
          {extension.error === undefined ? null : (
            <p className="extension-error" role="alert">
              {extension.error}
            </p>
          )}
          <h4>Permissions</h4>
          <PermissionList permissions={extension.permissions} />
          <h4>Granted</h4>
          {grants.length === 0 ? (
            <p className="extension-meta">Nothing granted beyond low-risk permissions.</p>
          ) : (
            <ul className="extension-grants" aria-label={`Grants of ${extension.displayName}`}>
              {grants.map((grant) => (
                <li key={`${grant.permission}-${grant.scope}`}>
                  <span>
                    {grant.permission}
                    {grant.hosts === undefined ? '' : ` (${grant.hosts.join(', ')})`} ·{' '}
                    {SCOPE_LABEL[grant.scope]} · since {new Date(grant.grantedAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void revokeGrant(extension.id, grant.permission)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="extension-actions">
            {extension.update === undefined ? null : (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void updateExtension(extension.id)}
              >
                Update to {extension.update.version}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void setExtensionEnabled(extension.id, !extension.enabled)}
            >
              {extension.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void uninstallExtension(extension.id, extension.displayName)}
            >
              Uninstall
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The Extensions view (spec 07): installed extensions, their state, permissions and grants. */
export function ExtensionsView(): React.JSX.Element {
  const { snapshot, loaded } = useExtensions();
  useEffect(() => {
    if (!loaded) void loadExtensions();
  }, [loaded]);

  if (loaded && snapshot.extensions.length === 0) {
    return (
      <div className="welcome-view">
        <p>
          Extensions add commands, enrichers, result views and themes. They run sandboxed and ask
          before they use the network or your results.
        </p>
        <button
          type="button"
          className="button button-primary welcome-view-button"
          onClick={() => void executeCommand('extensions.installFromFile')}
        >
          Install from File…
        </button>
        <button
          type="button"
          className="button button-secondary welcome-view-button"
          onClick={() => void executeCommand('extensions.installFromGit')}
        >
          Install from Git URL…
        </button>
      </div>
    );
  }
  return (
    <ul className="extensions-list" aria-label="Installed extensions">
      {snapshot.extensions.map((extension) => (
        <ExtensionItem
          key={extension.id}
          extension={extension}
          grants={snapshot.grants.filter((g) => g.extensionId === extension.id)}
        />
      ))}
    </ul>
  );
}
