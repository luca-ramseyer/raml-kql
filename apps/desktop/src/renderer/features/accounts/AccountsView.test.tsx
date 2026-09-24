import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { AccountsSnapshot } from '../../../shared/auth/models';
import { App } from '../../App';
import { applySettingsSnapshot } from '../../platform/settings';

import { applyAccountsSnapshot } from './accounts-store';
import { AccountsView } from './AccountsView';

const CONTOSO = '00000000-0000-0000-0000-00000000c001';
const NORTHWIND = '00000000-0000-0000-0000-00000000c002';
const TAILSPIN = '00000000-0000-0000-0000-00000000c004';

const SNAPSHOT: AccountsSnapshot = {
  builtinAvailable: true,
  persistence: 'encrypted',
  accounts: [
    {
      id: 'demo:analyst@contoso.example',
      username: 'analyst@contoso.example',
      provider: 'demo',
      homeTenantId: CONTOSO,
      refreshing: false,
      tenants: [
        { tenantId: CONTOSO, displayName: 'Contoso', relation: 'home', state: 'ok' },
        {
          tenantId: NORTHWIND,
          displayName: 'Northwind Traders',
          relation: 'guest',
          state: 'needsReauth',
          detail: 'MFA required',
        },
        { tenantId: TAILSPIN, displayName: 'Tailspin Toys', relation: 'guest', state: 'noAccess' },
      ],
    },
  ],
};

afterEach(() => {
  resetWorkbenchState();
});

function withAccounts(snapshot: AccountsSnapshot = SNAPSHOT) {
  const signedIn: AccountsSnapshot = {
    ...snapshot,
    accounts: snapshot.accounts.map((a) => ({
      ...a,
      tenants: a.tenants.map((t) => ({
        ...t,
        state: t.state === 'needsReauth' ? ('ok' as const) : t.state,
      })),
    })),
  };
  const harness = installWorkbenchHarness({
    accounts: {
      snapshot: () => snapshot,
      addAccount: vi.fn(() => Promise.resolve(snapshot)),
      removeAccount: vi.fn(() => Promise.resolve({ ...snapshot, accounts: [] })),
      reauthenticate: vi.fn(() => Promise.resolve(signedIn)),
      refresh: vi.fn(() => Promise.resolve(snapshot)),
      setLabel: vi.fn(() => Promise.resolve(snapshot)),
    },
  });
  act(() => {
    applyAccountsSnapshot(snapshot);
  });
  return harness;
}

describe('AccountsView', () => {
  it('shows accounts with their tenants and states, hiding tenants without access', () => {
    withAccounts();
    render(<AccountsView />);
    const tree = screen.getByRole('tree', { name: 'Accounts' });
    expect(
      within(tree).getByRole('treeitem', { name: 'analyst@contoso.example' }),
    ).toBeInTheDocument();
    expect(within(tree).getByText('Contoso')).toBeInTheDocument();
    expect(within(tree).getByText('Northwind Traders')).toBeInTheDocument();
    expect(within(tree).queryByText('Tailspin Toys')).not.toBeInTheDocument();
    expect(within(tree).getByText('1 tenant without Azure access hidden')).toBeInTheDocument();
  });

  it('shows tenants without access when the setting is on', () => {
    withAccounts();
    act(() => {
      applySettingsSnapshot({
        values: { 'accounts.showTenantsWithoutAccess': true },
        problems: [],
      });
    });
    render(<AccountsView />);
    expect(screen.getByText('Tailspin Toys')).toBeInTheDocument();
  });

  it('signs in to a tenant that needs it', async () => {
    const harness = withAccounts();
    render(<AccountsView />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(harness.deps.accounts.reauthenticate).toHaveBeenCalledWith(
        'demo:analyst@contoso.example',
        NORTHWIND,
      );
    });
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('offers to add an account when there are none', async () => {
    withAccounts({ accounts: [], builtinAvailable: true, persistence: 'encrypted' });
    render(<App />);
    await screen.findByTestId('workbench');
    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Account' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Microsoft sign-in') as unknown,
      expect.stringContaining('device code') as unknown,
      expect.stringContaining('Azure CLI') as unknown,
      expect.stringContaining('Custom client ID') as unknown,
    ]);
  });

  it('explains the missing keyring and offers session-only sign-in', () => {
    withAccounts({ accounts: [], builtinAvailable: true, persistence: 'unavailable' });
    render(<AccountsView />);
    expect(screen.getByText(/No OS keyring is available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Session-Only/ })).toBeInTheDocument();
  });
});

describe('accounts in the workbench', () => {
  it('badges the Accounts icon and shows one aggregated sign-in notification', async () => {
    const harness = withAccounts();
    render(<App />);
    await screen.findByTestId('workbench');
    const accountsTab = screen.getByRole('tab', { name: 'Accounts' });
    expect(accountsTab).toHaveAttribute(
      'title',
      expect.stringContaining('1 needs attention') as unknown,
    );
    const notification = await screen.findByRole('status', {
      name: /Northwind Traders needs you to sign in again/,
    });
    await userEvent.click(within(notification).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(harness.deps.accounts.reauthenticate).toHaveBeenCalledWith(
        'demo:analyst@contoso.example',
        NORTHWIND,
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('title', 'Accounts');
    });
  });

  it('shows the device code and copies it on request', async () => {
    const harness = withAccounts();
    render(<App />);
    await screen.findByTestId('workbench');
    act(() => {
      harness.emit('accounts.deviceCode', {
        userCode: 'ABCD-1234',
        verificationUri: 'https://microsoft.com/devicelogin',
        message: 'To sign in, use a web browser…',
        expiresInSeconds: 900,
      });
    });
    const notification = await screen.findByRole('status', { name: /enter the code ABCD-1234/ });
    await userEvent.click(
      within(notification).getByRole('button', { name: 'Copy Code & Open Browser' }),
    );
    expect(harness.deps.shell.writeClipboard).toHaveBeenCalledWith('ABCD-1234');
    expect(harness.deps.shell.openExternal).toHaveBeenCalledWith(
      'https://microsoft.com/devicelogin',
    );
  });

  it('validates a custom client ID before signing in', async () => {
    const harness = withAccounts();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('workbench');
    fireEvent.keyDown(window, { key: 'F1', code: 'F1' });
    await user.type(await screen.findByRole('combobox'), 'custom client{Enter}');
    const input = await screen.findByRole('combobox');
    await user.type(input, 'not-a-guid{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the client ID as a GUID.');
    expect(harness.deps.accounts.addAccount).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '00000000-0000-0000-0000-00000000beef{Enter}');
    await waitFor(() => {
      expect(harness.deps.accounts.addAccount).toHaveBeenCalledWith({
        method: 'custom',
        clientId: '00000000-0000-0000-0000-00000000beef',
        flow: 'browser',
      });
    });
  });
});
