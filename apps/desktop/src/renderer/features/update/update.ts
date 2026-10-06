import type { UpdateState } from '../../../shared/update/models';
import { registerCommand } from '../../platform/commands';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';

/**
 * Auto-update in the workbench (spec 11). Main downloads in the background; here the user is
 * offered "Restart to Update" once it's ready, like VS Code. Automatic failures stay quiet;
 * a manual "Check for Updates…" always says what happened.
 */
const NOTIFICATION_KEY = 'update';

export function offerRestart(version: string): void {
  notify({
    key: NOTIFICATION_KEY,
    severity: 'info',
    message: `Raml KQL ${version} is ready. Restart to update.`,
    source: 'Update',
    actions: [
      {
        label: 'Restart to Update',
        run: () => {
          void unwrap(getBridge().update.install()).catch(() => undefined);
        },
      },
      { label: 'Later', run: () => undefined },
    ],
  });
}

/** Report the outcome of a manual check. */
export function reportManualCheck(state: UpdateState): void {
  switch (state.status) {
    case 'upToDate':
      notify({ key: NOTIFICATION_KEY, message: 'Raml KQL is up to date.', source: 'Update' });
      return;
    case 'available':
    case 'downloading':
      notify({
        key: NOTIFICATION_KEY,
        message: `Downloading Raml KQL ${state.version}… You'll be asked to restart when it's ready.`,
        source: 'Update',
      });
      return;
    case 'ready':
      offerRestart(state.version);
      return;
    case 'error':
      notify({
        key: NOTIFICATION_KEY,
        severity: 'error',
        message: 'Could not check for updates.',
        detail: state.message,
        source: 'Update',
      });
      return;
    case 'unsupported':
      notify({ key: NOTIFICATION_KEY, message: state.reason, source: 'Update' });
      return;
    case 'idle':
    case 'checking':
      return;
  }
}

export async function checkForUpdates(): Promise<void> {
  reportManualCheck(await unwrap(getBridge().update.check()));
}

/** Offer the restart when a background download finishes. */
export function startUpdateNotifications(): () => void {
  return getBridge().events.on('update.changed', (state) => {
    if (state.status === 'ready') offerRestart(state.version);
  });
}

export function registerUpdateCommands(): () => void {
  return registerCommand({
    id: 'update.checkForUpdates',
    title: 'Check for Updates…',
    category: 'Help',
    icon: 'cloud-download',
    run: checkForUpdates,
  });
}
