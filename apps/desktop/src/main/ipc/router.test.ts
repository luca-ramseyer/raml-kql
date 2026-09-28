import { describe, expect, it, vi } from 'vitest';

import { fakeHandlers, TEST_APP_INFO as appInfo } from '../../../test/helpers/fake-handlers';
import { FakeIpcBus } from '../../../test/helpers/fake-ipc';
import { AppError } from '../../shared/errors';
import type { IpcHandlers } from '../../shared/ipc/contracts';

import { registerIpcRouter } from './router';

/** Base handlers with `app` methods replaced. */
function withApp(app: Partial<IpcHandlers['app']>): IpcHandlers {
  const base = fakeHandlers();
  return { ...base, app: { ...base.app, ...app } };
}

function setup(handlers: IpcHandlers = fakeHandlers()) {
  const bus = new FakeIpcBus();
  const onInternalError = vi.fn();
  const dispose = registerIpcRouter({
    ipcMain: bus.ipcMain,
    handlers,
    isTrustedSender: (url) => url.startsWith('raml-kql://app/'),
    onInternalError,
  });
  return { bus, dispose, onInternalError };
}

describe('registerIpcRouter', () => {
  it('registers one handler per contract channel', () => {
    const { bus } = setup();
    expect(bus.handlers.has('app:getInfo')).toBe(true);
    expect(bus.handlers.has('settings:update')).toBe(true);
    expect(bus.handlers.size).toBeGreaterThan(10);
  });

  it('returns the validated handler result in an ok envelope', async () => {
    const { bus } = setup();
    await expect(bus.ipcRenderer.invoke('app:ping', { message: 'hi' })).resolves.toEqual({
      ok: true,
      value: { message: 'hi', receivedAt: '1970-01-01T00:00:00.000Z' },
    });
  });

  it('rejects untrusted senders before running the handler', async () => {
    const ping = vi.fn();
    const { bus } = setup(withApp({ ping }));
    bus.senderUrl = 'https://evil.example/';
    const result = await bus.ipcRenderer.invoke('app:ping', { message: 'hi' });
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_UNTRUSTED_SENDER' } });
    expect(ping).not.toHaveBeenCalled();
  });

  it('rejects requests without a sender frame', async () => {
    const { bus } = setup();
    bus.senderUrl = null;
    const result = await bus.ipcRenderer.invoke('app:getInfo');
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_UNTRUSTED_SENDER' } });
  });

  it.each([
    ['wrong type', { message: 42 }],
    ['unknown key', { message: 'hi', extra: true }],
    ['too long', { message: 'x'.repeat(1025) }],
    ['missing payload', undefined],
  ])('rejects an invalid request (%s)', async (_label, payload) => {
    const { bus } = setup();
    const result = await bus.ipcRenderer.invoke('app:ping', payload);
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_INVALID_REQUEST' } });
  });

  it('rejects extra positional arguments', async () => {
    const { bus } = setup();
    const result = await bus.ipcRenderer.invoke('app:ping', { message: 'hi' }, 'smuggled');
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_INVALID_REQUEST' } });
  });

  it('does not echo request values in validation errors', async () => {
    const { bus } = setup();
    const result = (await bus.ipcRenderer.invoke('app:ping', {
      message: 'secret-token-value'.repeat(100),
    })) as {
      error: { detail?: string };
    };
    expect(JSON.stringify(result)).not.toContain('secret-token-value');
    expect(result.error.detail).toBeDefined();
  });

  it('passes AppErrors from handlers through unchanged', async () => {
    const error = new AppError({
      code: 'INTERNAL',
      message: 'Handled failure',
      retryable: true,
      source: 'main',
    });
    const { bus } = setup(
      withApp({
        getInfo: () => {
          throw error;
        },
      }),
    );
    await expect(bus.ipcRenderer.invoke('app:getInfo')).resolves.toEqual({
      ok: false,
      error: error.toData(),
    });
  });

  it('hides unexpected handler errors behind a generic INTERNAL error', async () => {
    const { bus, onInternalError } = setup(
      withApp({
        getInfo: () => {
          throw new Error('stack details with C:\\Users\\someone');
        },
      }),
    );
    const result = await bus.ipcRenderer.invoke('app:getInfo');
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'An unexpected error occurred.',
        retryable: false,
        source: 'main',
      },
    });
    expect(onInternalError).toHaveBeenCalledWith('app:getInfo', expect.any(Error));
  });

  it('rejects handler responses that break the contract', async () => {
    const { bus, onInternalError } = setup(
      withApp({
        getInfo: () => ({ ...appInfo, platform: 'solaris' }) as never,
      }),
    );
    const result = await bus.ipcRenderer.invoke('app:getInfo');
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_INVALID_RESPONSE' } });
    expect(onInternalError).toHaveBeenCalledOnce();
  });

  it('throws at startup when a handler is missing', () => {
    const bus = new FakeIpcBus();
    expect(() =>
      registerIpcRouter({
        ipcMain: bus.ipcMain,
        handlers: { ...fakeHandlers(), app: { getInfo: () => appInfo } } as unknown as IpcHandlers,
        isTrustedSender: () => true,
      }),
    ).toThrow(/app:ping/);
  });

  it('removes every handler on dispose', () => {
    const { bus, dispose } = setup();
    dispose();
    expect(bus.handlers.size).toBe(0);
  });
});
