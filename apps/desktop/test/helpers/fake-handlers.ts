import { vi } from 'vitest';

import { createIpcHandlers, type HandlerDependencies } from '../../src/main/ipc/handlers';
import type { AppInfo, IpcHandlers } from '../../src/shared/ipc/contracts';
import { DEFAULT_LAYOUT_STATE } from '../../src/shared/layout/layout-state';

export const EMPTY_INVENTORY = { workspaces: [], tenants: [], refreshing: false, problems: [] };

export const EMPTY_SCHEMA = { loaded: 0, failed: 0, tables: [], functions: [] };

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
    schema: {
      get: vi.fn(() => Promise.resolve(EMPTY_SCHEMA)),
    },
    query: {
      run: vi.fn(() => Promise.reject(new Error('not faked'))),
      cancel: vi.fn(() => undefined),
      rerun: vi.fn(() => Promise.resolve(undefined)),
      get: vi.fn(() => undefined),
      deleteRun: vi.fn(() => Promise.resolve()),
      deleteAll: vi.fn(() => Promise.resolve()),
    },
    results: {
      view: vi.fn(() => Promise.resolve({ rows: [], positions: [], rowCount: 0, totalRows: 0 })),
      aggregate: vi.fn(() => Promise.resolve({ columns: [], rows: [], truncated: false })),
      chartData: vi.fn(() => Promise.resolve({ columns: [], rows: [], truncated: false })),
      export: vi.fn(() => Promise.resolve({ status: 'cancelled' as const, rows: 0 })),
      saveImage: vi.fn(() => Promise.resolve({ status: 'cancelled' as const, rows: 0 })),
    },
    links: {
      portalQuery: vi.fn(() => ({ url: 'https://portal.azure.com/#view' })),
    },
    audit: {
      verify: vi.fn(() => Promise.resolve({ ok: true, entries: 0, files: 0 })),
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
    queries: {
      list: vi.fn(() => Promise.resolve([])),
      read: vi.fn((path: string) => Promise.resolve({ path, name: path, body: '' })),
      save: vi.fn((request: { path?: string; name?: string; body: string }) =>
        Promise.resolve({
          path: request.path ?? 'new.kql',
          name: request.name ?? 'new',
          body: request.body,
        }),
      ),
      rename: vi.fn((path: string, name: string) => Promise.resolve({ path, name, body: '' })),
      move: vi.fn((path: string) => Promise.resolve(path)),
      createFolder: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      reveal: vi.fn(),
    },
    history: {
      list: vi.fn(() => Promise.resolve([])),
      clear: vi.fn(() => Promise.resolve()),
    },
    extensions: {
      snapshot: vi.fn(() => Promise.resolve({ extensions: [], grants: [], problems: [] })),
      installFromFile: vi.fn(() => Promise.resolve({ type: 'cancelled' as const })),
      installFromGit: vi.fn(() => Promise.resolve({ type: 'cancelled' as const })),
      checkUpdates: vi.fn(() => Promise.resolve({ updates: 0, errors: [] })),
      update: vi.fn(() => Promise.resolve({ type: 'cancelled' as const })),
      confirmInstall: vi.fn(() => Promise.resolve({ extensions: [], grants: [], problems: [] })),
      cancelInstall: vi.fn(),
      uninstall: vi.fn(() => Promise.resolve({ extensions: [], grants: [], problems: [] })),
      setEnabled: vi.fn(() => Promise.resolve({ extensions: [], grants: [], problems: [] })),
      executeCommand: vi.fn(() => Promise.resolve(undefined)),
      respond: vi.fn(),
      revoke: vi.fn(() => Promise.resolve({ extensions: [], grants: [], problems: [] })),
      readme: vi.fn(() => Promise.resolve(undefined)),
      enrich: vi.fn(() => Promise.resolve([])),
      resultsAccess: vi.fn(() => Promise.resolve(false)),
      resolveView: vi.fn(() => Promise.resolve()),
      webviewMessage: vi.fn(() => Promise.resolve()),
    },
    packs: {
      snapshot: vi.fn(() => Promise.resolve({ sources: [], packs: [], problems: [] })),
      readQuery: vi.fn(() => {
        throw new Error('No pack query');
      }),
      previewGit: vi.fn(() => Promise.reject(new Error('Not in tests'))),
      importFile: vi.fn(() => Promise.resolve({ type: 'cancelled' as const })),
      add: vi.fn(() => Promise.resolve({ sources: [], packs: [], problems: [] })),
      cancelPreview: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve({ sources: [], packs: [], problems: [] })),
      checkUpdates: vi.fn(() => Promise.resolve({ checked: 0, updates: 0, errors: [] })),
      updatePreview: vi.fn(() => Promise.reject(new Error('Not in tests'))),
      applyUpdate: vi.fn(() => Promise.resolve({ sources: [], packs: [], problems: [] })),
    },
    tabs: {
      read: vi.fn(() => Promise.resolve(undefined)),
      write: vi.fn(() => Promise.resolve()),
    },
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
      writeClipboardImage: vi.fn(() => Promise.resolve()),
    },
    ...overrides,
  };
}

export function fakeHandlers(overrides: Partial<HandlerDependencies> = {}): IpcHandlers {
  return createIpcHandlers(fakeHandlerDependencies(overrides));
}
