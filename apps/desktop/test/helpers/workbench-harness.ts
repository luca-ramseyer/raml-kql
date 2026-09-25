import { vi } from 'vitest';

import { createIpcHandlers, type HandlerDependencies } from '../../src/main/ipc/handlers';
import { registerIpcRouter } from '../../src/main/ipc/router';
import { createRamlKqlApi } from '../../src/preload/api';
import { useAccounts } from '../../src/renderer/features/accounts/accounts-store';
import { setAliased } from '../../src/renderer/features/privacy/privacy';
import { useCommands } from '../../src/renderer/platform/commands';
import { useContextKeys } from '../../src/renderer/platform/context-keys';
import { useEditors } from '../../src/renderer/platform/editors';
import { useLayout } from '../../src/renderer/platform/layout';
import { clearAllNotifications, useNotifications } from '../../src/renderer/platform/notifications';
import { hideQuickInput } from '../../src/renderer/platform/quickinput/quick-input';
import { applySettingsSnapshot } from '../../src/renderer/platform/settings';
import type { SettingsSnapshot } from '../../src/shared/config/config-snapshots';
import type { SettingsUpdateRequest } from '../../src/shared/ipc/contracts';
import { eventChannel, type IpcEventName, type IpcEventPayload } from '../../src/shared/ipc/events';
import { DEFAULT_LAYOUT_STATE } from '../../src/shared/layout/layout-state';

import { fakeHandlerDependencies } from './fake-handlers';
import { FakeIpcBus } from './fake-ipc';

/**
 * Boot the real renderer against the real preload API and main-process IPC router, with the
 * main-process services replaced by fakes. The settings fake behaves like the real service
 * closely enough for UI tests (set/reset update the snapshot and emit `settings.changed`).
 */
export function installWorkbenchHarness(
  overrides: Partial<HandlerDependencies> = {},
  initialSettings: SettingsSnapshot['values'] = {},
) {
  const bus = new FakeIpcBus();
  let settings: SettingsSnapshot = { values: initialSettings, problems: [] };
  const emit = <E extends IpcEventName>(name: E, payload: IpcEventPayload<E>): void => {
    bus.send(eventChannel(name), payload);
  };
  const deps = fakeHandlerDependencies({
    settings: {
      get current() {
        return settings;
      },
      update: vi.fn((request: SettingsUpdateRequest) => {
        const values = Object.fromEntries(
          Object.entries(settings.values).filter(([key]) => key !== request.key),
        );
        if (request.action === 'set') values[request.key] = request.value;
        settings = { values, problems: [] };
        return Promise.resolve(settings);
      }),
    },
    ...overrides,
  });
  registerIpcRouter({
    ipcMain: bus.ipcMain,
    handlers: createIpcHandlers(deps),
    isTrustedSender: () => true,
  });
  vi.stubGlobal('ramlKql', createRamlKqlApi(bus.ipcRenderer));

  return {
    bus,
    deps,
    emit,
    /** Simulate an external edit of settings.jsonc (live reload). */
    setSettingsFile(
      values: SettingsSnapshot['values'],
      problems: SettingsSnapshot['problems'] = [],
    ) {
      settings = { values, problems };
      emit('settings.changed', settings);
    },
  };
}

/** Reset the module-level renderer stores between tests. */
export function resetWorkbenchState(): void {
  hideQuickInput();
  clearAllNotifications();
  useNotifications.setState({ notifications: [], toasts: [], centerVisible: false });
  useEditors.setState({ editors: [], activeId: undefined });
  useLayout.setState(DEFAULT_LAYOUT_STATE, true);
  useCommands.setState({ recent: [] });
  useContextKeys.setState({ values: {} });
  applySettingsSnapshot({ values: {}, problems: [] });
  setAliased(true);
  useAccounts.setState({
    snapshot: { accounts: [], builtinAvailable: false, persistence: 'encrypted' },
    signingIn: false,
  });
  vi.unstubAllGlobals();
}

export function setMediaMatch(query: string, value: boolean): void {
  (window as unknown as { __setMediaMatch: (q: string, v: boolean) => void }).__setMediaMatch(
    query,
    value,
  );
}

/** The quick input's text box (the palette, quick open and pickers all use it). */
export async function findQuickInputBox(): Promise<HTMLInputElement> {
  const { screen, within } = await import('@testing-library/react');
  const dialog = await screen.findByRole('dialog', { name: 'Quick input' });
  return within(dialog).getByRole<HTMLInputElement>('combobox');
}

export async function queryQuickInputBox(): Promise<HTMLElement | null> {
  const { screen } = await import('@testing-library/react');
  return screen.queryByRole('dialog', { name: 'Quick input' });
}
