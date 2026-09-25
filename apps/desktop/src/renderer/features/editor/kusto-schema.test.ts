import { describe, expect, it } from 'vitest';

import { mergeSchemas } from '../../../shared/schema/models';

import { availabilityText, parseFunctionParameters, toKustoSchema } from './kusto-schema';

const merged = mergeSchemas(
  [
    {
      tables: [
        {
          name: 'SigninLogs',
          columns: [
            { name: 'TimeGenerated', type: 'datetime' },
            { name: 'RiskLevel', type: 'string', description: 'Risk level' },
          ],
        },
        { name: 'Heartbeat', columns: [{ name: 'Computer', type: 'string' }] },
      ],
      functions: [
        { name: 'Recent', parameters: 'lookback:timespan = 1d', body: 'Heartbeat' },
        { name: 'Tabular', parameters: 'T:(Computer:string)', body: 'T' },
      ],
    },
    {
      tables: [
        { name: 'SigninLogs', columns: [{ name: 'TimeGenerated', type: 'datetime' }] },
        { name: 'Contoso_CL', description: 'Firewall', columns: [] },
      ],
      functions: [],
    },
  ],
  0,
);

describe('availabilityText', () => {
  it('only speaks up when something is missing somewhere', () => {
    expect(availabilityText(5, 5)).toBeUndefined();
    expect(availabilityText(0, 0)).toBeUndefined();
    expect(availabilityText(3, 5)).toBe('Available in 3/5 selected workspaces');
    expect(availabilityText(0, 5)).toBe('Not in any selected workspace');
  });
});

describe('parseFunctionParameters', () => {
  it('parses scalar parameters and gives up on tabular ones', () => {
    expect(parseFunctionParameters('')).toEqual([]);
    expect(parseFunctionParameters('lookback:timespan, name: string = "x"')).toEqual([
      { name: 'lookback', type: 'timespan', cslType: 'timespan' },
      { name: 'name', type: 'string', cslType: 'string' },
    ]);
    expect(parseFunctionParameters('T:(Computer:string)')).toBeUndefined();
  });
});

describe('toKustoSchema', () => {
  const schema = toKustoSchema(merged, { hideTablesMissingEverywhere: true, version: 7 });
  const table = (name: string) => schema.database.tables.find((t) => t.name === name);

  it('builds one versioned database that is also the database in context', () => {
    expect(schema.cluster.databases).toEqual([schema.database]);
    expect(schema.database.majorVersion).toBe(7);
  });

  it('adds availability to tables and columns missing somewhere', () => {
    expect(table('SigninLogs')?.docstring).toContain('sign-ins'); // built-in description
    expect(table('SigninLogs')?.docstring).not.toContain('Available in');
    expect(table('Heartbeat')?.docstring).toContain('Available in 1/2 selected workspaces');
    expect(table('Contoso_CL')?.docstring).toBe('Firewall\n\nAvailable in 1/2 selected workspaces');
    expect(table('SigninLogs')?.columns).toEqual([
      { name: 'TimeGenerated', type: 'datetime' },
      {
        name: 'RiskLevel',
        type: 'string',
        docstring: 'Risk level\n\nAvailable in 1/2 selected workspaces',
      },
    ]);
  });

  it('keeps scalar functions only', () => {
    expect(schema.database.functions.map((f) => f.name)).toEqual(['Recent']);
  });

  it('lists known tables missing everywhere only when not hidden', () => {
    expect(table('SecurityEvent')).toBeUndefined();
    const all = toKustoSchema(merged, { hideTablesMissingEverywhere: false, version: 8 });
    const securityEvent = all.database.tables.find((t) => t.name === 'SecurityEvent');
    expect(securityEvent?.docstring).toContain('Not in any selected workspace');
    expect(all.database.tables.filter((t) => t.name === 'SigninLogs')).toHaveLength(1);
  });
});
