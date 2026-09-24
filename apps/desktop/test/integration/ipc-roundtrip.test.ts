import { describe, expect, it } from 'vitest';

import { createIpcHandlers } from '../../src/main/ipc/handlers';
import { registerIpcRouter } from '../../src/main/ipc/router';
import { createRamlKqlApi } from '../../src/preload/api';
import { FakeIpcBus } from '../helpers/fake-ipc';

/**
 * The full request path without Electron: preload API -> (structured clone) -> main router ->
 * handler -> router -> (structured clone) -> preload API. Both sides validate with zod.
 */
describe('IPC round trip', () => {
  function connect() {
    const bus = new FakeIpcBus();
    registerIpcRouter({
      ipcMain: bus.ipcMain,
      handlers: createIpcHandlers({
        appInfo: {
          name: 'Raml KQL',
          version: '1.2.3',
          platform: 'win32',
          electronVersion: '44.4.5',
          demoMode: true,
        },
        now: () => new Date('2026-01-02T03:04:05.000Z'),
      }),
      isTrustedSender: (url) => url === 'raml-kql://app/index.html',
    });
    return { bus, api: createRamlKqlApi(bus.ipcRenderer) };
  }

  it('app.getInfo returns the app info', async () => {
    const { api } = connect();
    await expect(api.app.getInfo()).resolves.toEqual({
      ok: true,
      value: {
        name: 'Raml KQL',
        version: '1.2.3',
        platform: 'win32',
        electronVersion: '44.4.5',
        demoMode: true,
      },
    });
  });

  it('app.ping echoes the message with a timestamp', async () => {
    const { api } = connect();
    await expect(api.app.ping({ message: 'hello' })).resolves.toEqual({
      ok: true,
      value: { message: 'hello', receivedAt: '2026-01-02T03:04:05.000Z' },
    });
  });

  it('surfaces sender rejection from main as an error envelope', async () => {
    const { api, bus } = connect();
    bus.senderUrl = 'http://localhost:5173/';
    await expect(api.app.getInfo()).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_UNTRUSTED_SENDER', source: 'main' },
    });
  });
});
