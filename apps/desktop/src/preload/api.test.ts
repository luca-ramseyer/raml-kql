import { describe, expect, it, vi } from 'vitest';

import { createRamlKqlApi, type IpcRendererLike } from './api';

function apiWith(invoke: IpcRendererLike['invoke']) {
  const renderer = { invoke: vi.fn(invoke) };
  return { api: createRamlKqlApi(renderer), renderer };
}

describe('createRamlKqlApi', () => {
  it('exposes one method per contract entry', () => {
    const { api } = apiWith(() => Promise.resolve(undefined));
    expect(Object.keys(api)).toEqual(['app']);
    expect(Object.keys(api.app).sort()).toEqual(['getInfo', 'ping']);
  });

  it('sends no argument for channels without a request payload', async () => {
    const { api, renderer } = apiWith(() =>
      Promise.resolve({
        ok: true,
        value: {
          name: 'Raml KQL',
          version: '0.0.0',
          platform: 'linux',
          electronVersion: '44.0.0',
          demoMode: false,
        },
      }),
    );
    await api.app.getInfo();
    expect(renderer.invoke).toHaveBeenCalledWith('app:getInfo');
  });

  it('validates requests before they leave the renderer', async () => {
    const { api, renderer } = apiWith(() => Promise.resolve(undefined));
    const result = await api.app.ping({ message: 1 as unknown as string });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'IPC_INVALID_REQUEST', source: 'preload' },
    });
    expect(renderer.invoke).not.toHaveBeenCalled();
  });

  it('rejects a malformed envelope from main', async () => {
    const { api } = apiWith(() => Promise.resolve({ something: 'else' }));
    await expect(api.app.getInfo()).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_INVALID_RESPONSE', source: 'preload' },
    });
  });

  it('rejects a response value that breaks the contract', async () => {
    const { api } = apiWith(() =>
      Promise.resolve({ ok: true, value: { message: 'hi', receivedAt: 'yesterday' } }),
    );
    await expect(api.app.ping({ message: 'hi' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_INVALID_RESPONSE' },
    });
  });

  it('passes error envelopes from main through', async () => {
    const error = {
      code: 'IPC_UNTRUSTED_SENDER',
      message: 'nope',
      retryable: false,
      source: 'main',
    };
    const { api } = apiWith(() => Promise.resolve({ ok: false, error }));
    await expect(api.app.getInfo()).resolves.toEqual({ ok: false, error });
  });
});
