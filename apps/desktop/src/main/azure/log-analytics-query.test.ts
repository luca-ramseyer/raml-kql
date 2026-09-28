import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_CLOUD } from '../auth/cloud';

import {
  describeApiError,
  executeLogAnalyticsQuery,
  parseQueryResponse,
  QueryFailure,
  retryAfterMs,
} from './log-analytics-query';

describe('parseQueryResponse', () => {
  it('reads tables, render, statistics and partial errors', () => {
    const response = parseQueryResponse({
      tables: [
        {
          name: 'PrimaryResult',
          columns: [
            { name: 'TimeGenerated', type: 'datetime' },
            { name: 'Count', type: 'long' },
            { name: 'Odd', type: null },
          ],
          rows: [['2026-09-01T00:00:00Z', 5, null]],
        },
      ],
      render: { visualization: 'timechart', title: 'Sign-ins' },
      statistics: {
        query: {
          resourceUsage: {
            cpu: { 'total cpu': '00:00:01.5000000' },
            cache: {
              shards: { hot: { hitbytes: 1_048_576, missbytes: 1_048_576, retrievebytes: 0 } },
            },
          },
        },
      },
      error: {
        code: 'PartialError',
        message: 'There were some errors',
        innererror: { code: 'LimitsExceeded', message: 'Result truncated' },
      },
    });
    expect(response).toEqual({
      tables: [
        {
          name: 'PrimaryResult',
          columns: [
            { name: 'TimeGenerated', type: 'datetime' },
            { name: 'Count', type: 'long' },
            { name: 'Odd', type: 'string' },
          ],
          rows: [['2026-09-01T00:00:00Z', 5, null]],
        },
      ],
      render: { visualization: 'timechart', properties: { title: 'Sign-ins' } },
      statistics: { cpuMs: 1500, dataScannedMb: 2 },
      partialError: { code: 'LimitsExceeded', message: 'LimitsExceeded: Result truncated' },
    });
  });

  it('tolerates missing pieces', () => {
    expect(parseQueryResponse({})).toEqual({ tables: [] });
    expect(
      parseQueryResponse({ tables: [], render: { visualization: '' }, statistics: 'x' }),
    ).toEqual({
      tables: [],
    });
    expect(() => parseQueryResponse({ tables: 'x' })).toThrow();
  });
});

describe('error helpers', () => {
  it('describes the innermost error and redacts tokens', () => {
    expect(
      describeApiError(
        {
          code: 'BadArgumentError',
          message: 'The request had some invalid properties',
          innererror: {
            code: 'SyntaxError',
            message: 'A recognition error occurred.',
            innererror: {
              code: 'SEM0100',
              message: "Failed to resolve table 'X' for Bearer abcdefghijklmnop",
            },
          },
        },
        'fallback',
      ),
    ).toEqual({
      code: 'SEM0100',
      message: "SEM0100: Failed to resolve table 'X' for Bearer [redacted]",
    });
    expect(describeApiError(undefined, 'HTTP 500')).toEqual({
      code: 'Error',
      message: 'Error: HTTP 500',
    });
  });

  it('reads Retry-After in its three forms', () => {
    expect(retryAfterMs(new Headers({ 'x-ms-retry-after-ms': '250' }))).toBe(250);
    expect(retryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(
      retryAfterMs(
        new Headers({ 'retry-after': 'Wed, 01 Jan 2031 00:00:10 GMT' }),
        Date.parse('2031-01-01T00:00:00Z'),
      ),
    ).toBe(10_000);
    expect(retryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
    expect(retryAfterMs(new Headers())).toBeUndefined();
  });
});

describe('executeLogAnalyticsQuery', () => {
  const base = {
    cloud: PUBLIC_CLOUD,
    token: 't',
    customerId: '00000000-0000-0000-0000-000000000101',
    query: 'T',
    timeoutSeconds: 30,
    requestId: 'run-1',
  };

  it.each([
    [429, 'throttled'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [400, 'badRequest'],
    [504, 'timeout'],
    [502, 'transient'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'X', message: 'nope' } },
          { status, headers: { 'retry-after': '2' } },
        ),
      ),
    );
    const error = await executeLogAnalyticsQuery({
      ...base,
      fetch,
      signal: new AbortController().signal,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueryFailure);
    expect(error).toMatchObject({
      kind,
      message: 'X: nope',
      details: { status, retryAfterMs: 2000 },
    });
  });

  it('reports cancellation, network errors and unreadable bodies', async () => {
    const controller = new AbortController();
    controller.abort();
    const rejecting = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    await expect(
      executeLogAnalyticsQuery({ ...base, fetch: rejecting, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(
      executeLogAnalyticsQuery({ ...base, fetch: rejecting, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'network', message: 'Network error: fetch failed' });
    const garbage = vi.fn(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(
      executeLogAnalyticsQuery({ ...base, fetch: garbage, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'transient' });
    const html = vi.fn(() => Promise.resolve(new Response('<html>', { status: 500 })));
    await expect(
      executeLogAnalyticsQuery({ ...base, fetch: html, signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      kind: 'transient',
      message: 'Error: Log Analytics returned HTTP 500',
    });
  });

  it('omits the timespan when the query sets its own', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(Response.json({ tables: [] })),
    );
    await executeLogAnalyticsQuery({ ...base, fetch, signal: new AbortController().signal });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({ query: 'T' });
  });
});
