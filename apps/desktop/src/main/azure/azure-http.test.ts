import { describe, expect, it, vi } from 'vitest';

import { AzureHttp } from './azure-http';

describe('AzureHttp', () => {
  it('adds x-ms-app and merges abort signals with the timeout', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('ok')));
    const http = new AzureHttp({ fetch, appName: 'RamlKQL', appVersion: '1.0.0' });
    await http.fetch('https://example.invalid', { headers: { Accept: 'application/json' } });
    const init = fetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-ms-app')).toBe('RamlKQL/1.0.0');
    expect(headers.get('accept')).toBe('application/json');
    expect(init?.signal).toBeUndefined();

    const controller = new AbortController();
    await http.request('https://example.invalid', { signal: controller.signal, timeoutMs: 60_000 });
    const signal = fetch.mock.calls[1]?.[1].signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('gives MSAL a network module on top of the same fetch', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        Response.json({ access_token: 'x' }, { headers: { 'x-ms-request-id': 'abc' } }),
      ),
    );
    const module = new AzureHttp({
      fetch,
      appName: 'RamlKQL',
      appVersion: '1.0.0',
    }).msalNetworkModule();
    const post = await module.sendPostRequestAsync<{ access_token: string }>(
      'https://login.example/token',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token',
      },
    );
    expect(post).toMatchObject({ status: 200, body: { access_token: 'x' } });
    expect(post.headers['x-ms-request-id']).toBe('abc');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: 'grant_type=refresh_token',
    });

    fetch.mockResolvedValueOnce(new Response('not json', { status: 400 }));
    const get = await module.sendGetRequestAsync<{ error: string }>(
      'https://login.example/x',
      undefined,
      1000,
    );
    expect(get).toMatchObject({ status: 400, body: { error: 'invalid_json' } });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await module.sendGetRequestAsync('https://login.example/y')).body).toEqual({});
  });
});
