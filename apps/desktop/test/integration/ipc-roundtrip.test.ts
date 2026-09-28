import { describe, expect, it, vi } from 'vitest';

import { registerIpcRouter } from '../../src/main/ipc/router';
import { createRamlKqlApi } from '../../src/preload/api';
import { eventChannel } from '../../src/shared/ipc/events';
import { fakeHandlers } from '../helpers/fake-handlers';
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
      handlers: fakeHandlers({
        appInfo: {
          name: 'Raml KQL',
          version: '1.2.3',
          platform: 'win32',
          electronVersion: '44.4.5',
          demoMode: true,
          isDevelopment: false,
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
        isDevelopment: false,
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

  it('delivers validated main-process events and supports unsubscribe', () => {
    const { api, bus } = connect();
    const received: unknown[] = [];
    const unsubscribe = api.events.on('menu.runCommand', (payload) => received.push(payload));
    bus.send(eventChannel('menu.runCommand'), { command: 'workbench.action.showCommands' });
    unsubscribe();
    bus.send(eventChannel('menu.runCommand'), { command: 'ignored.after.unsubscribe' });
    expect(received).toEqual([{ command: 'workbench.action.showCommands' }]);
  });

  it('drops event payloads that fail validation', () => {
    const { api, bus } = connect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const received: unknown[] = [];
    api.events.on('window.fullScreenChanged', (payload) => received.push(payload));
    bus.send(eventChannel('window.fullScreenChanged'), { fullScreen: 'yes' });
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('refuses to subscribe to unknown events', () => {
    const { api } = connect();
    expect(() => api.events.on('nope' as 'menu.runCommand', () => undefined)).toThrow(
      /Unknown event/,
    );
  });

  it('settings.update is validated before it reaches main', async () => {
    const { api } = connect();
    const result = await api.settings.update({ action: 'set', key: '', value: 1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_INVALID_REQUEST' } });
  });
});
