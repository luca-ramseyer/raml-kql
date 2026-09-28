import { vi } from 'vitest';

import { createIpcHandlers, type HandlerDependencies } from '../../src/main/ipc/handlers';
import type { AppInfo, IpcHandlers } from '../../src/shared/ipc/contracts';
import { DEFAULT_LAYOUT_STATE } from '../../src/shared/layout/layout-state';

export const EMPTY_INVENTORY = { workspaces: [], tenants: [], refreshing: false, problems: [] };

export const TEST_APP_INFO: AppInfo = {
  name: 'Raml KQL',
  version: '0.0.0',
  platform: 'darwin',
  electronVersion: '44.0.0',
  demoMode: true,
  isDevelopment: false,
};

/** Handler dependencies backed by fakes; override what a test cares about. */
export function fakeHandlerDependencies(
  overrides: Partial<HandlerDependencies> = {},
): HandlerDependencies {
  return {
    appInfo: TEST_APP_INFO,
    now: () => new Date(0),
    relaunch: vi.fn(),
    showAbout: vi.fn(),
    accounts: {
      snapshot: () => ({ accounts: [], builtinAvailable: true, persistence: 'encrypted' }),
      addAccount: vi.fn(() =>
        Promise.resolve({
          accounts: [],
          builtinAvailable: true,
          persistence: 'encrypted' as const,
        }),
      ),
      removeAccount: vi.fn(() =>
        Promise.resolve({
          accounts: [],
          builtinAvailable: true,
          persistence: 'encrypted' as const,
        }),
      ),
      reauthenticate: vi.fn(() =>
        Promise.resolve({
          accounts: [],
          builtinAvailable: true,
          persistence: 'encrypted' as const,
        }),
      ),
      refresh: vi.fn(() =>
        Promise.resolve({
          accounts: [],
          builtinAvailable: true,
          persistence: 'encrypted' as const,
        }),
      ),
      setLabel: vi.fn(() =>
        Promise.resolve({
          accounts: [],
          builtinAvailable: true,
          persistence: 'encrypted' as const,
        }),
      ),
    },
    inventory: {
      snapshot: () => EMPTY_INVENTORY,
      refresh: vi.fn(() => Promise.resolve(EMPTY_INVENTORY)),
      updateWorkspaces: vi.fn(() => Promise.resolve(EMPTY_INVENTORY)),
      updateTenant: vi.fn(() => Promise.resolve(EMPTY_INVENTORY)),
    },
    groups: {
      snapshot: () => ({ groups: [], problems: [] }),
      save: vi.fn(() => Promise.resolve({ groups: [], problems: [] })),
      delete: vi.fn(() => Promise.resolve({ groups: [], problems: [] })),
    },
    settings: {
      current: { values: {}, problems: [] },
      update: vi.fn(() => Promise.resolve({ values: {}, problems: [] })),
    },
    keybindings: { current: { entries: [], problems: [] } },
    userThemes: () => ({ themes: [], problems: [] }),
    layout: {
      read: () => Promise.resolve(DEFAULT_LAYOUT_STATE),
      write: vi.fn(() => Promise.resolve()),
    },
    window: {
      setTitleBarOverlay: vi.fn(),
      setMenu: vi.fn(),
      runEditRole: vi.fn(),
      toggleFullScreen: vi.fn(),
      toggleDevTools: vi.fn(),
      reload: vi.fn(),
      zoom: vi.fn(() => 0),
    },
    shell: {
      openConfigFile: vi.fn(() => Promise.resolve()),
      openConfigFolder: vi.fn(() => Promise.resolve()),
      openExternal: vi.fn(() => Promise.resolve()),
      writeClipboard: vi.fn(() => Promise.resolve()),
    },
    ...overrides,
  };
}

export function fakeHandlers(overrides: Partial<HandlerDependencies> = {}): IpcHandlers {
  return createIpcHandlers(fakeHandlerDependencies(overrides));
}
