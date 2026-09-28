import { describe, expect, it } from 'vitest';

import { mergeSchemas, normalizeKqlType, widenKqlType, type WorkspaceSchemaData } from './models';

describe('normalizeKqlType', () => {
  it.each([
    ['string', 'string'],
    ['String', 'string'],
    ['boolean', 'bool'],
    ['dateTime', 'datetime'],
    ['Int32', 'int'],
    ['int64', 'long'],
    ['double', 'real'],
    ['guid', 'guid'],
    ['dynamic', 'dynamic'],
    ['timespan', 'timespan'],
    ['something-new', 'string'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeKqlType(input)).toBe(expected);
  });
});

describe('widenKqlType', () => {
  it('widens numbers and falls back to string', () => {
    expect(widenKqlType('long', 'long')).toBe('long');
    expect(widenKqlType('int', 'long')).toBe('long');
    expect(widenKqlType('real', 'long')).toBe('real');
    expect(widenKqlType('datetime', 'string')).toBe('string');
    expect(widenKqlType('bool', 'int')).toBe('string');
  });
});

const workspaceA: WorkspaceSchemaData = {
  tables: [
    {
      name: 'SigninLogs',
      columns: [
        { name: 'TimeGenerated', type: 'datetime' },
        { name: 'ResultType', type: 'string' },
        { name: 'Score', type: 'long' },
      ],
    },
    { name: 'Heartbeat', columns: [{ name: 'Computer', type: 'string' }] },
  ],
  functions: [{ name: 'FailedSignIns', parameters: '', body: 'SigninLogs' }],
};

const workspaceB: WorkspaceSchemaData = {
  tables: [
    {
      name: 'SigninLogs',
      description: 'Sign-ins',
      columns: [
        { name: 'TimeGenerated', type: 'datetime' },
        { name: 'Score', type: 'real', description: 'Risk score' },
        { name: 'Score', type: 'real' }, // duplicate names count once
      ],
    },
    { name: 'Contoso_CL', columns: [{ name: 'RawData', type: 'string' }] },
  ],
  functions: [],
};

describe('mergeSchemas', () => {
  it('unions tables and columns with availability counts', () => {
    const merged = mergeSchemas([workspaceA, workspaceB], 1);
    expect(merged.loaded).toBe(2);
    expect(merged.failed).toBe(1);
    expect(merged.tables.map((t) => [t.name, t.available])).toEqual([
      ['Contoso_CL', 1],
      ['Heartbeat', 1],
      ['SigninLogs', 2],
    ]);
    const signins = merged.tables.find((t) => t.name === 'SigninLogs');
    expect(signins?.description).toBe('Sign-ins');
    expect(signins?.columns).toEqual([
      { name: 'TimeGenerated', type: 'datetime', available: 2 },
      { name: 'ResultType', type: 'string', available: 1 },
      { name: 'Score', type: 'real', available: 2, description: 'Risk score' },
    ]);
    expect(merged.functions).toEqual([
      { name: 'FailedSignIns', parameters: '', body: 'SigninLogs', available: 1 },
    ]);
  });

  it('does not mutate its input', () => {
    const snapshot = JSON.stringify([workspaceA, workspaceB]);
    mergeSchemas([workspaceA, workspaceB], 0);
    expect(JSON.stringify([workspaceA, workspaceB])).toBe(snapshot);
  });

  it('is empty for no workspaces', () => {
    expect(mergeSchemas([], 0)).toEqual({ loaded: 0, failed: 0, tables: [], functions: [] });
  });
});
