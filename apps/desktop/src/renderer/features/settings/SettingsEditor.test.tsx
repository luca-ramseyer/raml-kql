import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import { applySettingsSnapshot } from '../../platform/settings';

import { SettingsEditor } from './SettingsEditor';

let harness: ReturnType<typeof installWorkbenchHarness>;

beforeEach(() => {
  harness = installWorkbenchHarness();
});
afterEach(() => {
  resetWorkbenchState();
});

describe('SettingsEditor', () => {
  it('lists settings from the registry, with Commonly Used first', () => {
    render(<SettingsEditor />);
    const sections = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(sections[0]).toBe('Commonly Used');
    expect(sections).toContain('Workbench › Appearance');
    expect(screen.getAllByRole('group', { name: 'Workbench: Color Theme' }).length).toBeGreaterThan(
      0,
    );
  });

  it('filters by search text and shows the count', async () => {
    const user = userEvent.setup();
    render(<SettingsEditor />);
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'status bar');
    expect(screen.getByText('1 Setting Found')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Workbench › Status Bar: Visible' }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('No Settings Found')).toBeInTheDocument();
  });

  it('writes changes through IPC and marks modified settings, with reset', async () => {
    const user = userEvent.setup();
    render(<SettingsEditor />);
    await user.type(screen.getByRole('searchbox'), 'status bar');
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    await waitFor(() => {
      expect(harness.deps.settings.update).toHaveBeenCalledWith({
        action: 'set',
        key: 'workbench.statusBar.visible',
        value: false,
      });
    });
    const row = screen.getByRole('group', { name: 'Workbench › Status Bar: Visible' });
    expect(row).toHaveClass('modified');
    expect(screen.getByRole('checkbox')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Reset Visible' }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeChecked();
    });
    expect(harness.deps.settings.update).toHaveBeenLastCalledWith({
      action: 'reset',
      key: 'workbench.statusBar.visible',
    });
  });

  it('validates number input before saving', async () => {
    const user = userEvent.setup();
    render(<SettingsEditor />);
    await user.type(screen.getByRole('searchbox'), 'command palette history');
    const input = screen.getByRole('spinbutton', { name: 'History' });
    await user.clear(input);
    await user.type(input, '9999{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(harness.deps.settings.update).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '20{Enter}');
    await waitFor(() => {
      expect(harness.deps.settings.update).toHaveBeenCalledWith({
        action: 'set',
        key: 'workbench.commandPalette.history',
        value: 20,
      });
    });
  });

  it('offers installed themes, and flags a configured theme that is missing', () => {
    act(() => {
      applySettingsSnapshot({ values: { 'workbench.colorTheme': 'Gone Theme' }, problems: [] });
    });
    render(<SettingsEditor />);
    const [select] = screen.getAllByRole('combobox', { name: 'Color Theme' });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain('Default Light Modern');
    expect(options).toContain('Gone Theme (not installed)');
  });
});

describe('SettingsEditor failure handling', () => {
  it('rolls back an optimistic change when the main process rejects it', async () => {
    resetWorkbenchState();
    installWorkbenchHarness({
      settings: {
        current: { values: {}, problems: [] },
        update: () => Promise.reject(new Error('Unable to write into settings.jsonc.')),
      },
    });
    const user = userEvent.setup();
    render(<SettingsEditor />);
    await user.type(screen.getByRole('searchbox'), 'status bar');
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeChecked();
    });
    expect(screen.getByRole('group', { name: 'Workbench › Status Bar: Visible' })).not.toHaveClass(
      'modified',
    );
  });
});
