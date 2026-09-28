import type { INetworkModule, NetworkRequestOptions, NetworkResponse } from '@azure/msal-node';

import type { FetchLike } from './arm-tenants';

export interface AzureHttpOptions {
  /** Electron's `net.fetch` in the app (Chromium network stack: OS proxy, PAC, certificates). */
  fetch: FetchLike;
  /** Sent as `x-ms-app` so Azure can attribute requests to the app (spec 04). */
  appName: string;
  appVersion: string;
}

export interface AzureRequestInit extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal | null | undefined;
  /** Client-side timeout; aborts the request with a `TimeoutError`. */
  timeoutMs?: number;
}

/**
 * The one HTTP client for every Azure call (D-023): ARM, Resource Graph, Log Analytics and
 * (through {@link AzureHttp.msalNetworkModule}) MSAL itself, so every request follows the OS
 * proxy settings.
 */
export class AzureHttp {
  constructor(private readonly options: AzureHttpOptions) {}

  /** A `FetchLike` for the typed clients that take one. */
  readonly fetch: FetchLike = (url, init) => this.request(url, init);

  request(url: string, init: AzureRequestInit = {}): Promise<Response> {
    const { timeoutMs, signal, headers, ...rest } = init;
    const signals = [
      ...(signal === undefined || signal === null ? [] : [signal]),
      ...(timeoutMs === undefined ? [] : [AbortSignal.timeout(timeoutMs)]),
    ];
    const merged = new Headers(headers);
    if (!merged.has('x-ms-app')) {
      merged.set('x-ms-app', `${this.options.appName}/${this.options.appVersion}`);
    }
    return this.options.fetch(url, {
      ...rest,
      headers: merged,
      ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
    });
  }

  /** MSAL's network module on top of this client (token and discovery requests). */
  msalNetworkModule(): INetworkModule {
    const send = async <T>(
      method: 'GET' | 'POST',
      url: string,
      options: NetworkRequestOptions | undefined,
      timeoutMs: number | undefined,
    ): Promise<NetworkResponse<T>> => {
      const response = await this.options.fetch(url, {
        method,
        headers: options?.headers ?? {},
        ...(options?.body === undefined ? {} : { body: options.body }),
        ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text === '' ? {} : JSON.parse(text);
      } catch {
        // MSAL inspects the status; keep the raw text for its error message.
        body = { error: 'invalid_json', error_description: text.slice(0, 500) };
      }
      return { headers, body: body as T, status: response.status };
    };
    return {
      sendGetRequestAsync: <T>(url: string, options?: NetworkRequestOptions, timeout?: number) =>
        send<T>('GET', url, options, timeout),
      sendPostRequestAsync: <T>(url: string, options?: NetworkRequestOptions) =>
        send<T>('POST', url, options, 60_000),
    };
  }
}
