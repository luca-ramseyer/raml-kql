import { registerCommand } from '../../platform/commands';
import { showView } from '../../platform/layout';
import {
  showInputBox,
  showQuickPick,
  type QuickPickItem,
} from '../../platform/quickinput/quick-input';
import { getSetting } from '../../platform/settings';

import {
  accountName,
  addAccount,
  reauthenticate,
  refreshAccounts,
  removeAccount,
  setAccountLabel,
  signInToPendingTenants,
  useAccounts,
} from './accounts-store';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function askCustomClientId(): void {
  showInputBox({
    placeholder: 'Application (client) ID, e.g. 00000000-0000-0000-0000-000000000000',
    prompt: 'The client ID of your organisation’s own Raml KQL app registration',
    validate: (value) => (GUID.test(value.trim()) ? undefined : 'Enter the client ID as a GUID.'),
    onAccept: (value) => {
      void addAccount({ method: 'custom', clientId: value.trim(), flow: 'browser' });
    },
  });
}

/** "Add Account…": choose how to sign in (spec 02, "Accounts UI"). */
export function showAddAccountPicker(): void {
  const { builtinAvailable } = useAccounts.getState().snapshot;
  const methods: (QuickPickItem & { run: () => void; provider: string })[] = [
    {
      id: 'browser',
      provider: 'builtin',
      icon: 'globe',
      label: 'Microsoft sign-in',
      description: builtinAvailable ? 'opens your browser' : 'not available in this build',
      run: () => void addAccount({ method: 'browser' }),
    },
    {
      id: 'deviceCode',
      provider: 'builtin',
      icon: 'device-mobile',
      label: 'Microsoft sign-in with a device code',
      description: 'when the browser redirect is blocked',
      run: () => void addAccount({ method: 'deviceCode' }),
    },
    {
      id: 'azureCli',
      provider: 'azureCli',
      icon: 'terminal',
      label: 'Azure CLI',
      description: 'use accounts from "az login"',
      run: () => void addAccount({ method: 'azureCli' }),
    },
    {
      id: 'custom',
      provider: 'custom',
      icon: 'key',
      label: 'Custom client ID…',
      description: 'your organisation’s own app registration',
      run: askCustomClientId,
    },
  ];
  const preferred = getSetting('auth.provider');
  methods.sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));

  showQuickPick({
    placeholder: 'Select how to sign in',
    getItems: (filter) =>
      methods.filter((m) => m.label.toLowerCase().includes(filter.toLowerCase())),
    onAccept: (item) => {
      methods.find((m) => m.id === item?.id)?.run();
    },
  });
}

/** Pick an account (for commands run from the palette without an argument). */
function pickAccount(placeholder: string, then: (accountId: string) => void): void {
  const { accounts } = useAccounts.getState().snapshot;
  if (accounts.length === 1 && accounts[0] !== undefined) {
    then(accounts[0].id);
    return;
  }
  showQuickPick({
    placeholder,
    noResultsText: 'No accounts',
    getItems: (filter) =>
      accounts
        .map((account) => ({
          id: account.id,
          icon: 'account',
          label: accountName(account),
          description: account.label === undefined ? account.provider : account.username,
        }))
        .filter((item) => item.label.toLowerCase().includes(filter.toLowerCase())),
    onAccept: (item) => {
      if (item !== undefined) then(item.id);
    },
  });
}

const asAccountId = (arg: unknown): string | undefined =>
  typeof arg === 'string' ? arg : undefined;

export function registerAccountCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'accounts.add',
      title: 'Add Account…',
      category: 'Accounts',
      icon: 'add',
      run: showAddAccountPicker,
    }),
    registerCommand({
      id: 'accounts.addWithDeviceCode',
      title: 'Add Account with Device Code',
      category: 'Accounts',
      run: () => addAccount({ method: 'deviceCode' }),
    }),
    registerCommand({
      id: 'accounts.addAzureCli',
      title: 'Add Azure CLI Account',
      category: 'Accounts',
      run: () => addAccount({ method: 'azureCli' }),
    }),
    registerCommand({
      id: 'accounts.addCustom',
      title: 'Add Account with Custom Client ID…',
      category: 'Accounts',
      run: askCustomClientId,
    }),
    registerCommand({
      id: 'accounts.refresh',
      title: 'Refresh Accounts and Tenants',
      category: 'Accounts',
      icon: 'refresh',
      run: (arg) => refreshAccounts(asAccountId(arg)),
    }),
    registerCommand({
      id: 'accounts.signOut',
      title: 'Sign Out…',
      category: 'Accounts',
      icon: 'sign-out',
      run: (arg) => {
        const id = asAccountId(arg);
        if (id !== undefined) return removeAccount(id);
        pickAccount('Select an account to sign out', (accountId) => void removeAccount(accountId));
        return undefined;
      },
    }),
    registerCommand({
      id: 'accounts.rename',
      title: 'Set Account Label…',
      category: 'Accounts',
      icon: 'edit',
      run: (arg) => {
        const rename = (accountId: string): void => {
          const account = useAccounts.getState().snapshot.accounts.find((a) => a.id === accountId);
          showInputBox({
            placeholder: 'e.g. Work, Customer X guest',
            prompt: 'Label for this account (leave empty to show the user name)',
            value: account?.label ?? '',
            validate: (value) => (value.length > 200 ? 'Keep it under 200 characters.' : undefined),
            onAccept: (value) =>
              void setAccountLabel(accountId, value.trim() === '' ? null : value),
          });
        };
        const id = asAccountId(arg);
        if (id === undefined) pickAccount('Select an account to label', rename);
        else rename(id);
      },
    }),
    registerCommand({
      id: 'accounts.reauthenticate',
      title: 'Sign In Again…',
      category: 'Accounts',
      run: (arg, tenant) => {
        const id = asAccountId(arg);
        const tenantId = typeof tenant === 'string' ? tenant : undefined;
        if (id !== undefined) return reauthenticate(id, tenantId);
        pickAccount(
          'Select an account to sign in again',
          (accountId) => void reauthenticate(accountId),
        );
        return undefined;
      },
    }),
    registerCommand({
      id: 'accounts.signInToPendingTenants',
      title: 'Sign In to Tenants That Need It',
      category: 'Accounts',
      run: signInToPendingTenants,
    }),
    registerCommand({
      id: 'workbench.action.showAccounts',
      title: 'Show Accounts',
      category: 'Accounts',
      hideFromPalette: true,
      run: () => {
        showView('workbench.view.accounts');
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
