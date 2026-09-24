import { vi } from 'vitest';

import { createIpcHandlers, type HandlerDependencies } from '../../src/main/ipc/handlers';
import type { AppInfo, IpcHandlers } from '../../src/shared/ipc/contracts';
import { DEFAULT_LAYOUT_STATE } from '../../src/shared/layout/layout-state';

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
    },
    ...overrides,
  };
}

export function fakeHandlers(overrides: Partial<HandlerDependencies> = {}): IpcHandlers {
  return createIpcHandlers(fakeHandlerDependencies(overrides));
}
