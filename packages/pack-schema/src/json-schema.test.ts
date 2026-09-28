import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildJsonSchemas } from './json-schema';

/**
 * The committed JSON Schema files must match the zod schemas. To regenerate them run
 * `pnpm --filter @raml-kql/pack-schema generate` (this test with RKQL_UPDATE_SCHEMAS=1).
 */
const dir = path.resolve(import.meta.dirname, '..', 'schemas');

describe('JSON Schema files', () => {
  it('are up to date', () => {
    for (const [file, text] of Object.entries(buildJsonSchemas())) {
      const target = path.join(dir, file);
      if (process.env['RKQL_UPDATE_SCHEMAS'] === '1') writeFileSync(target, text);
      expect(readFileSync(target, 'utf8'), `${file} is stale: run the generate script`).toBe(text);
    }
  });

  it('describe the manifest', () => {
    const manifest = JSON.parse(buildJsonSchemas()['rkqlpack.schema.json']) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(manifest.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'id', 'name', 'version', 'description']),
    );
    expect(manifest.additionalProperties).toBe(false);
  });
});
