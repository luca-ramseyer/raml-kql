import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceSchemaData } from '../../shared/schema/models';

import { FileSchemaCache, MemorySchemaCache } from './schema-cache';

const RESOURCE_ID =
  '/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg-la-contoso-soc/providers/microsoft.operationalinsights/workspaces/la-contoso-soc';
const SCHEMA: WorkspaceSchemaData = {
  tables: [{ name: 'Heartbeat', columns: [{ name: 'Computer', type: 'string' }] }],
  functions: [],
};

describe('FileSchemaCache', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a schema under a hashed file name', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-schema-'));
    const cacheDir = path.join(dir, 'state', 'schema-cache');
    const cache = new FileSchemaCache(cacheDir);
    const fetchedAt = new Date('2026-09-01T10:00:00Z');
    await cache.write(RESOURCE_ID, SCHEMA, fetchedAt);

    expect(await cache.read(RESOURCE_ID)).toEqual({ fetchedAt, schema: SCHEMA });
    // Resource IDs are case-insensitive.
    expect(await cache.read(RESOURCE_ID.toUpperCase())).toEqual({ fetchedAt, schema: SCHEMA });

    const files = readdirSync(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.json$/);
    // No names in paths, and nothing but metadata in the file.
    const content = readFileSync(path.join(cacheDir, files[0] ?? ''), 'utf8');
    expect(content).not.toContain('contoso');
  });

  it('returns undefined for missing or corrupt entries and removes corrupt files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-schema-'));
    const cache = new FileSchemaCache(dir);
    expect(await cache.read(RESOURCE_ID)).toBeUndefined();

    await cache.write(RESOURCE_ID, SCHEMA, new Date());
    const file = path.join(dir, readdirSync(dir)[0] ?? '');
    writeFileSync(file, JSON.stringify({ version: 1, fetchedAt: 'yesterday', schema: {} }));
    expect(await cache.read(RESOURCE_ID)).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);

    writeFileSync(file, '{ not json');
    expect(await cache.read(RESOURCE_ID)).toBeUndefined();
  });
});

describe('MemorySchemaCache', () => {
  it('round-trips case-insensitively', async () => {
    const cache = new MemorySchemaCache();
    const fetchedAt = new Date();
    await cache.write(RESOURCE_ID, SCHEMA, fetchedAt);
    expect(await cache.read(RESOURCE_ID.toUpperCase())).toEqual({ fetchedAt, schema: SCHEMA });
  });
});
