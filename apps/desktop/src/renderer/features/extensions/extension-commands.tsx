import {
  permissionRisk,
  type PermissionDeclaration,
} from '@raml-kql/pack-schema/extension-manifest';

import type { InstallPreview, InstallResult } from '../../../shared/extensions/models';
import { registerCommand } from '../../platform/commands';
import { showDialog } from '../../platform/dialogs';
import { dismissNotification, notify } from '../../platform/notifications';
import { showInputBox } from '../../platform/quickinput/quick-input';
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

async function installPreview(result: InstallResult): Promise<void> {
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
    message: `${preview.replaces === undefined ? 'Installed' : 'Updated'} ${preview.extension.displayName} ${preview.extension.version}.`,
    source: 'Extensions',
  });
}

export async function installFromFile(): Promise<void> {
  try {
    await installPreview(await unwrap(getBridge().extensions.installFromFile()));
  } catch (error) {
    reportExtensionError(error, 'The extension could not be installed.');
  }
}

function askUrl(): Promise<string | undefined> {
  return new Promise((resolve) => {
    showInputBox({
      placeholder: 'https://github.com/contoso/raml-kql-extension',
      prompt: 'Git repository of the extension (its newest compatible release is installed)',
      validate: (value) =>
        value.trim() === '' || /^https?:\/\//i.test(value.trim())
          ? undefined
          : 'Enter an https:// URL.',
      onAccept: (value) => {
        resolve(value.trim());
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

export async function installFromGit(): Promise<void> {
  const url = await askUrl();
  if (url === undefined || url === '') return;
  const progress = notify({
    severity: 'info',
    message: `Looking for releases in ${url}…`,
    source: 'Extensions',
  });
  try {
    const result = await unwrap(getBridge().extensions.installFromGit({ url }));
    dismissNotification(progress);
    await installPreview(result);
  } catch (error) {
    dismissNotification(progress);
    reportExtensionError(error, 'The extension could not be installed.');
  }
}

export async function updateExtension(id: string): Promise<void> {
  try {
    const result = await unwrap(getBridge().extensions.update({ id }));
    if (result.type === 'cancelled') {
      notify({ severity: 'info', message: 'The extension is up to date.', source: 'Extensions' });
      return;
    }
    await installPreview(result);
  } catch (error) {
    reportExtensionError(error, 'The update failed.');
  }
}

export async function checkExtensionUpdates(): Promise<void> {
  try {
    const { updates, errors } = await unwrap(getBridge().extensions.checkUpdates());
    for (const error of errors)
      notify({ severity: 'warning', message: error, source: 'Extensions' });
    notify({
      severity: 'info',
      message:
        updates === 0
          ? 'All extensions are up to date.'
          : `Updates are available for ${String(updates)} ${updates === 1 ? 'extension' : 'extensions'}: see the Extensions view.`,
      source: 'Extensions',
    });
  } catch (error) {
    reportExtensionError(error, 'The update check failed.');
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
      id: 'extensions.installFromGit',
      title: 'Install from Git URL…',
      category: 'Extensions',
      icon: 'repo-clone',
      run: installFromGit,
    }),
    registerCommand({
      id: 'extensions.checkUpdates',
      title: 'Check for Extension Updates',
      category: 'Extensions',
      icon: 'sync',
      run: checkExtensionUpdates,
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
