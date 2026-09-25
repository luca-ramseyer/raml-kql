import { create } from 'zustand';

import type {
  Account,
  AccountsSnapshot,
  AddAccountRequest,
  DeviceCodePrompt,
  TenantInfo,
} from '../../../shared/auth/models';
import { AppError } from '../../../shared/errors';
import { dismissNotification, notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';

interface AccountsState {
  snapshot: AccountsSnapshot;
  /** An interactive sign-in is running (browser or device code). */
  signingIn: boolean;
}

export const useAccounts = create<AccountsState>(() => ({
  snapshot: { accounts: [], builtinAvailable: false, persistence: 'encrypted' },
  signingIn: false,
}));

/** Real names. The UI shows names through the aliasing namer (see setNameFormatters). */
export function tenantName(tenant: TenantInfo): string {
  return tenant.displayName ?? tenant.defaultDomain ?? tenant.tenantId;
}

export function accountName(account: Account): string {
  return account.label ?? account.username;
}

/**
 * Display-name formatters for text this store produces (notifications). The workbench
 * installs aliasing-aware ones at startup; injected to avoid an import cycle with privacy.
 */
const formatters = { tenant: tenantName, account: accountName };
export function setNameFormatters(next: {
  tenant: (tenant: TenantInfo) => string;
  account: (account: Account) => string;
}): void {
  Object.assign(formatters, next);
}

/** Tenants that need the user to sign in again, across all accounts. */
export function tenantsNeedingReauth(
  snapshot: AccountsSnapshot,
): { account: Account; tenant: TenantInfo }[] {
  return snapshot.accounts.flatMap((account) =>
    account.tenants
      .filter((tenant) => tenant.state === 'needsReauth')
      .map((tenant) => ({ account, tenant })),
  );
}

let knownReauthKeys = new Set<string>();
let reauthNotificationId: number | undefined;

export function applyAccountsSnapshot(snapshot: AccountsSnapshot): void {
  useAccounts.setState({ snapshot });

  // Spec 02: one aggregated notification, "2 tenants need you to sign in again — Sign in".
  const pending = tenantsNeedingReauth(snapshot);
  const keys = new Set(pending.map(({ account, tenant }) => `${account.id}|${tenant.tenantId}`));
  const hasNew = [...keys].some((key) => !knownReauthKeys.has(key));
  knownReauthKeys = keys;
  if (pending.length === 0) {
    if (reauthNotificationId !== undefined) dismissNotification(reauthNotificationId);
    reauthNotificationId = undefined;
    return;
  }
  const [first] = pending;
  if (hasNew && first !== undefined) {
    reauthNotificationId = notify({
      key: 'accounts-reauth',
      severity: 'warning',
      message:
        pending.length === 1
          ? `${formatters.tenant(first.tenant)} needs you to sign in again.`
          : `${String(pending.length)} tenants need you to sign in again.`,
      detail: pending
        .map(
          ({ account, tenant }) => `${formatters.tenant(tenant)} (${formatters.account(account)})`,
        )
        .join('\n'),
      actions: [{ label: 'Sign in', run: () => void signInToPendingTenants() }],
    });
  }
}

function reportError(error: unknown, fallback: string): void {
  if (error instanceof AppError && error.code === 'AUTH_CANCELLED') {
    notify({ severity: 'info', message: error.message });
    return;
  }
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Accounts',
  });
}

async function run(action: () => Promise<AccountsSnapshot>, fallback: string): Promise<boolean> {
  try {
    applyAccountsSnapshot(await action());
    return true;
  } catch (error) {
    reportError(error, fallback);
    return false;
  }
}

export async function loadAccounts(): Promise<void> {
  await run(() => unwrap(getBridge().accounts.get()), 'Could not load accounts.');
}

export async function addAccount(request: AddAccountRequest): Promise<boolean> {
  useAccounts.setState({ signingIn: true });
  try {
    return await run(() => unwrap(getBridge().accounts.add(request)), 'Sign-in failed.');
  } finally {
    useAccounts.setState({ signingIn: false });
    if (deviceCodeNotification !== undefined) dismissNotification(deviceCodeNotification);
    deviceCodeNotification = undefined;
  }
}

export function removeAccount(accountId: string): Promise<boolean> {
  return run(() => unwrap(getBridge().accounts.remove({ accountId })), 'Could not sign out.');
}

export function refreshAccounts(accountId?: string): Promise<boolean> {
  return run(
    () => unwrap(getBridge().accounts.refresh(accountId === undefined ? {} : { accountId })),
    'Could not refresh accounts.',
  );
}

export function setAccountLabel(accountId: string, label: string | null): Promise<boolean> {
  return run(
    () => unwrap(getBridge().accounts.setLabel({ accountId, label })),
    'Could not rename.',
  );
}

export async function reauthenticate(accountId: string, tenantId?: string): Promise<boolean> {
  useAccounts.setState({ signingIn: true });
  try {
    return await run(
      () =>
        unwrap(
          getBridge().accounts.reauthenticate(
            tenantId === undefined ? { accountId } : { accountId, tenantId },
          ),
        ),
      'Sign-in failed.',
    );
  } finally {
    useAccounts.setState({ signingIn: false });
  }
}

/** Spec 02: "The Sign in action runs interactive auth for those tenants sequentially." */
export async function signInToPendingTenants(): Promise<void> {
  for (const { account, tenant } of tenantsNeedingReauth(useAccounts.getState().snapshot)) {
    const ok = await reauthenticate(account.id, tenant.tenantId);
    if (!ok) return;
  }
}

let deviceCodeNotification: number | undefined;

/** Device code sign-in: show the code with a one-click "copy and open". */
export function showDeviceCode(prompt: DeviceCodePrompt): void {
  deviceCodeNotification = notify({
    key: 'device-code',
    severity: 'info',
    message: `To sign in, open ${prompt.verificationUri} and enter the code ${prompt.userCode}.`,
    detail: prompt.message,
    source: 'Accounts',
    actions: [
      {
        label: 'Copy Code & Open Browser',
        run: () => {
          void getBridge().shell.writeClipboard({ text: prompt.userCode });
          void getBridge().shell.openExternal({ url: prompt.verificationUri });
        },
      },
    ],
  });
}
