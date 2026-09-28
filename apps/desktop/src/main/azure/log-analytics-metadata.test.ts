import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_CLOUD } from '../auth/cloud';

import { fetchWorkspaceMetadata, parseWorkspaceMetadata } from './log-analytics-metadata';

const CUSTOMER_ID = '00000000-0000-0000-0000-000000000101';

/** Trimmed shape of a real metadata response, with fake content. */
const RESPONSE = {
  tables: [
    {
      id: 't/SigninLogs',
      name: 'SigninLogs',
      timespanColumn: 'TimeGenerated',
      description: 'Sign-ins',
      columns: [
        { name: 'TimeGenerated', type: 'datetime' },
        { name: 'ResultType', type: 'string', description: 'Result code' },
        { name: 'Risk', type: 'double' },
      ],
      solutions: ['s/SecurityInsights'],
    },
    { id: 't/Contoso_CL', name: 'Contoso_CL', columns: [{ name: 'RawData', type: 'string' }] },
  ],
  functions: [
    {
      id: 'f/1',
      name: 'FailedSignIns',
      body: 'SigninLogs | where ResultType != "0"',
      parameters: '(lookback:timespan)',
    },
  ],
  solutions: [{ id: 's/SecurityInsights', name: 'SecurityInsights' }],
  workspaces: [{ id: CUSTOMER_ID, name: 'la-contoso-soc' }],
};

describe('parseWorkspaceMetadata', () => {
  it('keeps tables, columns and functions and normalizes types', () => {
    expect(parseWorkspaceMetadata(RESPONSE)).toEqual({
      tables: [
        {
          name: 'SigninLogs',
          description: 'Sign-ins',
          columns: [
            { name: 'TimeGenerated', type: 'datetime' },
            { name: 'ResultType', type: 'string', description: 'Result code' },
            { name: 'Risk', type: 'real' },
          ],
        },
        { name: 'Contoso_CL', columns: [{ name: 'RawData', type: 'string' }] },
      ],
      functions: [
        {
          name: 'FailedSignIns',
          parameters: 'lookback:timespan',
          body: 'SigninLogs | where ResultType != "0"',
        },
      ],
    });
  });

  it('tolerates missing sections and nulls', () => {
    expect(parseWorkspaceMetadata({})).toEqual({ tables: [], functions: [] });
    expect(
      parseWorkspaceMetadata({ tables: [{ name: 'T', description: null }], functions: null }),
    ).toEqual({ tables: [{ name: 'T', columns: [] }], functions: [] });
  });

  it('rejects responses that are not metadata', () => {
    expect(() => parseWorkspaceMetadata({ tables: 'nope' })).toThrow();
    expect(() => parseWorkspaceMetadata(null)).toThrow();
  });
});

describe('fetchWorkspaceMetadata', () => {
  it('calls the metadata endpoint with the token', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json(RESPONSE)));
    const schema = await fetchWorkspaceMetadata({
      cloud: PUBLIC_CLOUD,
      token: 'test-token',
      customerId: CUSTOMER_ID,
      fetch,
    });
    expect(schema.tables).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.loganalytics.io/v1/workspaces/${CUSTOMER_ID}/metadata`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token', Accept: 'application/json' },
      }),
    );
  });

  it('throws with the HTTP status on failure', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('denied', { status: 403 })));
    await expect(
      fetchWorkspaceMetadata({ cloud: PUBLIC_CLOUD, token: 't', customerId: CUSTOMER_ID, fetch }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
