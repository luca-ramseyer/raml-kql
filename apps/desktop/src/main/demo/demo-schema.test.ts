import { describe, expect, it } from 'vitest';

import { DEMO_WORKSPACES, demoResourceId } from './demo-inventory';
import { demoFetchSchema, demoSchemaFor } from './demo-schema';

describe('demo schema', () => {
  it('gives every workspace the basics and uses TimeGenerated, never Timestamp', () => {
    for (const workspace of DEMO_WORKSPACES) {
      const schema = demoSchemaFor(workspace);
      expect(schema.tables.map((t) => t.name)).toEqual(
        expect.arrayContaining(['Heartbeat', 'AzureActivity', 'Usage']),
      );
      for (const table of schema.tables) {
        expect(table.columns[0]).toEqual({ name: 'TimeGenerated', type: 'datetime' });
        expect(table.columns.map((c) => c.name)).not.toContain('Timestamp');
      }
    }
  });

  it('differs between workspaces so availability hints show', () => {
    const withDefender = DEMO_WORKSPACES.filter((w) =>
      demoSchemaFor(w).tables.some((t) => t.name === 'DeviceProcessEvents'),
    );
    expect(withDefender.map((w) => w.name)).toEqual([
      'la-contoso-soc',
      'la-fabrikam-sentinel',
      'la-woodgrove-sentinel',
    ]);
  });

  it('fails like the fake query engine for forbidden workspaces', async () => {
    const forbidden = DEMO_WORKSPACES.find((w) => w.behaviour === 'alwaysForbidden');
    const normal = DEMO_WORKSPACES[0];
    if (forbidden === undefined || normal === undefined) throw new Error('fixture');
    await expect(demoFetchSchema(demoResourceId(forbidden))).rejects.toThrow('Forbidden');
    await expect(demoFetchSchema('/unknown')).rejects.toThrow('Forbidden');
    await expect(demoFetchSchema(demoResourceId(normal).toUpperCase())).resolves.toEqual(
      demoSchemaFor(normal),
    );
  });
});
