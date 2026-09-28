import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findQuickInputBox,
  installWorkbenchHarness,
  queryQuickInputBox,
  resetWorkbenchState,
  setMediaMatch,
} from '../../test/helpers/workbench-harness';

import { App } from './App';

afterEach(() => {
  resetWorkbenchState();
});

async function renderWorkbench(harnessOverrides?: Parameters<typeof installWorkbenchHarness>[0]) {
  const harness = installWorkbenchHarness(harnessOverrides);
  const view = render(<App />);
  await screen.findByTestId('workbench');
  return { harness, view };
}

const themeVar = (name: string): string =>
  document.documentElement.style.getPropertyValue(`--vscode-${name}`);

describe('Workbench', () => {
  it('renders every part of the VS Code layout', async () => {
    await renderWorkbench();
    expect(screen.getByRole('banner')).toHaveClass('titlebar');
    expect(screen.getByRole('navigation', { name: 'Activity Bar' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Targets view' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Status Bar' })).toBeInTheDocument();
    // Welcome page opens on startup by default.
    expect(screen.getByRole('tab', { name: /Welcome/ })).toHaveAttribute('aria-selected', 'true');
    // Demo mode indicator in the status bar.
    expect(screen.getByRole('button', { name: 'Demo Mode' })).toHaveTextContent('Demo Mode');
  });

  it('toggles the sidebar and panel with Cmd+B and Cmd+J', async () => {
    await renderWorkbench();
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', metaKey: true });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j', code: 'KeyJ', metaKey: true });
    expect(screen.queryByRole('region', { name: 'Panel' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', metaKey: true });
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('runs a command from the command palette (F1)', async () => {
    const user = userEvent.setup();
    await renderWorkbench();
    fireEvent.keyDown(window, { key: 'F1', code: 'F1' });
    const input = await findQuickInputBox();
    expect(input).toHaveValue('>');
    await user.type(input, 'toggle primary side');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('View: Toggle Primary Side Bar Visibility');
    expect(within(options[0]!).getByLabelText('⌘B')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await queryQuickInputBox()).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('switches between quick open and commands by prefix', async () => {
    const user = userEvent.setup();
    await renderWorkbench();
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    const input = await findQuickInputBox();
    expect(input).toHaveValue('');
    expect(screen.getByRole('option', { name: /Welcome/ })).toBeInTheDocument();
    await user.type(input, '?');
    expect(screen.getByRole('option', { name: /Show and Run Commands/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await queryQuickInputBox()).not.toBeInTheDocument();
  });

  it('follows the OS appearance and applies theme colours as CSS variables', async () => {
    setMediaMatch('(prefers-color-scheme: dark)', true);
    await renderWorkbench();
    expect(themeVar('editor-background')).toBe('#1f1f1f');
    expect(document.body).toHaveClass('vs-dark');
    act(() => {
      setMediaMatch('(prefers-color-scheme: dark)', false);
    });
    expect(themeVar('editor-background')).toBe('#ffffff');
    expect(document.body).toHaveClass('vs');
    setMediaMatch('(prefers-color-scheme: dark)', false);
  });

  it('applies external settings.jsonc edits live (theme via settings)', async () => {
    const { harness } = await renderWorkbench();
    act(() => {
      harness.setSettingsFile({
        'window.autoDetectColorScheme': false,
        'window.autoDetectHighContrast': false,
        'workbench.colorTheme': 'Default High Contrast',
      });
    });
    expect(document.body).toHaveClass('hc-black');
    expect(themeVar('contrastBorder')).toBe('#6fc3df');
  });

  it('shows a notification when settings.jsonc has errors', async () => {
    const { harness } = await renderWorkbench();
    act(() => {
      harness.setSettingsFile({}, [{ file: 'settings.jsonc', line: 12, message: 'Syntax error' }]);
    });
    expect(
      await screen.findByRole('alert', { name: /settings.jsonc has errors \(line 12\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings.jsonc' })).toBeInTheDocument();
  });

  it('runs commands sent from the native menu', async () => {
    const { harness } = await renderWorkbench();
    act(() => {
      harness.emit('menu.runCommand', { command: 'workbench.action.openSettings' });
    });
    expect(await screen.findByRole('tab', { name: /Settings/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('persists layout changes through IPC', async () => {
    const { harness } = await renderWorkbench();
    fireEvent.keyDown(window, { key: 'j', code: 'KeyJ', metaKey: true });
    await waitFor(() => {
      expect(harness.deps.layout.write).toHaveBeenCalled();
    });
    expect(harness.deps.layout.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ panel: expect.objectContaining({ visible: false }) as unknown }),
    );
  });

  it('sends the native menu model on macOS', async () => {
    const { harness } = await renderWorkbench();
    await waitFor(() => {
      expect(harness.deps.window.setMenu).toHaveBeenCalled();
    });
    const model = (
      harness.deps.window.setMenu as unknown as { mock: { lastCall: [{ label: string }[]] } }
    ).mock.lastCall[0];
    expect(model.map((menu) => menu.label)).toEqual(['File', 'Edit', 'Selection', 'View', 'Help']);
  });

  it('shows a readable error if startup fails', async () => {
    installWorkbenchHarness({
      layout: {
        read: () => Promise.reject(new Error('disk on fire')),
        write: () => Promise.resolve(),
      },
    });
    const consoleError = console.error;
    console.error = () => undefined;
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Raml KQL failed to start');
    console.error = consoleError;
  });
});
