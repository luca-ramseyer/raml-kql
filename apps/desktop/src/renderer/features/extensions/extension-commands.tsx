import {
  permissionRisk,
  type PermissionDeclaration,
} from '@raml-kql/pack-schema/extension-manifest';

import type { InstallPreview } from '../../../shared/extensions/models';
import { registerCommand } from '../../platform/commands';
import { showDialog } from '../../platform/dialogs';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';

import { loadExtensions, reportExtensionError, setExtensionsSnapshot } from './extensions-store';

/** Installing and managing extensions (spec 07, "Distribution"). */
export function PermissionList({
  permissions,
}: {
  permissions: readonly PermissionDeclaration[];
}): React.JSX.Element {
  if (permissions.length === 0) return <p>No permissions requested.</p>;
  return (
    <ul className="extension-permissions">
      {permissions.map((permission) => {
        const risk = permissionRisk(permission.id);
        return (
          <li key={permission.id} className={`risk-${risk}`}>
            <Codicon name={risk === 'high' ? 'shield' : risk === 'medium' ? 'eye' : 'check'} />
            <span>
              <strong>{permission.id}</strong>
              {'hosts' in permission ? ` (${permission.hosts.join(', ')})` : ''} —{' '}
              {permission.reason}
              <span className="extension-risk"> · {risk} risk</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Show what will be installed; resolve true when the user chose Install. */
export async function confirmInstall(preview: InstallPreview): Promise<boolean> {
  const { extension, replaces, readme } = preview;
  const choice = await showDialog({
    severity: 'warning',
    label: `Install ${extension.displayName}`,
    message:
      replaces === undefined
        ? `Install ${extension.displayName} ${extension.version}?`
        : `Update ${extension.displayName} from ${replaces.version} to ${extension.version}?`,
    detail: (
      <div className="extension-install">
        <p className="extension-unverified">
          <Codicon name="warning" /> Not verified by Raml KQL — only install extensions you trust.
        </p>
        <p>
          {extension.id} · {extension.publisher}
          {extension.repository === undefined ? '' : ` · ${extension.repository}`}
        </p>
        {extension.description === undefined ? null : <p>{extension.description}</p>}
        <h3>Permissions</h3>
        <p>
          Installing grants none of the medium- or high-risk permissions: you are asked when they
          are used.
        </p>
        <PermissionList permissions={extension.permissions} />
        {replaces !== undefined && replaces.addedPermissions.length > 0 ? (
          <>
            <h3>New in this version</h3>
            <PermissionList permissions={replaces.addedPermissions} />
          </>
        ) : null}
        {readme === undefined ? null : (
          <>
            <h3>README</h3>
            <pre className="extension-readme">{readme}</pre>
          </>
        )}
      </div>
    ),
    buttons: [replaces === undefined ? 'Install' : 'Update', 'Cancel'],
    defaultButton: 1,
  });
  return choice === 0;
}

export async function installFromFile(): Promise<void> {
  try {
    const result = await unwrap(getBridge().extensions.installFromFile());
    if (result.type === 'cancelled') return;
    const { preview } = result;
    if (!(await confirmInstall(preview))) {
      await unwrap(getBridge().extensions.cancelInstall({ previewId: preview.previewId })).catch(
        () => undefined,
      );
      return;
    }
    setExtensionsSnapshot(
      await unwrap(getBridge().extensions.confirmInstall({ previewId: preview.previewId })),
    );
    notify({
      severity: 'info',
      message: `Installed ${preview.extension.displayName} ${preview.extension.version}.`,
      source: 'Extensions',
    });
  } catch (error) {
    reportExtensionError(error, 'The extension could not be installed.');
  }
}

export async function uninstallExtension(id: string, displayName: string): Promise<void> {
  const choice = await showDialog({
    severity: 'warning',
    message: `Uninstall ${displayName}?`,
    detail: 'Its files, stored data, secrets and permission grants are removed.',
    buttons: ['Uninstall', 'Cancel'],
    defaultButton: 1,
  });
  if (choice !== 0) return;
  try {
    setExtensionsSnapshot(await unwrap(getBridge().extensions.uninstall({ id })));
  } catch (error) {
    reportExtensionError(error, 'The extension could not be uninstalled.');
  }
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
  try {
    setExtensionsSnapshot(await unwrap(getBridge().extensions.setEnabled({ id, enabled })));
  } catch (error) {
    reportExtensionError(error, 'The extension could not be changed.');
  }
}

export async function revokeGrant(id: string, permission?: string): Promise<void> {
  try {
    setExtensionsSnapshot(
      await unwrap(
        getBridge().extensions.revoke({ id, ...(permission === undefined ? {} : { permission }) }),
      ),
    );
  } catch (error) {
    reportExtensionError(error, 'The permission could not be revoked.');
  }
}

export function registerExtensionCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'extensions.installFromFile',
      title: 'Install from File…',
      category: 'Extensions',
      icon: 'desktop-download',
      run: installFromFile,
    }),
    registerCommand({
      id: 'extensions.refresh',
      title: 'Refresh',
      category: 'Extensions',
      icon: 'refresh',
      run: loadExtensions,
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
